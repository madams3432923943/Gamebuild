// NFL gameplans: one for offence, one for defence.
//
// The rule this is designed around is the one at the top of
// js/sports/nba/tactics.js, and it is not negotiable: a plan must be a real
// CHOICE, not a power gain. If one option is simply strongest, ranked stops
// measuring football knowledge and starts measuring whether you picked plan 3.
//
// WHY TWO CATALOGUES AND NOT ONE
//
// The ten mixed styles this replaces asked one question - "how does your team
// play?" - and answered it with a single card that moved offensive and
// defensive numbers at the same time. That is not how football is coached, and
// it made half of every choice a side effect: picking Air Raid silently
// declined to have a defensive plan, and picking Ball Hawks silently declined
// to have an offensive one. Worse, it made the two decisions compete for one
// slot, so a team that wanted to throw deep AND blitz could not say so.
//
// Splitting them makes both halves real. You choose how you attack and how you
// defend, independently, and the pair is what the simulation runs.
//
// FORMATIONS ARE NOT THIS. A gameplan is an INTENT ("throw it deep", "send
// pressure"). A formation is personnel on the field (11 personnel, nickel,
// cover 2). They are a separate future layer, deliberately not folded in here:
// these ids must keep meaning what they mean so that adding formations later
// is an addition rather than a reinterpretation. Do not turn these into
// formation ids.
//
// THE MOD VOCABULARY, and what each one does in the sim:
//
//   OFFENSIVE
//     off        overall quality of your attack
//     explosive  shifts scoring drives toward touchdowns rather than field goals
//     redZone    how often a trip inside the twenty finishes as a touchdown
//     security   your own turnover rate (higher is safer)
//     protection resistance to the pass rush, which is what sets sack rate
//     runShare   how often you actually hand it off, so a running team runs
//     pace       drives per game, so clock control really does shorten the game
//     fg         your kicker's accuracy
//
//   DEFENSIVE
//     def                  overall quality of your defence
//     takeaway             how often your defence ends a drive in a turnover
//     passRush             pressure, which converts drives into stops and sacks
//     coverage             the other half of pass defence
//     runDef               run defence, which shortens the opponent's drives
//     explosivePrevention  how well you keep a scoring drive to three points
//
// RE-SOLVED against TALENT_PARITY 0.95. The old values were solved - loosely -
// against a parity of 0.42, and raising it amplified every multiplier at once:
// Vertical Attack ran to a 65.7% win rate, which is precisely the auto-pick the
// rule below forbids. The plans that leaned hardest on a single dimension
// (explosiveness, red zone, explosive prevention, run defence) gave the most
// back, and balanced offence was raised because a baseline that loses to
// everything is not a baseline.
//
// RE-SOLVED AGAIN, against the yardage calibration. Making a drive that does
// not score gain twelve yards instead of twenty-five - which is what real ones
// gain - changed the field-position economy underneath every plan, because a
// punt from your own 38 hands the ball over near the opponent 24 rather than
// their 12. That is right, and it is worth about twelve yards a punt to the
// receiving team. The plans that pay for their edge in POSSESSIONS felt it
// hardest: Ground Control fell to a 33.5% win rate, which is a trap by the
// rule at the top of this file, so it was re-solved to 45% by paying for its
// slow pace in efficiency - red zone, ball security and protection - rather
// than by giving the pace back, which would have deleted what the plan is.
//
// Hand-solved, not calibrated. tools/calibrate-nfl-gamestyles.mjs still does
// not exist; scripts/verify-nfl-gameplans.mjs holds every plan to a 40-60%
// band, and a band is not a calibration.
//
// PROVISIONAL NUMBERS, SAID PLAINLY. Like the ten styles before them, the
// values below are authored placeholders that have NOT been through
// tools/calibrate-gamestyles.mjs. scripts/verify-nfl-gameplans.mjs holds them
// to a win-rate band so no plan is a trap or an auto-pick, but a band is not a
// calibration. Until the calibrator has run over these, plan choice is still
// partly a right answer rather than purely a read on your lineup.

