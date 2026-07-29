// Checks js/data.js against the squad grid the game is meant to cover.
//
// Run: node tools/check-coverage.mjs
//
// Team names are era-correct: a squad is named for where the team actually
// played that decade, so the 1980s Nets are the New Jersey Nets and the 1970s
// Wizards are the Washington Bullets. banners.js aliases these onto one
// franchise, so trophies still combine across a rename.
import { PLAYERS } from "../js/data.js";
import { STARTER_SLOTS, RANKED_SLOTS, isBenchSlot } from "../js/constants.js";

// team -> decades. Pre-1990 squads only need 10 players; the pool is thinner
// that far back and a 10-man squad still fills a full ranked roster.
export const GRID = {
  "Atlanta Hawks": ["1980s", "1990s", "2000s", "2010s", "2020s"],
  "Boston Celtics": ["1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"],
  "New Jersey Nets": ["1980s", "1990s", "2000s"],
  "Brooklyn Nets": ["2010s", "2020s"],
  "Charlotte Bobcats": ["2000s"],
  "Charlotte Hornets": ["1990s", "2010s", "2020s"],
  "Chicago Bulls": ["1970s", "1980s", "1990s", "2000s", "2010s", "2020s"],
  "Cleveland Cavaliers": ["1980s", "1990s", "2000s", "2010s", "2020s"],
  "Dallas Mavericks": ["1980s", "1990s", "2000s", "2010s", "2020s"],
  "Denver Nuggets": ["1980s", "1990s", "2000s", "2010s", "2020s"],
  "Detroit Pistons": ["1970s", "1980s", "1990s", "2000s", "2010s", "2020s"],
  "Golden State Warriors": ["1970s", "1980s", "1990s", "2000s", "2010s", "2020s"],
  "Houston Rockets": ["1980s", "1990s", "2000s", "2010s", "2020s"],
  "Indiana Pacers": ["1980s", "1990s", "2000s", "2010s", "2020s"],
  "LA Clippers": ["1980s", "1990s", "2000s", "2010s", "2020s"],
  "LA Lakers": ["1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"],
  "Memphis Grizzlies": ["2000s", "2010s", "2020s"],
  "Miami Heat": ["1990s", "2000s", "2010s", "2020s"],
  "Milwaukee Bucks": ["1970s", "1980s", "1990s", "2000s", "2010s", "2020s"],
  "Minnesota Timberwolves": ["1990s", "2000s", "2010s", "2020s"],
  "New Orleans Hornets": ["2000s"],
  "New Orleans Pelicans": ["2010s", "2020s"],
  "New York Knicks": ["1970s", "1980s", "1990s", "2000s", "2010s", "2020s"],
  "Oklahoma City Thunder": ["2010s", "2020s"],
  "Orlando Magic": ["1990s", "2000s", "2010s", "2020s"],
  "Philadelphia 76ers": ["1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"],
  "Phoenix Suns": ["1980s", "1990s", "2000s", "2010s", "2020s"],
  "Portland Trail Blazers": ["1980s", "1990s", "2000s", "2010s", "2020s"],
  "Sacramento Kings": ["1990s", "2000s", "2010s", "2020s"],
  "San Antonio Spurs": ["1980s", "1990s", "2000s", "2010s", "2020s"],
  "Seattle SuperSonics": ["1970s", "1980s", "1990s", "2000s"],
  "Toronto Raptors": ["1990s", "2000s", "2010s", "2020s"],
  "Utah Jazz": ["1970s", "1980s", "1990s", "2000s", "2010s", "2020s"],
  "Washington Bullets": ["1970s", "1980s", "1990s"],
  "Washington Wizards": ["2000s", "2010s", "2020s"],
};

const minPlayers = (decade) => (parseInt(decade, 10) < 1990 ? 10 : 16);

const bySquad = new Map();
for (const p of PLAYERS) {
  const key = `${p.team}|${p.decade}`;
  if (!bySquad.has(key)) bySquad.set(key, []);
  bySquad.get(key).push(p);
}

const wanted = [];
for (const [team, decades] of Object.entries(GRID)) {
  for (const d of decades) wanted.push(`${team}|${d}`);
}

const missing = [];
const thin = [];
const dupes = [];
const undraftable = [];

for (const key of wanted) {
  const squad = bySquad.get(key);
  const [, decade] = key.split("|");
  if (!squad) {
    missing.push(key);
    continue;
  }
  const need = minPlayers(decade);
  if (squad.length < need) thin.push(`${key} (${squad.length}/${need})`);

  const names = squad.map((p) => p.name);
  if (new Set(names).size !== names.length) dupes.push(key);

  // A squad has to be able to fill a full ranked roster on its own: five
  // position-locked starters plus five open bench spots. Without enough
  // bodies at a position the draft would stall with slots it cannot fill.
  const short = STARTER_SLOTS.filter((pos) => squad.filter((p) => p.pos.includes(pos)).length < 1);
  if (short.length > 0 || squad.length < RANKED_SLOTS.length) {
    undraftable.push(`${key} (no ${short.join("/") || "depth"})`);
  }
}

const extra = [...bySquad.keys()].filter((k) => !wanted.includes(k));

console.log(`grid wants ${wanted.length} squads; data has ${bySquad.size} (${PLAYERS.length} players)`);
console.log(`  present     : ${wanted.length - missing.length}`);
console.log(`  MISSING     : ${missing.length}`);
console.log(`  under-sized : ${thin.length}`);
console.log(`  duplicates  : ${dupes.length}`);
console.log(`  undraftable : ${undraftable.length}`);
console.log(`  not in grid : ${extra.length}`);

const show = (label, list) => {
  if (list.length === 0) return;
  console.log(`\n${label}:`);
  const byTeam = {};
  for (const k of list) {
    const [t, rest] = k.split("|");
    (byTeam[t] ||= []).push(rest);
  }
  for (const t of Object.keys(byTeam).sort()) console.log(`  ${t}: ${byTeam[t].sort().join(", ")}`);
};

show("MISSING", missing);
show("UNDER-SIZED", thin);
show("DUPLICATE PLAYERS", dupes);
show("UNDRAFTABLE", undraftable);
show("NOT IN GRID (kept, not requested)", extra);

const ok = missing.length === 0 && thin.length === 0 && dupes.length === 0 && undraftable.length === 0;
console.log(`\n${ok ? "COVERAGE COMPLETE" : "INCOMPLETE"}`);
process.exit(ok ? 0 : 1);
