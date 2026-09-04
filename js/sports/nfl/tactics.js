// NFL gameplans: one for offense, one for defense.
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
//     def                  overall quality of your defense
//     takeaway             how often your defense ends a drive in a turnover
//     passRush             pressure, which converts drives into stops and sacks
//     coverage             the other half of pass defense
//     runDef               run defense, which shortens the opponent's drives
//     explosivePrevention  how well you keep a scoring drive to three points
//
// SOLVED, by tools/calibrate-nfl-gamestyles.mjs. Everything below this line
// used to be a list of apologies for that tool not existing - "Hand-solved,
// not calibrated", "PROVISIONAL NUMBERS, SAID PLAINLY", "a band is not a
// calibration". It exists, it has run, and these are its numbers.
//
// WHAT IT SOLVES AND WHAT IT LEAVES ALONE
//
// One lever per catalogue: `off` for an offensive plan, `def` for a defensive
// one. Those are the only two mods that move a win rate without changing what
// the plan IS. The other thirteen - explosive, redZone, security, protection,
// runShare, pace, fg, takeaway, passRush, coverage, runDef,
// explosivePrevention - are the plan's identity and are held exactly as
// authored. Ground Control's 1.50 runShare is not a balance number, it is the
// reason anyone picks Ground Control, and solving it away would leave a plan
// by that name that no longer runs the ball. Basketball draws the same line
// (it solves `pts` and holds reb/ast/stl/blk/tov) for the same reason.
//
// So a plan that came in too strong pays for it in raw quality and keeps its
// character. That is also the honest trade to offer a player: the plan is not
// worse at the thing it does, it is worse at everything else.
//
// WHAT MOVED, AND WHY IT HAD TO
//
// Ground Control 1.14 -> 1.070 and Power Red Zone 0.99 -> 1.039 are the two
// large ones, and they are large in opposite directions because the hand-solve
// they replace was fitted to an engine with three faults in it: the quarter
// variance did nothing, `edge` carried a systematic scoring lift that moved
// with TALENT_PARITY, and RUN_SHARE sat above its own documented value so
// every running plan was measured through a run game that was already too
// heavy. Ground Control was overpaid for a pace cost it was not really paying;
// Power Red Zone was underpaid for a field-goal penalty that mattered more
// than it looked. Both are commits in the history of this branch, and neither
// could have been found by adjusting these numbers.
//
// Run tools/calibrate-nfl-variance.mjs FIRST and this second, every time
// either engine changes. That order is not a preference: a plan's win rate is
// measured against whatever noise floor the engine has at the time, so plans
// solved before the variance range is settled are solved against the wrong
// floor. The two previous re-solves recorded here - Vertical Attack at 65.7%
// after a parity change, Ground Control at 33.5% after a yardage change - are
// both that mistake.
//
// Verified over 4,000 mirrored matchups per catalogue: every plan lands
// between 47% and 53%, against the 40-60% band
// scripts/verify-nfl-gameplans.mjs enforces.

