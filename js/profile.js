// Persistent player profile, backed by Supabase (table: profiles) instead
// of localStorage - this is what makes the profile survive across devices
// once real accounts replace anonymous auth, and it's what lets the online
// win/loss record be authoritative (only the simulate-match Edge Function
// can write online_wins/online_losses - see the protect_online_record
// trigger in the schema).
import { getSupabase, requireSession } from "./supabaseClient.js";
import { DEFAULT_BANNER_ID } from "./banners.js";

// Percentile bands: top X% by online win rate lands in this tier. Relative
// to the player base rather than a fixed win count, so the ladder
// self-adjusts as more people play instead of everyone eventually maxing
// out the top tier at some fixed win count - see loadRankInfo() below.
//
// The ladder itself traces a basketball career: grassroots -> college ->
// the NBA, ending in the same handful of legacy-defining tiers real
// basketball culture already uses. Bands widen at the bottom and narrow at
// the top on purpose - most of a real playing population never leaves
// rec-league ball, while "hit an NBA MVP-tier win rate" should mean it,
// not something half the player base reaches.
export const TIERS = [
  { name: "YMCA", minPercentile: 0 },
  { name: "Middle School", minPercentile: 5 },
  { name: "High School", minPercentile: 10 },
  { name: "AAU", minPercentile: 16 },
  { name: "Community College", minPercentile: 22 },
  { name: "Div 3", minPercentile: 28 },
  { name: "Div 2", minPercentile: 35 },
  { name: "Div 1", minPercentile: 42 },
  { name: "College Starter", minPercentile: 49 },
  { name: "Conference Champ", minPercentile: 56 },
  { name: "March Madness", minPercentile: 62 },
  { name: "Sweet Sixteen", minPercentile: 68 },
  { name: "Final Four", minPercentile: 73 },
  { name: "National Champion", minPercentile: 78 },
  { name: "NBA Draftee", minPercentile: 82 },
  { name: "Rookie of the Year", minPercentile: 85.5 },
  { name: "NBA All-Star", minPercentile: 88.5 },
  { name: "NBA All-Pro", minPercentile: 91 },
  { name: "NBA MVP", minPercentile: 93.5 },
  { name: "NBA Champion", minPercentile: 96 },
  { name: "Hall of Fame", minPercentile: 98 },
  { name: "Legend", minPercentile: 99.5 },
];

// Online games (wins+losses) needed before a percentile rank is shown -
// standard placement-match floor, so a 1-0 record can't claim "100th
// percentile" off a single lucky game, and so nobody with too small a
// sample distorts what everyone else is being measured against.
export const RANK_GAMES_FLOOR = 5;

// One personal-best record per counting stat, each: {value, playerName, date}.
export const FEATURED_BADGE_SLOTS = 3;

export const STAT_LABELS = { pts: "Points", reb: "Rebounds", ast: "Assists", stl: "Steals", blk: "Blocks" };

export function tierForPercentile(percentile) {
  let tier = TIERS[0];
  for (const t of TIERS) if (percentile >= t.minPercentile) tier = t;
  return tier;
}

export function nextTierAbove(percentile) {
  return TIERS.find((t) => t.minPercentile > percentile) || null;
}

/**
 * Where a player's online win rate stands relative to everyone else's -
 * comparative, not an absolute win-count ladder, so this has to look at the
 * whole player base rather than just one profile. Bot games are practice,
 * not rank, since they're not a fair, verified bar to measure anyone
 * against - only online (vs. human) results count here.
 *
 * `profiles` is publicly readable (the "profiles are publicly readable" RLS
 * policy), so this reads win/loss counts directly rather than needing a
 * dedicated RPC - the same reasoning presence.js's heartbeat function
 * doesn't apply here, since win/loss counts aren't sensitive the way a raw
 * browser-id list would be.
 *
 * Returns { provisional: true, gamesPlayed, gamesNeeded } below the games
 * floor, or { provisional: false, tier, next, percentile, rank,
 * totalQualifying, winRate, gamesPlayed } once ranked.
 */
