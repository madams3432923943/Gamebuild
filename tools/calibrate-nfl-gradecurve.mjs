// Solves the draft-grade breakpoints in js/sports/nfl/constants.js.
//
// WHY THIS IS A TOOL AND NOT A RUNTIME CURVE.
//
// The grade used to build its own curve on first use, sampling 240 rosters by
// drawing UNIFORMLY from every eligible entry in the dataset and taking
// percentiles against that. Two things were wrong with it and only one was
// obvious.
//
// The obvious one: a draft does not produce uniform rosters. It produces good
// ones - a player picks the best name a rolled squad offers, and so does the
// bot. A real roster therefore sat in the top few percent of a random-assembly
// distribution almost by construction, and collected an A or an A+ for it.
// Both teams in the game that prompted this work graded A+, on 68/62 and
// 70/63.
//
// The less obvious one: draftgrade.js could not fix it where it stood.
// Sampling real drafts needs js/draft.js, js/draft.js imports the sport
// registry, and a sport module importing the drafter closes an import cycle.
// The file said so and recorded it as follow-up work.
//
// A tool has no such problem - it may import anything - and this is how the
// rest of the codebase already settles numbers that cannot be settled by
// argument (see tools/calibrate-nfl-variance.mjs). It also deletes a runtime
// cost: verify-startup-performance.mjs budgets 1.5s for that first curve
// build, and this removes the build entirely.
//
// Usage:  node tools/calibrate-nfl-gradecurve.mjs [--drafts 400]
//
// Paste the block it prints into js/sports/nfl/constants.js.

import { NFL } from "../js/sports/nfl/index.js";
import { setActiveSport } from "../js/sports/index.js";
import { DraftState, openSlots } from "../js/draft.js";
import { draftGrade } from "../js/sports/nfl/draftgrade.js";

setActiveSport("nfl");
await NFL.preload();

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};
const DRAFTS = arg("drafts", 400);

const ctx = NFL.computeDatasetStats();
const POOL = NFL.playersInEra(NFL.players(), "all");
const SLOTS = NFL.slots.ranked;

/**
 * THE POPULATION THE GRADE IS MEASURED AGAINST.
 *
 * Every difficulty, not just the strong ones. A grade that only ever saw good
 * rosters would have no idea what a bad one looks like, and D and F would be
 * unreachable - which is half of the complaint this is fixing. Easy bots draft
 * genuinely poor rosters and they belong in the reference population, because
 * a player who drafts that badly should be able to see it in a letter.
 *
 * `banTop: 0` is deliberately NOT passed: unlike the balance calibrators, this
 * wants the rosters a real game produces, difficulty nerf and all.
 */
const DIFFICULTIES = ["easy", "medium", "hard"];

/**
 * A CONTINUUM, NOT THREE CLUSTERS.
 *
 * Drafting every reference roster at one of the three bot difficulties gives
 * three tight clumps with empty space between them - measured, Easy landed at
 * 0.06, Medium at 0.22 and Hard at 0.72 - and percentiles taken against that
 * put whole letters inside the gaps, where no roster ever scores. B- came out
 * at 0.28 and C+ at 0.15 for exactly that reason.
 *
 * Real drafts are not three kinds of roster. A player has good rounds and bad
 * ones, so each roster here is drafted at a SKILL level, and each pick within
 * it is taken at that skill with noise: an all-Easy roster at one end, an
 * all-Hard roster at the other, and every mixture between. That is the shape a
 * population of real drafts has, and it is what the letters need to spread
 * across.
 */
function difficultyFor(skill) {
  const roll = Math.random();
  if (roll < skill * skill) return "hard";
  if (roll < skill * skill + 2 * skill * (1 - skill)) return "medium";
  return "easy";
}

function draftAtSkill(skill) {
  const draft = new DraftState(POOL, [], SLOTS);
  let guard = 0;
  while (openSlots(draft.rosterB, SLOTS).length > 0 && guard++ < 200) {
    if (!draft.rollNextSquad()) break;
    if (!draft.hasValidPick(draft.rosterB)) continue;
    draft.botAutoPick("B", { difficulty: difficultyFor(skill) });
  }
  return draft.rosterB;
}

const scores = [];
const bySkill = [];
process.stdout.write(`drafting ${DRAFTS} rosters across the skill range`);
for (let i = 0; i < DRAFTS; i++) {
  const skill = (i + 0.5) / DRAFTS;
  const roster = draftAtSkill(skill);
  const { score } = draftGrade(roster, ctx);
  if (!Number.isFinite(score)) continue;
  scores.push(score);
  bySkill.push([skill, score]);
  if (i % 40 === 0) process.stdout.write(".");
}
console.log("");

scores.sort((a, b) => a - b);
const at = (p) => scores[Math.min(scores.length - 1, Math.max(0, Math.floor(p * scores.length)))];
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);

/**
 * THE SHAPE THE GRADES SHOULD TAKE, as percentiles of real drafts.
 *
 * Most competent drafts land in the broad C-to-B band; a strong one earns
 * B+/A-; A and A+ ask for construction, not just names. A+ is the top 3%, so
 * seeing one means something. The bottom is reachable too: a badly built
 * roster can draw a D or an F, which the old curve could not produce at all.
 *
 * These are a product decision about what a grade should FEEL like, and they
 * are stated here rather than buried in the output so the next person can
 * argue with them directly.
 */
const TARGET = [
  [0.97, "A+"], [0.93, "A"], [0.88, "A-"],
  [0.80, "B+"], [0.68, "B"], [0.55, "B-"],
  [0.42, "C+"], [0.30, "C"], [0.20, "C-"],
  [0.12, "D+"], [0.05, "D"], [0, "F"],
];

console.log(`\n${scores.length} drafted rosters`);
console.log(`  score range ${scores[0].toFixed(3)} - ${scores[scores.length - 1].toFixed(3)}`);
for (let band = 0; band < 5; band++) {
  const lo = band / 5, hi = (band + 1) / 5;
  const inBand = bySkill.filter(([skill]) => skill >= lo && skill < hi).map(([, sc]) => sc);
  if (inBand.length) {
    console.log(`  skill ${lo.toFixed(1)}-${hi.toFixed(1)}  mean ${mean(inBand).toFixed(3)}  (n=${inBand.length})`);
  }
}

console.log("\nletter  percentile  score floor");
const lines = [];
for (const [percentile, letter] of TARGET) {
  const floor = percentile === 0 ? 0 : at(percentile);
  lines.push([floor, letter]);
  console.log(`  ${letter.padEnd(3)}   ${String(Math.round(percentile * 100)).padStart(3)}%       ${floor.toFixed(3)}`);
}

console.log("\nPaste into js/sports/nfl/constants.js:\n");
console.log("export const GRADE_BREAKPOINTS = [");
for (let i = 0; i < lines.length; i += 3) {
  const row = lines.slice(i, i + 3)
    .map(([floor, letter]) => `[${floor.toFixed(2)}, "${letter}"]`)
    .join(", ");
  console.log(`  ${row},`);
}
console.log("];");
