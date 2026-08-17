-- Team kits: the two colours a player wears.
--
-- Shaped exactly like equipped_banner - one text column holding an ID from a
-- catalogue in the client, with a default - rather than a jsonb blob of hex
-- values. Two reasons:
--
--   1. Storing an id means the palette can be retuned without rewriting a
--      single user row. js/kits.js already had to move Bone's alternate once
--      during development because it collided with Steel; had that been stored
--      as hex, every player wearing Bone would still be wearing the collision.
--
--   2. Validation becomes "is this id in the catalogue", which kitById already
--      answers, and which cannot be satisfied by arbitrary input.
--
-- The default matters for the same reason every other default here does: a
-- client that has not reloaded and a row written before this column existed both
-- have to land somewhere sensible. 'nova' is the app's own palette, so an
-- account that never opens the picker still looks like Draft Nova.
--
-- No backfill needed. Existing rows take the default.

alter table public.profiles
  add column if not exists equipped_kit text default 'nova';

comment on column public.profiles.equipped_kit is
  'Kit id from KITS in js/kits.js. Home wears its primary, away its secondary; '
  'see wornColours() for the clash rule. Retired ids resolve to the default '
  'client-side via kitById, so a value here is never load-bearing.';
