// The shape of a draft-grade note, and the one place that flattens one to text.
//
// WHY THIS EXISTS
//
// The draft grade printed prose. Measured on a real bot draft, its seven
// bullets ran 29 to 117 characters:
//
//   "Their Atlanta Falcons Offensive Line has an advantageous matchup against
//    your Atlanta Falcons Defensive Line."                          (109)
//   "DL 59 · LB 94 · CB 96 · S 90 · Overall Defense 85."             (50)
//
// The card's body is about 190px wide on a 360px phone - roughly 27 characters
// at its font size - so every one of those wrapped to three or four lines and
// the verdict a player is supposed to read at a glance arrived as a paragraph.
// Worse, the longest sentences carried the least: three ways of saying "these
// two units are not evenly matched" and no statement of what to do about it.
//
// THE SPLIT THIS INTRODUCES, and it is the whole idea. A note is either
//
//   a FACT - a short label and a shorter value, laid out as a row, which
//   cannot wrap because neither half is a sentence; or
//
//   ADVICE - one imperative clause telling the drafter what to do differently,
//   which is the thing a grade was always for and the thing it never said.
//
// Facts are what a card is good at and prose was bad at. Advice is the part
// worth words, and there is now at most a couple of it rather than seven
// sentences competing to be read.
//
// SPORT-AGNOSTIC, and it has to be: shared code reaching into one sport's
// vocabulary is the most expensive mistake in this codebase (see CLAUDE.md).
// Nothing here knows what a slot, a unit or a position is. Each sport builds
// its own notes out of these two constructors and js/main.js renders whatever
// it is handed.

/** A note's colour. `bad` is what the drafter should look at first, `good` is
 * what they got right; `neutral` is a number with no verdict attached. */
export const TONES = ["good", "bad", "neutral"];

/**
 * A fact: `label` names it, `value` is the number or the short comparison.
 *
 * BOTH HALVES STAY SHORT ON PURPOSE. The renderer puts them at opposite ends
 * of one row and forbids wrapping, so a long label does not push its value
 * onto a second line - it truncates instead, which is the failure a designer
 * can see rather than the one that quietly reflows the card.
 */
export function statNote(label, value, tone = "neutral") {
  return { kind: "stat", label: String(label), value: String(value), tone };
}

/**
 * Advice: one imperative clause about what to do differently.
 *
 * The only note allowed real words, and the only one allowed to wrap - a
 * clause truncated in the middle loses the half that says what to do. Kept to
 * a clause rather than a sentence so that it rarely needs to.
 */
export function adviceNote(text) {
  return { kind: "advice", text: String(text) };
}

/** True for anything these constructors made. Used by the renderer, which
 * still has to cope with a plain string: a sport is free not to have been
 * converted yet, and a card that throws on one is worse than a card with one
 * long bullet in it. */
export function isNote(value) {
  return !!value && typeof value === "object" && (value.kind === "stat" || value.kind === "advice");
}

/**
 * One note as plain text.
 *
 * THE ONE FLATTENER. Notes are read by more than the card that renders them -
 * scripts/verify-sport-contract.mjs joins them to check that a grade with an
 * opponent actually names one - and every one of those readers wanting its own
 * way of turning a note into a string is how two descriptions of the same note
 * end up disagreeing. Everything that needs text comes here.
 */
export function noteText(note) {
  if (typeof note === "string") return note;
  if (!isNote(note)) return "";
  return note.kind === "advice" ? note.text : `${note.label} ${note.value}`;
}

/** Every note as one string, for a caller that wants to search the lot. */
export function notesText(notes) {
  return (notes || []).map(noteText).join(" ");
}
