// Draft grades. Rates the roster you built against what was available, not
// against an absolute - the point is whether you drafted well from the squads
// you were offered, which is the only thing you controlled.

import { OFFENSE_WEIGHTS, DEFENSE_WEIGHTS } from "./constants.js";
import { rateEntry } from "./units.js";

import { letterFor as curveLetter, sampleRosterScores } from "../../gradecurve.js";

/** The grade curve for this dataset, built once. Fixed cutoffs were the old
 * approach and they drift the moment the data changes - see js/gradecurve.js.
 * Memoised on the rating context so it costs one pass per session. */
function curveFor(ctx, slots) {
  if (!ctx.__gradeCurve) {
    const all = ctx.__allEntries || [];
    ctx.__gradeCurve = sampleRosterScores(
      slots,
      (slot) => all.filter((p) => (p.pos || []).includes(slot.replace(/\d+$/, ""))),
      (roster) => (sideScore(roster, OFFENSE_WEIGHTS, ctx) + sideScore(roster, DEFENSE_WEIGHTS, ctx)) / 2
    );
  }
  return ctx.__gradeCurve;
}

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
  const letter = curveLetter(score, curveFor(ctx, Object.keys(OFFENSE_WEIGHTS).concat(Object.keys(DEFENSE_WEIGHTS))));

  const notes = [];
  notes.push(`Offence rates ${(100 * offense).toFixed(0)}, defence ${(100 * defense).toFixed(0)}.`);
  if (offense - defense > 0.15) notes.push("Offence-heavy - your defence will give it back.");
  else if (defense - offense > 0.15) notes.push("Defence-first. You will need to win low-scoring games.");
  if (forfeits.length) notes.push(`${forfeits.length} slot${forfeits.length === 1 ? "" : "s"} left empty.`);

  // The shape shared code renders: letter, headline, reasons[]. It reads
  // grade.letter and spreads grade.reasons directly, and only the CALL is
  // wrapped in a try/catch - so returning a different shape threw at the
  // render step, outside the guard, and killed the whole post-draft flow
  // before the gamestyle picker. That is why NFL never simulated.
  return {
    letter,
    headline: offense - defense > 0.15
      ? "Built to outscore people."
      : defense - offense > 0.15
        ? "Built to win ugly."
        : "Balanced on both sides of the ball.",
    reasons: notes,
    score,
    offense,
    defense,
  };
}
