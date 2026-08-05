// Builds data/nba-players.js from tools/seasons/NBAdata1980-2025.xlsx.
//
// Replaces tools/build-data-from-csv.mjs, which read one CSV per season from a
// directory that no longer exists (the exports were cut from the repo, which
// left the dataset unreproducible - a file nobody could fix or regenerate).
// The workbook is one file with one sheet per season, and it is committed, so
// the dataset is rebuildable again.
//
// WHAT CHANGED, AND WHY IT MATTERS
//
// The old build aggregated each player down to ONE row per team-decade:
// "Luka Doncic, Mavericks, 2020s" with his decade averages. The draft now asks
// which YEAR - you roll the Mavs 2020s, name Doncic, then pick which Doncic -
// so a decade average is the one thing that cannot answer the question. It
// describes a blended player who never took the floor.
//
// So rows are per player per team per SEASON. A player traded mid-season gets
// a row per team, which is correct: he really did play for both.
//
// Two consequences worth stating plainly:
//
//   1. The dataset gets much bigger - every season is a row rather than every
//      decade. Squad trimming keeps it bounded (see SQUAD_PLAYERS).
//   2. Per-season numbers are more extreme than decade averages, because a
//      peak year is no longer smoothed against the decline around it. The
//      simulation is therefore being fed a wider spread than it was balanced
//      against, and tools/calibrate-*.mjs has to be re-run before this ships.

import { writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readWorkbook } from "./read-xlsx.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, "seasons", "NBAdata1980-2025.xlsx");
const OUT = join(here, "..", "data", "nba-players.js");

/** Games in a season before it is draftable. A ten-game stint is noise, and a
 * player who barely appeared shouldn't turn up on a squad board as though he
 * defined that team's year. */
const MIN_GAMES = 20;

/** How many distinct players each team-decade squad offers. The draft board
 * has to be readable and the roll has to feel like a team, not a franchise
 * encyclopedia - the old build used the same idea with a flat 16 rows. */
const SQUAD_PLAYERS = 16;

function teamName(code, startYear) {
  const eighties = startYear < 1990;
  const map = {
    ATL: "Atlanta Hawks", BOS: "Boston Celtics", BRK: "Brooklyn Nets",
    BKN: "Brooklyn Nets", NJN: "New Jersey Nets", CHH: "Charlotte Hornets",
    CHA: startYear >= 2014 ? "Charlotte Hornets" : "Charlotte Bobcats",
    CHO: "Charlotte Hornets", CHI: "Chicago Bulls", CLE: "Cleveland Cavaliers",
    DAL: "Dallas Mavericks", DEN: "Denver Nuggets", DET: "Detroit Pistons",
    GSW: "Golden State Warriors", HOU: "Houston Rockets", IND: "Indiana Pacers",
    LAC: "LA Clippers", SDC: "LA Clippers", LAL: "LA Lakers",
    MEM: "Memphis Grizzlies", VAN: "Vancouver Grizzlies", MIA: "Miami Heat",
    MIL: "Milwaukee Bucks", MIN: "Minnesota Timberwolves",
    NOH: "New Orleans Hornets", NOK: "New Orleans Hornets",
    NOP: "New Orleans Pelicans", NYK: "New York Knicks",
    // The franchise relocated in 2008. Squads are named for where the team
    // actually played that season rather than carrying a combined name, so a
    // 2000s Sonics squad reads as the Sonics it was. banners.js aliases both
    // names onto one franchise, so team trophies still combine.
    SEA: "Seattle SuperSonics", OKC: "Oklahoma City Thunder",
    ORL: "Orlando Magic", PHI: "Philadelphia 76ers", PHO: "Phoenix Suns",
    PHX: "Phoenix Suns", POR: "Portland Trail Blazers", SAC: "Sacramento Kings",
    KCK: "Sacramento Kings", SAS: "San Antonio Spurs", TOR: "Toronto Raptors",
    UTA: "Utah Jazz", WSB: "Washington Bullets",
    WAS: eighties || startYear < 1997 ? "Washington Bullets" : "Washington Wizards",
  };
  return map[code] || null;
}

const decadeOf = (startYear) => `${Math.floor(startYear / 10) * 10}s`;

/** Normalizes Basketball Reference position strings to the game's slots.
 * BR uses things like "PG", "SG-SF", "C". */
