// What a drafted football entry IS, and what to call it. Two predicates, no
// dependencies, and deliberately not in units.js.
//
// WHY THESE TWO LIVE ALONE
//
// Football drafts people and it drafts units: a quarterback is a man, an
// offensive line is "Green Bay Packers Offensive Line". Shared UI has to tell
// them apart without knowing what football is, so `isUnit` and `unitLabel` are
// part of the sport contract and are read by js/ui/draft-board.js and
// js/ui/entry-name.js through activeSport().
//
// They used to live in units.js, next to the rating code that also uses them.
// That was fine until units.js stopped being loaded on boot: it is 28KB and
// pulls in constants.js behind it, and football's simulation is now fetched
// when football is CHOSEN rather than when the app opens (see loadSimulation
// in ./index.js). These two are not simulation. They are how a name gets onto
// a screen, they cost nothing, and gating them behind a promise would mean
// either a stub that throws where a label was wanted or 56KB back on every
// visitor's boot to avoid it.
//
// So they moved here and units.js re-exports them, which keeps one definition
// and leaves engine.js and draftgrade.js importing them exactly where they
// always did - worth caring about, since engine.js is vendored to the Edge
// Function and every edit to it has to be copied across.

export const isUnit = (entry) => typeof entry?.group === "string";

/**
 * What to call a unit when the team is already on screen.
 *
 * A unit's `name` is its team plus its group - "Baltimore Ravens Offensive
 * Line" - and everywhere a drafted unit is shown, the team is shown next to
 * it already: the draft board sits under a squad banner reading "Ravens ·
 * 2020s", the roster panel prints "2020 Ravens" on its own line, the box
 * score carries "Baltimore Ravens 2020" under the name. So the full name says
 * the team twice and pushes the only distinguishing part - which unit this is
 * - off the end of a phone-width row.
 *
 * Stripping the prefix rather than rebuilding the label from `group`, because
 * `group` is a code ("OL", "S") and the tail of the name is already the
 * English the dataset chose ("Offensive Line", "Safeties"). Falls back to the
 * whole name if it does not start with the team, so a row that does not follow
 * the convention is shown as it is rather than silently truncated.
 */
export function unitLabel(entry) {
  const name = String(entry?.name || "");
  const team = String(entry?.team || "");
  if (!team || !name.startsWith(team)) return name;
  return name.slice(team.length).trim() || name;
}
