#!/usr/bin/env node
// DOES THE ROSTER DECIDE THE SHOT PROFILE?
//
// THE BUG THIS EXISTS FOR
//
// An online opponent whose roster held Chris Mullin, Kevin Durant, Bradley Beal
// and Dirk Nowitzki finished a game with ZERO three-point attempts. The other
// roster, also full of shooters, took two.
//
// The cause was arithmetic, not tuning. Shot lines were derived backwards - the
// simulation's POINTS were split into makes, and attempts were then inferred
// from those makes:
//
//     tpm = round(pts3 / 3)
//     tpa = tpm > 0 ? max(tpm, round(tpm / tpp)) : 0
//
// The second line says outright that a player who missed every three he took
// had taken none. The first rounds a per-QUARTER expectation, and a genuine
// 2.9-attempt-per-game shooter at 43% expects about 0.3 made threes in a
// quarter, which rounds to zero in every quarter of every game forever.
// Measured over 300 games of Chris Mullin's real 1992 season before the
// rewrite: 0.00 3PA. The same shape of error made free throws unmissable -
// attempts were inferred from makes there too, so teams shot 30-for-30.
//
// WHAT THIS FILE CHECKS
//
// Not "does a team take 25 threes". That would be the hardcoded floor the brief
// explicitly rules out, and it would erase the difference between a 1962 roster
// and a 2021 one - which is the difference that should exist. What is checked
// is that the ORDERING and the SOURCE are right:
//
//   - three-point volume is ordered by roster: shooters > average > interior
//   - the same holds inside one roster, player by player
//   - era falls out of the DATA, not out of an era coefficient: the same
//     archetype drafted from the 1960s takes far fewer threes than from the
//     2010s, because those players took far fewer
//   - free throws can miss, and a player's FT% is his own
//   - every box score reconciles with its own scoreboard
//   - a roster of capable shooters taking zero threes is rare, not routine
//
// It also prints the full Monte Carlo distribution the brief asks for, so the
// numbers can be read rather than taken on trust.

import { simulateGame, computeDatasetStats, defaultMinutes } from "../js/sports/nba/engine.js";
import { shotProfile } from "../js/sports/nba/shooting.js";
import NBA from "../js/sports/nba/index.js";
import { renderCheck, renderSection, renderTable, summarize, PASS, FAIL, WARN } from "./lib/report.mjs";
import { loadDataset } from "../data/load.mjs";

const PLAYERS = await loadDataset("nba-players");
// 400 GAMES PER ARCHETYPE, not the 1,400 this started at. Five archetypes plus
// the free-throw sample is 2,400 full Ranked simulations, and at 1,400 it was
// 7,400 - long enough to dominate the whole verify chain. Every ordering this
// file asserts is decided by a mile at 400 (a shooting roster takes ~32 threes
// against an interior roster's ~1), and the tightest measurement in it, the
// zero-3PA rate on a shooting roster, reads 0.000% either way. Raise it with
// SHOOTING_GAMES when investigating a tail.
const GAMES = Number(process.env.SHOOTING_GAMES || 400);

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry(20260908);
const stats = computeDatasetStats(PLAYERS);

// ---------------------------------------------------------------------------
// ARCHETYPES, BUILT FROM THE DATA RATHER THAN FROM A LIST OF NAMES
//
// No player is named anywhere in this file. A roster archetype is a FILTER over
// the real pool - "players whose three-point attempts are at least a quarter of
// their field goal attempts, in a season from 2010 on" - so the test keeps
// working when the dataset is regenerated, and so it is testing the model
// rather than eleven hand-picked rows.
// ---------------------------------------------------------------------------

const usable = PLAYERS.filter((p) => {
  const profile = shotProfile(p);
  // Enough of a role that a rotation spot for him is a real choice. Below this
  // a player's whole line is one or two shots a quarter and every archetype
  // looks the same.
  return profile && p.fga >= 8 && p.ppg >= 8;
});

const threeRateOf = (p) => shotProfile(p).threeRate;
const inEra = (p, from, to) => p.season >= from && p.season <= to;

