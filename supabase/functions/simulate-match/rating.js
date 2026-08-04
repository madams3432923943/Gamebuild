// ELO ratings, one per sport.
//
// Rank used to be a win-rate percentile: wins/(wins+losses) compared against
// everyone else's. That is a fine sort order and a bad rating. It cannot tell
// a 10-0 run against beginners from a 10-0 run against the best player in the
// game, it moves a veteran's number by less every game purely because the
// denominator grows, and it has no way to say what a single result was worth.
// ELO answers all three: what you gain is what the result was worth given who
// you played.
//
// Nothing here touches the DOM, the database or any sport module, so this file
// is vendored verbatim into the Edge Function (see
// supabase/functions/simulate-match/rating.ts) - both sides have to agree on
// what a game was worth or the number the client shows is not the number the
// server stored.

/** Where every player starts, in every sport.
 *
 * 500 rather than chess's conventional 1500: the ladder reads better when the
 * starting rung is visibly near the bottom of the scale rather than the middle
 * of a range nobody can see the ends of. The arithmetic is unaffected - ELO
 * only ever cares about the DIFFERENCE between two ratings. */
export const START_RATING = 500;

/** Ratings cannot fall below this.
 *
 * Without a floor a long enough losing run walks a rating to zero and then
 * negative, which reads as broken rather than as bad. The floor sits far
 * enough under START_RATING that reaching it takes a genuinely dire run, and
 * anyone on it still climbs normally the moment they win. */
export const RATING_FLOOR = 100;

/** The spread at which a player is expected to win ~10 games in 11.
 *
 * Standard ELO uses 400 and there is no reason to differ: it is what makes a
 * rating difference mean something a player can reason about. */
const SCALE = 400;

/** Games before a rating is treated as settled. Until then it moves faster, so
 * a new account converges on roughly the right number in a handful of games
 * instead of grinding up from 500 one small step at a time. */
export const PLACEMENT_GAMES = 10;
const K_PLACEMENT = 40;
const K_SETTLED = 24;

/** Online games in ONE sport before that sport shows a rank rather than
 * "provisional". A rating exists from game one - this only gates whether it is
 * shown as a placement on the ladder, so that a 1-0 record cannot claim the
 * top percentile off a single lucky game and distort what everyone else is
 * measured against. */
export const RANK_GAMES_FLOOR = 5;

/** Probability `rating` beats `opponentRating`, on ELO's logistic curve. */
export function expectedScore(rating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / SCALE));
}

/** How hard a single result moves a rating with this many games behind it. */
export function kFactor(gamesPlayed) {
  return gamesPlayed < PLACEMENT_GAMES ? K_PLACEMENT : K_SETTLED;
}

/**
 * This player's rating after one game.
 *
 * Deliberately takes both ratings as they were BEFORE the game: applying the
 * two sides in sequence, so that the second player is rated against the
 * winner's already-updated number, quietly makes the exchange lopsided and
 * stops it being zero-sum. Callers must snapshot both first - see
 * applyRatingExchange, which exists so nobody has to remember that.
 */
export function nextRating(rating, opponentRating, won, gamesPlayed) {
  const expected = expectedScore(rating, opponentRating);
  const actual = won ? 1 : 0;
  const next = rating + kFactor(gamesPlayed) * (actual - expected);
  return Math.max(RATING_FLOOR, Math.round(next));
}

/** The record a sport keeps for one player. Every counter present, so callers
 * never guard against a sport nobody has played. */
export function emptyRating() {
  return { rating: START_RATING, wins: 0, losses: 0, games: 0, peak: START_RATING };
}

/** One sport's entry out of a `sport_ratings` object, defaulted. */
export function ratingFor(sportRatings, sportId) {
  return { ...emptyRating(), ...((sportRatings || {})[sportId] || {}) };
}

/**
 * Both sides of one finished game, computed together.
 *
 * The whole point of doing it in one call is that it reads both ratings before
 * writing either, which is what keeps the exchange zero-sum. Returns a NEW
 * sport_ratings object for each side rather than mutating, so a failed write
 * leaves both untouched.
 *
 * @returns { a, b } - each the full replacement sport_ratings object.
 */
export function applyRatingExchange(sportRatingsA, sportRatingsB, sportId, aWon) {
  const a = ratingFor(sportRatingsA, sportId);
  const b = ratingFor(sportRatingsB, sportId);

  const aNext = nextRating(a.rating, b.rating, aWon, a.games);
  const bNext = nextRating(b.rating, a.rating, !aWon, b.games);

  const settle = (entry, next, won) => ({
    rating: next,
    wins: entry.wins + (won ? 1 : 0),
    losses: entry.losses + (won ? 0 : 1),
    games: entry.games + 1,
    // Peak is kept because a rating can fall, and "how high did you ever get"
    // is a different question from "where are you now" - the one a player
    // actually wants to point at.
    peak: Math.max(entry.peak || START_RATING, next),
  });

  return {
    a: { ...(sportRatingsA || {}), [sportId]: settle(a, aNext, aWon) },
    b: { ...(sportRatingsB || {}), [sportId]: settle(b, bNext, !aWon) },
  };
}

/**
 * One number across every sport, for the general rank on a player's banner.
 *
 * A games-weighted mean of the per-sport ratings: a sport you have played
 * twice pulls the average about as hard as two games deserve, so dabbling in a
 * second sport cannot swing a rank built over a hundred games in the first.
 * Derived rather than stored on purpose - a stored overall would be a third
 * number that could drift out of step with the two it is made of.
 *
 * Returns null when no sport has a rated game, which is the honest answer for
 * a brand-new account and is what the caller shows "Unranked" for.
 */
export function overallRating(sportRatings) {
  let weighted = 0;
  let games = 0;
  for (const entry of Object.values(sportRatings || {})) {
    const played = entry?.games || 0;
    if (played <= 0) continue;
    weighted += (entry.rating || START_RATING) * played;
    games += played;
  }
  return games > 0 ? { rating: Math.round(weighted / games), games } : null;
}

/**
 * Where `rating` falls among `population`, as a percentile.
 *
 * Shared by both ladders - the per-sport one compares against everyone rated
 * in that sport, the general one against everyone rated in anything - because
 * "top N%" has to mean the same thing on both or the two ranks are not
 * comparable. Ties count as neither above nor below, so a field where everyone
 * sits on the starting rating puts all of them at 0 rather than arbitrarily
 * ordering identical players.
 */
export function percentileOf(rating, population) {
  if (!population.length) return 100;
  let below = 0;
  let above = 0;
  for (const other of population) {
    if (other < rating) below += 1;
    else if (other > rating) above += 1;
  }
  return { percentile: (100 * below) / population.length, rank: above + 1, total: population.length };
}
