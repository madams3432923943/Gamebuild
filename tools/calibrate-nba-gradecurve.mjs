// Solves the draft-grade breakpoints in js/sports/nba/constants.js, and reports
// the grade distribution a population of real drafts produces.
//
// WHY THIS IS A TOOL AND NOT A RUNTIME CURVE.
//
// Basketball's grade used to build its own curve on first use (js/gradecurve.js)
// by sampling 240 rosters drawn UNIFORMLY from every eligible player in the
// dataset and taking percentiles against that. Two things were wrong with it,
// and football hit both first - see tools/calibrate-nfl-gradecurve.mjs, whose
// argument this file is the basketball half of.
//
// The obvious one: a draft does not produce uniform rosters. It produces good
// ones, because a drafter picks the best name a rolled squad offers and so does
// the bot. A real roster therefore sat in the top few percent of a
// random-assembly distribution almost by construction, and collected an A or an
// A+ for it. The reported screen graded A+ on 81 talent, 74 balance, no cover at
// point guard and a 41% deficit at small forward.
//
// The less obvious one: draftgrade.js could not fix it where it stood. Sampling
// real drafts needs js/draft.js, js/draft.js imports the sport registry, and a
// sport module importing the drafter closes an import cycle. A tool has no such
// problem.
//
// It also deletes a runtime cost: the 240-roster curve was built lazily on the
// FIRST graded draft - which is the moment the last roster spot is filled - so
// it landed as a dead screen right at the end of a draft.
//
// Usage:  node tools/calibrate-nba-gradecurve.mjs [--drafts 400]
//
// Paste the block it prints into js/sports/nba/constants.js, then re-run it to
// see the distribution those breakpoints actually produce.

import { NBA } from "../js/sports/nba/index.js";
import { setActiveSport } from "../js/sports/index.js";
import { DraftState, openSlots } from "../js/draft.js";
import { gradeDraft } from "../js/sports/nba/draftgrade.js";

setActiveSport("nba");
await NBA.preload();

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};
const DRAFTS = arg("drafts", 400);

const ctx = NBA.computeDatasetStats();
const POOL = NBA.playersInEra(NBA.players(), "all");
const SLOTS = NBA.slots.ranked;

/**
 * THE POPULATION THE GRADE IS MEASURED AGAINST.
 *
 * Every difficulty, not just the strong ones. A grade that only ever saw good
 * rosters would have no idea what a bad one looks like, and D and F would be
 * unreachable - which is half of the complaint this is fixing. Easy bots draft
 * genuinely poor rosters and they belong here, because a player who drafts that
 * badly should be able to see it in a letter.
 */
function difficultyFor(skill) {
  const roll = Math.random();
  if (roll < skill * skill) return "hard";
  if (roll < skill * skill + 2 * skill * (1 - skill)) return "medium";
  return "easy";
}

/**
 * A CONTINUUM, NOT THREE CLUSTERS. Drafting every reference roster at one of
 * three fixed difficulties gives three tight clumps with empty space between
 * them, and percentiles taken against that put whole letters inside the gaps
 * where no roster ever scores. A real player has good rounds and bad ones, so
 * each roster is drafted at a SKILL and each pick within it at that skill with
 * noise.
 */
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
const graded = [];
const bySkill = [];
process.stdout.write(`drafting ${DRAFTS} rosters across the skill range`);
for (let i = 0; i < DRAFTS; i++) {
  const skill = (i + 0.5) / DRAFTS;
  const roster = draftAtSkill(skill);
  const grade = gradeDraft(roster, ctx);
  if (!Number.isFinite(grade.score)) continue;
  scores.push(grade.score);
  graded.push(grade);
  bySkill.push([skill, grade.score]);
  if (i % 40 === 0) process.stdout.write(".");
}
console.log("");

const sorted = [...scores].sort((a, b) => a - b);
const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);

