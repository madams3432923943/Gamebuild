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
  // Sheet names are the season's START year, and that is also how a season is
  // NAMED here: "2025" means 2025-26. Kawhi's 2018 is the 2018-19 Raptors year
  // and Durant's 2025 is his first Houston season - the sheet name goes on the
  // card unchanged.
  //
  // The decade is taken from that same start year. It used to be taken from
  // startYear - 1, which put a season in the decade before the one it belongs
  // to; that is the half of this that was genuinely wrong.
  const startYear = parseInt(sheet.name.match(/(\d{4})/)?.[1] ?? "", 10);
  if (!Number.isFinite(startYear)) continue;
  const endYear = startYear;

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
      // The season a pick resolves to, named by its START year: "2025" is the
      // 2025-26 season, which is the convention this project uses throughout.
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
// Merge same-name teammates
// ---------------------------------------------------------------------------
// The 1988 Bullets had two different Charles Joneses, and 1980s basketball has
// a few of these. They are genuinely two people, but the draft cannot tell
// them apart - you type a name, and a name is all the game ever has - so
// leaving both would put two identical cards on the board and, downstream,
// collide on the database's (name, team, decade, season) identity.
//
// Combined games-weighted, which is the same arithmetic used to average a
// season in the first place: the merged line is what "Charles Jones on the
// 1988 Bullets" produced, which is the honest answer to the only question the
// game can ask.

const merged = new Map();
for (const row of rows) {
  const key = `${row.name}|${row.team}|${row.season}`;
  const prior = merged.get(key);
  if (!prior) {
    merged.set(key, row);
    continue;
  }
  const g = prior.games + row.games;
  const blend = (k) => r1((prior[k] * prior.games + row[k] * row.games) / g);
  const blend3 = (k) => r3((prior[k] * prior.games + row[k] * row.games) / g);
  merged.set(key, {
    ...prior,
    games: g,
    pos: [...new Set([...prior.pos, ...row.pos])].slice(0, 2),
    ppg: blend("ppg"), rpg: blend("rpg"), apg: blend("apg"),
    spg: blend("spg"), bpg: blend("bpg"), tov: blend("tov"),
    fga: blend("fga"), fgp: blend3("fgp"),
    tpa: blend("tpa"), tpp: blend3("tpp"),
    fta: blend("fta"), ftp: blend3("ftp"),
  });
}
const deduped = [...merged.values()];
if (deduped.length !== rows.length) {
  console.log(`merged ${rows.length - deduped.length} same-name teammate row(s)`);
}
rows.length = 0;
rows.push(...deduped);

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

/** A season worth drafting. Deep-bench filler is dropped to keep the file
 * small, but "worth drafting" cannot mean scoring alone: Dennis Rodman
 * averaged 7 points and was one of the best players alive. A player is kept
 * if he was meaningful in ANY category, which is also how anyone remembers
 * him - you do not recall Ben Wallace's scoring average.
 *
 * Deliberately generous. The cost of keeping a marginal player is a few
 * kilobytes; the cost of cutting a real one is somebody typing a name they
 * clearly remember and being told he was not there. */
function isDraftable(r) {
  return (
    r.ppg >= 8 ||
    r.rpg >= 6 ||
    r.apg >= 4 ||
    r.spg >= 1.2 ||
    r.bpg >= 1 ||
    // A high-usage scorer on a bad team can fall under every bar above while
    // still being the guy that squad is remembered for.
    r.fga >= 10
  );
}

// NO SQUAD TRIM. Every draftable player is kept - no per-squad cap.
//
// This used to keep the top SQUAD_PLAYERS per squad, which is how Kawhi
// Leonard's Raptors title year and Durant's Rockets season went missing -
// ranked by tenure, a one-year star loses to a journeyman who stayed eight.
// Ranking by peak fixed those two and would have kept cutting somebody: any
// cutoff removes real players from a game whose entire subject is knowing
// which players were there.
//
// The cost is dataset size, which is worth paying. The draft board searches
// by name rather than listing everyone, so a deeper squad costs nothing to
// read - it only means the answer you remember is actually there.
const kept = [];
for (const players of bySquad.values()) {
  // Rank by the player's BEST season with this team, not by how long he
  // stayed. Total games rewards tenure, which is precisely the wrong thing:
  // Kawhi Leonard played one year in Toronto and won it, and any journeyman
  // with eight quiet seasons outranked him - so the Raptors squad lost the
  // player everyone would name first. Durant's single Houston year went the
  // same way.
  //
  // Peak production, with a small tenure term to break ties between similar
  // players. A cameo cannot game this because MIN_GAMES already filtered the
  // rows before they got here.
  const peak = (seasons) =>
    Math.max(...seasons.map((r) => r.ppg + 0.7 * r.rpg + 0.7 * r.apg + 0.5 * r.spg + 0.5 * r.bpg));
  const tenure = (seasons) => seasons.reduce((n, r) => n + r.games, 0);
  const ranked = [...players.values()].sort(
    (a, b) => peak(b) - peak(a) || tenure(b) - tenure(a)
  );
  // Filter first, then top up. A ranked roster is ten slots, and a squad that
  // cannot fill one is a draft that cannot finish - four early-expansion squads
  // fell under that line on the contributor filter alone. So thin squads take
  // back their next-best players until they can field a team, ranked by peak
  // exactly as above.
  const MIN_SQUAD_PLAYERS = 12;
  const worth = [];
  const spare = [];
  for (const seasons of ranked) {
    const draftable = seasons.filter(isDraftable);
    if (draftable.length) worth.push(draftable);
    else spare.push(seasons);
  }
  while (worth.length < MIN_SQUAD_PLAYERS && spare.length) worth.push(spare.shift());
  for (const seasons of worth) kept.push(...seasons);
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
  `// Draft Nova - player/squad data\n` +
    `// ${kept.length} player-seasons, ${names.size} player-squad entries, ${squads.size} squads\n` +
    `// Generated by tools/build-nba-data.mjs from tools/seasons/NBAdata1980-2025.xlsx\n` +
    `// (Basketball Reference per-game exports, one sheet per season).\n` +
    `// Do not hand-edit: re-run the script instead.\n` +
    `\nexport const PLAYERS = [${lines.join("\n")}\n];\n`
);

console.log(`${kept.length} player-seasons across ${squads.size} squads (${names.size} draftable entries)`);
console.log(`  -> ${OUT}`);
