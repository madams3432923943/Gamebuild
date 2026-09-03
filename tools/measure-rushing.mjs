#!/usr/bin/env node
// DOES DRAFTING A BETTER RUNNING BACK BUY ANYTHING?
//
// The question this answers is not "is the rushing game realistic" -
// scripts/verify-nfl-realism.mjs holds that, and holds it at the TEAM level.
// It is the narrower and more commercial one: a player spends a first-round
// pick on Derrick Henry instead of a committee back, and this measures what
// that pick is worth.
//
// WHY IT IS A TOOL AND NOT A CHECK. A check answers yes or no against a band.
// This prints a table, because the interesting failure is not "out of range",
// it is "every row is the same" - and a band cannot see flatness. The bands
// that came out of it live in verify-nfl-realism.mjs.
//
// The buckets are by DRAFT RATING, not by workload. Workload buckets answer
// "did a committee back run like a committee back", which is a realism
// question; rating buckets answer "did the board tell me the truth", which is
// the one a drafter is asking. They are not the same cut: the bot takes
// high-efficiency low-volume backs, so the drafted pool skews away from the
// league's.
//
//   node tools/measure-rushing.mjs [--games 800] [--json out.json]
//
// Pass --json to write the numbers somewhere a later run can diff against,
// which is what makes a before-and-after table honest rather than remembered.

import { writeFile } from "node:fs/promises";

import { NFL } from "../js/sports/nfl/index.js";
import { setActiveSport } from "../js/sports/index.js";
import { rateEntry } from "../js/sports/nfl/units.js";
import { DraftState } from "../js/draft.js";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const GAMES = Number(arg("games", 800));
const JSON_OUT = arg("json", null);

setActiveSport("nfl");
await NFL.preload();
const ctx = NFL.computeDatasetStats();
const BALANCED = { offense: "balanced-offense", defense: "balanced-defense" };
const SLOTS = NFL.slots.ranked;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Two bot-drafted rosters - the rosters people actually play with, not a
 * median cast. The realism suite learned this the hard way: a median cast ran
 * 30% quieter than a real game and every rate fitted to it was wrong. */
