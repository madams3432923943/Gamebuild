#!/usr/bin/env node
// Does the man on the field matter, and does he play a football-shaped game?
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
import { setActiveSport } from "../js/sports/index.js";

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

/** A median player of a position, so everything except the tested slot is held
 * constant - the comparison is between quarterbacks, not between supporting
 * casts. */
function medianOf(pool, key) {
  const sorted = [...pool].sort((a, b) => (a[key] || 0) - (b[key] || 0));
  return sorted[Math.floor(sorted.length / 2)];
}
const medianRB = medianOf(rbPool, "rush_yds");
const wrPool = players.filter((p) => has(p, "WR") && p.rec_yds > 0);
const tePool = players.filter((p) => has(p, "TE") && p.rec_yds > 0);
const medianWR = medianOf(wrPool, "rec_yds");
const medianTE = medianOf(tePool, "rec_yds");
const unitFor = (group) => {
  const list = units.filter((u) => u.group === group);
  return list[Math.floor(list.length / 2)] || list[0];
};

/** A full ranked roster with one slot swapped for the player under test. */
function rosterWith(overrides = {}) {
  return {
    QB: overrides.QB, RB: overrides.RB || medianRB,
    WR1: medianWR, WR2: medianWR, WR3: medianWR, TE: medianTE,
    OL: unitFor("OL"), DL: unitFor("DL"), LB: unitFor("LB"),
    CB: unitFor("CB"), S: unitFor("S"), ST: unitFor("ST"),
    ...overrides,
  };
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

const verticalAttempts = [];
const groundCarries = [];
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
  const ground = NFL.simulate(rosterA, rosterB, ctx, {
    strategyA: GROUND, strategyB: BAL, rand: mulberry32(i * 104729 + 11),
  });
  groundCarries.push((ground.boxA.RB || {}).carries || 0);
}
const vertical = summarise(verticalAttempts);
const ground = summarise(groundCarries);

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
for (let i = 0; i < RATE_GAMES; i++) {
  const rosterA = rosterWith({ QB: qbPool[i % qbPool.length], RB: rbPool[i % rbPool.length] });
  const rosterB = rosterWith({ QB: qbPool[(i * 7) % qbPool.length], RB: rbPool[(i * 3) % rbPool.length] });
  const result = NFL.simulate(rosterA, rosterB, ctx, {
    strategyA: BAL, strategyB: BAL, rand: mulberry32(i * 15486071 + 3),
  });
  for (const [box, team] of [[result.boxA, result.teamStatsA], [result.boxB, result.teamStatsB]]) {
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
  }
  rate.seconds.push(result.teamStatsA.possessionSeconds + result.teamStatsB.possessionSeconds);
}
const mean = (list) => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
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
  for (const drive of result.drives) {
    if (drive.outcome === "touchdown") {
      touchdowns += 1;
      if (!drive.conversion) missingConversion += 1;
      const marginAfterSix = live[drive.team] + 6 - live[drive.team === "A" ? "B" : "A"];
      if (drive.quarter >= 4 && CHART_MARGINS.includes(marginAfterSix)) {
        onChart += 1;
        if (drive.conversion?.type === "two") onChartWentForTwo += 1;
      }
      if (drive.conversion?.type === "two") twoPointTries += 1;
    }
    live[drive.team] += drive.points;
  }
  if (live.A !== result.teamScoreA || live.B !== result.teamScoreB) unreconciled += 1;
}
const twoPointRate = touchdowns ? twoPointTries / touchdowns : 0;

const poor = tierStats.get("poor") && eff(tierStats.get("poor"));
const avg = tierStats.get("average") && eff(tierStats.get("average"));
const good = tierStats.get("good") && eff(tierStats.get("good"));
const elite = tierStats.get("elite") && eff(tierStats.get("elite"));

// Real football, for the bands below: league completion rate sits around
// 62-67%, a poor starter around 58%, an elite one around 70%. Yards per
// attempt runs about 5.8 (poor) to 8.5 (elite). A team throws about 33 times.
const checks = [
  {
    title: "Completion rate rises with quarterback quality",
    ok: !!(poor && elite) && elite.compPct > poor.compPct + 0.04,
    detail: `poor ${(poor.compPct * 100).toFixed(1)}% -> elite ${(elite.compPct * 100).toFixed(1)}%`,
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
    ok: !!(poor && elite) &&
      poor.yardsPerGame < 230 &&
      elite.yardsPerGame - poor.yardsPerGame > 90 &&
      poor.compPct < 0.58,
    detail:
      `bottom tier ${poor.yardsPerGame.toFixed(0)} yds at ${(poor.compPct * 100).toFixed(1)}%, ` +
      `${(elite.yardsPerGame - poor.yardsPerGame).toFixed(0)} behind elite`,
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
    // Widened once, on purpose and on the record. The first thresholds were cut
    // against an engine running 52 snaps a game against football's 63; fixing
    // that lifted every volume number about eight percent, attempts included.
    // The bands below are the same claim about football measured against an
    // engine that now plays the right number of downs.
    title: "The most pass-heavy gameplan still throws a real number of times",
    ok: vertical.median <= 44 && vertical.p95 <= 55 && vertical.max <= 64,
    detail: `Vertical Attack median ${vertical.median}, p95 ${vertical.p95}, max ${vertical.max}`,
  },
  {
    // The other end of the same band: narrowing it must not have flattened the
    // plans into each other. A ground team still runs like a ground team.
    title: "Ground Control still runs the ball far more than balanced",
    ok: ground.median >= carries.median + 4,
    detail: `${ground.median} carries against balanced's ${carries.median}`,
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
    title: "Two-point tries stay as rare as they really are (4-14% of TDs)",
    ok: twoPointRate >= 0.04 && twoPointRate <= 0.14,
    detail: `${(twoPointRate * 100).toFixed(1)}% of ${touchdowns} touchdowns`,
  },
  {
    // 9.8 was the reported figure, by way of a 297-yard rushing game.
    title: "Yards per carry is a football number (3.8-5.0)",
    ok: yardsPerCarry >= 3.8 && yardsPerCarry <= 5.0,
    detail: `${yardsPerCarry.toFixed(2)} a carry over ${mean(rate.carries).toFixed(1)} attempts`,
  },
  {
    title: "Yards per play is a football number (4.8-6.2)",
    ok: yardsPerPlay >= 4.8 && yardsPerPlay <= 6.2,
    detail: `${yardsPerPlay.toFixed(2)} on ${mean(rate.plays).toFixed(1)} plays for ${mean(rate.yards).toFixed(0)} yards`,
  },
  {
    title: "A team runs a football number of plays (56-70)",
    ok: mean(rate.plays) >= 56 && mean(rate.plays) <= 70,
    detail: `${mean(rate.plays).toFixed(1)} plays over ${mean(rate.drives).toFixed(1)} drives`,
  },
  {
    title: "A drive gains a football number of yards (26-36)",
    ok: yardsPerDrive >= 26 && yardsPerDrive <= 36,
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
