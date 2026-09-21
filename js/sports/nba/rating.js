// WHAT A BASKETBALL SEASON IS WORTH, AGAINST THE MEN WHO PLAYED HIS POSITION.
//
// Its own module rather than another section of draftgrade.js, which is
// already 700 lines: this is a RATING - what one season was worth - and a
// grade is a verdict on five of them put together. One responsibility per
// file.
//
// THREE THINGS THIS FIXES, all visible on one card reading "Starters 100 /
// Bench 85":
//
//   THE 100 WAS A CLAMP, NOT A SCORE. The old talent term divided a group's
//   mean impact by the dataset's top-quartile mean and rescaled it between
//   0.35 and 0.95, so any group reaching 0.95x of the reference printed 100.
//   The roster above sat above the ceiling with headroom to spare, pinned,
//   telling the player nothing about how much better it could have been.
//
//   IMPACT IS POSITION-BLIND. ppg + 0.7 rpg + 0.7 apg + spg + bpg - 0.5 tov
//   puts a centre's 24 and a point guard's 24 on the same ladder, and they are
//   not the same season. Every number here is measured inside the position.
//
//   THERE WAS NO GAMES-PLAYED TERM AT ALL. See FULL_SEASON_SHARE.
//
// THE CURVE IS FOOTBALL'S, DELIBERATELY. ratingFromZ and overallFromZ in
// js/sports/nfl/units.js (lines 503 and 531) already solve "turn a z-score
// into a number a player can read, with an average season at 70 and the best
// at 99". Copied rather than imported: one sport reaching into another's
// folder is the rule this codebase breaks hardest when it breaks. Copied
// rather than reinvented, because two different curves for the same job is
// how the two sports start disagreeing about what 85 means.

import { impact } from "./engine.js";

/**
 * Where the tanh is asked to put each position's best season.
 *
 * The span below is that position's best z-score, so the best season enters
 * tanh at exactly 1 and everything else at some fraction of it; dividing by
 * tanh(1) then puts it on 99. Football parametrises the identical curve
 * differently - it folds the ceiling into the span and divides by 0.94 - and
 * the two must not be mixed: a raw-z span divided by 0.94 caps the best season
 * in the dataset at 94, which looks like a rating and is an arithmetic error.
 *
 * The point of stretching PER POSITION is that every position's best reaches
 * the same ceiling, rather than one shared span letting the position with the
 * longest tail own the top of the scale.
 */
const CEILING = Math.tanh(1);

/** The five positions a basketball season is rated inside. */
const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

/** An average season at your position. Below this you were worse than the men
 * you played against; at 99 you were the best there has been. */
const AVERAGE_OVERALL = 70;
const FLOOR_OVERALL = 40;
const TOP_OVERALL = 99;

/**
 * How much of his season a player was actually there for, as a multiplier on
 * how far above his position he stood.
 *
 * WITHOUT THIS, Joel Embiid's 2023 season - 34.7 points a game in THIRTY-NINE
 * games - rated the best centre in the dataset, ahead of every 70-plus-game
 * Jokic and Shaq season. A rate per game says nothing about whether a team
 * could count on him, and a draft pick is a claim that it can. The dataset's
 * build tool filters at 20 games and nothing downstream cared after that.
 *
 * MEASURED AGAINST THE SEASON, NOT AGAINST 82. The pool contains four
 * shortened seasons - 1998-99 at 50 games, 2011-12 at 66, 2019-20 at 74 and
 * 2020-21 at 72 - and a fixed denominator would charge every player in them
 * for a lockout. The season's own longest games-played figure IS its length,
 * which is a fact the dataset already carries.
 *
 * FULL CREDIT AT 72% OF THE SEASON, about 59 games of 82, sliding linearly to
 * zero below it. Solved against the top-ten-per-position lists rather than
 * picked: at 0.62 Embiid's 39-game season still rated 95 and stayed near the
 * top; at 0.80 it reached down and started charging genuine 64-game seasons
 * like Doncic's 2025. At 0.72 the 39-game season reads 92 and drops out of
 * first, Carmelo's 40-game 2014 goes 86 to 81, and nobody above 59 games moves
 * at all.
 *
 * NOT A CLIFF. A discount on z pulls a player toward his league's average
 * (70), never toward zero - a great short season is still a good player, just
 * not an all-time one.
 */
export const FULL_SEASON_SHARE = 0.72;