// THE ERAS ARE THE DATASET'S, NOT BASKETBALL'S. data/nba-players.json starts at
// 1980 - the first season the three-point line existed - so the low-volume end
// of the era test is the early eighties rather than the sixties. Naming a decade
// the dataset does not contain would give this test an EMPTY pool and an
// ordering check that passes on zero, which is worse than not testing it.
const ARCHETYPES = {
  "modern shooters": (p) => inEra(p, 2015, 2100) && threeRateOf(p) >= 0.32,
  "modern average": (p) => inEra(p, 2015, 2100) && threeRateOf(p) >= 0.14 && threeRateOf(p) < 0.28,
  "modern interior": (p) => inEra(p, 2015, 2100) && threeRateOf(p) <= 0.05,
  "1990s shooters": (p) => inEra(p, 1990, 1999) && threeRateOf(p) >= 0.1,
  "early 1980s": (p) => inEra(p, 1980, 1985),
};

const POOLS = {};
for (const [name, filter] of Object.entries(ARCHETYPES)) POOLS[name] = usable.filter(filter);

function rosterFrom(pool, rand) {
  const roster = {};
  for (const slot of NBA.slots.ranked) roster[slot] = pool[Math.floor(rand() * pool.length)];
  return roster;
}

const emptyTally = () => ({
  games: 0, pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, ftm: 0,
  ast: 0, reb: 0, tov: 0, stl: 0, blk: 0, zeroThreeGames: 0, threePerGame: [],
});

function tallyTeam(tally, box) {
  tally.games += 1;
  let tpa = 0;
  for (const line of Object.values(box)) {
    tally.pts += line.pts;
    tally.fga += line.fga || 0;
    tally.fgm += line.fgm || 0;
    tally.tpa += line.tpa || 0;
    tally.tpm += line.tpm || 0;
    tally.fta += line.fta || 0;
    tally.ftm += line.ftm || 0;
    tally.ast += line.ast;
    tally.reb += line.reb;
    tally.tov += line.tov;
    tally.stl += line.stl;
    tally.blk += line.blk;
    tpa += line.tpa || 0;
  }
  if (tpa === 0) tally.zeroThreeGames += 1;
  tally.threePerGame.push(tpa);
}

const pct = (made, att) => (att > 0 ? (100 * made) / att : 0);
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

// ---------------------------------------------------------------------------
// THE RUN
//
// Every archetype plays a NEUTRAL, dataset-wide opponent rather than each other,
// so what is being measured is the roster's own shot profile and not the
// interaction of two extreme teams.
// ---------------------------------------------------------------------------

const neutralPool = usable;
const results = {};
const perPlayer = new Map();

for (const [name, pool] of Object.entries(POOLS)) {
  const tally = emptyTally();
  results[name] = tally;
  if (!pool.length) continue;
  for (let g = 0; g < GAMES; g++) {
    const rosterA = rosterFrom(pool, rand);
    const rosterB = rosterFrom(neutralPool, rand);
    const result = simulateGame(rosterA, rosterB, stats, {
      minutesA: defaultMinutes(rosterA),
      minutesB: defaultMinutes(rosterB),
    });
    tallyTeam(tally, result.boxA);

    // ---- player-level, banded by the player's own recorded tendency --------
    for (const slot of Object.keys(result.boxA)) {
      const player = rosterA[slot];
      const line = result.boxA[slot];
      const rate = threeRateOf(player);
      const band = rate >= 0.32 ? "high" : rate >= 0.12 ? "medium" : "low";
      const seen = perPlayer.get(band) || { games: 0, tpa: 0, tpm: 0, fga: 0 };
      seen.games += 1;
      seen.tpa += line.tpa || 0;
      seen.tpm += line.tpm || 0;
      seen.fga += line.fga || 0;
      perPlayer.set(band, seen);
    }
  }
}

// ---------------------------------------------------------------------------
// THE REPORT
// ---------------------------------------------------------------------------

