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

import NBA from "./nba/index.js";
import NFL from "./nfl/index.js";
import NHL from "./nhl.js";
import SOCCER from "./soccer.js";

// Online readiness is a server capability, separate from whether the local
// sport is playable. NFL now has its own authoritative server draft pool,
// sport/mode-scoped matchmaking, roster contract, pick validation, and the
// already-deployed football strategy/simulation path.
NFL.onlineReady = true;

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

/** Can you actually PLAY it - start a draft, enter matchmaking, simulate a
 * game. This is the strict flag and it gates everything that would reach an
 * engine. */
export function isLive(id) {
  return !!BY_ID.get(id)?.live;
}

/** Can you SWITCH TO it - see its dashboard, its eras, its labels and its
 * branding, without being able to start a game.
 *
 * These used to be the same flag, which meant a sport under construction was
 * completely unreachable and its screens could not be looked at, let alone
 * designed. `preview` opens the door without unlocking the game: every screen
 * renders for the sport, and the one thing that would reach a half-built
 * engine - Start Draft - stays disabled and says why.
 *
 * The strict `isLive` is deliberately left alone rather than widened, because
 * every other caller of it (dataset warm-up, matchmaking scope, the default
 * sport) means "playable" and would be wrong to loosen. */
export function isSelectable(id) {
  const sport = BY_ID.get(id);
  return !!sport && (sport.live || sport.preview);
}

// ---- Which sport is active -------------------------------------------------
//
// This lived in main.js, which meant every other module that needed to know
// had to be handed the answer or import basketball directly - and importing
// basketball directly is exactly what this folder exists to prevent. The
// registry knows which sports there are; it is the right place to know which
// one is in play.

// The key main.js has always used. Changing it would silently reset the
// stored choice for every returning player.
const SPORT_KEY = "bk_sport";
let activeId = readStored();

function readStored() {
  try {
    const stored = localStorage.getItem(SPORT_KEY);
    // A stored sport that has since been un-launched (or a stale id from an
    // older build) must not strand someone on an unplayable screen.
    return stored && isSelectable(stored) ? stored : DEFAULT_SPORT_ID;
  } catch {
    return DEFAULT_SPORT_ID;
  }
}

export function activeSportId() {
  return activeId;
}

/** The active sport's definition - slots, eras, dataset, engine, labels,
 * narrative. Everything downstream reads this rather than importing a sport. */
export function activeSport() {
  return sportById(activeId);
}

/**
 * Makes sure a sport's dataset is in memory.
 *
 * A sport whose data is small enough to ship on boot declares no `preload` and
 * this resolves immediately; football declares one because its dataset is
 * larger than the rest of the app combined. Shared code awaits this rather
 * than knowing which sports are heavy.
 */
export async function ensureSportData(id) {
  const sport = sportById(id);
  if (typeof sport?.preload === "function") await sport.preload();
}

export function setActiveSport(id) {
  if (!isSelectable(id)) return false;
  activeId = id;
  try {
    localStorage.setItem(SPORT_KEY, activeId);
  } catch {
    // Storage refused (private mode) - the choice still applies this session.
  }
  return true;
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

/**
 * Namespaces a career-stat key by sport, on exactly the rule eraRecordKey uses.
 *
 * profiles.personal_bests is keyed by bare stat name (`pts`, `reb`) and
 * draft_counts by bare player name. Both collide the moment a second sport
 * writes to them: a passing-yards record would sort against a points record,
 * and Most Drafted would rank Jordan against Brady in one list. Prefixing
 * everything but the default sport keeps every row already in the database
 * valid and readable as basketball, so this needs no backfill.
 */
export function statsKey(sportId, key) {
  return sportId === DEFAULT_SPORT_ID ? key : `${sportId}:${key}`;
}
