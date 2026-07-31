// The sport registry: one place that knows which sports exist, which are
// playable, and what each one does.
//
// Before this, "which sport" was a hardcoded DEFAULT_SPORT constant and four
// static tiles in index.html, three of them permanently disabled in markup.
// Adding a sport meant editing the constant, the markup, and every screen
// that assumed basketball. Now a sport is one module in this folder plus one
// line here.
//
// The invariant worth protecting: NOTHING outside this folder should special-
// case a sport by id. Screens ask the active sport what its slots, eras,
// labels and engine are; they don't branch on "nba". Where that rule is
// broken today it is marked, because each one is a place a second sport will
// break.

import NBA from "./nba.js";
import NFL from "./nfl.js";
import NHL from "./nhl.js";
import SOCCER from "./soccer.js";

export const SPORTS = [NBA, NFL, NHL, SOCCER];

const BY_ID = new Map(SPORTS.map((s) => [s.id, s]));

/** The sport a new player starts on, and the fallback whenever a stored or
 * server-supplied id can't be resolved. Deliberately derived rather than
 * hardcoded: it is simply the first playable sport, so removing or adding a
 * live sport can't leave this pointing at something unplayable. */
export const DEFAULT_SPORT_ID = (SPORTS.find((s) => s.live) || SPORTS[0]).id;

/** Never returns undefined. A profile carrying a sport that has since been
 * removed, or a URL with a typo, lands on the default rather than crashing a
 * screen that reasonably assumed a sport exists. */
export function sportById(id) {
  return BY_ID.get(id) || BY_ID.get(DEFAULT_SPORT_ID);
}

/** Sports a player can actually enter. The UI still RENDERS the locked ones -
 * seeing what's coming is the point of the picker - but nothing playable is
 * reachable through them. */
export function liveSports() {
  return SPORTS.filter((s) => s.live);
}

export function isLive(id) {
  return !!BY_ID.get(id)?.live;
}

/**
 * Namespaces a per-era record key by sport.
 *
 * profiles.era_records is keyed by era id, and era ids are only unique WITHIN
 * a sport - every sport reasonably wants an "all" bracket. Left alone, an NFL
 * "all" record would be added straight onto the NBA one and each would
 * corrupt the other. Existing NBA rows are keyed by the bare era id, so those
 * keep working unchanged and only new sports carry a prefix.
 */
export function eraRecordKey(sportId, eraId) {
  return sportId === "nba" ? eraId : `${sportId}:${eraId}`;
}