/**
 * Every position's own distribution, and every season's own length.
 *
 * Memoised on the stats object exactly as baselineFor memoises
 * __nbaGradeBaseline, and for the same reason: this is a full pass over ten
 * thousand rows, and rebuilding a rating index per rendered row froze the
 * browser on a single click once already.
 *
 * DERIVED, NEVER HARDCODED. Measured on the committed dataset the means run
 * 18.8 (C) to 20.1 (PF) and the spans 3.37 (SF) to 4.32 (SG), but a dataset
 * change has to move them or the rating stops meaning the same thing after it.
 */
function distributionsFor(ctx) {
  if (ctx.__nbaPositionRatings === undefined) {
    const all = ctx?.__allEntries || [];
    ctx.__nbaPositionRatings = all.length ? measureDistributions(all) : null;
  }
  return ctx.__nbaPositionRatings;
}

function measureDistributions(players) {
  const byPos = {};
  // A season's LENGTH is the most games anyone managed in it. Built in this
  // same pass rather than in one of its own: it is the same ten thousand rows.
  const seasonLength = {};

  for (const pos of POSITIONS) byPos[pos] = [];
  for (const player of players) {
    const games = Number(player?.games) || 0;
    const season = player?.season;
    if (season != null && games > (seasonLength[season] || 0)) seasonLength[season] = games;
    const value = impact(player);
    if (!Number.isFinite(value)) continue;
    for (const pos of player?.pos || []) {
      if (byPos[pos]) byPos[pos].push(value);
    }
  }

  const positions = {};
  for (const pos of POSITIONS) {
    const values = byPos[pos];
    if (!values.length) continue;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
    const best = Math.max(...values);
    // SOLVED PER POSITION so each position's best season reaches the ceiling.
    // Floored at 0.5 for the same reason football floors it: a position whose
    // best is barely above its own mean has no spread worth stretching, and
    // dividing by about zero is not a rating.
    const span = sd > 0 ? Math.max(0.5, (best - mean) / sd) : 1;
    positions[pos] = { mean, sd, span };
  }
  return { positions, seasonLength };
}

/**
 * The 0-99 this season reads at, against the men who played his position.
 *
 * `pos` is passed in by the CALLER, not read off the entry, because which
 * position a man is being asked to play is a fact about the roster rather than
 * about him: a starter is rated at the slot he was drafted into, and a reserve
 * at his own first listed position, since BENCH3 is a draft-order accident.
 * draftgrade.js already draws exactly this distinction for coverage.
 */
export function overallFor(entry, pos, ctx) {
  if (!entry) return FLOOR_OVERALL;
  const data = distributionsFor(ctx);
  const stats = data?.positions?.[pos];
  const value = impact(entry);
  // No distribution for this position, or a row we cannot score, rates
  // AVERAGE rather than zero - and says nothing either way. A 40 here would be
  // a silent failure: it reads as "the worst season in the dataset", which is
  // a claim about the player rather than about what we could measure.
  if (!stats || !(stats.sd > 0) || !Number.isFinite(value)) return AVERAGE_OVERALL;

  let z = (value - stats.mean) / stats.sd;

  // AVAILABILITY, applied in Z SPACE. Football applies its trust discount the
  // same way and for the same reason: the discount is on how far above his
  // league a man stood, so a below-average player is pulled UP toward average
  // by missing games rather than down past the men who were there.
  const length = data.seasonLength?.[entry.season] || 82;
  const games = Math.max(0, Number(entry.games) || 0);
  z *= Math.min(1, games / length / FULL_SEASON_SHARE);

  return overallFromZ(z, stats.span);
}

/** The same z-to-0-99 map football uses - see the header. 70 is an average
 * season at this position and each position's best reads 99. */
function overallFromZ(z, span) {
  if (!(span > 0)) return AVERAGE_OVERALL;
  const scaled = Math.tanh(z / span) / CEILING;
  return Math.max(
    FLOOR_OVERALL,
    Math.min(TOP_OVERALL, Math.round(AVERAGE_OVERALL + (TOP_OVERALL - AVERAGE_OVERALL) * scaled))
  );
}

/** The same rating on the 0-1 scale the grade composes on, so nothing
 * downstream of gradeMetrics has to change type. 40 maps to 0 and 99 to 1. */
export function overallToUnit(overall) {
  return (overall - FLOOR_OVERALL) / (TOP_OVERALL - FLOOR_OVERALL);
}
