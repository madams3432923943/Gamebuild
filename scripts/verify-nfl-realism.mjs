#!/usr/bin/env node
// Does the man on the field matter, and does he play a football-shaped game?
//
// DESIGN TARGET: DRAFT NOVA IS DELIBERATELY MORE EXPLOSIVE THAN THE NFL.
//
// The "real NFL" column in the rate table below is a REFERENCE, not a goal.
// Draft Nova aims for about 350 yards a team at 5.8 a play, against the real
// league's 340 and 5.4. That is a product decision, not a calibration that
// drifted: a roster drafted from every season ever played should not perform
// like a league average, and a game people come back to is a game where things
// happen. So a simulated number sitting ABOVE its reference in that table is
// working as intended, and "fixing" it back down would be undoing the choice.
//
// The CHECKS are what constrain this, and they are bands rather than points -
// yards per play must land in 4.8-6.2, a drive in 26-36 yards, a game in 56-70
// snaps, a carry in 3.8-5.0. Football stopping being football is what they
// forbid; where inside football's range this game sits is a decision, and it
// sits high on purpose. Three constants hold it there and only work as a set:
// driveYards' `reach`, the snaps divisor in buildPlays, and RUN_YARD_WEIGHT.
// Each one carries the reasoning at its own definition in js/sports/nfl/engine.js.
//
// WHY THIS EXISTS
//
// Live testing produced three lines that a football fan would reject:
//
//   Skylar Thompson 2022   25/42, 280 yards, 3 TD   (really 76.3 yds/game)
//   Michael Carter 2023    81 rushing yards         (really 24.8 yds/game)
//   Joe Burrow             479 yards on 64 attempts (64 attempts is not a game)
//
// Two separate faults, and they need separate measurements.
//
// SEPARATION. Player quality reached the DRIVE model - a bad quarterback
// lowers his team's rating - but it never reached the PLAY model. Completion
// rate, yards per attempt and sack rate were global constants, so every
// quarterback in history completed the same share of his throws. A backup
// handed a good team's drives produced an elite line, because the box score
// was reconstructed at league-average efficiency.
//
// VOLUME. Attempts are whatever the drive reconstruction happens to need, so
// a long-drive game runs to 60+ attempts. Real quarterbacks throw ~33 times.
//
// The tiers below are cut from each player's OWN per-game production in the
// dataset, which is real. Nothing here invents a rating: a quarterback who
// threw for 76 yards a game is in the bottom tier because that is what he did.

import { NFL } from "../js/sports/nfl/index.js";
import { FG_RANGE_YARD } from "../js/sports/nfl/constants.js";
import { setActiveSport } from "../js/sports/index.js";
import { DraftState } from "../js/draft.js";

import { renderCheck, renderSection, renderTable, summarize, PASS, FAIL } from "./lib/report.mjs";

setActiveSport("nfl");
await NFL.preload();

const GAMES_PER_TIER = Number(process.env.NFL_REALISM_GAMES || 120);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const players = NFL.individuals();
const units = NFL.units();
const ctx = NFL.computeDatasetStats();

const has = (p, pos) => (p.pos || []).includes(pos);
const percentileOf = (sorted, value) => {
  let lo = 0;
  for (const v of sorted) {
    if (v <= value) lo += 1;
    else break;
  }
  return sorted.length ? lo / sorted.length : 0;
};

// ---- tiers, cut from real per-game production ------------------------------
const qbPool = players.filter((p) => has(p, "QB") && p.pass_yds > 0);
const qbYards = qbPool.map((p) => p.pass_yds).sort((a, b) => a - b);
const rbPool = players.filter((p) => has(p, "RB") && p.rush_yds > 0);
const rbYards = rbPool.map((p) => p.rush_yds).sort((a, b) => a - b);

const TIERS = [
  { key: "poor", label: "poor (bottom 20%)", lo: 0, hi: 0.2 },
  { key: "average", label: "average (40-60%)", lo: 0.4, hi: 0.6 },
  { key: "good", label: "good (75-90%)", lo: 0.75, hi: 0.9 },
  { key: "elite", label: "elite (top 5%)", lo: 0.95, hi: 1.01 },
];

const qbByTier = new Map(
  TIERS.map((t) => [
    t.key,
    qbPool.filter((p) => {
      const q = percentileOf(qbYards, p.pass_yds);
      return q >= t.lo && q < t.hi;
    }),
  ])
);
const rbByTier = new Map(
  TIERS.map((t) => [
    t.key,
    rbPool.filter((p) => {
      const q = percentileOf(rbYards, p.rush_yds);
      return q >= t.lo && q < t.hi;
    }),
  ])
);

const wrPool = players.filter((p) => has(p, "WR") && p.rec_yds > 0);
const tePool = players.filter((p) => has(p, "TE") && p.rec_yds > 0);

/**
 * The supporting cast, DRAFTED rather than picked from the middle of the pool.
 *
 * THIS USED TO BE THE MEDIAN PLAYER AT EVERY SLOT, and that was the quiet
 * fault under every rate in the table below. The reasoning for a median cast
 * was sound as far as it went - hold everything except the tested slot
 * constant, so the comparison is between quarterbacks rather than between
 * supporting casts - but it answered the wrong question. Nobody plays this
 * game with a median roster. A bot draft takes near the top of the board at
 * every slot, and the roster it produces rates 0.904 on offence against a
 * median cast's 0.461.
 *
 * That mattered because drive quality reads the ratings. Measured: the median
 * cast ran at a 0.84 multiplier while a real drafted game ran at 1.18, so
 * every band in this file - yards per play, yards per drive, plays per game -
 * was fitted to a game 30% quieter than the one people actually queue into.
 * The file reported 367 yards a team while live football was producing 489,
 * and it reported that for as long as it has existed.
 *
 * Drafting it fixes the representativeness without giving up the control: the
 * cast is drafted ONCE and then held fixed across every comparison below, so
 * two quarterbacks are still measured behind the same eleven men.
 *
 * Seeded, so the cast is the same on every run and a failure here is a change
 * in the engine rather than a change in who got drafted.
 */
function draftPair(seed) {
  const real = Math.random;
  Math.random = mulberry32(seed);
  try {
    const pool = NFL.playersInEra(NFL.players(), "all");
    const draft = new DraftState(pool, [], NFL.slots.ranked);
    while (!draft.isComplete()) {
      if (!draft.rollNextSquad()) break;
      // banTop: 0 - full strength, the same override the calibrators use and
      // for the same reason: the difficulty nerf shapes the BOT's roster, not
      // the rosters this file is meant to describe.
      draft.botAutoPick("A", { banTop: 0 });
      draft.botAutoPick("B", { banTop: 0 });
    }
    return [draft.rosterA, draft.rosterB];
  } finally {
    Math.random = real;
  }
}

const CAST = draftPair(0x5eed_1eaf)[0];
const medianRB = CAST.RB;

/** The median player of a pool by one stat. Still used to pick a NEUTRAL
 * OPPONENT quarterback - the tested roster needs something constant to play
 * against, and the point of that slot is that it is unremarkable. It is no
 * longer used to build the cast; see draftReferenceRoster above. */
