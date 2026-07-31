// Online play: matchmaking, server-authoritative draft picks, and reading
// the server-computed simulation result. Deliberately poll-based rather
// than realtime - see the comment on watchMatch() for why.

import { getSupabase, requireSession } from "./supabaseClient.js";
import { SLOTS, DEFAULT_ERA } from "./constants.js";
import { DEFAULT_SPORT_ID } from "./sports/index.js";

export async function joinQueue(sport = DEFAULT_SPORT_ID, era = DEFAULT_ERA) {
  await requireSession();
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("join_queue", { p_sport: sport, p_era: era });
  if (error) throw error;
  return data; // { status: "waiting" } | { status: "matched", match_id }
}

export async function leaveQueue() {
  await requireSession();
  const supabase = await getSupabase();
  await supabase.rpc("leave_queue");
}

/** Walks away from a non-complete match - either side can call this, not
 * just whoever's turn it is. Deletes the match outright rather than
 * marking it some "cancelled" status: nothing worth keeping is recorded
 * until simulate-match writes a result, so there's no history to preserve. */
export async function cancelMatch(matchId) {
  await requireSession();
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("cancel_match", { p_match_id: matchId });
  if (error) throw error;
}

/** The safe, column-limited view - never selects roster_a/roster_b, which
 * would otherwise leak a hidden pick the instant it's written (before the
 * round-reveal rule in get_visible_picks() applies). */
/** Returns null when the match no longer exists, rather than throwing.
 *
 * That case is not an error, it is an outcome: cancel_match DELETES the row
 * (nothing worth keeping is recorded until simulate-match writes a result),
 * so an opponent walking away is indistinguishable from a network failure to
 * a caller that only sees an exception. It isn't - one recovers on its own
 * and the other never will, and telling a player to wait for a match that no
 * longer exists is the worse of the two mistakes. */
export async function getMatch(matchId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("matches_public").select("*").eq("id", matchId).maybeSingle();
  if (error) throw error;
  return data ?? null;
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

/** A new squad is rolled every round (see advance_round_if_ready), so a
 * match's picks can span many different team/decade squads by the time the
 * draft is done - a single "current squad" lookup only ever covers the
 * last one rolled. This fetches every distinct squad actually picked from
 * across the whole match and returns a name|team|decade -> stats map, which
 * is what buildVisibleState needs to enrich EVERY pick, not just the most
 * recent round's. */
export async function fetchStatsForPicks(picks) {
  const pairs = new Map();
  for (const p of picks) {
    if (p.action !== "pick") continue;
    pairs.set(`${p.team}|${p.decade}`, { team: p.team, decade: p.decade });
  }
  const squads = await Promise.all([...pairs.values()].map(({ team, decade }) => fetchSquadPlayers(team, decade)));
  const statsByKey = new Map();
  for (const squad of squads) {
    for (const p of squad) statsByKey.set(`${p.name}|${p.team}|${p.decade}`, p);
  }
  return statsByKey;
}

/** Folds pick rows into per-side, per-slot roster objects (same shape the
 * existing UI/engine code already expects), plus which slots each side has
 * committed (revealed or not) this round.
 *
 * `statsByKey` (optional, from fetchStatsForPicks) keys stats by
 * name|team|decade rather than just name, since the same player can appear
 * in more than one squad (e.g. a player traded mid-career) - without the
 * team/decade in the key a lookup could silently grab the wrong season.
 * Without it, a roster slot only carries name/team/decade/pos, which is
 * enough to render a draft board but not enough for shotLine() to produce a
 * shooting split on the post-game box score. */
export function buildVisibleState(picks, currentRound, statsByKey = new Map()) {
  const rosterA = {};
  const rosterB = {};
  const actedThisRound = { A: false, B: false };

  for (const p of picks) {
    if (p.round_number === currentRound) actedThisRound[p.side] = true;
    if (p.action !== "pick") continue;
    const roster = p.side === "A" ? rosterA : rosterB;
    const stats = statsByKey.get(`${p.player_name}|${p.team}|${p.decade}`);
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

/** Submits this side's rotation/matchups/tactic once, after locally running
 * the same rotation -> matchups -> tactic sequence offline Ranked Practice
 * uses (see startRotationPhase/startMatchupPhase/startTacticPhase in
 * main.js). The server flips the match to ready_to_simulate once BOTH
 * sides have called this - see submit_strategy in the matches migration. */
export async function submitStrategy(matchId, rotation, matchups, tactic) {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("submit_strategy", {
    p_match_id: matchId,
    p_rotation: rotation,
    p_matchups: matchups,
    p_tactic: tactic,
  });
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

/** Everything the pre-draft matchup intro needs about the opponent -
 * username, online record (for their rank tier via loadRankInfo), and
 * equipped banner - in one query, since `profiles` is publicly readable
 * (see loadRankInfo's own comment on that) and none of this is sensitive. */
export async function getOpponentSummary(userId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("username, online_wins, online_losses, equipped_banner")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) {
    return { username: "Opponent", onlineWins: 0, onlineLosses: 0, equippedBanner: null };
  }
  return {
    username: data.username || "Opponent",
    onlineWins: data.online_wins || 0,
    onlineLosses: data.online_losses || 0,
    equippedBanner: data.equipped_banner || null,
  };
}

/**
 * Polls a match every `intervalMs` and calls `onChange(match)` whenever
 * status/round_number changes. No realtime here on purpose: Postgres
 * logical replication (what Supabase Realtime's postgres_changes streams)
 * sends the FULL row on every change, including roster_a/roster_b - the
 * same leak the matches_public view exists to prevent. A column-limited
 * poll keeps that guarantee intact; 2-3s of latency on a turn-based draft
 * is imperceptible. Returns a stop() function.
 *
 * `initialMatch` should be the match state the caller already rendered
 * before starting the watcher (enterOnlineMatch always fetches and handles
 * one first). Without it, `last` starts null, so the FIRST tick - which
 * fires immediately, no delay - always looks like a change and re-fires
 * onChange for state the caller already handled, running two concurrent
 * handlers over the same match. That's harmless while drafting, but for
 * ready_to_simulate/complete it means two concurrent
 * runOnlineSimulationFlow() calls fighting over the same scoreboard
 * intervals and DOM - a real cause of a "frozen" game screen.
 *
 * `onError` fires once the poll has failed WATCH_ERROR_STREAK times in a
 * row. Swallowing every failure silently (what this used to do) means a
 * genuinely broken connection is indistinguishable from a quiet match: the
 * screen just sits there forever with no explanation. One-off hiccups still
 * pass silently - only a sustained streak, which the player cannot recover
 * from on their own, gets surfaced.
 */
const WATCH_ERROR_STREAK = 5;

export function watchMatch(matchId, onChange, intervalMs = 2000, initialMatch = null, onError = null, onGone = null) {
  let stopped = false;
  let last = initialMatch;
  let failures = 0;

  async function tick() {
    if (stopped) return;
    try {
      const match = await getMatch(matchId);
      failures = 0;
      // The match is gone - the opponent cancelled, or it was swept as stale.
      // Terminal, so the poll stops rather than sitting on a row that will
      // never come back while the player is told to wait for it.
      if (!match) {
        stopped = true;
        if (onGone) onGone();
        return;
      }
      if (!last || match.status !== last.status || match.round_number !== last.round_number) {
        last = match;
        onChange(match);
      }
    } catch (e) {
      failures += 1;
      if (failures === WATCH_ERROR_STREAK && onError) onError(e);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  }
  tick();

  return () => {
    stopped = true;
  };
}
