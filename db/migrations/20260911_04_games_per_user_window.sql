-- Fix: games-per-active-user divided two different time windows.
--
-- FOUND BY RUNNING IT. The first read of admin_overview() on real data
-- returned 67.00 games per active user against 18 accounts. The arithmetic was
-- correct and the metric was nonsense: the numerator counted player-games over
-- the last 30 days - two months of real match history - and the denominator
-- counted monthly actives out of an active_days table that was one day old,
-- because active-day tracking had just been introduced in 20260911_02. One day
-- of denominator under thirty days of numerator.
--
-- This is exactly the failure the brief called out: a metric that cannot
-- currently be calculated correctly must not be presented as though it can.
-- The honest fix is to measure both halves over the SAME window, and to say
-- how long that window actually is:
--
--   window starts at the later of (30 days ago, the first recorded active day)
--   numerator   player-games inside it
--   denominator distinct players active inside it
--   days        the width of the window, reported alongside the number
--
-- As tracking history accumulates the window widens to the full 30 days on its
-- own and the metric becomes the thing it was always meant to be. Until then it
-- is a true statement about a shorter period, labelled with that period, rather
-- than a false statement about a month. Null when there is no window at all.
--
-- Nothing else in admin_overview() changes; the whole body is re-issued because
-- `create or replace function` is all-or-nothing.

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  -- The earliest date any rate involving active_days can honestly reach back
  -- to. Null until the first active day is recorded.
  v_window_start date := greatest(current_date - 29, (select min(day) from public.active_days));
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  with
  online as (
    select coalesce(r.finalized_at, r.created_at) as at,
           m.sport,
           case when m.is_friendly then 'friend' else 'ranked' end as mode,
           null::text as difficulty,
           m.player_a,
           m.player_b
      from public.match_results r
      join public.matches m on m.id = r.match_id
  ),
  practice as (
    select e.created_at as at,
           case when e.props->>'sport' in ('nba','nfl') then e.props->>'sport' else 'unknown' end as sport,
           'practice'::text as mode,
           case when e.props->>'difficulty' in ('easy','medium','hard') then e.props->>'difficulty' else null end as difficulty,
           e.user_id as player_a,
           null::uuid as player_b
      from public.analytics_events e
     where e.event = 'game_completed'
       and coalesce(e.props->>'mode', 'practice') = 'practice'
  ),
  games as (
    select at, sport, mode, difficulty from online
    union all
    select at, sport, mode, difficulty from practice
  ),
  player_games as (
    select player_a as uid, at from online where player_a is not null
    union all
    select player_b as uid, at from online where player_b is not null
    union all
    select player_a as uid, at from practice where player_a is not null
  ),
  players_with_a_game as (
    select distinct uid from player_games
  )
  select jsonb_build_object(
    'generated_at', now(),

    'users', jsonb_build_object(
      'total',      (select count(*) from public.profiles),
      'today',      (select count(*) from public.profiles where created_at >= current_date),
      'this_week',  (select count(*) from public.profiles where created_at >= current_date - 6),
      'this_month', (select count(*) from public.profiles where created_at >= current_date - 29)
    ),

    'activity', jsonb_build_object(
      'dau', (select count(distinct user_id) from public.active_days where day = current_date),
      'wau', (select count(distinct user_id) from public.active_days where day >= current_date - 6),
      'mau', (select count(distinct user_id) from public.active_days where day >= current_date - 29),
      'tracking_since', (select min(day) from public.active_days)
    ),

    'games', jsonb_build_object(
      'today',      (select count(*) from games where at >= current_date),
      'this_week',  (select count(*) from games where at >= current_date - 6),
      'this_month', (select count(*) from games where at >= current_date - 29),
      'total',      (select count(*) from games)
    ),

    'by_sport', (
      select coalesce(jsonb_object_agg(sport, n), '{}'::jsonb)
        from (select sport, count(*) as n from games group by sport) s
    ),

    'by_mode', (
      select coalesce(jsonb_object_agg(mode, n), '{}'::jsonb)
        from (select mode, count(*) as n from games group by mode) s
    ),

    'by_difficulty', (
      select coalesce(jsonb_object_agg(difficulty, n), '{}'::jsonb)
        from (select difficulty, count(*) as n from games
               where mode = 'practice' and difficulty is not null
               group by difficulty) s
    ),

    'engagement', jsonb_build_object(
      -- BOTH HALVES OVER v_window_start. See the header: this is the fix.
      'games_per_active_user', (
        select case when v_window_start is null or actives = 0
                    then null
                    else round(played::numeric / actives, 2) end
          from (select (select count(*) from player_games where at >= v_window_start) as played,
                       (select count(distinct user_id) from public.active_days
                         where v_window_start is not null and day >= v_window_start) as actives) x
      ),
      -- The width of that window, so the dashboard can label the number
      -- instead of implying it covers a month it does not yet cover.
      'games_per_active_user_days',
        case when v_window_start is null then null else (current_date - v_window_start) + 1 end,

      'accounts_with_no_completed_game', (
        select count(*) from public.profiles p
         where not exists (select 1 from players_with_a_game g where g.uid = p.id)
      ),
      'first_game_completion_rate', (
        select case when total = 0 then null else round(played::numeric / total, 4) end
          from (select (select count(*) from public.profiles) as total,
                       (select count(*) from public.profiles p
                         where exists (select 1 from players_with_a_game g where g.uid = p.id)) as played) x
      )
    )
  ) into v_result;

  return v_result;
end;
$$;

-- Re-granted: `create or replace function` keeps existing grants, but stating
-- it costs nothing and 20260819_01 exists because this is exactly the thing
-- that silently comes undone.
revoke all on function public.admin_overview() from public, anon, authenticated;
grant execute on function public.admin_overview() to authenticated;
