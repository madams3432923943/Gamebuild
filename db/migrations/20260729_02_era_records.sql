-- Per-era records. Each era bracket is its own ladder, so a rank earned in
-- Modern Ball says nothing about whether you can name the 1978 Sonics.
--
-- Shape, keyed by the era ids in js/constants.js (ERAS):
--   {"modern": {"online_wins":3,"online_losses":1,
--               "offline_wins":9,"offline_losses":4}, ...}
--
-- Kept as jsonb rather than its own table: it is always read and written whole
-- alongside the rest of the profile, and never queried across users. Offline
-- counters are written by the client (js/profile.js); the online ones follow
-- the same rule as the top-level online record and are written server-side,
-- because a client that can grant itself rank isn't ranking anything.
alter table public.profiles
  add column if not exists era_records jsonb not null default '{}'::jsonb;