/** How you attack. */
export const OFFENSIVE_PLANS = [
  { id: "balanced-offense", icon: "⚖️", name: "Balanced Offense",
    blurb: "No tilt either way.",
    up: ["+1 Offense", "+1 Ball Security"], down: ["-1 Explosive Plays"],
    mods: { off: 1.07, explosive: 0.97, redZone: 1.02, security: 1.04, protection: 1.05, runShare: 1.00, pace: 1.00, fg: 1.00 } },

  { id: "ground-control", icon: "🐏", name: "Ground Control",
    blurb: "Run it, shorten the game, take the air out of the ball.",
    up: ["+2 Rushing", "+2 Ball Control"], down: ["-2 Explosive Plays", "-1 Comeback Ability"],
    mods: { off: 1.14, explosive: 0.88, redZone: 1.20, security: 1.14, protection: 1.10, runShare: 1.50, pace: 0.96, fg: 1.00 } },

  { id: "west-coast", icon: "📋", name: "West Coast",
    blurb: "Short, accurate, keep the chains moving and the quarterback clean.",
    up: ["+2 Short Passing", "+2 Pass Protection"], down: ["-2 Deep Passing"],
    mods: { off: 1.09, explosive: 0.82, redZone: 0.98, security: 1.10, protection: 1.14, runShare: 0.90, pace: 1.02, fg: 1.00 } },

  { id: "vertical-attack", icon: "🚀", name: "Vertical Attack",
    blurb: "Take the top off. Your quarterback will get hit.",
    up: ["+2 Deep Passing", "+2 Big Plays"], down: ["-2 Pass Protection", "-1 Ball Security"],
    mods: { off: 1.01, explosive: 1.15, redZone: 1.00, security: 0.82, protection: 0.76, runShare: 0.55, pace: 1.04, fg: 1.00 } },

  { id: "power-red-zone", icon: "🎯", name: "Power Red Zone",
    blurb: "Grind it out inside the twenty. Touchdowns, not field goals.",
    up: ["+2 Red Zone Conversion", "+1 Rushing"], down: ["-1 Field Goal Reliance", "-1 Explosive Plays"],
    mods: { off: 0.99, explosive: 0.92, redZone: 1.16, security: 1.03, protection: 1.02, runShare: 1.25, pace: 0.96, fg: 0.94 } },
];

/** How you defend. */
export const DEFENSIVE_PLANS = [
  { id: "balanced-defense", icon: "🛡️", name: "Balanced Defense",
    blurb: "Sound everywhere, spectacular nowhere.",
    up: ["+1 Defense", "+1 Big Play Prevention"], down: ["-1 Takeaways"],
    mods: { def: 1.02, takeaway: 0.98, passRush: 1.01, coverage: 1.01, runDef: 1.01, explosivePrevention: 1.01 } },

  { id: "blitz-pressure", icon: "💥", name: "Blitz Pressure",
    blurb: "Send pressure, leave the corners on an island.",
    up: ["+2 Pass Rush", "+2 Sacks"], down: ["-2 Coverage", "-1 Big Play Prevention"],
    mods: { def: 1.02, takeaway: 1.14, passRush: 1.40, coverage: 0.78, runDef: 0.94, explosivePrevention: 0.88 } },

  { id: "run-wall", icon: "🧱", name: "Run Wall",
    blurb: "Wall off the run. Nothing through the middle.",
    up: ["+2 Run Defense", "+1 Defense"], down: ["-1 Coverage", "-1 Takeaways"],
    mods: { def: 1.01, takeaway: 0.98, passRush: 1.00, coverage: 0.92, runDef: 1.22, explosivePrevention: 1.00 } },

  { id: "ball-hawks", icon: "🦅", name: "Ball Hawks",
    blurb: "Chase the ball. Miss more tackles doing it.",
    up: ["+2 Interceptions", "+2 Forced Turnovers"], down: ["-2 Run Defense", "-1 Big Play Prevention"],
    mods: { def: 1.00, takeaway: 1.42, passRush: 1.00, coverage: 1.08, runDef: 0.78, explosivePrevention: 0.94 } },

  { id: "keep-it-in-front", icon: "🚧", name: "Keep It in Front",
    blurb: "Give up the short stuff. Nothing goes over your head.",
    up: ["+2 Big Play Prevention", "+1 Coverage"], down: ["-2 Takeaways", "-1 Pass Rush"],
    mods: { def: 1.01, takeaway: 0.86, passRush: 0.90, coverage: 1.07, runDef: 1.00, explosivePrevention: 1.15 } },
];

/**
 * The two decisions, declared as data so shared UI can render them without
 * knowing what football is. js/main.js reads this to lay out one section per
 * group; a sport that declares no groups keeps the single-card picker.
 */
export const STRATEGY_GROUPS = [
  { key: "offense", label: "Offensive Gameplan", hint: "How you attack.", plans: OFFENSIVE_PLANS },
  { key: "defense", label: "Defensive Gameplan", hint: "How you defend.", plans: DEFENSIVE_PLANS },
];

