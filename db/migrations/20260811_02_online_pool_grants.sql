-- Draft pools are game data for signed-in players. Writes remain server-only
-- through the service role / security-definer RPCs; authenticated clients only
-- need SELECT to render the rolled squad.
grant select on public.nfl_players to authenticated;
grant select on public.online_game_modes to authenticated;
