-- New profile achievement columns for offline (bot) games: the single
-- highest-scoring game (with a full box-score snapshot so it can be viewed
-- later), the largest margin of victory, and a running per-player count of
-- triple-doubles drafted onto the user's own roster.
--
-- Offline-only for now: online (ranked) results are recorded server-side by
-- the simulate-match Edge Function, which is out of this repo and hasn't
-- been updated to write these fields, so online games won't contribute to
-- them until that function is updated to match.
alter table public.profiles
  add column if not exists highest_scoring_game jsonb,
  add column if not exists largest_margin_game jsonb,
  add column if not exists triple_double_counts jsonb not null default '{}'::jsonb;
