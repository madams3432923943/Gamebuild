// Builds data/nfl-players.js and data/nfl-units.js from the raw nflverse
// season files in tools/seasons-nfl/ (run tools/fetch-nfl-seasons.mjs first).
//
// The basketball equivalent is tools/build-data-from-csv.mjs and this follows
// its shape deliberately: aggregate per-game averages keyed by
// name + team + era, apply a games floor, drop squads too thin to draft from,
// and emit a generated file nobody hand-edits.
//
// FOOTBALL DIFFERS IN ONE STRUCTURAL WAY. Basketball drafts ten individuals.
// Football drafts six individuals and five units, because nobody remembers a
// 2013 Seahawks nickel corner by name but everybody remembers the Legion of
// Boom. So this emits TWO files:
//
//   data/nfl-players.js   QB, RB, WR, TE - individuals, one row per player
//   data/nfl-units.js     OL, DL, LB, CB, S, ST - one row per team-era-group
//
// Units are derived here rather than at squad-roll time so the client never
// re-aggregates thousands of rows mid-draft, and derived rather than
// hand-authored so fixing a player's stats fixes his unit for free.
//
// THREE THINGS THE SOURCE CANNOT GIVE US, recorded because each one is a
// judgement call a reader would otherwise have to reverse-engineer:
//
//   1. There is no offensive-line data. All of 2023 contains four OL rows and
//      they are fluke receptions by tackle-eligible linemen. OL is therefore
//      derived from the two standard public proxies - sacks allowed and rushing
//      efficiency - measured at team level. See buildOlUnit().
//   2. There is no punting or return data in the kicking file. The special
//      teams unit is the kicking game only (FG, PAT, game-winners). Named ST
//      rather than K because the slot is meant to be a unit decision, and
//      because punting can be folded in later without renaming anything.
//   3. Coverage starts in 1999, so the eras are plain decades rather than the
//      rule-change brackets docs/nfl-plan.md first proposed. 1999 is dropped:
//      it belongs to no decade bracket.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const SEASON_DIR = join(here, "seasons-nfl");
const OUT_PLAYERS = join(here, "..", "data", "nfl-players.js");
const OUT_UNITS = join(here, "..", "data", "nfl-units.js");

// Regular season only. Playoff games would inflate the per-game averages of
// exactly the teams that were already good, which is double-counting: being
// good is what got them there.
const SEASON_TYPE = "REG";

/** Games in ONE SEASON before that season is draftable.
 *
 * Rows are per player per team per SEASON, not per era, because the draft
 * asks for a year: you roll the 2010s Seahawks, name Russell Wilson, and then
 * pick WHICH Wilson. An era average cannot answer that - it would offer one
 * blended player who never existed.
 *
 * Six games rather than a full season, so a great half-year (a rookie who took
 * over in week 8) stays draftable, but a two-game cameo doesn't. */
const MIN_GAMES = 6;

/** Games in a SEASON before a player counts toward his unit's depth, so a
 * practice-squad call-up doesn't inflate it. Depth is measured per season and
 * averaged - see the depth calculation below for why the obvious alternative
 * is wrong. */
const MIN_UNIT_GAMES = 4;

// nflverse already back-maps historical codes (SD -> LAC, STL -> LA, OAK ->
// LV), so all 25 seasons come through as today's 32 franchises and no
// relocation handling is needed. Names match js/banners.js's NFL franchise
// entries so banner progress can key off them unchanged.
const TEAMS = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills", CAR: "Carolina Panthers", CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals", CLE: "Cleveland Browns", DAL: "Dallas Cowboys",
  DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars",
  KC: "Kansas City Chiefs", LA: "Los Angeles Rams", LAC: "Los Angeles Chargers",
  LV: "Las Vegas Raiders", MIA: "Miami Dolphins", MIN: "Minnesota Vikings",
  NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers",
  SEA: "Seattle Seahawks", SF: "San Francisco 49ers", TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans", WAS: "Washington Commanders",
};

/** Decade brackets. Ids match js/sports/nfl/index.js's eras. */
function eraOf(season) {
  if (season >= 2020) return "2020s";
  if (season >= 2010) return "2010s";
  if (season >= 2000) return "2000s";
  return null;
}

