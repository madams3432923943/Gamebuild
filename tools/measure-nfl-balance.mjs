// What football's balance levers ACTUALLY do, before anything is solved.
//
// Run: node tools/measure-nfl-balance.mjs
//
// This is a diagnostic, not a calibrator. tools/calibrate-variance.mjs exists
// for basketball and solves two levers against measured targets; the football
// equivalent cannot be written until it is known what the levers currently
// produce and whether they are even the same kind of lever. They are not:
//
//   NBA  TEAM_QUARTER_VARIANCE is rolled ONCE PER TEAM PER QUARTER and applied
//        to every player on that team. It is deliberately correlated, because
//        the whole reason it exists is that independent per-player noise
//        cancels across a roster - see the header of calibrate-variance.mjs.
//
//   NFL  the same-named constant is rolled INSIDE runDrive, fresh on every
//        drive, and applied to that drive alone. Eleven drives a team means it
//        averages away by roughly sqrt(11), so despite the name it is not a
//        team-level swing at all.
//
// So the first question is not "what value should the range be" but "does
// football have the problem basketball added that term to fix". This measures
// it: how often the better roster wins, and by how much.
import { ROWS as PLAYERS } from "../data/nfl-players.js";
import { ROWS as UNITS } from "../data/nfl-units.js";
import { computeDatasetStats, simulate } from "../js/sports/nfl/engine.js";
import { DraftState } from "../js/draft.js";

const RANKED_SLOTS = ["QB", "RB", "WR1", "WR2", "WR3", "TE", "OL", "DL", "LB", "CB", "S", "ST"];
const ctx = computeDatasetStats(PLAYERS, UNITS);

// "Better roster" means what the ENGINE means by it, read off the result
// rather than recomputed here.
//
// The first version of this file summed OFFENSE_WEIGHTS and DEFENSE_WEIGHTS
// over `p.rating` itself, and produced a gap distribution with 211 pairs under
// 0.02, nothing at all between 0.02 and 0.05, and 1,137 over 0.20 - a
// reimplementation that was measuring something else. sideRating() applies the
// dataset context, the unit depth term and the Quick Play stand-in rule, none
// of which a bare weighted sum knows about. The engine already publishes its
// own numbers in result.analysis; those are the ones the simulation actually
// ran on.

function rosterPair() {
  const g = new DraftState([...PLAYERS, ...UNITS], [], RANKED_SLOTS);
  let guard = 0;
  while (!g.isComplete() && guard++ < RANKED_SLOTS.length * 8) {
    if (!g.rollNextSquad()) break;
    // Full strength on both sides: the bot's top-pick ban is a difficulty
    // setting, and solving balance against nerfed rosters would solve it for
    // games nobody plays.
    g.botAutoPick("A", { banTop: 0 });
    g.botAutoPick("B", { banTop: 0 });
  }
  return g;
}

const MIN_GAP = Number(process.env.MIN_GAP || 0);
const GAMES = Number(process.env.GAMES || 600);

// A single win rate over "rosters with some gap" says very little, because it
// is dominated by whatever gap size happens to be common. What matters is
// whether the number RISES WITH the gap: if a decisive talent advantage wins
// no more often than a slight one, the levers are not converting talent into
// wins at all, and no amount of re-solving a variance range fixes that.
const BUCKETS = [
  { label: "0.00 - 0.02  (near even)", lo: 0, hi: 0.02 },
  { label: "0.02 - 0.05  (slight)   ", lo: 0.02, hi: 0.05 },
  { label: "0.05 - 0.10  (clear)    ", lo: 0.05, hi: 0.10 },
  { label: "0.10 - 0.20  (wide)     ", lo: 0.10, hi: 0.20 },
  { label: "0.20 +       (decisive) ", lo: 0.20, hi: Infinity },
];
const buckets = BUCKETS.map((b) => ({ ...b, n: 0, won: 0, margin: 0 }));

let games = 0, strongWon = 0, blowouts = 0, marginSum = 0, ties = 0;
let qWins = 0, qTotal = 0, sweeps = 0;
let attempts = 0;

while (games < GAMES && attempts < GAMES * 40) {
  attempts += 1;
  const g = rosterPair();
  if (!g.isComplete()) continue;
  const r = simulate(g.rosterA, g.rosterB, ctx, {});
  const { offA, offB, defA, defB } = r.analysis;
  const sA = offA + defA, sB = offB + defB;
  // Only informative pairs: two even rosters should split near 50% however the
  // levers are set, so including them drags every reading toward 50.
  if (Math.abs(sA - sB) < MIN_GAP) continue;

  const strong = sA > sB ? "A" : "B";
  games += 1;

  const gap = Math.abs(sA - sB);
  const bucket = buckets.find((b) => gap >= b.lo && gap < b.hi);

  const margin = r.teamScoreA - r.teamScoreB;
  if (bucket) {
    bucket.n += 1;
    bucket.margin += Math.abs(margin);
    if (margin !== 0 && (margin > 0 ? "A" : "B") === strong) bucket.won += 1;
  }
  marginSum += Math.abs(margin);
  if (margin === 0) ties += 1;
  else if ((margin > 0 ? "A" : "B") === strong) strongWon += 1;
  if (Math.abs(margin) >= 21) blowouts += 1;

  // Quarter-by-quarter, the reading basketball's variance term was solved
  // against. A sweep means the stronger roster won all four. Football reports
  // these as quarterBoxScores - per-slot lines, so a quarter's team score is
  // the sum of its lines, the same shape basketball's calibrator reduces.
  let won = 0, played = 0;
  for (const q of r.quarterBoxScores || []) {
    const a = Object.values(q.a || {}).reduce((s, l) => s + (l.pts || 0), 0);
    const b = Object.values(q.b || {}).reduce((s, l) => s + (l.pts || 0), 0);
    if (a === b) continue;
    played += 1;
    if ((a > b ? "A" : "B") === strong) won += 1;
  }
  qWins += won; qTotal += played;
  if (played > 0 && won === played) sweeps += 1;
}

const pct = (n, d) => d ? ((100 * n) / d).toFixed(1) : "n/a";
console.log(`\nNFL balance, as shipped   (${games} games with a talent gap >= ${MIN_GAP})\n`);
console.log(`  stronger roster wins       ${pct(strongWon, games)}%`);
console.log(`  stronger roster wins a qtr ${pct(qWins, qTotal)}%   (${qTotal} decided quarters)`);
console.log(`  sweeps all four quarters   ${pct(sweeps, games)}%`);
console.log(`  mean final margin          ${(marginSum / games).toFixed(1)} points`);
console.log(`  games decided by 21+       ${pct(blowouts, games)}%`);
console.log(`  ties                       ${pct(ties, games)}%`);
console.log(`\n  drafted ${attempts} pairs to find ${games} with a gap\n`);

console.log("  Does talent convert into wins? Win rate by size of the gap:\n");
console.log("    talent gap                  games   stronger wins   mean margin");
console.log("    --------------------------  ------  --------------  -----------");
for (const b of buckets) {
  console.log(
    `    ${b.label}  ${String(b.n).padStart(6)}  ` +
    `${(b.n ? pct(b.won, b.n) + "%" : "n/a").padStart(14)}  ` +
    `${(b.n ? (b.margin / b.n).toFixed(1) : "n/a").padStart(11)}`
  );
}
console.log("");