function positions(pos) {
  const parts = String(pos || "")
    .split("-")
    .map((p) => p.trim().toUpperCase())
    .filter((p) => ["PG", "SG", "SF", "PF", "C"].includes(p));
  return parts.length > 0 ? parts.slice(0, 2) : ["SF"];
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

if (!existsSync(SOURCE)) {
  console.error(`Missing ${SOURCE}`);
  process.exit(1);
}

const sheets = readWorkbook(SOURCE);
const rows = [];

for (const sheet of sheets) {
  // Sheet names are the season's END year, matching Basketball Reference's own
  // convention: the "2025" sheet is the 2024-25 season.
  const endYear = parseInt(sheet.name.match(/(\d{4})/)?.[1] ?? "", 10);
  if (!Number.isFinite(endYear)) continue;
  const startYear = endYear - 1;

  const header = sheet.rows[0] || [];
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  const at = (cells, name) => cells[col[name]] ?? "";

  for (const cells of sheet.rows.slice(1)) {
    const player = at(cells, "Player");
    if (!player || player === "Player") continue;

    // Basketball Reference emits a combined "2TM"/"3TM" row for a traded
    // player alongside his per-team rows. Keeping it would invent a team that
    // does not exist and double-count the player.
    const code = at(cells, "Team") || at(cells, "Tm");
    if (!code || /^\dTM$/i.test(code)) continue;

    const team = teamName(code, startYear);
    if (!team) continue;

    const games = num(at(cells, "G"));
    if (games < MIN_GAMES) continue;

    const fga = num(at(cells, "FGA"));
    const tpa = num(at(cells, "3PA"));
    const fta = num(at(cells, "FTA"));

    rows.push({
      name: player,
      team,
      // Kept so the squad roll (team + decade) still works exactly as before.
      decade: decadeOf(startYear),
      // The season a pick actually resolves to. Stored as the END year, which
      // is how a basketball season is spoken about - "the 2016 Warriors".
      season: endYear,
      pos: positions(at(cells, "Pos")),
      games,
      ppg: r1(num(at(cells, "PTS"))),
      rpg: r1(num(at(cells, "TRB"))),
      apg: r1(num(at(cells, "AST"))),
      spg: r1(num(at(cells, "STL"))),
      bpg: r1(num(at(cells, "BLK"))),
      tov: r1(num(at(cells, "TOV"))),
      fga: r1(fga),
      // No attempts means no percentage. Writing 0 rather than a stray value is
      // what guarantees a non-shooter can never produce a three downstream.
      fgp: fga > 0 ? r3(num(at(cells, "FG%"))) : 0,
      tpa: r1(tpa),
      tpp: tpa > 0 ? r3(num(at(cells, "3P%"))) : 0,
      fta: r1(fta),
      ftp: fta > 0 ? r3(num(at(cells, "FT%"))) : 0,
    });
  }
}

// ---------------------------------------------------------------------------
// Trim each squad to its most-used players
// ---------------------------------------------------------------------------
// Trimming is by PLAYER, not by row: once a player is on the squad every one
// of his seasons with that team comes with him, because those seasons are
// exactly what the year pick offers. Dropping a season would silently remove a
// choice the player expects to see.

const bySquad = new Map();
for (const row of rows) {
  const key = `${row.team}|${row.decade}`;
  if (!bySquad.has(key)) bySquad.set(key, new Map());
  const players = bySquad.get(key);
  if (!players.has(row.name)) players.set(row.name, []);
  players.get(row.name).push(row);
}

const kept = [];
for (const players of bySquad.values()) {
  const ranked = [...players.values()].sort(
    (a, b) =>
      b.reduce((n, r) => n + r.games, 0) - a.reduce((n, r) => n + r.games, 0)
  );
  for (const seasons of ranked.slice(0, SQUAD_PLAYERS)) kept.push(...seasons);
}

kept.sort(
  (a, b) =>
    (a.team + a.decade).localeCompare(b.team + b.decade) ||
    a.name.localeCompare(b.name) ||
    a.season - b.season
);

const squads = new Set(kept.map((p) => `${p.team}|${p.decade}`));
const names = new Set(kept.map((p) => `${p.team}|${p.decade}|${p.name}`));

const lines = [];
let current = null;
for (const p of kept) {
  const squad = `${p.team} ${p.decade}`;
  if (squad !== current) {
    lines.push(`\n  // --- ${squad} ---`);
    current = squad;
  }
  lines.push(`  ${JSON.stringify(p)},`);
}

writeFileSync(
  OUT,
  `// Ball Knowledge - player/squad data\n` +
    `// ${kept.length} player-seasons, ${names.size} player-squad entries, ${squads.size} squads\n` +
    `// Generated by tools/build-nba-data.mjs from tools/seasons/NBAdata1980-2025.xlsx\n` +
    `// (Basketball Reference per-game exports, one sheet per season).\n` +
    `// Do not hand-edit: re-run the script instead.\n` +
    `\nexport const PLAYERS = [${lines.join("\n")}\n];\n`
);

console.log(`${kept.length} player-seasons across ${squads.size} squads (${names.size} draftable entries)`);
console.log(`  -> ${OUT}`);
