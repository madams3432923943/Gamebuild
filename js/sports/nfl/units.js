// Turning NFL player and unit rows into comparable 0..1 ratings.
// Defensive units are normalized metric-by-metric within position group and
// era so a scheme choice, season length, or missing optional field cannot turn
// a legitimate defense into an automatic F.

import { MIN_RATED_GAMES, FORFEIT_PENALTY } from "./constants.js";

// WHAT A PLAYER IS WORTH, IN THREE PARTS.
//
// This used to be one part: a fantasy-points-per-game composite, percentiled.
// Volume and nothing else. Two consequences, both visible in live games:
//
//   - `ypc` and `ypt` sat in the dataset unused, so a back averaging 3.0 a
//     carry and one averaging 5.5 rated identically if their yardage matched.
//   - A backup rated on his per-game rate as though he were a starter. Mike
//     James 2013 carried 60 times all season - somebody's backup - and the
//     draft board offered him as a starting running back at his small-sample
//     4.92 a carry.
//
// So a rating is now PRODUCTION (what he did), EFFICIENCY (how good he was per
// touch) and ROLE (whether he was actually the starter). The first two are
// percentiled against his position; the third decides how far to trust the
// other two.

const COMPOSITES = {
  QB: (r) => n(r.pass_yds) + 22 * n(r.pass_td) - 26 * n(r.ints) + 0.9 * n(r.rush_yds) + 14 * n(r.rush_td),
  RB: (r) => n(r.rush_yds) + 18 * n(r.rush_td) + 0.7 * n(r.rec_yds) + 14 * n(r.rec_td) - 20 * n(r.fum),
  WR: (r) => n(r.rec_yds) + 20 * n(r.rec_td) + 2.5 * n(r.rec) - 18 * n(r.fum),
  TE: (r) => n(r.rec_yds) + 20 * n(r.rec_td) + 2.5 * n(r.rec) - 18 * n(r.fum),
};

/** One term of the NFL's passer rating, which caps each component at 2.375. */
const passerTerm = (v) => Math.max(0, Math.min(2.375, v));

/**
 * The league's own passer rating, from the fields the build now carries.
 *
 * Chosen over a bespoke formula because it is the number every football fan
 * already reads a quarterback by, and because it weighs the four things that
 * separate passers - accuracy, yards per throw, scoring and giving it away -
 * without another set of invented coefficients. Returns null when a man never
 * threw, so a running back is not rated as a failed quarterback.
 */
export function passerRating(r) {
  const att = n(r.att_pg);
  if (att <= 0) return null;
  return (
    (passerTerm((n(r.comp_pct) - 0.3) * 5) +
      passerTerm((n(r.ypa) - 3) * 0.25) +
      passerTerm((n(r.pass_td) / att) * 20) +
      passerTerm(2.375 - (n(r.ints) / att) * 25)) /
    6
  ) * 100;
}

/** How good he was per touch, as opposed to how many touches he got. */
const EFFICIENCY = {
  QB: (r) => passerRating(r),
  // Carrying and catching, weighted the way a back is actually used.
  RB: (r) => (n(r.ypc) > 0 ? n(r.ypc) : 0) + 0.35 * n(r.ypt),
  // Yards per target is the receiver's equivalent of yards per carry; catch
  // rate separates a man who was thrown at well from one who caught what came.
  WR: (r) => n(r.ypt) + 3 * catchRate(r),
  TE: (r) => n(r.ypt) + 3 * catchRate(r),
};

function catchRate(r) {
  const tgt = n(r.tgt_pg);
  return tgt > 0 ? Math.min(1.5, n(r.rec) / tgt) : 0;
}

/**
 * A starter's workload, per game, per position.
 *
 * Not a cutoff - a divisor. A back at 14 carries a game is trusted at his own
 * rate; one at 7 is trusted half way and regresses the rest toward his
 * position's middle, because half a season of carries is not evidence that he
 * could do it as the every-down back this game makes him. Nobody is pushed
 * DOWN by this: an unproven man moves toward average from whichever side he
 * started on.
 */
const STARTER_TOUCHES = { QB: 26, RB: 16, WR: 6, TE: 4 };