/** How you attack. */
export const OFFENSIVE_PLANS = [
  { id: "balanced-offense", icon: "⚖️", name: "Balanced Offense",
    blurb: "No tilt either way.",
    up: ["+1 Offense", "+1 Ball Security"], down: ["-1 Explosive Plays"],
    mods: { off: 1.070, explosive: 0.97, redZone: 1.02, security: 1.04, protection: 1.05, runShare: 1.00, pace: 1.00, fg: 1.00 } },

  { id: "ground-control", icon: "🐏", name: "Ground Control",
    blurb: "Run it, shorten the game, take the air out of the ball.",
    up: ["+2 Rushing", "+2 Ball Control"], down: ["-2 Explosive Plays", "-1 Comeback Ability"],
    mods: { off: 1.070, explosive: 0.88, redZone: 1.20, security: 1.14, protection: 1.10, runShare: 1.50, pace: 0.96, fg: 1.00 } },

  { id: "west-coast", icon: "📋", name: "West Coast",
    blurb: "Short, accurate, keep the chains moving and the quarterback clean.",
    up: ["+2 Short Passing", "+2 Pass Protection"], down: ["-2 Deep Passing"],
    mods: { off: 1.090, explosive: 0.82, redZone: 0.98, security: 1.10, protection: 1.14, runShare: 0.90, pace: 1.02, fg: 1.00 } },

  { id: "vertical-attack", icon: "🚀", name: "Vertical Attack",
    blurb: "Take the top off. Your quarterback will get hit.",
    up: ["+2 Deep Passing", "+2 Big Plays"], down: ["-2 Pass Protection", "-1 Ball Security"],
    mods: { off: 1.038, explosive: 1.15, redZone: 1.00, security: 0.82, protection: 0.76, runShare: 0.55, pace: 1.04, fg: 1.00 } },

  { id: "power-red-zone", icon: "🎯", name: "Power Red Zone",
    blurb: "Grind it out inside the twenty. Touchdowns, not field goals.",
    up: ["+2 Red Zone Conversion", "+1 Rushing"], down: ["-1 Field Goal Reliance", "-1 Explosive Plays"],
    mods: { off: 1.039, explosive: 0.92, redZone: 1.16, security: 1.03, protection: 1.02, runShare: 1.25, pace: 0.96, fg: 0.94 } },
];

