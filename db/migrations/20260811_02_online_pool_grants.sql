-- Draft pools are public game data. Writes remain server-only through the
-- service role / security-definer RPCs; clients only need SELECT to render the
-- rolled squad.
grant select on public.nfl_players to anon, authenticated;
grant select on public.online_game_modes to anon, authenticated;