export async function loadRankInfo(profile) {
  const gamesPlayed = profile.onlineWins + profile.onlineLosses;
  if (gamesPlayed < RANK_GAMES_FLOOR) {
    return { provisional: true, gamesPlayed, gamesNeeded: RANK_GAMES_FLOOR - gamesPlayed };
  }

  const supabase = await getSupabase();
  const { data, error } = await supabase.from("profiles").select("online_wins, online_losses");
  if (error) throw error;

  const winRate = profile.onlineWins / gamesPlayed;
  let below = 0;
  let above = 0;
  let qualifying = 0;
  for (const row of data) {
    const played = (row.online_wins || 0) + (row.online_losses || 0);
    if (played < RANK_GAMES_FLOOR) continue;
    qualifying += 1;
    const rate = row.online_wins / played;
    if (rate < winRate) below += 1;
    else if (rate > winRate) above += 1;
  }

  const percentile = qualifying > 0 ? (100 * below) / qualifying : 100;
  return {
    provisional: false,
    tier: tierForPercentile(percentile),
    next: nextTierAbove(percentile),
    percentile,
    rank: above + 1,
    totalQualifying: qualifying,
    winRate,
    gamesPlayed,
  };
}

export function mostDraftedPlayer(profile) {
  let best = null;
  for (const [name, count] of Object.entries(profile.draftCounts)) {
    if (!best || count > best.count) best = { name, count };
  }
  return best;
}

export function mostTripleDoubles(profile) {
  let best = null;
  for (const [name, count] of Object.entries(profile.tripleDoubleCounts)) {
    if (!best || count > best.count) best = { name, count };
  }
  return best;
}

export function mostMVPs(profile) {
  let best = null;
  for (const [name, count] of Object.entries(profile.mvpCounts)) {
    if (!best || count > best.count) best = { name, count };
  }
  return best;
}

// Double-digit in any 3 of the 5 box-score categories - the general
// definition, not just the classic pts/reb/ast one.
const TRIPLE_DOUBLE_KEYS = ["pts", "reb", "ast", "stl", "blk"];
function isTripleDouble(line) {
  return TRIPLE_DOUBLE_KEYS.filter((k) => (line[k] || 0) >= 10).length >= 3;
}

/** Strips a roster down to just what a stored box-score snapshot needs to
 * re-render later (boxRow reads player.name/team/decade, nothing else) -
 * keeping pos/per-game stat fields out of it is what keeps a jsonb snapshot
 * cheap. */
function snapshotRoster(roster) {
  const out = {};
  for (const [slot, player] of Object.entries(roster)) {
    if (player) out[slot] = { name: player.name, team: player.team, decade: player.decade };
  }
  return out;
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
    eraRecords: row.era_records || {},
    // Never null: a player with nothing equipped flies the default Rookie
    // banner rather than showing a blank card (see DEFAULT_BANNER_ID).
    equippedBanner: row.equipped_banner || DEFAULT_BANNER_ID,
    featuredBadges: row.featured_badges || [],
    createdAt: row.created_at || null,
    history: row.history || [],
    highestScoringGame: row.highest_scoring_game || null,
    largestMarginGame: row.largest_margin_game || null,
    tripleDoubleCounts: row.triple_double_counts || {},
    mvpCounts: row.mvp_counts || {},
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
 * @param era the era bracket this game was drafted from ("all", "modern",
 *   ...). Each bracket keeps its own record, since knowing the 2010s is a
 *   different skill from knowing the 1970s.
 * @param ownLines [{playerName, line: {pts,reb,ast,stl,blk,tov}}, ...] - the
 *   full box score of the user's OWN roster this game, used to update the
 *   per-stat personal-best records and scan for triple-doubles.
 * @param mvpIsOwnTeam whether this game's MVP (pickMvp() in engine.js picks
 *   from either roster) was one of the user's own drafted players - only
 *   then does it count toward the "most MVPs" stat.
 * @param rosterA, rosterB, boxA, boxB, labelA, labelB, minutesA, minutesB -
 *   the complete two-sided box score for this game, kept only long enough to
 *   snapshot into highest_scoring_game if this game sets a new record (see
 *   below); not otherwise persisted, since every other stat here only needs
 *   the user's own line.
 * Note this never awards banner progress: banners come from ranked wins
 * only, granted server-side (see the award_banner_progress trigger), because
 * anything the client can grant itself isn't worth earning.
 */
