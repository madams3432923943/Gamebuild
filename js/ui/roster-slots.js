// What a roster slot is called, and which slots a roster actually filled.
//
// Extracted from js/ui.js because three of its halves need them - the draft
// board, the box score and the strategy pickers - which is the same reason
// renderNote got a module of its own. A shared primitive left beside one of
// its callers is what makes a file impossible to split later.
//
// Every one of these asks the ACTIVE SPORT rather than importing a sport's
// constants, and that is the whole point of them. The defaults below used to
// be imported straight from js/sports/nba/constants.js, so any caller that
// forgot to pass its slots silently got basketball's - which is how an NFL
// draft came to deal PG/SG/SF/PF/C off a Cowboys roster. Evaluated per call,
// so they follow whichever sport is live rather than whatever loaded first.

import { activeSport } from "../sports/index.js";

export const defaultSlots = () => activeSport().slots.quickPlay;

// defaultStarters used to sit here too and had no caller left in the UI - the
// draft and online modules each keep their own private copy of the same
// one-line lambda. Removed rather than exported into the void; if a third
// caller ever wants it, those two duplicates are what it should replace.

/** Display name for a roster slot. Derived rather than looked up in a fixed
 * map, because roster shape varies by mode: Quick Play uses bare positions,
 * the legacy/online path adds a "6TH", and Ranked uses depth-chart slots
 * ("PG1", "PG2") that no fixed 6-key map could cover. */
export function slotLabel(slot) {
  if (slot === "6TH") return "6th Man";
  // Bench spots aren't position-locked, so numbering them by position would
  // be a lie. They read as "Bench"; the player's own position is shown next
  // to their name instead.
  if (activeSport().isBenchSlot(slot)) return "Bench";
  return slot;
}

/** The slots a roster actually filled, in canonical lineup order. Mirrors
 * engine.js's activeSlots so the box score, live table, and recap all agree
 * on both which slots exist and what order they read in. */
export function rosterSlots(roster) {
  return activeSport().orderedRosterSlots(roster);
}