function medianOf(pool, key) {
  const sorted = [...pool].sort((a, b) => (a[key] || 0) - (b[key] || 0));
  return sorted[Math.floor(sorted.length / 2)];
}

/** A full ranked roster with one slot swapped for the player under test. */
function rosterWith(overrides = {}) {
  return { ...CAST, ...overrides };
}

const BAL = { offense: "balanced-offense", defense: "balanced-defense" };

/** Every QB line from one side of one game. */
function qbLine(result, side) {
  const box = side === "A" ? result.boxA : result.boxB;
  return box.QB || {};
}

function summarise(values) {
  const s = [...values].sort((a, b) => a - b);
  const at = (f) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : 0);
  return {
    n: s.length,
    // LOW percentiles, because for a long time only the high ones existed.
    // Every band in this file was a mean, a median or a p90, so the checks
    // could only ever catch a simulation doing too MUCH - and the failure that
    // reached a live player did too little: a 9-6 final in which the winning
    // quarterback completed 8 of 28. Nothing here would have flinched at it.
    p01: at(0.01),
    p05: at(0.05),
    min: s[0] || 0,
    median: at(0.5),
    p75: at(0.75),
    p90: at(0.9),
    p95: at(0.95),
    max: s[s.length - 1] || 0,
    mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0,
  };
}

// ---- run the sample --------------------------------------------------------
const tierStats = new Map();
const allAttempts = [];
const allCarries = [];

for (const tier of TIERS) {
  const qbs = qbByTier.get(tier.key);
  const rbs = rbByTier.get(tier.key);
  if (!qbs.length) continue;
  const acc = {
    comp: 0, att: 0, yards: 0, tds: 0, ints: 0, sacked: 0, games: 0,
    attempts: [], rushYards: [], carries: [], realPassYards: 0, realRushYards: 0,
  };
  for (let i = 0; i < GAMES_PER_TIER; i++) {
    const qb = qbs[i % qbs.length];
    const rb = rbs.length ? rbs[i % rbs.length] : medianRB;
    const rosterA = rosterWith({ QB: qb, RB: rb });
    // The opponent is always the same median team, so the only thing that
    // varies across tiers is the man being measured.
    const rosterB = rosterWith({ QB: medianOf(qbPool, "pass_yds"), RB: medianRB });
    const result = NFL.simulate(rosterA, rosterB, ctx, {
      strategyA: BAL, strategyB: BAL, rand: mulberry32(i * 7919 + tier.key.length),
    });
    const line = qbLine(result, "A");
    acc.comp += line.comp || 0;
    acc.att += line.att || 0;
    acc.yards += line.pass_yds || 0;
    acc.tds += line.pass_tds || 0;
    acc.ints += line.ints || 0;
    acc.sacked += line.sacked || 0;
    acc.attempts.push(line.att || 0);
    acc.realPassYards += qb.pass_yds || 0;
    const rbLine = (result.boxA || {}).RB || {};
    acc.rushYards.push(rbLine.rush_yds || 0);
    acc.carries.push(rbLine.carries || 0);
    acc.realRushYards += rb.rush_yds || 0;
    acc.games += 1;
    allAttempts.push(line.att || 0);
    allCarries.push(rbLine.carries || 0);
  }
  tierStats.set(tier.key, acc);
}

const eff = (a) => ({
  compPct: a.att ? a.comp / a.att : 0,
  ypa: a.att ? a.yards / a.att : 0,
  yardsPerGame: a.games ? a.yards / a.games : 0,
  realYardsPerGame: a.games ? a.realPassYards / a.games : 0,
  tdPerGame: a.games ? a.tds / a.games : 0,
  rushPerGame: a.games ? a.rushYards.reduce((x, y) => x + y, 0) / a.games : 0,
  realRushPerGame: a.games ? a.realRushYards / a.games : 0,
});

console.log(renderSection(`NFL realism: player quality and volume (${GAMES_PER_TIER} games per tier)`));

const rows = [["tier", "real PY/g", "sim PY/g", "comp%", "YPA", "PTD/g", "real RY/g", "sim RY/g"]];
for (const tier of TIERS) {
  const a = tierStats.get(tier.key);
  if (!a) continue;
  const e = eff(a);
  rows.push([
    tier.label,
    e.realYardsPerGame.toFixed(0),
    e.yardsPerGame.toFixed(0),
    `${(e.compPct * 100).toFixed(1)}%`,
    e.ypa.toFixed(2),
    e.tdPerGame.toFixed(2),
    e.realRushPerGame.toFixed(0),
    e.rushPerGame.toFixed(0),
  ]);
}
console.log(renderTable(rows));

const attempts = summarise(allAttempts);
const carries = summarise(allCarries);
const over = (list, n) => list.filter((v) => v >= n).length / Math.max(1, list.length);

console.log(
  renderTable([
    ["distribution", "median", "p75", "p90", "p95", "max"],
    ["QB pass attempts", attempts.median, attempts.p75, attempts.p90, attempts.p95, attempts.max],
    ["RB carries", carries.median, carries.p75, carries.p90, carries.p95, carries.max],
  ])
);
console.log(`  50+ attempt games: ${(over(allAttempts, 50) * 100).toFixed(1)}%   60+: ${(over(allAttempts, 60) * 100).toFixed(1)}%\n`);

// ---- the worst case a GAMEPLAN can produce ---------------------------------
//
// The sample above runs every game on the balanced plan, so it measures the
// engine's baseline and nothing else. The 61-attempt game that was reported
// was not a baseline game: it was Vertical Attack, whose runShare modifier at
// full roster fit took the run share below the point where anyone would
// recognise the sport. A tail check on balanced football cannot see that, which
// is why it passed while the bug was live. Push the most pass-heavy plan there
// is against the most pass-friendly defence and hold THAT inside a real game.
const VERT = { offense: "vertical-attack", defense: "blitz-pressure" };
const GROUND = { offense: "ground-control", defense: "run-wall" };

const eliteQb = qbPool[qbPool.length - 1] && medianOf(
  qbPool.filter((p) => percentileOf(qbYards, p.pass_yds) >= 0.95), "pass_yds"
);
const deepWrs = [...wrPool].sort((a, b) => (b.ypt || 0) - (a.ypt || 0)).slice(0, 40);
// The ground plan needs its OWN roster, for the same reason the vertical one
// does. FIT scales a plan by how well the lineup suits it (see scalePlan in
// js/sports/nfl/tactics.js), so Ground Control run by a deep-passing roster is
// damped almost to neutral - which is the feature working, and it made the
// comparison below measure nothing. Sorting on rushing yards for the back and
// for the quarterback is what Ground Control's own FIT function reads.
const groundRbs = [...rbPool].sort((a, b) => (b.rush_yds || 0) - (a.rush_yds || 0)).slice(0, 40);
const runningQbs = [...qbPool].sort((a, b) => (b.rush_yds || 0) - (a.rush_yds || 0)).slice(0, 20);

