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
// js/sports/nba/engine.js is not a generic sports simulator. It models five positions
// guarding five positions over four 48-minute quarters, and every number in
// it - SCORING_K, the rebound and assist matchup factors, the fatigue curve,
// the 1.55 combined scoring ceiling - is solved against basketball box
// scores by tools/calibrate-*.mjs. Football has no equivalent of a positional
// matchup: a quarterback is not "guarded" by the opposing quarterback, and
// production comes from a drive model, not from minutes shared at a position.
//
// So NFL gets its own simulate(), and this registry is what lets the two
// coexist instead of one being bent into the other's shape.

// The football career, rung by rung - the counterpart to basketball's ladder
// in js/sports/nba/index.js, and deliberately built on the SAME percentile
// bands. A rank means the same thing in both sports (top X% of the player
// base by win rate); only what it is called changes, because "NBA MVP" says
// nothing to a football player and "Heisman" says nothing to a basketball one.
//
// Same shape to the arc, too: it starts where everyone actually starts, runs
// through the levels a real career passes, and narrows hard at the top. Bands
// widen at the bottom and tighten above the 80th percentile on purpose - most
// people never leave youth football, and "Hall of Fame" should mean it.
const TIERS = [
  { name: "Pop Warner", minPercentile: 0 },
  { name: "Middle School", minPercentile: 5 },
  { name: "JV", minPercentile: 10 },
  { name: "Varsity", minPercentile: 16 },
  { name: "All-District", minPercentile: 22 },
  { name: "All-State", minPercentile: 28 },
  { name: "Juco", minPercentile: 35 },
  { name: "FCS", minPercentile: 42 },
  { name: "FBS Starter", minPercentile: 49 },
  { name: "Power Conference", minPercentile: 56 },
  { name: "All-Conference", minPercentile: 62 },
  { name: "Bowl Game", minPercentile: 68 },
  { name: "All-American", minPercentile: 73 },
  { name: "Heisman Finalist", minPercentile: 78 },
  { name: "NFL Draftee", minPercentile: 82 },
  { name: "Rookie of the Year", minPercentile: 85.5 },
  { name: "Pro Bowler", minPercentile: 88.5 },
  { name: "All-Pro", minPercentile: 91 },
  { name: "NFL MVP", minPercentile: 93.5 },
  { name: "Super Bowl Champion", minPercentile: 96 },
  { name: "Hall of Fame", minPercentile: 98 },
  { name: "Legend", minPercentile: 99.5 },
];

// Written against the roster shape in docs/nfl-plan.md rather than the
// placeholder slots below, because this is what the game will be and a
// How to Play that describes a lineup nobody drafts is worse than none.
const HOW_TO_PLAY = [
  ["The draft", "Every round rolls one team-and-era roster - say the 1985 Chicago Bears - and both sides draft from it. Same options, same board: it comes down to who knows the team better."],
  ["Units, not just players", "Offense is drafted man by man - quarterback, running back, receivers, tight end. Defense is drafted in UNITS: a team's defensive line, its linebackers, its corners, its safeties. Nobody remembers the '85 Bears' third safety; everyone remembers that defense."],
  ["Naming them", "Under ranked rules there is no visible list - you type from memory. For a unit you name the team, not eleven players."],
  ["Your roster", "Eleven picks: five offensive skill players, the offensive line, four defensive units, and special teams. Field goals decide real games, so the kicking unit is a real choice rather than an afterthought."],
  ["Gameplan", "Once both rosters are set you pick one of three gameplans offered at random. Each trades something for something - a heavy pass rush concedes the run, air raid concedes the clock - and none is simply strongest."],
  ["Modes", "Quick Play is a relaxed short-roster game against the bot. Ranked Practice is the full experience against the bot. Ranked is a real opponent and the only mode that moves your record."],
];