export function roleConfidence(r, pos) {
  const touches =
    pos === "QB" ? n(r.att_pg)
    : pos === "RB" ? n(r.car_pg) + 0.5 * n(r.tgt_pg)
    : n(r.tgt_pg);
  const full = STARTER_TOUCHES[pos] || 1;
  // Older rows predate car_pg/tgt_pg/att_pg. Absent role data must not silently
  // mean "backup" - it means "unknown", and unknown is full trust, exactly as
  // it behaved before this existed.
  if (!touches) return 1;
  return Math.max(0, Math.min(1, touches / full));
}

const NON_DEFENSIVE_UNIT_COMPOSITES = {
  // `rating` IS the line, already whole. tools/build-nfl-data.mjs builds it as
  // 50 * (protection + runBlock), both within-season percentiles, so it already
  // carries pass protection and run blocking in equal measure and is already
  // era-safe. The two terms this replaces re-read the same two inputs a second
  // time - `- 6 * sacks_allowed` the protection half, `+ 8 * ypc` the run half -
  // which double-counted the line against itself.
  //
  // That went unnoticed while sacks_allowed was silently 0 (see buildOlUnit),
  // because only one of the two duplicates was doing anything: yards per carry
  // was counted twice and protection not at all. Fixing the data without also
  // removing these would have swapped one distortion for another rather than
  // ending it, so the two changes belong together.
  OL: (r) => n(r.rating),
  ST: (r) => 100 * n(r.fg_pct) + 30 * n(r.pat_pct) + 3 * n(r.fg_att),
};

const DEFENSIVE_GROUPS = new Set(["DL", "LB", "CB", "S"]);

/**
 * WHAT A DEFENSIVE UNIT'S NUMBERS ARE MEASURED AGAINST, AND WHY IT IS NOT
 * "PER GAME".
 *
 * Every metric here used to be a per-game COUNT - tackles, tfl, pd, ints,
 * sacks - percentiled inside the unit's position group and era. That reads as
 * obviously correct and is the single most expensive mistake in this file,
 * because a count is quality multiplied by two things that are not quality:
 *
 *   HOW MANY SNAPS THE UNIT FACED. A defence that gets off the field makes
 *   fewer tackles. Tackle volume is, if anything, an INVERSE quality signal:
 *   you accumulate it by being on the field while the offence moves. The
 *   dataset builder already says this in its own comment ("Disruption, not
 *   volume. A bad defence racks up tackles by being on the field") - and then
 *   `tackles` was used as a positive in four of the eleven responsibility
 *   slots below, and was the single highest-correlated input to the LB and S
 *   ratings.
 *
 *   HOW MANY MEN THE TEAM ROTATED THROUGH. The sums are the whole group's, so
 *   a nine-man rotation banks more of everything than a four-man one. Measured
 *   over the shipped dataset, mean rating rose monotonically with `depth`:
 *   safeties 0.273 at one deep against 0.667 at five, defensive lines 0.266 at
 *   five against 0.713 at eleven. That is a roster-construction fact being
 *   reported as a quality verdict, and it is why units with stable, famous
 *   starters rated below units that churned.
 *
 * The consequence reached the scoreboard. A player who drafts the defenders he
 * can name gets a defence the engine scores as ordinary, so the talent gap the
 * simulation actually sees collapses toward zero and the game becomes a coin
 * flip - which is exactly the complaint that sent anyone looking here.
 *
 * So a unit is rated on DISRUPTION RATE: how much of its own workload was
 * destructive, rather than how much workload it had. `tackles` becomes the
 * DENOMINATOR - the best proxy this dataset carries for snaps faced - and
 * stops being a numerator anywhere. Both confounds cancel in the ratio,
 * because exposure and rotation size scale the top and the bottom together.
 *
 * Measured across the shipped dataset, correlation between a unit's rating and
 * its depth:
 *
 *              before   after
 *   DL          0.530    0.180
 *   LB          0.454    0.223
 *   CB          0.294   -0.233
 *   S           0.512   -0.060
 *
 * ...while the spread of ratings is essentially unchanged (p10/p50/p90 move by
 * at most 0.02 in any group), so this sharpens what the number MEANS without
 * flattening or inflating the scale the rest of the game is calibrated on.
 * scripts/verify-nfl-talent-response.mjs holds both properties.
 */
const DEFENSIVE_EXPOSURE = "tackles";