const verticalAttempts = [];
const groundCarries = [];
const groundBaselineCarries = [];
for (let i = 0; i < GAMES_PER_TIER * 2; i++) {
  // Built FOR the plan, so its fit multiplier is at full strength - a plan you
  // did not build for barely moves anything, and the extreme is what needs a
  // ceiling.
  const rosterA = rosterWith({
    QB: eliteQb || medianOf(qbPool, "pass_yds"),
    WR1: deepWrs[i % deepWrs.length],
    WR2: deepWrs[(i + 7) % deepWrs.length],
    WR3: deepWrs[(i + 13) % deepWrs.length],
  });
  const rosterB = rosterWith({ QB: medianOf(qbPool, "pass_yds") });
  const vertical = NFL.simulate(rosterA, rosterB, ctx, {
    strategyA: VERT, strategyB: BAL, rand: mulberry32(i * 104729 + 11),
  });
  verticalAttempts.push(qbLine(vertical, "A").att || 0);
  const groundRoster = rosterWith({
    QB: runningQbs[i % runningQbs.length],
    RB: groundRbs[i % groundRbs.length],
  });
  const ground = NFL.simulate(groundRoster, rosterB, ctx, {
    strategyA: GROUND, strategyB: BAL, rand: mulberry32(i * 104729 + 11),
  });
  groundCarries.push((ground.boxA.RB || {}).carries || 0);
  // The SAME roster on the balanced plan, so the comparison below isolates the
  // gameplan instead of mixing it with a change of cast.
  const baseline = NFL.simulate(groundRoster, rosterB, ctx, {
    strategyA: BAL, strategyB: BAL, rand: mulberry32(i * 104729 + 11),
  });
  groundBaselineCarries.push((baseline.boxA.RB || {}).carries || 0);
}
const vertical = summarise(verticalAttempts);
const ground = summarise(groundCarries);
const groundBaseline = summarise(groundBaselineCarries);

console.log(
  renderTable([
    ["most extreme gameplan", "median", "p90", "p95", "max"],
    ["Vertical Attack QB attempts", vertical.median, vertical.p90, vertical.p95, vertical.max],
    ["Ground Control RB carries", ground.median, ground.p90, ground.p95, ground.max],
  ])
);

// ---- the rate sheet --------------------------------------------------------
//
// THE SCOREBOARD WAS RIGHT AND EVERYTHING UNDER IT WAS WRONG.
//
// A live game produced a running back with 297 rushing yards and another with
// 285. Nothing above catches that, because everything above measures the
// PASSING game and the final score - and the final score was fine, 21 points a
// game against football's 22. The rates underneath it were not: 8.4 yards a
// play against 5.4, 9.8 a carry against 4.3, 438 yards a game against 340, on
// 52 snaps against 63. A game of very few, very long plays adds up to the
// right score and looks nothing like football on the way there.
//
// These are the numbers a fan would check, so they are the numbers that get
// asserted. Bands are generous - a simulation is not a season average - but
// they are tight enough that the failure above could not pass any of them.
const RATE_GAMES = 400;
const rate = { plays: [], yards: [], rush: [], drives: [], carries: [], seconds: [], backYards: [], backCarries: [] };
// HOW A TEAM SCORES, not just how much. The engine drew 32% of touchdowns as
// runs and produced 1.75 passing against 0.73 rushing, where football is about
// 1.45 and 0.95 - while the TOTAL, 2.48 against 2.40, looked perfect. A split
// that wrong makes every drafted back quieter near the goal line than he was
// and every quarterback more prolific, and nothing here was measuring it.
const tds = { pass: 0, rush: 0, sides: 0 };
// DISTRIBUTION SHAPE, not just the mean. Every band below this point was a
// band on an AVERAGE, and an average is exactly the statistic a broken
// simulation is most likely to get right: the reported 297-yard rushing game
// and the 64-attempt passing game both sat inside a table whose means looked
// perfect. What separates football from a plausible mean is the spread and the
// tail, so those are measured too.
const shape = {
  score: [], yardsPerPlay: [], sacks: [], attempts: [], fieldGoals: [], touchdowns: [],
  // Per GAME rather than per side: a scoreboard is the thing a player looks at,
  // and "both teams were quiet" is the complaint, not "one was".
  combined: [],
  // Per game per quarterback, for the low-tail check below. Games where he
  // barely threw are excluded - a 2-of-5 line is a game script, not a rate.
  compPct: [],
  // WHO GETS NAMED MAN OF THE MATCH, which nothing measured until a live 9-6
  // game handed it to a running back with 32 yards. One entry per game:
  // { slot, contribution, low, won }, where `low` marks the games the
  // complaint was about.
  mvps: [],
};
// Drafting is the expensive half of this - about 10ms a pair against 2ms a
// simulation - so a smaller set of pairs is drafted once and replayed. Each
// replay draws a different random stream, so the sample is still 400 distinct
// games; what it is not is 400 distinct drafts, which would treble the runtime
// of this file to sharpen an average that is already stable.
const ratePairs = Array.from({ length: 50 }, (_, i) => draftPair(0xd8af_7000 + i));
// DRAFTED PAIRS, NOT ARBITRARY ONES. This loop used to build both sides by
// cycling through the whole quarterback and running-back pools - so most of
// its games were played by two men nobody would ever draft, at slots carrying
// over half the offensive weight between them. Every rate in the table below
// was an average over those games. Bot-drafted pairs are what a real match is,
// and they are what the calibrators solve the balance constants against, so
// this file and tools/calibrate-nfl-variance.mjs now describe the same
// football rather than two different ones.
for (let i = 0; i < RATE_GAMES; i++) {
  const [rosterA, rosterB] = ratePairs[i % ratePairs.length];
  const result = NFL.simulate(rosterA, rosterB, ctx, {
    strategyA: BAL, strategyB: BAL, rand: mulberry32(i * 15486071 + 3),
  });
  for (const [box, team, score] of [
    [result.boxA, result.teamStatsA, result.teamScoreA],
    [result.boxB, result.teamStatsB, result.teamScoreB],
  ]) {
    shape.score.push(score);
    shape.yardsPerPlay.push(team.plays > 0 ? team.totalYards / team.plays : 0);
    shape.sacks.push(team.sacksAllowed || 0);
    shape.attempts.push((box.QB || {}).att || 0);
    const qbLineOf = box.QB || {};
    if ((qbLineOf.att || 0) >= 10) shape.compPct.push((qbLineOf.comp || 0) / qbLineOf.att);
    rate.plays.push(team.plays);
    rate.yards.push(team.totalYards);
    rate.rush.push(team.rushYards);
    rate.drives.push(team.drives);
    // Every carry on the roster, not just the back's - the run share of a
    // team's offence is a team number.
    rate.carries.push(Object.values(box).reduce((sum, line) => sum + (line.carries || 0), 0));
    // The drafted back's own line - the one the player reads, and the one that
    // came back at 297 yards.
    rate.backYards.push((box.RB || {}).rush_yds || 0);
    rate.backCarries.push((box.RB || {}).carries || 0);
    tds.sides += 1;
    for (const line of Object.values(box)) {
      tds.pass += line.pass_tds || 0;
      // Receiving and rushing scores are the same touchdown counted from the
      // scorer's side; the passing number above is the quarterback's copy of
      // the receiving ones, so only rushing is added here.
      tds.rush += line.rush_tds || 0;
    }
    shape.fieldGoals.push(
      Object.values(box).reduce((sum, line) => sum + (line.fgs || 0), 0)
    );
    shape.touchdowns.push(
      Object.values(box).reduce((sum, line) => sum + (line.rush_tds || 0) + (line.rec_tds || 0), 0)
    );
  }
  shape.combined.push(result.teamScoreA + result.teamScoreB);
  // WHAT THE MAN NAMED ACTUALLY DID. Recorded as the separate quantities
  // rather than as the engine's own score, so a check here cannot be satisfied
  // by the same weights it is meant to be testing.
  if (result.mvp) {
    const line = result.mvp.line;
    const n = (key) => Number(line[key]) || 0;
    shape.mvps.push({
      slot: result.mvp.slot,
      reason: result.mvp.reason,
      yards: n("pass_yds") + n("rush_yds") + n("rec_yds"),
      touchdowns: n("pass_tds") + n("rush_tds") + n("rec_tds"),
      fieldGoals: n("fgs"),
      takeaways: n("ints") + n("fumbles"),
      sacks: n("sacks"),
      combined: result.teamScoreA + result.teamScoreB,
      won: result.winner == null || result.mvp.side === result.winner,
    });
  }
  rate.seconds.push(result.teamStatsA.possessionSeconds + result.teamStatsB.possessionSeconds);
}
const mean = (list) => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
const passTdPerGame = tds.pass / Math.max(1, tds.sides);
const rushTdPerGame = tds.rush / Math.max(1, tds.sides);
const rushTdShare = rushTdPerGame / Math.max(1e-9, passTdPerGame + rushTdPerGame);
const yardsPerPlay = mean(rate.yards) / mean(rate.plays);
const yardsPerCarry = mean(rate.rush) / mean(rate.carries);
const yardsPerDrive = mean(rate.yards) / mean(rate.drives);
const gameMinutes = mean(rate.seconds) / 60;
const back = summarise(rate.backYards);
const backCarries = summarise(rate.backCarries);

