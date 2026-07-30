// Converts Basketball Reference per-season CSVs into js/data.js.
//
// Run: node tools/build-data-from-csv.mjs
// See tools/README.md for where to get the CSVs.
//
// The output shape is identical to what the game already consumes, so this is
// a drop-in replacement for the model-recalled data - nothing downstream
// changes, the numbers just become real.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const SEASON_DIR = join(here, "seasons");
const OUT = join(here, "..", "js", "data.js");

// How many players per team-decade squad to keep, ranked by games played then
// minutes-ish production. Matches what the game expects.
const SQUAD_SIZE = 16;
// Ignore cameo seasons - someone who played 8 games for a team shouldn't
// represent them.
const MIN_GAMES = 15;

/** Basketball Reference team codes to the franchise name for that era. Codes
 * that changed meaning over time are resolved by season year. */
function teamName(code, startYear) {
  const eighties = startYear < 1990;
  const map = {
    ATL: "Atlanta Hawks",
    BOS: "Boston Celtics",
    BRK: "Brooklyn Nets",
    NJN: "New Jersey Nets",
    CHH: "Charlotte Hornets",
    CHA: startYear >= 2014 ? "Charlotte Hornets" : "Charlotte Bobcats",
    CHO: "Charlotte Hornets",
    CHI: "Chicago Bulls",
    CLE: "Cleveland Cavaliers",
    DAL: "Dallas Mavericks",
    DEN: "Denver Nuggets",
    DET: "Detroit Pistons",
    GSW: "Golden State Warriors",
    HOU: "Houston Rockets",
    IND: "Indiana Pacers",
    LAC: "LA Clippers",
    SDC: "LA Clippers",
    LAL: "LA Lakers",
    MEM: "Memphis Grizzlies",
    VAN: "Vancouver Grizzlies",
    MIA: "Miami Heat",
    MIL: "Milwaukee Bucks",
    MIN: "Minnesota Timberwolves",
    NOH: "New Orleans Hornets",
    NOK: "New Orleans Hornets",
    NOP: "New Orleans Pelicans",
    NYK: "New York Knicks",
    // The franchise relocated in 2008. Squads are named for where the team
    // actually played that season rather than carrying a combined name, so a
    // 2000s Sonics squad reads as the Sonics it was. banners.js aliases both
    // names onto one franchise, so team trophies still combine.
    SEA: "Seattle SuperSonics",
    OKC: "Oklahoma City Thunder",
    ORL: "Orlando Magic",
    PHI: "Philadelphia 76ers",
    PHO: "Phoenix Suns",
    PHX: "Phoenix Suns",
    POR: "Portland Trail Blazers",
    SAC: "Sacramento Kings",
    KCK: "Sacramento Kings",
    SAS: "San Antonio Spurs",
    TOR: "Toronto Raptors",
    UTA: "Utah Jazz",
    WSB: "Washington Bullets",
    WAS: eighties || startYear < 1997 ? "Washington Bullets" : "Washington Wizards",
  };
  return map[code] || null;
}

function decadeOf(startYear) {
  return `${Math.floor(startYear / 10) * 10}s`;
}

/** Normalizes Basketball Reference position strings to the game's slots.
 * BR uses things like "PG", "SG-SF", "C". */
function positions(pos) {
  const parts = String(pos || "")
    .split("-")
    .map((p) => p.trim().toUpperCase())
    .filter((p) => ["PG", "SG", "SF", "PF", "C"].includes(p));
  return parts.length > 0 ? parts.slice(0, 2) : ["SF"];
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i]));
    return row;
  });
}

/** Minimal CSV splitter that respects quoted fields - player names contain
 * commas in some exports (e.g. suffixes). */
function splitLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

function seasonStartYear(file, row) {
  if (row.Season) {
    const m = String(row.Season).match(/^(\d{4})/);
    if (m) return parseInt(m[1], 10);
  }
  const m = file.match(/(\d{4})/);
  // NBA_1997.csv is the 1996-97 season, so the file year is the END year.
  return m ? parseInt(m[1], 10) - 1 : null;
}

if (!existsSync(SEASON_DIR)) {
  console.error(`No CSVs found. Create ${SEASON_DIR}/ and see tools/README.md.`);
  process.exit(1);
}

const files = readdirSync(SEASON_DIR).filter((f) => f.toLowerCase().endsWith(".csv"));
if (files.length === 0) {
  console.error(`No .csv files in ${SEASON_DIR}. See tools/README.md.`);
  process.exit(1);
}

// key: "Player|Team|Decade" -> accumulated, games-weighted
const acc = new Map();

for (const file of files) {
  const rows = parseCsv(readFileSync(join(SEASON_DIR, file), "utf8"));
  for (const row of rows) {
    const player = row.Player;
    const code = row.Tm || row.Team;
    if (!player || !code) continue;
    // "TOT" (and "2TM"/"3TM" in newer exports) is a season summary across
    // teams. Dropping it keeps a traded player's stats with the team they
    // actually played for.
    if (/^(TOT|\dTM)$/i.test(code)) continue;

    const startYear = seasonStartYear(file, row);
    if (startYear === null || startYear < 1979) continue;

    const team = teamName(code.toUpperCase(), startYear);
    if (!team) continue;

    const games = num(row.G);
    if (games < MIN_GAMES) continue;

    const key = `${player}|${team}|${decadeOf(startYear)}`;
    if (!acc.has(key)) {
      acc.set(key, {
        name: player,
        team,
        decade: decadeOf(startYear),
        posGames: {},
        games: 0,
        sums: { pts: 0, trb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fg: 0, fga: 0, tp: 0, tpa: 0, ft: 0, fta: 0 },
      });
    }
    const rec = acc.get(key);
    const g = games;
    rec.games += g;
    // Games-weighted rather than "whichever season file is read first" -
    // readdirSync order isn't chronological, so a player who moved from
    // center to forward across a tenure needs their position picked by how
    // much they actually played each, not by filesystem order.
    for (const slot of positions(row.Pos)) {
      rec.posGames[slot] = (rec.posGames[slot] || 0) + g;
    }
    // Per-game values are weighted by games so a long tenure isn't outvoted by
    // a single short season.
    rec.sums.pts += num(row.PTS) * g;
    rec.sums.trb += num(row.TRB) * g;
    rec.sums.ast += num(row.AST) * g;
    rec.sums.stl += num(row.STL) * g;
    rec.sums.blk += num(row.BLK) * g;
    rec.sums.tov += num(row.TOV) * g;
    rec.sums.fg += num(row.FG) * g;
    rec.sums.fga += num(row.FGA) * g;
    rec.sums.tp += num(row["3P"]) * g;
    rec.sums.tpa += num(row["3PA"]) * g;
    rec.sums.ft += num(row.FT) * g;
    rec.sums.fta += num(row.FTA) * g;
  }
}

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