const distributionRows = [
  ["roster archetype", "n", "PTS", "FGA", "3PA", "3PA rate", "FG%", "3P%", "FTA", "FT%", "AST", "REB", "TOV", "3PA p10", "p50", "p90", "0-3PA"],
];
for (const [name, t] of Object.entries(results)) {
  if (!t.games) continue;
  const per = (v) => (v / t.games).toFixed(1);
  distributionRows.push([
    name,
    String(t.games),
    per(t.pts),
    per(t.fga),
    per(t.tpa),
    `${((100 * t.tpa) / Math.max(1, t.fga)).toFixed(1)}%`,
    `${pct(t.fgm, t.fga).toFixed(1)}%`,
    `${pct(t.tpm, t.tpa).toFixed(1)}%`,
    per(t.fta),
    `${pct(t.ftm, t.fta).toFixed(1)}%`,
    per(t.ast),
    per(t.reb),
    per(t.tov),
    String(percentile(t.threePerGame, 10)),
    String(percentile(t.threePerGame, 50)),
    String(percentile(t.threePerGame, 90)),
    `${((100 * t.zeroThreeGames) / t.games).toFixed(2)}%`,
  ]);
}

const playerRows = [["player tendency band", "player-games", "3PA / game", "3P%", "FGA / game", "3PA share of FGA"]];
for (const band of ["high", "medium", "low"]) {
  const seen = perPlayer.get(band);
  if (!seen) continue;
  playerRows.push([
    band,
    String(seen.games),
    (seen.tpa / seen.games).toFixed(2),
    `${pct(seen.tpm, seen.tpa).toFixed(1)}%`,
    (seen.fga / seen.games).toFixed(2),
    `${((100 * seen.tpa) / Math.max(1, seen.fga)).toFixed(1)}%`,
  ]);
}

const checks = [];
const add = (title, ok, detail, extra = {}) =>
  checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail), ...extra });

const rate = (name) => {
  const t = results[name];
  return t && t.games ? t.tpa / t.games : 0;
};

// ---- 1. roster composition orders three-point volume -----------------------
const shooters = rate("modern shooters");
const average = rate("modern average");
const interior = rate("modern interior");
add(
  "Three-point volume is ordered by who is on the floor",
  shooters > average && average > interior,
  `shooters ${shooters.toFixed(1)} 3PA > average ${average.toFixed(1)} > interior ${interior.toFixed(1)} per game`,
  { table: distributionRows }
);

// ---- 2. and the gap is big enough to notice --------------------------------
add(
  "The gap between a shooting roster and an interior one is decisive",
  shooters >= interior * 3 && shooters - interior >= 10,
  `${shooters.toFixed(1)} against ${interior.toFixed(1)} - a factor of ${(shooters / Math.max(0.1, interior)).toFixed(1)}`
);

// ---- 3. era comes out of the data ------------------------------------------
const nineties = rate("1990s shooters");
const earlyEighties = rate("early 1980s");
add(
  "Era falls out of the seasons drafted, with no era coefficient anywhere",
  shooters > nineties && nineties > earlyEighties,
  `2015+ shooters ${shooters.toFixed(1)} > 1990s shooters ${nineties.toFixed(1)} > early 1980s ${earlyEighties.toFixed(1)} 3PA per game - ` +
    `each roster's own recorded 3PA rate, not a multiplier applied to it`
);

// ---- 4. era does not erase a shooter ---------------------------------------
add(
  "An era cannot reduce a roster of real shooters to nothing",
  nineties >= 3,
  `an all-1990s shooting roster still attempts ${nineties.toFixed(1)} threes a game; the real 1990s league average was about 14 a team, ` +
    `and an all-shooter roster should sit above it`
);

// ---- 5. zero is possible and rare ------------------------------------------
const zeroRate = (100 * results["modern shooters"].zeroThreeGames) / results["modern shooters"].games;
add(
  "A roster of capable shooters taking zero threes is extraordinarily rare",
  zeroRate < 0.5,
  `${zeroRate.toFixed(3)}% of ${results["modern shooters"].games} games - possible, never normal ` +
    `(it was the OBSERVED outcome before this rewrite)`
);

// ---- 6. player-level ordering ----------------------------------------------
const high = perPlayer.get("high");
const medium = perPlayer.get("medium");
const low = perPlayer.get("low");
const perGame = (b) => (b ? b.tpa / b.games : 0);
add(
  "High-volume shooters attempt more threes than medium, and medium more than low",
  perGame(high) > perGame(medium) && perGame(medium) > perGame(low),
  `${perGame(high).toFixed(2)} > ${perGame(medium).toFixed(2)} > ${perGame(low).toFixed(2)} 3PA per player-game`,
  { table: playerRows }
);