export async function recordPracticeResult({
  mode,
  era = "all",
  won,
  opponentLabel,
  scoreFor,
  scoreAgainst,
  mvpName,
  mvpIsOwnTeam,
  ownLines,
  rosterA,
  rosterB,
  boxA,
  boxB,
  labelA,
  labelB,
  minutesA,
  minutesB,
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

  const history = [{ date, mode, won, opponentLabel, scoreFor, scoreAgainst, mvpName }, ...profile.history].slice(
    0,
    50
  );

  const eraRecords = bumpEraRecord(profile.eraRecords, era, "offline", won);

  // Highest-scoring game keeps a full box-score snapshot (roster names +
  // lines only, see snapshotRoster) so the profile screen can show it back
  // later - every other record here is a bare number, but "click to see the
  // box score" needs the actual box score to click into.
  let highestScoringGame = profile.highestScoringGame;
  if (rosterA && rosterB && boxA && boxB && (!highestScoringGame || scoreFor > highestScoringGame.value)) {
    highestScoringGame = {
      value: scoreFor,
      date,
      mode,
      era,
      opponentLabel,
      scoreFor,
      scoreAgainst,
      labelA,
      labelB,
      rosterA: snapshotRoster(rosterA),
      rosterB: snapshotRoster(rosterB),
      boxA,
      boxB,
      minutesA,
      minutesB,
    };
  }

  // Margin of victory only makes sense for wins - a loss has no "victory" to
  // measure the margin of.
  let largestMarginGame = profile.largestMarginGame;
  const margin = scoreFor - scoreAgainst;
  if (won && (!largestMarginGame || margin > largestMarginGame.value)) {
    largestMarginGame = { value: margin, date, mode, era, opponentLabel, scoreFor, scoreAgainst };
  }

  const tripleDoubleCounts = { ...profile.tripleDoubleCounts };
  for (const { playerName, line } of ownLines) {
    if (isTripleDouble(line)) tripleDoubleCounts[playerName] = (tripleDoubleCounts[playerName] || 0) + 1;
  }

  // pickMvp() (engine.js) picks the best performer from EITHER roster, not
  // just the user's own - only count it here when it's actually one of the
  // user's drafted players, or the bot's best game would count as "yours".
  const mvpCounts = { ...profile.mvpCounts };
  if (mvpName && mvpIsOwnTeam) mvpCounts[mvpName] = (mvpCounts[mvpName] || 0) + 1;

  const session = await requireSession();
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("profiles")
    .update({
      offline_wins: profile.offlineWins + (won ? 1 : 0),
      offline_losses: profile.offlineLosses + (won ? 0 : 1),
      personal_bests: personalBests,
      career_totals: careerTotals,
      era_records: eraRecords,
      history,
      highest_scoring_game: highestScoringGame,
      largest_margin_game: largestMarginGame,
      triple_double_counts: tripleDoubleCounts,
      mvp_counts: mvpCounts,
    })
    .eq("id", session.user.id);
  if (error) throw error;
}

export const EMPTY_ERA_RECORD = {
  online_wins: 0,
  online_losses: 0,
  offline_wins: 0,
  offline_losses: 0,
};

/** This era's record, with every counter present so callers never have to
 * guard against a bracket nobody has played yet. */
export function eraRecord(profile, eraId) {
  return { ...EMPTY_ERA_RECORD, ...(profile.eraRecords?.[eraId] || {}) };
}

/** Returns a NEW era_records object with one counter incremented. Online
 * results are written server-side by simulate-match for the same reason the
 * top-level online record is: a client that can grant itself rank isn't
 * ranking anything. */
function bumpEraRecord(records, eraId, kind, won) {
  const current = { ...EMPTY_ERA_RECORD, ...((records || {})[eraId] || {}) };
  const key = `${kind}_${won ? "wins" : "losses"}`;
  return { ...(records || {}), [eraId]: { ...current, [key]: (current[key] || 0) + 1 } };
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

/** The (up to three) badges shown on your player banner. Cosmetic, so the
 * client writes it directly. */
export async function setFeaturedBadges(badgeIds) {
  const session = await requireSession();
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("profiles")
    .update({ featured_badges: badgeIds.slice(0, FEATURED_BADGE_SLOTS) })
    .eq("id", session.user.id);
  if (error) throw error;
}
