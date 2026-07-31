// NFL: declared, not yet playable.
//
// This file exists so the shape of the work is visible and the UI can offer
// the sport the moment it's real, rather than the tile being hardcoded
// "Coming soon" markup that somebody has to remember to go and change.
// `live: false` is the only thing keeping it out of play - every screen reads
// that flag, so flipping it is what ships NFL, and nothing flips it until the
// pieces below exist.
//
// WHY NFL CANNOT REUSE THE NBA ENGINE
//
// js/engine.js is not a generic sports simulator. It models five positions
// guarding five positions over four 48-minute quarters, and every number in
// it - SCORING_K, the rebound and assist matchup factors, the fatigue curve,
// the 1.55 combined scoring ceiling - is solved against basketball box
// scores by tools/calibrate-*.mjs. Football has no equivalent of a positional
// matchup: a quarterback is not "guarded" by the opposing quarterback, and
// production comes from a drive model, not from minutes shared at a position.
//
// So NFL gets its own simulate(), and this registry is what lets the two
// coexist instead of one being bent into the other's shape.

export const NFL = {
  id: "nfl",
  name: "NFL",
  icon: "🏈",

  live: false,
  status: "Coming soon",

  labels: {
    squad: "roster",
    squadPlural: "rosters",
    group: "era",
    unit: "snaps",
    period: "quarter",
    periodPlural: "quarters",
    scoreVerb: "scored",
  },

  // Provisional. A fantasy-style lineup rather than basketball's
  // position-locked five, because that is the shape football drafts take -
  // and FLEX is the equivalent of the open bench slot that makes a
  // multi-position player genuinely more valuable.
  slots: {
    quickPlay: ["QB", "RB", "WR", "TE", "K"],
    ranked: ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX", "K", "DEF", "BENCH1"],
    starters: ["QB", "RB", "WR", "TE", "K", "DEF"],
    bench: ["BENCH1"],
  },

  // Football's history doesn't divide on decade boundaries the way
  // basketball's does - the rule changes that define an era (the 1978 passing
  // rules, the 2004 illegal-contact enforcement) land mid-decade. Real
  // brackets get authored with the dataset.
  eras: [{ id: "all", label: "All Years", emoji: "🏈", decades: null, blurb: "Every era." }],
  defaultEra: "all",
  eraById: (id) => NFL.eras.find((e) => e.id === id) || NFL.eras[0],

  // Its own table, not a sport column on `players`. Football's per-game
  // columns (pass/rush/rec yards, touchdowns, interceptions, sacks) share
  // almost nothing with basketball's, so one table would be two disjoint sets
  // of mostly-null columns and every query would carry a filter it could
  // forget. See db/migrations for the schema.
  table: "nfl_players",
  statKeys: ["pass_yds", "rush_yds", "rec_yds", "tds", "turnovers"],
  lineKeys: ["pass_yds", "rush_yds", "rec_yds", "tds", "turnovers"],

  // ---- Not built yet ------------------------------------------------------
  // Each of these throws rather than returning something plausible. A stub
  // that quietly returns an empty roster or a 0-0 result would let a
  // half-wired NFL reach a player looking like a working game, and the bug
  // would surface as "the sim is broken" rather than "this isn't finished".
  players: () => {
    throw new Error("NFL player data has not been imported yet - see js/sports/nfl.js");
  },
  playersInEra: () => {
    throw new Error("NFL eras are not defined yet - see js/sports/nfl.js");
  },
  computeDatasetStats: () => {
    throw new Error("NFL has no dataset statistics yet - see js/sports/nfl.js");
  },
  simulate: () => {
    throw new Error("NFL has no simulation engine yet - see js/sports/nfl.js");
  },
  defaultMinutes: () => {
    throw new Error("NFL has no snap-count model yet - see js/sports/nfl.js");
  },
  botMinutes: () => {
    throw new Error("NFL has no snap-count model yet - see js/sports/nfl.js");
  },
  defaultMatchups: () => ({}),

  tactics: [],
  defaultTactic: null,
  tacticById: () => null,
  randomTacticChoices: () => [],

  /** What still has to exist before `live` can flip. Rendered on the locked
   * tile in dev builds, so the remaining work is visible in the product
   * rather than only in this comment. */
  todo: [
    "Import per-game player data into an nfl_players table",
    "Author era brackets that follow rule changes, not decades",
    "Write a drive-based simulation engine and calibrate it",
    "Author gamestyles and solve their multipliers the way tactics.js is",
    "Add NFL badges and make the franchise banners earnable",
  ],
};

export default NFL;
