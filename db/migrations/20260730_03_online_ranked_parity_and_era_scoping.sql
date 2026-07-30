-- Makes Online Ranked structurally identical to offline Ranked Practice:
-- full 10-player rosters (5 starters + 5 bench, not the old 6-slot legacy
-- roster), a rotation/matchups/tactic "strategy" phase between draft and
-- simulation, and per-sport-per-era matchmaking queues so a "Modern Ball"
-- search only pairs with another Modern Ball search and only ever rolls
-- 2010s/2020s squads (previously: no era scoping existed anywhere, so any
-- era selection was cosmetic and matches pulled from any decade).
--
-- Found while diagnosing three live-tested bugs: a Modern Ball ranked
-- search matched a 1990s squad, the online roster was only 6 players
-- (starters + one bench man) instead of 10, and simulation never
-- completed (separate root cause - see the simulate-match Edge Function
-- CORS fix, deployed alongside this).

alter table public.matches
  add column rotation_a jsonb,
  add column rotation_b jsonb,
  add column matchups_a jsonb,
  add column matchups_b jsonb,
  add column tactic_a text,
  add column tactic_b text,
  add column era text not null default 'all';
alter table public.matchmaking_queue add column era text not null default 'all';

-- New 'strategy' status: between "both rosters full" and "ready to
-- simulate", covering rotation minutes + defensive matchups + tactic pick -
-- the same sequence js/main.js's startRotationPhase/startMatchupPhase/
-- startTacticPhase already runs for offline Ranked Practice.
alter table public.matches drop constraint matches_status_check;
alter table public.matches add constraint matches_status_check
  check (status = any (array['drafting','strategy','ready_to_simulate','complete']));

-- Mirrors js/constants.js's ERAS decades lists. Keep in sync by hand if
-- that list ever changes - there's no way to share the JS array with SQL.
create or replace function public.era_decades(p_era text)
returns text[]
language sql immutable
as $$
  select case p_era
    when 'grandpas' then array['1960s','1970s','1980s']
    when 'unc' then array['1990s','2000s']
    when 'modern' then array['2010s','2020s']
    else null -- 'all' or unknown: no filter
  end;
$$;

create or replace view public.matches_public as
  select id, player_a, player_b, status, round_number, current_squad_team,
    current_squad_decade, used_squads, winner, created_at, updated_at, is_friendly, sport, era
  from public.matches;

-- rotation_a/b, matchups_a/b, tactic_a/b are deliberately NOT in the view -
-- they're each side's hidden strategy choice, same reasoning as
-- roster_a/roster_b never being exposed before the reveal rule applies.

