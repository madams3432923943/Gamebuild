// Solves football's two balance levers: TALENT_PARITY and the per-quarter
// variance range.
//
// Run: node tools/calibrate-nfl-variance.mjs
// Paste the block it prints into js/sports/nfl/constants.js, then copy that
// file to supabase/functions/simulate-match/sports/nfl/ (npm run verify:parity).
//
// This is the football half of what tools/calibrate-variance.mjs does for
// basketball, and it exists because until now football had neither: both
// levers were authored by hand, the file said so, and TALENT_PARITY's own
// comment ended "It should still be solved."
//
// ORDER MATTERS, AND IT IS NOT THE OBVIOUS ONE
//
// Variance first, tactics second. Gamestyles solved against the wrong noise
// floor are solved wrong, because a plan's win rate is measured against
// whatever spread the engine happens to have when you measure it. So this tool
// runs before tools/calibrate-nfl-gamestyles.mjs, and every plan is re-solved
// after this one moves anything.
//
// WHY THE VARIANCE LEVER USED TO DO NOTHING
//
// The first run of this tool measured the same mean final margin - 11.0 points
// against 10.8 - at ±22% and at ±54%. A lever that does nothing when you more
// than double it is not a lever, and it is not solvable either.
//
// The cause was in the engine, not here: the roll was drawn PER DRIVE. Eleven
// independent draws a game average out to almost nothing at the team level,
// which is the same square-root cancellation that made basketball's per-player
// noise unable to make quarters competitive. It is now drawn once per team per
// quarter and shared across that quarter's drives (see quarterRoll in
// js/sports/nfl/engine.js), which is what the constant's name always claimed.
//
// It still moves less than basketball's does, and that is real rather than a
// bug: basketball's roll multiplies POINTS, so a 30% hot quarter is 30% more
// points. Football's multiplies DRIVE QUALITY, which feeds a probability
// chart that is clamped at both ends - so the same 30% buys far less. Expect a
// shallow response curve and do not read a flat one as a broken harness.
//
// WHERE THE TARGETS COME FROM, SAID PLAINLY
//
//   Game win rate (75%) is a PRODUCT DECISION, not a football measurement, and
//   it is basketball's number on purpose. Ranked shares one ELO ladder and one
//   set of rank thresholds across both sports; if a football draft decided
//   games at a different rate than a basketball one, the same rating point
//   would mean two different things depending on which tile you tapped.
//
//   Mean final margin (11.5) and the one-score share (45%) are REFERENCE
//   FIGURES for the real NFL - the same status as the "real NFL" column in
//   scripts/verify-nfl-realism.mjs. Nothing in this repository measures them:
//   the dataset is per player per season and carries no game results, so there
//   is no scoreboard here to check them against. They are the shape targets
//   because they are what a viewer actually perceives about a football game -
//   how far apart it finished, and whether it was still a game at the end.
//
//   Draft Nova scores about 24 a team against the real league's 22, and is
//   deliberately above it on YARDAGE rather than on points (see the
//   design-target note in verify-nfl-realism.mjs). The margin target is not
//   scaled: a game that finished 27-16 reads as an eleven-point game to the
//   person watching it regardless of how the points got there, and scaling
//   would be inventing a football number from a product decision.
//
// The sweep rate is REPORTED but not targeted. Basketball targets it because
// basketball quarters essentially never tie; football quarters tie constantly
// - a 0-0 quarter is ordinary - so the statistic is mostly noise here and
// fitting to it would be fitting to nothing.
import { NFL } from "../js/sports/nfl/index.js";
import { setActiveSport } from "../js/sports/index.js";
import { rosterRatings } from "../js/sports/nfl/engine.js";
import { DraftState } from "../js/draft.js";

setActiveSport("nfl");
await NFL.preload();

const ctx = NFL.computeDatasetStats();
const POOL = NFL.playersInEra(NFL.players(), "all");
const SLOTS = NFL.slots.ranked;

/** Combined offence + defence, which is what the drive model actually reads:
 * A's drives run against B's defence and B's against A's, so the net
 * advantage is (offA + defA) - (offB + defB). Rating a roster by its offence
 * alone would call a team with three receivers and no front seven the better
 * side. */
const strength = (roster) => {
  const r = rosterRatings(roster, ctx);
  return r.off + r.def;
};

