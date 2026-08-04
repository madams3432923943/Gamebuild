// Writes db/seed/players.json from js/data.js's PLAYERS array.
//
// The two used to both be committed, which meant 500 KB of the repo was a
// second copy of a file already in it - and two copies of a dataset is two
// things that can disagree. The JSON is now generated on demand instead.
//
// It is needed for exactly one thing: seeding the server's `players` table.
// That migration fetches the file over HTTP from the repo rather than inlining
// a 2,542-row INSERT, so the JSON has to be reachable at a raw URL when the
// migration runs - which means generating it, committing it, pushing, running
// the migration, and then dropping it again. See db/README.md.
//
//   node tools/export-players-json.mjs
//
// Run tools/verify-data.mjs first if js/data.js was just regenerated; there is
// no point exporting a dataset that hasn't been sanity-checked.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PLAYERS } from "../js/data.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "db", "seed", "players.json");

// Guard rather than trust: the migration aborts below 2,000 rows, so an export
// that would trip that check is a mistake worth catching here, where the fix
// is obvious, instead of halfway through a truncate-and-replace.
if (!Array.isArray(PLAYERS) || PLAYERS.length < 2000) {
  console.error(`Refusing to export: js/data.js has ${PLAYERS?.length ?? 0} players, expected 2000+.`);
  process.exit(1);
}

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(PLAYERS), "utf8");

console.log(`Wrote ${OUT} (${PLAYERS.length} players).`);
console.log("Commit and push it, run the players-sync migration, then delete it again.");