/**
 * The numerator of each rate: the destructive events themselves. Named
 * separately from the responsibilities below so one event can serve two
 * responsibilities without the responsibility list having to repeat its
 * definition.
 */
const DEFENSIVE_EVENTS = {
  sackRate: (row) => n(row.sacks),
  pressureRate: (row) => n(row.qbh),
  stuffRate: (row) => n(row.tfl),
  breakupRate: (row) => n(row.pd),
  takeawayRate: (row) => n(row.ints) + n(row.ff) + n(row.fr),
  interceptionRate: (row) => n(row.ints),
};

/**
 * How much league-average rate a thin sample is worth, in tackles.
 *
 * A ratio is unstable when its denominator is small, and dividing by a unit's
 * own tackles hands the biggest ratios to the units with the fewest - the
 * exact opposite of what the change above is for. So every rate is shrunk
 * toward its group's pooled rate by twelve tackles' worth of prior, which is
 * about one game's work for a position group. A full season's unit is barely
 * moved; a unit with almost no measured workload is reported as ordinary
 * rather than as elite, which is the honest reading of a sample that thin.
 */
const DEFENSIVE_RATE_PRIOR = 12;

/**
 * Responsibilities are equally weighted, and metrics inside a responsibility
 * are also equally weighted. The data decides the ordering rather than another
 * hidden set of balance coefficients.
 *
 * WHAT CHANGED FROM THE VOLUME VERSION, beyond the units:
 *
 *   LB lost `tackling: ["tackles"]` outright. It was a whole responsibility -
 *   a quarter of a linebacker unit's rating - whose entire content was "this
 *   group made tackles", which every linebacker group does. There is no rate
 *   form of it worth keeping; the disruptive part of a linebacker's run
 *   defence is already `stuffRate`.
 *
 *   S lost `explosivePlayPrevention: ["tfl", "tackles"]`. A safety making a
 *   lot of tackles is a front that is leaking, not a secondary that is good,
 *   so the metric was not merely noisy but pointed the wrong way. What a
 *   safety is actually for - taking the ball away and breaking up what gets
 *   thrown deep - is what remains.
 *
 *   LB and DL both carry `passRush` now. A 3-4 outside linebacker rushes the
 *   passer; splitting sacks so that only linemen were credited for them made
 *   every 3-4 front read as a poor one.
 *
 * The AXIS each responsibility answers to is declared alongside it, because
 * the engine matches offence against defence one axis at a time and needs to
 * know which of these feeds which - see DEFENSIVE_AXES below.
 */
const DEFENSIVE_RESPONSIBILITIES = {
  DL: {
    passRush: ["sackRate", "pressureRate"],
    runStop: ["stuffRate"],
  },
  LB: {
    runStop: ["stuffRate"],
    coverage: ["breakupRate"],
    takeaways: ["takeawayRate"],
    passRush: ["sackRate"],
  },
  CB: {
    coverage: ["breakupRate"],
    takeaways: ["interceptionRate"],
    runStop: ["stuffRate"],
  },
  S: {
    coverage: ["breakupRate"],
    takeaways: ["interceptionRate"],
    runStop: ["stuffRate"],
  },
};

