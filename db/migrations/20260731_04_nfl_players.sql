-- NFL player data: its own table, not a sport column on `players`.
--
-- WHY A SEPARATE TABLE
--
-- The obvious alternative is `alter table players add column sport`, and it
-- is wrong here. `players` is shaped entirely around basketball per-game
-- averages - ppg/rpg/apg/spg/bpg/tov plus the FG/3PT/FT split the shooting
-- model derives from. Football shares none of them. A quarterback has no
-- rebounds and a cornerback has no field-goal percentage, so one table would
-- be two disjoint sets of columns, each mostly null for the other sport, and
-- every existing query would need a `where sport = ...` filter it could
-- silently forget - returning Patrick Mahomes to a basketball draft.
--
-- This also matches the decision already recorded in
-- 20260731_01_sport_scope_matchmaking.sql, which deliberately scoped the
-- matchmaking tables by sport while leaving `players` alone for exactly this
-- reason. The client reads the table name off the sport registry
-- (js/sports/*.js `table`), so nothing has to branch on a sport id.
--
-- NOT YET POPULATED. Creating it is groundwork: the columns below are the
-- shape js/sports/nfl.js declares, and the import script that fills them is
-- still to be written (the NBA equivalent is tools/build-data-from-csv.mjs).

create table if not exists public.nfl_players (
  id bigint generated always as identity primary key,

  -- Same identity triple as `players`: a player belongs to a team within an
  -- era, and the same person can appear more than once across a career.
  name text not null,
  team text not null,
  -- Football's eras don't fall on decade boundaries the way basketball's do
  -- (the 1978 passing rules, the 2004 illegal-contact enforcement), so this
  -- holds an era id rather than a decade string.
  era text not null,
  pos text[] not null,

  -- Per-game averages. Split by phase rather than crammed into one set of
  -- generic columns, because a running back's receiving line is genuinely
  -- different information from his rushing line and the simulation will want
  -- both separately.
  games numeric,
  pass_yds numeric,
  pass_td numeric,
  interceptions numeric,
  rush_yds numeric,
  rush_td numeric,
  receptions numeric,
  rec_yds numeric,
  rec_td numeric,
  fumbles numeric,

  -- Defensive/special-teams lines, null for offensive skill players.
  tackles numeric,
  sacks numeric,
  def_interceptions numeric,
  fg_made numeric,
  fg_att numeric,

  created_at timestamptz not null default now(),

  -- The same row can't be imported twice, and it gives the client's
  -- team+era squad lookup an index to use.
  unique (name, team, era)
);

create index if not exists nfl_players_team_era_idx on public.nfl_players (team, era);

-- Publicly readable, exactly like `players`: the draft pool is not secret,
-- and the client needs it to render a squad. Writes are import-time only and
-- go through the service role, so there is no client-write policy.
alter table public.nfl_players enable row level security;

drop policy if exists "nfl players are publicly readable" on public.nfl_players;
create policy "nfl players are publicly readable"
  on public.nfl_players for select
  using (true);
