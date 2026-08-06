import assert from "node:assert/strict";
import { PLAYERS } from "../data/nba-players.js";
import {
  activeSlots,
  computeDatasetStats,
  defaultMatchups,
  defaultMinutes,
  impact,
  simulateGame,
} from "../js/sports/nba/engine.js";
import { RANKED_SLOTS, STARTER_SLOTS } from "../js/sports/nba/constants.js";
import { createSeededRng, withSeededMathRandom } from "../js/lib/seeded-rng.js";

const RUNS = Number(process.env.SIM_RUNS || 5000);
const dataset = computeDatasetStats(PLAYERS);
const eligible = PLAYERS.filter((p) => Array.isArray(p.pos) && p.pos.length > 0);

function playerKey(player) {
  return `${player.name}|${player.team}|${player.season ?? player.decade}`;
}

/**
 * Picks from a percentile of the position pool instead of the absolute best or
 * worst player ever recorded. Absolute extremes created an intentionally
 * absurd matchup that the stronger side won 100% of the time; that measures
 * whether Michael Jordan beats a fringe roster, not whether normal ranked
 * talent differences are calibrated correctly.
 */
function playerForPosition(pool, position, used, percentile) {
  const candidates = pool
    .filter((p) => p.pos.includes(position) && !used.has(playerKey(p)))
    .sort((a, b) => impact(b) - impact(a));
  assert(candidates.length > 0, `No player found for ${position}`);
  const index = Math.min(candidates.length - 1, Math.max(0, Math.floor((candidates.length - 1) * percentile)));
  const picked = candidates[index];
  used.add(playerKey(picked));
  return picked;
}

function buildRoster(percentile) {
  const used = new Set();
  const roster = {};
  for (const slot of STARTER_SLOTS) roster[slot] = playerForPosition(eligible, slot, used, percentile);
  for (let i = 0; i < 5; i++) {
    const position = STARTER_SLOTS[i];
    roster[`BENCH${i + 1}`] = playerForPosition(eligible, position, used, percentile);
  }
  assert.deepEqual(activeSlots(roster).sort(), [...RANKED_SLOTS].sort());
  return roster;
}

// Realistic ranked tiers: good-but-not-all-time-great versus below-average,
// not global maximums versus global minimums.
const strong = buildRoster(0.22);
const weak = buildRoster(0.58);

function options(a, b, extra = {}) {
  return {
    tacticA: "balanced",
    tacticB: "balanced",
    minutesA: defaultMinutes(a),
    minutesB: defaultMinutes(b),
    matchupsA: defaultMatchups(a, b),
    matchupsB: defaultMatchups(b, a),
    ...extra,
  };
}

function simulate(seed, a, b, extra) {
  return withSeededMathRandom(seed, () => simulateGame(a, b, dataset, options(a, b, extra)));
}

// Exact replay: same inputs and seed must produce byte-identical output.
const replayA = simulate(123456, strong, weak);
const replayB = simulate(123456, strong, weak);
assert.deepEqual(replayA, replayB, "same seed did not reproduce the same game");

let strongWins = 0;
let swappedStrongWins = 0;
let fullWinsAgainstForfeit = 0;
let balancedWins = 0;
let lockdownWins = 0;
let marginSum = 0;

for (let i = 0; i < RUNS; i++) {
  const seed = i + 1;
  const normal = simulate(seed, strong, weak);
  if (normal.winner === "A") strongWins++;
  marginSum += normal.teamScoreA - normal.teamScoreB;

  const swapped = simulate(seed, weak, strong);
  if (swapped.winner === "B") swappedStrongWins++;

  const forfeit = simulate(seed, strong, strong, { forfeitsB: ["BENCH4", "BENCH5"] });
  if (forfeit.winner === "A") fullWinsAgainstForfeit++;

  const tactic = withSeededMathRandom(seed, () => simulateGame(strong, strong, dataset, {
    ...options(strong, strong),
    tacticA: "balanced",
    tacticB: "lockdown-defense",
  }));
  if (tactic.winner === "A") balancedWins++;
  else lockdownWins++;
}

const pct = (n) => n / RUNS;
const strongRate = pct(strongWins);
const swappedRate = pct(swappedStrongWins);
const forfeitRate = pct(fullWinsAgainstForfeit);
const sideGap = Math.abs(strongRate - swappedRate);
const tacticRate = pct(balancedWins);

assert(strongRate >= 0.58 && strongRate <= 0.90, `realistic stronger roster win rate ${strongRate} outside expected range`);
assert(sideGap <= 0.04, `side symmetry gap ${sideGap} is too large`);
assert(forfeitRate >= 0.58, `two forfeits were not penalized enough: ${forfeitRate}`);
assert(tacticRate >= 0.42 && tacticRate <= 0.58, `tactic matchup appears unbalanced: ${tacticRate}`);

// PRNG sanity: independent instances with the same seed must match.
const rngA = createSeededRng("ballknowledge");
const rngB = createSeededRng("ballknowledge");
for (let i = 0; i < 100; i++) assert.equal(rngA(), rngB());

console.log(JSON.stringify({
  runs: RUNS,
  strongRosterPercentile: 0.22,
  weakRosterPercentile: 0.58,
  strongRosterWinRate: strongRate,
  swappedStrongRosterWinRate: swappedRate,
  sideSymmetryGap: sideGap,
  fullRosterVsTwoForfeitsWinRate: forfeitRate,
  balancedVsLockdownWinRate: tacticRate,
  meanStrongRosterMargin: marginSum / RUNS,
}, null, 2));
