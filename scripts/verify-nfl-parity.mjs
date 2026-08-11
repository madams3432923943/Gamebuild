#!/usr/bin/env node
// Online football is the SAME GAME as offline football.
//
// WHY THIS EXISTS SEPARATELY FROM verify-parity.mjs
//
// That harness proves basketball's two engines agree, and its scenario builder
// is basketball-shaped all the way down: it groups the dataset by team|decade,
// keeps squads deep enough to fill a ten-man roster, and diffs against
// basketball's fifteen gamestyles. Its sport DISCOVERY is generic - it walks
// js/sports/* looking for a vendored engine - but every check underneath is
// wired to the default sport's paths, so football having a server engine did
// not put football under test. It reported "15 gamestyles" and four basketball
// roster shapes while the football pair went unchecked.
//
// Football needs its own because its roster is a different shape entirely:
// twelve slots, five of which are UNITS rather than people, and its strategy is
// a pair of gameplans rather than one id.
//
// What this guarantees, and it is the whole point of the online mode: the
// result you get playing a stranger is the result you would have got playing
// the bot with the same rosters and the same plans. The trusted server is not
// a second, similar simulation - it is the same one.

import { simulate as clientSimulate, computeDatasetStats as clientStats }
  from "../js/sports/nfl/engine.js";
import { simulate as edgeSimulate, computeDatasetStats as edgeStats }
  from "../supabase/functions/simulate-match/sports/nfl/engine.js";
import { NFL } from "../js/sports/nfl/index.js";
import { OFFENSIVE_PLANS, DEFENSIVE_PLANS } from "../js/sports/nfl/tactics.js";

import { renderCheck, renderSection, renderTable, summarize, PASS, FAIL } from "./lib/report.mjs";

await NFL.preload();
const players = NFL.individuals();
const units = NFL.units();

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A football roster: seven people and five units, drawn deterministically. */
function buildRoster(rng) {
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const at = (pos, key) => pick(players.filter((p) => (p.pos || []).includes(pos) && (p[key] || 0) > 0));
  const unit = (group) => pick(units.filter((u) => u.group === group));
  return {
    QB: at("QB", "pass_yds"), RB: at("RB", "rush_yds"),
    WR1: at("WR", "rec_yds"), WR2: at("WR", "rec_yds"), WR3: at("WR", "rec_yds"),
    TE: at("TE", "rec_yds"),
    OL: unit("OL"), DL: unit("DL"), LB: unit("LB"), CB: unit("CB"), S: unit("S"), ST: unit("ST"),
  };
}

// Each engine builds its OWN rating context from the same dataset, exactly as
// the two runtimes do - the client in the browser, the Edge Function on the
// server. Sharing one object would hide a divergence in how they build it.
const ctxClient = clientStats(players, units);
const ctxEdge = edgeStats(players, units);

const LINE_KEYS = [
  "comp", "att", "pass_yds", "pass_tds", "rush_yds", "rush_tds", "carries",
  "targets", "sacked", "rec", "rec_yds", "rec_tds", "ints", "fumbles", "fgs", "fga", "td", "pts",
];
const TEAM_KEYS = [
  "passYards", "rushYards", "totalYards", "firstDowns", "turnovers",
  "thirdDownAttempts", "thirdDownConversions", "redZoneTrips", "redZoneTouchdowns",
  "sacksAllowed", "possessionSeconds", "drives", "plays",
];

const SCENARIOS = Number(process.env.NFL_PARITY_SCENARIOS || 24);

const rows = [["scenario", "client A-B", "edge A-B", "gameplans", "fields", "verdict"]];
let mismatchedScores = 0;
let mismatchedFields = 0;
let comparedFields = 0;
let mismatchedDrives = 0;
const examples = [];

