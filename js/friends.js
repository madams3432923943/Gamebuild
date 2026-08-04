// Friends: a private request/accept relationship (see the create_friendships
// migration) plus challenging a friend to an unranked 1v1. Every write goes
// through a SECURITY DEFINER RPC rather than a direct table write, same
// reasoning as squads.js - who's friends with whom, and who challenged whom,
// shouldn't be forgeable by a client that just knows another player's id.
import { getSupabase, requireSession } from "./supabaseClient.js";
import { DEFAULT_ERA } from "./sports/nba/constants.js";
import { DEFAULT_SPORT_ID } from "./sports/index.js";
import { DEFAULT_BANNER_ID } from "./banners.js";

async function callRpc(name, args) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function sendFriendRequest(username) {
  await requireSession();
  return callRpc("send_friend_request", { p_username: username });
}

export async function acceptFriendRequest(requesterId) {
  await requireSession();
  return callRpc("accept_friend_request", { p_requester_id: requesterId });
}

export async function declineFriendRequest(requesterId) {
  await requireSession();
  return callRpc("decline_friend_request", { p_requester_id: requesterId });
}

export async function removeFriend(friendId) {
  await requireSession();
  return callRpc("remove_friend", { p_friend_id: friendId });
}

/** Returns the new/existing match id - the caller then jumps straight into
 * the same online draft flow a matchmaking pairing uses (enterOnlineMatch
 * in main.js), just with a specific opponent instead of a random one. */
export async function challengeFriend(friendId, sport = DEFAULT_SPORT_ID, era = DEFAULT_ERA) {
  await requireSession();
  return callRpc("challenge_friend", { p_friend_id: friendId, p_sport: sport, p_era: era });
}

/** Every friendship row touching the caller, regardless of status/side -
 * split into accepted/incoming/outgoing by the callers below rather than
 * three separate queries against the same small table. */
async function myFriendshipRows() {
  const session = await requireSession();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("friendships")
    .select("id, requester_id, addressee_id, status, created_at")
    .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`);
  if (error) throw error;
  return { rows: data, myId: session.user.id };
}

async function profilesById(ids) {
  if (!ids.length) return new Map();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, online_wins, online_losses, equipped_banner")
    .in("id", ids);
  if (error) throw error;
  return new Map(data.map((p) => [p.id, p]));
}

/** Accepted friends, ranked among themselves by online win rate (ties broken
 * by games played, so a 1-0 record doesn't outrank a proven 20-5 one) -
 * "leaderboard" here means a sorted list with positions, not each friend's
 * global percentile tier (profile.js's rank system), which wouldn't read as
 * a leaderboard for a group this small. Includes the caller's own row so
 * "where do I stand against my friends" is visible without a second screen. */
export async function listFriendsLeaderboard() {
  const { rows, myId } = await myFriendshipRows();
  const friendIds = rows.filter((r) => r.status === "accepted").map((r) => (r.requester_id === myId ? r.addressee_id : r.requester_id));

  const profiles = await profilesById([myId, ...friendIds]);
  const entries = [myId, ...friendIds]
    .map((id) => profiles.get(id))
    .filter(Boolean)
    .map((p) => {
      const played = p.online_wins + p.online_losses;
      return {
        userId: p.id,
        username: p.username,
        isMe: p.id === myId,
        onlineWins: p.online_wins,
        onlineLosses: p.online_losses,
        winRate: played > 0 ? p.online_wins / played : 0,
        gamesPlayed: played,
        equippedBanner: p.equipped_banner || DEFAULT_BANNER_ID,
      };
    });

  entries.sort((a, b) => b.winRate - a.winRate || b.gamesPlayed - a.gamesPlayed);
  return entries;
}

export async function listIncomingRequests() {
  const { rows, myId } = await myFriendshipRows();
  const incoming = rows.filter((r) => r.status === "pending" && r.addressee_id === myId);
  const profiles = await profilesById(incoming.map((r) => r.requester_id));
  return incoming.map((r) => ({ requesterId: r.requester_id, username: profiles.get(r.requester_id)?.username || "Player", createdAt: r.created_at }));
}

export async function listOutgoingRequests() {
  const { rows, myId } = await myFriendshipRows();
  const outgoing = rows.filter((r) => r.status === "pending" && r.requester_id === myId);
  const profiles = await profilesById(outgoing.map((r) => r.addressee_id));
  return outgoing.map((r) => ({ addresseeId: r.addressee_id, username: profiles.get(r.addressee_id)?.username || "Player", createdAt: r.created_at }));
}

/** Open (not-yet-drafted-into) friendly matches where the caller is a
 * participant - what powers the "X challenged you - Join" prompt. Only
 * "drafting" status: once a challenge is accepted (either side opens the
 * draft screen), watchMatch's own polling takes over from there. */
export async function listPendingChallenges() {
  const session = await requireSession();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("matches_public")
    .select("id, player_a, player_b, created_at")
    .eq("is_friendly", true)
    .eq("status", "drafting")
    .or(`player_a.eq.${session.user.id},player_b.eq.${session.user.id}`);
  if (error) throw error;
  if (!data.length) return [];

  const opponentIds = data.map((m) => (m.player_a === session.user.id ? m.player_b : m.player_a));
  const profiles = await profilesById(opponentIds);
  return data.map((m) => {
    const opponentId = m.player_a === session.user.id ? m.player_b : m.player_a;
    return {
      matchId: m.id,
      opponentId,
      opponentUsername: profiles.get(opponentId)?.username || "Player",
      iChallenged: m.player_a === session.user.id,
      createdAt: m.created_at,
    };
  });
}
