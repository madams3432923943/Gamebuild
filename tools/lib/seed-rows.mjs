// The shape the server sees a dataset in, in ONE place.
//
// WHY THIS EXISTS
//
// A dataset row and a DATABASE row are not the same object, and three files
// had each grown their own opinion about the difference:
//
//   tools/export-players-sql.mjs listed the seventeen basketball columns;
//   tools/export-nfl-sql.mjs built the football row with its payload;
//   scripts/verify-edge-handler.mjs built a third copy so it could stand a
//   database up in memory.
//
// Three copies of "what the server reads" is three chances for a test to prove
// something about a shape production never sees. And there is now a fourth
// caller - tools/bake-server-stats.mjs - which precomputes the rating context
// FROM these rows, so a projection that drifts would bake statistics against
// one shape and serve them against another. That is the kind of divergence
// nothing would notice: the numbers would all be plausible.
//
// THE PROJECTION IS THE POINT, not a formality. `data/nba-players.json` rows
// carry a `games` field and `public.players` has no such column, so a rating
// context computed from the dataset is not necessarily the one computed from
// the table. Everything here answers "what would the server get", never "what
// does the file contain".

import { loadDataset } from "../../data/load.mjs";

/**
 * Basketball's table is FLAT COLUMNS - the server reads them straight off the
 * row - so the projection is the column list, and any dataset field not in it
 * genuinely does not reach the server.
 *
 * Kept in step with db/migrations and with tools/export-players-sql.mjs, which
 * imports this rather than repeating it.
 */
export const NBA_COLUMNS = [
  "name", "team", "decade", "season", "pos",
  "ppg", "rpg", "apg", "spg", "bpg", "tov",
  "fga", "fgp", "tpa", "tpp", "fta", "ftp",
];

/** One dataset row as `public.players` stores it. Missing fields become null
 * rather than undefined, because that is what a database column does. */
export function toNbaRow(player) {
  const row = {};
  for (const column of NBA_COLUMNS) row[column] = player[column] ?? null;
  return row;
}

/**
 * Football's table is NOT flat. `public.nfl_players` holds players and units
 * together, and `payload` carries the whole dataset object unedited - which is
 * deliberate, and is why the server's generatedNflEntry simply reads it back.
 * The named columns beside it exist for querying, not for the simulation.
 */
export function toNflRow(entry, kind) {
  return {
    kind,
    unit_group: kind === "unit" ? entry.group : null,
    name: entry.name,
    team: entry.team,
    era: entry.era,
    season: entry.season,
    pos: entry.pos,
    payload: entry,
  };
}

/** Every row of `public.players`, in the order the seed writes them. */
export async function nbaSeedRows() {
  return (await loadDataset("nba-players")).map(toNbaRow);
}

/** Every row of `public.nfl_players`: the players, then the units. */
export async function nflSeedRows() {
  const players = await loadDataset("nfl-players");
  const units = await loadDataset("nfl-units");
  return [
    ...players.map((p) => toNflRow(p, "player")),
    ...units.map((u) => toNflRow(u, "unit")),
  ];
}

/** The rows for a sport by id, which is how every caller here asks. */
export async function seedRowsFor(sportId) {
  return sportId === "nba" ? nbaSeedRows() : nflSeedRows();
}
