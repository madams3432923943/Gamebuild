// Online play: matchmaking, server-authoritative draft picks, and reading
// the server-computed simulation result. Deliberately poll-based rather
// than realtime - see the comment on watchMatch() for why.

import { getSupabase, requireSession } from "./supabaseClient.js";
import { DEFAULT_SPORT_ID, activeSport } from "./sports/index.js";

/** Default roster shape: the ACTIVE SPORT's, never basketball's.
 *
 * These defaults used to be imported straight from js/sports/nba/constants.js,
 * so any caller that forgot to pass its slots silently got basketball's - which
 * is how an NFL draft came to deal PG/SG/SF/PF/C off a Cowboys roster. Evaluated
 * per call, so it follows whichever sport is live rather than whatever was
 * loaded first. */
const defaultSlots = () => activeSport().slots.quickPlay;
const defaultStarters = () => activeSport().slots.starters;

/**
 * Matchmaking scope is SPORT + GAME MODE + ERA. Ranked is the only public
 * online mode today, but gameMode is part of the wire contract now so adding a
 * casual/friendly queue later cannot accidentally mix it with Ranked.
 */
export async function joinQueue(sport = DEFAULT_SPORT_ID, era = null, gameMode = "ranked") {
  await requireSession();
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("join_queue", {
    p_sport: sport,
    p_era: era ?? activeSport().defaultEra,
    p_game_mode: gameMode,
  });
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
 * match's picks can span many different team/group squads by the time the
 * draft is done. `decade` remains the legacy wire-field name in match_picks;
 * for NFL it carries the football era value. */
export async function fetchStatsForPicks(picks) {
  const pairs = new Map();
  for (const p of picks) {
    if (p.action !== "pick") continue;
    pairs.set(`${p.team}|${p.decade}`, { team: p.team, decade: p.decade });
  }
  const squads = await Promise.all([...pairs.values()].map(({ team, decade }) => fetchSquadPlayers(team, decade)));
  const statsByKey = new Map();
  for (const squad of squads) {
    for (const p of squad) {
      statsByKey.set(`${p.name}|${p.team}|${p.decade}|${p.season}`, p);
      const loose = `${p.name}|${p.team}|${p.decade}`;
      if (!statsByKey.has(loose)) statsByKey.set(loose, p);
    }
  }
  return statsByKey;
}

/** Folds pick rows into per-side, per-slot roster objects. The authoritative
 * object comes back from the active sport's server pool. Do not hand-pick NBA
 * stats here: NFL units need members/group data and football skill players need
 * their passing/rushing/receiving fields. Spreading the trusted pool object
 * keeps online and Ranked Practice on the same roster shape. */
export function buildVisibleState(picks, currentRound, statsByKey = new Map()) {
  const rosterA = {};
  const rosterB = {};
  const actedThisRound = { A: false, B: false };

  for (const p of picks) {
    if (p.round_number === currentRound) actedThisRound[p.side] = true;
    if (p.action !== "pick") continue;
    const roster = p.side === "A" ? rosterA : rosterB;
    const stats =
      statsByKey.get(`${p.player_name}|${p.team}|${p.decade}|${p.season}`) ??
      statsByKey.get(`${p.player_name}|${p.team}|${p.decade}`);

    const fallbackPos = p.slot === "6TH" ? ["6TH"] : [p.slot.replace(/\d+$/, "")];
    roster[p.slot] = {
      ...(stats || {}),
      name: p.player_name,
      team: p.team,
      decade: p.decade,
      season: p.season ?? stats?.season ?? null,
      pos: stats?.pos ?? fallbackPos,
    };
  }

  return { rosterA, rosterB, actedThisRound };
}

/**
 * Fetch the rolled squad from the ACTIVE SPORT'S OWN TABLE and grouping key.
 * NBA => public.players + decade. NFL => public.nfl_players + era.
 * NFL rows keep the exact generated Ranked Practice object in `payload`.
 */
export async function fetchSquadPlayers(team, groupValue) {
  const supabase = await getSupabase();
  const s = activeSport();
  const groupKey = s.groupKey || "decade";
  const { data, error } = await supabase
    .from(s.table)
    .select("*")
    .eq("team", team)
    .eq(groupKey, groupValue);
  if (error) throw error;

  return data.map((p) => {
    if (p.payload) {
      const raw = p.payload;
      return {
        ...raw,
        name: raw.name ?? p.name,
        team: raw.team ?? p.team,
        era: raw.era ?? p.era,
        // `decade` is the shared online protocol's historical field name.
        // For NFL it carries the era value so existing pick RPCs stay stable.
        decade: raw.decade ?? raw.era ?? p[groupKey],
        season: raw.season ?? p.season ?? null,
        pos: raw.pos ?? p.pos ?? [],
      };
    }

    // Basketball numeric columns are Postgres numerics and arrive as strings;
    // preserve the existing conversion so the NBA engine sees numbers.
    return {
      name: p.name,
      team: p.team,
      decade: p.decade,
      season: p.season ?? null,
      pos: p.pos,
      ppg: Number(p.ppg),
      rpg: Number(p.rpg),
      apg: Number(p.apg),
      spg: Number(p.spg),
      bpg: Number(p.bpg),
      tov: Number(p.tov),
      fga: p.fga === null ? null : Number(p.fga),
      fgp: p.fgp === null ? null : Number(p.fgp),
      tpa: p.tpa === null ? null : Number(p.tpa),
      tpp: p.tpp === null ? null : Number(p.tpp),
      fta: p.fta === null ? null : Number(p.fta),
      ftp: p.ftp === null ? null : Number(p.ftp),
    };
  });
}

/** PostgREST resolves an RPC by the exact set of argument NAMES it is given,
 * so an unknown argument is not ignored - it fails to find the function at
 * all, with PGRST202. */
const NO_SUCH_FUNCTION = "PGRST202";

/**
 * @param forfeited true when the PICK CLOCK chose this player, not the player
 * themselves. Recorded server-side (match_picks.forfeited) because that is
 * where the simulation reads it from - the Edge Function charges a real cost
 * for a forfeited pick, and it can only charge what was stored.
 */
export async function submitPick(matchId, player, slot, forfeited = false) {
  const supabase = await getSupabase();
  const args = {
    p_match_id: matchId,
    p_player_name: player.name,
    p_team: player.team,
    // Shared protocol name. NFL players expose decade=era above.
    p_decade: player.decade ?? player.era,
    p_slot: slot,
  };

  const withSeason = player.season ? { ...args, p_season: player.season } : args;

  const { error } = await supabase.rpc("submit_pick", { ...withSeason, p_forfeited: forfeited });
  if (!error) return;
  if (error.code !== NO_SUCH_FUNCTION) throw error;

  console.warn("submit_pick is missing p_season/p_forfeited - apply the latest db/migrations.");
  const retry = await supabase.rpc("submit_pick", { ...args, p_forfeited: forfeited });
  if (!retry.error) return;
  if (retry.error.code !== NO_SUCH_FUNCTION) throw retry.error;
  const bare = await supabase.rpc("submit_pick", args);
  if (bare.error) throw bare.error;
}

export async function submitSkip(matchId) {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("submit_skip", { p_match_id: matchId });
  if (error) throw error;
}

/** Submits this side's rotation/matchups/tactic once, after locally running
 * the same rotation -> matchups -> tactic sequence offline Ranked Practice
 * uses (see startRotationPhase/startMatchupPhase/startTacticPhase in
 * main.js). */
export async function submitStrategy(matchId, rotation, matchups, tactic) {
  const supabase = await getSupabase();
  const isPair = tactic && typeof tactic === "object" && "offense" in tactic && "defense" in tactic;
  if (isPair) {
    const { error } = await supabase.rpc("submit_nfl_strategy", {
      p_match_id: matchId,
      p_strategy: tactic,
    });
    if (error) throw error;
    return;
  }
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
 * equipped banner - in one query. */
export async function getOpponentSummary(userId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("username, online_wins, online_losses, equipped_banner, sport_ratings")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) {
    return { username: "Opponent", onlineWins: 0, onlineLosses: 0, equippedBanner: null, sportRatings: {} };
  }
  return {
    username: data.username || "Opponent",
    onlineWins: data.online_wins || 0,
    onlineLosses: data.online_losses || 0,
    equippedBanner: data.equipped_banner || null,
    sportRatings: data.sport_ratings || {},
  };
}

/**
 * Polls a match every `intervalMs` and calls `onChange(match)` whenever
 * status/round_number changes. No realtime here on purpose: Postgres
 * logical replication sends the full row, including hidden roster state.
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
