#!/usr/bin/env node
// DOES A BETTER FOOTBALL ROSTER ACTUALLY WIN MORE OFTEN, AND DOES A WORSE ONE
// LOOK WORSE ON THE SCOREBOARD?
//
// WHY THIS EXISTS
//
// A live ranked game was lost 41-31 to a bot offence of C.J. Beathard, Shonn
// Greene, Jason Avant and O.J. Santiago, by a roster built around defenders the
// player could name. Nothing in the harness would have flinched at it, because
// nothing measured the one property the complaint was actually about: how much
// the DRAFT decides the game.
//
// scripts/verify-nfl-realism.mjs measures whether a football game looks like
// football - yards per play, carries, completion rates, the shape of a passing
// line. Every one of those can be perfect while the result is a coin flip, and
// they were. tools/calibrate-nfl-variance.mjs does measure a win rate, but it
// SOLVES against it rather than asserting it, so a regression there comes back
// as a different constant rather than as a failure.
//
// So this file asserts the three things that make a drafting game a game:
//
//   1. THE RATINGS SEPARATE. A defensive unit's rating must be about how well
//      it defended, not about how many men the team rotated through it. This is
//      the check that would have caught the original fault: unit quality was
//      per-game COUNTING STATS, which scale with rotation size and with how
//      many snaps the defence was on the field for, so mean rating rose
//      monotonically with `depth` and famous defences rated ordinary.
//
//   2. THE GAP DECIDES GAMES. A clearly better roster wins clearly more often,
//      and the curve rises with the gap rather than sitting flat.
//
//   3. THE FAILURE PATTERN IS GONE. A weak offence facing a strong defence very
//      rarely puts up 40, which is the report that started this.
//
// ...and one property that is not about balance at all but is the first thing
// anyone suspects: that the bot is not being handed anything. Mirrored rosters
// must go 50/50, because the human and the bot run the same simulate() call.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not assert a scoring LEVEL - verify-nfl-realism owns that - and it
// does not forbid upsets. A 0.20 talent gap losing sometimes is the game
// working. The bands below are wide on purpose: they are written to catch the
// engine ceasing to reward a draft, not to pin a number.

import { NFL } from "../js/sports/nfl/index.js";
import { setActiveSport } from "../js/sports/index.js";
import { rosterRatings } from "../js/sports/nfl/engine.js";
import { rateEntry } from "../js/sports/nfl/units.js";
import { DraftState } from "../js/draft.js";

import { renderCheck, renderSection, renderTable, summarize, PASS, FAIL } from "./lib/report.mjs";

setActiveSport("nfl");
await NFL.preload();

const PAIRS = Number(process.env.NFL_TALENT_PAIRS || 320);
const GAMES_PER_PAIR = Number(process.env.NFL_TALENT_GAMES || 8);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ctx = NFL.computeDatasetStats();
const units = NFL.units();
const players = NFL.individuals();
const BALANCED = { offense: "balanced-offense", defense: "balanced-defense" };

/** Two full-strength bot rosters. banTop: 0 turns off the difficulty nerf, the
 * same override the calibrators use - the nerf shapes what a BOT drafts, and
 * this file is measuring the engine rather than the bot. */
function draftPair(seed) {
  const real = Math.random;
  Math.random = mulberry32(seed);
  try {
    const pool = NFL.playersInEra(NFL.players(), "all");
    const draft = new DraftState(pool, [], NFL.slots.ranked);
    while (!draft.isComplete()) {
      if (!draft.rollNextSquad()) break;
      draft.botAutoPick("A", { banTop: 0 });
      draft.botAutoPick("B", { banTop: 0 });
    }
    return [draft.rosterA, draft.rosterB];
  } finally {
    Math.random = real;
  }
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a, f) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : 0;
};
const share = (a, test) => (a.length ? a.filter(test).length / a.length : 0);

