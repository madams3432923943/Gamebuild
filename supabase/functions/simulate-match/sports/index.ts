// Server-side sport registry - the mirror of js/sports/index.js.
//
// Online is shared infrastructure, not a shared game. Each sport adapter owns
// its authoritative table, dataset preparation, roster normalization, engine,
// recordable box-score stats and dataset version. That keeps NBA assumptions
// from leaking into NFL simply because both use the same Edge Function shell.

import { simulateGame as simulateNba, computeDatasetStats as computeNbaStats } from "./nba/engine.js";
import { simulate as simulateNfl, computeDatasetStats as computeNflStats } from "./nfl/engine.js";

export type SportEngine = {
  simulate: (rosterA: any, rosterB: any, datasetStats: any, opts: any) => any;
  table: string;
  statKeys: string[];
  normalizeRoster: (roster: Record<string, any>) => Record<string, any>;
  computeDatasetStats: (rows: Record<string, any>[]) => any;
  datasetVersion: (rows: Record<string, any>[]) => string;
};

const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function normalizeNbaRow(p: Record<string, any>) {
  return {
    ...p,
    ppg: Number(p.ppg), rpg: Number(p.rpg), apg: Number(p.apg),
    spg: Number(p.spg), bpg: Number(p.bpg), tov: Number(p.tov),
    fga: numOrNull(p.fga), fgp: numOrNull(p.fgp),
    tpa: numOrNull(p.tpa), tpp: numOrNull(p.tpp),
    fta: numOrNull(p.fta), ftp: numOrNull(p.ftp),
  };
}

function normalizeNbaRoster(roster: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const slot of Object.keys(roster || {})) {
    const p = roster[slot];
    if (!p) continue;
    out[slot] = {
      name: p.name,
      team: p.team,
      decade: p.decade,
      season: p.season ?? null,
      pos: p.pos,
      ppg: Number(p.ppg), rpg: Number(p.rpg), apg: Number(p.apg),
      spg: Number(p.spg), bpg: Number(p.bpg), tov: Number(p.tov),
      fga: numOrNull(p.fga), fgp: numOrNull(p.fgp),
      tpa: numOrNull(p.tpa), tpp: numOrNull(p.tpp),
      fta: numOrNull(p.fta), ftp: numOrNull(p.ftp),
    };
  }
  return out;
}

function generatedNflEntry(row: Record<string, any>) {
  // The online table intentionally stores the exact Ranked Practice object in
  // payload. Falling back to the row makes this tolerant of future importers
  // that choose to flatten the same shape instead.
  return row?.payload && typeof row.payload === "object" ? row.payload : row;
}

function normalizeNflRoster(roster: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [slot, raw] of Object.entries(roster || {})) {
    if (!raw) continue;
    // submit_pick already wrote an authoritative generated NFL payload. Keep
    // every football field: group/members for units and pass/rush/rec data for
    // skill players. A generic NBA projection here would destroy the engine's
    // inputs before kickoff.
    out[slot] = { ...(raw as Record<string, any>) };
  }
  return out;
}

function maxSeason(rows: Record<string, any>[]) {
  let max = 0;
  for (const raw of rows || []) {
    const row = generatedNflEntry(raw);
    max = Math.max(max, Number(row?.season || raw?.season || 0));
  }
  return max || "legacy";
}

const REGISTRY: Record<string, SportEngine> = {
  nba: {
    table: "players",
    simulate: simulateNba,
    statKeys: ["pts", "reb", "ast", "stl", "blk"],
    normalizeRoster: normalizeNbaRoster,
    computeDatasetStats: (rows) => computeNbaStats(rows.map(normalizeNbaRow)),
    datasetVersion: (rows) => `nba-players-${rows.length}-${maxSeason(rows)}`,
  },
  nfl: {
    table: "nfl_players",
    simulate: simulateNfl,
    statKeys: [
      "comp", "pass_yds", "pass_tds",
      "rush_yds", "rush_tds",
      "rec", "rec_yds", "rec_tds",
      "ints", "fumbles", "fgs",
    ],
    normalizeRoster: normalizeNflRoster,
    computeDatasetStats: (rows) => {
      const entries = rows.map(generatedNflEntry);
      const players = entries.filter((entry) => !entry?.group);
      const units = entries.filter((entry) => !!entry?.group);
      return computeNflStats(players, units);
    },
    datasetVersion: (rows) => `nfl-generated-${rows.length}-${maxSeason(rows)}`,
  },
};

/** Null for a sport with no server engine, so the caller can refuse the match
 * outright rather than silently simulating it as basketball. */
export function engineFor(sportId: string | null | undefined): SportEngine | null {
  return REGISTRY[sportId || "nba"] ?? null;
}

export function supportedSports(): string[] {
  return Object.keys(REGISTRY);
}
