// Turning NFL player and unit rows into comparable 0..1 ratings.
// Defensive units are normalized metric-by-metric within position group and
// era so a scheme choice, season length, or missing optional field cannot turn
// a legitimate defense into an automatic F.

import { MIN_RATED_GAMES } from "./constants.js";

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
  OL: (r) => n(r.rating) - 6 * n(r.sacks_allowed) + 8 * n(r.ypc),
  ST: (r) => 100 * n(r.fg_pct) + 30 * n(r.pat_pct) + 3 * n(r.fg_att),
};

const DEFENSIVE_GROUPS = new Set(["DL", "LB", "CB", "S"]);

// Responsibilities are equally weighted. Metrics inside a responsibility are
// also equally weighted. The data therefore decides the ordering rather than
// another hidden set of balance coefficients.
const DEFENSIVE_RESPONSIBILITIES = {
  DL: {
    passRush: ["sacks", "qbh"],
    runDefense: ["tfl", "tackles"],
  },
  LB: {
    runDefense: ["tfl", "tackles"],
    tackling: ["tackles"],
    shortCoverage: ["pd", "ints"],
    takeaways: ["ff", "fr"],
  },
  CB: {
    coverage: ["pd"],
    interceptions: ["ints"],
  },
  S: {
    deepCoverage: ["pd"],
    explosivePlayPrevention: ["tfl", "tackles"],
    interceptions: ["ints"],
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

function depthFactor(depth) {
  const value = Number(depth);
  if (!Number.isFinite(value) || value <= 0) return 0.85;
  return Math.min(1, 0.72 + 0.056 * value);
}

function perGame(row, metric) {
  const games = Math.max(1, n(row?.games));
  return n(row?.[metric]) / games;
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

export function buildRatingContext(players, units) {
  const ctx = { players: {}, units: {}, efficiency: {}, defensiveMetrics: {} };

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
        pushDistribution(ctx.defensiveMetrics, group, era, metric, perGame(row, metric));
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
  return percentile(distribution, perGame(row, metric));
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

export function rateUnit(row, ctx) {
  const group = canonicalGroup(row);
  if (DEFENSIVE_GROUPS.has(group)) return rateDefensiveUnit(row, ctx);
  const composite = NON_DEFENSIVE_UNIT_COMPOSITES[group];
  if (!composite) return 0.5;
  const raw = percentile(ctx.units[group], composite(row));
  const trust = n(row.games) >= MIN_RATED_GAMES ? 1 : Math.max(0, n(row.games)) / MIN_RATED_GAMES;
  const withSample = 0.5 + (raw - 0.5) * trust;
  return clamp(0.5 + (withSample - 0.5) * depthFactor(row.depth));
}

export const isUnit = (entry) => typeof entry?.group === "string";

export function rateEntry(entry, ctx) {
  if (!entry) return 0;
  return isUnit(entry) ? rateUnit(entry, ctx) : ratePlayer(entry, ctx);
}