/** TWO POPULATIONS, MEASURED SEPARATELY, AND THE FIRST VERSION OF THIS TOOL
 * GOT IT WRONG.
 *
 * It measured everything - win rate AND margin shape - over mismatched pairs
 * only, then compared the resulting margin to the real NFL's. That comparison
 * is not valid: the real league's eleven-and-a-half point average is taken
 * over EVERY game it plays, most of which are between teams of similar
 * quality, while a "gap >= 0.10" sample is football's most lopsided quarter by
 * construction. It reported a 13.1 margin as a 1.6-point miss when the two
 * numbers were describing different things, and the solver then spent the
 * variance lever trying to close a gap that was an artefact of the sample.
 *
 * So the two targets read two populations:
 *
 *   WIN RATE is measured over MISMATCHED pairs. Two evenly-matched teams
 *   should split near 50% however the levers are set, so including them drags
 *   the measurement toward 50 and tells you nothing about whether the draft
 *   decided anything.
 *
 *   MARGIN SHAPE is measured over EVERY drafted pair, mismatched or not,
 *   because that is the population the reference figures describe and the
 *   population a player actually queues into.
 *
 * Below is the threshold for the first of those.
 *
 * 0.10 is the top quartile of drafted pairs, measured over 200 bot-vs-bot
 * ranked drafts (median gap 0.057, p75 0.102, p90 0.142). Set it at the p90
 * instead and there are too few qualifying pairs to bisect against; set it at
 * the median and "the better roster" is a coin toss by construction. The
 * TARGET_GAME_WIN below is the win rate AT THIS GAP and means nothing without
 * it - quoting a win rate without saying which mismatch produced it is how
 * TALENT_PARITY ended up hand-set in the first place. */
const MIN_RATING_GAP = 0.10;

const TARGET_GAME_WIN = 75;      // product decision - see the header

/**
 * THE CEILING THE TARGET ABOVE RUNS INTO, and the most important thing this
 * tool has to say.
 *
 * 75% is basketball's number and football's engine does not reach it. Solved
 * without a ceiling, the bisection returns about 2.5 - and at 2.5 the game
 * stops describing a weak roster and starts erasing it. Measured through
 * scripts/verify-nfl-realism.mjs, a bottom-tier quarterback's line falls from
 * 64 passing yards a game to 29, which is not a bad quarterback; it is a
 * broken one. That file now holds a floor for exactly this ("A weak
 * quarterback is rated low, not erased") so the trade cannot be made silently
 * again.
 *
 * WHY THE TWO SPORTS DIFFER HERE. Basketball converts talent into points
 * almost linearly - a better roster simply scores more. Football converts it
 * into DRIVE QUALITY, which feeds a probability chart clamped at both ends, so
 * buying the last few points of win rate costs progressively more multiplier
 * and the multiplier is what the box score is reconstructed from. The win rate
 * is bought out of the believability of the box score, and past about 1.6 the
 * price stops being worth paying.
 *
 * So the honest statement, which the run summary prints: at a top-quartile
 * talent gap this engine decides about 65% of games, not 75%, and the shortfall
 * is a property of the model rather than a value anyone chose. Closing it means
 * changing how football converts talent into drives - not turning this knob
 * further.
 */
const PARITY_CEILING = 1.6;
const TARGET_MARGIN = 11.5;      // real-NFL reference figure
const TARGET_ONE_SCORE = 45;     // real-NFL reference figure, % of games within 8

function rosterPair() {
  const g = new DraftState(POOL, [], SLOTS);
  while (!g.isComplete()) {
    if (!g.rollNextSquad()) break;
    // banTop: 0 keeps the bot at FULL STRENGTH. The bot is deliberately barred
    // from the top of the board in a real game (BOT_TOP_PICK_BAN), but this
    // harness drafts BOTH sides with it to produce comparable rosters. Letting
    // the difficulty nerf in would solve the levers against rosters no online
    // game is ever played with. verify:bot-difficulty asserts this override
    // still works, for exactly this reason.
    g.botAutoPick("A", { banTop: 0 });
    g.botAutoPick("B", { banTop: 0 });
  }
  return g;
}

/** Drafting is the expensive half of a measurement - about 10ms against 2ms
 * for a simulation - so pairs are drafted once and replayed at every candidate
 * setting. It also removes roster luck from the comparison: every spread and
 * every parity is measured on the SAME rosters, so a difference between two
 * settings is the setting rather than the draw. */
