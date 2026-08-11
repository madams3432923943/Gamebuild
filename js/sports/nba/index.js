// NBA: the sport this game was built as, described in the shape every sport
// has to declare.
//
// Nothing here is new logic. It is the existing modules gathered behind one
// object so the app can ask "what does the current sport do?" instead of
// importing basketball directly - which is what made a second sport
// impossible. Behaviour is identical to before this file existed; if NBA
// plays differently after this, that is a bug in the wiring, not a design
// change.

import {
  ERAS,
  DEFAULT_ERA,
  SLOTS,
  STARTER_SLOTS,
  RANKED_SLOTS,
  BENCH_SLOTS,
  eraById,
  playersInEra,
} from "./constants.js";
import { PLAYERS } from "../../../data/nba-players.js";
import { computeDatasetStats, simulateGame, defaultMinutes, botMinutes, defaultMatchups } from "./engine.js";
import { TACTICS, DEFAULT_TACTIC, tacticById, randomTacticChoices } from "./tactics.js";
import { buildRecap, buildGameScript, buildWhyBreakdown, HIGHLIGHTS } from "./recap.js";
import { gradeDraft, rotationHint } from "./draftgrade.js";
import { draftAnalysis, impact } from "./engine.js";
import { shotLine, formatShotLine } from "./shooting.js";
import {
  SLOTS as NBA_SLOTS,
  basePosition,
  isBenchSlot,
  orderedRosterSlots,
  minutesRangeFor,
  ROTATION_BUDGET,
} from "./constants.js";

const TIERS = [
  { name: "YMCA", minPercentile: 0 },
  { name: "Middle School", minPercentile: 5 },
  { name: "High School", minPercentile: 10 },
  { name: "AAU", minPercentile: 16 },
  { name: "Community College", minPercentile: 22 },
  { name: "Div 3", minPercentile: 28 },
  { name: "Div 2", minPercentile: 35 },
  { name: "Div 1", minPercentile: 42 },
  { name: "College Starter", minPercentile: 49 },
  { name: "Conference Champ", minPercentile: 56 },
  { name: "March Madness", minPercentile: 62 },
  { name: "Sweet Sixteen", minPercentile: 68 },
  { name: "Final Four", minPercentile: 73 },
  { name: "National Champion", minPercentile: 78 },
  { name: "NBA Draftee", minPercentile: 82 },
  { name: "Rookie of the Year", minPercentile: 85.5 },
  { name: "NBA All-Star", minPercentile: 88.5 },
  { name: "NBA All-Pro", minPercentile: 91 },
  { name: "NBA MVP", minPercentile: 93.5 },
  { name: "NBA Champion", minPercentile: 96 },
  { name: "Hall of Fame", minPercentile: 98 },
  { name: "Legend", minPercentile: 99.5 },
];

// Online games (wins+losses) needed before a percentile rank is shown -
// standard placement-match floor, so a 1-0 record can't claim "100th
// percentile" off a single lucky game, and so nobody with too small a
// sample distorts what everyone else is being measured against.

// How the game is explained, in basketball's own terms. Moved out of main.js
// because "five starters plus five bench spots" and "240 minutes" describe
// this sport and no other.
// Short on purpose. This is read once, standing up, before a first game -
// long paragraphs get skipped and the rules that matter get missed with them.
// One line each, and only the things you cannot work out from the screen.
const HOW_TO_PLAY = [
  ["The draft", "Each round rolls one squad - say Bulls 1990s - and you both draft from it. Same options: it comes down to who knows the roster."],
  ["Type from memory", "Ranked shows no list. Spelling is forgiving. Quick Play shows the whole squad with stats."],
  ["Your roster", "Five starters, position-locked, plus five bench spots that take anyone. Two-position players are worth more."],
  ["Rotation", "240 minutes across ten players. Past 34 a player tires and gives production back."],
  ["Gamestyle", "Three offered at random. Each boosts something and pays for it elsewhere."],
  ["Modes", "Quick Play is casual. Ranked Practice is the full game against a bot. Ranked moves your record."],
];

