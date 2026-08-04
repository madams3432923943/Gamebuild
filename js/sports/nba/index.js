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

export const NBA = {
  id: "nba",
  name: "NBA",
  icon: "🏀",

  // The one flag that decides whether a sport is offered anywhere in the UI.
  // Everything below can be half-built without breaking a thing as long as
  // this stays false - which is exactly the state NFL is in.
  live: true,

  status: "Ready to draft",

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

  // ---- Gamestyles ---------------------------------------------------------
  tactics: TACTICS,
  defaultTactic: DEFAULT_TACTIC,
  tacticById,
  randomTacticChoices,
};

export default NBA;
