#!/usr/bin/env node

import { buildRatingContext, rateUnit, defensiveUnitComponents } from "../js/sports/nfl/units.js";
import { loadDataset } from "../data/load.mjs";

const NFL_UNITS = await loadDataset("nfl-units");

const GROUPS = ["DL", "LB", "CB", "S"];
const defensive = NFL_UNITS.filter((row) => GROUPS.includes(String(row.group || "").toUpperCase()));
const ctx = buildRatingContext([], NFL_UNITS);
const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, ok: !!ok, detail });

for (const group of GROUPS) {
  const rows = defensive.filter((row) => String(row.group).toUpperCase() === group);
  const ratings = rows.map((row) => rateUnit(row, ctx)).filter(Number.isFinite).sort((a, b) => a - b);
  const at = (p) => ratings[Math.min(ratings.length - 1, Math.max(0, Math.floor((ratings.length - 1) * p)))];
  check(`${group} ratings are finite`, ratings.length === rows.length && ratings.length > 0, `${ratings.length}/${rows.length}`);
  check(`${group} separates weak, average and elite units`, at(0.15) < at(0.5) && at(0.5) < at(0.85), `${Math.round(at(0.15)*100)} / ${Math.round(at(0.5)*100)} / ${Math.round(at(0.85)*100)}`);

  const sample = rows.find((row) => defensiveUnitComponents(row, ctx));
  const detail = sample ? defensiveUnitComponents(sample, ctx) : null;
  check(`${group} exposes auditable responsibility components`, !!detail && Object.values(detail.components).every(Number.isFinite), detail ? Object.entries(detail.components).map(([k,v]) => `${k}=${Math.round(v*100)}`).join(" ") : "missing");
}

const allFinite = defensive.every((row) => Number.isFinite(rateUnit(row, ctx)));
check("Every generated defensive unit receives a finite rating", allFinite, `${defensive.length} units audited`);

// All-zero optional-era metrics must be neutral, not elite. This reproduces
// the <= percentile failure mode that previously made unavailable metrics look
// like 100th-percentile production.
const zeroRows = Array.from({ length: 12 }, (_, i) => ({
  team: `Z${i}`,
  season: 1990 + (i % 9),
  group: "DL",
  games: 16,
  depth: 5,
  sacks: 0,
  qbh: 0,
  tfl: 0,
  tackles: 0,
  ff: 0,
  fr: 0,
  ints: 0,
  pd: 0,
}));
const zeroCtx = buildRatingContext([], zeroRows);
const zeroRating = rateUnit(zeroRows[0], zeroCtx);
check("Unavailable tied-zero metrics are neutral rather than elite", Math.abs(zeroRating - 0.5) < 0.001, `rating=${zeroRating.toFixed(3)}`);

let failed = 0;
for (const item of checks) {
  const tag = item.ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${item.title}${item.detail ? ` — ${item.detail}` : ""}`);
  if (!item.ok) failed++;
}
console.log(`\npassed ${checks.length - failed}  failed ${failed}`);
process.exit(failed ? 1 : 0);