/**
 * THE SHAPE THE GRADES SHOULD TAKE, as percentiles of real drafts.
 *
 * Most competent drafts land in the broad C-to-B band; a strong one earns
 * B+/A-; A and A+ ask for construction, not just names. A+ is the top 3%, so
 * seeing one means something.
 *
 * These are the SAME targets football uses, deliberately: the two sports read
 * different things about a roster and should hand out letters that mean the
 * same thing. A B+ has to be a B+ in both games or the grade is a sport-
 * specific decoration rather than a verdict.
 *
 * They are a product decision about what a grade should FEEL like, and they are
 * stated here rather than buried in the output so the next person can argue
 * with them directly. They are NOT enforced at runtime - nothing quotas a
 * letter. They set the cut points once, against a measured population, and the
 * distribution a real player sees then emerges from how well they actually
 * draft.
 */
const TARGET = [
  [0.97, "A+"], [0.93, "A"], [0.88, "A-"],
  [0.80, "B+"], [0.68, "B"], [0.55, "B-"],
  [0.42, "C+"], [0.30, "C"], [0.20, "C-"],
  [0.13, "D+"], [0.08, "D"], [0.04, "D-"], [0, "F"],
];

console.log(`\n${sorted.length} drafted rosters`);
console.log(`  score range ${sorted[0].toFixed(3)} - ${sorted[sorted.length - 1].toFixed(3)}`);
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

console.log("\nPaste into js/sports/nba/constants.js:\n");
console.log("export const GRADE_BREAKPOINTS = [");
for (let i = 0; i < lines.length; i += 3) {
  const row = lines.slice(i, i + 3)
    .map(([floor, letter]) => `[${floor.toFixed(2)}, "${letter}"]`)
    .join(", ");
  console.log(`  ${row},`);
}
console.log("];");

/**
 * WHAT THE BREAKPOINTS CURRENTLY IN THE FILE ACTUALLY PRODUCE.
 *
 * The block above says where the cuts SHOULD go; this says what the ones the
 * code is using right now hand out. Running the tool after pasting is how you
 * see whether a change did what it claimed, and it is the number the grading
 * complaint was really about: "normal drafts should spread across the scale
 * rather than clustering at A/A+".
 */
const ORDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"];
const counts = new Map(ORDER.map((l) => [l, 0]));
for (const g of graded) counts.set(g.letter, (counts.get(g.letter) || 0) + 1);

console.log("\nDistribution under the breakpoints currently in constants.js:\n");
for (const letter of ORDER) {
  const n = counts.get(letter) || 0;
  const share = n / Math.max(1, graded.length);
  console.log(
    `  ${letter.padEnd(3)} ${String(n).padStart(4)}  ${(100 * share).toFixed(1).padStart(5)}%  ` +
      "#".repeat(Math.round(share * 120))
  );
}

/**
 * THE CONSISTENCY CHECK, because an A+ printed over "there's no one to create"
 * is the specific thing that made the old grade untrustworthy. The letter and
 * the headline read the same capabilities now, so a top grade sitting on a hole
 * is a contradiction rather than a matter of taste - and it is worth failing
 * loudly over rather than eyeballing a hundred cards.
 */
/** A+ and A ONLY, not every letter starting with A. A- is "very good, with one
 * flaw", and its headline says which flaw - that is a consistent card, not a
 * contradiction. A+ and A claim the roster is exceptional, and a roster that
 * cannot do one of the nine things at all is not. */
const CONTRADICTION = graded.filter(
  (g) => (g.letter === "A+" || g.letter === "A") &&
    Math.min(...Object.values(g.metrics.capabilities)) <= 0.3
);
console.log(
  `\n${CONTRADICTION.length} roster(s) graded A or A+ while missing a capability outright` +
    (CONTRADICTION.length ? " — THAT IS A CONTRADICTION, look at GRADE_WEIGHTS.hole" : "")
);
for (const g of CONTRADICTION.slice(0, 5)) {
  const caps = Object.entries(g.metrics.capabilities)
    .map(([k, v]) => `${k} ${Math.round(100 * v)}`)
    .join("  ");
  console.log(`    ${g.letter}  ${caps}\n      "${g.headline}"`);
}
