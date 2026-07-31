-- Per-sport records, so rank stops being one blended number across every
-- sport a player touches.
--
-- WHAT WAS ASKED FOR, AND WHAT THIS DOES INSTEAD
--
-- The request was four columns - profiles.nba_elo, nfl_elo,
-- nba_matches_played, nfl_matches_played - as "computed columns". Three
-- things made that not work as written:
--
-- 1. matches.sport and matchmaking_queue.sport already exist (added in
--    20260731_01_sport_scope_matchmaking.sql), so re-adding them errors. The
--    statements below are guarded so this file is safe to re-run.
--
-- 2. A Postgres GENERATED column may only reference other columns in the SAME
--    ROW. "How many NFL matches has this player finished" counts rows in
--    another table, so it cannot be generated. It is a function here, reading
--    `matches` directly - which also means it can never drift from the truth
--    the way a maintained counter can.
--
-- 3. Hardcoding nba_/nfl_ column pairs means NHL and Soccer each need another
--    migration and every query updated. profiles.era_records already
--    established the pattern this codebase uses for per-bracket records - one
--    jsonb keyed by id - and it scales to any sport with no migration at all.
--    sport_ratings follows it.
--
-- NOTE ON RATINGS: there is no Elo in this game yet. Rank today is a win-rate
-- percentile computed client-side (loadRankInfo in js/profile.js). This
-- migration creates the STORAGE for per-sport ratings; it deliberately does
-- not invent starting values, because a column full of 1200s that nothing
-- updates looks like a working rating system and isn't. The write path has to
-- live in the simulate-match Edge Function, for the same reason online_wins
-- does: a client that can grant itself rank isn't ranking anything.

-- Idempotent re-statements of the columns that already exist, so this file
-- describes the full intended shape and can be run against a fresh database.
alter table public.matchmaking_queue add column if not exists sport text not null default 'nba';
alter table public.matches add column if not exists sport text not null default 'nba';

-- The sport a player is shown on arrival, so someone who only plays one
-- doesn't re-pick it every visit. Mirrors how the client already persists the
-- choice locally (bk_sport), but follows the account rather than the browser.
alter table public.profiles add column if not exists primary_sport text not null default 'nba';

-- Per-sport ratings, keyed by the sport ids in js/sports/ ("nba", "nfl", ...):
--   {"nba": {"rating": 1240, "peak": 1310, "games": 42}, ...}
-- Same shape and reasoning as era_records: read and written whole alongside
-- the rest of the profile, never queried across users, and adding a sport
-- costs nothing.
alter table public.profiles add column if not exists sport_ratings jsonb not null default '{}'::jsonb;

-- Ratings are as protected as the top-level online record. Without this a
-- client could simply write itself a rating, which is the same hole
-- protect_online_record exists to close.
create or replace function public.protect_sport_ratings()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and new.sport_ratings is distinct from old.sport_ratings then
    raise exception 'sport_ratings is written server-side only';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_sport_ratings on public.profiles;
create trigger protect_sport_ratings
  before update on public.profiles
  for each row execute function public.protect_sport_ratings();

-- Per-sport match counts, computed from `matches` rather than stored.
--
-- SECURITY DEFINER because `matches` is readable only by its two
-- participants, so an invoker-rights view would report zero for everybody
-- else and break viewing another player's profile. It returns AGGREGATES
-- ONLY - never a roster, an opponent or an in-progress match - and win/loss
-- totals are already public on `profiles`, so this exposes no new class of
-- information, only the same information split by sport.
--
-- Friendly matches are counted as played but not as ranked, matching the
-- existing rule that a challenge between friends never moves rank.
create or replace function public.sport_stats(p_user_id uuid)
returns table (
  sport text,
  played integer,
  won integer,
  lost integer,
  ranked_played integer,
  ranked_won integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.sport,
    count(*)::integer as played,
    count(*) filter (
      where (m.player_a = p_user_id and m.winner = 'A')
         or (m.player_b = p_user_id and m.winner = 'B')
    )::integer as won,
    count(*) filter (
      where (m.player_a = p_user_id and m.winner = 'B')
         or (m.player_b = p_user_id and m.winner = 'A')
    )::integer as lost,
    count(*) filter (where not m.is_friendly)::integer as ranked_played,
    count(*) filter (
      where not m.is_friendly
        and ((m.player_a = p_user_id and m.winner = 'A')
          or (m.player_b = p_user_id and m.winner = 'B'))
    )::integer as ranked_won
  from public.matches m
  where m.status = 'complete'
    and (m.player_a = p_user_id or m.player_b = p_user_id)
  group by m.sport;
$$;

grant execute on function public.sport_stats(uuid) to anon, authenticated;

-- Every per-sport read filters on (player, sport); without this each one is a
-- sequential scan over the whole match history.
create index if not exists matches_player_a_sport_idx on public.matches (player_a, sport) where status = 'complete';
create index if not exists matches_player_b_sport_idx on public.matches (player_b, sport) where status = 'complete';
