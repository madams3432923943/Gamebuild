// Sanity checks for the generated NFL dataset. Run after build-nfl-data.mjs
// and before anything ships.
//
// The check that matters is COVERAGE: a squad the draft can roll but not fill
// is a dead end mid-game, so every team-era has to satisfy every ranked slot.
// tools/check-coverage.mjs does the same job for basketball, and the basketball
// build simply drops squads that fail. Football can't drop them so casually -
// there are only 96 - so this reports rather than deletes, and a failure is a
// signal to move the era boundaries or the games floor.
//
// Usage:  node tools/verify-nfl-data.mjs

import { ROWS as PLAYERS } from "../data/nfl-players.js";
import { ROWS as UNITS } from "../data/nfl-units.js";

// The ranked lineup from js/sports/nfl/index.js. Individual slots list how many
// of that position a squad must offer; unit slots must simply exist.
const NEED_PLAYERS = { QB: 1, RB: 1, WR: 2, TE: 1 };
const NEED_UNITS = ["OL", "DL", "LB", "CB", "S", "ST"];

let failures = 0;
const fail = (msg) => {
  console.error(`  FAIL ${msg}`);
  failures += 1;
};

// ---- Shape -----------------------------------------------------------------

const ERAS = new Set(["2000s", "2010s", "2020s"]);
const numeric = (row, keys) => keys.filter((k) => row[k] !== undefined && !Number.isFinite(row[k]));

console.log(`players: ${PLAYERS.length}   units: ${UNITS.length}`);

for (const p of PLAYERS) {
  if (!ERAS.has(p.era)) fail(`${p.name}: unknown era ${p.era}`);
  const bad = numeric(p, ["pass_yds", "rush_yds", "rec_yds", "ypc", "ypt", "games"]);
  if (bad.length) fail(`${p.name}: non-numeric ${bad.join(", ")}`);
  if (!p.pos || !p.pos.length) fail(`${p.name}: no position`);
}

for (const u of UNITS) {
  if (!ERAS.has(u.era)) fail(`${u.team} ${u.group}: unknown era ${u.era}`);
  if (!NEED_UNITS.includes(u.group)) fail(`${u.team} ${u.era}: unknown unit ${u.group}`);
  if (!Number.isFinite(u.depth)) fail(`${u.team} ${u.era} ${u.group}: bad depth`);
}

// ---- Coverage --------------------------------------------------------------

const squads = new Map();
for (const p of PLAYERS) {
  const key = `${p.team}|${p.era}`;
  if (!squads.has(key)) squads.set(key, { pos: {}, units: new Set() });
  const s = squads.get(key);
  const slot = p.pos[0];
  s.pos[slot] = (s.pos[slot] || 0) + 1;
}
for (const u of UNITS) {
  const key = `${u.team}|${u.era}`;
  if (squads.has(key)) squads.get(key).units.add(u.group);
}

const short = [];
for (const [key, s] of squads) {
  const missing = [];
  for (const [slot, n] of Object.entries(NEED_PLAYERS)) {
    if ((s.pos[slot] || 0) < n) missing.push(`${slot}x${n}`);
  }
  for (const g of NEED_UNITS) if (!s.units.has(g)) missing.push(g);
  if (missing.length) short.push(`${key.replace("|", " ")}: missing ${missing.join(", ")}`);
}

console.log(`squads: ${squads.size} (32 teams x 3 eras = 96 possible)`);
if (short.length) {
  console.log(`\n${short.length} squad(s) cannot fill the ranked lineup:`);
  for (const line of short) console.log(`  ${line}`);
  failures += short.length;
} else {
  console.log("coverage: every squad can fill all 11 ranked slots");
}

// ---- Draft pool size -------------------------------------------------------
// A squad also has to offer enough CHOICE, or the draft is not a decision.
// One round rolls one squad and each side takes a single entry from it, so the
// bar is per-round, not 22-deep.
//
// ONE STRUCTURAL PROBLEM THIS SURFACES, for whoever builds the draft: a
// team-era has exactly ONE of each unit. There is one "Buffalo Bills 2020s DL".
// So two players cannot both draft the D-line off the same roll the way they
// can both want the same quarterback. Either a unit round has to offer units
// from several teams, or the second pick has to take a different slot. This is
// the engine's problem, not the data's - recorded here because the data is
// where you first notice it.
const pool = [...squads.entries()].map(([key, s]) => ({
  key,
  size: Object.values(s.pos).reduce((a, b) => a + b, 0) + s.units.size,
}));
pool.sort((a, b) => a.size - b.size);
console.log(`\ndraft pool per squad: min ${pool[0].size} (${pool[0].key.replace("|", " ")}), median ${pool[Math.floor(pool.length / 2)].size}, max ${pool[pool.length - 1].size}`);
if (pool[0].size < 15) {
  console.log(`  NOTE: the thinnest squad offers only ${pool[0].size} entries.`);
}

console.log(failures ? `\n${failures} problem(s).` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