export const NBA = {
  id: "nba",
  name: "NBA",
  icon: "🏀",

  // The one flag that decides whether a sport is offered anywhere in the UI.
  // Everything below can be half-built without breaking a thing as long as
  // this stays false - which is exactly the state NFL is in.
  live: true,

  status: "Ready to draft",

  // Basketball leather. The whole app themes off these four custom properties
  // (121 uses of var(--accent*) in style.css), so a sport's identity is four
  // values rather than a stylesheet of its own. accentContrast is the text
  // color for a solid-accent fill, and has to clear 4.5:1 against `accent` -
  // near-black does on orange, white would not.
  theme: {
    accent: "#d9741f",
    accentBright: "#ff9d4d",
    accentRgb: "217, 116, 31",
    accentContrast: "#1d0c01",
  },

  // ---- Vocabulary ---------------------------------------------------------
  // The draft screen says "squad" and "decade" because that is what a
  // basketball category is. NFL rolls a franchise and a season range and
  // should say so, rather than inheriting basketball's nouns.
  labels: {
    squad: "squad",
    squadPlural: "squads",
    group: "decade",
    unit: "minutes",
    period: "quarter",
    periodPlural: "quarters",
    scoreVerb: "scored",
    // How a game starts, in this sport's word. Shared code said "tip-off" for
    // everything, which is a basketball noun.
    opening: "tip-off",
  },

  // ---- Presentation -------------------------------------------------------
  // What this sport is WATCHED on. Shared code shows the declared stage and
  // hides every other one, rather than testing the sport id in each place
  // that draws something - which is how football ended up playing on a
  // basketball court with a field drawn underneath it.
  presentation: { stage: "court" },

  // ---- Roster shape -------------------------------------------------------
  slots: {
    quickPlay: SLOTS,
    ranked: RANKED_SLOTS,
    starters: STARTER_SLOTS,
    bench: BENCH_SLOTS,
  },

  // ---- Eras ---------------------------------------------------------------
  // Basketball's brackets are decades. A sport whose history divides
  // differently (NFL's rule eras don't line up with decade boundaries)
  // supplies its own, which is why this is per-sport rather than global.
  eras: ERAS,
  defaultEra: DEFAULT_ERA,
  eraById,

  // ---- Data ---------------------------------------------------------------
  // Bundled with the client for NBA because the offline modes have to work
  // with no network at all. `table` is where the SERVER reads the same data
  // from, and the two are held in step by scripts/verify-parity.mjs.
  players: () => PLAYERS,
  playersInEra,
  table: "players",

  // The per-game columns this sport's box score and simulation are built on.
  // NFL's are a different set entirely, which is the reason its players live
  // in their own table rather than sharing this one behind a filter.
  statKeys: ["ppg", "rpg", "apg", "spg", "bpg", "tov"],
  lineKeys: ["pts", "reb", "ast", "stl", "blk", "tov"],

  // The box-score categories the profile keeps a personal best in, and what to
  // call them. Lived in js/profile.js as a basketball-only constant, which is
  // why the profile screen had nothing to show a second sport - "Most Points"
  // is not a football record.
  statLabels: { pts: "Points", reb: "Rebounds", ast: "Assists", stl: "Steals", blk: "Blocks" },

  // ---- Simulation ---------------------------------------------------------
  computeDatasetStats: (players) => {
    const ctx = computeDatasetStats(players ?? PLAYERS);
    // For the grade curve to sample real rosters - see js/gradecurve.js.
    ctx.__allEntries = players ?? PLAYERS;
    return ctx;
  },
  simulate: simulateGame,
  defaultMinutes,
  botMinutes,
  // Basketball assigns defenders to attackers; football does not.
  highlights: HIGHLIGHTS,
  usesMatchups: true,
  defaultMatchups,

  // ---- Draft mechanics ----------------------------------------------------
  // How the draft board groups squads and scores a bot pick. Basketball rolls
  // a team-and-decade; football's eras don't fall on decade boundaries, so the
  // key is the sport's to choose rather than js/draft.js's to assume.
  groupKey: "decade",
  rate: impact,
  /** The one-line stat summary under a name on the draft board. Per sport
   * because a quarterback has no rebounds - this was hardcoded in js/ui.js and
   * printed "undefined pts" for every footballer. */
  /** The box score's columns, per sport. These were hardcoded in js/ui.js, so
   * a football game was scored in PTS/REB/AST/STL/BLK - the sport's own line
   * existed and the table refused to show it. */
  /** Made/attempted pairs appended after the counting columns. Basketball has
   * three shooting splits; a sport with none declares an empty list rather
   * than having js/ui.js know which sports shoot. */
  splitColumns: [["fg", "FG"], ["tp", "3PT"], ["ft", "FT"]],
  boxColumns: [
    ["pts", "PTS"], ["reb", "REB"], ["ast", "AST"],
    ["stl", "STL"], ["blk", "BLK"], ["tov", "TOV"],
  ],
  sortBoxBy: "pts",
  // The MVP line everyone already knows, fixed rather than derived. Points,
  // rebounds and assists is basketball's shorthand for a night's work, and it
  // should not reshuffle itself game to game just because somebody had four
  // steals. A sport that declares none gets its top nonzero stats instead.
  mvpStatKeys: ["pts", "reb", "ast"],

  /** Basketball's own headline record. Declared rather than hardcoded in the
   * profile screen, so a sport without one simply does not get the row -
   * football has no triple-double and never will. */
  signatureRecord: { key: "tripleDoubles", label: "Most Triple-Doubles" },

  /** Online play needs a SERVER-SIDE pool: matchmaking seeds a squad from it
   * and submit_pick validates every pick against it. Basketball has one
   * (public.players); football does not, which is why football declares this
   * false rather than offering a button that fails. */
  onlineReady: true,
  cardStatLine: (p) =>
    `${p.ppg} pts · ${p.rpg} reb · ${p.apg} ast · ${p.spg} stl · ${p.bpg} blk`,
  basePosition,
  isBenchSlot,
  orderedRosterSlots,
  minutesRangeFor,
  rotationBudget: ROTATION_BUDGET,

  // ---- Narrative ----------------------------------------------------------
  // The post-game voice and the draft grade. Both are entirely basketball -
  // "out-rebounded by 14" means nothing in football - so they belong to the
  // sport, and main.js asks for them here instead of importing them.
  buildRecap,
  buildGameScript,
  buildWhyBreakdown,
  gradeDraft,
  rotationHint,
  draftAnalysis,

  // How a simulated point total is broken into a believable shooting line.
  // Football's equivalent splits drive yards across a QB and his receivers;
  // same role, completely different maths.
  shotLine,
  formatShotLine,

  // ---- Progression and explanation ----------------------------------------
  // The rank ladder traces a basketball career, so it belongs to basketball.
  // The percentile maths that places you on it stays shared in js/profile.js.
  tiers: TIERS,
  howToPlay: HOW_TO_PLAY,

  // ---- Gamestyles ---------------------------------------------------------
  tactics: TACTICS,
  defaultTactic: DEFAULT_TACTIC,
  tacticById,
  randomTacticChoices,
};

export default NBA;