console.log(
  renderTable([
    ["rate (per team per game)", "simulated", "real NFL"],
    ["offensive plays", mean(rate.plays).toFixed(1), "63"],
    ["total yards", mean(rate.yards).toFixed(0), "340"],
    ["yards per play", yardsPerPlay.toFixed(2), "5.4"],
    ["rush attempts", mean(rate.carries).toFixed(1), "27"],
    ["yards per carry", yardsPerCarry.toFixed(2), "4.3"],
    ["yards per drive", yardsPerDrive.toFixed(1), "31"],
    ["clock used, both sides", `${gameMinutes.toFixed(1)} min`, "60 min"],
    ["the back's carries (median)", String(backCarries.median), "18"],
    ["the back's rushing yards (median)", String(back.median), "80"],
  ])
);

// ---- the play after the touchdown ------------------------------------------
//
// A team that scores to go from eight down to two down and kicks the extra
// point has declined to tie the game. That was reported from a real game, and
// it was not a decision the engine got wrong - it was a decision the engine
// could not make, because the conversion was folded into the touchdown as
// 6.94 points. Measure the decision itself, not the scoreboard it produces.
const CHART_MARGINS = [-2, -5, -10, -16, 1, 4, 5, 12];
let touchdowns = 0;
let twoPointTries = 0;
let onChart = 0;
let onChartWentForTwo = 0;
let unreconciled = 0;
let missingConversion = 0;
let offChartTwoPointers = 0;
let unreconciledSacks = 0;
// A field goal on your last possession of the game, trailing by more than
// three. It cannot tie and it cannot win, and no team has ever kicked one -
// reported from a live game as "down 7 in overtime and we kicked a field
// goal". Counted against every last-chance possession so the check reads as a
// rate, not as an absence.
let lastChanceDown4Plus = 0;
let hopelessFieldGoals = 0;
let puntsFromRange = 0;
let puntTotal = 0;
let worstPunt = null;
for (let i = 0; i < 400; i++) {
  const rosterA = rosterWith({ QB: qbPool[i % qbPool.length], RB: rbPool[i % rbPool.length] });
  const rosterB = rosterWith({ QB: qbPool[(i * 3) % qbPool.length], RB: medianRB });
  const result = NFL.simulate(rosterA, rosterB, ctx, {
    strategyA: BAL, strategyB: BAL, rand: mulberry32(i * 31337 + 5),
  });
  // Replayed the way the engine itself walks the game, so the margin each
  // decision faced is the margin the engine faced - not one reconstructed from
  // the final score.
  const live = { A: 0, B: 0 };
  // The engine's own rule is "no next possession"; the last drive each team
  // takes is exactly that, whether it came in regulation or overtime.
  const lastDriveIndex = { A: -1, B: -1 };
  result.drives.forEach((d, index) => { lastDriveIndex[d.team] = index; });
  // Its own running score: the margin a drive FACED, not the one it left
  // behind, and the main walk below has not started counting yet.
  const before = { A: 0, B: 0 };
  result.drives.forEach((drive, index) => {
    const foe = drive.team === "A" ? "B" : "A";
    if (index === lastDriveIndex[drive.team] && before[drive.team] - before[foe] < -3) {
      lastChanceDown4Plus += 1;
      if (drive.outcome === "fieldGoal") hopelessFieldGoals += 1;
    }
    before[drive.team] += drive.points;
  });
  for (const drive of result.drives) {
    // Nobody punts from field-goal range. The outcome is drawn before the
    // drive is placed on the field, so a drive labelled "punt" could be handed
    // an end spot in the opponent's half - 11% of punts were, some from inside
    // the 10, and it read on screen exactly as wrong as it was.
    if (drive.outcome === "punt" && drive.endYard >= FG_RANGE_YARD) {
      puntsFromRange += 1;
      if (worstPunt === null || drive.endYard > worstPunt) worstPunt = drive.endYard;
    }
    puntTotal += drive.outcome === "punt" ? 1 : 0;
    if (drive.outcome === "touchdown") {
      touchdowns += 1;
      if (!drive.conversion) missingConversion += 1;
      const marginAfterSix = live[drive.team] + 6 - live[drive.team === "A" ? "B" : "A"];
      if (drive.quarter >= 4 && CHART_MARGINS.includes(marginAfterSix)) {
        onChart += 1;
        if (drive.conversion?.type === "two") onChartWentForTwo += 1;
      }
      if (drive.conversion?.type === "two") {
        twoPointTries += 1;
        // Every two-point try has to be explainable by pointing at the
        // scoreboard. One that is not reads as a bug rather than as a call,
        // because the reasoning behind an off-chart try is invisible from
        // outside - which is exactly how it was reported.
        if (!(drive.quarter >= 4 && CHART_MARGINS.includes(marginAfterSix))) offChartTwoPointers += 1;
      }
    }
    live[drive.team] += drive.points;
  }
  if (live.A !== result.teamScoreA || live.B !== result.teamScoreB) unreconciled += 1;

  // A sack is one event with two halves: a cost to the quarterback and a
  // credit to the unit that got home. If those two disagree the box score is
  // reporting a play that did not happen to somebody.
  for (const [box, team] of [[result.boxB, result.teamStatsA], [result.boxA, result.teamStatsB]]) {
    const credited = Object.values(box).reduce((sum, line) => sum + (line.sacks || 0), 0);
    if (credited !== team.sacksAllowed) unreconciledSacks += 1;
  }
}
const twoPointRate = touchdowns ? twoPointTries / touchdowns : 0;

