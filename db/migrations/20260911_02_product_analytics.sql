-- First-party product analytics: the funnel actions the production tables
-- cannot answer, and one row per player per active day.
--
-- WHAT THIS DELIBERATELY DOES NOT STORE. Everything already recorded
-- authoritatively stays where it is and is read from there:
--
--   online games   matches + match_results carry sport, game_mode, both
--                  participants and the timestamps. Counting them a second
--                  time here would be two numbers that can disagree.
--   accounts       profiles.created_at is the signup date.
--   rank/records   profiles, written server-side.
--
-- So the events below are only the things NO table records: the steps of the
-- funnel that happen before a match row exists (a sport chosen, a mode chosen,
-- a draft started), and practice games - which are offline, have no match row
-- at all, and are the majority of games played. `game_completed` carries
-- `mode`, and the admin aggregates union only the practice ones in with
-- matches, so an online game is never counted twice.
--
-- PRIVACY. auth.uid() and nothing else identifies the row. `props` is filtered
-- against an explicit key allowlist by sanitize_event_props() below, so a
-- client that sends an email address, a token or a chat message stores none of
-- it - the filtering is server-side because client-side validation is never
-- sufficient by itself.
--
-- VOLUME. Roughly a dozen events per game played, plus one active_days row per
-- player per day. There is no page-view event and no per-render event on
-- purpose: an impression is throttled client-side to one per placement view
-- (js/ads/placements.js) and capped per user per hour below.

-- ---------------------------------------------------------------------------
-- 1. The event allowlist
-- ---------------------------------------------------------------------------
-- A table rather than an array inside the function: adding an event is then
-- one insert instead of re-issuing a function body, and the set of things this
-- app measures is legible to anyone with a SQL prompt. An event name that is
-- not in here is rejected, so a typo in client code fails loudly at the point
-- it was introduced rather than silently creating a metric nobody can find.
create table if not exists public.analytics_event_types (
  event text primary key,
  description text not null default ''
);

alter table public.analytics_event_types enable row level security;
revoke all on table public.analytics_event_types from anon, authenticated;

insert into public.analytics_event_types (event, description) values
  ('signup_completed',            'Account created and the app entered for the first time.'),
  ('onboarding_viewed',           'First-run welcome modal shown.'),
  ('onboarding_completed',        'First-run welcome modal finished via Start Playing.'),
  ('sport_selected',              'A sport chosen from the home screen.'),
  ('mode_selected',              'Practice or Online Ranked chosen on the Play screen.'),
  ('practice_difficulty_selected','Easy/Medium/Hard chosen for a practice game.'),
  ('draft_started',               'A draft began (any mode).'),
  ('draft_completed',             'Every roster slot filled.'),
  ('simulation_started',          'The simulation began playing out.'),
  ('game_completed',              'A finished game, from the final screen. props.mode says which.'),
  ('ranked_queue_joined',         'Matchmaking search started.'),
  ('ranked_match_found',          'Matchmaking paired this player with an opponent.'),
  ('ranked_game_completed',       'A ranked game finished.'),
  ('friend_added',                'A friend request accepted.'),
  ('friend_challenge_sent',       'A friend challenged to a match.'),
  ('friend_game_completed',       'A friend match finished.'),
  ('sponsor_impression',          'A sponsor placement actually came into view.'),
  ('sponsor_click',               'A sponsor placement clicked through.'),
  ('share_card_created',          'A postgame share card was generated.'),
  ('share_card_shared',           'A share card was saved or handed to the OS share sheet.')
on conflict (event) do update set description = excluded.description;

-- ---------------------------------------------------------------------------
-- 2. Events
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  -- Nullable so a deleted account's history aggregates correctly rather than
  -- vanishing: delete_own_account() removes the auth user, and counting
  -- yesterday's games must not change because somebody left today.
  user_id uuid references auth.users(id) on delete set null,
  event text not null references public.analytics_event_types(event),
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The three shapes every aggregate below reads in: one event over a window,
-- everything over a window, and one user's trail (which is also the rate-limit
-- lookup on the write path).
create index if not exists analytics_events_event_time_idx
  on public.analytics_events (event, created_at desc);
create index if not exists analytics_events_time_idx
  on public.analytics_events (created_at desc);
create index if not exists analytics_events_user_time_idx
  on public.analytics_events (user_id, created_at desc);

-- No policies, on purpose. Writes go through track_event() and reads through
-- the admin aggregates; a player has no reason to read anyone's event trail,
-- including their own, and RLS with no policy is how that is said.
alter table public.analytics_events enable row level security;
revoke all on table public.analytics_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Active days - the whole of DAU/WAU/MAU
-- ---------------------------------------------------------------------------
-- One row per player per calendar day they opened the app. DAU/WAU/MAU are
-- then three counts over an integer-sized table, rather than a distinct-user
-- scan over every event ever recorded. At a million players this is a million
-- rows a year of two columns; the events table would be that per week.
create table if not exists public.active_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);

create index if not exists active_days_day_idx on public.active_days (day);

alter table public.active_days enable row level security;
revoke all on table public.active_days from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The write path
-- ---------------------------------------------------------------------------
-- Only these keys survive, and only as scalars. A payload is a fact about a
-- game, not a place to put free text: there is no key here that could carry an
-- email address, a password, a token or a message, so none can be stored by
-- accident or on purpose.
create or replace function public.sanitize_event_props(p_props jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(
      key,
      case
        when jsonb_typeof(value) = 'string' then to_jsonb(left(value #>> '{}', 64))
        else value
      end
    ),
    '{}'::jsonb
  )
  from jsonb_each(coalesce(p_props, '{}'::jsonb))
  where key in (
          'sport', 'mode', 'difficulty', 'era', 'won', 'margin',
          'placement', 'campaign', 'format', 'source', 'step', 'seconds'
        )
    and jsonb_typeof(value) in ('string', 'number', 'boolean');
$$;

-- Records one event for the signed-in user. Returns nothing and raises only on
-- an unknown event name - a metric that was never declared is a bug in the
-- caller, and the honest place to fail is here.
--
-- OVER BUDGET IS A SILENT DROP, NOT AN ERROR. Analytics must never be the
-- reason a game stops working, so a client spraying events loses the surplus
-- and keeps playing. 600/hour is about ten games' worth of funnel with room to
-- spare; a real player never approaches it.
create or replace function public.track_event(p_event text, p_props jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_recent integer;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.analytics_event_types t where t.event = p_event) then
    raise exception 'Unknown analytics event: %', p_event using errcode = 'P0001';
  end if;

  select count(*) into v_recent
    from public.analytics_events e
   where e.user_id = v_uid
     and e.created_at > now() - interval '1 hour';
  if v_recent >= 600 then
    return;
  end if;

  insert into public.analytics_events (user_id, event, props)
  values (v_uid, p_event, public.sanitize_event_props(p_props));
end;
$$;

-- Marks today as an active day for the signed-in user. Idempotent by primary
-- key, so the client may call it on every app entry without checking first.
create or replace function public.touch_active_day()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;
  insert into public.active_days (user_id, day)
  values (v_uid, current_date)
  on conflict (user_id, day) do nothing;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function; 20260819_01
-- explains why that has to be undone by hand each time. Both of these are
-- meant to be reachable by a signed-in browser and by nothing else.
revoke all on function public.sanitize_event_props(jsonb) from public, anon, authenticated;
revoke all on function public.track_event(text, jsonb) from public, anon, authenticated;
revoke all on function public.touch_active_day() from public, anon, authenticated;
grant execute on function public.track_event(text, jsonb) to authenticated;
grant execute on function public.touch_active_day() to authenticated;
