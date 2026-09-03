// Solves the per-team-per-quarter variance range that makes a clearly-better
// roster win roughly as often as intended, instead of sweeping every quarter.
//
// Run: node tools/calibrate-variance.mjs
// Paste the solved range into TEAM_QUARTER_VARIANCE_MIN/MAX in
// js/sports/nba/constants.js.
//
// Why this term exists at all: every other random roll in the engine is
// per-player and independent, so across a roster the noise cancels - team
// level swing shrinks by roughly the square root of the roster size. Measured
// before the term was added, the stronger roster won 93.5% of quarters and
// swept all four in 88.8% of games. Widening the per-player range cannot fix
// that; only a factor every player on a team SHARES survives the averaging.
import { PLAYERS } from "../data/nba-players.js";
import { computeDatasetStats, simulateGame, impact } from "../js/sports/nba/engine.js";
import { DraftState } from "../js/draft.js";
import { RANKED_SLOTS } from "../js/sports/nba/constants.js";

const stats = computeDatasetStats(PLAYERS);

// Only rosters with a real talent gap are informative: two evenly-matched
// teams SHOULD split near 50%, so including them would drag every measurement
// toward 50 regardless of how the variance is tuned.
const MIN_IMPACT_GAP = 8;
const TARGET_GAME_WIN = 75;

function rosterPair() {
  const g = new DraftState(PLAYERS, [], RANKED_SLOTS);
  while (!g.isComplete()) {
    if (!g.rollNextSquad()) break;
    // banTop: 0 keeps the bot at FULL STRENGTH here. The bot is deliberately
    // barred from the top of the board in a real game (see BOT_TOP_PICK_BAN),
    // but this harness drafts BOTH sides with it to produce evenly matched
    // rosters for solving balance constants against. Letting the difficulty
    // nerf in would re-solve TALENT_PARITY and the variance range against
    // rosters no online game is ever played with.
    g.botAutoPick("A", { banTop: 0 });
    g.botAutoPick("B", { banTop: 0 });
  }
  return g;
}

function measure(spread, games, parity) {
  const teamVariance = { min: 1 - spread, max: 1 + spread };
  let qWins = 0, qTotal = 0, gWins = 0, gTotal = 0, sweeps = 0, marginSum = 0, marginN = 0;

  while (gTotal < games) {
    const g = rosterPair();
    const impA = RANKED_SLOTS.reduce((s, x) => s + (g.rosterA[x] ? impact(g.rosterA[x]) : 0), 0);
    const impB = RANKED_SLOTS.reduce((s, x) => s + (g.rosterB[x] ? impact(g.rosterB[x]) : 0), 0);
    if (Math.abs(impA - impB) < MIN_IMPACT_GAP) continue;

    const strong = impA > impB ? "a" : "b";
    const r = simulateGame(g.rosterA, g.rosterB, stats, { teamVariance, parity });

    let won = 0, played = 0;
    for (const q of r.quarterBoxScores) {
      const a = Object.values(q.a).reduce((s, l) => s + l.pts, 0);
      const b = Object.values(q.b).reduce((s, l) => s + l.pts, 0);
      marginSum += Math.abs(a - b);
      marginN += 1;
      if (Math.round(a) === Math.round(b)) continue;
      played += 1;
      if ((a > b ? "a" : "b") === strong) won += 1;
    }

    qWins += won;
    qTotal += played;
    if (played > 0 && won === played) sweeps += 1;
    gTotal += 1;
    if ((r.teamScoreA > r.teamScoreB ? "a" : "b") === strong) gWins += 1;
  }

  return {
    gameWin: (100 * gWins) / gTotal,
    quarterWin: (100 * qWins) / qTotal,
    sweep: (100 * sweeps) / gTotal,
    margin: marginSum / marginN,
  };
}

// Two levers that control DIFFERENT things, so both have to be solved:
//   parity -> size of the systematic talent gap -> GAME win rate
//   spread -> size of the correlated quarter noise -> QUARTER flips & margin
// For each candidate spread we re-solve parity to hold the game-win target,
// then read off which spread also lands the quarter/sweep/margin targets.
const TARGET_MARGIN = 7;
const TARGET_SWEEP = 27;

/**
 * The most parity this engine will actually ship, whatever the solve asks for.
 *
 * TARGET_GAME_WIN is measured at a gap of MIN_IMPACT_GAP, and that is not the
 * only mismatch the game produces. scripts/verify-simulation-statistics.mjs
 * plays a deliberately lopsided pair and holds the stronger side to at most
 * 90% - a mismatch may be one-sided and may not be a certainty - and parity
 * crosses that somewhere between 0.40 and 0.43 (91.6% at 0.43, 95.8% at
 * 0.496). Without this bound the tool prints a number that cannot ship, and
 * the last run did exactly that.
 */
const PARITY_CEILING = 0.40;

function solveParity(spread, games = 260, iters = 8) {
  let lo = 0, hi = PARITY_CEILING, parity = 0.5;
  for (let i = 0; i < iters; i++) {
    parity = (lo + hi) / 2;
    const m = measure(spread, games, parity);
    if (m.gameWin > TARGET_GAME_WIN) hi = parity;
    else lo = parity;
  }
  return parity;
}

console.log("spread | parity | game% | qtr% | sweep% | margin");
console.log("-------|--------|-------|------|--------|-------");
let best = null;
for (const spread of [0.18, 0.26, 0.34, 0.42, 0.50]) {
  const parity = solveParity(spread);
  const m = measure(spread, 900, parity);
  console.log(
    ` ${(100*spread).toFixed(0).padStart(4)}% | ${parity.toFixed(3)}  | ` +
    `${m.gameWin.toFixed(1)} | ${m.quarterWin.toFixed(1)} | ${m.sweep.toFixed(1)}   | ${m.margin.toFixed(1)}`
  );
  const cost = Math.abs(m.sweep - TARGET_SWEEP) / TARGET_SWEEP + Math.abs(m.margin - TARGET_MARGIN) / TARGET_MARGIN;
  if (!best || cost < best.cost) best = { spread, parity, cost, ...m };
}

console.log(`\nbest fit: spread ±${(100*best.spread).toFixed(0)}%  parity ${best.parity.toFixed(3)}`);
console.log("\nverification run (2000 games):");
const final = measure(best.spread, 2000, best.parity);
console.log(`  stronger wins game:    ${final.gameWin.toFixed(1)}%  (target ${TARGET_GAME_WIN}%)`);
console.log(`  stronger wins quarter: ${final.quarterWin.toFixed(1)}%`);
console.log(`  sweeps all quarters:   ${final.sweep.toFixed(1)}%  (target ~${TARGET_SWEEP}%)`);
console.log(`  mean quarter margin:   ${final.margin.toFixed(1)}  (target ~${TARGET_MARGIN})`);
if (final.gameWin < TARGET_GAME_WIN - 2) {
  console.log(
    `\n  ^ SHORT OF THE WIN-RATE TARGET, AND CAPPED THERE ON PURPOSE. Parity is\n` +
      `    bounded at ${PARITY_CEILING} because a lopsided pair must still be a game -\n` +
      `    see PARITY_CEILING in this file. Raising it buys win rate at that gap by\n` +
      `    turning every larger mismatch into a certainty.`
  );
}
console.log(`\nexport const TALENT_PARITY = ${best.parity.toFixed(3)};`);
console.log(`export const TEAM_QUARTER_VARIANCE_MIN = ${(1-best.spread).toFixed(2)};`);
console.log(`export const TEAM_QUARTER_VARIANCE_MAX = ${(1+best.spread).toFixed(2)};`);