function drawPairs(count, { mismatchedOnly }) {
  const pairs = [];
  while (pairs.length < count) {
    const g = rosterPair();
    if (!g.isComplete()) continue;
    const gap = strength(g.rosterA) - strength(g.rosterB);
    if (mismatchedOnly && Math.abs(gap) < MIN_RATING_GAP) continue;
    pairs.push({ rosterA: g.rosterA, rosterB: g.rosterB, strong: gap > 0 ? "A" : "B" });
  }
  return pairs;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const periodPoints = (lines) => Object.values(lines).reduce((s, l) => s + (l.pts || 0), 0);

function measure(pairs, repeats, spread, parity) {
  const teamVariance = { min: 1 - spread, max: 1 + spread };
  const margins = [];
  const quarterMargins = [];
  const scores = [];
  let gWins = 0, gTotal = 0, qWins = 0, qTotal = 0, sweeps = 0, oneScore = 0;

  for (const pair of pairs) {
    for (let i = 0; i < repeats; i++) {
      const r = NFL.simulate(pair.rosterA, pair.rosterB, ctx, { teamVariance, parity });
      const winner = r.teamScoreA > r.teamScoreB ? "A" : "B";
      gTotal += 1;
      if (winner === pair.strong) gWins += 1;
      const margin = Math.abs(r.teamScoreA - r.teamScoreB);
      margins.push(margin);
      scores.push(r.teamScoreA, r.teamScoreB);
      if (margin <= 8) oneScore += 1;

      // Regulation only. Overtime periods are not quarters and a game that
      // needed one is a tied game by definition, so counting them would report
      // the same thing twice.
      let won = 0, played = 0;
      for (const period of r.quarterBoxScores.slice(0, 4)) {
        const a = periodPoints(period.a);
        const b = periodPoints(period.b);
        quarterMargins.push(Math.abs(a - b));
        if (Math.round(a) === Math.round(b)) continue;
        played += 1;
        if ((a > b ? "A" : "B") === pair.strong) won += 1;
      }
      qWins += won;
      qTotal += played;
      if (played === 4 && won === 4) sweeps += 1;
    }
  }

  return {
    gameWin: (100 * gWins) / gTotal,
    quarterWin: (100 * qWins) / Math.max(1, qTotal),
    sweep: (100 * sweeps) / gTotal,
    oneScore: (100 * oneScore) / gTotal,
    margin: mean(margins),
    quarterMargin: mean(quarterMargins),
    score: mean(scores),
  };
}

/**
 * Two levers, two different jobs, so both have to be solved:
 *   parity -> size of the systematic talent gap -> GAME win rate
 *   spread -> size of the correlated quarter noise -> margins & closeness
 * For each candidate spread we re-solve parity to hold the game-win target,
 * then read off which spread also lands the margin shape.
 */
function solveParity(pairs, spread, repeats, iters) {  // pairs: mismatched only
  let lo = 0, hi = PARITY_CEILING, parity = 1;
  for (let i = 0; i < iters; i++) {
    parity = (lo + hi) / 2;
    if (measure(pairs, repeats, spread, parity).gameWin > TARGET_GAME_WIN) hi = parity;
    else lo = parity;
  }
  // Bisection that never came down off the ceiling means the target was not
  // reachable inside it, which is the expected outcome today - see
  // PARITY_CEILING. Returning the ceiling itself rather than the midpoint of a
  // range it never left keeps the reported value honest.
  return parity > PARITY_CEILING * 0.98 ? PARITY_CEILING : parity;
}

/**
 * The spreads tried, and why the list stops at ±54%.
 *
 * With parity pinned at its ceiling, noise becomes the only lever left that
 * can widen margins toward the reference, and an unbounded sweep duly runs to
 * the end of whatever range it is offered: at ±86% the fit is still improving.
 * It should not be followed there. A quarter multiplier of 0.14 is a team that
 * did not turn up for fifteen minutes, and buying the margin distribution with
 * that is the same trade PARITY_CEILING refuses - a statistic bought out of
 * the believability of the thing being measured.
 *
 * ±54% is the widest swing that still reads as a football quarter: a team
 * roughly halving or half-again its normal drive quality for a period, which
 * is a hot streak or a stalled offence rather than an absence. Anything beyond
 * it is listed here to show the curve keeps going, and is not selectable.
 */
const SPREADS = [0.14, 0.22, 0.30, 0.38, 0.46, 0.54];
const SOLVE_PAIRS = Number(process.env.NFL_CAL_PAIRS || 90);
const SHAPE_PAIRS = Number(process.env.NFL_CAL_SHAPE_PAIRS || 90);
const SOLVE_REPEATS = Number(process.env.NFL_CAL_REPEATS || 10);
const FINAL_REPEATS = Number(process.env.NFL_CAL_FINAL || 60);

console.log(`drafting ${SOLVE_PAIRS} mismatched pairs (gap >= ${MIN_RATING_GAP}) for the win-rate solve`);
const gapPairs = drawPairs(SOLVE_PAIRS, { mismatchedOnly: true });
console.log(`drafting ${SHAPE_PAIRS} unfiltered pairs for the margin shape`);
const allPairs = drawPairs(SHAPE_PAIRS, { mismatchedOnly: false });
console.log(`solving over ${SOLVE_PAIRS * SOLVE_REPEATS} games per candidate\n`);

console.log("       |        | mismatched pairs | every drafted pair");
console.log("spread | parity | game% | qtr%     | margin | 1-score | sweep% | qtr marg | score");
console.log("-------|--------|-------|----------|--------|---------|--------|----------|------");
let best = null;
for (const spread of SPREADS) {
  const parity = solveParity(gapPairs, spread, SOLVE_REPEATS, 9);
  const gap = measure(gapPairs, FINAL_REPEATS, spread, parity);
  const m = measure(allPairs, FINAL_REPEATS, spread, parity);
  console.log(
    ` ${(100 * spread).toFixed(0).padStart(5)}% | ${parity.toFixed(3)}  | ` +
      `${gap.gameWin.toFixed(1)}  | ${gap.quarterWin.toFixed(1)}     | ${m.margin.toFixed(2).padStart(6)} | ` +
      `${m.oneScore.toFixed(1).padStart(6)}% | ${m.sweep.toFixed(1).padStart(5)}% | ` +
      `${m.quarterMargin.toFixed(2).padStart(8)} | ${m.score.toFixed(1)}`
  );
  // Both shape targets, normalised so neither dominates by being bigger.
  const cost =
    Math.abs(m.margin - TARGET_MARGIN) / TARGET_MARGIN +
    Math.abs(m.oneScore - TARGET_ONE_SCORE) / TARGET_ONE_SCORE;
  if (!best || cost < best.cost) best = { spread, parity, cost, gameWin: gap.gameWin, ...m };
}

console.log(`\nbest fit: spread ±${(100 * best.spread).toFixed(0)}%  parity ${best.parity.toFixed(3)}  (cost ${best.cost.toFixed(4)})`);
if (best.spread === SPREADS[SPREADS.length - 1]) {
  console.log(
    "  ^ AT THE EDGE OF THE SWEEP, which is expected while parity is capped: " +
      "noise is the only lever left able to widen margins, so the fit keeps " +
      "improving as long as it is offered more. See the note on SPREADS. The " +
      "remaining distance to the reference margin is a property of how this " +
      "engine converts talent into drives, not a knob left unturned."
  );
}

console.log("\nverification run, fresh rosters the solve never saw:");
const holdoutGap = drawPairs(Math.max(30, Math.round(SOLVE_PAIRS / 2)), { mismatchedOnly: true });
const holdoutAll = drawPairs(Math.max(30, Math.round(SHAPE_PAIRS / 2)), { mismatchedOnly: false });
const decided = measure(holdoutGap, FINAL_REPEATS, best.spread, best.parity);
const final = measure(holdoutAll, FINAL_REPEATS, best.spread, best.parity);
console.log(`  stronger roster wins:  ${decided.gameWin.toFixed(1)}%  (target ${TARGET_GAME_WIN}%, at a rating gap >= ${MIN_RATING_GAP})`);
if (decided.gameWin < TARGET_GAME_WIN - 2) {
  console.log(
    `    ^ SHORT OF TARGET, AND EXPECTED TO BE. Parity is capped at ` +
      `${PARITY_CEILING} because past it the engine stops rating a weak roster ` +
      `and starts erasing it - see PARITY_CEILING in this file, and the "weak ` +
      `quarterback is rated low, not erased" check in verify-nfl-realism. ` +
      `Raising the cap to close this gap trades a believable box score for a ` +
      `win rate; changing how football converts talent into drives is the real fix.`
  );
}
console.log(`  stronger wins quarter: ${decided.quarterWin.toFixed(1)}%`);
console.log("  -- the four below are over EVERY drafted pair, which is what the references describe --");
console.log(`  mean final margin:     ${final.margin.toFixed(2)}  (reference ~${TARGET_MARGIN})`);
console.log(`  games within 8 points: ${final.oneScore.toFixed(1)}%  (reference ~${TARGET_ONE_SCORE}%)`);
console.log(`  sweeps all 4 quarters: ${final.sweep.toFixed(1)}%  (reported, not targeted)`);
console.log(`  mean quarter margin:   ${final.quarterMargin.toFixed(2)}`);
console.log(`  mean team score:       ${final.score.toFixed(1)}`);

console.log(`\nexport const TALENT_PARITY = ${best.parity.toFixed(2)};`);
console.log(`export const TEAM_QUARTER_VARIANCE_MIN = ${(1 - best.spread).toFixed(2)};`);
console.log(`export const TEAM_QUARTER_VARIANCE_MAX = ${(1 + best.spread).toFixed(2)};`);