export const DEFAULT_STRATEGY = { offense: OFFENSIVE_PLANS[0].id, defense: DEFENSIVE_PLANS[0].id };

const OFFENSE_BY_ID = new Map(OFFENSIVE_PLANS.map((p) => [p.id, p]));
const DEFENSE_BY_ID = new Map(DEFENSIVE_PLANS.map((p) => [p.id, p]));

export const offensivePlanById = (id) => OFFENSE_BY_ID.get(id) || OFFENSIVE_PLANS[0];
export const defensivePlanById = (id) => DEFENSE_BY_ID.get(id) || DEFENSIVE_PLANS[0];

/** The plan for one group by id, so shared code can resolve a selection
 * without a switch on the group name. */
export function planFor(groupKey, id) {
  return groupKey === "defense" ? defensivePlanById(id) : offensivePlanById(id);
}

/**
 * A selection, normalised.
 *
 * Anything unrecognised becomes the balanced plan for that side rather than
 * undefined - a missing plan would multiply the engine by undefined, which is
 * NaN, which is a scoreless game nobody can explain. This is the ONE place
 * that decision is made, so an unknown id cannot mean different things to the
 * simulation and to the screen.
 */
export function normalizeStrategy(strategy) {
  const raw = typeof strategy === "string" ? { offense: strategy } : strategy || {};
  return {
    offense: offensivePlanById(raw.offense).id,
    defense: defensivePlanById(raw.defense).id,
  };
}

/** Both plans, resolved. */
export function plansFor(strategy) {
  const { offense, defense } = normalizeStrategy(strategy);
  return { offense: offensivePlanById(offense), defense: defensivePlanById(defense) };
}

/** What the opponent committed to. Each side is drawn independently, because a
 * bot that always paired the same offence with the same defence would make
 * half its plan predictable from the other half. */
export function randomStrategy(rand = Math.random) {
  return {
    offense: OFFENSIVE_PLANS[Math.floor(rand() * OFFENSIVE_PLANS.length)].id,
    defense: DEFENSIVE_PLANS[Math.floor(rand() * DEFENSIVE_PLANS.length)].id,
  };
}

/** "Vertical Attack / Blitz Pressure" - one line for the pregame and postgame
 * screens, so both sides' plans read the same way everywhere. */
export function formatStrategy(strategy) {
  const { offense, defense } = plansFor(strategy);
  return `${offense.name} / ${defense.name}`;
}

/** The wire format. An object, not two columns and not a joined string: the
 * shape that travels is the shape the engine reads, so nothing has to be
 * re-parsed into meaning on the way in. */
export const serializeStrategy = (strategy) => JSON.stringify(normalizeStrategy(strategy));

/** Tolerant of everything the server might still be storing: the new object,
 * a bare legacy tactic id, or nothing at all. Client code has to tolerate a
 * server that has not caught up (CLAUDE.md), and this is where that happens. */
export function parseStrategy(text) {
  if (!text) return { ...DEFAULT_STRATEGY };
  if (typeof text === "object") return normalizeStrategy(text);
  try {
    const parsed = JSON.parse(text);
    return normalizeStrategy(typeof parsed === "object" ? parsed : { offense: String(parsed) });
  } catch {
    // A legacy row holding a bare style id. It is not one of these plans, so
    // normalising it lands on balanced - which is the honest answer, rather
    // than pretending an Air Raid row was a Vertical Attack one.
    return { ...DEFAULT_STRATEGY };
  }
}

/** Neutral mods, for a side that never chose. Every key the engine reads must
 * exist here or a missing plan silently becomes a multiplier of undefined. */
export const NEUTRAL_MODS = {
  off: 1, explosive: 1, redZone: 1, security: 1, protection: 1, runShare: 1, pace: 1, fg: 1,
  def: 1, takeaway: 1, passRush: 1, coverage: 1, runDef: 1, explosivePrevention: 1,
};

// ---------------------------------------------------------------------------
// FIT: why there is no single right answer
// ---------------------------------------------------------------------------
//
// A flat multiplier makes one plan strongest for everybody, and then ranked
// measures whether you picked plan 5 rather than whether you know football.
// The fix is that a plan's strength depends on the ROSTER running it.
//
// Lamar Jackson is the clearest case: he rushes for more than most backs, so
// Ground Control with him is a different proposition than Ground Control with
// a statue at quarterback. A secondary full of ball hawks wants Ball Hawks;
// one that just tackles well does not.
//
// Each plan scores its own fit from the drafted roster, 0..1 with 0.5 neutral,
// and its mods are scaled by it - a plan you built for gets close to its full
// effect, one you did not gets a fraction. Nobody is punished for choosing
// "wrong", they simply get less of a bonus they were not set up for.

