// Downloads the raw nflverse season files the NFL dataset is built from.
//
// The NBA equivalent of this step was manual: someone exported a CSV per
// season from Basketball-Reference by hand. Football can't work that way -
// it needs three files per season (offence, defence, kicking) across 25
// seasons, which is 75 clicks and a guarantee that one gets missed.
//
// nflverse publishes them as GitHub release assets, which are plain HTTP and
// need no API token:
//
//   https://github.com/nflverse/nflverse-data/releases/download/player_stats/
//     player_stats_YYYY.csv          offence, per player per week
//     player_stats_def_YYYY.csv      defence
//     player_stats_kicking_YYYY.csv  kicking and punting
//
// Output lands in tools/seasons-nfl/, which is gitignored exactly like
// tools/seasons/ - raw source data is an input to the build, not something the
// repo carries. Re-running is safe and skips files already downloaded.
//
// Usage:  node tools/fetch-nfl-seasons.mjs [--from 2000] [--to 2024] [--force]

import { mkdirSync, existsSync, writeFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "seasons-nfl");
const BASE = "https://github.com/nflverse/nflverse-data/releases/download/player_stats";

// 2000 rather than 1999, because the eras are plain decades and a single
// orphan 1999 season belongs to none of them. nflverse has nothing earlier -
// player_stats_1985.csv is a 404 - which is why the era brackets are
// 2000s/2010s/2020s rather than the rule-change ones docs/nfl-plan.md
// originally proposed.
const DEFAULT_FROM = 2000;
const DEFAULT_TO = new Date().getFullYear() - 1;

const KINDS = ["", "def_", "kicking_"];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

const from = arg("from", DEFAULT_FROM);
const to = arg("to", DEFAULT_TO);
const force = process.argv.includes("--force");

mkdirSync(OUT_DIR, { recursive: true });

/** A season that doesn't exist yet (the current one mid-year, say) 404s rather
 * than failing the run - the dataset is simply built from what exists. */
async function fetchOne(year, kind) {
  const name = `player_stats_${kind}${year}.csv`;
  const dest = join(OUT_DIR, name);

  if (!force && existsSync(dest) && statSync(dest).size > 0) return { name, status: "cached" };

  const res = await fetch(`${BASE}/${name}`);
  if (res.status === 404) return { name, status: "missing" };
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);

  const text = await res.text();
  writeFileSync(dest, text);
  return { name, status: "downloaded", bytes: text.length };
}

const summary = { downloaded: 0, cached: 0, missing: 0, bytes: 0 };

for (let year = from; year <= to; year++) {
  for (const kind of KINDS) {
    const r = await fetchOne(year, kind);
    summary[r.status] += 1;
    summary.bytes += r.bytes || 0;
    if (r.status === "missing") console.warn(`  missing: ${r.name}`);
  }
  process.stdout.write(`\r  ${year}…`);
}

console.log(
  `\nseasons ${from}-${to}: ${summary.downloaded} downloaded, ${summary.cached} cached, ` +
    `${summary.missing} missing (${(summary.bytes / 1e6).toFixed(1)} MB fetched)`
);
console.log(`  -> ${OUT_DIR}`);
