-- Funnel events, guest funnel events, first-visit source, internal accounts.
--
-- WHY. Until now the only thing recorded about a practice game was that it
-- finished. "Where do people stop?" had no answer: not how many drafts were
-- started and left, not how many picks the clock made for someone, not how
-- many people saw a result, shared it, or tapped Play Again - and nothing at
-- all about where a player first came from. Section G of the October UX pass
-- (docs/ux-pass-2026-10.md) asked for exactly that, tagged guest vs signed-in
-- and phone vs desktop, with QA accounts left out.
--
-- THREE POPULATIONS, KEPT APART ON PURPOSE.
--
--   * Signed-in players go where they always went: analytics_events, through
--     track_event(). Six new event names, one new prop (`device`).
--   * Guests go to a NEW table, guest_funnel_events, through
--     record_guest_event(). CLAUDE.md is explicit that a guest is in no user
--     metric - never profiles, analytics_events or active_days - and that is
--     kept by construction, exactly as guest_games keeps it (see that file's
--     header for why a shared "GUEST" profile was rejected). A guest's events
--     are joined to the account they become through the same claim token:
--     claim_guest_games() now stamps both tables.
--   * QA accounts (GROKBOT and anything else flagged) are dropped at
--     track_event(), so they never enter analytics_events at all. A QA bot
--     playing as a guest cannot be told apart from a person and is not
--     excluded - there is nothing to key it on.
--
-- FIRST-VISIT SOURCE. The browser keeps its first landing's UTM tags and
-- referrer HOST (never the full referrer URL - it can carry a search query or
-- a token) until an account exists, then calls set_first_visit_source() once.
-- First write wins: the function never overwrites a recorded source. It lives
-- in a closed table of its own, not on the public profiles row.
--
-- Client code tolerates every function here being missing (a server that has
-- not caught up): each call logs once and the game is unaffected.

-- ---------------------------------------------------------------------------
-- Internal accounts
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_internal boolean not null default false;

comment on column public.profiles.is_internal is
  'QA and bot accounts. Their analytics events are dropped by track_event().';

update public.profiles set is_internal = true where lower(username) = 'grokbot';

-- ---------------------------------------------------------------------------
-- Signed-in funnel: new event names and the device prop
-- ---------------------------------------------------------------------------

insert into public.analytics_event_types (event, description) values
  ('pick_made',       'A draft pick landed. props.step is the pick number, props.source is manual, auto (the clock) or forfeit.'),
  ('draft_abandoned', 'Left the draft board, or the strategy steps after it, before the game was played.'),
  ('results_viewed',  'The final result screen was shown.'),
  ('share_tapped',    'Share Result was tapped on the result screen.'),
  ('play_again',      'Play Again was tapped on the result screen.'),
  ('signup_started',  'The Create Account form was opened. props.source says from where.')
on conflict (event) do nothing;

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
          'placement', 'campaign', 'format', 'source', 'step', 'seconds',
          'device'
        )
    and jsonb_typeof(value) in ('string', 'number', 'boolean');
$$;

-- Re-issued whole (a function body cannot be patched) with one addition: an
-- internal account's events are dropped silently, the same way an over-budget
-- event is - analytics never fails a game.
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

  if exists (select 1 from public.profiles p where p.id = v_uid and p.is_internal) then
    return;
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

-- ---------------------------------------------------------------------------
-- Guest funnel
-- ---------------------------------------------------------------------------

create table if not exists public.guest_funnel_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  -- Enumerated rather than joined to analytics_event_types: these are the
  -- events a guest can produce, and a guest cannot produce most of the others
  -- (ranked, friends, sponsors seen by an account).
  event text not null check (event in (
    'draft_started', 'pick_made', 'draft_abandoned', 'draft_completed',
    'results_viewed', 'share_tapped', 'play_again', 'signup_started'
  )),
  sport text check (sport is null or sport in ('nba', 'nfl')),
  device text not null check (device in ('phone', 'desktop')),
  step integer check (step is null or step between 0 and 99),
  source text check (source is null or source ~ '^[a-z0-9_-]{1,24}$'),
  -- Same token, same hashing, same meaning as guest_games.claim_hash.
  claim_hash text not null check (claim_hash ~ '^[0-9a-f]{64}$'),
  source_hash text check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$'),
  converted_to uuid references auth.users(id) on delete set null,
  converted_at timestamptz
);

