// Draft grades. Rates the roster you built against what was available, not
// against an absolute - the point is whether you drafted well from the squads
// you were offered, which is the only thing you controlled.

import { OFFENSE_WEIGHTS, DEFENSE_WEIGHTS } from "./constants.js";
import { rateEntry } from "./units.js";

const LETTERS = [
  [0.90, "A+"], [0.82, "A"], [0.75, "A-"], [0.68, "B+"], [0.61, "B"],
  [0.55, "B-"], [0.48, "C+"], [0.41, "C"], [0.34, "C-"], [0.25, "D"], [0, "F"],
];

const letterFor = (score) => (LETTERS.find(([floor]) => score >= floor) || [0, "F"])[1];

/** Weighted rating of one side of the ball, so a great quarterback counts for
 * more than a great third receiver - the same weights the engine simulates
 * with, which keeps the grade honest about what actually wins games. */
function sideScore(roster, weights, ctx) {
  let total = 0;
  let weight = 0;
  for (const [slot, w] of Object.entries(weights)) {
    if (!roster[slot]) continue;
    total += w * rateEntry(roster[slot], ctx);
    weight += w;
  }
  return weight > 0 ? total / weight : 0.5;
}

export function draftGrade(roster, ctx, forfeits = []) {
  const offense = sideScore(roster, OFFENSE_WEIGHTS, ctx);
  const defense = sideScore(roster, DEFENSE_WEIGHTS, ctx);
  // Both halves count equally. A roster that drafted a superb offence and
  // ignored its defence has not drafted well, it has drafted half a team.
  const raw = (offense + defense) / 2;
  // A forfeited slot is a hole, and the grade should say so plainly rather
  // than quietly averaging over the pick that never happened.
  const penalty = forfeits.length * 0.05;
  const score = Math.max(0, raw - penalty);

  const notes = [];
  if (offense - defense > 0.15) notes.push("Offence-heavy - your defence will give it back.");
  else if (defense - offense > 0.15) notes.push("Defence-first. You will need to win low-scoring games.");
  else notes.push("Balanced on both sides of the ball.");
  if (forfeits.length) notes.push(`${forfeits.length} slot${forfeits.length === 1 ? "" : "s"} left empty.`);

  return { grade: letterFor(score), score, offense, defense, notes: notes.join(" ") };
}
