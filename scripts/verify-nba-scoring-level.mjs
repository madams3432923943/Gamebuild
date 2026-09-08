#!/usr/bin/env node
// DOES AN NBA GAME SCORE LIKE AN NBA GAME?
//
// WHAT THIS EXISTS FOR
//
// `applyTalentParity` pulls every team toward "a league-average roster's output
// in the same minutes", and that anchor decides the simulation's entire scoring
// level. It used to be `overall.ppg * minutesTotal` - the mean points per game
// of every player-SEASON in the pool, multiplied by a minutes count. That
// product is not a basketball quantity: the pool's mean ppg is dragged down by
// every deep reserve in it, and no team is made of league-average players in
// league-average minutes. It came to 87.6.
//
// The anchor is `overall.teamPpg` now - the median of what the pool's own
// team-seasons actually scored, which is 102.1 and is a number with a meaning.
//
// WHAT IS ASSERTED, AND WHAT DELIBERATELY IS NOT
//
// Not a league average. The brief this engine is built to says roster
// construction, era, strategy and matchup are supposed to move scoring, and a
// simulation pinned to 114.0 would have none of that. What is asserted is that
// the DISTRIBUTION is a basketball distribution: the middle in the right place,
// the tails wide enough to contain a rock fight and a shootout, and the anchor
// itself derived from the data rather than typed in.
//
// ROSTERS ARE DRAFTED, NOT SAMPLED. This matters more than anything else here.
// A roster of ten players drawn uniformly from 10,290 rows is far weaker than
// one a player drafts - measured, 95 points against 111 - so a check that
// sampled would be measuring its own harness. Both sides draft with the bot at
// full strength, the same way tools/calibrate-variance.mjs builds the pairs it
// solves balance against.

import { computeDatasetStats, simulateGame } from "../js/sports/nba/engine.js";
import { DraftState } from "../js/draft.js";
import { RANKED_SLOTS } from "../js/sports/nba/constants.js";
import NBA from "../js/sports/nba/index.js";
import { renderCheck, renderSection, renderTable, summarize, PASS, FAIL } from "./lib/report.mjs";
import { loadDataset } from "../data/load.mjs";

const PLAYERS = await loadDataset("nba-players");
// DraftState drafts through the sport registry, and basketball's simulation
// loads on demand with its dataset - see preload() in js/sports/nba/index.js.
await NBA.preload();
const stats = computeDatasetStats(PLAYERS);
const GAMES = Number(process.env.SCORING_GAMES || 120);

function draftedPair() {
  const g = new DraftState(PLAYERS, [], RANKED_SLOTS);
  while (!g.isComplete()) {
    if (!g.rollNextSquad()) break;
    // banTop: 0 - the bot at full strength on both sides, so the rosters are
    // the ones real games are played with rather than the nerfed practice bot's.
    g.botAutoPick("A", { banTop: 0 });
    g.botAutoPick("B", { banTop: 0 });
  }
  return g;
}

const scores = [];
const margins = [];
let overtimes = 0;
for (let i = 0; i < GAMES; i++) {
  const g = draftedPair();
  const result = simulateGame(g.rosterA, g.rosterB, stats);
  scores.push(result.teamScoreA, result.teamScoreB);
  margins.push(Math.abs(result.teamScoreA - result.teamScoreB));
  if (result.overtimePeriods > 0) overtimes += 1;
}
scores.sort((a, b) => a - b);
margins.sort((a, b) => a - b);
const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
const mean = scores.reduce((s, v) => s + v, 0) / scores.length;

const checks = [];
const add = (title, ok, detail, extra = {}) =>
  checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail), ...extra });

// ---- the anchor is derived from the pool, not typed in ---------------------
//
// Recomputed here the long way round. If someone replaces teamPpg with a
// literal, this is what notices.
const teamSeasons = new Map();
for (const p of PLAYERS) {
  if (!p.team || !p.season) continue;
  const key = `${p.team}|${p.season}`;
  teamSeasons.set(key, (teamSeasons.get(key) || 0) + p.ppg);
}
const totals = [...teamSeasons.values()].sort((a, b) => a - b);
const independent = totals[totals.length >> 1];
add(
  "The scoring anchor is measured off the dataset, not chosen",
  Math.abs(stats.overall.teamPpg - independent) < 0.001,
  `${stats.overall.teamPpg.toFixed(1)} points, the median of ${totals.length} team-seasons in the pool ` +
    `(p10 ${q(totals, 0.1).toFixed(0)}, p90 ${q(totals, 0.9).toFixed(0)}) - recomputed independently here and identical`
);

// ---- the middle is where the NBA's is --------------------------------------
add(
  "A drafted team scores like an NBA team",
  mean >= 103 && mean <= 122,
  `mean ${mean.toFixed(1)}, median ${q(scores, 0.5)} over ${GAMES} drafted games ` +
    `(the real NBA has run 97-115 a team across the seasons this dataset covers)`,
  {
    table: [
      ["", "p05", "p25", "median", "p75", "p95", "min", "max"],
      [
        "team score",
        String(q(scores, 0.05)), String(q(scores, 0.25)), String(q(scores, 0.5)),
        String(q(scores, 0.75)), String(q(scores, 0.95)), String(scores[0]), String(scores[scores.length - 1]),
      ],
    ],
  }
);

// ---- and the tails are real ------------------------------------------------
add(
  "Low-scoring and high-scoring games both happen",
  q(scores, 0.05) < 100 && q(scores, 0.95) > 125 && scores[scores.length - 1] > 135,
  `p05 ${q(scores, 0.05)} and p95 ${q(scores, 0.95)}, low ${scores[0]} and high ${scores[scores.length - 1]} - ` +
    `a rock fight and a shootout are both inside this distribution, which is the point of not pinning it to an average`
);

// ---- nothing absurd --------------------------------------------------------
add(
  "No game runs away with itself",
  scores[scores.length - 1] < 190 && q(margins, 0.5) < 20,
  `biggest team score ${scores[scores.length - 1]} (hard clamp 190), median margin ${q(margins, 0.5)}, ` +
    `p90 margin ${q(margins, 0.9)}, largest ${margins[margins.length - 1]}`
);

// ---- overtime stays rare ---------------------------------------------------
//
// A scoring level that moved without the rest of the model moving with it would
// show up here first: overtime happens when two totals round to the same number,
// so it is a direct read on whether the margin distribution still has its shape.
add(
  "Overtime is rare",
  overtimes / GAMES < 0.12,
  `${((100 * overtimes) / GAMES).toFixed(1)}% of ${GAMES} games went to overtime (the real NBA runs about 6%)`
);

console.log(renderSection(`NBA scoring level (${GAMES} drafted games)`));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
