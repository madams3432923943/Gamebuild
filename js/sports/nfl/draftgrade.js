// Draft grades. Rates the roster you built against what was available, not
// against an absolute - the point is whether you drafted well from the squads
// you were offered, which is the only thing you controlled.

import { OFFENSE_WEIGHTS, DEFENSE_WEIGHTS } from "./constants.js";
import { rateEntry } from "./units.js";
import { letterFor as curveLetter, sampleRosterScores } from "../../gradecurve.js";
import { matchupReads } from "../../matchups.js";

const canonicalSlot = (slot) => String(slot || "").replace(/\d+$/, "").toUpperCase();

/** Units identify themselves with `group` (DL/LB/CB/S/OL/ST), while players
 * expose `pos`. The old curve sampled only `pos`, so defensive unit slots had
 * no candidate pool and the resulting curve was not representative of an NFL
 * draft. Keep one eligibility rule for both shapes. */
function eligibleForSlot(entry, slot) {
  const wanted = canonicalSlot(slot);
  if (!entry) return false;
  if (String(entry.group || "").toUpperCase() === wanted) return true;
  return (entry.pos || []).some((pos) => String(pos).toUpperCase() === wanted);
}

/** The grade curve for this dataset, built once. Fixed cutoffs were the old
 * approach and they drift the moment the data changes. Memoised on the rating
 * context so it costs one pass per session. */
function curveFor(ctx, slots) {
  if (!ctx.__gradeCurve) {
    const all = ctx.__allEntries || [];
    ctx.__gradeCurve = sampleRosterScores(
      slots,
      (slot) => all.filter((entry) => eligibleForSlot(entry, slot)),
      (roster) => (sideScore(roster, OFFENSE_WEIGHTS, ctx) + sideScore(roster, DEFENSE_WEIGHTS, ctx)) / 2
    );
  }
  return ctx.__gradeCurve;
}

/** Weighted rating of one side of the ball. These are the same slot weights
 * the simulation consumes, so the grade cannot praise a roster for strengths
 * the engine itself ignores. */
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

function defensiveBreakdown(roster, ctx) {
  const groups = {};
  for (const slot of Object.keys(DEFENSE_WEIGHTS)) {
    if (!roster[slot]) continue;
    groups[slot] = rateEntry(roster[slot], ctx);
  }
  return groups;
}

/** The forfeited slots, whatever shape the caller uses.
 *
 * Shared code calls `gradeDraft(roster, stats, opts)` with an OPTIONS OBJECT -
 * that is basketball's signature and therefore the contract - while football's
 * own draftAnalysis hands over a bare array. This declared the third parameter
 * as the array, so the object arrived instead, `.length` was undefined, the
 * penalty was NaN and every football draft graded F. Normalise once, here,
 * rather than at each call site. */
function forfeitList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.forfeits)) return value.forfeits;
  return [];
}

/** The opponent's roster, from either shape the third argument arrives in.
 *  A bare array is a forfeit list and carries no opponent. */
function opponentRoster(value) {
  return Array.isArray(value) ? null : value?.oppRoster || null;
}

export function draftGrade(roster, ctx, forfeitsOrOpts = []) {
  const forfeits = forfeitList(forfeitsOrOpts);
  const oppRoster = opponentRoster(forfeitsOrOpts);
  const offense = sideScore(roster, OFFENSE_WEIGHTS, ctx);
  const defense = sideScore(roster, DEFENSE_WEIGHTS, ctx);
  const defenseGroups = defensiveBreakdown(roster, ctx);

  // Both halves count equally. A roster that drafted a superb offence and
  // ignored its defence has drafted half a team, not a great full roster.
  const raw = (offense + defense) / 2;
  const penalty = forfeits.length * 0.05;
  const score = Math.max(0, raw - penalty);
  const slots = Object.keys(OFFENSE_WEIGHTS).concat(Object.keys(DEFENSE_WEIGHTS));
  const letter = curveLetter(score, curveFor(ctx, slots));

  const notes = [];
  notes.push(`Offence rates ${(100 * offense).toFixed(0)}, defence ${(100 * defense).toFixed(0)}.`);

  const groupText = Object.keys(DEFENSE_WEIGHTS)
    .filter((slot) => Number.isFinite(defenseGroups[slot]))
    .map((slot) => `${slot} ${(100 * defenseGroups[slot]).toFixed(0)}`)
    .join(" · ");
  if (groupText) notes.push(`${groupText} · Overall Defense ${(100 * defense).toFixed(0)}.`);

  if (offense - defense > 0.15) notes.push("Offence-heavy - your defence will give it back.");
  else if (defense - offense > 0.15) notes.push("Defence-first. You will need to win low-scoring games.");
  if (forfeits.length) notes.push(`${forfeits.length} slot${forfeits.length === 1 ? "" : "s"} left empty.`);

  // Football's counterplay read, and until now it did not exist. NFL.draftAnalysis
  // accepted an opponent roster and dropped it on the floor, so the "how your
  // roster stacks against theirs" line was this same solo grade printed again -
  // believable output, which is why it survived so long.
  //
  // Units and individuals compare the same way here because rateEntry() already
  // returns one number for both: a secondary and a quarterback are not alike,
  // but "how good is this at its job" is the same question asked of each.
  if (oppRoster) {
    notes.push(
      ...matchupReads(roster, oppRoster, {
        rate: (entry) => rateEntry(entry, ctx),
        // "WR", not "WR2". The depth number is a roster-shape detail and the
        // sentence is about a position.
        label: canonicalSlot,
      })
    );
  }

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
    defenseGroups,
  };
}
