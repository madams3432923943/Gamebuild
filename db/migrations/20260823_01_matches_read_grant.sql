-- Online play could not read a match it had just been matched into.
--
-- Ranked matchmaking failed with "Couldn't reach matchmaking: permission
-- denied for table matches". join_queue() was fine - it is SECURITY DEFINER and
-- paired players correctly, and the rows are in public.matches. What failed was
-- the very next call, getMatch() -> public.matches_public.
--
-- WHY. 20260819_01 restored `security_invoker = true` on matches_public, which
-- had been silently stripped eight days earlier by a `create or replace view`.
-- That was the right fix - it is what makes the view apply the CALLER's RLS
-- instead of the owner's - but an invoker view also checks the caller's TABLE
-- privileges on the base table, and `authenticated` had none:
--
--     matches   authenticated=xtm/postgres     -- no r
--
-- The RLS policy "participants read their match" was there, and pointless: a
-- policy filters rows a role is already allowed to read. Without the grant the
-- read is refused before any policy runs. While the view ran as its owner the
-- missing grant did not show, so restoring the security fix exposed a hole that
-- had been there all along.
--
-- WHY COLUMN-LEVEL. A blanket `grant select on public.matches` would hand every
-- signed-in client PostgREST access to roster_a/roster_b - the hidden picks
-- matches_public exists to withhold until the round reveals them - plus the
-- rotation/matchup/tactic columns. The grant is therefore exactly the view's
-- column list and nothing more: the view keeps working, and a client that asks
-- public.matches directly for a roster column is still refused.
--
-- Any column added to matches_public must be added here too, or the view starts
-- refusing reads for everyone. scripts/verify-schema-documented.mjs checks the
-- live grant against the live view and fails if the two drift apart.

grant select (
  id, player_a, player_b, status, round_number, current_squad_team,
  current_squad_decade, used_squads, winner, created_at, updated_at,
  is_friendly, sport, era, game_mode
) on public.matches to authenticated;

-- anon stays out entirely: matches_public is revoked from anon (20260819_01),
-- and there is nothing in a match a signed-out visitor should see.
revoke all on public.matches from anon;
