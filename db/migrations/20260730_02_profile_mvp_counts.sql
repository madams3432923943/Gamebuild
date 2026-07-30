-- Per-player count of MVP awards from offline (bot) games, for the "most
-- MVPs" profile stat - same pattern as triple_double_counts.
alter table public.profiles
  add column if not exists mvp_counts jsonb not null default '{}'::jsonb;