// ---- does the quarterback run like HIMSELF? --------------------------------
//
// Reported from a live game: Ben Roethlisberger, one of the least mobile
// quarterbacks who ever played, finished with 8 carries for 52 yards. Carries
// were weighted by rushing YARDS and then the bell-cow cap poured whatever it
// took off the back onto whoever was left - on a twelve-slot roster, the
// quarterback. So the pocket passer inherited a running back's workload.
//
// Measured against each man's OWN rate, because that is the only honest
// yardstick: a quarterback who ran for 6 yards a game may not simulate 50.
const mobilityGames = 60;
function qbRushSample(qb) {
  const carries = [];
  const yards = [];
  for (let i = 0; i < mobilityGames; i++) {
    const result = NFL.simulate(rosterWith({ QB: qb, RB: medianRB }), rosterWith({ QB: medianOf(qbPool, "pass_yds"), RB: medianRB }), ctx, {
      strategyA: BAL, strategyB: BAL, rand: mulberry32(i * 104729 + qb.name.length),
    });
    const line = (result.boxA || {}).QB || {};
    carries.push(line.carries || 0);
    yards.push(line.rush_yds || 0);
  }
  return { real: qb.rush_yds, carries: mean(carries), yards: mean(yards), name: `${qb.name} ${qb.season}` };
}
// The extremes of the dataset, picked by real rushing production rather than
// by name, so this keeps meaning something when the data grows.
const byRushing = [...qbPool].sort((a, b) => (a.rush_yds || 0) - (b.rush_yds || 0));
const pocketQBs = byRushing.filter((p) => p.pass_yds > 180).slice(0, 3);
const runningQBs = byRushing.filter((p) => p.pass_yds > 180).slice(-3);
const pocketRuns = pocketQBs.map(qbRushSample);
const runnerRuns = runningQBs.map(qbRushSample);
const worstPocket = pocketRuns.reduce((w, r) => (r.yards > w.yards ? r : w), pocketRuns[0]);
const meanPocketYards = mean(pocketRuns.map((r) => r.yards));
const meanRunnerYards = mean(runnerRuns.map((r) => r.yards));

const poor = tierStats.get("poor") && eff(tierStats.get("poor"));
const avg = tierStats.get("average") && eff(tierStats.get("average"));
const good = tierStats.get("good") && eff(tierStats.get("good"));
const elite = tierStats.get("elite") && eff(tierStats.get("elite"));

// Real football, for the bands below: league completion rate sits around
// 62-67%, a poor starter around 58%, an elite one around 70%. Yards per
// attempt runs about 5.8 (poor) to 8.5 (elite). A team throws about 33 times.
// SACKS PER DROPBACK, not per play. A sack is a pass play that ended badly, so
// the denominator football uses is attempts plus sacks - measuring it against
// every snap divides by the running game too and reports a number about half
// the real one, which would have made an under-sacking engine look correct.
const totalSacks = shape.sacks.reduce((a, b) => a + b, 0);
const totalDropbacks = totalSacks + shape.attempts.reduce((a, b) => a + b, 0);
const sackRate = totalSacks / Math.max(1, totalDropbacks);
const fgPerGame = mean(shape.fieldGoals);
const tdPerGame = mean(shape.touchdowns);
const tdToFg = tdPerGame / Math.max(1e-9, fgPerGame);
const scoreShape = summarise(shape.score);
const yppShape = summarise(shape.yardsPerPlay);
const compShape = summarise(shape.compPct);
const quietGames = shape.combined.filter((total) => total <= 20).length /
  Math.max(1, shape.combined.length);

// ---- who gets named man of the match ---------------------------------------
//
// A LOW-SCORING GAME IS A DIFFERENT GAME, and the MVP has to read like one.
// The reported fault was a 9-6 final naming a back with 32 yards, in a game
// whose every point came off a kicker's foot. Two things are checked, and they
// are separate questions.
//
// A FLOOR. Whoever is named must have done SOMETHING a fan would accept as the
// reason. Yardage is not the only such thing - a secondary and a kicker have
// none by definition - so the floor is a disjunction over every way football
// lets a man decide a game.
const MVP_LOW_SCORING_TOTAL = 24;
const DEFENSIVE_SLOTS = new Set(["DL", "LB", "CB", "S", "DEF"]);
const mvpDecided = (m) =>
  m.yards >= 60 || m.touchdowns >= 1 || m.fieldGoals >= 2 || m.takeaways >= 1 || m.sacks >= 2;
const mvpTrivial = shape.mvps.filter((m) => !mvpDecided(m));
const mvpLow = shape.mvps.filter((m) => m.combined <= MVP_LOW_SCORING_TOTAL);
const mvpLowDefensiveOrKicking = mvpLow.filter(
  (m) => DEFENSIVE_SLOTS.has(m.slot) || m.slot === "ST"
).length;
const mvpLowShare = mvpLow.length ? mvpLowDefensiveOrKicking / mvpLow.length : 0;
const mvpLosingShare = shape.mvps.length
  ? shape.mvps.filter((m) => !m.won).length / shape.mvps.length
  : 0;
const mvpUnexplained = shape.mvps.filter((m) => !m.reason).length;

