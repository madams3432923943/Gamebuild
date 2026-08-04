-- ELO ratings, one per sport. NO DDL NEEDED - this file documents a shape.
--
-- profiles.sport_ratings (jsonb, default '{}') and the protect_sport_ratings
-- trigger both already exist and were both unused: every one of the six live
-- profiles had '{}' in that column. Rank was computed from online_wins /
-- (online_wins + online_losses) instead, which is one number for all sports,
-- so an NFL result would have moved an NBA rank.
--
-- What changed is entirely in code (js/rating.js, vendored into
-- supabase/functions/simulate-match/rating.js). This file exists so the schema
-- documentation records what now lives in that column, because a bare jsonb
-- with no writer told the next reader nothing.
--
-- Shape, one key per sport:
--
--   {
--     "nba": { "rating": 612, "wins": 9, "losses": 4, "games": 13, "peak": 640 },
--     "nfl": { ... }
--   }
--
--   rating  current ELO. Everyone starts at 500 (START_RATING); the floor is
--           100, so a long losing run bottoms out rather than going negative.
--   games   online games in THAT sport. Five (RANK_GAMES_FLOOR) before a rank
--           is shown rather than "provisional".
--   peak    highest rating ever held. A rating can fall, and "how high did you
--           get" is a different question from "where are you now".
--
-- The general all-sports rank on a player's banner is NOT stored: it is the
-- games-weighted mean of the ratings above (overallRating in js/rating.js).
-- Deriving it is deliberate - a stored third number could drift out of step
-- with the two it is made from.
--
-- Only simulate-match writes this. protect_sport_ratings raises whenever
-- auth.uid() is not null, which lets the service role through and stops every
-- signed-in client, so a player cannot rate themselves. Friendly matches skip
-- it entirely, the same way they skip online_wins.
--
-- Re-stated idempotently below so a fresh database built from these files
-- lands in the same state as production, which it would not if the column and
-- trigger only ever existed as an undocumented live change.

alter table public.profiles
  add column if not exists sport_ratings jsonb not null default '{}'::jsonb;

create or replace function public.protect_sport_ratings()
returns trigger
language plpgsql set search_path = public
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
