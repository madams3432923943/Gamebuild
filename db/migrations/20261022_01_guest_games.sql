-- Guest games: practice played before an account exists.
--
-- WHAT CHANGED. The homepage is now Quickplay: a visitor with no session taps
-- NBA or NFL and is drafting against the bot, with the sign-up offer AFTER the
-- first game rather than in front of it. Those games happen in the browser, the
-- same as every practice game, and nothing recorded them - so "how many people
-- played before signing up, which sport, and how many of them then did sign
-- up" had no answer. This table is that answer.
--
-- WHY A TABLE AND NOT A SHARED "GUEST" PROFILE. The brief proposed one profile
-- row, username GUEST, that every guest game would be written against. Three
-- reasons it is not that:
--
--   1. `profiles` is publicly readable, and friend search, the rank population
--      (allSportRatings), squads and the admin user counts all read it
--      directly. There is no existing "exclude internal accounts" filter to
--      extend - GROKBOT, the one such account, is counted like anyone else - so
--      a GUEST row would have needed a new predicate in every one of those
--      readers and in every reader written after them. A row that is not in
--      the table needs no predicate anywhere.
--   2. A practice result is stored as JSON on the profile (history, capped at
--      50; offline_wins; ...) by a read-modify-write from the client. Every
--      guest in the world writing the same row would lose games to each other
--      on concurrent writes, and the cap would discard the count it exists for.
--   3. A profile row implies an auth.users row (profiles_id_fkey), and an auth
--      user with credentials somebody could try to sign in with.
--
-- Nothing here touches `profiles`, `analytics_events` or `active_days`, so a
-- guest cannot appear in user counts, DAU/WAU/MAU, leaderboards, ranked or
-- friend search by construction rather than by filter.
--
-- THE TRUST MODEL. A guest has no identity at all - the anon role, the
-- publishable key, no JWT subject. So:
--   * the table is closed (RLS on, no policies, no grants); the only way in is
--     record_guest_game(), which validates every field and inserts one row;
--   * the row is a SUMMARY a client claims about itself, which is exactly the
--     trust level of a signed-in player's practice result today. Nothing reads
--     it for anything competitive - it is a funnel count;
--   * it is rate-limited by the caller's forwarded address, by its claim
--     token, and globally, because an unauthenticated insert behind a public
--     domain is otherwise a free write for a script.
--
-- CONVERSION. The browser makes a random claim token and keeps it in
-- localStorage. Only its SHA-256 is stored. After sign-up or sign-in the client
-- calls claim_guest_games(token) as the new user, which stamps converted_to on
-- that browser's unclaimed rows. Holding the token is the proof: nobody can
-- claim another browser's games without reading its storage, and the stored
-- hash is useless for doing so.

create table if not exists public.guest_games (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  sport text not null check (sport in ('nba', 'nfl')),
  difficulty text check (difficulty in ('easy', 'medium', 'hard')),
  -- Era ids are per sport ("all", "modern", ...). Shape-checked rather than
  -- enumerated so a new bracket is a data change, not a migration.
  era text not null check (era ~ '^[a-z0-9_-]{1,24}$'),
  won boolean not null,
  score_for integer not null check (score_for between 0 and 999),
  score_against integer not null check (score_against between 0 and 999),
  -- SHA-256 (hex) of the browser's claim token. Never the token itself.
  claim_hash text not null check (claim_hash ~ '^[0-9a-f]{64}$'),
  -- SHA-256 (hex) of the first X-Forwarded-For hop, for rate limiting only.
  -- Hashed so the table holds no addresses; null when no header was present.
  source_hash text check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$'),
  converted_to uuid references auth.users(id) on delete set null,
  converted_at timestamptz
);

create index if not exists guest_games_created_idx on public.guest_games (created_at desc);
create index if not exists guest_games_unclaimed_idx on public.guest_games (claim_hash) where converted_to is null;
create index if not exists guest_games_source_idx on public.guest_games (source_hash, created_at desc) where source_hash is not null;

alter table public.guest_games enable row level security;
revoke all on public.guest_games from public, anon, authenticated;
revoke all on sequence public.guest_games_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_guest_game: the only way a row gets in.
-- ---------------------------------------------------------------------------