function draftPair(seed) {
  const real = Math.random;
  Math.random = mulberry32(seed);
  try {
    const pool = NFL.playersInEra(NFL.players(), "all");
    const draft = new DraftState(pool, [], SLOTS);
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

const LEAGUE_YPC = 4.3;
const realCarriesPerGame = (entry) => {
  const yards = Math.max(0, Number(entry?.rush_yds) || 0);
  if (yards <= 0) return 0;
  const ypc = Number(entry?.ypc) || 0;
  return ypc > 0 ? yards / ypc : yards / LEAGUE_YPC;
};

/** Rating bands. Thirds rather than deciles: a decile of a 12-slot draft over
 * 800 games is a handful of backs and the row would be noise. */
const RATING_BANDS = [
  { key: "weak", label: "weak RB (bottom third)", lo: 0, hi: 1 / 3 },
  { key: "mid", label: "mid RB (middle third)", lo: 1 / 3, hi: 2 / 3 },
  { key: "elite", label: "elite RB (top third)", lo: 2 / 3, hi: 1.01 },
];
const WORKLOAD_BANDS = [
  { key: "committee", label: "committee (<12 real car/g)", lo: 0, hi: 12 },
  { key: "starter", label: "starter (12-18)", lo: 12, hi: 18 },
  { key: "workhorse", label: "workhorse (18+)", lo: 18, hi: 999 },
];

const blank = () => ({ ypc: [], yards: [], carries: [], explosive: [], rating: [], realYpc: [] });
for (const b of [...RATING_BANDS, ...WORKLOAD_BANDS]) b.acc = blank();

// The rating distribution of DRAFTED backs, so the thirds are thirds of what
// the board actually hands out rather than of the whole pool.
const draftedRatings = [];
const pairs = [];
for (let i = 0; i < Math.min(GAMES, 120); i++) pairs.push(draftPair(0x2b00_0000 + i));
for (const [a, b] of pairs) {
  for (const roster of [a, b]) {
    if (roster.RB) draftedRatings.push(rateEntry(roster.RB, ctx));
  }
}
draftedRatings.sort((x, y) => x - y);
const ratingAt = (q) => draftedRatings[Math.min(draftedRatings.length - 1, Math.floor(q * draftedRatings.length))];
for (const band of RATING_BANDS) {
  band.min = ratingAt(band.lo);
  band.max = ratingAt(Math.min(0.999, band.hi));
}

const team = { rushYards: [], totalYards: [], carries: [] };
const carriesByGroup = {};
// Every run in the sample, for the explosive rate and the spread. A run of 12+
// is football's own definition of an explosive carry.
const EXPLOSIVE_YARDS = 12;

// The environment terms the sprint asked about, measured rather than assumed:
// does a good line or a bad opposing front move the back's line at all?
const byLine = { strong: [], weak: [] };
const byOppFront = { strong: [], weak: [] };

for (let i = 0; i < GAMES; i++) {
  const [rosterA, rosterB] = pairs[i % pairs.length];
  const result = NFL.simulate(rosterA, rosterB, ctx, {
    strategyA: BALANCED, strategyB: BALANCED, rand: mulberry32(0x9e37 + i),
  });

  for (const [roster, oppRoster, box, stats] of [
    [rosterA, rosterB, result.boxA, result.teamStatsA],
    [rosterB, rosterA, result.boxB, result.teamStatsB],
  ]) {
    team.rushYards.push(stats.rushYards);
    team.totalYards.push(stats.totalYards);
    let teamCarries = 0;
    for (const [slot, line] of Object.entries(box)) {
      const carries = Number(line.carries) || 0;
      if (!carries) continue;
      const group = slot.replace(/\d+$/, "");
      carriesByGroup[group] = (carriesByGroup[group] || 0) + carries;
      teamCarries += carries;
    }
    team.carries.push(teamCarries);

    const rb = roster.RB;
    if (!rb) continue;
    const line = box.RB;
    const carries = Number(line.carries) || 0;
    const yards = Number(line.rush_yds) || 0;
    if (carries <= 0) continue;

    // Explosive runs come from the play ledger, not from the box score - the
    // box score has only a total, and "how often did he break one" is a
    // different question from "how far did he get".
    let runs = 0;
    let explosive = 0;
    for (const drive of result.drives) {
      if (drive.team !== (roster === rosterA ? "A" : "B")) continue;
      for (const play of drive.plays || []) {
        if (play.type !== "run" || play.carrier !== "RB") continue;
        runs += 1;
        if (play.gain >= EXPLOSIVE_YARDS) explosive += 1;
      }
    }

    const rating = rateEntry(rb, ctx);
    const record = (band) => {
      band.acc.ypc.push(yards / carries);
      band.acc.yards.push(yards);
      band.acc.carries.push(carries);
      band.acc.rating.push(rating);
      band.acc.realYpc.push(Number(rb.ypc) || LEAGUE_YPC);
      if (runs > 0) band.acc.explosive.push(explosive / runs);
    };
    const ratingBand = RATING_BANDS.find((b) => rating >= b.min && rating <= b.max)
      ?? (rating < RATING_BANDS[0].min ? RATING_BANDS[0] : RATING_BANDS[RATING_BANDS.length - 1]);
    record(ratingBand);
    const load = realCarriesPerGame(rb);
    const workBand = WORKLOAD_BANDS.find((b) => load >= b.lo && load < b.hi);
    if (workBand) record(workBand);

    // Environment. Split at the median of what the bot drafts, so both halves
    // are populated.
    const olRating = roster.OL ? rateEntry(roster.OL, ctx) : null;
    if (olRating != null) (olRating >= 0.5 ? byLine.strong : byLine.weak).push(yards / carries);
    const frontRating = oppRoster.DL ? rateEntry(oppRoster.DL, ctx) : null;
    if (frontRating != null) (frontRating >= 0.5 ? byOppFront.strong : byOppFront.weak).push(yards / carries);
  }
}

const mean = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);
const sd = (l) => {
  if (l.length < 2) return 0;
  const m = mean(l);
  return Math.sqrt(l.reduce((s, v) => s + (v - m) ** 2, 0) / (l.length - 1));
};
const pct = (l, q) => {
  if (!l.length) return 0;
  const s = [...l].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

const fmt = (n, d = 2) => n.toFixed(d).padStart(7);
function bandTable(title, bands) {
  console.log(`\n${title}`);
  console.log("  band                          n   simYPC  realYPC   yds/g   car/g   expl%   ypcSD");
  for (const b of bands) {
    const a = b.acc;
    console.log(
      `  ${b.label.padEnd(26)} ${String(a.ypc.length).padStart(4)} ` +
        `${fmt(mean(a.ypc))} ${fmt(mean(a.realYpc))} ${fmt(mean(a.yards), 1)} ` +
        `${fmt(mean(a.carries), 1)} ${fmt(100 * mean(a.explosive), 1)} ${fmt(sd(a.ypc))}`
    );
  }
  const ypcs = bands.map((b) => mean(b.acc.ypc));
  const ydss = bands.map((b) => mean(b.acc.yards));
  console.log(
    `  spread: ${(Math.max(...ypcs) - Math.min(...ypcs)).toFixed(2)} yards a carry, ` +
      `${(Math.max(...ydss) - Math.min(...ydss)).toFixed(0)} yards a game ` +
      `(${((Math.max(...ydss) / Math.max(1e-9, Math.min(...ydss)) - 1) * 100).toFixed(0)}% between best and worst band)`
  );
}

const totalCarries = Object.values(carriesByGroup).reduce((a, b) => a + b, 0);
console.log(`\nRUSHING — ${GAMES} games, ${pairs.length} drafted pairs\n`);
console.log("carry share by position");
for (const [group, count] of Object.entries(carriesByGroup).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${group.padEnd(5)} ${((100 * count) / totalCarries).toFixed(1).padStart(5)}%`);
}
console.log(
  `\nteam: ${mean(team.rushYards).toFixed(0)} rushing yards a game over ` +
    `${mean(team.carries).toFixed(1)} carries (${(mean(team.rushYards) / mean(team.carries)).toFixed(2)} a carry), ` +
    `${mean(team.totalYards).toFixed(0)} total`
);

bandTable("by DRAFT RATING — what a pick at this slot is worth", RATING_BANDS);
bandTable("by REAL WORKLOAD — whether a man runs like himself", WORKLOAD_BANDS);

console.log("\nenvironment");
console.log(
  `  behind a strong OL ${mean(byLine.strong).toFixed(2)} a carry, weak OL ${mean(byLine.weak).toFixed(2)} ` +
    `(difference ${(mean(byLine.strong) - mean(byLine.weak)).toFixed(2)})`
);
console.log(
  `  against a strong front ${mean(byOppFront.strong).toFixed(2)}, weak front ${mean(byOppFront.weak).toFixed(2)} ` +
    `(difference ${(mean(byOppFront.weak) - mean(byOppFront.strong)).toFixed(2)})`
);

const allYpc = RATING_BANDS.flatMap((b) => b.acc.ypc);
console.log(
  `\nspread of one back's game: p10 ${pct(allYpc, 0.1).toFixed(2)}, ` +
    `p50 ${pct(allYpc, 0.5).toFixed(2)}, p90 ${pct(allYpc, 0.9).toFixed(2)} a carry\n`
);

if (JSON_OUT) {
  const snapshot = {
    games: GAMES,
    carryShare: Object.fromEntries(
      Object.entries(carriesByGroup).map(([g, c]) => [g, c / totalCarries])
    ),
    team: {
      rushYards: mean(team.rushYards),
      totalYards: mean(team.totalYards),
      carries: mean(team.carries),
    },
    bands: Object.fromEntries(
      [...RATING_BANDS, ...WORKLOAD_BANDS].map((b) => [
        b.key,
        {
          label: b.label,
          n: b.acc.ypc.length,
          simYpc: mean(b.acc.ypc),
          realYpc: mean(b.acc.realYpc),
          yardsPerGame: mean(b.acc.yards),
          carriesPerGame: mean(b.acc.carries),
          explosiveRate: mean(b.acc.explosive),
          ypcSd: sd(b.acc.ypc),
        },
      ])
    ),
    environment: {
      strongLine: mean(byLine.strong),
      weakLine: mean(byLine.weak),
      strongFront: mean(byOppFront.strong),
      weakFront: mean(byOppFront.weak),
    },
  };
  await writeFile(JSON_OUT, JSON.stringify(snapshot, null, 2));
  console.log(`wrote ${JSON_OUT}`);
}
