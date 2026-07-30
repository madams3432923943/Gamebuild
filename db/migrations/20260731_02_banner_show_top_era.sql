-- Lets a player opt in to showing their most-played era on their banner.
-- Purely cosmetic (like equipped_banner), so client-writable - not touched
-- by the protect_online_record trigger, which only guards online_wins/losses.
alter table public.profiles
  add column show_top_era boolean not null default false;
