-- Friendly challenges pick a squad from the RIGHT SPORT, and the legacy
-- matchmaking overloads stop being a way around sport scoping.
--
-- ---------------------------------------------------------------------------
-- 1. challenge_friend never learned about football
-- ---------------------------------------------------------------------------
--
-- 20260811_01 taught join_queue that a draft squad comes from the sport's own
-- pool - NBA from public.players keyed by decade, NFL from public.nfl_players
-- keyed by era. challenge_friend was not given the same branch, and it seeds a
-- match with:
--
--     from public.players p order by random() limit 1
--
-- regardless of what sport was asked for. So challenging a friend to a game of
-- football produced a match whose current squad was a BASKETBALL team, and
-- submit_pick then rejected every football pick with "player is not part of
-- the currently rolled squad" - because it genuinely was not. NFL friendly
-- matches could be created and could never be drafted.
--
-- It is reachable from the product: js/screens/squads.js passes the app's
-- active sport straight through, so the Challenge button on the friends list
-- does this whenever football is the selected sport.
--
-- The squad selection below is the same logic join_queue uses, deliberately
-- written the same way round so the two can be read against each other. It
-- also sets game_mode and used_squads, which challenge_friend was not setting
-- at all: game_mode fell to its column default and used_squads stayed empty,
-- so the opening squad could be rolled again later in the same draft.
--
-- ---------------------------------------------------------------------------
-- 2. The legacy overloads are a hole in the scoping
-- ---------------------------------------------------------------------------
--
-- Both functions accumulated overloads as sport, then era, then game mode were
-- added, and every older one is still callable. PostgREST resolves an RPC by
-- its exact ARGUMENT NAMES, so which body runs is decided by which keys the
-- browser happens to send:
--
--   join_queue()                     matches ANY queued user, ignoring sport
--                                    entirely - an NBA player could be paired
--                                    with an NFL one
--   join_queue(p_sport)              ignores era and game mode, and seeds the
--                                    squad from public.players whatever the
--                                    sport
--   challenge_friend(p_friend_id)    same, for challenges
--   challenge_friend(p_friend_id, p_sport)
--
-- That is not hypothetical. index.html versions js/main.js with the commit
-- (`main.js?v=<sha>`) but its imports are plain relative paths, so a browser
-- can hold a CACHED js/online.js next to a fresh main.js - and an older
-- online.js sends an older argument set.
--
-- They are rewritten to delegate rather than dropped. Dropping them turns a
-- stale tab into a hard "function not found"; delegating makes that same tab
-- behave correctly. Nothing here relaxes a check - every path now goes through
-- the one body that enforces sport, era and mode.

-- ---------------------------------------------------------------------------

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
  v_decades text[];
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

  -- The sport has to be one this server can actually run a draft for. Without
  -- this a typo'd sport reaches the squad selection below, finds nothing, and
  -- fails with a confusing "no draft squads" instead of an honest rejection.
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

  -- THE SPORT'S OWN POOL. This is the whole fix; everything else here is the
  -- function as it was.
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

-- ---- the legacy overloads, narrowed to delegate ---------------------------

create or replace function public.challenge_friend(p_friend_id uuid)
returns uuid
language sql
security definer
set search_path to 'public'
as $function$
  select public.challenge_friend(p_friend_id, 'nba', 'all');
$function$;

create or replace function public.challenge_friend(p_friend_id uuid, p_sport text default 'nba')
returns uuid
language sql
security definer
set search_path to 'public'
as $function$
  select public.challenge_friend(p_friend_id, coalesce(p_sport, 'nba'), 'all');
$function$;

create or replace function public.join_queue()
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  select public.join_queue('nba', 'all', 'ranked');
$function$;

create or replace function public.join_queue(p_sport text default 'nba')
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  select public.join_queue(coalesce(p_sport, 'nba'), 'all', 'ranked');
$function$;

-- Same grant posture as the functions they delegate to: a signed-in player,
-- and nobody else. SECURITY DEFINER means this is the only door.
revoke all on function public.challenge_friend(uuid) from public, anon;
revoke all on function public.challenge_friend(uuid, text) from public, anon;
revoke all on function public.challenge_friend(uuid, text, text) from public, anon;
revoke all on function public.join_queue() from public, anon;
revoke all on function public.join_queue(text) from public, anon;

grant execute on function public.challenge_friend(uuid) to authenticated;
grant execute on function public.challenge_friend(uuid, text) to authenticated;
grant execute on function public.challenge_friend(uuid, text, text) to authenticated;
grant execute on function public.join_queue() to authenticated;
grant execute on function public.join_queue(text) to authenticated;