create or replace function public.advance_round_if_ready(p_match_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_match record;
  v_both_acted boolean;
  v_next record;
  v_decades text[];
begin
  select * into v_match from public.matches where id = p_match_id for update;

  select
    exists(select 1 from public.match_picks where match_id = p_match_id and side = 'A' and round_number = v_match.round_number)
    and
    exists(select 1 from public.match_picks where match_id = p_match_id and side = 'B' and round_number = v_match.round_number)
  into v_both_acted;

  if not v_both_acted then return; end if;

  -- 10 = RANKED_SLOTS.length (js/constants.js): 5 starters + 5 bench, the
  -- same full roster offline Ranked Practice drafts. Was hardcoded to 6
  -- (the old legacy SLOTS roster) - the root cause of online rosters being
  -- starters-plus-one-bench-man instead of a real 10-man roster.
  if (select count(*) from jsonb_object_keys(v_match.roster_a)) = 10
     and (select count(*) from jsonb_object_keys(v_match.roster_b)) = 10 then
    update public.matches set status = 'strategy', updated_at = now() where id = p_match_id;
    return;
  end if;

  v_decades := public.era_decades(v_match.era);

  select p.team, p.decade into v_next from public.players p
    where (p.team || '|' || p.decade) <> all (v_match.used_squads)
      and (v_decades is null or p.decade = any(v_decades))
    order by random() limit 1;

  if v_next is null then
    select p.team, p.decade into v_next from public.players p
      where (v_decades is null or p.decade = any(v_decades))
      order by random() limit 1;
    update public.matches set
      current_squad_team = v_next.team, current_squad_decade = v_next.decade,
      round_number = v_match.round_number + 1, updated_at = now()
    where id = p_match_id;
  else
    update public.matches set
      current_squad_team = v_next.team, current_squad_decade = v_next.decade,
      used_squads = array_append(v_match.used_squads, v_next.team || '|' || v_next.decade),
      round_number = v_match.round_number + 1, updated_at = now()
    where id = p_match_id;
  end if;
end;
$$;

-- Now accepts bench slots (any player, no position lock - matches
-- js/draft.js's isEligible: "6TH or isBenchSlot(slot) accepts anyone").
-- Previously only accepted '6TH' or a position-matching starter slot, so a
-- bench pick would have been rejected outright the moment the client tried
-- to send one.
create or replace function public.submit_pick(p_match_id uuid, p_player_name text, p_team text, p_decade text, p_slot text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_match record;
  v_side text;
  v_roster jsonb;
  v_player record;
begin
  select public.get_side(p_match_id) into v_side;
  select * into v_match from public.matches where id = p_match_id for update;

  if v_match.status <> 'drafting' then raise exception 'match is not drafting'; end if;
  if p_team <> v_match.current_squad_team or p_decade <> v_match.current_squad_decade then
    raise exception 'player is not part of the currently rolled squad';
  end if;

  select * into v_player from public.players
    where name = p_player_name and team = p_team and decade = p_decade limit 1;
  if v_player is null then raise exception 'unknown player for this squad'; end if;
  if not (p_slot = any(v_player.pos) or p_slot = '6TH' or p_slot like 'BENCH%') then
    raise exception 'player not eligible for slot %', p_slot;
  end if;

  v_roster := case v_side when 'A' then v_match.roster_a else v_match.roster_b end;
  if v_roster ? p_slot then raise exception 'slot already filled'; end if;
  if exists (select 1 from jsonb_each(v_roster) e where (e.value ->> 'name') = p_player_name) then
    raise exception 'player already drafted';
  end if;
  if exists (
    select 1 from public.match_picks
    where match_id = p_match_id and side = v_side and round_number = v_match.round_number
  ) then
    raise exception 'already acted this round';
  end if;

  insert into public.match_picks (match_id, side, round_number, action, player_name, team, decade, slot)
  values (p_match_id, v_side, v_match.round_number, 'pick', p_player_name, p_team, p_decade, p_slot);

  v_roster := v_roster || jsonb_build_object(p_slot, jsonb_build_object(
    'name', v_player.name, 'team', v_player.team, 'decade', v_player.decade,
    'pos', to_jsonb(v_player.pos), 'ppg', v_player.ppg, 'rpg', v_player.rpg,
    'apg', v_player.apg, 'spg', v_player.spg, 'bpg', v_player.bpg, 'tov', v_player.tov
  ));

  if v_side = 'A' then
    update public.matches set roster_a = v_roster, updated_at = now() where id = p_match_id;
  else
    update public.matches set roster_b = v_roster, updated_at = now() where id = p_match_id;
  end if;

  perform public.advance_round_if_ready(p_match_id);
end;
$$;

-- Each side calls this once, after locally running the same
-- rotation -> matchups -> tactic sequence offline Ranked Practice uses
-- (js/main.js's startRotationPhase/startMatchupPhase/startTacticPhase).
-- Flips to ready_to_simulate only once BOTH sides have submitted (checked
-- via tactic_a/tactic_b, the last of the three fields each side writes).
create or replace function public.submit_strategy(p_match_id uuid, p_rotation jsonb, p_matchups jsonb, p_tactic text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_side text;
  v_match record;
begin
  v_side := public.get_side(p_match_id);
  select * into v_match from public.matches where id = p_match_id for update;
  if v_match.status <> 'strategy' then raise exception 'match is not awaiting strategy'; end if;

  if v_side = 'A' then
    update public.matches set rotation_a = p_rotation, matchups_a = p_matchups, tactic_a = p_tactic, updated_at = now() where id = p_match_id;
  else
    update public.matches set rotation_b = p_rotation, matchups_b = p_matchups, tactic_b = p_tactic, updated_at = now() where id = p_match_id;
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if v_match.tactic_a is not null and v_match.tactic_b is not null then
    update public.matches set status = 'ready_to_simulate', updated_at = now() where id = p_match_id;
  end if;
end;
$$;

create or replace function public.join_queue(p_sport text default 'nba', p_era text default 'all')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_opponent uuid;
  v_match_id uuid;
  v_match_updated timestamptz;
  v_sport text := coalesce(p_sport, 'nba');
  v_era text := coalesce(p_era, 'all');
  v_decades text[];
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select id, updated_at into v_match_id, v_match_updated from public.matches
    where (player_a = v_uid or player_b = v_uid) and status <> 'complete' and sport = v_sport and era = v_era
    order by created_at desc limit 1;
  if v_match_id is not null then
    if v_match_updated > now() - interval '15 minutes' then
      return jsonb_build_object('status', 'matched', 'match_id', v_match_id);
    end if;
    delete from public.matches where id = v_match_id;
  end if;

  insert into public.matchmaking_queue (user_id, sport, era) values (v_uid, v_sport, v_era)
    on conflict (user_id) do update set joined_at = matchmaking_queue.joined_at, sport = v_sport, era = v_era;

  select user_id into v_opponent from public.matchmaking_queue
    where user_id <> v_uid and sport = v_sport and era = v_era
    order by joined_at asc
    for update skip locked
    limit 1;

  if v_opponent is null then
    return jsonb_build_object('status', 'waiting');
  end if;

  delete from public.matchmaking_queue where user_id in (v_uid, v_opponent);

  v_decades := public.era_decades(v_era);
  insert into public.matches (player_a, player_b, current_squad_team, current_squad_decade, round_number, sport, era)
  select v_uid, v_opponent, p.team, p.decade, 1, v_sport, v_era
  from public.players p
  where v_decades is null or p.decade = any(v_decades)
  order by random()
  limit 1
  returning id into v_match_id;

  return jsonb_build_object('status', 'matched', 'match_id', v_match_id);
end;
$$;

create or replace function public.challenge_friend(p_friend_id uuid, p_sport text default 'nba', p_era text default 'all')
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match_id uuid;
  v_match_updated timestamptz;
  v_sport text := coalesce(p_sport, 'nba');
  v_era text := coalesce(p_era, 'all');
  v_decades text[];
begin
  if v_uid is null then
    raise exception 'Sign in required.';
  end if;
  if p_friend_id = v_uid then
    raise exception 'You can''t challenge yourself.';
  end if;
  if not exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = v_uid and addressee_id = p_friend_id)
        or (requester_id = p_friend_id and addressee_id = v_uid))
  ) then
    raise exception 'You can only challenge a friend.';
  end if;

  select id, updated_at into v_match_id, v_match_updated from public.matches
    where status <> 'complete' and sport = v_sport and era = v_era
      and ((player_a = v_uid and player_b = p_friend_id) or (player_a = p_friend_id and player_b = v_uid))
    order by created_at desc limit 1;
  if v_match_id is not null then
    if v_match_updated > now() - interval '15 minutes' then
      return v_match_id;
    end if;
    delete from public.matches where id = v_match_id;
  end if;

  v_decades := public.era_decades(v_era);
  insert into public.matches (player_a, player_b, current_squad_team, current_squad_decade, round_number, is_friendly, sport, era)
  select v_uid, p_friend_id, p.team, p.decade, 1, true, v_sport, v_era
  from public.players p
  where v_decades is null or p.decade = any(v_decades)
  order by random()
  limit 1
  returning id into v_match_id;

  return v_match_id;
end;
$$;

-- Verified via rolled-back SQL transactions before applying: a bench-slot
-- pick is accepted and a 10-filled roster on both sides moves status to
-- 'strategy' (not straight to ready_to_simulate); submit_strategy only
-- flips to ready_to_simulate once BOTH sides have submitted; a 'grandpas'
-- match rolled 15 rounds without ever landing outside 1960s/70s/80s;
-- two players queueing different eras don't match each other, and two
-- queueing the same era do, landing on a squad from that era.

-- Follow-up (same session): submit_pick's stored roster JSON only carried
-- the 6 basic stats (ppg/rpg/apg/spg/bpg/tov), not the shooting-split
-- fields (fga/fgp/tpa/tpp/fta/ftp) the players table now has - so the
-- synced engine's trueShooting()/scoringEfficiencyFactor() would silently
-- no-op for every online-picked player. Added them to the stored entry.
create or replace function public.submit_pick(p_match_id uuid, p_player_name text, p_team text, p_decade text, p_slot text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_match record;
  v_side text;
  v_roster jsonb;
  v_player record;
begin
  select public.get_side(p_match_id) into v_side;
  select * into v_match from public.matches where id = p_match_id for update;

  if v_match.status <> 'drafting' then raise exception 'match is not drafting'; end if;
  if p_team <> v_match.current_squad_team or p_decade <> v_match.current_squad_decade then
    raise exception 'player is not part of the currently rolled squad';
  end if;

  select * into v_player from public.players
    where name = p_player_name and team = p_team and decade = p_decade limit 1;
  if v_player is null then raise exception 'unknown player for this squad'; end if;
  if not (p_slot = any(v_player.pos) or p_slot = '6TH' or p_slot like 'BENCH%') then
    raise exception 'player not eligible for slot %', p_slot;
  end if;

  v_roster := case v_side when 'A' then v_match.roster_a else v_match.roster_b end;
  if v_roster ? p_slot then raise exception 'slot already filled'; end if;
  if exists (select 1 from jsonb_each(v_roster) e where (e.value ->> 'name') = p_player_name) then
    raise exception 'player already drafted';
  end if;
  if exists (
    select 1 from public.match_picks
    where match_id = p_match_id and side = v_side and round_number = v_match.round_number
  ) then
    raise exception 'already acted this round';
  end if;

  insert into public.match_picks (match_id, side, round_number, action, player_name, team, decade, slot)
  values (p_match_id, v_side, v_match.round_number, 'pick', p_player_name, p_team, p_decade, p_slot);

  v_roster := v_roster || jsonb_build_object(p_slot, jsonb_build_object(
    'name', v_player.name, 'team', v_player.team, 'decade', v_player.decade,
    'pos', to_jsonb(v_player.pos), 'ppg', v_player.ppg, 'rpg', v_player.rpg,
    'apg', v_player.apg, 'spg', v_player.spg, 'bpg', v_player.bpg, 'tov', v_player.tov,
    'fga', v_player.fga, 'fgp', v_player.fgp, 'tpa', v_player.tpa, 'tpp', v_player.tpp,
    'fta', v_player.fta, 'ftp', v_player.ftp
  ));

  if v_side = 'A' then
    update public.matches set roster_a = v_roster, updated_at = now() where id = p_match_id;
  else
    update public.matches set roster_b = v_roster, updated_at = now() where id = p_match_id;
  end if;

  perform public.advance_round_if_ready(p_match_id);
end;
$$;