export const NFL = {
  id: "nfl",
  name: "NFL",
  icon: "🏈",

  live: false,
  // Selectable without being playable: you can switch the whole app to NFL and
  // see its dashboard, eras, labels and branding, which is what building those
  // screens requires. Start Draft stays disabled - see isSelectable() in
  // js/sports/index.js for why this is a second flag rather than loosening
  // `live`, which everything that touches an engine still reads.
  preview: true,
  status: "In development",

  // Football blue - the app's original palette, kept here because it suits
  // this sport. Every sport declares its own; see the NBA module for the four
  // custom properties these map onto.
  //
  // accentContrast is white rather than the dark navy the rest of the app used
  // to pair with this blue: as text on a solid accent fill the navy comes in
  // at 4.1:1, under the 4.5:1 floor, and white clears it at 4.7:1.
  theme: {
    accent: "#2f6fe0",
    accentBright: "#62a0ff",
    accentRgb: "47, 111, 224",
    accentContrast: "#ffffff",
  },

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

  // Placeholders, and honestly so: no NFL game has been simulated, so every
  // one of these reads as a dash on the profile. They are declared now because
  // the profile screen builds its Top Performances list from this - without it
  // the NFL subtab would have nothing to draw at all, and "no games yet" is a
  // more useful thing to show than an empty panel. The set will be revisited
  // when the engine exists and settles what a football box score contains.
  statLabels: {
    pass_yds: "Passing Yards",
    rush_yds: "Rushing Yards",
    rec_yds: "Receiving Yards",
    tds: "Touchdowns",
    turnovers: "Takeaways",
  },

  // ---- Not built yet ------------------------------------------------------
  // Each of these throws rather than returning something plausible. A stub
  // that quietly returns an empty roster or a 0-0 result would let a
  // half-wired NFL reach a player looking like a working game, and the bug
  // would surface as "the sim is broken" rather than "this isn't finished".
  players: () => {
    throw new Error("NFL player data has not been imported yet - see js/sports/nfl/");
  },
  playersInEra: () => {
    throw new Error("NFL eras are not defined yet - see js/sports/nfl/");
  },
  computeDatasetStats: () => {
    throw new Error("NFL has no dataset statistics yet - see js/sports/nfl/");
  },
  simulate: () => {
    throw new Error("NFL has no simulation engine yet - see js/sports/nfl/");
  },
  defaultMinutes: () => {
    throw new Error("NFL has no snap-count model yet - see js/sports/nfl/");
  },
  botMinutes: () => {
    throw new Error("NFL has no snap-count model yet - see js/sports/nfl/");
  },
  defaultMatchups: () => ({}),

  // The draft-board seams shared code reads (see js/sports/nba/index.js for
  // the working versions). groupKey is "era" rather than basketball's
  // "decade" because football's brackets follow rule changes.
  groupKey: "era",
  rate: () => {
    throw new Error("NFL has no player rating yet - see js/sports/nfl/");
  },
  basePosition: (slot) => slot,
  isBenchSlot: (slot) => slot.startsWith("BENCH"),
  orderedRosterSlots: (roster) => Object.keys(roster).filter((s) => roster[s]),
  minutesRangeFor: () => ({ min: 0, max: 0 }),
  rotationBudget: 0,

  // Narrative and grading. Stubs live in the sibling files named below; these
  // throw for the same reason the simulation stubs do - a recap that returned
  // empty prose would look like a working game with nothing to say.
  buildRecap: () => {
    throw new Error("NFL has no recap yet - see js/sports/nfl/recap.js");
  },
  buildGameScript: () => {
    throw new Error("NFL has no game script yet - see js/sports/nfl/recap.js");
  },
  buildWhyBreakdown: () => {
    throw new Error("NFL has no post-game analysis yet - see js/sports/nfl/recap.js");
  },
  gradeDraft: () => {
    throw new Error("NFL has no draft grade yet - see js/sports/nfl/draftgrade.js");
  },
  rotationHint: () => null,
  draftAnalysis: () => {
    throw new Error("NFL has no draft analysis yet - see js/sports/nfl/engine.js");
  },
  shotLine: () => null,
  formatShotLine: () => "",

  // The ladder and the explanation are real even though the game is not -
  // they are the two screens you can look at today, and there is nothing
  // stopping them being finished.
  tiers: TIERS,
  howToPlay: HOW_TO_PLAY,

  tactics: [],
  defaultTactic: null,
  tacticById: () => null,
  randomTacticChoices: () => [],

  /** What still has to exist before `live` can flip. Rendered on the locked
   * tile in dev builds, so the remaining work is visible in the product
   * rather than only in this comment. */
  todo: [
    "Import per-game player data into an nfl_players table",
    "Aggregate defensive position groups into draftable units (units.js)",
    "Author era brackets that follow rule changes, not decades",
    "Write a drive-based simulation engine and calibrate it",
    "Author gamestyles and solve their multipliers the way tactics.js is",
    "Add NFL badges and make the franchise banners earnable",
  ],
};

export default NFL;