// Which draftable individual slot a position plays. Everything else is either
// a unit member or noise (a receiver credited with a tackle after an
// interception is not a defensive back).
const SKILL = { QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE" };

// Defensive position -> unit. Deliberately explicit rather than a prefix
// match: "DB" and "LB" appear as loose labels in older seasons and must land
// somewhere specific.
const DEF_UNIT = {
  DE: "DL", DT: "DL", NT: "DL", DL: "DL",
  ILB: "LB", OLB: "LB", MLB: "LB", LB: "LB",
  CB: "CB", DB: "CB",
  FS: "S", SS: "S", S: "S",
};

const num = (v) => {
  if (v === undefined || v === null || v === "" || v === "NA") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Minimal CSV reader. nflverse quotes fields containing commas (player names
 * like "Smith, Jr."), so quoted sections have to be respected. */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const head = splitLine(lines[0]);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    if (cells.length < 2) continue;
    const row = {};
    for (let c = 0; c < head.length; c++) row[head[c]] = cells[c];
    out.push(row);
  }
  return out;
}

function splitLine(line) {
  const cells = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

function readSeasonFiles(prefix) {
  if (!existsSync(SEASON_DIR)) {
    console.error(`No ${SEASON_DIR}. Run: node tools/fetch-nfl-seasons.mjs`);
    process.exit(1);
  }
  const files = readdirSync(SEASON_DIR).filter((f) => f.startsWith(prefix) && f.endsWith(".csv"));
  const rows = [];
  for (const f of files) rows.push(...parseCsv(readFileSync(join(SEASON_DIR, f), "utf8")));
  return rows;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

// The offence file is player_stats_YYYY; the other two carry an infix, so a
// bare "player_stats_" prefix would swallow all three.
const offence = readSeasonFiles("player_stats_2").filter((r) => r.season_type === SEASON_TYPE);
const defence = readSeasonFiles("player_stats_def_").filter((r) => r.season_type === SEASON_TYPE);
const kicking = readSeasonFiles("player_stats_kicking_").filter((r) => r.season_type === SEASON_TYPE);

console.log(`rows: ${offence.length} offence, ${defence.length} defence, ${kicking.length} kicking`);

const teamOf = (row) => TEAMS[row.recent_team || row.team] || null;

/** How many games a team actually played in a SEASON. Every per-game unit rate
 * divides by this, so it can't be assumed to be 16 - the season went to 17 in
 * 2021, and the COVID year exists. */
const teamGames = new Map();
for (const row of offence) {
  const era = eraOf(num(row.season));
  const team = teamOf(row);
  if (!era || !team) continue;
  const key = `${team}|${num(row.season)}`;
  if (!teamGames.has(key)) teamGames.set(key, new Set());
  teamGames.get(key).add(String(row.week));
}

// ---------------------------------------------------------------------------
// Individuals: QB / RB / WR / TE
// ---------------------------------------------------------------------------

const players = new Map();

for (const row of offence) {
  const slot = SKILL[row.position];
  const era = eraOf(num(row.season));
  const team = teamOf(row);
  if (!slot || !era || !team) continue;

  const season = num(row.season);
  const key = `${row.player_display_name || row.player_name}|${team}|${season}`;
  if (!players.has(key)) {
    players.set(key, {
      name: row.player_display_name || row.player_name,
      team,
      era,
      season,
      posGames: {},
      games: 0,
      sums: { pass_yds: 0, pass_td: 0, ints: 0, rush_yds: 0, rush_td: 0, rec: 0, rec_yds: 0, rec_td: 0, fum: 0, sacked: 0, carries: 0, targets: 0 },
    });
  }
  const rec = players.get(key);
  rec.games += 1;
  rec.posGames[slot] = (rec.posGames[slot] || 0) + 1;
  const s = rec.sums;
  s.pass_yds += num(row.passing_yards);
  s.pass_td += num(row.passing_tds);
  s.ints += num(row.interceptions);
  s.rush_yds += num(row.rushing_yards);
  s.rush_td += num(row.rushing_tds);
  s.rec += num(row.receptions);
  s.rec_yds += num(row.receiving_yards);
  s.rec_td += num(row.receiving_tds);
  s.fum += num(row.rushing_fumbles_lost) + num(row.receiving_fumbles_lost) + num(row.sack_fumbles_lost);
  s.sacked += num(row.sacks);
  s.carries += num(row.carries);
  s.targets += num(row.targets);
}

const playerRows = [...players.values()]
  .filter((p) => p.games >= MIN_GAMES)
  .map((p) => {
    const g = p.games;
    const per = (k) => p.sums[k] / g;
    const primary = Object.entries(p.posGames).sort((a, b) => b[1] - a[1])[0][0];
    return {
      name: p.name,
      team: p.team,
      era: p.era,
      season: p.season,
      pos: [primary],
      games: g,
      pass_yds: r1(per("pass_yds")),
      pass_td: r2(per("pass_td")),
      ints: r2(per("ints")),
      rush_yds: r1(per("rush_yds")),
      rush_td: r2(per("rush_td")),
      rec: r1(per("rec")),
      rec_yds: r1(per("rec_yds")),
      rec_td: r2(per("rec_td")),
      fum: r2(per("fum")),
      // Efficiency, not volume - a back averaging 5.2 a carry on 8 carries is
      // a different player from one averaging 3.4 on 22, and per-game yards
      // alone cannot tell them apart.
      ypc: p.sums.carries > 0 ? r2(p.sums.rush_yds / p.sums.carries) : 0,
      ypt: p.sums.targets > 0 ? r2(p.sums.rec_yds / p.sums.targets) : 0,
    };
  });

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const units = new Map();

function unitKey(team, season, group) {
  return `${team}|${season}|${group}`;
}

/** Records one game for one player in one unit-season, and what he did in it.
 *
 * Per-player takeaways are kept, not just appearances, so the simulation can
 * name WHO picked the ball off. "Intercepted by the Seahawks Cornerbacks"
 * throws away the reason anybody drafted them; "Richard Sherman" is the whole
 * point. Weighting by his real share means Sherman turns up about as often as
 * he actually did, rather than the unit's snaps being a lottery ticket. */
function countMember(unit, who, ints = 0, ff = 0) {
  const m = unit.members.get(who) || { games: 0, ints: 0, ff: 0 };
  m.games += 1;
  m.ints += ints;
  m.ff += ff;
  unit.members.set(who, m);
}

// One row per team per SEASON per group, for the same reason players are
// per-season: "the 2013 Seahawks secondary" is a specific thing, and the whole
// point of the year pick is that 2013 and 2017 are not the same unit.
function ensureUnit(team, era, season, group) {
  const key = unitKey(team, season, group);
  if (!units.has(key)) {
    units.set(key, {
      team,
      era,
      season,
      group,
      members: new Map(),
      sums: { tackles: 0, tfl: 0, qbh: 0, fr: 0, sacks: 0, ints: 0, pd: 0, ff: 0, td: 0, fg_made: 0, fg_att: 0, pat_made: 0, pat_att: 0 },
    });
  }
  return units.get(key);
}

for (const row of defence) {
  const group = DEF_UNIT[row.position];
  const era = eraOf(num(row.season));
  const team = teamOf(row);
  if (!group || !era || !team) continue;

  const u = ensureUnit(team, era, num(row.season), group);
  countMember(u, row.player_display_name || row.player_name,
              num(row.def_interceptions), num(row.def_fumbles_forced));
  const s = u.sums;
  s.tackles += num(row.def_tackles);
  // Disruption, not volume. A bad defence racks up tackles by being on the
  // field while the offence moves; nobody accumulates a tackle for loss or a
  // quarterback hit except by beating a block. These separate a unit that was
  // busy from one that was good, which raw tackles cannot do.
  s.tfl += num(row.def_tackles_for_loss);
  s.qbh += num(row.def_qb_hits);
  // A recovery is a takeaway the forced-fumble column misses - the fumble was
  // forced by someone else and this unit came up with the ball.
  s.fr += num(row.def_fumble_recovery_opp);
  s.sacks += num(row.def_sacks);
  s.ints += num(row.def_interceptions);
  s.pd += num(row.def_pass_defended);
  s.ff += num(row.def_fumbles_forced);
  s.td += num(row.def_tds);
}

for (const row of kicking) {
  const era = eraOf(num(row.season));
  const team = teamOf(row);
  if (!era || !team) continue;
  const u = ensureUnit(team, era, num(row.season), "ST");
  countMember(u, row.player_display_name || row.player_name);
  const s = u.sums;
  s.fg_made += num(row.fg_made);
  s.fg_att += num(row.fg_att);
  s.pat_made += num(row.pat_made);
  s.pat_att += num(row.pat_att);
}

/**
 * The offensive line, derived rather than aggregated - there is no OL data to
 * aggregate (see the header). Two proxies, both long-standing and both
 * computable from the offence file:
 *
 *   sacks allowed per game   the pass-protection half, from the `sacks`
 *                            column on the team's quarterbacks, which counts
 *                            sacks TAKEN
 *   yards per carry          the run-blocking half
 *
 * Neither is a pure OL measurement - a quarterback who holds the ball takes
 * sacks a good line can't prevent, and a great back breaks tackles a bad line
 * didn't block for. They are the honest best available, and the engine should
 * treat them as team-level context rather than as a player rating.
 */
function buildOlUnit() {
  const acc = new Map();
  for (const row of offence) {
    const era = eraOf(num(row.season));
    const team = teamOf(row);
    if (!era || !team) continue;
    const key = `${team}|${num(row.season)}|${era}`;
    if (!acc.has(key)) acc.set(key, { sacksAllowed: 0, rushYds: 0, carries: 0 });
    const a = acc.get(key);
    if (row.position === "QB") a.sacksAllowed += num(row.sacks);
    a.rushYds += num(row.rushing_yards);
    a.carries += num(row.carries);
  }
  // The two proxies are on different scales and neither is meaningful alone,
  // so they are combined into ONE cumulative line rating - which is how a line
  // is actually talked about ("the 2016 Cowboys had the best line in football")
  // and what the draft board needs to sort on.
  //
  // Ranked WITHIN an era, not across all of them. Sack rates and rushing
  // efficiency drift league-wide as rules change, so an absolute scale would
  // quietly mark every 2020s line as better or worse than every 2000s one for
  // reasons that have nothing to do with the linemen.
  const scored = [...acc.entries()].map(([key, a]) => {
    const [team, season] = key.split("|");
    const games = teamGames.get(`${team}|${season}`)?.size || 1;
    return {
      key,
      sacks_allowed: a.sacksAllowed / games,
      ypc: a.carries > 0 ? a.rushYds / a.carries : 0,
    };
  });

  // Ranked within the SEASON, not the era. Sack rates and rushing efficiency
  // drift year to year with the rules; comparing a 2003 line against a 2009
  // one on an absolute scale would rate them on the league's changes rather
  // than their own play.
  const bySeason = new Map();
  for (const row of scored) {
    const season = row.key.split("|")[1];
    if (!bySeason.has(season)) bySeason.set(season, []);
    bySeason.get(season).push(row);
  }

  /** Where `value` sits among `all`, 0-1. Ties share a rank, so two identical
   * lines cannot be arbitrarily ordered. */
  const pct = (value, all) => {
    const below = all.filter((v) => v < value).length;
    const equal = all.filter((v) => v === value).length;
    return all.length ? (below + equal / 2) / all.length : 0.5;
  };

  for (const [, rows] of bySeason) {
    const sacks = rows.map((r) => r.sacks_allowed);
    const ypcs = rows.map((r) => r.ypc);
    for (const row of rows) {
      // Sacks inverted: allowing fewer is better.
      const protection = 1 - pct(row.sacks_allowed, sacks);
      const runBlock = pct(row.ypc, ypcs);
      row.rating = Math.round(50 * (protection + runBlock));
    }
  }

  for (const row of scored) {
    const [team, season, era] = row.key.split("|");
    const u = ensureUnit(team, era, Number(season), "OL");
    u.derived = {
      rating: row.rating,
      sacks_allowed: r2(row.sacks_allowed),
      ypc: r2(row.ypc),
    };
    // An OL has no named members in this data, so depth is the standard five.
    // Recorded explicitly rather than left undefined so the depth term in the
    // engine doesn't have to special-case one unit.
    u.members.set("__line__", 99);
  }
}
buildOlUnit();

/** What a unit is called on the board. Spoken-language names, because the
 * draft asks you to type one and nobody says "the Bears DL". */
const UNIT_NAMES = {
  OL: "Offensive Line", DL: "Defensive Line", LB: "Linebackers",
  CB: "Cornerbacks", S: "Safeties", ST: "Special Teams",
};

const unitRows = [];
for (const u of units.values()) {
  const games = teamGames.get(`${u.team}|${u.season}`)?.size || 1;
  // Depth is how many played TOGETHER, averaged over the era's seasons - not
  // how many passed through it. Counting the decade's distinct names made a
  // median secondary look 18 deep, which is ten years of churn rather than a
  // unit you could field. A two-man linebacker corps really is thinner than a
  // five-man one, and only the per-season view can see that.
  const depth =
    u.group === "OL" ? 5 : [...u.members.values()].filter((m) => m.games >= MIN_UNIT_GAMES).length;
  const per = (k) => r2(u.sums[k] / games);

  // Who you can NAME to claim this unit. The draft is a ball-knowledge test,
  // and a unit you take by picking "Linebackers" off a rolled squad tests
  // nothing - there is exactly one per squad, so it would be a free pick with
  // a year attached, five times in a twelve-round draft.
  //
  // ANY member claims it: Sherman or Thomas or Chancellor all take the 2013
  // Seahawks secondary. That is a wider net than the NBA draft, where one
  // specific name is required, so this is the more forgiving of the two.
  //
  // Sorted by games so the recognizable starters come first, and capped
  // because the tail is camp bodies nobody could name and every one of them
  // costs bytes in a file the browser parses on load. OL keeps none - the
  // source has no named linemen at all, which is why that slot is claimed by
  // unit name instead.
  const members =
    u.group === "OL"
      ? []
      : [...u.members.entries()]
          .filter(([, m]) => m.games >= MIN_UNIT_GAMES)
          .sort((a, b) => b[1].games - a[1].games)
          .slice(0, 8)
          // name plus the takeaways he personally made, so the sim can pick a
          // scorer by his real share instead of at random.
          .map(([name, m]) => ({ name, games: m.games, ints: r2(m.ints), ff: r2(m.ff) }));

  // Units must present the SAME SHAPE as players. Every shared draft-board
  // path reads .name and .pos - js/ui.js does `for (const pos of p.pos)` - so a
  // unit without them threw on render and left the board blank. Giving units a
  // real name and position here fixes it once, in the data, rather than as a
  // guard at every call site that would have to be found and remembered.
  //
  // The name is what you would call it out loud: "Chicago Bears Linebackers".
  const row = {
    team: u.team, era: u.era, season: u.season, group: u.group, depth, games, members,
    name: `${u.team} ${UNIT_NAMES[u.group] || u.group}`,
    // Quick Play collapses the whole defence into one DEF pick, so the four
    // defensive units answer to that slot as well as to their own. Without
    // this nothing on the board was eligible for DEF, the draft could not
    // advance past it, and Quick Play hung with two slots open.
    pos: ["DL", "LB", "CB", "S"].includes(u.group) ? [u.group, "DEF"] : [u.group],
  };
  if (u.group === "OL") {
    Object.assign(row, u.derived);
  } else if (u.group === "ST") {
    row.fg_made = per("fg_made");
    row.fg_att = per("fg_att");
    // No attempts means no percentage. Same rule as the basketball build: a
    // stray value here would let a kicker who never kicked look automatic.
    row.fg_pct = u.sums.fg_att > 0 ? r3(u.sums.fg_made / u.sums.fg_att) : 0;
    row.pat_pct = u.sums.pat_att > 0 ? r3(u.sums.pat_made / u.sums.pat_att) : 0;
  } else {
    row.tackles = per("tackles");
    row.tfl = per("tfl");
    row.qbh = per("qbh");
    row.fr = per("fr");
    row.sacks = per("sacks");
    row.ints = per("ints");
    row.pd = per("pd");
    row.ff = per("ff");
    row.td = per("td");
  }
  unitRows.push(row);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

function writeGenerated(path, header, rows, keyOf, format) {
  const lines = [];
  let current = null;
  for (const row of rows.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))) {
    if (keyOf(row) !== current) {
      lines.push(`\n  // --- ${keyOf(row)} ---`);
      current = keyOf(row);
    }
    lines.push(`  ${format(row)},`);
  }
  writeFileSync(path, `${header}\nexport const ROWS = [${lines.join("\n")}\n];\n`);
}

const squads = new Set(playerRows.map((p) => `${p.team}|${p.era}`));
const seasons = new Set(playerRows.map((p) => `${p.team}|${p.season}`));

writeGenerated(
  OUT_PLAYERS,
  `// Draft Nova - NFL individual players (QB/RB/WR/TE)\n` +
    `// ${playerRows.length} player-seasons across ${squads.size} team-era squads (${seasons.size} team-seasons)\n` +
    `// Generated by tools/build-nfl-data.mjs from nflverse season exports.\n` +
    `// Do not hand-edit: re-run the script instead.`,
  playerRows,
  (p) => `${p.team} ${p.season}`,
  (p) => JSON.stringify(p)
);

writeGenerated(
  OUT_UNITS,
  `// Draft Nova - NFL draftable units (OL/DL/LB/CB/S/ST)\n` +
    `// ${unitRows.length} unit records\n` +
    `// Derived, never hand-authored - see tools/build-nfl-data.mjs.`,
  unitRows,
  (u) => `${u.team} ${u.season}`,
  (u) => JSON.stringify(u)
);

console.log(`players: ${playerRows.length} across ${squads.size} squads -> ${OUT_PLAYERS}`);
console.log(`units:   ${unitRows.length} -> ${OUT_UNITS}`);
