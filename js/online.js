// Online play: matchmaking, server-authoritative draft picks, and reading
// the server-computed simulation result. Deliberately poll-based rather
// than realtime - see the comment on watchMatch() for why.

import { getSupabase, requireSession } from "./supabaseClient.js";
import { SLOTS, DEFAULT_SPORT } from "./constants.js";

export async function joinQueue(sport = DEFAULT_SPORT) {
  await requireSession();
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("join_queue", { p_sport: sport });
  if (error) throw error;
  return data; // { status: "waiting" } | { status: "matched", match_id }
}

export async function leaveQueue() {
  await requireSession();
  const supabase = await getSupabase();
  await supabase.rpc("leave_queue");
}

/** The safe, column-limited view - never selects roster_a/roster_b, which
 * would otherwise leak a hidden pick the instant it's written (before the
 * round-reveal rule in get_visible_picks() applies). */
export async function getMatch(matchId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("matches_public").select("*").eq("id", matchId).single();
  if (error) throw error;
  return data;
}

/** This round's (and all prior rounds') picks, with the reveal rule already
 * enforced server-side: the opponent's current-round pick is simply absent
 * from the result until both sides have acted. */
export async function getVisiblePicks(matchId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_visible_picks", { p_match_id: matchId });
  if (error) throw error;
  return data;
}

/** Folds pick rows into per-side, per-slot roster objects (same shape the
 * existing UI/engine code already expects), plus which slots each side has
 * committed (revealed or not) this round.
 *
 * `squadPlayers` (optional) is the same match's draft pool - a match is
 * always drafted from one team+decade squad for its whole duration, so a
 * name lookup against that one list is enough to recover each pick's full
 * season stats. Without it, a roster slot only carries name/team/decade/pos,
 * which is enough to render a draft board but not enough for shotLine() to
 * produce a shooting split on the post-game box score. */
export function buildVisibleState(picks, currentRound, squadPlayers = []) {
  const statsByName = new Map(squadPlayers.map((p) => [p.name, p]));
  const rosterA = {};
  const rosterB = {};
  const actedThisRound = { A: false, B: false };

  for (const p of picks) {
    if (p.round_number === currentRound) actedThisRound[p.side] = true;
    if (p.action !== "pick") continue;
    const roster = p.side === "A" ? rosterA : rosterB;
    const stats = statsByName.get(p.player_name);
    roster[p.slot] = {
      name: p.player_name,
      team: p.team,
      decade: p.decade,
      pos: [p.slot === "6TH" ? "6TH" : p.slot],
      ...(stats && {
        ppg: stats.ppg,
        rpg: stats.rpg,
        apg: stats.apg,
        spg: stats.spg,
        bpg: stats.bpg,
        tov: stats.tov,
        fga: stats.fga,
        fgp: stats.fgp,
        tpa: stats.tpa,
        tpp: stats.tpp,
        fta: stats.fta,
        ftp: stats.ftp,
      }),
    };
  }

  return { rosterA, rosterB, actedThisRound };
}

export async function fetchSquadPlayers(team, decade) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("players").select("*").eq("team", team).eq("decade", decade);
  if (error) throw error;
  return data.map((p) => ({
    name: p.name,
    team: p.team,
    decade: p.decade,
    pos: p.pos,
    ppg: Number(p.ppg),
    rpg: Number(p.rpg),
    apg: Number(p.apg),
    spg: Number(p.spg),
    bpg: Number(p.bpg),
    tov: Number(p.tov),
    // Null for the 1960s/70s placeholder squads (no shooting-split data) -
    // Number(null) is 0, which would wrongly claim a shooting profile, so
    // these stay null exactly like the offline dataset's missing fields do.
    fga: p.fga === null ? null : Number(p.fga),
    fgp: p.fgp === null ? null : Number(p.fgp),
    tpa: p.tpa === null ? null : Number(p.tpa),
    tpp: p.tpp === null ? null : Number(p.tpp),
    fta: p.fta === null ? null : Number(p.fta),
    ftp: p.ftp === null ? null : Number(p.ftp),
  }));
}

export async function submitPick(matchId, player, slot) {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("submit_pick", {
    p_match_id: matchId,
    p_player_name: player.name,
    p_team: player.team,
    p_decade: player.decade,
    p_slot: slot,
  });
  if (error) throw error;
}

export async function submitSkip(matchId) {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("submit_skip", { p_match_id: matchId });
  if (error) throw error;
}

export async function simulateMatch(matchId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke("simulate-match", { body: { match_id: matchId } });
  if (error) throw error;
  return data;
}

export async function getMatchResult(matchId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("match_results").select("*").eq("match_id", matchId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getUsername(userId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("profiles").select("username").eq("id", userId).maybeSingle();
  if (error || !data) return "Opponent";
  return data.username || "Opponent";
}

/**
 * Polls a match every `intervalMs` and calls `onChange(match)` whenever
 * status/round_number changes. No realtime here on purpose: Postgres
 * logical replication (what Supabase Realtime's postgres_changes streams)
 * sends the FULL row on every change, including roster_a/roster_b - the
 * same leak the matches_public view exists to prevent. A column-limited
 * poll keeps that guarantee intact; 2-3s of latency on a turn-based draft
 * is imperceptible. Returns a stop() function.
 */
export function watchMatch(matchId, onChange, intervalMs = 2000) {
  let stopped = false;
  let last = null;

  async function tick() {
    if (stopped) return;
    try {
      const match = await getMatch(matchId);
      if (!last || match.status !== last.status || match.round_number !== last.round_number) {
        last = match;
        onChange(match);
      }
    } catch {
      // transient network hiccup - just try again next tick
    }
    if (!stopped) setTimeout(tick, intervalMs);
  }
  tick();

  return () => {
    stopped = true;
  };
}
