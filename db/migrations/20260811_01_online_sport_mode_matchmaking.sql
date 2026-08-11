-- Online matchmaking is scoped by SPORT + GAME MODE.
-- Each sport owns its own authoritative draft pool and roster contract.
-- NBA continues to use public.players. NFL uses public.nfl_players, seeded
-- from the exact generated files Ranked Practice uses in the browser.

create table if not exists public.online_game_modes (
  sport text not null,
  game_mode text not null,
  roster_slots text[] not null,
  matchmaking_enabled boolean not null default true,
  primary key (sport, game_mode)
);

insert into public.online_game_modes (sport, game_mode, roster_slots, matchmaking_enabled)
values
  ('nba', 'ranked', array['PG','SG','SF','PF','C','BENCH1','BENCH2','BENCH3','BENCH4','BENCH5'], true),
  ('nfl', 'ranked', array['QB','RB','WR1','WR2','WR3','TE','OL','DL','LB','CB','S','ST'], true)
on conflict (sport, game_mode) do update
set roster_slots = excluded.roster_slots,
    matchmaking_enabled = excluded.matchmaking_enabled;

alter table public.online_game_modes enable row level security;
drop policy if exists "online game modes are publicly readable" on public.online_game_modes;
create policy "online game modes are publicly readable"
  on public.online_game_modes for select using (true);