function correlation(a, b) {
  const n = a.length;
  if (!n) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let c = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    c += da * db;
    va += da * da;
    vb += db * db;
  }
  return va > 0 && vb > 0 ? c / Math.sqrt(va * vb) : 0;
}

const checks = [];

// ---------------------------------------------------------------------------
// 1. A DEFENSIVE RATING IS ABOUT DEFENCE, NOT ABOUT ROTATION SIZE
// ---------------------------------------------------------------------------
//
// `depth` is how many men played that position group - a roster-construction
// fact. It carries no information about how well they defended, so a rating
// that can be predicted from it is reporting the wrong thing. The volume
// metrics this replaced reached 0.53.
const DEPTH_CORRELATION_CEILING = 0.35;
const depthRows = [["group", "units", "corr(rating, depth)", "p10", "p50", "p90"]];
let worstDepth = 0;
for (const group of ["DL", "LB", "CB", "S"]) {
  const rows = units.filter((u) => u.group === group && Number(u.games) >= 6);
  if (!rows.length) continue;
  const rating = rows.map((u) => rateEntry(u, ctx));
  const depth = rows.map((u) => Number(u.depth) || 0);
  const c = correlation(rating, depth);
  worstDepth = Math.max(worstDepth, Math.abs(c));
  depthRows.push([
    group, rows.length, c.toFixed(3),
    pct(rating, 0.1).toFixed(2), pct(rating, 0.5).toFixed(2), pct(rating, 0.9).toFixed(2),
  ]);
}
checks.push({
  id: "nfl-defense-rating-not-depth",
  title: `A defensive unit's rating is not predictable from its rotation size (|r| < ${DEPTH_CORRELATION_CEILING})`,
  status: worstDepth < DEPTH_CORRELATION_CEILING ? PASS : FAIL,
  detail: `worst |correlation| ${worstDepth.toFixed(3)} (counting-stat ratings reached 0.53)`,
  table: depthRows,
});

// The same ratings still have to SPREAD. Decorrelating a metric by flattening
// it would pass the check above and destroy the draft, so both are asserted.
const spreadRows = [["group", "p10", "p90", "spread"]];
let worstSpread = 1;
for (const group of ["DL", "LB", "CB", "S"]) {
  const rating = units
    .filter((u) => u.group === group && Number(u.games) >= 6)
    .map((u) => rateEntry(u, ctx));
  if (!rating.length) continue;
  const lo = pct(rating, 0.1);
  const hi = pct(rating, 0.9);
  worstSpread = Math.min(worstSpread, hi - lo);
  spreadRows.push([group, lo.toFixed(2), hi.toFixed(2), (hi - lo).toFixed(2)]);
}
checks.push({
  id: "nfl-defense-rating-spread",
  title: "...and still separates good defensive units from bad ones (p90 - p10 > 0.35)",
  status: worstSpread > 0.35 ? PASS : FAIL,
  detail: `narrowest group spans ${worstSpread.toFixed(2)} of the rating scale`,
  table: spreadRows,
});

// ---------------------------------------------------------------------------
// 2. THE TALENT GAP DECIDES GAMES
// ---------------------------------------------------------------------------
const GAP_BUCKETS = [
  { key: "0.00-0.05", lo: 0, hi: 0.05 },
  { key: "0.05-0.10", lo: 0.05, hi: 0.1 },
  { key: "0.10-0.15", lo: 0.1, hi: 0.15 },
  { key: "0.15-0.20", lo: 0.15, hi: 0.2 },
  { key: "0.20+", lo: 0.2, hi: Infinity },
];
const buckets = new Map(GAP_BUCKETS.map((b) => [b.key, { wins: 0, games: 0, strong: [], weak: [] }]));
/** Every score either side posted, across every drafted pair. This is the
 * population the game actually produces, and the only honest place to ask
 * whether the engine ever ERASES a team rather than merely beating it. */
const draftedScores = [];