create index if not exists guest_funnel_events_time_idx on public.guest_funnel_events (created_at desc);
create index if not exists guest_funnel_events_event_time_idx on public.guest_funnel_events (event, created_at desc);
create index if not exists guest_funnel_events_unclaimed_idx on public.guest_funnel_events (claim_hash) where converted_to is null;
create index if not exists guest_funnel_events_source_idx on public.guest_funnel_events (source_hash, created_at desc) where source_hash is not null;

alter table public.guest_funnel_events enable row level security;
revoke all on public.guest_funnel_events from public, anon, authenticated;
revoke all on sequence public.guest_funnel_events_id_seq from public, anon, authenticated;

-- The only way a row gets in. Validates every field; rate-limited per browser,
-- per address and globally, because an unauthenticated insert behind a public
-- domain is otherwise a free write for a script. Over budget is a SILENT drop,
-- like track_event: a funnel event is never worth an error in a guest's game.
create or replace function public.record_guest_event(
  p_event text,
  p_sport text,
  p_device text,
  p_step integer,
  p_source text,
  p_claim_token text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_hash text;
  v_source text;
  v_source_hash text;
begin
  if auth.uid() is not null then
    raise exception 'Signed-in events go to track_event.' using errcode = '42501';
  end if;
  if p_claim_token is null or p_claim_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'Invalid claim token.' using errcode = '22023';
  end if;
  v_claim_hash := encode(sha256(convert_to(p_claim_token, 'UTF8')), 'hex');

  begin
    v_source := split_part(
      coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
  exception when others then
    v_source := '';
  end;
  v_source := trim(v_source);
  if v_source <> '' then
    v_source_hash := encode(sha256(convert_to(v_source, 'UTF8')), 'hex');
  end if;

  -- A whole game is about twenty events (a start, ten to twelve picks, the
  -- result, a share, a replay), so 300 an hour is fifteen games.
  if (select count(*) from public.guest_funnel_events
       where claim_hash = v_claim_hash and created_at > now() - interval '1 hour') >= 300 then
    return;
  end if;
  if v_source_hash is not null and (select count(*) from public.guest_funnel_events
       where source_hash = v_source_hash and created_at > now() - interval '1 hour') >= 600 then
    return;
  end if;
  if (select count(*) from public.guest_funnel_events where created_at > now() - interval '1 hour') >= 30000 then
    return;
  end if;

  -- The table's checks reject anything malformed with a constraint error,
  -- which is what a client sending an unknown event deserves to see.
  insert into public.guest_funnel_events (event, sport, device, step, source, claim_hash, source_hash)
  values (p_event, p_sport, p_device, p_step, p_source, v_claim_hash, v_source_hash);
end;
$$;

revoke all on function public.record_guest_event(text, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.record_guest_event(text, text, text, integer, text, text) to anon;

-- Re-issued whole with one addition: a browser's funnel events are stamped
-- with the account it became, alongside its games. Still returns the number of
-- GAMES claimed - the client reads it as that.
create or replace function public.claim_guest_games(p_claim_token text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_claimed integer;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_claim_token is null or p_claim_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'Invalid claim token.' using errcode = '22023';
  end if;

  perform public.enforce_rate_limit(
    'claim_guest_games', 10, interval '1 hour',
    'Too many attempts to claim guest games. Try again later.'
  );

  v_hash := encode(sha256(convert_to(p_claim_token, 'UTF8')), 'hex');

  update public.guest_games
     set converted_to = v_uid,
         converted_at = now()
   where claim_hash = v_hash
     and converted_to is null
     and created_at > now() - interval '30 days';
  get diagnostics v_claimed = row_count;

  update public.guest_funnel_events
     set converted_to = v_uid,
         converted_at = now()
   where claim_hash = v_hash
     and converted_to is null
     and created_at > now() - interval '30 days';

  return v_claimed;
end;
$$;

revoke all on function public.claim_guest_games(text) from public, anon, authenticated;
grant execute on function public.claim_guest_games(text) to authenticated;

-- ---------------------------------------------------------------------------
-- First-visit source
-- ---------------------------------------------------------------------------

-- ITS OWN TABLE, NOT PROFILE COLUMNS. `profiles` is publicly readable (friend
-- search, the rank population and squads all read it directly), and where
-- somebody came from is nobody else's business. Closed like guest_games: RLS
-- on, no policies, no grants; written only by set_first_visit_source() and read
-- only by admin_funnel().
create table if not exists public.account_first_source (
  user_id uuid primary key references auth.users(id) on delete cascade,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer_host text,
  landing_path text,
  first_seen_at timestamptz not null,
  recorded_at timestamptz not null default now()
);

alter table public.account_first_source enable row level security;
revoke all on public.account_first_source from public, anon, authenticated;

-- First write wins and nothing overwrites it, so a client retrying, or a
-- second device signing in later, cannot change where this account came from.
-- Returns true when this call recorded the source, false when one was already
-- there. Short, shape-checked strings only.
create or replace function public.set_first_visit_source(
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text,
  p_referrer_host text,
  p_landing_path text,
  p_first_seen_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_updated integer;
  clean text[];
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  -- UTM values are free text set by whoever built the link, so they are capped
  -- and restricted to a URL-ish alphabet rather than trusted.
  clean := array[
    nullif(left(regexp_replace(coalesce(p_utm_source, ''),   '[^A-Za-z0-9_.+-]', '', 'g'), 64), ''),
    nullif(left(regexp_replace(coalesce(p_utm_medium, ''),   '[^A-Za-z0-9_.+-]', '', 'g'), 64), ''),
    nullif(left(regexp_replace(coalesce(p_utm_campaign, ''), '[^A-Za-z0-9_.+-]', '', 'g'), 64), ''),
    nullif(left(lower(regexp_replace(coalesce(p_referrer_host, ''), '[^A-Za-z0-9.-]', '', 'g')), 253), ''),
    nullif(left(regexp_replace(coalesce(p_landing_path, ''), '[^A-Za-z0-9_./-]', '', 'g'), 128), '')
  ];

  insert into public.account_first_source
    (user_id, utm_source, utm_medium, utm_campaign, referrer_host, landing_path, first_seen_at)
  values
    (v_uid, clean[1], clean[2], clean[3], clean[4], clean[5],
     -- A client clock can be wrong; never in the future, never before the
     -- product existed.
     least(now(), greatest(coalesce(p_first_seen_at, now()), timestamptz '2026-01-01')))
  on conflict (user_id) do nothing;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.set_first_visit_source(text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_first_visit_source(text, text, text, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin read-out
-- ---------------------------------------------------------------------------
--
-- The funnel for the last N days, both populations side by side and never
-- summed: signed-in counts are accounts (internal ones excluded twice over -
-- they are not recorded, and filtered here for anything recorded before this
-- migration), guest counts are browsers. Each event reports its total and how
-- many distinct accounts or browsers reached it, split by device.

create or replace function public.admin_funnel(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'since', v_since,
    'signed_in', (
      select coalesce(jsonb_agg(row_to_json(x) order by x.event, x.device), '[]'::jsonb)
        from (
          select e.event,
                 coalesce(e.props ->> 'device', 'unknown') as device,
                 count(*) as events,
                 count(distinct e.user_id) as accounts
            from public.analytics_events e
            join public.profiles p on p.id = e.user_id and not p.is_internal
           where e.created_at >= v_since
           group by 1, 2
        ) x
    ),
    'guests', (
      select coalesce(jsonb_agg(row_to_json(x) order by x.event, x.device), '[]'::jsonb)
        from (
          select g.event,
                 g.device,
                 count(*) as events,
                 count(distinct g.claim_hash) as browsers
            from public.guest_funnel_events g
           where g.created_at >= v_since
           group by 1, 2
        ) x
    ),
    'first_sources', (
      select coalesce(jsonb_agg(row_to_json(x) order by x.accounts desc), '[]'::jsonb)
        from (
          select coalesce(s.utm_source, s.referrer_host, 'direct') as source,
                 count(*) as accounts
            from public.account_first_source s
            join public.profiles p on p.id = s.user_id and not p.is_internal
           where s.recorded_at >= v_since
           group by 1
           order by 2 desc
           limit 25
        ) x
    )
  );
end;
$$;

revoke all on function public.admin_funnel(integer) from public, anon, authenticated;
grant execute on function public.admin_funnel(integer) to authenticated;
