// A stand-in for the online backend: matchmaking, server-authoritative draft
// picks, strategy submission, and simulation.
//
// WHY THIS EXISTS
//
// The online path is the part of the game with the most moving parts and the
// worst failure modes - the git history has already had to fix an online
// Ranked freeze and a result reveal that reached neither player. It is also
// the one path the browser harness could not test without two real accounts
// and a live database, which meant every online regression had to be found by
// a person playing a real ranked match.
//
// This server implements the same contract js/online.js calls, holds its
// state in memory, and is shared by both browser contexts - so two real
// browsers can be matched with each other, draft against each other, and be
// simulated, with no network and no production data.
//
// It deliberately reimplements the RULES (the round-reveal rule, when a round
// advances, when a match becomes ready to simulate) rather than stubbing them
// out, because those rules are exactly what breaks. It runs the REAL
// js/sports/nba/engine.js for the simulation, the same way the Edge Function runs its
// own copy, so a result here is a genuine result.
//
// It is not a substitute for a real online run against production - it cannot
// catch an RLS policy mistake, a migration that never ran, or a deployed Edge
// Function that differs from this repo. `npm run verify -- --online` is still
// the thing that proves those.

import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const { PLAYERS } = await import(new URL(`file://${path.join(ROOT, "data", "nba-players.js")}`).href);
const { computeDatasetStats, simulateGame } = await import(
  new URL(`file://${path.join(ROOT, "js", "engine.js")}`).href
);
const { RANKED_SLOTS } = await import(new URL(`file://${path.join(ROOT, "js", "constants.js")}`).href);

const datasetStats = computeDatasetStats(PLAYERS);

// Squads deep enough to fill a ten-man roster, so a draft can always complete.
const SQUADS = (() => {
  const by = new Map();
  for (const p of PLAYERS) {
    const key = `${p.team}|${p.decade}`;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(p);
  }
  return [...by.entries()].filter(([, list]) => list.length >= 12).map(([key, list]) => {
    const [team, decade] = key.split("|");
    return { team, decade, players: list };
  });
})();

