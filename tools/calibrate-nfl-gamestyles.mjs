// Solves the one lever that converts directly into wins for each of football's
// ten gameplans, holding everything that gives a plan its identity fixed.
//
// Run: node tools/calibrate-nfl-gamestyles.mjs
// Paste the FINAL MODS block into js/sports/nfl/tactics.js when the spread
// looks good, then copy that file to
// supabase/functions/simulate-match/sports/nfl/ (npm run verify:parity).
//
// RUN tools/calibrate-nfl-variance.mjs FIRST, ALWAYS. A plan's win rate is
// measured against whatever noise floor the engine has when you measure it, so
// gameplans solved before the variance range is settled are solved against the
// wrong floor. This is the same order basketball insists on and the same
// reason. js/sports/nfl/tactics.js records what happened the last two times
// something underneath moved without this being re-run: Vertical Attack at a
// 65.7% win rate, and Ground Control at 33.5%.
//
// THE RULE THIS SERVES, from the top of js/sports/nba/tactics.js and not
// negotiable: a plan must be a real CHOICE, not a power gain. If one option is
// simply strongest, ranked stops measuring football knowledge and starts
// measuring whether you picked plan 3.
//
// WHAT IS SOLVED, AND WHAT IS HELD
//
// Football has eight offensive levers where basketball has one. They are not
// interchangeable and only one of them is the right thing to solve:
//
//   off        SOLVED. Overall quality of the attack. It is the only offensive
//              mod that moves win rate without changing what the plan IS - it
//              scales drive quality directly, the way basketball's `pts` does.
//   explosive  HELD. Touchdowns rather than field goals.
//   redZone    HELD. Finishing a trip inside the twenty.
//   security   HELD. Your own turnover rate.
//   protection HELD. Resistance to the pass rush, which sets sack rate.
//   runShare   HELD. How often you actually hand it off.
//   pace       HELD. Drives per game.
//   fg         HELD. Your kicker's accuracy.
//
// and on the other side, `def` is solved and takeaway / passRush / coverage /
// runDef / explosivePrevention are held.
//
// The held seven ARE the plan. Ground Control's identity is a 1.50 runShare
// and a 0.96 pace; solving those away to reach 50% would leave a plan called
// Ground Control that no longer runs the ball. Basketball made the same
// distinction for the same reason - it solves `pts` and holds reb/ast/stl/blk/
// tov - and it is why a calibrated plan still feels like the thing it is
// named after. So a plan that is too strong pays for it in raw quality and
// keeps its character, which is also the honest trade: the plan is not worse
// at what it does, it is worse at everything else.
//
// TWO ROUNDS, NOT ONE
//
// The two catalogues are independent choices - you pick how you attack and how
// you defend, and the engine composes both bags - so they are solved
// separately. Offensive plans are measured with BOTH sides on the balanced
// defence, and defensive plans with both sides on the balanced offence. Solving
// them together would let a strong offence hide a weak defence in the same
// win rate, and neither would end up at 50%.
//
// MIRRORED PAIRS
//
// Every matchup is played twice on the same drafted rosters, with the two
// plans swapped. A plan's fit depends on the roster running it, so measuring
// one direction only would credit a plan for the roster that happened to draw
// it. Mirroring cancels that, and it is why this tool needs half as many games
// as it looks like it should.
import { NFL } from "../js/sports/nfl/index.js";
import { setActiveSport } from "../js/sports/index.js";
import { DraftState } from "../js/draft.js";
import { OFFENSIVE_PLANS, DEFENSIVE_PLANS } from "../js/sports/nfl/tactics.js";

setActiveSport("nfl");
await NFL.preload();

const ctx = NFL.computeDatasetStats();
const POOL = NFL.playersInEra(NFL.players(), "all");
const SLOTS = NFL.slots.ranked;

const BALANCED_OFFENSE = OFFENSIVE_PLANS[0].id;
const BALANCED_DEFENSE = DEFENSIVE_PLANS[0].id;

/** The lever solved for each catalogue. One per side of the ball - see the
 * header for why it is this one and not any of the other seven. */
const SOLVED_KEY = { offense: "off", defense: "def" };

