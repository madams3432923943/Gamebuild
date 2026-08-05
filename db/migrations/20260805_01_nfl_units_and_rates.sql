-- Bring nfl_players in line with what the import actually produces.
--
-- 20260731_04_nfl_players.sql created the table from a guess at the shape,
-- written before any data existed. tools/build-nfl-data.mjs now exists and the
-- real shape differs in two ways worth spelling out.
--
-- 1. THE TABLE HOLDS UNITS AS WELL AS PLAYERS.
--
-- Football drafts six individuals and five units - a team's defensive line,
-- its linebackers, its corners, its safeties, its special teams. A unit is a
-- draftable entry that sits on the same board as a quarterback, so it lives in
-- the same table: the squad lookup is one query, and splitting them would mean
-- two round trips to fill one draft board.
--
-- `kind` says which a row is. Nothing else in the schema changes shape - a
-- unit simply leaves the individual columns null and fills the unit ones,
-- which is the same pattern the offensive/defensive split already uses.
--
-- 2. RATE STATS, NOT JUST VOLUME.
--
-- Per-game yards cannot tell a back averaging 5.2 a carry on eight carries
-- from one averaging 3.4 on twenty-two, and that difference is most of what
-- knowing a running back means. ypc/ypt carry it.
--
-- NOT POPULATED BY THIS MIGRATION. The client reads the generated
-- data/nfl-*.js files directly, exactly as basketball reads data/nba-players.js;
-- this table is for the server, and only matters once online NFL play exists.
-- Creating it now keeps db/ honest about the shape rather than leaving a table
-- that disagrees with the dataset beside it.

alter table public.nfl_players
  -- 'player' or 'unit'. Defaulted so the existing shape stays valid.
  add column if not exists kind text not null default 'player',
  -- OL / DL / LB / CB / S / ST for a unit row, null for an individual.
  add column if not exists unit_group text,
  -- How many players a unit fields together, averaged over the era's seasons.
  -- NOT the number who passed through it: counting a decade's distinct names
  -- made a median secondary look eighteen deep, which is churn, not depth.
  add column if not exists depth numeric,

  -- Efficiency for individuals.
  add column if not exists ypc numeric,
  add column if not exists ypt numeric,

  -- Unit lines. Defensive units carry the first four; special teams carries
  -- the kicking percentages; the offensive line carries only ol_rating,
  -- because there is no per-lineman data in any bulk public source and the
  -- rating is derived from sacks allowed and rushing efficiency at team level
  -- (see buildOlUnit in tools/build-nfl-data.mjs).
  add column if not exists pass_defended numeric,
  add column if not exists fumbles_forced numeric,
  add column if not exists def_td numeric,
  add column if not exists fg_pct numeric,
  add column if not exists pat_pct numeric,
  add column if not exists ol_rating numeric;

-- A unit is one row per team-era-group, so the identity constraint the table
-- was created with (name, team, era) still holds: a unit's name IS its group
-- ("Chicago Bears DL"), which cannot collide with a person.

-- Kind belongs in the squad lookup's index: every draft-board read wants one
-- team-era, and then splits players from units.
create index if not exists nfl_players_team_era_kind_idx
  on public.nfl_players (team, era, kind);
