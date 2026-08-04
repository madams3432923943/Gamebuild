// Server-side sport registry - the mirror of js/sports/index.js.
//
// The Edge Function used to import the basketball engine directly and read
// `from("players")` by name, which meant online play could only ever be
// basketball no matter what the client sent. A match row already carries a
// `sport`, so the only thing missing was somewhere to look it up.
//
// Two things live here per sport and nothing else should:
//   simulate  the engine, vendored under sports/<id>/ and held identical to
//             the client's copy by scripts/verify-parity.mjs. If these drift,
//             an online game plays out differently from the offline one.
//   table     where that sport's players live. NOT a column on one shared
//             table - see db/migrations/20260731_04_nfl_players.sql for why a
//             quarterback and a centre cannot share a schema.
//
// A sport appears here only once it has a real engine. NFL is deliberately
// absent rather than stubbed: an entry that resolved to a half-built
// simulation would let a match be created that cannot be played, and
// "unknown sport" is a much better failure than a wrong result.

import { simulateGame as simulateNba } from "./nba/engine.js";

export type SportEngine = {
  simulate: (rosterA: any, rosterB: any, datasetStats: any, opts: any) => any;
  table: string;
};

const REGISTRY: Record<string, SportEngine> = {
  nba: { simulate: simulateNba, table: "players" },
};

/** Null for a sport with no server engine, so the caller can refuse the match
 * outright rather than silently simulating it as basketball. */
export function engineFor(sportId: string | null | undefined): SportEngine | null {
  return REGISTRY[sportId || "nba"] ?? null;
}

export function supportedSports(): string[] {
  return Object.keys(REGISTRY);
}
