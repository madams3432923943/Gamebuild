// Turning NFL player and unit rows into comparable 0..1 ratings.
// Defensive units are normalized metric-by-metric within position group and
// era so a scheme choice, season length, or missing optional field cannot turn
// a legitimate defense into an automatic F.

import { MIN_RATED_GAMES } from "./constants.js";

const COMPOSITES = {
  QB: (r) => n(r.pass_yds) + 22 * n(r.pass_td) - 26 * n(r.ints) + 0.9 * n(r.rush_yds) + 14 * n(r.rush_td),
  RB: (r) => n(r.rush_yds) + 18 * n(r.rush_td) + 0.7 * n(r.rec_yds) + 14 * n(r.rec_td) - 20 * n(r.fum),
  WR: (r) => n(r.rec_yds) + 20 * n(r.rec_td) + 2.5 * n(r.rec) - 18 * n(r.fum),
  TE: (r) => n(r.rec_yds) + 20 * n(r.rec_td) + 2.5 * n(r.rec) - 18 * n(r.fum),
};

const NON_DEFENSIVE_UNIT_COMPOSITES = {
  OL: (r) => n(r.rating) - 6 * n(r.sacks_allowed) + 8 * n(r.ypc),
  ST: (r) => 100 * n(r.fg_pct) + 30 * n(r.pat_pct) + 3 * n(r.fg_att),
};

const DEFENSIVE_GROUPS = new Set(["DL", "LB", "CB", "S"]);
const DEFENSIVE_RESPONSIBILITIES = {
  DL: { passRush: ["sacks", "qbh"], runDefense: ["tfl", "tackles"] },
  LB: { runDefense: ["tfl", "tackles"], tackling: ["tackles"], shortCoverage: ["pd", "ints"], takeaways: ["ff", "fr"] },
  CB: { coverage: ["pd"], interceptions: ["ints"] },
  S: { deepCoverage: ["pd"], explosivePlayPrevention: ["tfl", "tackles"], interceptions: ["ints"] },
};

function n(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
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
function eraKey(row) { const season = Number(row?.season); return Number.isFinite(season) ? String(Math.floor(season / 10) * 10) : "all"; }
function depthFactor(depth) { const value = Number(depth); if (!Number.isFinite(value) || value <= 0) return 0.85; return Math.min(1, 0.72 + 0.056 * value); }
function perGame(row, metric) { return n(row?.[metric]) / Math.max(1, n(row?.games)); }
function lowerBound(sorted, value) { let lo = 0, hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < value) lo = mid + 1; else hi = mid; } return lo; }
function upperBound(sorted, value) { let lo = 0, hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= value) lo = mid + 1; else hi = mid; } return lo; }
function percentile(sorted, value) { if (!sorted || sorted.length === 0) return 0.5; const low = lowerBound(sorted, value); const high = upperBound(sorted, value); return (low + high) / (2 * sorted.length); }
const clamp = (v) => v <= 0.06 ? 0.06 : v < 0.92 ? v : 0.92 + (v - 0.92) * (0.05 / 0.08);
function metricNames(group) { return [...new Set(Object.values(DEFENSIVE_RESPONSIBILITIES[group] || {}).flat())]; }
function pushDistribution(target, group, era, metric, value) {
  (((target[group] ||= {})[era] ||= {})[metric] ||= []).push(value);
  (((target[group].all ||= {})[metric]) ||= []).push(value);
}

export function buildRatingContext(players, units) {
  const ctx = { players: {}, units: {}, defensiveMetrics: {} };
  for (const row of players) {
    for (const pos of row.pos || []) {
      const composite = COMPOSITES[pos];
      if (!composite || n(row.games) < MIN_RATED_GAMES) continue;
      (ctx.players[pos] ||= []).push(composite(row));
    }
  }
  for (const row of units) {
    const group = canonicalGroup(row);
    if (n(row.games) < MIN_RATED_GAMES) continue;
    if (DEFENSIVE_GROUPS.has(group)) {
      const era = eraKey(row);
      for (const metric of metricNames(group)) pushDistribution(ctx.defensiveMetrics, group, era, metric, perGame(row, metric));
      continue;
    }
    const composite = NON_DEFENSIVE_UNIT_COMPOSITES[group];
    if (composite) (ctx.units[group] ||= []).push(composite(row));
  }
  for (const bucket of [ctx.players, ctx.units]) for (const key of Object.keys(bucket)) bucket[key].sort((a, b) => a - b);
  for (const group of Object.values(ctx.defensiveMetrics)) for (const era of Object.values(group)) for (const values of Object.values(era)) values.sort((a, b) => a - b);
  return ctx;
}

export function ratePlayer(row, ctx) {
  const pos = (row.pos || []).find((p) => COMPOSITES[p]);
  if (!pos) return 0.5;
  const raw = percentile(ctx.players[pos], COMPOSITES[pos](row));
  if (n(row.games) >= MIN_RATED_GAMES) return clamp(raw);
  const trust = Math.max(0, n(row.games)) / MIN_RATED_GAMES;
  return clamp(0.5 + (raw - 0.5) * trust);
}

function defensiveMetricPercentile(row, group, metric, ctx) {
  const byGroup = ctx.defensiveMetrics?.[group];
  if (!byGroup) return 0.5;
  const eraDistribution = byGroup[eraKey(row)]?.[metric];
  const fallback = byGroup.all?.[metric];
  const distribution = eraDistribution?.length >= 8 ? eraDistribution : fallback;
  return distribution?.length ? percentile(distribution, perGame(row, metric)) : 0.5;
}

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
export function rateEntry(entry, ctx) { if (!entry) return 0; return isUnit(entry) ? rateUnit(entry, ctx) : ratePlayer(entry, ctx); }