for (let i = 0; i < SCENARIOS; i++) {
  const setup = mulberry32(i * 104729 + 7);
  const rosterA = buildRoster(setup);
  const rosterB = buildRoster(setup);
  // Every gameplan pairing gets exercised across the sample, including the
  // ones the bot would rarely draw.
  const strategyA = {
    offense: OFFENSIVE_PLANS[i % OFFENSIVE_PLANS.length].id,
    defense: DEFENSIVE_PLANS[(i * 3) % DEFENSIVE_PLANS.length].id,
  };
  const strategyB = {
    offense: OFFENSIVE_PLANS[(i * 2 + 1) % OFFENSIVE_PLANS.length].id,
    defense: DEFENSIVE_PLANS[(i + 2) % DEFENSIVE_PLANS.length].id,
  };

  // THE SAME STREAM, not merely the same seed value: each engine gets its own
  // generator started from the identical seed, which is what the Edge
  // Function's withSeededMathRandom does for a real online match.
  const opts = (rand) => ({ strategyA, strategyB, rand });
  const a = clientSimulate(rosterA, rosterB, ctxClient, opts(mulberry32(i + 1)));
  const b = edgeSimulate(rosterA, rosterB, ctxEdge, opts(mulberry32(i + 1)));

  const scoreOk = a.teamScoreA === b.teamScoreA && a.teamScoreB === b.teamScoreB;
  if (!scoreOk) {
    mismatchedScores += 1;
    examples.push(`#${i}: ${a.teamScoreA}-${a.teamScoreB} client vs ${b.teamScoreA}-${b.teamScoreB} edge`);
  }

  let fields = 0;
  let bad = 0;
  for (const [boxA, boxB, side] of [[a.boxA, b.boxA, "A"], [a.boxB, b.boxB, "B"]]) {
    for (const slot of Object.keys(boxA)) {
      for (const key of LINE_KEYS) {
        fields += 1;
        if (Math.round(boxA[slot]?.[key] || 0) !== Math.round(boxB[slot]?.[key] || 0)) {
          bad += 1;
          if (examples.length < 8) examples.push(`#${i}: ${side} ${slot} ${key}`);
        }
      }
    }
  }
  for (const [teamA, teamB] of [[a.teamStatsA, b.teamStatsA], [a.teamStatsB, b.teamStatsB]]) {
    for (const key of TEAM_KEYS) {
      fields += 1;
      if (Math.round(teamA[key] || 0) !== Math.round(teamB[key] || 0)) {
        bad += 1;
        if (examples.length < 8) examples.push(`#${i}: team ${key}`);
      }
    }
  }
  comparedFields += fields;
  mismatchedFields += bad;

  // The play-by-play too, not only the totals - the field the viewer watches
  // has to be the same field.
  const drivesMatch = a.drives.length === b.drives.length &&
    a.drives.every((d, n) => d.team === b.drives[n].team && d.outcome === b.drives[n].outcome &&
      d.points === b.drives[n].points && d.startYard === b.drives[n].startYard &&
      d.endYard === b.drives[n].endYard && d.scorerSlot === b.drives[n].scorerSlot);
  if (!drivesMatch) mismatchedDrives += 1;

  if (i < 6) {
    rows.push([
      `pair-${i}`,
      `${a.teamScoreA}-${a.teamScoreB}`,
      `${b.teamScoreA}-${b.teamScoreB}`,
      `${strategyA.offense.split("-")[0]}/${strategyA.defense.split("-")[0]}`,
      String(fields),
      scoreOk && bad === 0 && drivesMatch ? "exact" : "DIFFERS",
    ]);
  }
}

console.log(renderSection(`NFL engine parity (offline client vs online Edge Function, ${SCENARIOS} scenarios)`));
console.log(renderTable(rows));

const checks = [
  {
    title: "Both engines reach the same final score",
    ok: mismatchedScores === 0,
    detail: `${mismatchedScores} mismatches over ${SCENARIOS} scenarios`,
  },
  {
    title: "Every box-score and team field is identical",
    ok: mismatchedFields === 0,
    detail: `${mismatchedFields} differing fields of ${comparedFields} compared`,
  },
  {
    title: "The drive-by-drive game is identical",
    ok: mismatchedDrives === 0,
    detail: `${mismatchedDrives} scenarios where the drives diverged`,
  },
  {
    title: "Both engines read the same gameplan catalogue",
    ok: OFFENSIVE_PLANS.length === 5 && DEFENSIVE_PLANS.length === 5,
    detail: `${OFFENSIVE_PLANS.length} offensive x ${DEFENSIVE_PLANS.length} defensive`,
  },
];

const report = checks.map((c) => ({ title: c.title, status: c.ok ? PASS : FAIL, detail: c.detail }));
for (const c of report) console.log(renderCheck(c));
const { counts, ok } = summarize(report);
if (examples.length) {
  console.log("\n  first divergences:");
  for (const line of examples.slice(0, 8)) console.log(`    ${line}`);
}
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
