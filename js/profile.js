// Persistent player profile, backed by Supabase (table: profiles) instead
// of localStorage - this is what makes the profile survive across devices
// once real accounts replace anonymous auth, and it's what lets the online
// win/loss record be authoritative (only the simulate-match Edge Function
// can write online_wins/online_losses - see the protect_online_record
// trigger in the schema).
import { getSupabase, requireSession } from "./supabaseClient.js";

export const TIERS = [
  { name: "Rookie", minWins: 0 },
  { name: "Starter", minWins: 3 },
  { name: "All-Star", minWins: 7 },
  { name: "Champion", minWins: 12 },
  { name: "Hall of Famer", minWins: 20 },
  { name: "Legend", minWins: 30 },
];

// One personal-best record per counting stat, each: {value, playerName, date}.
export const STAT_LABELS = { pts: "Points", reb: "Rebounds", ast: "Assists", stl: "Steals", blk: "Blocks" };

// Tier progression tracks ONLINE (vs. human) wins only - bot/local games are
// practice, not rank, since neither is a fair, verified ranking bar.
export function currentTier(onlineWins) {
  let tier = TIERS[0];
  for (const t of TIERS) if (onlineWins >= t.minWins) tier = t;
  return tier;
}

export function nextTier(onlineWins) {
  return TIERS.find((t) => t.minWins > onlineWins) || null;
}

export function mostDraftedPlayer(profile) {
  let best = null;
  for (const [name, count] of Object.entries(profile.draftCounts)) {
    if (!best || count > best.count) best = { name, count };
  }
  return best;
}

function normalize(row) {
  return {
    id: row.id,
    username: row.username,
    onlineWins: row.online_wins,
    onlineLosses: row.online_losses,
    offlineWins: row.offline_wins,
    offlineLosses: row.offline_losses,
    draftCounts: row.draft_counts || {},
    personalBests: row.personal_bests || {},
    history: row.history || [],
  };
}

export async function loadProfile() {
  const session = await requireSession();
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
  if (error) throw error;
  return normalize(data);
}

export async function setUsername(name) {
  const session = await requireSession();
  const supabase = await getSupabase();
  const { error } = await supabase.from("profiles").update({ username: name }).eq("id", session.user.id);
  if (error) throw error;
}

/** Records every player name drafted onto the user's own roster this game,
 * for the "most drafted player" profile stat. Only for bot/local games -
 * online games get this recorded server-side by simulate-match, since a
 * client can't be trusted to self-report a competitive result. */
export async function recordDraftPicks(playerNames) {
  const profile = await loadProfile();
  const draftCounts = { ...profile.draftCounts };
  for (const name of playerNames) draftCounts[name] = (draftCounts[name] || 0) + 1;
  const session = await requireSession();
  const supabase = await getSupabase();
  const { error } = await supabase.from("profiles").update({ draft_counts: draftCounts }).eq("id", session.user.id);
  if (error) throw error;
}

/**
 * Records a finished bot or local-pass-and-play game. Online (matchmaking)
 * results are never recorded this way - see js/online.js, which reads the
 * server-computed outcome instead.
 * @param mode "offline" (vs. bot) or "local" (pass & play)
 * @param ownLines [{playerName, line: {pts,reb,ast,stl,blk,tov}}, ...] - the
 *   full box score of the user's OWN roster this game, used to update the
 *   per-stat personal-best records.
 */
export async function recordPracticeResult({ mode, won, opponentLabel, scoreFor, scoreAgainst, mvpName, ownLines }) {
  const profile = await loadProfile();
  const date = new Date().toISOString();

  const personalBests = { ...profile.personalBests };
  for (const statKey of Object.keys(STAT_LABELS)) {
    for (const { playerName, line } of ownLines) {
      const value = line[statKey];
      const current = personalBests[statKey];
      if (!current || value > current.value) {
        personalBests[statKey] = { value, playerName, date };
      }
    }
  }

  const history = [{ date, mode, won, opponentLabel, scoreFor, scoreAgainst, mvpName }, ...profile.history].slice(
    0,
    50
  );

  const session = await requireSession();
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("profiles")
    .update({
      offline_wins: profile.offlineWins + (won ? 1 : 0),
      offline_losses: profile.offlineLosses + (won ? 0 : 1),
      personal_bests: personalBests,
      history,
    })
    .eq("id", session.user.id);
  if (error) throw error;
}
