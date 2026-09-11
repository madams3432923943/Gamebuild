-- The private business/product dashboard: who may see it, and the aggregates
-- it reads.
--
-- AUTHORIZATION IS HERE, NOT IN THE PAGE. admin.html is a static file on a
-- static host: anyone can fetch it, read its source, and call whatever it
-- calls. Hiding a navigation link protects nothing. So the dashboard has no
-- data of its own - every number on it comes from one of the two SECURITY
-- DEFINER functions below, each of which asks is_admin() first and raises
-- 42501 otherwise. A normal signed-in player calling them by hand gets the
-- same refusal the page would.
--
-- WHY A SEPARATE TABLE AND NOT profiles.is_admin. `profiles` is publicly
-- readable by design (the "profiles are publicly readable" policy, which the
-- rank ladders depend on). A flag there would publish the list of
-- administrators to every visitor, which is the first thing an attacker wants.
-- admin_users has RLS on with no policies and no grants: only definer code can
-- see inside it, and there is no client path that lists it.
--
-- WHY THE AGGREGATES ARE SQL AND NOT CLIENT CODE. CLAUDE.md: do not download
-- whole tables to compute metrics. Every count below is computed in Postgres
-- against an index and returns as one jsonb document, so the dashboard is one
-- round trip and transfers a few hundred bytes regardless of how many rows are
-- behind it.

-- ---------------------------------------------------------------------------
-- 1. Who is an administrator
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note text not null default ''
);

alter table public.admin_users enable row level security;
revoke all on table public.admin_users from anon, authenticated;

comment on table public.admin_users is
  'Allowlist for the private admin dashboard (admin.html). RLS on with no policies: readable only by SECURITY DEFINER code. Add a row with the service role or the SQL editor - there is deliberately no client path that grants admin.';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users a where a.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 2. The overview
-- ---------------------------------------------------------------------------
-- One document, so the dashboard is one request. Read the comments inside as
-- the definition of each metric - a number on a business dashboard whose
-- derivation is not written down anywhere is a number people argue about.
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  with
  -- ONLINE AND FRIEND GAMES COME FROM THE MATCH TABLES, which are the
  -- authoritative record: one row per finished match, carrying its sport, its
  -- participants and when it finalized.
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
  -- PRACTICE GAMES HAVE NO MATCH ROW AT ALL - they are simulated in the
  -- browser and only ever touched the player's own profile. The completion
  -- event is the only record of one, which is why the event exists. Filtered
  -- to practice so an online game, which also emits game_completed, is not
  -- counted here as well as above.
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
  -- A GAME PER PLAYER rather than per match: an online match is two people's
  -- game. This is what "games per user" divides.
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

    -- Exact, not sampled: one row per player per active day (see
    -- 20260911_02), so these are three counts over a small index.
    'activity', jsonb_build_object(
      'dau', (select count(distinct user_id) from public.active_days where day = current_date),
      'wau', (select count(distinct user_id) from public.active_days where day >= current_date - 6),
      'mau', (select count(distinct user_id) from public.active_days where day >= current_date - 29),
      -- When activity tracking began. Every rate below that depends on it is
      -- meaningless before this date, and saying so is cheaper than having
      -- someone discover it from a suspiciously round number.
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
      -- Games played in the last 30 days divided by monthly actives. Null
      -- rather than zero when there are no actives: "no data" and "nobody
      -- plays" are different answers and dividing by zero says neither.
      'games_per_active_user', (
        select case when mau = 0 then null else round(recent::numeric / mau, 2) end
          from (select (select count(*) from player_games where at >= current_date - 29) as recent,
                       (select count(distinct user_id) from public.active_days where day >= current_date - 29) as mau) x
      ),
      'accounts_with_no_completed_game', (
        select count(*) from public.profiles p
         where not exists (select 1 from players_with_a_game g where g.uid = p.id)
      ),
      -- Share of all accounts that have finished at least one game. The
      -- headline onboarding-quality number: an account that never finished a
      -- game never saw what this product is.
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

-- ---------------------------------------------------------------------------
-- 3. The funnel, and retention
-- ---------------------------------------------------------------------------
-- Distinct users per funnel event over a window. Distinct USERS, not events:
-- "how many people got this far" is the question a funnel answers, and an
-- event count would let one player who drafted nine times look like nine.
create or replace function public.admin_funnel(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'days', v_days,
    'events', (
      select coalesce(jsonb_object_agg(t.event, jsonb_build_object('users', coalesce(c.users, 0), 'count', coalesce(c.n, 0))), '{}'::jsonb)
        from public.analytics_event_types t
        left join (
          select event, count(distinct user_id) as users, count(*) as n
            from public.analytics_events
           where created_at >= current_date - (v_days - 1)
           group by event
        ) c on c.event = t.event
    ),
    -- RETENTION, COMPUTED ONLY WHERE IT CAN BE. A cohort needs signups that
    -- happened AFTER active-day tracking started (otherwise "did not come
    -- back" and "was not being recorded" are indistinguishable) and long
    -- enough ago for the return window to have closed. Both cohorts return
    -- null when they are empty rather than a reassuring 0%.
    'retention', (
      select jsonb_build_object(
        'tracking_since', tracking_since,
        'day_1', case when d1_cohort = 0 then null
                 else jsonb_build_object('cohort', d1_cohort, 'retained', d1_back,
                                         'rate', round(d1_back::numeric / d1_cohort, 4)) end,
        'day_7', case when d7_cohort = 0 then null
                 else jsonb_build_object('cohort', d7_cohort, 'retained', d7_back,
                                         'rate', round(d7_back::numeric / d7_cohort, 4)) end
      )
      from (
        select
          (select min(day) from public.active_days) as tracking_since,
          (select count(*) from public.profiles p
            where p.created_at::date >= (select min(day) from public.active_days)
              and p.created_at::date <= current_date - 1) as d1_cohort,
          (select count(*) from public.profiles p
            where p.created_at::date >= (select min(day) from public.active_days)
              and p.created_at::date <= current_date - 1
              and exists (select 1 from public.active_days a
                           where a.user_id = p.id and a.day = p.created_at::date + 1)) as d1_back,
          (select count(*) from public.profiles p
            where p.created_at::date >= (select min(day) from public.active_days)
              and p.created_at::date <= current_date - 7) as d7_cohort,
          (select count(*) from public.profiles p
            where p.created_at::date >= (select min(day) from public.active_days)
              and p.created_at::date <= current_date - 7
              and exists (select 1 from public.active_days a
                           where a.user_id = p.id and a.day = p.created_at::date + 7)) as d7_back
      ) r
    )
  ) into v_result;

  return v_result;
end;
$$;

-- The grant manifest, per 20260819_01: every definer function added has to be
-- granted deliberately or left unreachable deliberately. is_admin() is granted
-- so the dashboard can ask "am I allowed in" and show a refusal instead of a
-- broken screen; it reveals only the caller's own status.
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.admin_overview() from public, anon, authenticated;
revoke all on function public.admin_funnel(integer) from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_funnel(integer) to authenticated;