function rosterPair() {
  const g = new DraftState(POOL, [], SLOTS);
  while (!g.isComplete()) {
    if (!g.rollNextSquad()) break;
    // banTop: 0 - full strength on both sides. See the same note in
    // tools/calibrate-nfl-variance.mjs: the bot's difficulty nerf shapes the
    // BOT's roster, and solving against nerfed rosters would solve for a game
    // nobody plays.
    g.botAutoPick("A", { banTop: 0 });
    g.botAutoPick("B", { banTop: 0 });
  }
  return g.isComplete() ? g : null;
}

function drawPairs(count) {
  const pairs = [];
  while (pairs.length < count) {
    const g = rosterPair();
    if (g) pairs.push({ rosterA: g.rosterA, rosterB: g.rosterB });
  }
  return pairs;
}

/**
 * The plans are read by the engine through the shared catalogue arrays, so a
 * candidate value is applied by mutating those entries in place - the same
 * technique tools/calibrate-gamestyles.mjs uses, and for the same reason:
 * simulate() resolves a plan by id, so there is no other seam to inject one.
 */
function applyCandidate(group, candidate) {
  const plans = group === "defense" ? DEFENSIVE_PLANS : OFFENSIVE_PLANS;
  const key = SOLVED_KEY[group];
  for (const plan of plans) plan.mods[key] = candidate[plan.id];
}

function strategyFor(group, planId) {
  return group === "defense"
    ? { offense: BALANCED_OFFENSE, defense: planId }
    : { offense: planId, defense: BALANCED_DEFENSE };
}

/** Win rate per plan against the whole field, over mirrored matchups. */
function winRates(group, candidate, pairs, repeats) {
  applyCandidate(group, candidate);
  const plans = group === "defense" ? DEFENSIVE_PLANS : OFFENSIVE_PLANS;
  const ids = plans.map((p) => p.id);
  const wins = Object.fromEntries(ids.map((id) => [id, 0]));
  const games = Object.fromEntries(ids.map((id) => [id, 0]));

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      for (let k = 0; k < repeats; k++) {
        const pair = pairs[(i * ids.length + j + k) % pairs.length];
        // Both directions on the same rosters, so roster advantage cancels.
        for (const [first, second] of [[a, b], [b, a]]) {
          const r = NFL.simulate(pair.rosterA, pair.rosterB, ctx, {
            strategyA: strategyFor(group, first),
            strategyB: strategyFor(group, second),
          });
          // A TIE IS NOT A WIN FOR WHOEVER WAS SECOND. The engine plays paired
          // overtime possessions up to a safety cap and can still finish
          // level, and `else` handed every one of those to the second plan -
          // so the solver was partly fitting to which argument came second in
          // a loop rather than to how the plans played. Dropped from both
          // sides instead: a drawn game says nothing about which plan is
          // stronger, which is the only question here.
          if (r.teamScoreA === r.teamScoreB) continue;
          games[first] += 1;
          games[second] += 1;
          if (r.teamScoreA > r.teamScoreB) wins[first] += 1;
          else wins[second] += 1;
        }
      }
    }
  }
  return Object.fromEntries(ids.map((id) => [id, (100 * wins[id]) / Math.max(1, games[id])]));
}

/**
 * How much of the solved lever one point of win rate is worth.
 *
 * Basketball uses 0.0022 on `pts`, measured for that engine. Football's `off`
 * and `def` scale drive quality rather than points, and drive quality feeds a
 * probability chart that is clamped at both ends, so the same nudge buys less
 * near the extremes. 0.0016 is the value that converges here without
 * oscillating; a larger step overshoots and the spread stops falling.
 */
const STEP = 0.0016;

/** Neither lever may run away to a value that is no longer a gameplan. A plan
 * whose overall quality has to sit 25% above the field to reach parity is not
 * balanced, it is broken somewhere in its held mods, and clamping here makes
 * that visible as a plan stuck off 50% rather than hiding it in a number. */
const MOD_MIN = 0.75;
const MOD_MAX = 1.25;