// ---- 7. FREE THROWS CAN MISS -----------------------------------------------
//
// The screenshots showed 30-for-30 and 35-for-35 team lines. A team's free
// throw percentage now has to sit in a believable band, and - the stronger
// statement - a perfect team line has to be rare rather than universal.
let perfectFtGames = 0;
let ftGames = 0;
let ftMade = 0;
let ftAtt = 0;
for (let g = 0; g < 400; g++) {
  const rosterA = rosterFrom(usable, rand);
  const rosterB = rosterFrom(usable, rand);
  const result = simulateGame(rosterA, rosterB, stats);
  for (const box of [result.boxA, result.boxB]) {
    let made = 0;
    let att = 0;
    for (const line of Object.values(box)) {
      made += line.ftm || 0;
      att += line.fta || 0;
    }
    ftGames += 1;
    ftMade += made;
    ftAtt += att;
    if (att >= 10 && made === att) perfectFtGames += 1;
  }
}
const teamFtPct = pct(ftMade, ftAtt);
add(
  "Free throws are shot, not awarded",
  teamFtPct > 66 && teamFtPct < 84 && perfectFtGames / ftGames < 0.02,
  `team FT% ${teamFtPct.toFixed(1)}% over ${ftGames} team-games (real league average is about 77%); ` +
    `a perfect line on 10+ attempts happened in ${((100 * perfectFtGames) / ftGames).toFixed(2)}% of them ` +
    `(it was every single one before this rewrite)`
);

// ---- 8. believable overall ranges ------------------------------------------
//
// Deliberately WIDE. The brief asks not to pin the simulation to league
// averages - roster construction, era, strategy and matchup are supposed to move
// these - so these are the bounds outside which a number is broken rather than
// merely unusual.
const all = Object.values(results).filter((t) => t.games);
const totals = all.reduce(
  (acc, t) => {
    for (const k of ["games", "pts", "fga", "fgm", "tpa", "tpm", "fta", "ftm", "ast", "reb", "tov"]) acc[k] += t[k];
    return acc;
  },
  { games: 0, pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, ftm: 0, ast: 0, reb: 0, tov: 0 }
);
const fgPct = pct(totals.fgm, totals.fga);
const tpPct = pct(totals.tpm, totals.tpa);
const fgaPerGame = totals.fga / totals.games;
const ftaPerGame = totals.fta / totals.games;
const inBand = (v, lo, hi) => v >= lo && v <= hi;
const rangesOk =
  inBand(fgPct, 38, 55) && inBand(tpPct, 25, 42) && inBand(fgaPerGame, 60, 105) && inBand(ftaPerGame, 12, 40);
add(
  "Whole-sample shooting sits in believable basketball ranges",
  rangesOk,
  `FG% ${fgPct.toFixed(1)} (38-55), 3P% ${tpPct.toFixed(1)} (25-42), ` +
    `FGA ${fgaPerGame.toFixed(1)} (60-105), FTA ${ftaPerGame.toFixed(1)} (12-40) over ${totals.games} team-games`
);

// ---- 9. every archetype's pool is big enough to mean something -------------
// An EMPTY pool is a failure, not a warning: every ordering check above would
// pass trivially against a roster that scores nothing, so a filter that matches
// nobody silently turns this whole file green.
const emptyPools = Object.entries(POOLS).filter(([, pool]) => !pool.length).map(([name]) => name);
const thinPools = Object.entries(POOLS).filter(([, pool]) => pool.length && pool.length < 40).map(([name]) => name);
checks.push({
  title: "Every archetype is drawn from a real slice of the dataset",
  status: emptyPools.length ? FAIL : thinPools.length ? WARN : PASS,
  detail: emptyPools.length
    ? `no players match: ${emptyPools.join(", ")} - every ordering above is measured against nothing`
    : thinPools.length
      ? `thin pools: ${thinPools.join(", ")} - the ordering above is measured on few players`
      : Object.entries(POOLS)
          .map(([name, pool]) => `${name}: ${pool.length}`)
          .join(", "),
});

console.log(renderSection(`NBA shot distribution (${GAMES} games per archetype)`));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}  warned ${counts[WARN]}\n`);
process.exit(ok ? 0 : 1);