/** How you defend. */
export const DEFENSIVE_PLANS = [
  { id: "balanced-defense", icon: "🛡️", name: "Balanced Defense",
    blurb: "Sound everywhere, spectacular nowhere.",
    up: ["+1 Defense", "+1 Big Play Prevention"], down: ["-1 Takeaways"],
    mods: { def: 1.020, takeaway: 0.98, passRush: 1.01, coverage: 1.01, runDef: 1.01, explosivePrevention: 1.01 } },

  { id: "blitz-pressure", icon: "💥", name: "Blitz Pressure",
    blurb: "Send pressure, leave the corners on an island.",
    up: ["+2 Pass Rush", "+2 Sacks"], down: ["-2 Coverage", "-1 Big Play Prevention"],
    mods: { def: 1.012, takeaway: 1.14, passRush: 1.40, coverage: 0.78, runDef: 0.94, explosivePrevention: 0.88 } },

  { id: "run-wall", icon: "🧱", name: "Run Wall",
    blurb: "Wall off the run. Nothing through the middle.",
    up: ["+2 Run Defense", "+1 Defense"], down: ["-1 Coverage", "-1 Takeaways"],
    mods: { def: 0.982, takeaway: 0.98, passRush: 1.00, coverage: 0.92, runDef: 1.22, explosivePrevention: 1.00 } },

  { id: "ball-hawks", icon: "🦅", name: "Ball Hawks",
    blurb: "Chase the ball. Miss more tackles doing it.",
    up: ["+2 Interceptions", "+2 Forced Turnovers"], down: ["-2 Run Defense", "-1 Big Play Prevention"],
    mods: { def: 1.025, takeaway: 1.42, passRush: 1.00, coverage: 1.08, runDef: 0.78, explosivePrevention: 0.94 } },

  { id: "keep-it-in-front", icon: "🚧", name: "Keep It in Front",
    blurb: "Give up the short stuff. Nothing goes over your head.",
    up: ["+2 Big Play Prevention", "+1 Coverage"], down: ["-2 Takeaways", "-1 Pass Rush"],
    mods: { def: 1.017, takeaway: 0.86, passRush: 0.90, coverage: 1.07, runDef: 1.00, explosivePrevention: 1.15 } },
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

/** A plan by id across BOTH catalogues, or null.
 *
 * Deliberately not planFor(): that one falls back to the balanced plan for an
 * unknown id, which is right for the engine - a missing plan would multiply it
 * by undefined and produce a scoreless game nobody can explain - and wrong for
 * anything asking "what is this id called", which got "Balanced Offense" as the
 * name of Run Wall. A lookup for display has to be able to say "no". */
export function planById(id) {
  if (!id) return null;
  return (
    OFFENSIVE_PLANS.find((p) => p.id === id) ||
    DEFENSIVE_PLANS.find((p) => p.id === id) ||
    null
  );
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
 * bot that always paired the same offense with the same defense would make
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

// ---------------------------------------------------------------------------
// AFFINITY: the plan a player was made for, which you are not told
// ---------------------------------------------------------------------------
//
// FIT above reads the roster as a whole, from stats that are on the card. That
// makes plan choice a calculation: a player who studies the numbers can work
// out the best plan before kickoff, every time, and a decision with a knowable
// right answer is a lookup rather than a read.
//
// Affinity is the part you cannot look up. Every drafted player and unit has
// ONE plan they are built for, derived from their own line rather than the
// roster's, and it is not shown on the draft board. Choosing a plan several of
// your players were made for is worth more than the roster averages suggest -
// so a lineup rewards being learned, and two teams with identical aggregate
// numbers can want different plans.
//
// DERIVED, NOT ASSIGNED. It is a deterministic function of the player's own
// stats, for three reasons: a random affinity would be fabricated data, which
// CLAUDE.md forbids outright; it has to be identical on the client and in the
// Edge Function or online games diverge from offline ones (verify:nfl-parity);
// and a Lamar Jackson whose affinity is Vertical Attack this week and Ground
// Control next week is not a thing to learn, it is noise.
//
// It is revealed AFTER the game, in the recap, so the knowledge is earned by
// playing rather than by reading a table.

/** How well one entry, on its own, suits each plan. Same shape as FIT, but
 *  reading a single player's line rather than the roster's. Deliberately a
 *  different set of questions from FIT's: FIT asks "can this roster run this",
 *  affinity asks "is this the plan this player was born for". */
// Ceilings are the 90th percentile of each stat among the entries that record
// it at all, measured over the shipped dataset - so "1.0 on this term" means
// "top tenth of the league at it" for every term, and the eight plans are
// scored on the same scale. Guessed ceilings do not work here: the first pass
// used round numbers and produced 3,248 West Coast players against 6 for Power
// Red Zone, which is not eight plans, it is two.
//
// `comp` was in that first pass too. No entry in the dataset carries it, so
// that term contributed exactly zero to every West Coast score - the quiet kind
// of wrong that still returns a plausible number.
/** Touchdowns per ten yards of offense. The discriminator between a back who
 *  finishes drives and one who merely gains ground. Guarded against a tiny
 *  denominator: six yards and one touchdown is not a red-zone specialist, it is
 *  one carry. */
function touchdownRate(entry) {
  const yards = (Number(entry.rush_yds) || 0) + (Number(entry.rec_yds) || 0);
  if (yards <= 5) return 0;
  const tds = (Number(entry.rush_td) || 0) + (Number(entry.rec_td) || 0);
  return tds / (yards / 10);
}

const AFFINITY = {
  "ground-control": (e) => 0.6 * scale(e.rush_yds, 60) + 0.4 * scale(e.rush_td, 0.62),
  // No `ints` term: a receiver has none, so "does not throw interceptions"
  // would hand every wideout most of a West Coast affinity for free.
  "west-coast": (e) => 0.7 * scale(e.rec, 5.9) + 0.3 * scale(e.rec_yds, 50),
  // ypt has a 1165 in it - a single catch on a single target - so it is read
  // only alongside real volume. scale() clamps, but a clamped outlier is still
  // a 1.0 for someone who caught one pass.
  "vertical-attack": (e) => 0.5 * scale(e.ypt, 9.5) + 0.3 * scale(e.pass_td, 1.94) + 0.2 * scale(e.rec_yds, 55),
  // Scoring RATE, not scoring volume - otherwise this is Ground Control with a
  // different name, because the back with the most touchdowns is usually also
  // the one with the most yards, and Ground Control's rush_yds term outbids it
  // every time. First pass produced 16 Power Red Zone players in 14,388.
  // A goal-line back is defined by finishing drives per yard gained, which is
  // exactly what the plan is about.
  "power-red-zone": (e) => 0.5 * scale(touchdownRate(e), 0.149) + 0.3 * scale(e.rush_td, 0.62) + 0.2 * scale(e.rec_td, 0.5),
  "blitz-pressure": (e) => scale(e.sacks, 1.63),
  "run-wall": (e) => scale(e.tackles, 20.9),
  "ball-hawks": (e) => 0.6 * scale(e.ints, 0.94) + 0.4 * scale(e.ff, 0.47),
  "keep-it-in-front": (e) => scale(e.pd, 2.31),
};

/** Below this, a player is not "made for" anything - they are simply a player.
 *  Without a floor every entry would claim an affinity, including the ones
 *  whose best score is 0.04, and a bonus everybody carries is not a bonus. */
const AFFINITY_FLOOR = 0.5;

/** The most a full roster of specialists can add to a plan's fit. Small on
 *  purpose: this is a reward for reading your lineup, not a second, larger
 *  version of FIT. At 0.12 a perfectly-matched roster moves scalePlan's
 *  strength by about 0.16, which is a noticeable edge and not a decisive one. */
const AFFINITY_WEIGHT = 0.12;

/**
 * The one plan this entry was built for, or null.
 *
 * Exported so the recap can reveal it after the whistle - nothing before the
 * game may call this, and nothing in the draft UI does.
 */
export function affinityFor(entry) {
  if (!entry) return null;
  let bestId = null;
  let bestScore = 0;
  for (const [id, score] of Object.entries(AFFINITY)) {
    const value = Number(score(entry)) || 0;
    // Ties break by id order rather than by whichever key enumerated first,
    // so the answer does not depend on object ordering across engines.
    if (value > bestScore || (value === bestScore && bestId && id < bestId)) {
      bestScore = value;
      bestId = id;
    }
  }
  return bestScore >= AFFINITY_FLOOR ? bestId : null;
}

/**
 * Who on this roster was built for the plans it actually ran - the reveal.
 *
 * Returns [{ slot, name, plan }] for the matches only. This is the payoff for
 * affinity being hidden: you find out after the whistle that your third
 * receiver was made for the Vertical Attack you happened to call, and next time
 * you know it before you call it.
 *
 * Both plans are checked, so a defensive specialist can show up here too.
 */
export function affinityRevealFor(strategy, roster) {
  const { offense, defense } = plansFor(strategy);
  const ran = new Set([offense?.id, defense?.id].filter(Boolean));
  const out = [];
  for (const [slot, entry] of Object.entries(roster || {})) {
    if (!entry) continue;
    const plan = affinityFor(entry);
    if (plan && ran.has(plan)) out.push({ slot, name: entry.name, plan });
  }
  return out;
}

/** The share of a roster built for this plan, 0..1. */
function affinityShare(planId, roster) {
  const entries = Object.values(roster || {}).filter(Boolean);
  if (!entries.length) return 0;
  const matched = entries.filter((entry) => affinityFor(entry) === planId).length;
  return matched / entries.length;
}

export const fitFor = (plan, roster) => {
  const fn = FIT[plan?.id];
  if (!fn || !roster) return 0.5;
  const v = fn(roster);
  const base = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
  // Added on top of the visible fit rather than replacing it, and clamped, so
  // a plan can never exceed the ceiling scalePlan already solves against.
  return Math.max(0, Math.min(1, base + AFFINITY_WEIGHT * affinityShare(plan?.id, roster)));
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
 * The two catalogues write disjoint keys - offense never sets `coverage`,
 * defense never sets `runShare` - so composing them is a merge rather than a
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
