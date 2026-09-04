// Squads: player-run clans. Every write that isn't plain chat goes through a
// SECURITY DEFINER RPC (see the squads_* migrations) rather than a direct
// table write - membership caps, one-squad-per-player, and who's allowed to
// kick/promote whom are all enforced server-side, the same way
// simulate-match owns online_wins/online_losses instead of trusting the
// client. This module is just a thin, typed wrapper around those RPCs plus
// the read paths RLS already allows directly.
import { getSupabase, requireSession } from "./supabaseClient.js";

// Squad Rep: a persistent, Clash-Royale-trophy-style score earned by playing
// squad-vs-squad TOURNAMENTS together.
//
// Tournaments don't exist yet, so nothing currently awards rep and every
// squad sits at 0 - that's the intended state, not a bug. It used to accrue
// from each member's solo ranked record (+10 win / -3 loss, via a Postgres
// trigger on profiles), but that measured how much a squad's members played
// alone rather than anything the squad did as a unit, so a squad could climb
// the ladder without ever playing together once. The trigger and the rep it
// had granted were both removed (see the squad_rep_tournaments_only
// migration). The tier ladder below stays as the shape rep will climb once
// tournaments land.
//
// `rep` is a plain column on the squads row, so this needs no extra query
// and has no games-floor/"Provisional" state.
export const SQUAD_REP_TIERS = [
  { name: "YMCA", minRep: 0 },
  { name: "Middle School", minRep: 40 },
  { name: "High School", minRep: 90 },
  { name: "AAU", minRep: 150 },
  { name: "Community College", minRep: 220 },
  { name: "Div 3", minRep: 300 },
  { name: "Div 2", minRep: 390 },
  { name: "Div 1", minRep: 490 },
  { name: "College Starter", minRep: 600 },
  { name: "Conference Champ", minRep: 720 },
  { name: "March Madness", minRep: 850 },
  { name: "Sweet Sixteen", minRep: 990 },
  { name: "Final Four", minRep: 1140 },
  { name: "National Champion", minRep: 1300 },
  { name: "NBA Draftee", minRep: 1470 },
  { name: "Rookie of the Year", minRep: 1650 },
  { name: "NBA All-Star", minRep: 1840 },
  { name: "NBA All-Pro", minRep: 2040 },
  { name: "NBA MVP", minRep: 2250 },
  { name: "NBA Champion", minRep: 2470 },
  { name: "Hall of Fame", minRep: 2700 },
  { name: "Legend", minRep: 3000 },
];

export function squadTierForRep(rep) {
  let tier = SQUAD_REP_TIERS[0];
  for (const t of SQUAD_REP_TIERS) if (rep >= t.minRep) tier = t;
  return tier;
}

export function nextSquadTierAbove(rep) {
  return SQUAD_REP_TIERS.find((t) => t.minRep > rep) || null;
}

/** Rep + tier for a squad - pure, synchronous, no network call, since rep
 * is already a plain column on the squad row wherever one is loaded. */
export function squadRankInfo(squad) {
  return { rep: squad.rep, tier: squadTierForRep(squad.rep), next: nextSquadTierAbove(squad.rep) };
}

function normalizeSquad(row) {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    emoji: row.emoji,
    motto: row.motto || "",
    visibility: row.visibility,
    memberCap: row.member_cap,
    rep: row.rep,
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
    // equipped_icon comes along on the query that was already running: the
    // roster used to draw a member as a name and a record, which is a database
    // row rather than a person, and the mark they chose for themselves is one
    // more column on a select that already reads this table.
    .select("id, username, online_wins, online_losses, equipped_icon")
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
      // Null is the ordinary state, not an error - it means nothing has been
      // chosen, and equippedIcon() resolves that to the default mark.
      equippedIcon: p ? p.equipped_icon : null,
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

/**
 * A search term with PostgREST's filter punctuation taken out.
 *
 * `.or()` takes a FILTER EXPRESSION, not a bound parameter - the term is
 * pasted straight into `name.ilike.%<term>%,tag.ilike.%<term>%` and PostgREST
 * parses the result. So the ordinary punctuation people type into a search box
 * is syntax: a comma splits the expression into extra OR conditions, a
 * parenthesis closes the group early, and a dot reads as the operator
 * separator. Searching for "OKC, Thunder" or "Ball (Knowledge)" sends a
 * malformed filter and the browse list fails with an error instead of finding
 * nothing, which is the worse of the two.
 *
 * Not a privacy hole, and worth saying why so nobody widens this by mistake:
 * the visibility restriction is a SEPARATE .eq() that PostgREST ANDs with this
 * group, so an injected `visibility.eq.private` cannot pull a private squad
 * into the results - it can only widen an OR that is already being ANDed
 * against `visibility = 'public'`. This is a robustness fix, not a
 * confidentiality one.
 *
 * `%` and `_` go too: they are ilike wildcards, and a term containing one
 * would quietly search for something other than what was typed.
 */
function searchFilterTerm(searchTerm) {
  return String(searchTerm ?? "")
    .replace(/[,().:"'%_*\\]/g, " ")
    // Collapsed, not just stripped: "OKC, Thunder" would otherwise become
    // "OKC  Thunder" and the ilike would match nothing, which looks identical
    // to a broken search from the outside.
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
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
  const q = searchFilterTerm(searchTerm);
  if (q) query = query.or(`name.ilike.%${q}%,tag.ilike.%${q}%`);
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