export function createFakeBackend() {
  const state = {
    queue: [], // { userId, sport, era }
    matches: new Map(),
    picks: new Map(), // matchId -> [{ round_number, side, action, player_name, team, decade, slot }]
    results: new Map(),
    profiles: new Map(),
    presence: new Set(),
  };

  const profileFor = (userId, username) => {
    if (!state.profiles.has(userId)) {
      state.profiles.set(userId, {
        id: userId,
        username,
        online_wins: 0,
        online_losses: 0,
        offline_wins: 0,
        offline_losses: 0,
        draft_counts: {},
        personal_bests: {},
        career_totals: {},
        team_banners: {},
        era_records: {},
        equipped_banner: null,
        featured_badges: [],
        created_at: new Date("2026-01-01").toISOString(),
        history: [],
        highest_scoring_game: null,
        largest_margin_game: null,
        triple_double_counts: {},
        mvp_counts: {},
      });
    }
    return state.profiles.get(userId);
  };

  const rollSquad = (match) => {
    const used = new Set(match.used_squads || []);
    const available = SQUADS.filter((s) => !used.has(`${s.team}|${s.decade}`));
    const squad = available[Math.floor(Math.random() * available.length)] || SQUADS[0];
    match.current_squad_team = squad.team;
    match.current_squad_decade = squad.decade;
    match.used_squads = [...used, `${squad.team}|${squad.decade}`];
  };

  const publicMatch = (m) => ({
    id: m.id,
    player_a: m.player_a,
    player_b: m.player_b,
    status: m.status,
    round_number: m.round_number,
    current_squad_team: m.current_squad_team,
    current_squad_decade: m.current_squad_decade,
    used_squads: m.used_squads,
    winner: m.winner,
    created_at: m.created_at,
    updated_at: m.updated_at,
    is_friendly: m.is_friendly,
    sport: m.sport,
  });

  /** Rebuilds a side's roster from its picks - the server owns the roster, the
   * client only ever sees what get_visible_picks reveals. */
  const rosterFor = (matchId, side) => {
    const roster = {};
    for (const p of state.picks.get(matchId) || []) {
      if (p.side !== side || p.action !== "pick") continue;
      const full = PLAYERS.find(
        (x) => x.name === p.player_name && x.team === p.team && x.decade === p.decade
      );
      if (full) roster[p.slot] = full;
    }
    return roster;
  };

  const rpc = {
    heartbeat_presence: ({ p_client_id }) => {
      state.presence.add(p_client_id);
      return state.presence.size;
    },

    join_queue: ({ p_sport = "nba", p_era = "all" }, userId) => {
      // Already in a live match - rejoin it rather than queueing twice.
      for (const m of state.matches.values()) {
        if ((m.player_a === userId || m.player_b === userId) && m.status !== "complete") {
          return { status: "matched", match_id: m.id };
        }
      }
      const opponent = state.queue.find((q) => q.userId !== userId && q.sport === p_sport && q.era === p_era);
      if (!opponent) {
        if (!state.queue.some((q) => q.userId === userId)) {
          state.queue.push({ userId, sport: p_sport, era: p_era });
        }
        return { status: "waiting" };
      }
      state.queue = state.queue.filter((q) => q.userId !== userId && q.userId !== opponent.userId);

      const id = `match-${state.matches.size + 1}`;
      const match = {
        id,
        player_a: opponent.userId,
        player_b: userId,
        status: "drafting",
        round_number: 1,
        used_squads: [],
        winner: null,
        is_friendly: false,
        sport: p_sport,
        era: p_era,
        rotation_a: null, rotation_b: null,
        matchups_a: null, matchups_b: null,
        tactic_a: null, tactic_b: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      rollSquad(match);
      state.matches.set(id, match);
      state.picks.set(id, []);
      return { status: "matched", match_id: id };
    },

    leave_queue: (_args, userId) => {
      state.queue = state.queue.filter((q) => q.userId !== userId);
      return null;
    },

    cancel_match: ({ p_match_id }) => {
      state.matches.delete(p_match_id);
      state.picks.delete(p_match_id);
      return null;
    },

    /** The round-reveal rule, reimplemented rather than stubbed: a side's
     * current-round pick is absent from the other side's view until BOTH have
     * acted. Stubbing this out would hide the exact bug it prevents. */
    get_visible_picks: ({ p_match_id }, userId) => {
      const match = state.matches.get(p_match_id);
      if (!match) return [];
      const mySide = match.player_a === userId ? "A" : "B";
      const all = state.picks.get(p_match_id) || [];
      const acted = { A: false, B: false };
      for (const p of all) if (p.round_number === match.round_number) acted[p.side] = true;
      const bothActed = acted.A && acted.B;
      return all.filter(
        (p) => p.side === mySide || p.round_number < match.round_number || bothActed
      );
    },

    submit_pick: ({ p_match_id, p_player_name, p_team, p_decade, p_slot }, userId) => {
      const match = state.matches.get(p_match_id);
      if (!match) throw new Error("match not found");
      const side = match.player_a === userId ? "A" : "B";
      const picks = state.picks.get(p_match_id);
      if (picks.some((p) => p.round_number === match.round_number && p.side === side)) {
        throw new Error("already acted this round");
      }
      picks.push({
        round_number: match.round_number,
        side,
        action: "pick",
        player_name: p_player_name,
        team: p_team,
        decade: p_decade,
        slot: p_slot,
      });
      advanceRoundIfReady(match);
      return null;
    },

    submit_skip: ({ p_match_id }, userId) => {
      const match = state.matches.get(p_match_id);
      const side = match.player_a === userId ? "A" : "B";
      state.picks.get(p_match_id).push({ round_number: match.round_number, side, action: "skip" });
      advanceRoundIfReady(match);
      return null;
    },

    submit_strategy: ({ p_match_id, p_rotation, p_matchups, p_tactic }, userId) => {
      const match = state.matches.get(p_match_id);
      if (!match) throw new Error("match not found");
      const side = match.player_a === userId ? "A" : "B";
      match[`rotation_${side.toLowerCase()}`] = p_rotation;
      match[`matchups_${side.toLowerCase()}`] = p_matchups;
      match[`tactic_${side.toLowerCase()}`] = p_tactic;
      if (match.tactic_a && match.tactic_b) {
        match.status = "ready_to_simulate";
        match.updated_at = new Date().toISOString();
      }
      return null;
    },

    count_friends: () => 0,
  };

  function advanceRoundIfReady(match) {
    const picks = state.picks.get(match.id);
    const acted = { A: false, B: false };
    for (const p of picks) if (p.round_number === match.round_number) acted[p.side] = true;
    if (!acted.A || !acted.B) return;

    const filled = (side) => picks.filter((p) => p.side === side && p.action === "pick").length;
    if (filled("A") >= RANKED_SLOTS.length && filled("B") >= RANKED_SLOTS.length) {
      match.status = "strategy";
    } else {
      match.round_number += 1;
      rollSquad(match);
    }
    match.updated_at = new Date().toISOString();
  }

  /** The Edge Function's job, run against the real engine. */
  function simulate(matchId) {
    const match = state.matches.get(matchId);
    if (!match) return { error: "match not found" };
    if (state.results.has(matchId)) {
      return { status: "complete", result: state.results.get(matchId), winner: match.winner };
    }
    if (match.status !== "ready_to_simulate") {
      return { error: "match is not ready to simulate", status: match.status };
    }

    const rosterA = rosterFor(matchId, "A");
    const rosterB = rosterFor(matchId, "B");
    const result = simulateGame(rosterA, rosterB, datasetStats, {
      tacticA: match.tactic_a ?? undefined,
      tacticB: match.tactic_b ?? undefined,
      minutesA: match.rotation_a ?? undefined,
      minutesB: match.rotation_b ?? undefined,
      matchupsA: match.matchups_a ?? undefined,
      matchupsB: match.matchups_b ?? undefined,
    });

    const stored = {
      match_id: matchId,
      box_a: result.boxA,
      box_b: result.boxB,
      score_a: result.teamScoreA,
      score_b: result.teamScoreB,
      mvp: { name: result.mvp.player.name, side: result.mvp.side, line: result.mvp.line, score: result.mvp.score },
      period_scores: result.quarterBoxScores,
      overtime_periods: result.overtimePeriods,
    };
    state.results.set(matchId, stored);
    match.status = "complete";
    match.winner = result.winner;
    match.updated_at = new Date().toISOString();
    return { status: "complete", winner: result.winner, scoreA: result.teamScoreA, scoreB: result.teamScoreB };
  }

  function select({ table, filters, single }, userId) {
    const eq = Object.fromEntries((filters || []).map((f) => [f.column, f.value]));
    let rows = [];
    if (table === "matches_public") {
      rows = [...state.matches.values()].filter((m) => !eq.id || m.id === eq.id).map(publicMatch);
    } else if (table === "players") {
      rows = PLAYERS.filter(
        (p) => (!eq.team || p.team === eq.team) && (!eq.decade || p.decade === eq.decade)
      );
    } else if (table === "match_results") {
      const r = state.results.get(eq.match_id);
      rows = r ? [r] : [];
    } else if (table === "profiles") {
      rows = [...state.profiles.values()].filter((p) => !eq.id || p.id === eq.id);
    }
    if (single) return rows[0] ?? null;
    return rows;
  }

  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const send = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(payload));
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      });
      return res.end();
    }
    try {
      const msg = JSON.parse(body || "{}");
      const { kind, userId } = msg;
      if (kind === "rpc") {
        const fn = rpc[msg.fn];
        if (!fn) return send(200, { data: null, error: { message: `no such rpc: ${msg.fn}` } });
        return send(200, { data: fn(msg.args || {}, userId), error: null });
      }
      if (kind === "select") return send(200, { data: select(msg, userId), error: null });
      if (kind === "invoke") {
        const out = simulate(msg.body?.match_id);
        return send(200, out.error ? { data: null, error: { message: out.error } } : { data: out, error: null });
      }
      if (kind === "register") {
        profileFor(userId, msg.username);
        return send(200, { data: true, error: null });
      }
      if (kind === "debug") {
        return send(200, {
          data: {
            matches: [...state.matches.values()].map(publicMatch),
            results: [...state.results.keys()],
            queue: state.queue,
          },
          error: null,
        });
      }
      return send(200, { data: null, error: { message: "unknown kind" } });
    } catch (e) {
      return send(200, { data: null, error: { message: e.message } });
    }
  });

  return {
    listen: (port) => new Promise((r) => server.listen(port, () => r(server))),
    close: () => server.close(),
    state,
  };
}