// Top 2 positions by games actually played at each, most-played first -
// matches the shape `positions()` already returns for a single season.
function dominantPos(posGames) {
  const ranked = Object.entries(posGames).sort((a, b) => b[1] - a[1]);
  return ranked.length > 0 ? ranked.slice(0, 2).map(([slot]) => slot) : ["SF"];
}

const players = [...acc.values()].map((rec) => {
  const g = rec.games || 1;
  const per = (k) => rec.sums[k] / g;
  const tpa = r1(per("tpa"));
  return {
    name: rec.name,
    team: rec.team,
    decade: rec.decade,
    pos: dominantPos(rec.posGames),
    ppg: r1(per("pts")),
    rpg: r1(per("trb")),
    apg: r1(per("ast")),
    spg: r1(per("stl")),
    bpg: r1(per("blk")),
    tov: r1(per("tov")),
    fga: r1(per("fga")),
    fgp: per("fga") > 0 ? r3(per("fg") / per("fga")) : 0,
    tpa,
    // No attempts means no percentage. Writing 0 rather than a stray value is
    // what guarantees a non-shooter can never produce a three downstream.
    tpp: tpa > 0 && per("tpa") > 0 ? r3(per("tp") / per("tpa")) : 0,
    fta: r1(per("fta")),
    ftp: per("fta") > 0 ? r3(per("ft") / per("fta")) : 0,
  };
});

// Trim each squad to its most-used players.
const bySquad = new Map();
for (const p of players) {
  const key = `${p.team}|${p.decade}`;
  if (!bySquad.has(key)) bySquad.set(key, []);
  bySquad.get(key).push(p);
}

const SLOTS = ["PG", "SG", "SF", "PF", "C"];
const kept = [];
const thin = [];
for (const [key, list] of bySquad) {
  const ranked = list.sort((a, b) => b.ppg + b.rpg + b.apg - (a.ppg + a.rpg + a.apg));
  const squad = ranked.slice(0, SQUAD_SIZE);
  if (squad.length < SQUAD_SIZE) {
    thin.push(`${key} (${squad.length})`);
    continue;
  }
  const gaps = SLOTS.filter((s) => squad.filter((p) => p.pos.includes(s)).length < 3);
  if (gaps.length > 0) {
    // Pull in the next-best players who fill the missing slots rather than
    // shipping a squad that can't complete a draft.
    for (const slot of gaps) {
      const extra = ranked.slice(SQUAD_SIZE).filter((p) => p.pos.includes(slot));
      for (const e of extra.slice(0, 3 - squad.filter((p) => p.pos.includes(slot)).length)) {
        squad.pop();
        squad.push(e);
      }
    }
  }
  kept.push(...squad);
}

const squadCount = new Set(kept.map((p) => `${p.team}|${p.decade}`)).size;
const header = `// Ball Knowledge - player/squad data
// ${squadCount} squads (team + decade) x ${SQUAD_SIZE} players = ${kept.length} records
// Generated by tools/build-data-from-csv.mjs from Basketball Reference per-game
// season exports. Do not hand-edit: re-run the script instead.
`;

const lines = [];
let currentSquad = null;
for (const p of kept.sort((a, b) => (a.team + a.decade).localeCompare(b.team + b.decade))) {
  const squad = `${p.team} ${p.decade}`;
  if (squad !== currentSquad) {
    lines.push(`\n  // --- ${squad} ---`);
    currentSquad = squad;
  }
  lines.push(
    `  { name: ${JSON.stringify(p.name)}, team: ${JSON.stringify(p.team)}, decade: ${JSON.stringify(p.decade)}, ` +
      `pos: ${JSON.stringify(p.pos)}, ppg: ${p.ppg}, rpg: ${p.rpg}, apg: ${p.apg}, spg: ${p.spg}, bpg: ${p.bpg}, ` +
      `tov: ${p.tov}, fga: ${p.fga}, fgp: ${p.fgp}, tpa: ${p.tpa}, tpp: ${p.tpp}, fta: ${p.fta}, ftp: ${p.ftp} },`
  );
}

writeFileSync(OUT, `${header}\nexport const PLAYERS = [${lines.join("\n")}\n];\n`);

console.log(`Wrote ${OUT}`);
console.log(`  ${kept.length} players across ${squadCount} squads from ${files.length} season files`);
if (thin.length > 0) {
  console.log(`  Skipped ${thin.length} squads with fewer than ${SQUAD_SIZE} qualifying players:`);
  for (const t of thin.slice(0, 20)) console.log(`    ${t}`);
  if (thin.length > 20) console.log(`    ...and ${thin.length - 20} more`);
}
