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
//   https://github.com/nflverse/nflverse-data/releases/download/stats_player/
//     stats_player_week_YYYY.csv     one file: offence, defence and kicking
//
// PLUS ONE FILE THAT IS NOT A SEASON. Points allowed is a property of a game,
// not of a player, so it is not in those files at all and comes from nflverse's
// other repository as a single games.csv covering every year. See fetchGames.
//
// MIGRATED from the older `player_stats` release, which published three files
// per season (player_stats_, player_stats_def_, player_stats_kicking_). That
// release is frozen: it serves 2000-2024 and has no 2025, so a season could no
// longer be added without moving. The replacement carries the full 2000-2025
// history in a single 150-column file per season, so the whole pipeline moved
// rather than special-casing one year against a second source.
//
// Column renames that came with it are handled in tools/build-nfl-data.mjs:
// interceptions -> passing_interceptions, sacks -> sacks_suffered,
// recent_team -> team, def_tackles -> def_tackles_solo + def_tackle_assists,
// def_fumble_recovery_opp -> fumble_recovery_opp.
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
const BASE = "https://github.com/nflverse/nflverse-data/releases/download/stats_player";

// Final scores, from nflverse's OTHER repository. The weekly stats releases
// carry players; this carries games, and there is no release asset equivalent -
// the only published location is the file in the repo.
const GAMES_URL = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";
const GAMES_FILE = "games.csv";

// 2000 rather than 1999, because the eras are plain decades and a single
// orphan 1999 season belongs to none of them. nflverse has nothing earlier -
// player_stats_1985.csv is a 404 - which is why the era brackets are
// 2000s/2010s/2020s rather than the rule-change ones docs/nfl-plan.md
// originally proposed.
const DEFAULT_FROM = 2000;
// An NFL season is named for the year it STARTS but finishes the following
// February, so the most recent complete season is last calendar year's. A
// season still in progress simply 404s and is skipped, so this errs safe.
const DEFAULT_TO = new Date().getFullYear() - 1;

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
async function fetchOne(year) {
  const name = `stats_player_week_${year}.csv`;
  const dest = join(OUT_DIR, name);

  if (!force && existsSync(dest) && statSync(dest).size > 0) return { name, status: "cached" };

  const res = await fetch(`${BASE}/${name}`);
  if (res.status === 404) return { name, status: "missing" };
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);

  const text = await res.text();
  writeFileSync(dest, text);
  return { name, status: "downloaded", bytes: text.length };
}

/**
 * Final scores for every game, which the per-player files cannot give.
 *
 * Points allowed is the number every fan judges a defence by, and it is a
 * property of a GAME rather than of any player, so it lives in a different
 * nflverse repository from the weekly stats: one file covering every season
 * rather than one file per season.
 *
 * Reconstructing it from the player files was the alternative and was
 * rejected. The scoring columns are all there - touchdowns, field goals,
 * extra points, two-point conversions, safeties, defensive and return
 * touchdowns - but summing them means re-deriving a number the league already
 * publishes, and being wrong about any one of those columns produces a plausible
 * score rather than an error. See "Never fabricate statistics" in CLAUDE.md.
 */
async function fetchGames() {
  const dest = join(OUT_DIR, GAMES_FILE);
  if (!force && existsSync(dest) && statSync(dest).size > 0) return { name: GAMES_FILE, status: "cached" };

  const res = await fetch(GAMES_URL);
  if (!res.ok) throw new Error(`${GAMES_FILE}: HTTP ${res.status}`);

  const text = await res.text();
  writeFileSync(dest, text);
  return { name: GAMES_FILE, status: "downloaded", bytes: text.length };
}

const summary = { downloaded: 0, cached: 0, missing: 0, bytes: 0 };

for (let year = from; year <= to; year++) {
  const r = await fetchOne(year);
  summary[r.status] += 1;
  summary.bytes += r.bytes || 0;
  if (r.status === "missing") console.warn(`  missing: ${r.name}`);
  process.stdout.write(`\r  ${year}…`);
}

const games = await fetchGames();
summary[games.status] += 1;
summary.bytes += games.bytes || 0;

console.log(
  `\nseasons ${from}-${to}: ${summary.downloaded} downloaded, ${summary.cached} cached, ` +
    `${summary.missing} missing (${(summary.bytes / 1e6).toFixed(1)} MB fetched)`
);
console.log(`  ${GAMES_FILE}: ${games.status}`);
console.log(`  -> ${OUT_DIR}`);
