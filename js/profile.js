// Persistent player profile, backed by Supabase (table: profiles) instead
// of localStorage - this is what makes the profile survive across devices
// once real accounts replace anonymous auth, and it's what lets the online
// win/loss record be authoritative (only the simulate-match Edge Function
// can write online_wins/online_losses - see the protect_online_record
// trigger in the schema).
import { getSupabase, requireSession } from "./supabaseClient.js";
import { eraRecordKey, statsKey, DEFAULT_SPORT_ID, activeSport, activeSportId, sportById } from "./sports/index.js";
import { DEFAULT_BANNER_ID } from "./banners.js";
import { GENERAL_TIERS, tierAt, tierAbove } from "./ranks.js";
import { ratingFor, overallRating, percentileOf, RANK_GAMES_FLOOR } from "./rating.js";

// Re-exported so callers that only care about the games floor don't have to
// know it is really a property of the rating system.
export { RANK_GAMES_FLOOR };

// One personal-best record per counting stat, each: {value, playerName, date}.
export const FEATURED_BADGE_SLOTS = 3;

/** The stat keys one sport keeps a personal best in. Moved to the sport
 * modules - "Points" is not a football record - so this just asks. */
function statKeysFor(sportId) {
  return Object.keys(sportById(sportId).statLabels || {});
}

/** The active sport's ladder. Where a player stands is sport-agnostic maths -
 * a percentile against everyone else's rating - but what that percentile is
 * CALLED is not: "NBA MVP" means nothing in football. Each sport declares its
 * own `tiers`, and the arithmetic (js/ranks.js) is shared. */
function tiers() {
  return activeSport().tiers || [];
}

export function tierForPercentile(percentile) {
  return tierAt(tiers(), percentile);
}

export function nextTierAbove(percentile) {
  return tierAbove(tiers(), percentile);
}

/** Every profile's ratings, for working out where one player stands.
 *
 * `profiles` is publicly readable (the "profiles are publicly readable" RLS
 * policy), so this reads the ratings directly rather than needing a dedicated
 * RPC - a rating is a leaderboard number, not something sensitive.
 *
 * Both ladders need the whole table, so they share one fetch: asking twice on
 * a screen that shows a sport rank and an overall rank side by side would
 * double the round trip for the same rows. */
async function allSportRatings() {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("profiles").select("sport_ratings");
  if (error) throw error;
  return data.map((row) => row.sport_ratings || {});
}

/** Shared shape for both ladders, so the UI renders either the same way. */
function standing(rating, population, gamesPlayed, ladder) {
  const { percentile, rank, total } = percentileOf(rating, population);
  return {
    provisional: false,
    rating,
    tier: tierAt(ladder, percentile),
    next: tierAbove(ladder, percentile),
    percentile,
    rank,
    totalQualifying: total,
    gamesPlayed,
  };
}

/**
 * Where a player stands in ONE sport.
 *
 * Ratings are per-sport and always have been separate numbers - knowing the
 * 1996 Bulls says nothing about knowing the 1985 Bears, so a football result
 * has no business moving a basketball rank. Bot games are practice, not rank:
 * only online results against a human ever reach sport_ratings, and only the
 * Edge Function can write them (the protect_sport_ratings trigger).
 *
 * Returns { provisional: true, gamesPlayed, gamesNeeded } below the games
 * floor, or a full standing once rated.
 *
 * @param sportId defaults to the sport currently selected, so the profile
 *   screen follows the subtab the player is looking at.
 */
export async function loadRankInfo(profile, sportId = activeSportId(), population = null) {
  const entry = ratingFor(profile.sportRatings, sportId);
  if (entry.games < RANK_GAMES_FLOOR) {
    return { provisional: true, gamesPlayed: entry.games, gamesNeeded: RANK_GAMES_FLOOR - entry.games };
  }

  const rows = population || (await allSportRatings());
  // Only players rated in THIS sport are the field. Someone with 200 football
  // games and no basketball ones is not a basketball player you can be ranked
  // above, and counting them would inflate everyone's basketball percentile.
  const field = rows
    .map((r) => ratingFor(r, sportId))
    .filter((e) => e.games >= RANK_GAMES_FLOOR)
    .map((e) => e.rating);

  return standing(entry.rating, field, entry.games, sportById(sportId).tiers || []);
}

/**
 * Where a player stands across everything - the rank on their banner.
 *
 * The rating is the games-weighted mean of their per-sport ratings
 * (overallRating in js/rating.js), and the ladder is the sport-neutral one, so
 * this reads the same to a basketball player and a football one.
 *
 * The field is everyone with a rated game in ANY sport, which is the right
 * comparison for a rank that claims to span all of them.
 */
export async function loadOverallRankInfo(profile, population = null) {
  const own = overallRating(profile.sportRatings);
  if (!own || own.games < RANK_GAMES_FLOOR) {
    const played = own?.games || 0;
    return { provisional: true, gamesPlayed: played, gamesNeeded: RANK_GAMES_FLOOR - played };
  }

  const rows = population || (await allSportRatings());
  const field = rows
    .map((r) => overallRating(r))
    .filter((o) => o && o.games >= RANK_GAMES_FLOOR)
    .map((o) => o.rating);

  return standing(own.rating, field, own.games, GENERAL_TIERS);
}

/**
 * The entries of a career-stat map that belong to one sport, with the sport
 * prefix stripped back off.
 *
 * The maps are keyed through statsKey(): bare for basketball, `nfl:`-prefixed
 * for anything else (see js/sports/index.js for why). Reading them therefore
 * has to filter, or the NBA tab would count football players and the NFL tab
 * would show basketball ones.
 */
