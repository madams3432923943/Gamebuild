-- Give the server the same per-season players the client now drafts from.
--
-- THE BUG THIS CLOSES
--
-- The draft asks which year: you roll the Mavs 2020s, name Doncic, and pick
-- 2023. Offline that resolves against data/nba-players.js, which is per-season,
-- and you get the 33.9ppg season you asked for.
--
-- Online it did not. submit_pick looks a player up by (name, team, decade) in
-- this table, which held one decade-AVERAGED row per player, and wrote that row
-- into the match roster. So the pick said 2023 and the simulation ran ~30.5ppg
-- Doncic - silently, in the only mode that counts toward rank, with the client
-- showing "2023 Mavericks" the whole time.
--
-- Adding the column is the small half. The rows have to be reloaded from the
-- generated dataset too (tools/export-players-sql.mjs writes that file), and
-- until they are, `season` is null everywhere and the lookup below still falls
-- back to the decade row - which is the old behaviour, not a new failure.

alter table public.players
  -- The season a row describes, as its END year: 2023 is the 2022-23 season,
  -- which is how a basketball season is spoken about.
  add column if not exists season integer;

-- The old identity was (name, team, decade) - one row per player per decade.
-- A player now has one row per season, so that constraint has to widen or the
-- reload collides on its second Doncic.
alter table public.players
  drop constraint if exists players_name_team_decade_key;

create unique index if not exists players_identity_idx
  on public.players (name, team, decade, coalesce(season, 0));

-- The draft board reads one squad at a time and then filters to a player's
-- seasons, so both columns earn their place in the index.
create index if not exists players_squad_season_idx
  on public.players (team, decade, season);
