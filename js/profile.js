// Persistent player profile, backed by Supabase (table: profiles) instead
// of localStorage - this is what makes the profile survive across devices
// once real accounts replace anonymous auth, and it's what lets the online
// win/loss record be authoritative (only the simulate-match Edge Function
// can write online_wins/online_losses - see the protect_online_record
// trigger in the schema).
import { getSupabase, requireSession } from "./supabaseClient.js";
import { bannerGainsFromWin } from "./banners.js";

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

// Tier progression tracks ONLINE (vs. human) wins only - bot games are
// practice, not rank, since they are not a fair, verified ranking bar.
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
    careerTotals: row.career_totals || {},
    teamBanners: row.team_banners || {},
    equippedBanner: row.equipped_banner || null,
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
 * for the "most drafted player" profile stat. Only for bot games -
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
 * Records a finished practice game against the bot. Online (matchmaking)
 * results are never recorded this way - see js/online.js, which reads the
 * server-computed outcome instead.
 * @param mode "offline" (vs. bot)
 * @param ownLines [{playerName, line: {pts,reb,ast,stl,blk,tov}}, ...] - the
 *   full box score of the user's OWN roster this game, used to update the
 *   per-stat personal-best records.
 * @param draftedTeams team string per player on your roster, for banner
 *   progress.
 * @param ruleset "easy" | "strict" - easy practice puts every player and
 *   their stats on screen, so a win there says nothing about knowledge.
 *   It still counts as a game played, but it does NOT earn banners; farming
 *   a franchise off a screen you can read would make banners meaningless.
 */
export async function recordPracticeResult({
  mode,
  won,
  opponentLabel,
  scoreFor,
  scoreAgainst,
  mvpName,
  ownLines,
  draftedTeams = [],
  ruleset = "strict",
}) {
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

  // Career totals are what the tiered badges rank up on - personal_bests only
  // ever holds a single-game high, and history is capped at 50 entries, so
  // neither can answer "how many assists have my players racked up ever".
  const careerTotals = { ...profile.careerTotals };
  for (const statKey of Object.keys(STAT_LABELS)) {
    const gameTotal = ownLines.reduce((sum, { line }) => sum + (line[statKey] || 0), 0);
    careerTotals[statKey] = (careerTotals[statKey] || 0) + gameTotal;
  }

  const teamBanners = { ...profile.teamBanners };
  if (won && ruleset !== "easy") {
    for (const [id, gained] of Object.entries(bannerGainsFromWin(draftedTeams))) {
      teamBanners[id] = (teamBanners[id] || 0) + gained;
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
      career_totals: careerTotals,
      team_banners: teamBanners,
      history,
    })
    .eq("id", session.user.id);
  if (error) throw error;
}

/** Equips a banner (or clears it with null). Purely cosmetic, so unlike the
 * ranked record this is safe for the client to write directly. */
export async function setEquippedBanner(franchiseId) {
  const session = await requireSession();
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("profiles")
    .update({ equipped_banner: franchiseId })
    .eq("id", session.user.id);
  if (error) throw error;
}
