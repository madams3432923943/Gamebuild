// Turning rows into ratings.
//
// The engine needs one comparable number per roster slot: a quarterback's
// passing line and a secondary's interception rate have to land on the same
// scale before OFFENSE_WEIGHTS and DEFENSE_WEIGHTS can combine them. This file
// is that conversion and nothing else - no simulation lives here.
//
// The aggregation this file was originally scoped for now happens upstream, in
// tools/build-nfl-data.mjs: units arrive already rolled up, games-weighted,
// carrying `depth` and their member names. What is left is the harder half -
// deciding how good one is.
//
// WHY PERCENTILE AND NOT A HAND-BUILT FORMULA
//
// The obvious approach is to invent a passer rating: weight yards this much,
// touchdowns that much, subtract for interceptions. Every such formula is a
// balance decision smuggled in as arithmetic, and this project's rule is that
// balance is solved rather than picked.
//
// So a player is rated by WHERE HE FALLS among everyone who played his
// position. A quarterback in the 90th percentile of quarterbacks rates 0.90,
// and what "90th percentile" means is decided by the data rather than by
// someone choosing coefficients. The composites below still weight stats
// within a position, but they only have to ORDER players against each other -
// a far weaker claim than getting an absolute scale right, and one that a
// wrong guess degrades gently instead of breaking.
//
// It also makes eras comparable for free. A 2000 quarterback and a 2023
// quarterback are each ranked against the whole dataset at their position, so
// the passing boom shows up as more high-rated modern passers rather than as a
// thumb on the scale nobody wrote down.

import { MIN_RATED_GAMES } from "./constants.js";

/** Composite score within a position, before the percentile step. These only
 * have to order players correctly against others at the same position. */
const COMPOSITES = {
  // Yards move the ball, touchdowns are the payoff, interceptions are the cost
  // that separates a volume passer from a good one.
  QB: (r) => r.pass_yds + 22 * r.pass_td - 26 * r.ints + 0.9 * r.rush_yds + 14 * r.rush_td,
  // Receiving counts for a back because third down is where backs differ most.
  RB: (r) => r.rush_yds + 18 * r.rush_td + 0.7 * r.rec_yds + 14 * r.rec_td - 20 * r.fum,
  WR: (r) => r.rec_yds + 20 * r.rec_td + 2.5 * r.rec - 18 * r.fum,
  TE: (r) => r.rec_yds + 20 * r.rec_td + 2.5 * r.rec - 18 * r.fum,
};

/** Same idea for units. Defensive groups are rated on what actually ends
 * drives - takeaways and pressure - rather than on tackles, which mostly count
 * how often the unit was on the field while the offence moved. */
// KNOWN WRONG - see the eye-test results recorded below. These order most
// units correctly but fail on two cases that matter, and the failures share a
// cause: counting stats reward being on the field, and a defence that is on
// the field constantly is usually a bad one.
//
//   2006 Bears linebackers rate 0.401. Urlacher and Briggs were one of the
//   best corps ever, and the composite cannot see coverage - the thing that
//   made them great - because the dataset has no coverage stat for linebackers.
//
//   2008 Lions defensive line rates 0.744 on an 0-16 team. Opponents ran far
//   more plays against them, so the tackle term rewards the volume that losing
//   produced.
//
// The fix is to rate per-play rather than per-game, which needs a snaps or
// opponent-plays column the import does not yet carry. Recorded here rather
// than quietly tuned, because tuning coefficients until Chicago looks right
// would be picking balance instead of solving it.
const UNIT_COMPOSITES = {
  DL: (r) => 12 * r.sacks + 8 * r.ff + 6 * r.ints + 2 * r.pd + 0.4 * r.tackles,
  LB: (r) => 8 * r.sacks + 7 * r.ff + 7 * r.ints + 2.5 * r.pd + 0.5 * r.tackles,
  CB: (r) => 14 * r.ints + 4 * r.pd + 4 * r.ff + 0.3 * r.tackles,
  S: (r) => 13 * r.ints + 3.5 * r.pd + 5 * r.ff + 0.4 * r.tackles,
  // The line has no counting stats, so the import derived a rating for it.
  // Sacks allowed is the pass-protection half, yards per carry the run half.
  OL: (r) => r.rating - 6 * r.sacks_allowed + 8 * r.ypc,
  // A kicker is his accuracy. Volume barely counts: a perfect kicker on a good
  // offence attempts fewer, and docking him for that would be backwards.
  ST: (r) => 100 * r.fg_pct + 30 * r.pat_pct + 3 * r.fg_att,
};