/**
 * Sample sizes, and they are large on purpose.
 *
 * Ten pairings per catalogue, each played twice, so one iteration is
 * 20 x REPEATS games and a single plan appears in 8 x REPEATS of them. The
 * first version of this file defaulted to 6 repeats - 48 games a plan - and
 * the solve did not converge, it wandered: the spread went 15.6, 28.1, 40.6
 * across three iterations because a win rate measured over 48 games carries
 * about +/-7 points of sampling error, and the step was chasing that rather
 * than the plan. A calibrator fitting to its own noise is worse than no
 * calibrator, because it produces numbers with a tool's name on them.
 *
 * At 80 repeats a plan is measured over 640 games, which is about +/-2 points,
 * and an iteration costs roughly three seconds.
 */
const PAIRS = Number(process.env.NFL_PLAN_PAIRS || 40);
const SOLVE_REPEATS = Number(process.env.NFL_PLAN_REPEATS || 80);
const FINAL_REPEATS = Number(process.env.NFL_PLAN_FINAL || 200);
const ITERATIONS = Number(process.env.NFL_PLAN_ITERS || 12);
/** The band scripts/verify-nfl-gameplans.mjs holds every plan to. Stopping
 * inside it rather than chasing zero avoids spending an hour of simulation
 * fitting to sampling noise. */
const TARGET_SPREAD = 6;

console.log(`drafting ${PAIRS} roster pairs...`);
const pairs = drawPairs(PAIRS);

const solved = {};
for (const group of ["offense", "defense"]) {
  const plans = group === "defense" ? DEFENSIVE_PLANS : OFFENSIVE_PLANS;
  const ids = plans.map((p) => p.id);
  const key = SOLVED_KEY[group];
  const baseline = ids[0]; // the balanced plan, held as the reference point
  const candidate = Object.fromEntries(plans.map((p) => [p.id, p.mods[key]]));

  console.log(`\n--- ${group} (solving \`${key}\`, ${ids.length} plans) ---`);
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const rates = winRates(group, candidate, pairs, SOLVE_REPEATS);
    const spread = Math.max(...Object.values(rates)) - Math.min(...Object.values(rates));
    console.log(
      `iter ${String(iter).padStart(2)}  spread ${spread.toFixed(1).padStart(5)}  ` +
        ids.map((id) => `${id.slice(0, 8)} ${rates[id].toFixed(0)}%/${candidate[id].toFixed(3)}`).join("  ")
    );
    if (spread < TARGET_SPREAD) break;
    for (const id of ids) {
      // The balanced plan is the fixed reference. Moving every plan including
      // the baseline lets the whole catalogue drift together while the spread
      // between them stays put - the solve would converge on nothing.
      if (id === baseline) continue;
      candidate[id] = Math.max(
        MOD_MIN,
        Math.min(MOD_MAX, +(candidate[id] - (rates[id] - 50) * STEP).toFixed(4))
      );
    }
  }
  solved[group] = candidate;
}

console.log("\nFINAL MODS (paste the solved key into each plan in js/sports/nfl/tactics.js):");
for (const group of ["offense", "defense"]) {
  const plans = group === "defense" ? DEFENSIVE_PLANS : OFFENSIVE_PLANS;
  const key = SOLVED_KEY[group];
  console.log(`  ${group}:`);
  for (const plan of plans) {
    console.log(`    ${plan.id.padEnd(20)} ${key}: ${solved[group][plan.id].toFixed(3)}`);
  }
}

console.log(`\nverification run (${FINAL_REPEATS} mirrored matchups per pairing):`);
let worst = 0;
for (const group of ["offense", "defense"]) {
  const plans = group === "defense" ? DEFENSIVE_PLANS : OFFENSIVE_PLANS;
  const rates = winRates(group, solved[group], pairs, FINAL_REPEATS);
  const spread = Math.max(...Object.values(rates)) - Math.min(...Object.values(rates));
  worst = Math.max(worst, spread);
  console.log(`  ${group}:`);
  for (const plan of plans) console.log(`    ${plan.id.padEnd(20)} ${rates[plan.id].toFixed(1)}%`);
  console.log(`    spread ${spread.toFixed(1)}`);
}
console.log(
  `\nworst spread ${worst.toFixed(1)} - scripts/verify-nfl-gameplans.mjs holds every plan to 40-60%.`
);
