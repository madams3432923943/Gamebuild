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
import { buildRecap, buildGameScript, buildWhyBreakdown } from "./recap.js";
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
const HOW_TO_PLAY = [
  ["The draft", "Every round rolls one team-and-decade squad - say Chicago Bulls 1990s - and both sides draft from that same squad. You are picking against the same options your opponent has, so it comes down to who knows the roster better."],
  ["Naming players", "Under ranked rules there is no visible list: you type a name from memory. Spelling is forgiving, so remembering the player matters more than spelling him. Quick Play shows the whole squad with stats instead."],
  ["Your roster", "Five starters, position-locked, plus five bench spots that take anyone. Bench players cover whichever position needs them, so someone who plays two positions is worth more than a specialist."],
  ["Rotation", "240 minutes to spread across ten players, 10 to 40 each, and starters must play more than the bench. Push someone past 34 and he tires and gives production back, so loading your best five is a trade rather than a free win."],
  ["Gamestyle", "Once both rosters are set you pick one of three gamestyles offered at random. Each one boosts something and pays for it elsewhere; none is simply strongest."],
  ["Modes", "Quick Play is a relaxed five-a-side against the bot. Ranked Practice is the full ranked experience against the bot. Ranked is against a real opponent and is the only mode that moves your record."],
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
  },

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

  // ---- Simulation ---------------------------------------------------------
  computeDatasetStats,
  simulate: simulateGame,
  defaultMinutes,
  botMinutes,
  defaultMatchups,

  // ---- Draft mechanics ----------------------------------------------------
  // How the draft board groups squads and scores a bot pick. Basketball rolls
  // a team-and-decade; football's eras don't fall on decade boundaries, so the
  // key is the sport's to choose rather than js/draft.js's to assume.
  groupKey: "decade",
  rate: impact,
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