/** Depth is a real term, not decoration. A three-man secondary that played a
 * whole season is thinner than a five-man one, and thin units break down late,
 * so shallow ones get pulled toward the middle rather than rating on their
 * best players alone. Full credit at five and above. */
function depthFactor(depth) {
  if (!Number.isFinite(depth) || depth <= 0) return 0.85;
  return Math.min(1, 0.72 + 0.056 * depth);
}

/** Sorted composite scores per position and per unit group - all a percentile
 * lookup needs. Built once per dataset and handed to the raters.
 *
 * Short seasons are excluded from the DISTRIBUTION but still ratable against
 * it: a player who appeared in four games should not help define what a median
 * season looks like, though he still deserves a number. */
export function buildRatingContext(players, units) {
  const ctx = { players: {}, units: {} };

  for (const row of players) {
    for (const pos of row.pos || []) {
      const composite = COMPOSITES[pos];
      if (!composite || row.games < MIN_RATED_GAMES) continue;
      (ctx.players[pos] ||= []).push(composite(row));
    }
  }
  for (const row of units) {
    const composite = UNIT_COMPOSITES[row.group];
    if (!composite || row.games < MIN_RATED_GAMES) continue;
    (ctx.units[row.group] ||= []).push(composite(row));
  }

  for (const bucket of [ctx.players, ctx.units]) {
    for (const key of Object.keys(bucket)) bucket[key].sort((a, b) => a - b);
  }
  return ctx;
}

/** Share of the distribution at or below `value`, as 0..1. Binary search
 * because these arrays run to thousands of entries and this is called once per
 * roster slot per simulated game - which during calibration is millions. */
function percentile(sorted, value) {
  if (!sorted || sorted.length === 0) return 0.5;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

/** Clamped away from the ends: 0 would mean an offence that can never move the
 * ball and 1 an unstoppable one, and both make the drive model degenerate. The
 * best real offences still punt a third of the time. */
const clamp = (v) => Math.max(0.06, Math.min(0.97, v));

/** Rate one drafted player, 0..1 among others at his position.
 *
 * A short season is regressed toward the middle rather than trusted outright
 * or thrown away. Four brilliant games are evidence, just weaker evidence than
 * sixteen, and someone who drafted an injured star should still get most of
 * what he paid for. */
export function ratePlayer(row, ctx) {
  const pos = (row.pos || []).find((p) => COMPOSITES[p]);
  if (!pos) return 0.5;
  const raw = percentile(ctx.players[pos], COMPOSITES[pos](row));
  if (row.games >= MIN_RATED_GAMES) return clamp(raw);
  const trust = Math.max(0, row.games) / MIN_RATED_GAMES;
  return clamp(0.5 + (raw - 0.5) * trust);
}

/** Rate one drafted unit, 0..1 among others of its group, then pulled toward
 * the middle if it was thin. */
export function rateUnit(row, ctx) {
  const composite = UNIT_COMPOSITES[row.group];
  if (!composite) return 0.5;
  const raw = percentile(ctx.units[row.group], composite(row));
  const trust = row.games >= MIN_RATED_GAMES ? 1 : Math.max(0, row.games) / MIN_RATED_GAMES;
  const withSample = 0.5 + (raw - 0.5) * trust;
  return clamp(0.5 + (withSample - 0.5) * depthFactor(row.depth));
}

/** Whether a roster entry is a unit or an individual. Both shapes travel
 * through the same draft and the same roster jsonb, so the engine has to ask
 * rather than assume - `group` is the field only units carry. */
export const isUnit = (entry) => typeof entry?.group === "string";

/** Rate any roster entry, whichever kind it is. This is what the engine calls;
 * it should never need to know which shape it was handed. */
export function rateEntry(entry, ctx) {
  if (!entry) return 0;
  return isUnit(entry) ? rateUnit(entry, ctx) : ratePlayer(entry, ctx);
}