// Mirrored: the SAME pair played with the sides swapped, which is what proves
// there is no side-of-the-table advantage. See the symmetry check below.
let mirrorAWins = 0;
let mirrorGames = 0;

for (let s = 0; s < PAIRS; s++) {
  const [rosterA, rosterB] = draftPair(0x51de + s);
  if (!rosterA || !rosterB) continue;
  const ra = rosterRatings(rosterA, ctx);
  const rb = rosterRatings(rosterB, ctx);
  const totalA = ra.off + ra.def;
  const totalB = rb.off + rb.def;
  const gap = Math.abs(totalA - totalB);
  const stronger = totalA >= totalB ? "A" : "B";
  const bucket = buckets.get(GAP_BUCKETS.find((b) => gap >= b.lo && gap < b.hi)?.key);

  for (let i = 0; i < GAMES_PER_PAIR; i++) {
    const seed = s * 104729 + i * 7919;
    const result = NFL.simulate(rosterA, rosterB, ctx, {
      strategyA: BALANCED, strategyB: BALANCED, rand: mulberry32(seed),
    });
    if (bucket) {
      bucket.games += 1;
      if (result.winner === stronger) bucket.wins += 1;
      bucket.strong.push(stronger === "A" ? result.teamScoreA : result.teamScoreB);
      bucket.weak.push(stronger === "A" ? result.teamScoreB : result.teamScoreA);
    }
    draftedScores.push(result.teamScoreA, result.teamScoreB);
    // Same seed, same two rosters, sides swapped. Any difference in the result
    // is a difference between the seats, not between the teams.
    const swapped = NFL.simulate(rosterB, rosterA, ctx, {
      strategyA: BALANCED, strategyB: BALANCED, rand: mulberry32(seed),
    });
    if (result.winner) {
      mirrorGames += 1;
      if (result.winner === "A") mirrorAWins += 1;
    }
    if (swapped.winner) {
      mirrorGames += 1;
      if (swapped.winner === "A") mirrorAWins += 1;
    }
  }
}

const gapRows = [["talent gap", "games", "stronger wins", "strong pts", "weak pts", "weak p90", "weak 40+"]];
for (const b of GAP_BUCKETS) {
  const acc = buckets.get(b.key);
  if (!acc?.games) continue;
  gapRows.push([
    b.key, acc.games,
    `${((acc.wins / acc.games) * 100).toFixed(1)}%`,
    mean(acc.strong).toFixed(1),
    mean(acc.weak).toFixed(1),
    pct(acc.weak, 0.9),
    `${(share(acc.weak, (v) => v >= 40) * 100).toFixed(1)}%`,
  ]);
}

const wideBucket = buckets.get("0.10-0.15");
const widerBucket = buckets.get("0.15-0.20");
const evenBucket = buckets.get("0.00-0.05");

// A CLEAR ROSTER EDGE HAS TO BE WORTH SOMETHING. 65% is the floor rather than
// the target: the calibrator aims at 75% and the engine reached only 65% while
// a defence was rated on counting stats, so anything at or under 65 means the
// talent signal has collapsed back to where it was.
const wideRate = wideBucket?.games ? wideBucket.wins / wideBucket.games : 0;
checks.push({
  id: "nfl-talent-gap-decides",
  title: "A clearly better roster wins clearly more often (66-90% at a 0.10-0.15 gap)",
  status: wideRate > 0.66 && wideRate < 0.9 ? PASS : FAIL,
  detail: `${(wideRate * 100).toFixed(1)}% over ${wideBucket?.games || 0} games`,
  table: gapRows,
});

// ...AND THE CURVE HAS TO RISE. A single bucket in band could be luck; talent
// mattering means MORE talent matters more.
const evenRate = evenBucket?.games ? evenBucket.wins / evenBucket.games : 0;
const widerRate = widerBucket?.games ? widerBucket.wins / widerBucket.games : 0;
checks.push({
  id: "nfl-talent-curve-rises",
  title: "...and the win rate rises with the gap rather than sitting flat",
  status: evenRate < wideRate && wideRate <= widerRate + 0.05 ? PASS : FAIL,
  detail: `even ${(evenRate * 100).toFixed(1)}% -> 0.10-0.15 ${(wideRate * 100).toFixed(1)}% -> 0.15-0.20 ${(widerRate * 100).toFixed(1)}%`,
});

