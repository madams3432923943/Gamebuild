// What game you are about to play, declared once. Full account in
// docs/game-modes.md.
//
// Mode used to be two independent axes scattered across js/main.js: `game.mode`
// ("bot" / "online") and `game.ruleset` ("easy" / "strict"). Nothing named the
// combinations, so four unrelated questions - is there a clock, is the board
// open, which roster shape, does this count - were each re-derived from one
// overloaded string in a different file. That is how Quick Play came to be the
// mode that also decided roster shape. A mode is a RECORD of the answers now,
// and the screens ask it rather than inferring.
//
//   ONLINE RANKED - a real opponent, matchmaking, rank on the line.
//   PRACTICE      - offline against the bot, at one of three difficulties.
//   FRIEND MATCH  - a real opponent you already know, unranked. NOT offered
//                   here: it is reached by challenging a specific person from
//                   the Friends tab, which is the whole point of it.

/** The two modes the Play screen offers, in the order they escalate.
 *
 * `ranked` is the only mode whose result moves a rank, and `historyMode` is
 * what a finished game writes into profile history - matching the strings the
 * Edge Function already writes for online games ("online" / "friendly"), so
 * offline and online results stay readable by one code path. */
export const MODES = {
  ranked: {
    id: "ranked",
    label: "Online Ranked",
    icon: "🏆",
    tag: "Online",
    blurb: "Compete against real players. Wins and losses affect your rank.",
    online: true,
    ranked: true,
    timed: true,
    openBoard: false,
    historyMode: "online",
  },
  practice: {
    id: "practice",
    label: "Practice",
    icon: "🎯",
    blurb: "Draft against the bot and improve your game.",
    online: false,
    ranked: false,
    timed: true,
    openBoard: false,
    historyMode: "offline",
  },
};

/** Friend matches are ranked-strength rules with no rank attached. Declared
 * here beside the others so "what are the rules of a friendly" has one answer,
 * even though it is never selectable on the Play screen - it is entered by
 * accepting or sending a challenge from the Friends tab. */
export const FRIEND_MODE = {
  id: "friend",
  label: "Friend Match",
  icon: "🤝",
  blurb: "An unranked game against a friend. Same rules as ranked.",
  online: true,
  ranked: false,
  timed: true,
  openBoard: false,
  historyMode: "friendly",
};

/**
 * The three practice difficulties.
 *
 * DIFFICULTY IS A DRAFTING RULE AND NOTHING ELSE. `window` is handed to
 * DraftState.botAutoPick and decides WHICH of the legal players the bot takes;
 * no difficulty touches a rating, a multiplier, the RNG, or anything the engine
 * reads. A hard bot wins more because its roster is better, and that is the
 * only mechanism there is - scripts/verify-bot-difficulty.mjs measures the
 * roster grades and scripts/verify-mode-rules.mjs asserts the simulation input
 * is identical across all three.
 *
 * Easy additionally relaxes the DRAFT INTERFACE - the whole squad on screen
 * with stats, and no pick clock - because its job is to teach the pool. That is
 * a property of the difficulty rather than of a separate ruleset, which is what
 * "Quick Play" used to be and what made it a second roster shape as well.
 *
 * `window` is { start, take } over the board's legal players ranked best-first:
 * skip `start` of them (as a fraction of the list), then choose uniformly among
 * the next `take`. See pickWindow() in js/draft.js for the clamping that keeps
 * a thin board from leaving the bot with nothing legal.
 */
export const DIFFICULTIES = {
  easy: {
    id: "easy",
    label: "Easy",
    blurb: "Learn the game — stats shown, no timer, easier bot.",
    // The line the mode card carries, per the sprint's copy.
    tagline: "EASY — Learn the player pool. Stats shown. No timer.",
    timed: false,
    openBoard: true,
    // The bottom third of the board. Legal, complete, and noticeably beatable.
    window: { start: 0.62, take: 8 },
  },
  medium: {
    id: "medium",
    label: "Medium",
    blurb: "Competitive practice against a solid bot.",
    tagline: "MEDIUM — Competitive practice against a solid bot.",
    timed: true,
    openBoard: false,
    // null means the LEGACY path: ban the top BOT_TOP_PICK_BAN_SHARE of the
    // board, then draw from the best BOT_POOL_SIZE combos underneath it. Kept
    // bit-for-bit because every balance constant in the app was calibrated
    // against this bot (see tools/calibrate-*.mjs); a "medium" that drafted
    // even slightly differently would silently invalidate all of them.
    window: null,
  },
  hard: {
    id: "hard",
    label: "Hard",
    blurb: "Test yourself against a bot that drafts elite talent.",
    tagline: "HARD — Face a bot that drafts elite talent.",
    timed: true,
    openBoard: false,
    // The top of the board, four names wide so two Hard games are not the same
    // game. No information the human does not have: it is choosing among the
    // players already visible on the squad in front of both sides.
    window: { start: 0, take: 4 },
  },
};

export const DEFAULT_DIFFICULTY = "medium";

/** Order matters for the picker - easiest first, the way a player climbs. */
export const DIFFICULTY_IDS = ["easy", "medium", "hard"];

export function difficultyById(id) {
  return DIFFICULTIES[id] || DIFFICULTIES[DEFAULT_DIFFICULTY];
}

/**
 * One resolved answer to "what am I playing", which is what every screen reads.
 *
 * Difficulty overrides are folded in HERE rather than checked at each call
 * site: `timed` and `openBoard` are questions about this match, and a screen
 * asking "is there a clock" should not also have to know that easy practice is
 * the one difficulty that answers it differently.
 */
export function resolveMode(modeId, difficultyId = DEFAULT_DIFFICULTY) {
  const mode = MODES[modeId] || MODES.practice;
  if (mode.id !== "practice") return { ...mode, difficulty: null };
  const difficulty = difficultyById(difficultyId);
  return {
    ...mode,
    difficulty: difficulty.id,
    timed: difficulty.timed,
    openBoard: difficulty.openBoard,
  };
}

/** The Practice label a player sees, difficulty and all: "Practice (Hard)". */
export function modeLabel(config) {
  if (!config) return "";
  if (config.id !== "practice") return config.label;
  return `Practice (${difficultyById(config.difficulty).label})`;
}

// ---------------------------------------------------------------------------
// Reading history written by older versions of this app
// ---------------------------------------------------------------------------
// Rows are years deep and were written by four vocabularies: "online" (Ranked),
// "friendly" (Friend Match), "local" (pass-and-play, removed long ago) and
// "offline" (any bot game). Quick Play and Ranked Practice were never stored as
// distinct modes - both wrote "offline" and differed only inside `rulesVersion`
// - so there is nothing to migrate: they are already, and correctly, practice
// games. Rows written from now on also carry `gameMode` and `difficulty`.
//
// NOTHING HERE REWRITES STORED DATA. The label is computed at read time.

const LEGACY_MODE_LABELS = {
  online: "Ranked",
  friendly: "Friend Match",
  local: "Local",
  offline: "Practice",
};

/** What one stored history row should be called on screen. */
export function historyModeLabel(entry) {
  if (!entry) return "Practice";
  // Written by a version that recorded the mode properly - trust it, and add
  // the difficulty when it is a practice game that recorded one.
  if (entry.gameMode === "practice") {
    return entry.difficulty ? `Practice (${difficultyById(entry.difficulty).label})` : "Practice";
  }
  if (entry.gameMode === "ranked") return LEGACY_MODE_LABELS.online;
  if (entry.gameMode === "friend") return FRIEND_MODE.label;
  return LEGACY_MODE_LABELS[entry.mode] || "Practice";
}
