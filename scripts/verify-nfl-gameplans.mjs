#!/usr/bin/env node
// NFL gameplans: do the two choices actually DO what they say, and is either
// one of them a right answer?
//
// WHY THIS EXISTS
//
// A gameplan that reads well and changes nothing is worse than no gameplan,
// because the player believes they made a decision. So every claim a card
// makes on screen is checked here against what the simulation actually does:
// a ground plan must really run it more, a blitz against a thin line must
// really put the quarterback down, ball hawks must really take it away.
//
// And the rule from js/sports/nba/tactics.js, which is not negotiable: a plan
// must be a CHOICE, not a power gain. If one plan simply wins, ranked stops
// measuring football knowledge and starts measuring whether you picked plan 3.
// That is what the win-rate band below is for.
//
// A band is not a calibration. These numbers have not been through
// tools/calibrate-gamestyles.mjs, and this file does not pretend otherwise -
// it fails a plan that is a trap or an auto-pick, which is a floor, not proof
// that the five are balanced against each other.

import { setActiveSport } from "../js/sports/index.js";
import { NFL } from "../js/sports/nfl/index.js";
import { DraftState } from "../js/draft.js";
import { OFFENSIVE_PLANS, DEFENSIVE_PLANS } from "../js/sports/nfl/tactics.js";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

// 200 DRAFTED ROSTERS, not 60. Every plan is held to a five-point-wide band on
// either side of even, so the measurement has to be tighter than five points -
// and at 60 rosters it was not: the same plans, unchanged, read 36.6% on the
// first 60 draft seeds and 42.3% over 250, because a small set of rosters
// happens to suit some plans and not others. Fourteen seconds buys a number
// that means what it says.
const GAMES = Number(process.env.NFL_GAMEPLAN_GAMES || 200);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

setActiveSport("nfl");
// Football's dataset loads on demand now (see NFL.preload), so a script that
// reads the player pool has to ask for it first.
await NFL.preload();
const rows = NFL.playersInEra(NFL.players(), NFL.defaultEra);
const slots = NFL.slots.ranked;
const ctx = NFL.computeDatasetStats(NFL.players(), NFL.units());

/** One roster, drafted under a seed. Reused across plans so a comparison is
 * between PLANS rather than between two different sets of players. */
function draftRoster(seed) {
  const rand = mulberry32(seed);
  const real = Math.random;
  Math.random = rand;
  try {
    const draft = new DraftState(rows, [], slots);
    let guard = 0;
    while (!draft.isComplete() && guard++ < slots.length * 8) {
      const squad = draft.rollNextSquad();
      if (!squad) break;
      for (const side of ["A", "B"]) {
        const roster = side === "A" ? draft.rosterA : draft.rosterB;
        for (const player of squad.players) {
          let placed = false;
          for (const slot of slots.filter((s) => !roster[s])) {
            try {
              draft.makePick(side, player, slot);
              placed = true;
              break;
            } catch {
              /* not eligible there */
            }
          }
          if (placed) break;
        }
      }
    }
    if (!draft.isComplete()) return null;
    return { rosterA: draft.rosterA, rosterB: draft.rosterB };
  } finally {
    Math.random = real;
  }
}

const rosters = [];
for (let seed = 1; rosters.length < GAMES && seed <= GAMES * 3; seed++) {
  const r = draftRoster(seed);
  if (r) rosters.push({ seed, ...r });
}

/** A matches its plan against B's, on the same rosters and the same seed, so
 * the only thing that differs between two runs is the plan. */
function play({ rosterA, rosterB, seed }, strategyA, strategyB) {
  return NFL.simulate(rosterA, rosterB, ctx, {
    strategyA, strategyB, rand: mulberry32(seed * 7919 + 13),
  });
}

const totalsFor = (result, side) => (side === "A" ? result.teamStatsA : result.teamStatsB);
const boxFor = (result, side) => (side === "A" ? result.boxA : result.boxB);

/** Carries against pass attempts, over a whole sample. */
function runShareOf(results) {
  let carries = 0;
  let attempts = 0;
  for (const result of results) {
    for (const line of Object.values(boxFor(result, "A"))) {
      carries += line.carries || 0;
      attempts += line.att || 0;
    }
  }
  return carries + attempts > 0 ? carries / (carries + attempts) : 0;
}

const sum = (results, side, key) => results.reduce((t, r) => t + (totalsFor(r, side)[key] || 0), 0);

const BALANCED_OFF = "balanced-offense";
const BALANCED_DEF = "balanced-defense";

// ---- does an offensive plan change how the ball is moved? -----------------
const groundResults = rosters.map((r) => play(r, { offense: "ground-control", defense: BALANCED_DEF }, { offense: BALANCED_OFF, defense: BALANCED_DEF }));
const verticalResults = rosters.map((r) => play(r, { offense: "vertical-attack", defense: BALANCED_DEF }, { offense: BALANCED_OFF, defense: BALANCED_DEF }));
const groundRunShare = runShareOf(groundResults);
const verticalRunShare = runShareOf(verticalResults);