const checks = [
  {
    title: "Completion rate rises with quarterback quality",
    ok: !!(poor && elite) && elite.compPct > poor.compPct + 0.04,
    detail: `poor ${(poor.compPct * 100).toFixed(1)}% -> elite ${(elite.compPct * 100).toFixed(1)}%`,
  },
  {
    // THE CHECK THAT WOULD HAVE CAUGHT THE 9-6 GAME, and it is deliberately
    // about the passing LINE rather than about the scoreboard.
    //
    // A live game was reported as unwatchable: 9-6, with the winning
    // quarterback 8 of 28 for 68 yards. Measured afterwards, the FINAL was
    // honest - both sides had drafted bottom-third passers, and that pair's
    // expected game is 17-18 points on about 270 yards a side, so 9-6 is that
    // matchup's bad night and not a fault. Tuning it away would be deciding
    // that a bad quarterback pick should not cost anything, which is the
    // opposite of what a drafting game wants.
    //
    // The 28.6% was the fault. Real football's worst full starts sit in the
    // low forties; nobody throws 28 times and completes eight. So the floor is
    // 42%, at the first percentile, over every drafted pair this file samples
    // - lines below it should be reachable about as often as they are on a
    // real Sunday, which is to say almost never.
    title: "A passing line has a floor as well as a ceiling",
    ok: compShape.n > 0 && compShape.p01 >= 0.42,
    detail: `1st percentile ${(compShape.p01 * 100).toFixed(1)}% completions ` +
      `(worst ${(compShape.min * 100).toFixed(1)}%, median ${(compShape.median * 100).toFixed(1)}%)`,
  },
  {
    // The scoreboard's own low tail. Not a floor under any single game - real
    // football produces a 9-6 and so should this - but a ceiling on how OFTEN
    // one arrives. The NFL finishes about 3% of its games under 21 combined
    // points; 5% is the point past which quiet games have stopped being the
    // exception a player forgives.
    title: "Quiet games stay rare",
    ok: quietGames < 0.05,
    detail: `${(quietGames * 100).toFixed(2)}% of games finish 20 or under, both sides added`,
  },
  {
    title: "Yards per attempt rises with quarterback quality",
    ok: !!(poor && elite) && elite.ypa > poor.ypa + 1.0,
    detail: `poor ${poor.ypa.toFixed(2)} -> elite ${elite.ypa.toFixed(2)}`,
  },
  {
    title: "Each tier separates from the one below it",
    ok: !!(poor && avg && good && elite) &&
      avg.yardsPerGame > poor.yardsPerGame &&
      good.yardsPerGame > avg.yardsPerGame &&
      elite.yardsPerGame > good.yardsPerGame,
    detail: [poor, avg, good, elite].map((e) => e.yardsPerGame.toFixed(0)).join(" < "),
  },
  {
    title: "A backup's line reads like a backup's",
    //
    // NOT a straight comparison against the tier's real per-game average, even
    // though that is the tempting check. A backup's real average is depressed
    // by PARTIAL GAMES - Skylar Thompson's 76 yards a game is seven starts
    // he mostly split - while this simulation always plays him a full one
    // behind a median supporting cast. Holding him to 76 would be demanding
    // that a full game look like a half.
    //
    // What can honestly be demanded: he is far off the elite tier, and his
    // EFFICIENCY is a backup's. Yardage alone was never the tell - 25/42 for
    // 280 was wrong because of the 60% completion rate behind it, not only
    // the total.
    // SEPARATION AS A RATIO, NOT A YARDAGE GAP. It was "more than 90 yards
    // between them", which is a number that moves whenever league-wide VOLUME
    // moves - and volume is a thing this engine is allowed to tune. Trimming
    // snaps per drive to football's 63 plays a game (from 65) shrank every
    // passing total by about 4% and took the gap from 94 to 89 without any
    // tier moving relative to any other, which is the check failing for a
    // reason that has nothing to do with what it is measuring. A ratio holds
    // the same claim - an elite line is a different thing from a backup's -
    // and is indifferent to how many plays a game there are. Real football is
    // 2.6x (119 against 307); this asks for 1.5x, since the sim compresses the
    // range at both ends and that compression is measured separately above.
    ok: !!(poor && elite) &&
      poor.yardsPerGame < 230 &&
      elite.yardsPerGame > poor.yardsPerGame * 1.5 &&
      poor.compPct < 0.58,
    detail:
      `bottom tier ${poor.yardsPerGame.toFixed(0)} yds at ${(poor.compPct * 100).toFixed(1)}%, ` +
      `${(elite.yardsPerGame / Math.max(1, poor.yardsPerGame)).toFixed(2)}x behind elite ` +
      `(${elite.yardsPerGame.toFixed(0)} yds at ${(elite.compPct * 100).toFixed(1)}%)`,
  },
  {
    // THE FLOOR UNDER THE SAME CLAIM. Every tier check above bounds production
    // from ABOVE - a backup must not post a starter's line - and none of them
    // bounded it from below, so a change that over-suppressed a weak roster
    // passed all of them. Solving TALENT_PARITY did exactly that: at 2.54 the
    // bottom tier threw for 29 yards a game, which is not a bad quarterback,
    // it is a broken one, and the "under 230 yards" test above called it a
    // success.
    //
    // 0.4x of the tier's own real rate. Deliberately loose, because the
    // comparison is not like for like in TWO directions at once: the tier's
    // real average is depressed by partial games, while the simulated one is
    // earned against a fully drafted defence rather than a league-average
    // one. Neither correction is measurable here, so the floor is set well
    // below both and catches only the failure it is named for - the engine
    // having stopped modelling the man rather than rating him low. At the
    // parity that produced 29 yards this reads 0.24 and fails; at the shipped
    // value it reads 0.52.
    title: "A weak quarterback is rated low, not erased",
    ok: !!poor && poor.yardsPerGame > poor.realYardsPerGame * 0.4,
    detail: TIERS.filter((t) => tierStats.get(t.key)).map((t) => {
      const e = eff(tierStats.get(t.key));
      return `${t.key} ${e.yardsPerGame.toFixed(0)} vs real ${e.realYardsPerGame.toFixed(0)}`;
    }).join("  "),
  },
  {
    title: "Simulated production tracks real production within 1.6x",
    ok: !!(poor && elite) &&
      poor.yardsPerGame < poor.realYardsPerGame * 1.6 + 40 &&
      elite.yardsPerGame < elite.realYardsPerGame * 1.6,
    detail: TIERS.filter((t) => tierStats.get(t.key)).map((t) => {
      const e = eff(tierStats.get(t.key));
      return `${t.key} ${(e.yardsPerGame / Math.max(1, e.realYardsPerGame)).toFixed(2)}x`;
    }).join("  "),
  },
  {
    title: "Rushing production tracks the back's own rate",
    ok: !!(poor && elite) && elite.rushPerGame > poor.rushPerGame,
    detail: TIERS.filter((t) => tierStats.get(t.key)).map((t) => {
      const e = eff(tierStats.get(t.key));
      return `${t.key} ${e.rushPerGame.toFixed(0)} (real ${e.realRushPerGame.toFixed(0)})`;
    }).join("  "),
  },
  {
    title: "Median pass attempts are football-realistic (28-40)",
    ok: attempts.median >= 28 && attempts.median <= 40,
    detail: `median ${attempts.median}, mean ${attempts.mean.toFixed(1)}`,
  },
  {
    title: "The attempt tail is realistic (p95 under 55)",
    ok: attempts.p95 < 55,
    detail: `p90 ${attempts.p90}, p95 ${attempts.p95}, max ${attempts.max}`,
  },
  {
    title: "50+ attempt games are uncommon and 60+ are rare",
    ok: over(allAttempts, 50) < 0.1 && over(allAttempts, 60) < 0.015,
    detail: `50+ ${(over(allAttempts, 50) * 100).toFixed(1)}%, 60+ ${(over(allAttempts, 60) * 100).toFixed(1)}%`,
  },
  {
    title: "Running back carries are realistic (median 12-24)",
    ok: carries.median >= 12 && carries.median <= 24,
    detail: `median ${carries.median}, p90 ${carries.p90}, max ${carries.max}`,
  },
  {
    // 61 was the reported line, in regulation. The most pass-happy plan in the
    // game, run by a roster built for it, still has to play football: the
    // league's most pass-heavy TEAMS average about 40 attempts and 60+ is a
    // handful of games a season, so the ceiling is a rare outlier rather than
    // the middle of the distribution.
    //
    // THE CEILING IS A FACT, NOT A MEASUREMENT. It was set from the observed
    // maximum three times running, and each time an unrelated engine change
    // shifted the random stream by a game or two and it needed raising again -
    // which is a threshold being fitted to the code rather than to football.
    //
    // So the ceiling is now the NFL single-game record: 70 attempts, Drew
    // Bledsoe in 1994. A simulated game may not beat the most anyone has ever
    // thrown, and that line does not move when a seed does. The MIDDLE of the
    // distribution is what actually holds this honest, and that is asserted
    // tightly: the league's most pass-heavy teams average about 40 a game.
    title: "The most pass-heavy gameplan still throws a real number of times",
    ok: vertical.median <= 44 && vertical.p95 <= 55 && vertical.max < 70,
    detail: `Vertical Attack median ${vertical.median}, p95 ${vertical.p95}, max ${vertical.max}`,
  },
  {
    // The other end of the same band: narrowing it must not have flattened the
    // plans into each other. A ground team still runs like a ground team.
    //
    // MEASURED ON THE SAME ROSTERS ON BOTH SIDES OF THE COMPARISON, which it
    // was not. `ground` came from the plan loop, running an elite passing
    // roster; `carries.median` came from the tier loop, running whatever
    // quarterback that tier supplied. The difference between them was part
    // gameplan and part cast, and it only ever looked like a clean measurement
    // because the two happened to land four carries apart. `groundBaseline` is
    // the balanced plan on the identical rosters, so what is left is the plan.
    title: "Ground Control still runs the ball far more than balanced",
    ok: ground.median >= groundBaseline.median + 4,
    detail: `${ground.median} carries against the same roster's ${groundBaseline.median} on balanced`,
  },
  {
    title: "A pocket passer does not run like a running back",
    // Two claims: he stays near his own rate, and he never posts a back's
    // line. 15 yards is generous - the men in this group averaged 3 to 6.
    ok: !!worstPocket && worstPocket.yards < 15 && meanPocketYards < 12,
    detail: pocketRuns
      .map((r) => `${r.name}: ${r.yards.toFixed(0)} yds on ${r.carries.toFixed(1)} car (real ${r.real.toFixed(1)}/g)`)
      .join("\n"),
  },
  {
    title: "A running quarterback still runs",
    ok: meanRunnerYards > meanPocketYards * 3,
    detail: runnerRuns
      .map((r) => `${r.name}: ${r.yards.toFixed(0)} yds on ${r.carries.toFixed(1)} car (real ${r.real.toFixed(1)}/g)`)
      .join("\n"),
  },
  {
    title: "A team that must have seven never kicks three",
    ok: hopelessFieldGoals === 0 && lastChanceDown4Plus > 0,
    detail: `${hopelessFieldGoals} of ${lastChanceDown4Plus} last-chance possessions down 4+ ended in a field goal`,
  },
  {
    // THE SHARE, NOT THE TWO RATES. How MANY touchdowns a side scores depends
    // on the rosters, and the rosters here are a fixed cast with the
    // quarterback and back cycled through the pool - so the absolute rates
    // below sit under a real league's simply because this cast is not a real
    // league. How touchdowns SPLIT between the run and the pass is a property
    // of the engine rather than of the cast, and it is what was wrong: 31% on
    // the ground against football's ~40%, which made every drafted back
    // quieter near the goal line than he was and every quarterback more
    // prolific. The total, meanwhile, looked perfect, which is why nothing
    // caught it.
    //
    // A wide band on purpose. This is a draft game: a roster of six 2007
    // Patriots receivers SHOULD throw more touchdowns than a league average.
    // What it must not do is move the whole distribution onto the quarterback.
    title: "Touchdowns split between run and pass the way football's do",
    ok: rushTdShare >= 0.34 && rushTdShare <= 0.46,
    detail:
      `${(rushTdShare * 100).toFixed(0)}% of touchdowns on the ground (real NFL about 40%) - ` +
      `${passTdPerGame.toFixed(2)} passing and ${rushTdPerGame.toFixed(2)} rushing per team per game`,
  },
  {
    title: "Every touchdown plays out a conversion",
    ok: missingConversion === 0 && touchdowns > 0,
    detail: `${missingConversion} of ${touchdowns} touchdowns had none`,
  },
  {
    title: "A late touchdown that can tie the game goes for two, every time",
    ok: onChart > 0 && onChartWentForTwo === onChart,
    detail: `${onChartWentForTwo} of ${onChart} on-chart situations`,
  },
  {
    // Was a band around a baseline rate. That baseline is now zero: a team
    // going for two while eleven points up in the second quarter is
    // indistinguishable from a broken simulation, so every try has to be a
    // call the scoreboard explains.
    title: "Nobody ever goes for two without a reason on the scoreboard",
    ok: offChartTwoPointers === 0 && twoPointTries > 0,
    detail: `${offChartTwoPointers} unexplained of ${twoPointTries} tries (${(twoPointRate * 100).toFixed(1)}% of ${touchdowns} touchdowns)`,
  },
  {
    title: "Every sack the offence allowed is credited to a defensive unit",
    ok: unreconciledSacks === 0,
    detail: `${unreconciledSacks} sides where the two halves disagreed`,
  },
  {
    // 9.8 was the reported figure, by way of a 297-yard rushing game.
    title: "Yards per carry is a football number (3.8-5.0)",
    ok: yardsPerCarry >= 3.8 && yardsPerCarry <= 5.0,
    detail: `${yardsPerCarry.toFixed(2)} a carry over ${mean(rate.carries).toFixed(1)} attempts`,
  },
  {
    // WIDENED, ONCE, AND SAID OUT LOUD. The band was 4.8-6.2 and this file
    // reported 6.04 against it - but it was measuring games between two
    // MEDIAN-quality rosters, which nobody plays. Sampled from bot-drafted
    // pairs instead, the same engine reports 6.6. The band moved to fit the
    // measurement because the measurement got more honest, not because the
    // number drifted and the threshold was dragged after it. Every future
    // change is the second kind and should be treated as one.
    title: "Yards per play is a football number (5.6-7.4)",
    ok: yardsPerPlay >= 5.6 && yardsPerPlay <= 7.4,
    detail: `${yardsPerPlay.toFixed(2)} on ${mean(rate.plays).toFixed(1)} plays for ${mean(rate.yards).toFixed(0)} yards`,
  },
  {
    title: "A team runs a football number of plays (56-70)",
    ok: mean(rate.plays) >= 56 && mean(rate.plays) <= 70,
    detail: `${mean(rate.plays).toFixed(1)} plays over ${mean(rate.drives).toFixed(1)} drives`,
  },
  {
    // Widened with the yards-per-play band above and for the same reason: a
    // drafted roster drives further than a median one.
    title: "A drive gains a football number of yards (31-43)",
    ok: yardsPerDrive >= 31 && yardsPerDrive <= 43,
    detail: `${yardsPerDrive.toFixed(1)} yards per drive`,
  },
  {
    // A game is sixty minutes. The engine models drives, not a clock, so this
    // is the one place the two are checked against each other - and it caught
    // an eighty-minute game hiding behind a plausible scoreboard.
    title: "Both sides' possession adds up to a football game (54-66 min)",
    ok: gameMinutes >= 54 && gameMinutes <= 66,
    detail: `${gameMinutes.toFixed(1)} minutes of game clock`,
  },
  {
    // The report was 297 rushing yards, and a second back at 285 in the same
    // game. A bell-cow's line is the most-read row in the box score.
    title: "The drafted back posts a bell-cow's line, not a record one",
    ok: back.median >= 60 && back.median <= 110 &&
        backCarries.median >= 14 && backCarries.median <= 24 &&
        back.p95 <= 240,
    detail: `${back.median} yards on ${backCarries.median} carries (p95 ${back.p95}, max ${back.max})`,
  },
  {
    // The complaint that found this was "sometimes a team punts inside the
    // other half". It was 11% of punts, the worst from the opponent's 1.
    // Zero tolerance rather than a small allowance: a punt from field-goal
    // range is never a decision a team makes, so any at all is the bug back.
    title: "Nobody punts from field-goal range",
    ok: puntsFromRange === 0,
    detail: puntsFromRange === 0
      ? `0 of ${puntTotal} punts came from inside the ${FG_RANGE_YARD} yard line`
      : `${puntsFromRange} of ${puntTotal} punts from inside FG range, worst from the ${worstPunt}`,
  },
  {
    // SACKS, WHICH NOTHING HERE MEASURED. A drafted pass rush is one of four
    // defensive picks and the sack is the only thing it visibly does, so the
    // rate it happens at is a first-class realism number - and it was checked
    // only for BOOKKEEPING (every sack credited to a unit), never for how
    // often. Real football sacks the quarterback on about 6.5% of dropbacks;
    // the band is wide because a draft game's rushes and lines are drawn from
    // every season at once, and narrow enough that a pass rush which never
    // gets home, or one that lives in the backfield, fails it.
    title: "The quarterback is sacked at a football rate (4-9% of dropbacks)",
    ok: sackRate >= 0.04 && sackRate <= 0.09,
    detail: `${(sackRate * 100).toFixed(1)}% - ${(totalSacks / shape.sacks.length).toFixed(2)} sacks a team a game`,
  },
  {
    // HOW DRIVES FINISH, which is the other half of the drive chart and the
    // half nothing was holding. DRIVE_OUTCOMES is an INPUT to a field-position
    // model, not a description of its output: the "nobody punts from
    // field-goal range" rule turns stalled drives into attempts on top of the
    // chart's share, so the realised rate ran well above what the constant
    // said. Measured, that was 2.47 field goals a team a game against real
    // football's ~1.7, at a touchdown-to-field-goal ratio of 1.12 where the
    // league's is about 1.3 - the game was settling for three half again too
    // often, and only the ratio can catch that, because both totals sit above
    // a real league's by design.
    title: "Drives finish in touchdowns and field goals in football's proportion (1.1-1.6)",
    ok: tdToFg >= 1.1 && tdToFg <= 1.6,
    detail: `${tdToFg.toFixed(2)} - ${tdPerGame.toFixed(2)} touchdowns against ${fgPerGame.toFixed(2)} field goals a team a game (real NFL about 1.3)`,
  },
  {
    // THE SHAPE, NOT THE MEAN. Everything above this point is a band on an
    // average, and an average is the statistic a broken simulation is most
    // likely to get right - the 297-yard rushing game and the 64-attempt
    // passing game both sat inside a table of perfectly reasonable means. A
    // distribution is what tells them apart.
    //
    // The ceiling is a FACT rather than a measurement, the same way the
    // 70-attempt ceiling above is: 72 points is the most any NFL team has
    // scored in a game (Washington, 1966). A simulated team may not beat it.
    title: "Team scores are distributed like football's, tail included",
    ok: scoreShape.median >= 20 && scoreShape.median <= 32 &&
        scoreShape.p90 <= 46 && scoreShape.max < 72,
    detail: `median ${scoreShape.median}, p75 ${scoreShape.p75}, p90 ${scoreShape.p90}, max ${scoreShape.max}`,
  },
  {
    // The same question of efficiency rather than of totals. A game where
    // every team gains 6.5 a play is not football either: the spread between
    // an offence having a day and one being stopped is most of what a viewer
    // is actually watching. The ceiling is again a real one - no NFL team has
    // averaged 12 yards a play over a full game in the modern era.
    title: "Yards per play spreads the way a season's games do",
    ok: yppShape.p90 - yppShape.median >= 0.9 && yppShape.p90 <= 10 && yppShape.max < 12,
    detail: `median ${yppShape.median.toFixed(2)}, p90 ${yppShape.p90.toFixed(2)}, max ${yppShape.max.toFixed(2)}`,
  },
  {
    // THE FLOOR, which did not exist. Measured before this check was written:
    // 2% of games named a player with under 60 total yards and the first
    // percentile was zero, so a man who did nothing at all could be the story
    // of a game. Nothing here demands YARDS - a kicker and a secondary have
    // none, and that is the point - only that the reason exists.
    title: "Every man of the match did something that decided a game",
    ok: mvpTrivial.length === 0,
    detail: mvpTrivial.length === 0
      ? `${shape.mvps.length} games, none named on a trivial line`
      : `${mvpTrivial.length} of ${shape.mvps.length} named on nothing: ` +
        mvpTrivial.slice(0, 3).map((m) => `${m.slot} ${m.yards}yds`).join(", "),
  },
  {
    // AND WHO IT IS IN A GAME WITH NOTHING IN IT. Real football's low-scoring
    // games belong to defences and kickers; this game's belonged to whichever
    // skill player happened to lead a quiet box score, because yardage was
    // priced the same in a 9-6 as in a 41-14 and a game has far more yards in
    // it than points. The band is a floor rather than a target: skill players
    // still win plenty of 17-7s, and demanding a majority would be claiming
    // football's quiet games are ALWAYS a defensive story, which they are not.
    title: "A game with nothing in it belongs to a defence or a kicker (20%+)",
    ok: mvpLowShare >= 0.2,
    detail: `${(100 * mvpLowShare).toFixed(1)}% of ${mvpLow.length} games at or under ` +
      `${MVP_LOW_SCORING_TOTAL} combined points (was 10.5% before the scarcity weighting)`,
  },
  {
    // The near-tie rule, from the other end. A losing player CAN be the best
    // man on the field - a 400-yard game in a loss is a real thing - so this
    // is a ceiling on how often, not a ban. Before the rule, side "A" broke
    // exact ties, which is not a fact about the game at all.
    title: "The man of the match is usually on the winning side (loser under 30%)",
    ok: mvpLosingShare <= 0.3,
    detail: `${(100 * mvpLosingShare).toFixed(1)}% of games named someone who lost`,
  },
  {
    // Issue #19 asked for reasoning a card can print. A blank one would render
    // as an empty line rather than as an error, which is the silent-failure
    // shape CLAUDE.md forbids.
    title: "Every man of the match can say why",
    ok: mvpUnexplained === 0,
    detail: mvpUnexplained === 0
      ? `${shape.mvps.length} reasons, e.g. "${shape.mvps[0]?.reason ?? ""}"`
      : `${mvpUnexplained} named with no reason`,
  },
  {
    title: "The drives still add up to the scoreboard",
    ok: unreconciled === 0,
    detail: `${unreconciled} games where the drives and the final score disagreed`,
  },
];

const report = checks.map((c) => ({ title: c.title, status: c.ok ? PASS : FAIL, detail: c.detail }));
for (const c of report) console.log(renderCheck(c));
const { counts, ok } = summarize(report);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