// UPSETS SURVIVE. The other half of the same property, and the reason this is a
// band rather than a floor: a game nobody can lose from behind is not a game.
checks.push({
  id: "nfl-upsets-survive",
  title: "An evenly matched pair is still a real contest (45-60% for the marginally better roster)",
  status: evenRate >= 0.45 && evenRate <= 0.6 ? PASS : FAIL,
  detail: `${(evenRate * 100).toFixed(1)}% over ${evenBucket?.games || 0} games at a gap under 0.05`,
});

// ---------------------------------------------------------------------------
// 3. THE REPORTED FAILURE, BUILT ON PURPOSE
// ---------------------------------------------------------------------------
//
// The four buckets the complaint asked for, made from the dataset's own tails
// rather than from a named roster - a fixture built out of specific players
// would stop meaning anything the moment the dataset was regenerated.
const rankedByRating = (pool) => [...pool].sort((a, b) => rateEntry(b, ctx) - rateEntry(a, ctx));
const posPool = (pos) => players.filter((p) => (p.pos || []).includes(pos) && Number(p.games) >= 6);
const groupPool = (group) => units.filter((u) => u.group === group && Number(u.games) >= 6);

/**
 * The man at a given PERCENTILE of his own pool, best first.
 *
 * Percentile rather than index, and the difference is not cosmetic: the pools
 * are wildly different sizes (1,088 rated quarterbacks against 3,656 receivers,
 * 830 of each unit), so a fixed rank is a different player at every slot. The
 * first version of this file used rank 600 for its "weak" roster, which is a
 * below-median quarterback standing next to a top-16% receiver - a lineup
 * nobody drafts and no bucket describes.
 */
const at = (pool, percentile, offset = 0) => {
  const sorted = rankedByRating(pool);
  const i = Math.round(percentile * (sorted.length - 1)) + offset;
  return sorted[Math.max(0, Math.min(sorted.length - 1, i))];
};

/** 0 is the best available at every slot, 1 the worst. Both sides are built the
 * same way from the same pools, so the only thing that differs between the
 * buckets below is how far down the board they reached. */
function buildRoster(offenseAt, defenseAt) {
  return {
    QB: at(posPool("QB"), offenseAt),
    RB: at(posPool("RB"), offenseAt),
    WR1: at(posPool("WR"), offenseAt),
    WR2: at(posPool("WR"), offenseAt, 1),
    WR3: at(posPool("WR"), offenseAt, 2),
    TE: at(posPool("TE"), offenseAt),
    OL: at(groupPool("OL"), offenseAt),
    DL: at(groupPool("DL"), defenseAt),
    LB: at(groupPool("LB"), defenseAt),
    CB: at(groupPool("CB"), defenseAt),
    S: at(groupPool("S"), defenseAt),
    ST: at(groupPool("ST"), Math.min(offenseAt, defenseAt)),
  };
}

// TIERS, NOT EXTREMES. "Elite" is the top 5% of a pool rather than the single
// best season ever recorded, and "weak" is the bottom quartile rather than the
// worst - the point is to describe rosters people actually end up with, and a
// bucket built from the two absolute tails measures a matchup that has never
// been drafted. The reported game was a bottom-quartile offence, not a
// last-in-history one.
const ELITE = 0.05;
const AVERAGE = 0.5;
const WEAK = 0.75;
const SCENARIOS = [
  { key: "elite offense vs weak defense", off: ELITE, def: WEAK },
  { key: "elite offense vs elite defense", off: ELITE, def: ELITE },
  { key: "average offense vs average defense", off: AVERAGE, def: AVERAGE },
  { key: "weak offense vs strong defense", off: WEAK, def: ELITE },
  { key: "weak offense vs weak defense", off: WEAK, def: WEAK },
];

