// Squads: player-run clans. Every write goes through a
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

/**
 * Strips the characters that mean something to PostgREST's filter grammar.
 *
 * `.or()` takes a filter EXPRESSION, not a bound parameter: the string below
 * is parsed, so a search box that reaches it unedited can add conditions to
 * the query rather than being matched by it. Commas separate conditions,
 * parentheses group them, dots separate column.operator.value, and `*` is
 * PostgREST's wildcard. None of them can appear in a squad name or tag
 * anyway - the CHECK constraints in the squads migration allow letters,
 * digits and spaces - so dropping them costs nothing a real search would want.
 *
 * This is not SQL injection: PostgREST parameterises the values it parses
 * out, and RLS still hides private squads however the filter is written. What
 * it prevents is a query the caller did not intend, which is worth preventing
 * on its own.
 *
 * `%` and `_` are left alone deliberately - they are ilike wildcards, they
 * cannot change the SHAPE of the query, and someone typing "50_cent" should
 * still find their squad.
 */
function sanitizeFilterTerm(searchTerm) {
  return String(searchTerm || "")
    .replace(/[(),.*"\\]/g, " ")
    .trim()
    .slice(0, 30);
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
  const q = sanitizeFilterTerm(searchTerm);
  if (q) {
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

// ---- chat: switched off ----
//
// Squad chat lived here: a poller, a sender and a report call. It is switched
// off for now (see the Chat panel in index.html) and was removed rather than
// left dangling - the table, the moderation triggers and report_squad_message()
// are all still in the database, so bringing it back is client work only. The
// version to restore is in git, minus its polling loop: it re-downloaded the
// last fifty messages every four seconds, and the replacement should ask for
// messages newer than the last id it saw.

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