-- Exact server-owned NFL draft pool. payload is the generated Ranked Practice
-- object, so units keep members/group data and players keep every stat field.
create table if not exists public.nfl_players (
  id bigint generated always as identity primary key,
  name text not null,
  team text not null,
  era text not null,
  season integer not null,
  pos text[] not null default '{}',
  kind text not null check (kind in ('player','unit')),
  unit_group text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create unique index if not exists nfl_players_identity_idx
  on public.nfl_players (name, team, era, season, coalesce(unit_group, ''));
create index if not exists nfl_players_squad_idx
  on public.nfl_players (team, era, season);
create index if not exists nfl_players_kind_idx
  on public.nfl_players (kind, unit_group);

alter table public.nfl_players enable row level security;
drop policy if exists "nfl players are publicly readable" on public.nfl_players;
create policy "nfl players are publicly readable"
  on public.nfl_players for select using (true);

-- Rebuild the server pool from the same generated files used by Ranked Practice.
-- The generated JS is JSON objects plus comments/export syntax, so strip those
-- wrappers and parse the array. Keeping the full object in payload prevents a
-- second, subtly different online data model from drifting away from practice.
create or replace function public.sync_nfl_players_from_generated(p_ref text default 'main')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_players_text text;
  v_units_text text;
  v_players jsonb;
  v_units jsonb;
  v_count integer;
begin
  select content into v_players_text
  from http_get(format('https://raw.githubusercontent.com/madams3432923943/Gamebuild/%s/data/nfl-players.js', p_ref));
  select content into v_units_text
  from http_get(format('https://raw.githubusercontent.com/madams3432923943/Gamebuild/%s/data/nfl-units.js', p_ref));

  v_players_text := regexp_replace(v_players_text, '(?m)^\s*//.*$', '', 'g');
  v_players_text := regexp_replace(v_players_text, '^.*?\[', '[', 's');
  v_players_text := regexp_replace(v_players_text, '\];\s*$', ']', 's');
  v_players_text := regexp_replace(v_players_text, ',\s*\]$', ']', 's');

  v_units_text := regexp_replace(v_units_text, '(?m)^\s*//.*$', '', 'g');
  v_units_text := regexp_replace(v_units_text, '^.*?\[', '[', 's');
  v_units_text := regexp_replace(v_units_text, '\];\s*$', ']', 's');
  v_units_text := regexp_replace(v_units_text, ',\s*\]$', ']', 's');

  v_players := v_players_text::jsonb;
  v_units := v_units_text::jsonb;

  truncate table public.nfl_players restart identity;

  insert into public.nfl_players (name, team, era, season, pos, kind, unit_group, payload)
  select
    e->>'name',
    e->>'team',
    e->>'era',
    (e->>'season')::integer,
    coalesce(array(select jsonb_array_elements_text(e->'pos')), '{}'::text[]),
    'player',
    null,
    e
  from jsonb_array_elements(v_players) e;

  insert into public.nfl_players (name, team, era, season, pos, kind, unit_group, payload)
  select
    e->>'name',
    e->>'team',
    e->>'era',
    (e->>'season')::integer,
    coalesce(array(select jsonb_array_elements_text(e->'pos')), '{}'::text[]),
    'unit',
    e->>'group',
    e
  from jsonb_array_elements(v_units) e;

  select count(*) into v_count from public.nfl_players;
  if v_count <> jsonb_array_length(v_players) + jsonb_array_length(v_units) then
    raise exception 'NFL pool sync count mismatch: inserted %, expected %',
      v_count, jsonb_array_length(v_players) + jsonb_array_length(v_units);
  end if;
  return v_count;
end;
$$;

revoke all on function public.sync_nfl_players_from_generated(text) from public, anon, authenticated;
grant execute on function public.sync_nfl_players_from_generated(text) to service_role;

-- Seed now from the exact revision this migration was written against.
select public.sync_nfl_players_from_generated('6669cce75a5c240fbe1401229990434a11992f9c');

-- Queue and match rows carry game_mode so separate modes never meet each other.
alter table public.matchmaking_queue
  add column if not exists game_mode text not null default 'ranked';
alter table public.matches
  add column if not exists game_mode text not null default 'ranked';

create index if not exists matchmaking_scope_idx
  on public.matchmaking_queue (sport, game_mode, era, joined_at);
create index if not exists matches_scope_idx
  on public.matches (sport, game_mode, era, updated_at);

alter table public.matchmaking_queue drop constraint if exists matchmaking_supported_online_sport;
alter table public.matchmaking_queue
  add constraint matchmaking_supported_online_sport check (sport in ('nba','nfl'));
alter table public.matches drop constraint if exists matches_supported_online_sport;
alter table public.matches
  add constraint matches_supported_online_sport check (sport in ('nba','nfl'));

-- Public match state exposes scope but still never exposes hidden rosters.
create or replace view public.matches_public as
select id, player_a, player_b, status, round_number,
       current_squad_team, current_squad_decade, used_squads,
       winner, created_at, updated_at, is_friendly, sport, era, game_mode
from public.matches;

-- Three-argument implementation used by current clients. A queue is a tuple of
-- sport + game mode + era. The opening squad comes from that sport's own pool.
create or replace function public.join_queue(p_sport text, p_era text, p_game_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_opponent uuid;
  v_match_id uuid;
  v_match_updated timestamptz;
  v_sport text := coalesce(nullif(trim(p_sport), ''), 'nba');
  v_era text := coalesce(nullif(trim(p_era), ''), 'all');
  v_mode text := coalesce(nullif(trim(p_game_mode), ''), 'ranked');
  v_decades text[];
  v_team text;
  v_group text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.online_game_modes
    where sport = v_sport and game_mode = v_mode and matchmaking_enabled
  ) then
    raise exception 'online mode %/% is not enabled', v_sport, v_mode;
  end if;

  select id, updated_at into v_match_id, v_match_updated
  from public.matches
  where (player_a = v_uid or player_b = v_uid)
    and status <> 'complete'
    and sport = v_sport and era = v_era and game_mode = v_mode
  order by created_at desc limit 1;

  if v_match_id is not null then
    if v_match_updated > now() - interval '15 minutes' then
      return jsonb_build_object('status', 'matched', 'match_id', v_match_id);
    end if;
    delete from public.matches where id = v_match_id;
  end if;

  insert into public.matchmaking_queue (user_id, sport, era, game_mode)
  values (v_uid, v_sport, v_era, v_mode)
  on conflict (user_id) do update
  set joined_at = now(), sport = v_sport, era = v_era, game_mode = v_mode;

  select user_id into v_opponent
  from public.matchmaking_queue
  where user_id <> v_uid
    and sport = v_sport and era = v_era and game_mode = v_mode
  order by joined_at asc
  for update skip locked
  limit 1;

  if v_opponent is null then
    return jsonb_build_object('status', 'waiting');
  end if;

  delete from public.matchmaking_queue where user_id in (v_uid, v_opponent);

  if v_sport = 'nba' then
    v_decades := public.era_decades(v_era);
    select s.team, s.decade into v_team, v_group
    from (
      select distinct p.team, p.decade
      from public.players p
      where v_decades is null or p.decade = any(v_decades)
    ) s
    order by random() limit 1;
  elsif v_sport = 'nfl' then
    select s.team, s.era into v_team, v_group
    from (
      select distinct p.team, p.era
      from public.nfl_players p
      where v_era = 'all' or p.era = v_era
    ) s
    order by random() limit 1;
  end if;

  if v_team is null then raise exception 'no draft squads available for %/%/%', v_sport, v_mode, v_era; end if;

  insert into public.matches (
    player_a, player_b, current_squad_team, current_squad_decade,
    round_number, sport, era, game_mode, used_squads
  ) values (
    v_uid, v_opponent, v_team, v_group,
    1, v_sport, v_era, v_mode, array[v_team || '|' || v_group]
  ) returning id into v_match_id;

  return jsonb_build_object('status', 'matched', 'match_id', v_match_id);
end;
$$;

-- Backward-compatible two-argument entry point; old clients are Ranked.
create or replace function public.join_queue(p_sport text default 'nba', p_era text default 'all')
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.join_queue(p_sport, p_era, 'ranked');
$$;

-- Advance only after both players act. Roster size and next squad are selected
-- from the current sport + game-mode contract, never from a global constant.
create or replace function public.advance_round_if_ready(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_both_acted boolean;
  v_slots text[];
  v_target integer;
  v_decades text[];
  v_team text;
  v_group text;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if v_match is null then raise exception 'match not found'; end if;

  select roster_slots into v_slots
  from public.online_game_modes
  where sport = v_match.sport and game_mode = v_match.game_mode and matchmaking_enabled;
  if v_slots is null then raise exception 'online mode %/% is not configured', v_match.sport, v_match.game_mode; end if;
  v_target := cardinality(v_slots);

  select
    exists(select 1 from public.match_picks where match_id = p_match_id and side = 'A' and round_number = v_match.round_number)
    and
    exists(select 1 from public.match_picks where match_id = p_match_id and side = 'B' and round_number = v_match.round_number)
  into v_both_acted;
  if not v_both_acted then return; end if;

  if (select count(*) from jsonb_object_keys(v_match.roster_a)) = v_target
     and (select count(*) from jsonb_object_keys(v_match.roster_b)) = v_target then
    update public.matches set status = 'strategy', updated_at = now() where id = p_match_id;
    return;
  end if;

  if v_match.sport = 'nba' then
    v_decades := public.era_decades(v_match.era);
    select s.team, s.decade into v_team, v_group
    from (
      select distinct p.team, p.decade
      from public.players p
      where (v_decades is null or p.decade = any(v_decades))
        and (p.team || '|' || p.decade) <> all(v_match.used_squads)
    ) s order by random() limit 1;

    if v_team is null then
      select s.team, s.decade into v_team, v_group
      from (select distinct p.team, p.decade from public.players p
            where v_decades is null or p.decade = any(v_decades)) s
      order by random() limit 1;
    end if;
  elsif v_match.sport = 'nfl' then
    select s.team, s.era into v_team, v_group
    from (
      select distinct p.team, p.era
      from public.nfl_players p
      where (v_match.era = 'all' or p.era = v_match.era)
        and (p.team || '|' || p.era) <> all(v_match.used_squads)
    ) s order by random() limit 1;

    if v_team is null then
      select s.team, s.era into v_team, v_group
      from (select distinct p.team, p.era from public.nfl_players p
            where v_match.era = 'all' or p.era = v_match.era) s
      order by random() limit 1;
    end if;
  else
    raise exception 'unsupported online sport %', v_match.sport;
  end if;

  if v_team is null then raise exception 'no next squad available'; end if;

  update public.matches set
    current_squad_team = v_team,
    current_squad_decade = v_group,
    used_squads = case
      when (v_team || '|' || v_group) = any(v_match.used_squads) then v_match.used_squads
      else array_append(v_match.used_squads, v_team || '|' || v_group)
    end,
    round_number = v_match.round_number + 1,
    updated_at = now()
  where id = p_match_id;
end;
$$;

-- Server-authoritative pick validation. NBA validates against public.players;
-- NFL validates against public.nfl_players and writes the exact generated
-- payload into the match roster. The browser never supplies trusted stats.
create or replace function public.submit_pick(
  p_match_id uuid,
  p_player_name text,
  p_team text,
  p_decade text,
  p_slot text,
  p_forfeited boolean default false,
  p_season integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_side text;
  v_roster jsonb;
  v_player record;
  v_nfl public.nfl_players%rowtype;
  v_payload jsonb;
  v_slots text[];
  v_base_slot text;
begin
  select public.get_side(p_match_id) into v_side;
  select * into v_match from public.matches where id = p_match_id for update;
  if v_match is null then raise exception 'match not found'; end if;
  if v_match.status <> 'drafting' then raise exception 'match is not drafting'; end if;

  select roster_slots into v_slots
  from public.online_game_modes
  where sport = v_match.sport and game_mode = v_match.game_mode and matchmaking_enabled;
  if v_slots is null or not (p_slot = any(v_slots)) then
    raise exception 'slot % is not valid for %/%', p_slot, v_match.sport, v_match.game_mode;
  end if;

  if p_team <> v_match.current_squad_team or p_decade <> v_match.current_squad_decade then
    raise exception 'player is not part of the currently rolled squad';
  end if;

  if v_match.sport = 'nba' then
    select * into v_player from public.players
      where name = p_player_name and team = p_team and decade = p_decade
        and (p_season is null or season = p_season)
      order by (p_season is not null) desc, ppg desc
      limit 1;
    if v_player is null then raise exception 'unknown player for this squad'; end if;

    if not (p_slot = any(v_player.pos) or p_slot = '6TH' or p_slot like 'BENCH%') then
      raise exception 'player not eligible for slot %', p_slot;
    end if;

    v_payload := jsonb_build_object(
      'name', v_player.name, 'team', v_player.team, 'decade', v_player.decade,
      'season', v_player.season, 'pos', to_jsonb(v_player.pos),
      'ppg', v_player.ppg, 'rpg', v_player.rpg, 'apg', v_player.apg,
      'spg', v_player.spg, 'bpg', v_player.bpg, 'tov', v_player.tov,
      'fga', v_player.fga, 'fgp', v_player.fgp, 'tpa', v_player.tpa,
      'tpp', v_player.tpp, 'fta', v_player.fta, 'ftp', v_player.ftp
    );
  elsif v_match.sport = 'nfl' then
    select * into v_nfl from public.nfl_players
      where name = p_player_name and team = p_team and era = p_decade
        and (p_season is null or season = p_season)
      order by (p_season is not null) desc, season desc
      limit 1;
    if v_nfl.id is null then raise exception 'unknown NFL player or unit for this squad'; end if;

    v_base_slot := regexp_replace(p_slot, '[0-9]+$', '');
    if v_nfl.kind = 'player' then
      if not (v_base_slot = any(v_nfl.pos)) then
        raise exception 'NFL player not eligible for slot %', p_slot;
      end if;
    else
      if v_nfl.unit_group is distinct from p_slot then
        raise exception 'NFL unit % not eligible for slot %', v_nfl.unit_group, p_slot;
      end if;
    end if;

    v_payload := v_nfl.payload || jsonb_build_object('decade', v_nfl.era);
  else
    raise exception 'unsupported online sport %', v_match.sport;
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

  insert into public.match_picks (
    match_id, side, round_number, action, player_name, team, decade, season, slot, forfeited
  ) values (
    p_match_id, v_side, v_match.round_number, 'pick', p_player_name, p_team, p_decade,
    coalesce(p_season, (v_payload->>'season')::integer), p_slot, coalesce(p_forfeited, false)
  );

  v_roster := v_roster || jsonb_build_object(p_slot, v_payload);
  if v_side = 'A' then
    update public.matches set roster_a = v_roster, updated_at = now() where id = p_match_id;
  else
    update public.matches set roster_b = v_roster, updated_at = now() where id = p_match_id;
  end if;

  perform public.advance_round_if_ready(p_match_id);
end;
$$;