// ---- does protection vs pass rush change sacks? ---------------------------
// The same blitz, against a plan built to protect and a plan that leaves the
// quarterback exposed.
const protectedResults = rosters.map((r) => play(r, { offense: "west-coast", defense: BALANCED_DEF }, { offense: BALANCED_OFF, defense: "blitz-pressure" }));
const exposedResults = rosters.map((r) => play(r, { offense: "vertical-attack", defense: BALANCED_DEF }, { offense: BALANCED_OFF, defense: "blitz-pressure" }));
const protectedSacks = sum(protectedResults, "A", "sacksAllowed");
const exposedSacks = sum(exposedResults, "A", "sacksAllowed");

// ---- does a takeaway plan take the ball away? -----------------------------
const hawkResults = rosters.map((r) => play(r, { offense: BALANCED_OFF, defense: BALANCED_DEF }, { offense: BALANCED_OFF, defense: "ball-hawks" }));
const containResults = rosters.map((r) => play(r, { offense: BALANCED_OFF, defense: BALANCED_DEF }, { offense: BALANCED_OFF, defense: "keep-it-in-front" }));
// A's turnovers are what B's defence took away.
const hawkTakeaways = sum(hawkResults, "A", "turnovers");
const containTakeaways = sum(containResults, "A", "turnovers");

// ---- does keeping it in front really hold drives to three? ----------------
const vsContain = rosters.map((r) => play(r, { offense: "vertical-attack", defense: BALANCED_DEF }, { offense: BALANCED_OFF, defense: "keep-it-in-front" }));
const vsBlitz = rosters.map((r) => play(r, { offense: "vertical-attack", defense: BALANCED_DEF }, { offense: BALANCED_OFF, defense: "blitz-pressure" }));
const tdRate = (results) => {
  let tds = 0;
  let trips = 0;
  for (const r of results) {
    tds += totalsFor(r, "A").redZoneTouchdowns || 0;
    trips += totalsFor(r, "A").redZoneTrips || 0;
  }
  return trips > 0 ? tds / trips : 0;
};
const containTdRate = tdRate(vsContain);
const blitzTdRate = tdRate(vsBlitz);

// ---- is any plan a right answer? ------------------------------------------
// Every offensive plan against every defensive plan, both ways round, so a
// plan's record is measured across the whole field rather than against one
// opponent that happens to suit it.
const record = new Map();
const noteResult = (id, won, decided) => {
  const r = record.get(id) || { wins: 0, decided: 0 };
  if (decided) {
    r.decided += 1;
    if (won) r.wins += 1;
  }
  record.set(id, r);
};

let sideAWins = 0;
let decidedMirror = 0;
// EVERY roster, not the first 40. A plan's rate was measured over 200 games,
// where one flipped game is half a point and the band's floor is five points
// away - so an engine change that shuffles the random stream moved a plan by
// three or four points without changing anything about the plan. Widening the
// sample is what makes the band a measurement rather than a reading, and the
// roster count is already the knob (NFL_GAMEPLAN_GAMES) for trading runtime
// against confidence.
const matchupSample = rosters;
for (const roster of matchupSample) {
  for (const off of OFFENSIVE_PLANS) {
    for (const def of DEFENSIVE_PLANS) {
      const mine = { offense: off.id, defense: def.id };
      const theirs = { offense: BALANCED_OFF, defense: BALANCED_DEF };
      // BOTH SEATS, always. draftRoster's two rosters are drafted greedily and
      // are not equal in strength, so "plan X in seat A against balanced in
      // seat B" measures the plan PLUS whatever the seat's roster is worth -
      // and that second term is not small. It was invisible while every plan
      // carried it equally and the whole board sat near 50%; making player
      // quality matter more in the run game tilted the rosters further apart
      // and pushed the board to 44%, which reads as five plans going bad at
      // once rather than as one flaw in the measurement. Playing each plan in
      // both seats cancels the roster and the seat together.
      for (const seat of ["A", "B"]) {
        const result = seat === "A" ? play(roster, mine, theirs) : play(roster, theirs, mine);
        const decided = result.winner !== null;
        noteResult(off.id, result.winner === seat, decided);
        noteResult(def.id, result.winner === seat, decided);
      }
    }
  }
}

// ---- is the SEAT worth anything? -------------------------------------------
// Not "does roster A beat roster B" - the two drafted rosters are different
// teams, so that would measure the draft rather than the seat. A roster
// against ITSELF isolates the seat completely: anything other than ~50% is a
// structural advantage to going first. The engine's own coin-toss note records
// 50.8% among decided games for identical rosters, which is what this holds.
for (const roster of rosters) {
  const plans = { offense: BALANCED_OFF, defense: BALANCED_DEF };
  // The SAME roster in both seats. Two different drafted teams would measure
  // the draft; one team against itself measures only the seat, which is the
  // question. Several seeds each, because one game is a coin toss.
  for (const side of ["rosterA", "rosterB"]) {
    for (let k = 0; k < 4; k++) {
      const mirror = { seed: roster.seed * 31 + k, rosterA: roster[side], rosterB: roster[side] };
      const result = play(mirror, plans, plans);
      if (result.winner !== null) {
        decidedMirror += 1;
        if (result.winner === "A") sideAWins += 1;
      }
    }
  }
}

