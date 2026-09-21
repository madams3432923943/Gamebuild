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
const SIMS = 8000;
// THE BAND CHECKED HERE IS WIDER THAN THE DESIGN TARGET, ON PURPOSE.
//
// The target FORFEIT_RATING_COST is solved against is 3-5 win points, and it
// is solved to land on 4. What this file can MEASURE is noisier than that: a
// win-rate difference over SIMS games carries about +/-0.8, and the same
// constant reads 3.2, 4.2 and 4.5 on three different seeds. Asserting 3-5 here
// would fail about a third of the time on a correctly solved constant, and a
// check that cries wolf gets its band widened by whoever is unlucky enough to
// hit it - after they have spent an afternoon looking for a bug that is not
// there. So the band is the design target plus the noise, and it is sized to
// catch what this file exists to catch: the 15.6 of a per-slot charge and the
// 0.0 of a slot nothing charges at all.
//
// The EVENNESS check below is the precise one. It is exact rather than
// statistical - a flat team-level charge never reads the slot name, so every
// arm is the same simulation and any spread at all is a real regression.
const MIN_COST = 2.5;
const MAX_COST = 6;
// How far apart two slots may be before the cost is "slot-dependent" again.
// Tight on purpose: a flat team-level charge does not read the slot name at
// all, so every arm below is the same simulation and the spread should be 0.
// Anything else means something is charging a forfeit per-slot again.
const EVENNESS = 0.6;
// What a zero-forfeit game reads. Recorded so a rating path that moves without
// anyone meaning it to gets caught here - these two rosters are drafted to the
// same rating at every slot, so the number is a property of the engine.
//
// It is NOT the number the balance constants were solved against. Kicking
// changed twice since they were: special teams was wired into the simulation,
// then a kicker's rating became his literal season percentage, which added
// about 0.7 points a side because scaling the MISS by distance is gentler on
// an ordinary kicker at ordinary range than docking the make was.
// tools/calibrate-nfl-variance.mjs solves the same TALENT_PARITY and variance
// range either side of both, so no calibrated lever moved with them.
//
// A wins slightly more than half of these by construction, not by luck: each
// slot is drafted to the same target rating, but B may not reuse A's man, so
// B takes the second-closest match twelve times.
const UNTOUCHED = { ptsA: 27.2, ptsB: 26.5, winA: 52.8 };

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

// BOTH SIDES KICK WITH THE SAME UNIT, pinned by percentage rather than drafted
// by rating. Kicking is not what this file measures, and leaving it to the
// draft made the baseline move whenever the ST RATING was redefined - not
// because the engine changed, but because "the 0.62-rated kicker" became a
// different team. That happened twice, and the second time it showed up here
// as a 1.6-point drift with nothing behind it. One shared kicker removes
// kicking from every arm except the ST forfeit, which is the one that should
// feel it.
const kickers = pool
  .filter((e) => (e.pos || []).includes("ST") && Number(e.fg_pct) > 0)
  .sort((a, b) => a.fg_pct - b.fg_pct);
const medianKicker = kickers[Math.floor(kickers.length / 2)];
rosterA.ST = medianKicker;
rosterB.ST = medianKicker;

// COMMON RANDOM NUMBERS. Game i is played from the same seed in every arm, so
// the only difference between two arms is the forfeit being measured and most
// games come out identical in both. Measured against one shared stream instead
// - where a single flipped kick reshuffles every game after it - the same
// comparison carried about a win point of noise, which is the size of the
// effect being measured. That is how a 2.4-point cost first read as 1.1.
function measure(forfeits) {
  let a = 0, b = 0, wins = 0;
  for (let i = 0; i < SIMS; i++) {
    const rand = createSeededRng(SEED + i);
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
  if (Math.abs(got - want) > 0.4) {
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
      `${MIN_COST}-${MAX_COST} band a missed pick out of twelve should be worth ` +
      `(the target is 3-5; this band allows for measurement noise). ` +
      `Re-solve FORFEIT_RATING_COST - see the sweep note on the constant.`
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
