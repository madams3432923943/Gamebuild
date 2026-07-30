-- Every player now starts with the plain brown "Rookie" banner equipped.
-- A blank card read as broken for a new account, and "no banner at all"
-- isn't a state worth having: the default is deliberately the plainest art
-- in the game so every real unlock reads as an upgrade on it.
alter table public.profiles alter column equipped_banner set default 'rookie';
update public.profiles set equipped_banner = 'rookie' where equipped_banner is null;

-- The short-lived opt-in "show top sport & era on banner" tag was removed
-- from the UI before it ever shipped to players, so this column has no
-- readers or writers left.
alter table public.profiles drop column if exists show_top_era;
