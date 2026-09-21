#!/usr/bin/env node
// WHAT DOES A FORFEITED PICK COST, AND IS IT THE SAME COST FOR EVERY SLOT?
//
// WHY THIS EXISTS
//
// A forfeited pick used to scale the forfeited slot's OWN rating by 0.55, so
// what a missed pick cost you depended entirely on which slot the draft clock
// happened to run out on. Measured over 3,000 seeded sims between two evenly
// matched rosters, that came out as:
//
//   QB          -15.6 win points
//   DL/LB/CB/S  -13 to -15   (charged twice: sideRating AND defensiveAxisStrength)
//   RB/WR/TE/OL -4.6 to -6.4
//   WR3         -3.1
//   ST           0.0         (no side-rating weight to scale, so literally free)
//
// A penalty no player can predict is not a penalty, it is a trap - and the one
// slot that cost nothing at all was the one whose PICK was worth 12.5 win
// points, so the clock drafting your kicker was free.
//
// The charge is now one flat team-level deduction per forfeit, applied to both
// side ratings and to kicking accuracy. This file asserts the three properties
// that shape is supposed to buy:
//
//   1. EVEN. Every slot costs the same, special teams included.
//   2. PROPORTIONATE. One forfeit out of twelve costs 3-5 win points.
//   3. LINEAR. Two forfeits cost about twice one, three about three times.
//
// ...and the property that says no calibrated constant moved underneath us:
//
//   4. A ZERO-FORFEIT GAME IS UNTOUCHED. TALENT_PARITY, EDGE_BASELINE, the
//      quarter-variance range and every gamestyle mod were solved against a
//      game with no forfeits in it. If that game moves, they all need
//      re-solving, and a silent drift here is how that goes unnoticed.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not assert WHICH value FORFEIT_RATING_COST holds. The constant is
// solved against the win-point band above; pinning the number here would turn
// a re-solve into a test edit and make the band decorative.

import { loadDataset } from "../data/load.mjs";
import * as E from "../js/sports/nfl/engine.js";
import { rateEntry } from "../js/sports/nfl/units.js";
import { createSeededRng } from "../js/lib/seeded-rng.js";

const SEED = 12345;
const SIMS = 3000;
// The band a missed pick out of twelve should land in. Wider than the measured
// spread on purpose: this is the fairness claim, not the current number.
const MIN_COST = 3;
const MAX_COST = 5;
// How far apart two slots may be before the cost is "slot-dependent" again.
const EVENNESS = 0.6;
// What a zero-forfeit game read when the balance constants were last solved.
const UNTOUCHED = { ptsA: 26.8, ptsB: 25.9, winA: 53.6 };

const SLOTS = ["QB", "RB", "WR1", "WR2", "WR3", "TE", "OL", "DL", "LB", "CB", "S", "ST"];

const players = await loadDataset("nfl-players");
const units = await loadDataset("nfl-units");
const ctx = E.computeDatasetStats(players, units);

// Two rosters drafted to the same rating at every slot, so the only thing
// separating them in any run below is the forfeit being measured.
const pool = [...players, ...units];
const key = (e) => `${e.name}|${e.team}|${e.season}`;
const used = new Set();
function draftAt(slot, target) {
  const base = slot.replace(/\d+$/, "");
  const eligible = pool.filter((e) => (e.pos || []).includes(base) && !used.has(key(e)));
  eligible.sort(
    (x, y) => Math.abs(rateEntry(x, ctx) - target) - Math.abs(rateEntry(y, ctx) - target)
  );
  used.add(key(eligible[0]));
  return eligible[0];
}
const roster = (target) => Object.fromEntries(SLOTS.map((s) => [s, draftAt(s, target)]));
const rosterA = roster(0.62);
const rosterB = roster(0.62);

function measure(forfeits) {
  const rand = createSeededRng(SEED);
  let a = 0, b = 0, wins = 0;
  for (let i = 0; i < SIMS; i++) {
    const r = E.simulate(rosterA, rosterB, ctx, {
      rand, forfeitsA: forfeits, tacticA: "balanced", tacticB: "balanced",
    });
    a += r.teamScoreA;
    b += r.teamScoreB;
    if (r.winner === "A") wins++;
  }
  return { ptsA: a / SIMS, ptsB: b / SIMS, winA: (100 * wins) / SIMS };
}

const failures = [];
const base = measure([]);
console.log(
  `baseline (no forfeit): ${base.ptsA.toFixed(1)} - ${base.ptsB.toFixed(1)}, ` +
  `A wins ${base.winA.toFixed(1)}%`
);

// 4. A zero-forfeit game is untouched.
for (const [field, want] of Object.entries(UNTOUCHED)) {
  const got = base[field];
  if (Math.abs(got - want) > 0.15) {
    failures.push(
      `a zero-forfeit game moved: ${field} is ${got.toFixed(1)}, was ${want} when the ` +
      `balance constants were solved. Re-run tools/calibrate-nfl-variance.mjs then ` +
      `tools/calibrate-nfl-gamestyles.mjs, or find what changed the rating path.`
    );
  }
}

// 1 + 2. Even, and proportionate.
const costs = [];
for (const slot of SLOTS) {
  const cost = base.winA - measure([slot]).winA;
  costs.push({ slot, cost });
  console.log(`  forfeit ${slot.padEnd(3)} costs ${cost.toFixed(1)} win points`);
  if (cost < MIN_COST || cost > MAX_COST) {
    failures.push(
      `forfeiting ${slot} costs ${cost.toFixed(1)} win points, outside the ` +
      `${MIN_COST}-${MAX_COST} band a missed pick out of twelve should be worth. ` +
      `Re-solve FORFEIT_RATING_COST.`
    );
  }
}
const spread = Math.max(...costs.map((c) => c.cost)) - Math.min(...costs.map((c) => c.cost));
if (spread > EVENNESS) {
  const sorted = [...costs].sort((x, y) => y.cost - x.cost);
  failures.push(
    `the cost of a forfeit depends on WHICH slot again: ${spread.toFixed(1)} win points ` +
    `between ${sorted[0].slot} (${sorted[0].cost.toFixed(1)}) and ` +
    `${sorted.at(-1).slot} (${sorted.at(-1).cost.toFixed(1)}). Something is charging a ` +
    `forfeit per-slot on top of the flat team-level cost.`
  );
}

// 3. Linear in the count.
const one = costs.reduce((t, c) => t + c.cost, 0) / costs.length;
for (const [n, slots] of [[2, ["QB", "WR1"]], [2, ["DL", "LB"]], [3, ["QB", "RB", "WR1"]]]) {
  const cost = base.winA - measure(slots).winA;
  console.log(`  forfeit ${slots.join("+")} costs ${cost.toFixed(1)} win points`);
  // Loose: win probability is bounded, so it has to bend eventually. This
  // catches a cost that compounds or saturates, not honest curvature.
  if (cost < one * n * 0.7 || cost > one * n * 1.4) {
    failures.push(
      `${n} forfeits (${slots.join("+")}) cost ${cost.toFixed(1)} win points, not about ` +
      `${(one * n).toFixed(1)} - ${n}x the ${one.toFixed(1)} one costs. The charge is ` +
      `not linear in the number of picks missed.`
    );
  }
}

if (failures.length) {
  console.error("\nFAIL");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nOK - every forfeited slot costs the same 3-5 win points, linearly.");
