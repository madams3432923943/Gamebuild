// Squads: player-run clans. Every write that isn't plain chat goes through a
// SECURITY DEFINER RPC (see the squads_* migrations) rather than a direct
// table write - membership caps, one-squad-per-player, and who's allowed to
// kick/promote whom are all enforced server-side, the same way
// simulate-match owns online_wins/online_losses instead of trusting the
// client. This module is just a thin, typed wrapper around those RPCs plus
// the read paths RLS already allows directly.
import { getSupabase, requireSession } from "./supabaseClient.js";
import { TIERS, tierForPercentile, nextTierAbove } from "./profile.js";

// Aggregate online games (wins+losses, summed across every member) a squad
// needs before it gets a real rank instead of "Provisional" - same
// placement-match idea as RANK_GAMES_FLOOR in profile.js, just scaled up
// since a squad's total is a sum over several players.
export const SQUAD_GAMES_FLOOR = 15;

function normalizeSquad(row) {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    emoji: row.emoji,
    motto: row.motto || "",
    visibility: row.visibility,
    memberCap: row.member_cap,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/** The caller's own membership row, or null if they're not in a squad. */
export async function myMembership() {
  const session = await requireSession();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("squad_members")
    .select("squad_id, role, joined_at")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { squadId: data.squad_id, role: data.role, joinedAt: data.joined_at };
}

/** Roster for one squad: member rows joined against profiles for username +
 * online record. Two queries rather than a join because the client only
 * ever talks to PostgREST, which doesn't do cross-table joins on its own. */
export async function loadSquadRoster(squadId) {
  const supabase = await getSupabase();
  const { data: members, error: memberErr } = await supabase
    .from("squad_members")
    .select("user_id, role, joined_at")
    .eq("squad_id", squadId)
    .order("joined_at", { ascending: true });
  if (memberErr) throw memberErr;
  if (!members.length) return [];

  const ids = members.map((m) => m.user_id);
  const { data: profiles, error: profileErr } = await supabase
    .from("profiles")
    .select("id, username, online_wins, online_losses")
    .in("id", ids);
  if (profileErr) throw profileErr;
  const byId = new Map(profiles.map((p) => [p.id, p]));

  return members.map((m) => {
    const p = byId.get(m.user_id);
    return {
      userId: m.user_id,
      role: m.role,
      joinedAt: m.joined_at,
      username: p ? p.username : "Player",
      onlineWins: p ? p.online_wins : 0,
      onlineLosses: p ? p.online_losses : 0,
    };
  });
}

/** Full picture for "my squad": the squad row, its roster, and - only for a
 * leader/co-leader, since that's who's allowed to see it - the invite code.
 * Returns null if the caller isn't in a squad. */
export async function loadMySquad() {
  const membership = await myMembership();
  if (!membership) return null;

  const supabase = await getSupabase();
  const { data: squadRow, error } = await supabase.from("squads").select("*").eq("id", membership.squadId).single();
  if (error) throw error;

  const roster = await loadSquadRoster(membership.squadId);

  let inviteCode = null;
  if (membership.role === "leader" || membership.role === "co-leader") {
    inviteCode = await getInviteCode();
  }

  return { squad: normalizeSquad(squadRow), myRole: membership.role, roster, inviteCode };
}

/** Browsable public squads, optionally filtered by a name/tag substring.
 * Private squads never appear here - they're only reachable by invite code
 * (join_squad_by_code) or once you're already a member. */
export async function listPublicSquads(searchTerm = "") {
  const supabase = await getSupabase();
  let query = supabase
    .from("squads")
    .select("*")
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .limit(50);
  if (searchTerm.trim()) {
    const q = searchTerm.trim();
    query = query.or(`name.ilike.%${q}%,tag.ilike.%${q}%`);
  }
  const { data, error } = await query;
  if (error) throw error;

  const squads = data.map(normalizeSquad);
  if (!squads.length) return [];

  const { data: memberRows, error: memberErr } = await supabase
    .from("squad_members")
    .select("squad_id")
    .in(
      "squad_id",
      squads.map((s) => s.id)
    );
  if (memberErr) throw memberErr;
  const counts = new Map();
  for (const row of memberRows) counts.set(row.squad_id, (counts.get(row.squad_id) || 0) + 1);

  return squads.map((s) => ({ ...s, memberCount: counts.get(s.id) || 0 }));
}

// ---- chat ----

/** Polls a squad's chat every `intervalMs` and calls onMessages(list) with
 * the last `limit` messages whenever the count changes - same watch/stop
 * shape as watchMatch (online.js) and startPresence (presence.js). No
 * realtime here for the same reason: one more polling loop is simpler than
 * a websocket for something this low-frequency. Returns a stop() function. */
export function watchSquadChat(squadId, onMessages, intervalMs = 4000, limit = 50) {
  let stopped = false;
  // Newest message's id, the cheapest possible "did anything change" check -
  // a growing/shrinking list always changes this except the pathological
  // all-empty-both-times case, which has nothing to render either way.
  let lastNewestId = undefined;

  async function tick() {
    if (stopped) return;
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from("squad_messages")
        .select("id, user_id, username, body, created_at")
        .eq("squad_id", squadId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const messages = data.slice().reverse();
      const newestId = messages.length ? messages[messages.length - 1].id : null;
      if (newestId !== lastNewestId) {
        lastNewestId = newestId;
        onMessages(messages);
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

export async function sendSquadMessage(squadId, body) {
  const trimmed = body.trim();
  if (!trimmed) return;
  const session = await requireSession();
  const supabase = await getSupabase();
  const { data: profile } = await supabase.from("profiles").select("username").eq("id", session.user.id).single();
  const { error } = await supabase.from("squad_messages").insert({
    squad_id: squadId,
    user_id: session.user.id,
    username: (profile && profile.username) || "Player",
    body: trimmed.slice(0, 300),
  });
  if (error) throw error;
}

// ---- RPC wrappers ----
// Every one of these can throw with a message meant to be shown directly to
// the player (see the raise exception text in the squads_*_rpcs migrations).

async function callRpc(name, args) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function createSquad({ name, tag, emoji, motto, visibility }) {
  await requireSession();
  return callRpc("create_squad", { p_name: name, p_tag: tag, p_emoji: emoji, p_motto: motto, p_visibility: visibility });
}

export async function joinPublicSquad(squadId) {
  await requireSession();
  return callRpc("join_public_squad", { p_squad_id: squadId });
}

export async function joinSquadByCode(code) {
  await requireSession();
  return callRpc("join_squad_by_code", { p_code: code });
}

export async function leaveSquad() {
  await requireSession();
  return callRpc("leave_squad", {});
}

export async function kickMember(userId) {
  await requireSession();
  return callRpc("kick_squad_member", { p_user_id: userId });
}

export async function setMemberRole(userId, role) {
  await requireSession();
  return callRpc("set_squad_member_role", { p_user_id: userId, p_role: role });
}

export async function transferLeadership(userId) {
  await requireSession();
  return callRpc("transfer_squad_leadership", { p_user_id: userId });
}

export async function getInviteCode() {
  await requireSession();
  return callRpc("get_squad_invite_code", {});
}

export async function regenerateInviteCode() {
  await requireSession();
  return callRpc("regenerate_squad_invite_code", {});
}

export async function updateSquadSettings({ emoji, motto, visibility }) {
  await requireSession();
  return callRpc("update_squad_settings", { p_emoji: emoji, p_motto: motto, p_visibility: visibility });
}

export async function disbandSquad() {
  await requireSession();
  return callRpc("disband_squad", {});
}

// ---- squad rank ----
// Same percentile idea as profile.js's loadRankInfo, one level up: a squad's
// win rate is every member's online wins/losses summed, compared against
// every other squad's summed win rate. The comparison pool is whatever
// squad_members rows RLS lets the caller read - every public squad's roster,
// plus the caller's own squad even if it's private. A private squad the
// caller isn't in is invisible to this by design (same as everywhere else
// private-squad data is gated), not an oversight - it just means the pool
// undercounts private squads other than your own, which is an acceptable
// tradeoff for not leaking private roster data into a rank computation.
export async function loadSquadRankInfo(squadId) {
  const supabase = await getSupabase();
  const { data: memberRows, error } = await supabase.from("squad_members").select("squad_id, user_id");
  if (error) throw error;

  const bySquad = new Map();
  for (const row of memberRows) {
    if (!bySquad.has(row.squad_id)) bySquad.set(row.squad_id, []);
    bySquad.get(row.squad_id).push(row.user_id);
  }
  if (!bySquad.has(squadId)) return { provisional: true, gamesPlayed: 0, gamesNeeded: SQUAD_GAMES_FLOOR };

  const allIds = memberRows.map((r) => r.user_id);
  const { data: profiles, error: profileErr } = await supabase
    .from("profiles")
    .select("id, online_wins, online_losses")
    .in("id", allIds);
  if (profileErr) throw profileErr;
  const winsById = new Map(profiles.map((p) => [p.id, p.online_wins]));
  const lossesById = new Map(profiles.map((p) => [p.id, p.online_losses]));

  const squadTotals = new Map();
  for (const [sid, userIds] of bySquad) {
    let wins = 0;
    let losses = 0;
    for (const uid of userIds) {
      wins += winsById.get(uid) || 0;
      losses += lossesById.get(uid) || 0;
    }
    squadTotals.set(sid, { wins, losses, played: wins + losses });
  }

  const mine = squadTotals.get(squadId);
  if (mine.played < SQUAD_GAMES_FLOOR) {
    return { provisional: true, gamesPlayed: mine.played, gamesNeeded: SQUAD_GAMES_FLOOR - mine.played };
  }

  const myRate = mine.wins / mine.played;
  let below = 0;
  let above = 0;
  let qualifying = 0;
  for (const [sid, totals] of squadTotals) {
    if (totals.played < SQUAD_GAMES_FLOOR) continue;
    qualifying += 1;
    const rate = totals.wins / totals.played;
    if (rate < myRate) below += 1;
    else if (rate > myRate) above += 1;
  }

  const percentile = qualifying > 0 ? (100 * below) / qualifying : 100;
  return {
    provisional: false,
    tier: tierForPercentile(percentile),
    next: nextTierAbove(percentile),
    percentile,
    rank: above + 1,
    totalQualifying: qualifying,
    winRate: myRate,
    gamesPlayed: mine.played,
  };
}

export { TIERS };