const rates = [...record.entries()].map(([id, r]) => ({ id, rate: r.decided ? r.wins / r.decided : 0.5, decided: r.decided }));
const worst = rates.reduce((a, b) => (a.rate < b.rate ? a : b));
const best = rates.reduce((a, b) => (a.rate > b.rate ? a : b));
const sideAShare = decidedMirror ? sideAWins / decidedMirror : 0.5;

// ---- determinism -----------------------------------------------------------
const replayA = play(rosters[0], { offense: "vertical-attack", defense: "ball-hawks" }, { offense: "ground-control", defense: "run-wall" });
const replayB = play(rosters[0], { offense: "vertical-attack", defense: "ball-hawks" }, { offense: "ground-control", defense: "run-wall" });
const deterministic = replayA.teamScoreA === replayB.teamScoreA && replayA.teamScoreB === replayB.teamScoreB;

// ---- the two choices are genuinely independent ------------------------------
// Changing only the DEFENSIVE plan must change the game. If it did not, the
// second decision would be decoration.
const defenceMatters = rosters.slice(0, 30).some((r) => {
  const a = play(r, { offense: "west-coast", defense: "ball-hawks" }, { offense: BALANCED_OFF, defense: BALANCED_DEF });
  const b = play(r, { offense: "west-coast", defense: "keep-it-in-front" }, { offense: BALANCED_OFF, defense: BALANCED_DEF });
  return a.teamScoreA !== b.teamScoreA || a.teamScoreB !== b.teamScoreB;
});
const offenceMatters = rosters.slice(0, 30).some((r) => {
  const a = play(r, { offense: "ground-control", defense: BALANCED_DEF }, { offense: BALANCED_OFF, defense: BALANCED_DEF });
  const b = play(r, { offense: "vertical-attack", defense: BALANCED_DEF }, { offense: BALANCED_OFF, defense: BALANCED_DEF });
  return a.teamScoreA !== b.teamScoreA || a.teamScoreB !== b.teamScoreB;
});

const WIN_FLOOR = 0.4;
const WIN_CEIL = 0.6;

const checks = [
  {
    title: "A ground plan actually runs the ball more than a vertical one",
    ok: groundRunShare > verticalRunShare + 0.1,
    detail: `Ground Control ${groundRunShare.toFixed(3)} against Vertical Attack ${verticalRunShare.toFixed(3)}`,
  },
  {
    title: "Protection beats pressure; leaving the quarterback exposed costs sacks",
    ok: exposedSacks > protectedSacks,
    detail: `West Coast allowed ${protectedSacks}, Vertical Attack allowed ${exposedSacks}, against the same blitz`,
  },
  {
    title: "A takeaway plan takes the ball away more than a containing one",
    ok: hawkTakeaways > containTakeaways,
    detail: `Ball Hawks forced ${hawkTakeaways}, Keep It in Front forced ${containTakeaways}`,
  },
  {
    title: "Keeping it in front holds more drives to three points",
    ok: containTdRate < blitzTdRate,
    detail: `red-zone TD rate ${containTdRate.toFixed(3)} against Keep It in Front, ${blitzTdRate.toFixed(3)} against Blitz Pressure`,
  },
  {
    title: "The offensive choice changes the game",
    ok: offenceMatters,
    detail: offenceMatters ? "different plans give different results" : "offensive plan had no effect",
  },
  {
    title: "The defensive choice changes the game",
    ok: defenceMatters,
    detail: defenceMatters ? "different plans give different results" : "defensive plan had no effect - it is decoration",
  },
  {
    title: `No plan is a trap or an auto-pick (${WIN_FLOOR * 100}-${WIN_CEIL * 100}% win rate)`,
    ok: worst.rate >= WIN_FLOOR && best.rate <= WIN_CEIL,
    detail: `worst ${worst.id} ${(worst.rate * 100).toFixed(1)}%, best ${best.id} ${(best.rate * 100).toFixed(1)}%, over ${worst.decided} decided games each`,
  },
  {
    title: "The seat is worth nothing - a roster against itself splits evenly",
    ok: Math.abs(sideAShare - 0.5) < 0.05,
    detail: `side A took ${(sideAShare * 100).toFixed(1)}% of ${decidedMirror} decided mirror games`,
  },
  {
    title: "The same plans and the same seed replay exactly",
    ok: deterministic,
    detail: `${replayA.teamScoreA}-${replayA.teamScoreB} twice`,
  },
];

console.log(renderSection(`NFL gameplans (${rosters.length} rosters, ${OFFENSIVE_PLANS.length} offensive x ${DEFENSIVE_PLANS.length} defensive)`));
const report = checks.map((c) => ({ title: c.title, status: c.ok ? PASS : FAIL, detail: c.detail }));
for (const c of report) console.log(renderCheck(c));
const { counts, ok } = summarize(report);
console.log("\n  win rate by plan:");
for (const r of rates.sort((a, b) => b.rate - a.rate)) {
  console.log(`    ${r.id.padEnd(20)} ${(r.rate * 100).toFixed(1)}%`);
}
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