function scopedEntries(map, sportId) {
  const prefix = `${sportId}:`;
  return Object.entries(map || {})
    .filter(([key]) => (sportId === DEFAULT_SPORT_ID ? !key.includes(":") : key.startsWith(prefix)))
    .map(([key, value]) => [sportId === DEFAULT_SPORT_ID ? key : key.slice(prefix.length), value]);
}

function highestCount(map, sportId) {
  let best = null;
  for (const [name, count] of scopedEntries(map, sportId)) {
    if (!best || count > best.count) best = { name, count };
  }
  return best;
}

export function mostDraftedPlayer(profile, sportId = DEFAULT_SPORT_ID) {
  return highestCount(profile.draftCounts, sportId);
}

export function mostTripleDoubles(profile, sportId = DEFAULT_SPORT_ID) {
  return highestCount(profile.tripleDoubleCounts, sportId);
}

/** One sport's personal bests, keyed by bare stat name. */
export function personalBestsFor(profile, sportId = DEFAULT_SPORT_ID) {
  return Object.fromEntries(scopedEntries(profile.personalBests, sportId));
}

/** How many games profiles.history keeps. The Edge Function applies the same
 * cap to online results (see applyMatchOutcome), so the two stay in step. */
export const HISTORY_LIMIT = 50;

/**
 * Longest and current win streak, read off `history`.
 *
 * Computed rather than stored because history already carries what's needed
 * and is written by BOTH sides - the client for practice games and the
 * simulate-match Edge Function for online ones. A stored counter would have
 * to be incremented in both places, and the Edge Function is out of this
 * repo, so half of a player's games would silently miss it.
 *
 * The trade is that history is capped, so a streak older than the last
 * HISTORY_LIMIT games is invisible. `complete` says which case you're in -
 * under the cap, history holds every game a player has played and the answer
 * is genuinely all-time - so the label can be honest instead of quietly
 * overclaiming.
 *
 * history is newest-first, which doesn't matter for the longest run but does
 * for the current one: that is the streak at the FRONT of the list.
 */
export function winStreaks(profile) {
  const games = profile.history || [];
  let longest = 0;
  let run = 0;
  for (const game of games) {
    run = game.won ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  let current = 0;
  for (const game of games) {
    if (!game.won) break;
    current += 1;
  }
  return { longest, current, complete: games.length < HISTORY_LIMIT, sampled: games.length };
}

export function mostMVPs(profile, sportId = DEFAULT_SPORT_ID) {
  return highestCount(profile.mvpCounts, sportId);
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
    // { nba: { rating, wins, losses, games, peak }, nfl: {...} } - one ELO per
    // sport, written only by simulate-match (protect_sport_ratings).
    sportRatings: row.sport_ratings || {},
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
export async function recordDraftPicks(playerNames, sport = DEFAULT_SPORT_ID) {
  const profile = await loadProfile();
  const draftCounts = { ...profile.draftCounts };
  for (const name of playerNames) {
    const key = statsKey(sport, name);
    draftCounts[key] = (draftCounts[key] || 0) + 1;
  }
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
  sport = DEFAULT_SPORT_ID,
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

  // Every career-stat map is namespaced by sport from here on (statsKey), so
  // a football record can never be compared against a basketball one. NBA
  // keeps the bare key, which is what makes this need no backfill.
  const personalBests = { ...profile.personalBests };
  for (const statKey of statKeysFor(sport)) {
    const key = statsKey(sport, statKey);
    for (const { playerName, line } of ownLines) {
      const value = line[statKey];
      const current = personalBests[key];
      if (!current || value > current.value) {
        personalBests[key] = { value, playerName, date };
      }
    }
  }

  // Career totals are what the tiered badges rank up on - personal_bests only
  // ever holds a single-game high, and history is capped at 50 entries, so
  // neither can answer "how many assists have my players racked up ever".
  const careerTotals = { ...profile.careerTotals };
  for (const statKey of statKeysFor(sport)) {
    const key = statsKey(sport, statKey);
    const gameTotal = ownLines.reduce((sum, { line }) => sum + (line[statKey] || 0), 0);
    careerTotals[key] = (careerTotals[key] || 0) + gameTotal;
  }

  const history = [{ date, mode, won, opponentLabel, scoreFor, scoreAgainst, mvpName }, ...profile.history].slice(
    0,
    HISTORY_LIMIT
  );

  // Namespaced by sport: era ids are only unique within one (every sport
  // wants an "all" bracket), so a bare id would add an NFL result straight
  // onto the NBA ladder. NBA keeps the bare key, so existing records carry
  // over untouched - see eraRecordKey.
  const eraRecords = bumpEraRecord(profile.eraRecords, eraRecordKey(sport, era), "offline", won);

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
    if (!isTripleDouble(line)) continue;
    const key = statsKey(sport, playerName);
    tripleDoubleCounts[key] = (tripleDoubleCounts[key] || 0) + 1;
  }

  // pickMvp() (engine.js) picks the best performer from EITHER roster, not
  // just the user's own - only count it here when it's actually one of the
  // user's drafted players, or the bot's best game would count as "yours".
  const mvpCounts = { ...profile.mvpCounts };
  if (mvpName && mvpIsOwnTeam) {
    const key = statsKey(sport, mvpName);
    mvpCounts[key] = (mvpCounts[key] || 0) + 1;
  }

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

/** Returns a NEW era_records object with one counter incremented.
 *
 * This writes the OFFLINE counters only; the online ones are written by
 * simulate-match, for the same reason the top-level online record is - a
 * client that can grant itself rank isn't ranking anything.
 *
 * That was true of the comment here long before it was true of the code: the
 * Edge Function never touched era_records, so every player's Records by Era
 * read 0-0 no matter how many ranked games they had played. Fixed in
 * applyMatchOutcome; the two bump functions are deliberate copies and must
 * stay in step. */
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