const SCENARIO_GAMES = Number(process.env.NFL_TALENT_SCENARIO_GAMES || 1200);
const scenarioRows = [[
  "scenario", "mean", "median", "p90", "40+", "TD/g", "TO/g", "yds/play", "3rd down", "RZ TD",
]];
const scenarioResults = new Map();

for (const scenario of SCENARIOS) {
  // The OFFENCE under test is side A; the DEFENCE it faces is side B. Each side
  // is completed with the opposite half at league-middling quality so the only
  // thing the bucket varies is the matchup it names.
  const offense = { ...buildRoster(scenario.off, AVERAGE) };
  const defense = { ...buildRoster(AVERAGE, scenario.def) };
  const points = [];
  const tds = [];
  const turnovers = [];
  const yardsPerPlay = [];
  const thirdDown = [];
  const redZone = [];
  for (let i = 0; i < SCENARIO_GAMES; i++) {
    const r = NFL.simulate(offense, defense, ctx, {
      strategyA: BALANCED, strategyB: BALANCED, rand: mulberry32(i * 6151 + scenario.key.length),
    });
    const team = r.teamStatsA;
    points.push(r.teamScoreA);
    tds.push(r.drives.filter((d) => d.team === "A" && d.outcome === "touchdown").length);
    turnovers.push(team.turnovers);
    if (team.plays > 0) yardsPerPlay.push(team.totalYards / team.plays);
    if (team.thirdDownAttempts > 0) thirdDown.push(team.thirdDownConversions / team.thirdDownAttempts);
    if (team.redZoneTrips > 0) redZone.push(team.redZoneTouchdowns / team.redZoneTrips);
  }
  scenarioResults.set(scenario.key, { points, tds });
  scenarioRows.push([
    scenario.key,
    mean(points).toFixed(1),
    pct(points, 0.5),
    pct(points, 0.9),
    `${(share(points, (v) => v >= 40) * 100).toFixed(1)}%`,
    mean(tds).toFixed(2),
    mean(turnovers).toFixed(2),
    mean(yardsPerPlay).toFixed(2),
    `${(mean(thirdDown) * 100).toFixed(0)}%`,
    `${(mean(redZone) * 100).toFixed(0)}%`,
  ]);
}

const weakVsStrong = scenarioResults.get("weak offense vs strong defense");
const eliteVsWeak = scenarioResults.get("elite offense vs weak defense");
const eliteVsElite = scenarioResults.get("elite offense vs elite defense");

// THE REPORT THAT STARTED THIS. A 41-point game from a lineup like that one is
// allowed to exist - football has strange days - and it must be rare enough
// that seeing one is a story rather than a Tuesday.
const blowupRate = share(weakVsStrong.points, (v) => v >= 40);
checks.push({
  id: "nfl-weak-offense-rarely-explodes",
  title: "A weak offence facing a strong defence almost never scores 40 (under 1%)",
  status: blowupRate < 0.01 ? PASS : FAIL,
  detail: `${(blowupRate * 100).toFixed(2)}% of ${weakVsStrong.points.length} games, median ${pct(weakVsStrong.points, 0.5)}, p90 ${pct(weakVsStrong.points, 0.9)}`,
  table: scenarioRows,
});