/** Percentile-ish helper: turns a raw per-game stat into 0..1 against a
 * plausible ceiling. Crude on purpose - fit only has to rank plans against
 * each other for one roster, not measure anything absolutely. */
const scale = (value, ceiling) => Math.max(0, Math.min(1, (Number(value) || 0) / ceiling));

const qb = (r) => r.QB || {};
const rb = (r) => r.RB || {};
const wrs = (r) => [r.WR1, r.WR2, r.WR3].filter(Boolean);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** How well each plan suits the roster that chose it. */
export const FIT = {
  // Suits everyone equally - that is what balanced means, and it is the
  // baseline the others are worth more or less than.
  "balanced-offense": () => 0.5,
  "balanced-defense": () => 0.5,

  // The Lamar Jackson case. A quarterback's OWN rushing counts as much as the
  // back's, because a running quarterback is what makes this frightening
  // rather than merely stubborn.
  "ground-control": (r) => 0.45 * scale(rb(r).rush_yds, 110) + 0.35 * scale(qb(r).rush_yds, 55) + 0.2 * scale(rb(r).rush_td, 1),

  // Accuracy and catch volume over yardage - the short game. The line matters
  // too, because keeping the quarterback clean is half of what this plan is.
  "west-coast": (r) => 0.4 * scale(mean(wrs(r).map((w) => w.rec)), 6.5) + 0.25 * scale((r.TE || {}).rec, 5) + 0.2 * (1 - scale(qb(r).ints, 1.4)) + 0.15 * scale((r.OL || {}).rating, 100),

  // Yards per target is the separation proxy the dataset actually has.
  "vertical-attack": (r) => 0.6 * scale(mean(wrs(r).map((w) => w.ypt)), 10.5) + 0.4 * scale(qb(r).pass_td, 2.2),

  // Short-yardage power: a back who finishes drives, behind a line.
  "power-red-zone": (r) => 0.5 * scale(rb(r).rush_td, 1) + 0.3 * scale((r.OL || {}).rating, 100) + 0.2 * scale((r.TE || {}).rec_td, 0.6),

  "blitz-pressure": (r) => 0.7 * scale((r.DL || {}).sacks, 3) + 0.3 * scale((r.LB || {}).sacks, 1.5),
  "run-wall": (r) => 0.6 * scale((r.DL || {}).tackles, 14) + 0.4 * scale((r.LB || {}).tackles, 19),
  "ball-hawks": (r) => 0.4 * scale((r.S || {}).ints, 0.55) + 0.4 * scale((r.CB || {}).ints, 0.7) + 0.2 * scale((r.LB || {}).ff, 0.4),
  "keep-it-in-front": (r) => 0.5 * scale((r.CB || {}).pd, 3) + 0.5 * scale((r.S || {}).pd, 2.2),
};

export const fitFor = (plan, roster) => {
  const fn = FIT[plan?.id];
  if (!fn || !roster) return 0.5;
  const v = fn(roster);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
};

/** One plan's mods, scaled by how well the roster suits it. A perfect fit gets
 * the full modifier, a poor one gets about a third - and the DOWNSIDES scale
 * too, so a plan you are not built for is weak rather than actively punishing.
 * That keeps a wrong choice a missed opportunity instead of a trap. */
function scalePlan(plan, roster, into) {
  const strength = 0.35 + 1.3 * fitFor(plan, roster);
  for (const [key, value] of Object.entries(plan?.mods || {})) {
    into[key] = 1 + (value - 1) * strength;
  }
  return into;
}

/**
 * One side's complete modifier bag, from BOTH of its plans.
 *
 * The two catalogues write disjoint keys - offence never sets `coverage`,
 * defence never sets `runShare` - so composing them is a merge rather than a
 * negotiation, and the engine keeps reading one bag per side exactly as it did
 * when there was one plan.
 */
export function composedModsFor(strategy, roster) {
  const { offense, defense } = plansFor(strategy);
  const out = { ...NEUTRAL_MODS };
  scalePlan(offense, roster, out);
  scalePlan(defense, roster, out);
  return out;
}
