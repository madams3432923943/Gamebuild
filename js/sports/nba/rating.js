// Position-relative NBA player Overall. This is deliberately separate from
// draft grading: a player's rating is an input to that grade, not the grade
// itself, and rebuilding its population index per rendered row is too costly.

import { impact } from "./engine.js";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const CEILING_Z = Math.tanh(1);

/**
 * How much of his season a player was actually there for, as a multiplier on
 * how far above his position he stood.
 *
 * WITHOUT THIS, Joel Embiid's 2023 season - 34.7 points a game in THIRTY-NINE
 * games - rated the best centre in the dataset, ahead of every 70-plus-game
 * Jokic and Shaq season. A rate per game says nothing about whether a team
 * could count on him, and a draft pick is a claim that it can.
 *
 * MEASURED AGAINST THE SEASON, NOT AGAINST 82. The pool contains four
 * shortened seasons - 1998-99 at 50 games, 2011-12 at 66, 2019-20 at 74 and
 * 2020-21 at 72 - and a fixed denominator would charge every player in them for
 * a lockout. The season's own longest games-played figure is its length.
 *
 * FULL CREDIT AT 72% OF THE SEASON, about 59 games of 82, sliding linearly to
 * zero below it. At 0.72 Embiid's 39-game season reads 92 and drops out of
 * first, while nobody above 59 games moves at all.
 *
 * NOT A CLIFF. A discount on z pulls a player toward his position's average
 * (70), never toward zero.
 */
export const FULL_SEASON_SHARE = 0.72;

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

/** Build both indexes in one dataset pass and memoise them on the rating ctx. */
function ratingIndex(ctx) {
  if (ctx.__nbaRatingIndex !== undefined) return ctx.__nbaRatingIndex;
  const impacts = Object.fromEntries(POSITIONS.map((pos) => [pos, []]));
  const seasonLengths = {};
  for (const entry of ctx.__allEntries || []) {
    const games = Math.max(0, Number(entry?.games) || 0);
    const season = entry?.season;
    if (season !== undefined && season !== null) {
      seasonLengths[season] = Math.max(seasonLengths[season] || 0, games);
    }
    for (const pos of entry?.pos || []) {
      if (impacts[pos]) impacts[pos].push(impact(entry));
    }
  }

  const distributions = {};
  for (const pos of POSITIONS) {
    const values = impacts[pos];
    const average = mean(values);
    const sd = Math.sqrt(mean(values.map((value) => (value - average) ** 2))) || 1;
    const best = values.length ? Math.max(...values) : average;
    distributions[pos] = {
      mean: average,
      sd,
      span: Math.max(0.5, (best - average) / sd),
    };
  }
  ctx.__nbaRatingIndex = { distributions, seasonLengths };
  return ctx.__nbaRatingIndex;
}

// Same tanh curve shape as ratingFromZ/overallFromZ in nfl/units.js. Copied,
// rather than imported across sport boundaries, so each sport owns its rules.
function overallFromZ(z, span) {
  const scaled = Math.tanh(z / (Number(span) || 1)) / CEILING_Z;
  return Math.max(40, Math.min(99, Math.round(70 + 29 * scaled)));
}

export function overallFor(entry, pos, ctx) {
  if (!entry) return 40;
  const { distributions, seasonLengths } = ratingIndex(ctx);
  const stats = distributions[pos] || distributions[entry.pos?.[0]];
  if (!stats) return 70;
  let z = (impact(entry) - stats.mean) / stats.sd;
  const length = seasonLengths[entry.season] || 82;
  const availability = Math.max(0, Number(entry.games) || 0) / length;
  z *= Math.min(1, availability / FULL_SEASON_SHARE);
  return overallFromZ(z, stats.span);
}

export function overallToUnit(overall) {
  return (overall - 40) / 59;
}
