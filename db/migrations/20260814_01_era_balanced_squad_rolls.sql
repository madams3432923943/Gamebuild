-- Every online draft round rolls its era from a balanced rotation instead of
-- an independent weighted coin flip.
--
-- Reported from a live NFL ranked game: seven straight 2000s squads. Football
-- has three eras (2000s/2010s/2020s), so with independent per-round draws a
-- run like that is rare per round and routine across a session - and there was
-- no mechanism at all making the OTHER two eras show up. "All Years" is sold
-- as a test across the whole history; it has to actually deal the whole
-- history.
--
-- The rule, matching js/draft.js's pickNextEra exactly (see the long comment
-- there for the reasoning): an era does not come up a second time until every
-- era that still has an unused squad has come up once. Which era leads a cycle
-- is random, weighted by how many squads it has, so the ORDER stays
-- unpredictable while the COVERAGE is guaranteed. Longest possible run of one
-- era is two - the tail of one cycle into the head of the next.
--
-- Selection lived inline in three functions (advance_round_if_ready,
-- join_queue, challenge_friend), each a copy of the same NBA/NFL branch. It is
-- one function now, so the rule cannot drift between "the squad you start on"
-- and "the squads you get after that".

-- ---------------------------------------------------------------------------

-- One draft squad for a sport + era, given the squads this match has already
-- used. NBA reads public.players keyed by decade, NFL public.nfl_players keyed
-- by era; both are returned under the neutral (out_team, out_era) shape the
-- matches table stores as current_squad_team / current_squad_decade.
--
-- Returns no row only when the sport/era has no squads at all - an exhausted
-- era falls back to re-rolling a used squad rather than stalling the match,
-- which is the pre-existing behaviour for a draft longer than its era's pool.
create or replace function public.next_draft_squad(
  p_sport text,
  p_era text,
  p_used_squads text[]
)
returns table (out_team text, out_era text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_sport text := coalesce(nullif(trim(p_sport), ''), 'nba');
  v_era text := coalesce(nullif(trim(p_era), ''), 'all');
  v_used text[] := coalesce(p_used_squads, array[]::text[]);
  v_decades text[];
begin
  if v_sport = 'nba' then
    v_decades := public.era_decades(v_era);
  elsif v_sport <> 'nfl' then
    raise exception 'unsupported online sport %', v_sport;
  end if;

  return query
  with pool as (
    select distinct p.team as t, p.decade as e
    from public.players p
    where v_sport = 'nba' and (v_decades is null or p.decade = any(v_decades))
    union all
    select distinct p.team as t, p.era as e
    from public.nfl_players p
    where v_sport = 'nfl' and (v_era = 'all' or p.era = v_era)
  ),
  fresh as (
    select t, e from pool where (t || '|' || e) <> all (v_used)
  ),
  -- Every unused squad, or - once the era's pool is spent - the whole pool
  -- again. The era balance below applies either way.
  candidates as (
    select t, e from fresh
    union all
    select t, e from pool where not exists (select 1 from fresh)
  ),
  -- Rounds already spent on each era this match. used_squads entries are
  -- 'Team|Era', the same id js/draft.js builds.
  spent as (
    select split_part(u, '|', 2) as e, count(*)::int as n
    from unnest(v_used) as u
    group by 1
  ),
  eras as (
    select c.e, count(*)::int as squads, coalesce(max(s.n), 0) as used
    from candidates c
    left join spent s on s.e = c.e
    group by c.e
  ),
  -- Least-used era first; ties broken by a weighted random draw
  -- (Efraimidis-Spirakis), sqrt-weighted by squad count so a thin era leads a
  -- cycle less often than a deep one without ever being skipped.
  chosen as (
    select e from eras
    order by used asc, power(random(), 1.0 / sqrt(squads::double precision)) desc
    limit 1
  )
  select c.t, c.e
  from candidates c
  join chosen ch on ch.e = c.e
  order by random()
  limit 1;
end;
$$;

-- Internal to the three RPCs below, which are SECURITY DEFINER and therefore
-- call it as the owner. No browser role needs it, so no browser role gets it.
revoke all on function public.next_draft_squad(text, text, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The three callers, unchanged except that squad selection is delegated.
-- ---------------------------------------------------------------------------

-- Body as in 20260811_01_online_sport_mode_matchmaking.sql; only the inline
-- per-sport squad query is replaced.
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

  select s.out_team, s.out_era into v_team, v_group
  from public.next_draft_squad(v_match.sport, v_match.era, v_match.used_squads) s;

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

-- Body as in 20260811_01_online_sport_mode_matchmaking.sql; only the inline
-- per-sport squad query is replaced. Round 1 has no history, so the balanced
-- roll reduces to the weighted random draw it already was.
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

  select s.out_team, s.out_era into v_team, v_group
  from public.next_draft_squad(v_sport, v_era, array[]::text[]) s;

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

-- Body as in 20260812_01_sport_aware_challenges.sql; only the inline per-sport
-- squad query is replaced. Friendlies draft exactly like ranked.
create or replace function public.challenge_friend(
  p_friend_id uuid,
  p_sport text default 'nba',
  p_era text default 'all'
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_match_id uuid;
  v_match_updated timestamptz;
  v_sport text := coalesce(nullif(trim(p_sport), ''), 'nba');
  v_era text := coalesce(nullif(trim(p_era), ''), 'all');
  v_mode constant text := 'ranked';
  v_team text;
  v_group text;
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

  if not exists (
    select 1 from public.online_game_modes
    where sport = v_sport and game_mode = v_mode and matchmaking_enabled
  ) then
    raise exception 'online mode %/% is not enabled', v_sport, v_mode;
  end if;

  select id, updated_at into v_match_id, v_match_updated from public.matches
    where status <> 'complete' and sport = v_sport and era = v_era
      and ((player_a = v_uid and player_b = p_friend_id)
        or (player_a = p_friend_id and player_b = v_uid))
    order by created_at desc limit 1;
  if v_match_id is not null then
    if v_match_updated > now() - interval '15 minutes' then
      return v_match_id;
    end if;
    delete from public.matches where id = v_match_id;
  end if;

  select s.out_team, s.out_era into v_team, v_group
  from public.next_draft_squad(v_sport, v_era, array[]::text[]) s;

  if v_team is null then
    raise exception 'no draft squads available for %/%', v_sport, v_era;
  end if;

  insert into public.matches (
    player_a, player_b, current_squad_team, current_squad_decade,
    round_number, is_friendly, sport, era, game_mode, used_squads
  ) values (
    v_uid, p_friend_id, v_team, v_group,
    1, true, v_sport, v_era, v_mode, array[v_team || '|' || v_group]
  ) returning id into v_match_id;

  return v_match_id;
end;
$function$;
