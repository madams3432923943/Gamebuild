#!/usr/bin/env node
// THE TRUSTED SERVER MUST SEE THE WHOLE POOL.
//
// WHY THIS EXISTS
//
// scripts/verify-parity.mjs and scripts/verify-nfl-parity.mjs prove the two
// ENGINES agree: given the same rosters, the same seed and the same dataset,
// the client and the Edge Function produce identical games down to the drive.
// Nothing proved the server had the same DATASET.
//
// It did not. supabase/functions/simulate-match/index.ts loaded its pool with
// a bare `.select("*")`, which goes through PostgREST and is capped at
// `max-rows` - 1000 by default. Football's pool is 13,874 rows and
// basketball's is 9,417.
//
// Worse than a sample: the first 1000 rows of nfl_players are all
// `kind='player'`, so the server saw 1000 players and ZERO UNITS. Every
// offensive line, defensive line, linebacker corps, secondary and special
// teams unit fell back to a neutral 0.5 rating, because every rating in this
// engine is a percentile against the pool it was computed from.
//
// It never threw. The game simulated, the box score added up, the score was
// plausible - and the same two rosters played 16-17 offline and 23-20 online.
// The only trace it left was the provenance string recorded against finished
// matches: `nfl-generated-1000-2024`, where 1000 is the row count.
//
// Two checks, because the failure had two halves:
//   1. The server code pages its pools instead of taking the first page.
//   2. A truncated pool genuinely changes the game - so this matters.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderCheck, renderSection, renderTable, summarize, PASS, FAIL } from "./lib/report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

console.log(renderSection("Trusted server dataset (the Edge Function sees the whole pool)"));

// ---- 1. the server pages -----------------------------------------------
const fnPath = path.join(ROOT, "supabase", "functions", "simulate-match", "index.ts");
const src = await readFile(fnPath, "utf8");

// The pool load must be paged. A bare .select("*") on the sport's table is the
// exact shape of the bug and is what this forbids.
const bareSelect = /from\(\s*sportEngine\.table\s*\)\s*\.select\(\s*"\*"\s*\)\s*;/.test(src);
const pagesPool = /\.range\(/.test(src);

check(
  "The Edge Function does not load a pool with an unpaged select",
  !bareSelect,
  bareSelect
    ? "found `from(sportEngine.table).select(\"*\")` - PostgREST caps this at max-rows"
    : "no unpaged pool select"
);
check(
  "The Edge Function pages through its pool with .range()",
  pagesPool,
  pagesPool ? "range-based paging present" : "no .range() call - the pool cannot exceed one page"
);

// ---- 2. a truncated pool really does change the game -------------------
const { NFL } = await import("../js/sports/nfl/index.js");
const { computeDatasetStats, simulate } = await import("../js/sports/nfl/engine.js");
const { rateEntry } = await import("../js/sports/nfl/units.js");

await NFL.preload();
const players = NFL.individuals();
const units = NFL.units();
const PAGE = 1000;

// Exactly what the server received: the first page of the table, in the order
// the rows are generated (players first, then units).
const firstPage = [...players, ...units].slice(0, PAGE);
const pagePlayers = firstPage.filter((r) => !r.group);
const pageUnits = firstPage.filter((r) => r.group);

check(
  "One page of the football pool is not the football pool",
  players.length + units.length > PAGE && pageUnits.length === 0,
  `${players.length} players + ${units.length} units, of which one page holds ` +
    `${pagePlayers.length} players and ${pageUnits.length} units`
);

const full = computeDatasetStats(players, units);
const truncated = computeDatasetStats(pagePlayers, pageUnits);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const setup = mulberry32(99);
const draw = (list) => list[Math.floor(setup() * list.length)];
const at = (pos, key) => draw(players.filter((p) => (p.pos || []).includes(pos) && (p[key] || 0) > 0));
const unit = (group) => draw(units.filter((u) => u.group === group));
const roster = () => ({
  QB: at("QB", "pass_yds"), RB: at("RB", "rush_yds"),
  WR1: at("WR", "rec_yds"), WR2: at("WR", "rec_yds"), WR3: at("WR", "rec_yds"),
  TE: at("TE", "rec_yds"),
  OL: unit("OL"), DL: unit("DL"), LB: unit("LB"), CB: unit("CB"), S: unit("S"), ST: unit("ST"),
});
const rosterA = roster();
const rosterB = roster();
const BAL = { offense: "balanced-offense", defense: "balanced-defense" };
const opts = () => ({ strategyA: BAL, strategyB: BAL, rand: mulberry32(7) });

const a = simulate(rosterA, rosterB, full, opts());
const b = simulate(rosterA, rosterB, truncated, opts());
const sameScore = a.teamScoreA === b.teamScoreA && a.teamScoreB === b.teamScoreB;

// A drafted UNIT is the clearest casualty: with no units in the pool there is
// no distribution to rank one against, so every one of them rates neutral.
const unitRatings = ["OL", "DL", "LB", "CB", "S", "ST"].map((slot) => ({
  slot,
  full: rateEntry(rosterA[slot], full),
  truncated: rateEntry(rosterA[slot], truncated),
}));
const allNeutral = unitRatings.every((u) => Math.abs(u.truncated - 0.5) < 0.001);

console.log(
  renderTable([
    ["drafted unit", "rated on full pool", "rated on one page"],
    ...unitRatings.map((u) => [u.slot, u.full.toFixed(3), u.truncated.toFixed(3)]),
  ])
);
console.log(`  same rosters, same seed: ${a.teamScoreA}-${a.teamScoreB} on the full pool, ` +
  `${b.teamScoreA}-${b.teamScoreB} on one page\n`);

check(
  "A truncated pool rates every drafted unit as neutral",
  allNeutral,
  allNeutral
    ? "all six units fall back to 0.5 - the draft stops meaning anything"
    : "units still separate, so this check no longer demonstrates the risk",
);
check(
  "A truncated pool changes the result, so the whole pool matters",
  !sameScore,
  `${a.teamScoreA}-${a.teamScoreB} against ${b.teamScoreA}-${b.teamScoreB}`
);

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
