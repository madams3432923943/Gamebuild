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
];

const report = checks.map((c) => ({ title: c.title, status: c.ok ? PASS : FAIL, detail: c.detail }));
for (const c of report) console.log(renderCheck(c));
const { counts, ok } = summarize(report);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