// ...but a team is SUPPRESSED, NEVER ERASED, and this is asked of the drafted
// population rather than of the synthetic corner above.
//
// The scenario table is built from uniform percentile tiers, which is the clear
// way to show the four corners and is deliberately OUT OF DISTRIBUTION at the
// worst one: a roster that is bottom-quartile at all seven offensive slots
// rates about 0.29, where every bot-drafted offence rates near 0.90. No draft
// produces it, because a board forces a pick at every slot and somebody has to
// be taken. Asserting a shutout rate against a matchup nobody can reach would
// be fitting the engine to a fixture.
//
// So the erasure check is made where it means something: across every score
// either side posted in the drafted sample. Real football shuts a team out in
// about 1% of games, and an engine that has stopped rating bad rosters and
// started deleting them shows up here immediately.
const shutoutRate = share(draftedScores, (v) => v === 0);
checks.push({
  id: "nfl-drafted-teams-never-erased",
  title: "Across drafted rosters a beaten team is suppressed, not erased (under 3% shut out)",
  status: shutoutRate < 0.03 ? PASS : FAIL,
  detail:
    `${(shutoutRate * 100).toFixed(2)}% of ${draftedScores.length} team scores were 0 ` +
    `(real football about 1%), mean ${mean(draftedScores).toFixed(1)} points`,
});

// The widest gap the draft really reaches still leaves the losing side playing
// football. This is the specific trade TALENT_PARITY's ceiling exists to
// refuse, asked of the roster shape that would hit it first.
const widestWeak = [...(widerBucket?.weak || []), ...(buckets.get("0.20+")?.weak || [])];
checks.push({
  id: "nfl-worst-mismatch-still-football",
  title: "...even at the widest gap a draft reaches (loser still averages 10+ points)",
  status: mean(widestWeak) >= 10 ? PASS : FAIL,
  detail: `${mean(widestWeak).toFixed(1)} points a game over ${widestWeak.length} games at a gap of 0.15 or more`,
});

// THE BUCKETS HAVE TO BE ORDERED. The whole point of a matchup model is that
// the four corners are four different games.
const ordered =
  mean(eliteVsWeak.points) > mean(eliteVsElite.points) &&
  mean(eliteVsElite.points) > mean(weakVsStrong.points);
checks.push({
  id: "nfl-scenario-ordering",
  title: "Offence quality and defence quality both move the scoreboard, in the right direction",
  status: ordered ? PASS : FAIL,
  detail:
    `elite off vs weak def ${mean(eliteVsWeak.points).toFixed(1)} > ` +
    `elite off vs elite def ${mean(eliteVsElite.points).toFixed(1)} > ` +
    `weak off vs strong def ${mean(weakVsStrong.points).toFixed(1)}`,
});

// A STRONG DEFENCE HAS TO BE WORTH REAL POINTS. Ordering alone can be satisfied
// by a rounding error; this says the gap is one a viewer would notice.
const defenceWorth = mean(eliteVsWeak.points) - mean(eliteVsElite.points);
checks.push({
  id: "nfl-defense-worth-points",
  title: "Facing an elite defence rather than a weak one costs an elite offence 8+ points",
  status: defenceWorth >= 8 ? PASS : FAIL,
  detail: `${defenceWorth.toFixed(1)} points a game`,
});

// ---------------------------------------------------------------------------
// 4. NO SEAT ADVANTAGE
// ---------------------------------------------------------------------------
//
// The human is always side A and the bot always side B (see js/main.js, which
// makes ONE simulate() call with both rosters). If the seats were not
// symmetric, every ranked game would carry a hidden thumb. Every pair above was
// also played with the sides swapped on the same seed.
const mirrorRate = mirrorGames ? mirrorAWins / mirrorGames : 0;
checks.push({
  id: "nfl-no-seat-advantage",
  title: "Neither seat is worth anything: the same pairs played both ways go 50/50 (48-52%)",
  status: mirrorRate >= 0.48 && mirrorRate <= 0.52 ? PASS : FAIL,
  detail: `side A won ${(mirrorRate * 100).toFixed(1)}% of ${mirrorGames} decided games across both seatings`,
});

console.log(renderSection(
  `NFL talent response (${PAIRS} drafted pairs x ${GAMES_PER_PAIR} games, ${SCENARIO_GAMES} games per scenario)`
));
for (const c of checks) console.log(renderCheck(c));

const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