create or replace function public.record_guest_game(
  p_sport text,
  p_difficulty text,
  p_era text,
  p_won boolean,
  p_score_for integer,
  p_score_against integer,
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
  -- A signed-in player's practice game goes to their own profile; it is not a
  -- guest game and must not inflate this count. Refused rather than ignored so
  -- a client bug that sends one is visible.
  if auth.uid() is not null then
    raise exception 'Signed-in games are not guest games.' using errcode = '42501';
  end if;

  -- The token is 32 random bytes, base64url - 43 characters. Anything else is
  -- not this client.
  if p_claim_token is null or p_claim_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'Invalid claim token.' using errcode = '22023';
  end if;
  v_claim_hash := encode(sha256(convert_to(p_claim_token, 'UTF8')), 'hex');

  -- PostgREST exposes the request headers as a GUC. The first X-Forwarded-For
  -- hop is the caller as the edge saw it. Missing in direct SQL, which is fine:
  -- the per-token and global limits still apply.
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

  -- Budgets. A real game takes several minutes, so 20 an hour from one browser
  -- or one address is generous; the global ceiling bounds what a distributed
  -- script can cost. Over budget is an error the client logs and moves past -
  -- the guest's game is unaffected either way.
  if (select count(*) from public.guest_games
       where claim_hash = v_claim_hash and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many guest games from this browser.' using errcode = 'P0001';
  end if;
  if v_source_hash is not null and (select count(*) from public.guest_games
       where source_hash = v_source_hash and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'Too many guest games from this address.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.guest_games where created_at > now() - interval '1 hour') >= 2000 then
    raise exception 'Guest game recording is over its hourly budget.' using errcode = 'P0001';
  end if;

  insert into public.guest_games
    (sport, difficulty, era, won, score_for, score_against, claim_hash, source_hash)
  values
    (p_sport, p_difficulty, p_era, p_won, p_score_for, p_score_against, v_claim_hash, v_source_hash);
end;
$$;

revoke all on function public.record_guest_game(text, text, text, boolean, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.record_guest_game(text, text, text, boolean, integer, integer, text)
  to anon;

-- ---------------------------------------------------------------------------
-- claim_guest_games: a new (or returning) account takes this browser's games.
-- ---------------------------------------------------------------------------
--
-- Returns how many rows were claimed. Only unclaimed rows from the last 30
-- days: older than that, the visit that played them is not plausibly the one
-- that just signed up, and the conversion it would record is noise.

create or replace function public.claim_guest_games(p_claim_token text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
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

  update public.guest_games
     set converted_to = v_uid,
         converted_at = now()
   where claim_hash = encode(sha256(convert_to(p_claim_token, 'UTF8')), 'hex')
     and converted_to is null
     and created_at > now() - interval '30 days';
  get diagnostics v_claimed = row_count;
  return v_claimed;
end;
$$;

revoke all on function public.claim_guest_games(text) from public, anon, authenticated;
grant execute on function public.claim_guest_games(text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_guest_overview: the numbers this exists for.
-- ---------------------------------------------------------------------------
--
-- Its own function rather than a block inside admin_overview(): that body is
-- all-or-nothing to re-issue (see 20260911_04), and the guest numbers are a
-- separate population that must never be summed into the user figures there.
-- "Guests" is browsers, not people - one person on two devices is two, and a
-- cleared localStorage starts a new one.

create or replace function public.admin_guest_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'games', jsonb_build_object(
      'today',      (select count(*) from public.guest_games where created_at >= current_date),
      'this_week',  (select count(*) from public.guest_games where created_at >= current_date - 6),
      'this_month', (select count(*) from public.guest_games where created_at >= current_date - 29),
      'total',      (select count(*) from public.guest_games)
    ),
    'by_sport', (
      select coalesce(jsonb_object_agg(sport, n), '{}'::jsonb)
        from (select sport, count(*) as n from public.guest_games group by sport) s
    ),
    'by_difficulty', (
      select coalesce(jsonb_object_agg(difficulty, n), '{}'::jsonb)
        from (select difficulty, count(*) as n from public.guest_games
               where difficulty is not null group by difficulty) s
    ),
    'browsers', (select count(distinct claim_hash) from public.guest_games),
    'converted_browsers', (select count(distinct claim_hash) from public.guest_games where converted_to is not null),
    'converted_accounts', (select count(distinct converted_to) from public.guest_games where converted_to is not null),
    'conversion_rate', (
      select case when total = 0 then null else round(converted::numeric / total, 4) end
        from (select count(distinct claim_hash) as total,
                     count(distinct claim_hash) filter (where converted_to is not null) as converted
                from public.guest_games) x
    )
  );
end;
$$;

revoke all on function public.admin_guest_overview() from public, anon, authenticated;
grant execute on function public.admin_guest_overview() to authenticated;