function n(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function canonicalGroup(row) {
  const direct = String(row?.group || "").trim().toUpperCase();
  if (direct) return direct;
  const positions = Array.isArray(row?.pos) ? row.pos : [row?.pos];
  for (const pos of positions) {
    const key = String(pos || "").trim().toUpperCase();
    if (DEFENSIVE_GROUPS.has(key) || NON_DEFENSIVE_UNIT_COMPOSITES[key]) return key;
  }
  return "";
}

function eraKey(row) {
  const season = Number(row?.season);
  return Number.isFinite(season) ? String(Math.floor(season / 10) * 10) : "all";
}

/**
 * How much of a unit's measured quality to believe, from how many men were
 * actually in it. A two-man linebacker corps really is thinner than a five-man
 * one, and the sample behind its numbers is thinner too.
 *
 * A DEPTH OF ZERO IS THE THINNEST UNIT THERE IS, NOT AN AVERAGE ONE. It used
 * to return 0.85, which sits ABOVE the factor for a one-deep (0.776) and a
 * two-deep (0.832) unit - so a unit nobody could even name outranked a stable
 * one. Zero never means "no players": a unit with no members is one where
 * every man passed through too fast to clear the games threshold, which is
 * maximum churn. It is treated as one-deep, the thinnest real unit, rather
 * than as a missing value handed a plausible-looking default - the exact
 * failure CLAUDE.md names.
 *
 * Two rows in the shipped data reach it: the 2002 Jaguars special teams and
 * one safeties unit. The safeties row was already there and already scored
 * this way, which is why nothing had noticed.
 */
function depthFactor(depth) {
  const value = Number(depth);
  if (!Number.isFinite(value) || value <= 1) return Math.min(1, 0.72 + 0.056);
  return Math.min(1, 0.72 + 0.056 * value);
}

function lowerBound(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Tie-aware midrank percentile. An all-zero unavailable metric is neutral 0.5
// instead of incorrectly rating every row as elite.
function percentile(sorted, value) {
  if (!sorted || sorted.length === 0) return 0.5;
  const low = lowerBound(sorted, value);
  const high = upperBound(sorted, value);
  return (low + high) / (2 * sorted.length);
}

const clamp = (v) => {
  if (v <= 0.06) return 0.06;
  if (v < 0.92) return v;
  return 0.92 + (v - 0.92) * (0.05 / 0.08);
};

function metricNames(group) {
  const responsibilities = DEFENSIVE_RESPONSIBILITIES[group] || {};
  return [...new Set(Object.values(responsibilities).flat())];
}

function pushDistribution(target, group, era, metric, value) {
  (((target[group] ||= {})[era] ||= {})[metric] ||= []).push(value);
  (((target[group].all ||= {})[metric]) ||= []).push(value);
}

/** How many snaps this unit was on the field for, as far as the dataset can
 * say. Tackles are the proxy - see DEFENSIVE_EXPOSURE. Floored at one so a row
 * with no measured workload divides rather than throwing; the prior below is
 * what actually decides such a row. */
function defensiveExposure(row) {
  return Math.max(1, n(row?.[DEFENSIVE_EXPOSURE]));
}

/**
 * One unit's disruption rate for one event, shrunk toward its group's pooled
 * rate by DEFENSIVE_RATE_PRIOR tackles' worth of prior.
 *
 * The pooled rate is computed over the whole group rather than per era,
 * because it is a stabiliser rather than a verdict - the era comparison
 * happens afterwards, when the rate is percentiled against its own decade.
 */
function defensiveRate(row, metric, ctx) {
  const event = DEFENSIVE_EVENTS[metric];
  if (!event) return 0;
  const pooled = ctx?.defensiveRatePriors?.[canonicalGroup(row)]?.[metric];
  const base = pooled && pooled.exposure > 0 ? pooled.events / pooled.exposure : 0;
  return (
    (event(row) + DEFENSIVE_RATE_PRIOR * base) /
    (defensiveExposure(row) + DEFENSIVE_RATE_PRIOR)
  );
}

export function buildRatingContext(players, units) {
  const ctx = {
    players: {}, units: {}, efficiency: {}, defensiveMetrics: {},
    // The pooled event-per-tackle rate of each group, which every unit's own
    // rate is shrunk toward. Built in its own pass BEFORE any rate is taken,
    // because a shrinkage target computed from a subset of the rows it is used
    // on would make a unit's rating depend on iteration order.
    defensiveRatePriors: {},
  };

  for (const row of units || []) {
    const group = canonicalGroup(row);
    if (!DEFENSIVE_GROUPS.has(group) || n(row.games) < MIN_RATED_GAMES) continue;
    const priors = (ctx.defensiveRatePriors[group] ||= {});
    for (const metric of metricNames(group)) {
      const acc = (priors[metric] ||= { events: 0, exposure: 0 });
      acc.events += DEFENSIVE_EVENTS[metric]?.(row) || 0;
      acc.exposure += defensiveExposure(row);
    }
  }

  for (const row of players) {
    for (const pos of row.pos || []) {
      const composite = COMPOSITES[pos];
      if (!composite || n(row.games) < MIN_RATED_GAMES) continue;
      (ctx.players[pos] ||= []).push(composite(row));
      // Efficiency is percentiled against the same pool as production, so the
      // two halves of a rating are on one scale and can be averaged.
      const eff = EFFICIENCY[pos]?.(row);
      if (eff != null && Number.isFinite(eff)) (ctx.efficiency[pos] ||= []).push(eff);
    }
  }

  for (const row of units) {
    const group = canonicalGroup(row);
    if (n(row.games) < MIN_RATED_GAMES) continue;

    if (DEFENSIVE_GROUPS.has(group)) {
      const era = eraKey(row);
      for (const metric of metricNames(group)) {
        pushDistribution(ctx.defensiveMetrics, group, era, metric, defensiveRate(row, metric, ctx));
      }
      continue;
    }

    const composite = NON_DEFENSIVE_UNIT_COMPOSITES[group];
    if (composite) (ctx.units[group] ||= []).push(composite(row));
  }

  for (const bucket of [ctx.players, ctx.units, ctx.efficiency]) {
    for (const key of Object.keys(bucket)) bucket[key].sort((a, b) => a - b);
  }
  for (const group of Object.values(ctx.defensiveMetrics)) {
    for (const era of Object.values(group)) {
      for (const values of Object.values(era)) values.sort((a, b) => a - b);
    }
  }
  return ctx;
}

/** How much of a rating is efficiency rather than raw production.
 *
 * Quarterback leans hardest on it because passer rating already contains his
 * volume-independent quality and because his position decides more games than
 * any other. Receivers lean least: a man who is targeted twice a game at 14
 * yards a target is a decoy, not a number one. */
const EFFICIENCY_WEIGHT = { QB: 0.40, RB: 0.45, WR: 0.35, TE: 0.35 };

/** What a man nobody trusted with a starter's workload is worth. Not zero - he
 *  is an NFL player - but below the median of men who did start. */
const REPLACEMENT_LEVEL = 0.3;

export function ratePlayer(row, ctx) {
  const pos = (row.pos || []).find((p) => COMPOSITES[p]);
  if (!pos) return 0.5;

  const production = percentile(ctx.players[pos], COMPOSITES[pos](row));
  const eff = EFFICIENCY[pos]?.(row);
  const effPool = ctx.efficiency?.[pos];
  // No efficiency pool means a dataset built before these fields existed. Fall
  // back to production alone rather than to 0.5, which would flatten every
  // player onto the same rating.
  const raw =
    eff != null && Number.isFinite(eff) && effPool?.length
      ? production * (1 - EFFICIENCY_WEIGHT[pos]) + percentile(effPool, eff) * EFFICIENCY_WEIGHT[pos]
      : production;

  // Two separate reasons to distrust a line, and they pull toward DIFFERENT
  // places, which is why they are applied separately.
  //
  // Too few GAMES is ignorance: we do not know what he was, so he regresses to
  // the middle of his position.
  //
  // Too few TOUCHES is information. A back who played seven games and carried
  // 8.6 times in them was not hurt, he was BACKUP - his own team, watching him
  // every day, chose someone else. That is evidence about his quality, not an
  // absence of it, so it regresses toward REPLACEMENT rather than toward
  // average. Regressing it to the middle is what left an 8.6-carry backup
  // rating within three points of a 19-carry starter.
  const gamesTrust = Math.min(1, Math.max(0, n(row.games)) / MIN_RATED_GAMES);
  const known = 0.5 + (raw - 0.5) * gamesTrust;
  const role = roleConfidence(row, pos);
  return clamp(REPLACEMENT_LEVEL + (known - REPLACEMENT_LEVEL) * role);
}

function defensiveMetricPercentile(row, group, metric, ctx) {
  const byGroup = ctx.defensiveMetrics?.[group];
  if (!byGroup) return 0.5;
  const era = eraKey(row);
  const eraDistribution = byGroup[era]?.[metric];
  const fallback = byGroup.all?.[metric];
  const distribution = eraDistribution?.length >= 8 ? eraDistribution : fallback;
  if (!distribution?.length) return 0.5;
  return percentile(distribution, defensiveRate(row, metric, ctx));
}

/** Component scores used by both simulation grading and the visible draft
 * explanation. Exported so tests/UI can audit exactly why a group rated where
 * it did without reimplementing the formula. */
export function defensiveUnitComponents(row, ctx) {
  const group = canonicalGroup(row);
  const responsibilities = DEFENSIVE_RESPONSIBILITIES[group];
  if (!responsibilities) return null;

  const components = {};
  for (const [name, metrics] of Object.entries(responsibilities)) {
    const values = metrics.map((metric) => defensiveMetricPercentile(row, group, metric, ctx));
    components[name] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0.5;
  }
  return { group, components };
}

function rateDefensiveUnit(row, ctx) {
  const detail = defensiveUnitComponents(row, ctx);
  if (!detail) return 0.5;
  const values = Object.values(detail.components);
  const raw = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0.5;
  const trust = n(row.games) >= MIN_RATED_GAMES ? 1 : Math.max(0, n(row.games)) / MIN_RATED_GAMES;
  const withSample = 0.5 + (raw - 0.5) * trust;
  return clamp(0.5 + (withSample - 0.5) * depthFactor(row.depth));
}

/**
 * Groups whose DEPTH SAYS NOTHING ABOUT THEIR QUALITY.
 *
 * depthFactor exists because a two-man linebacker corps really is thinner than
 * a five-man one - more men means more of the job covered, and more games
 * behind the average. Neither is true of a kicking unit. A team has ONE
 * kicker; that is a complete special teams, not a thin one, and his field-goal
 * percentage over a season is a perfectly good sample from one man.
 *
 * This was hidden until the punter was taken out of the unit. `P` was in the
 * membership filter, so 656 of 830 kicking units came out exactly two deep -
 * a kicker and a punter - and the punter was quietly paying the depth
 * penalty's rent. Remove him and every kicking unit correctly becomes one
 * deep, at which point the penalty it should never have been paying is
 * suddenly visible as a 6% cut to every kicker in the game.
 *
 * OL is here for a reason this file already accepted: there are no named
 * linemen in the source at all, so its depth is hardcoded to 5 in the build.
 * Naming the exemption is better than encoding it as a magic number in the
 * data, and it is why ST could not simply be pinned to 1 the same way - that
 * would state a fact about the roster in the one place a reader looks for
 * facts about the season.
 */
const DEPTH_IS_NOT_QUALITY = new Set(["ST", "OL"]);

export function rateUnit(row, ctx) {
  const group = canonicalGroup(row);
  if (DEFENSIVE_GROUPS.has(group)) return rateDefensiveUnit(row, ctx);
  const composite = NON_DEFENSIVE_UNIT_COMPOSITES[group];
  if (!composite) return 0.5;
  const raw = percentile(ctx.units[group], composite(row));
  const trust = n(row.games) >= MIN_RATED_GAMES ? 1 : Math.max(0, n(row.games)) / MIN_RATED_GAMES;
  const withSample = 0.5 + (raw - 0.5) * trust;
  const depth = DEPTH_IS_NOT_QUALITY.has(group) ? 1 : depthFactor(row.depth);
  return clamp(0.5 + (withSample - 0.5) * depth);
}

/**
 * THE FOUR THINGS A DEFENCE DOES, and the slots that answer for each.
 *
 * A defence used to reach the simulation as ONE number: the flat mean of the
 * four drafted unit ratings (see sideRating in engine.js). That is enough to
 * say a defence is good and not enough to say what it is good AT, so every
 * matchup in the game was the same matchup. A drafted pass rush and a drafted
 * secondary were interchangeable: swapping an elite front for an elite
 * secondary changed nothing about how the opponent's offence played, only how
 * much of it happened.
 *
 * The engine now matches offence against defence one axis at a time, so the
 * pick you spent is felt where you spent it - a front that gets home shows up
 * as sacks and stalled drives, a secondary that covers shows up as fewer
 * explosive plays and more takeaways.
 *
 * WEIGHTS ARE AUTHORED, and say so. There is no measurement in this dataset
 * that can settle how much of a team's pass rush is its linebackers, so these
 * are a football reading rather than a solved result - the same status as
 * OFFENSE_WEIGHTS in constants.js. What they must not be is FLAT: a flat set
 * would rebuild the single generic rating this exists to replace. Each axis
 * sums to 1 so an all-average defence rates 0.5 on every axis, which is what
 * keeps EDGE_BASELINE meaningful.
 */
export const DEFENSIVE_AXES = ["passRush", "coverage", "runStop", "takeaways"];

export const DEFENSIVE_AXIS_WEIGHTS = {
  // Linemen rush the passer; a 3-4 outside linebacker does too, which is why
  // LB carries a real share rather than a token one.
  passRush: { DL: 0.58, LB: 0.27, S: 0.08, CB: 0.07 },
  // Corners first, safeties close behind, linebackers for what is thrown
  // underneath. The line's share is not zero because pressure IS coverage help.
  coverage: { CB: 0.40, S: 0.33, LB: 0.20, DL: 0.07 },
  // The front seven, with the secondary as the last line.
  runStop: { DL: 0.40, LB: 0.38, S: 0.15, CB: 0.07 },
  // Takeaways are the most evenly shared of the four: anyone can strip a ball,
  // and interceptions come from coverage and pressure together.
  takeaways: { CB: 0.32, S: 0.30, LB: 0.23, DL: 0.15 },
};

/**
 * One unit's strength on one axis, on the same 0..1 scale as its overall
 * rating - same sample trust, same depth factor, same clamp - so an axis and a
 * rating can be compared and averaged without one of them being on a different
 * scale.
 *
 * A unit with no responsibility on this axis falls back to its OVERALL rating
 * rather than to 0.5. A defensive line has no coverage responsibility in the
 * table above, but a great line is not an average coverage unit: it makes the
 * throw harder, and the fallback is the honest way to say that with the data
 * available. Falling back to 0.5 would have made half of every axis a constant.
 */
export function defensiveUnitAxis(entry, axis, ctx) {
  if (!entry) return 0;
  if (!isUnit(entry)) return ratePlayer(entry, ctx);
  const detail = defensiveUnitComponents(entry, ctx);
  const raw = detail?.components?.[axis];
  if (raw == null) return rateUnit(entry, ctx);
  const trust = n(entry.games) >= MIN_RATED_GAMES ? 1 : Math.max(0, n(entry.games)) / MIN_RATED_GAMES;
  const withSample = 0.5 + (raw - 0.5) * trust;
  return clamp(0.5 + (withSample - 0.5) * depthFactor(entry.depth));
}

/**
 * A whole roster's strength on one axis.
 *
 * Quick Play drafts ONE `DEF` unit standing in for all four slots, exactly as
 * sideRating resolves it, so the same pick answers every axis there. That is
 * the roster shape being honest about itself rather than a special case: one
 * pick really is the whole defence in that mode.
 *
 * A forfeited or unfilled slot rates REPLACEMENT_LEVEL rather than 0.5. An
 * average stand-in for a pick nobody made is the silent-failure pattern
 * CLAUDE.md names: it makes skipping a defensive pick free.
 */
export function defensiveAxisStrength(roster, axis, ctx, forfeits) {
  const weights = DEFENSIVE_AXIS_WEIGHTS[axis];
  if (!weights) return 0.5;
  let total = 0;
  for (const [slot, weight] of Object.entries(weights)) {
    const entry = roster?.[slot] ?? roster?.DEF;
    const rated = entry ? defensiveUnitAxis(entry, axis, ctx) : REPLACEMENT_LEVEL;
    total += weight * (forfeits?.includes(slot) ? rated * (1 - FORFEIT_PENALTY) : rated);
  }
  return total;
}

export const isUnit = (entry) => typeof entry?.group === "string";

/**
 * What to call a unit when the team is already on screen.
 *
 * A unit's `name` is its team plus its group - "Baltimore Ravens Offensive
 * Line" - and everywhere a drafted unit is shown, the team is shown next to
 * it already: the draft board sits under a squad banner reading "Ravens ·
 * 2020s", the roster panel prints "2020 Ravens" on its own line, the box
 * score carries "Baltimore Ravens 2020" under the name. So the full name says
 * the team twice and pushes the only distinguishing part - which unit this is
 * - off the end of a phone-width row.
 *
 * Stripping the prefix rather than rebuilding the label from `group`, because
 * `group` is a code ("OL", "S") and the tail of the name is already the
 * English the dataset chose ("Offensive Line", "Safeties"). Falls back to the
 * whole name if it does not start with the team, so a row that does not follow
 * the convention is shown as it is rather than silently truncated.
 */
export function unitLabel(entry) {
  const name = String(entry?.name || "");
  const team = String(entry?.team || "");
  if (!team || !name.startsWith(team)) return name;
  return name.slice(team.length).trim() || name;
}

export function rateEntry(entry, ctx) {
  if (!entry) return 0;
  return isUnit(entry) ? rateUnit(entry, ctx) : ratePlayer(entry, ctx);
}
