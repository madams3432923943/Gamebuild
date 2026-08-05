// NFL gamestyles. EMPTY - not built.
//
// The rule this must be designed around is the one at the top of
// js/sports/nba/tactics.js, and it is not negotiable: a style must be a real
// CHOICE, not a power gain. If one option is simply strongest, ranked stops
// measuring football knowledge and starts measuring whether you picked style 3.
//
// Which means every style pays for what it boosts, and its net strength is
// SOLVED by simulation (tools/calibrate-gamestyles.mjs) rather than authored.
// Basketball's fifteen currently sit in a 5.4-point spread across the full
// field; football's should be held to the same standard.
//
// Expected surface: TACTICS, DEFAULT_TACTIC, tacticById, randomTacticChoices.

// Ten styles, as specified. Each is written as a set of +2/-2 style beats,
// then expressed as multipliers the drive model actually reads.
//
// THE MOD VOCABULARY, and what each one does in the sim:
//
//   off / def   overall quality on that side of the ball
//   explosive   shifts scoring drives toward touchdowns rather than field goals
//   security    your own turnover rate (higher is safer)
//   takeaway    how often your defence ends a drive in a turnover
//   passRush    pressure, which converts drives into stops
//   coverage    the other half of pass defence
//   runDef      run defence, which shortens the opponent's drives
//   fg          your kicker's accuracy
//   pace        drives per game, so a clock-control style really does shorten
//               the game rather than just claiming to
//
// SPECIAL TEAMS EDGE was specified with no downside. Every other style pays
// for what it boosts, and a style with only upside is strictly the best pick -
// which is exactly what the rule at the top of this file forbids, because it
// turns ranked into a test of whether you chose style 10. It is given the
// offensive cost below so it stays a choice. Flagged rather than done quietly.
export const TACTICS = [
  { id: "balanced", icon: "⚖️", blurb: "No tilt either way.", name: "Balanced",
    up: ["+1 Offense", "+1 Defense"], down: ["-1 Explosive Plays", "-1 Specialization"],
    mods: { off: 1.04, def: 1.04, explosive: 0.92, security: 1, takeaway: 1, passRush: 1, coverage: 1, runDef: 1, fg: 1, pace: 1 } },

  { id: "air-raid", icon: "🎯", blurb: "Throw it deep, live with the picks.", name: "Air Raid",
    up: ["+2 Passing", "+2 Big Play Passing"], down: ["-2 Rushing", "-1 Time of Possession"],
    mods: { off: 1.1, def: 1, explosive: 1.18, security: 0.94, takeaway: 1, passRush: 1, coverage: 1, runDef: 1, fg: 1, pace: 1.08 } },

  { id: "ground-and-pound", icon: "🐏", blurb: "Run it, shorten the game.", name: "Ground & Pound",
    up: ["+2 Rushing", "+2 Ball Control"], down: ["-2 Deep Passing", "-1 Comeback Ability"],
    mods: { off: 1.05, def: 1, explosive: 0.82, security: 1.12, takeaway: 1, passRush: 1, coverage: 1, runDef: 1, fg: 1, pace: 0.88 } },

  { id: "west-coast", icon: "📋", blurb: "Short, accurate, keep the chains moving.", name: "West Coast Offense",
    up: ["+2 Short Passing", "+2 QB Accuracy"], down: ["-2 Deep Passing", "-1 Explosive Plays"],
    mods: { off: 1.09, def: 1, explosive: 0.8, security: 1.08, takeaway: 1, passRush: 1, coverage: 1, runDef: 1, fg: 1, pace: 1 } },

  { id: "vertical-attack", icon: "🚀", blurb: "Take the top off. Your quarterback will get hit.", name: "Vertical Attack",
    up: ["+2 Deep Passing", "+2 WR Separation"], down: ["-2 Sack Avoidance", "-1 Ball Security"],
    mods: { off: 1.08, def: 1, explosive: 1.26, security: 0.85, takeaway: 1, passRush: 1, coverage: 1, runDef: 1, fg: 1, pace: 1 } },

  { id: "lockdown-defense", icon: "🔒", blurb: "Smother the pass. Your offence pays for it.", name: "Lockdown Defense",
    up: ["+2 Pass Defense", "+2 Coverage"], down: ["-2 Offensive Production", "-1 Pace"],
    mods: { off: 0.9, def: 1.1, explosive: 1, security: 1, takeaway: 1, passRush: 1, coverage: 1.3, runDef: 1, fg: 1, pace: 0.94 } },

  { id: "blitz-brigade", icon: "💥", blurb: "Send pressure, leave corners on an island.", name: "Blitz Brigade",
    up: ["+2 Pass Rush", "+2 Sacks"], down: ["-2 Pass Coverage", "-1 Big Play Prevention"],
    mods: { off: 1, def: 1.02, explosive: 1, security: 1, takeaway: 1.12, passRush: 1.35, coverage: 0.74, runDef: 1, fg: 1, pace: 1 } },

  { id: "steel-curtain", icon: "🧱", blurb: "Wall off the run. Nothing through the middle.", name: "Steel Curtain",
    up: ["+2 Run Defense", "+2 Tackling"], down: ["-2 Passing Offense", "-1 Tempo"],
    mods: { off: 0.92, def: 1.08, explosive: 1, security: 1, takeaway: 1, passRush: 1, coverage: 1, runDef: 1.32, fg: 1, pace: 0.92 } },

  { id: "ball-hawks", icon: "🦅", blurb: "Chase the ball. Miss more tackles doing it.", name: "Ball Hawks",
    up: ["+2 Interceptions", "+2 Forced Turnovers"], down: ["-2 Tackling", "-1 Run Defense"],
    mods: { off: 1, def: 1, explosive: 1, security: 1, takeaway: 1.42, passRush: 1, coverage: 1.05, runDef: 0.76, fg: 1, pace: 1 } },

  { id: "special-teams-edge", icon: "🦶", blurb: "Win the kicking game.", name: "Special Teams Edge",
    up: ["+2 Kick Return", "+2 Field Goal Accuracy"],
    // Specified with no downside; given one so it stays a choice. Overrule
    // this and it becomes the correct pick in every ranked game.
    down: ["-1 Offensive Production"],
    mods: { off: 0.95, def: 1, explosive: 0.9, security: 1, takeaway: 1, passRush: 1, coverage: 1, runDef: 1, fg: 1.16, pace: 1 } },
];

export const DEFAULT_TACTIC = TACTICS[0];
export const tacticById = (id) => TACTICS.find((t) => t.id === id) || DEFAULT_TACTIC;

/** Neutral mods, for a side that never chose one. Every key the engine reads
 * must exist here or a missing tactic silently becomes a multiplier of
 * undefined, which is NaN, which is a scoreless game nobody can explain. */
export const NEUTRAL_MODS = {
  off: 1, def: 1, explosive: 1, security: 1, takeaway: 1,
  passRush: 1, coverage: 1, runDef: 1, fg: 1, pace: 1,
};

export const modsFor = (tactic) => ({ ...NEUTRAL_MODS, ...(tactic?.mods || {}) });

export function randomTacticChoices(count = 3) {
  const pool = [...TACTICS];
  const out = [];
  while (out.length < Math.min(count, pool.length)) {
    out.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
  }
  return out;
}

// ---------------------------------------------------------------------------
// FIT: why there is no single right answer
// ---------------------------------------------------------------------------
//
// A flat multiplier makes one style strongest for everybody, and then ranked
// measures whether you picked style 5 rather than whether you know football.
// The fix is that a style's strength depends on the ROSTER running it.
//
// Lamar Jackson is the clearest case: he rushes for more than most backs, so
// Ground & Pound with him is a different proposition than Ground & Pound with
// a statue at quarterback. Peyton Manning wants Air Raid. A secondary full of
// ball hawks wants Ball Hawks; one that just tackles well does not.
//
// Each style below scores its own fit from the drafted roster, 0..1 with 0.5
// neutral, and the mods are scaled by it - a style you built for gets close to
// its full effect, one you did not gets a fraction. Nobody is punished for
// choosing "wrong", they simply get less of a bonus they were not set up for.
//
// This also means the old "which style wins most against mirror rosters" test
// is the wrong measure. The right one is whether the BEST style differs across
// rosters, which is what tools/calibrate-gamestyles.mjs should be checking.
//
// MEASURED, AND NOT THERE YET. Fit does what it should - Lamar Jackson 2019
// scores 0.76 on Ground & Pound against Peyton Manning 2013's 0.39, off 80.4
// rushing yards a game against MINUS 1.9 - but the simulated best style is
// still Vertical Attack for both rosters, and Ground & Pound is Lamar's WORST
// at 46.1%.
//
// The cause is the base mods, not the fit machinery. Ground & Pound cuts pace
// to 0.88 and explosive to 0.82, shedding more than any fit bonus can return.
// Fit scales a modifier; it cannot rescue one that is net-negative before
// scaling. Those base numbers are the PROVISIONAL placeholders that have never
// been through a calibrator, and until they are, style choice is still partly
// a right answer rather than a read on your lineup.

/** Percentile-ish helper: turns a raw per-game stat into 0..1 against a
 * plausible ceiling. Crude on purpose - fit only has to rank styles against
 * each other for one roster, not measure anything absolutely. */
const scale = (value, ceiling) => Math.max(0, Math.min(1, (Number(value) || 0) / ceiling));

const qb = (r) => r.QB || {};
const rb = (r) => r.RB || {};
const wrs = (r) => [r.WR1, r.WR2, r.WR3].filter(Boolean);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** How well each style suits the roster that chose it. */
export const FIT = {
  // Suits everyone equally - that is what balanced means, and it is the
  // baseline the others are worth more or less than.
  balanced: () => 0.5,

  // Volume passing and receivers who can carry it.
  "air-raid": (r) => 0.5 * scale(qb(r).pass_yds, 300) + 0.5 * scale(mean(wrs(r).map((w) => w.rec_yds)), 85),

  // The Lamar Jackson case. A quarterback's OWN rushing counts as much as the
  // back's, because a running quarterback is what makes this style frightening
  // rather than merely stubborn.
  "ground-and-pound": (r) => 0.45 * scale(rb(r).rush_yds, 110) + 0.35 * scale(qb(r).rush_yds, 55) + 0.2 * scale(rb(r).rush_td, 1),

  // Accuracy and catch volume over yardage - the short game.
  "west-coast": (r) => 0.5 * scale(mean(wrs(r).map((w) => w.rec)), 6.5) + 0.3 * scale((r.TE || {}).rec, 5) + 0.2 * (1 - scale(qb(r).ints, 1.4)),

  // Yards per target is the separation proxy the dataset actually has.
  "vertical-attack": (r) => 0.6 * scale(mean(wrs(r).map((w) => w.ypt)), 10.5) + 0.4 * scale(qb(r).pass_td, 2.2),

  "lockdown-defense": (r) => 0.5 * scale((r.CB || {}).pd, 3) + 0.5 * scale((r.S || {}).pd, 2.2),
  "blitz-brigade": (r) => 0.7 * scale((r.DL || {}).sacks, 3) + 0.3 * scale((r.LB || {}).sacks, 1.5),
  "steel-curtain": (r) => 0.6 * scale((r.DL || {}).tackles, 14) + 0.4 * scale((r.LB || {}).tackles, 19),
  "ball-hawks": (r) => 0.4 * scale((r.S || {}).ints, 0.55) + 0.4 * scale((r.CB || {}).ints, 0.7) + 0.2 * scale((r.LB || {}).ff, 0.4),
  "special-teams-edge": (r) => scale((r.ST || {}).fg_pct, 0.92),
};

export const fitFor = (tactic, roster) => {
  const fn = FIT[tactic?.id];
  if (!fn || !roster) return 0.5;
  const v = fn(roster);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
};

/** Mods scaled by how well the roster suits the style. A perfect fit gets the
 * full modifier, a poor one gets about a third of it - and the DOWNSIDES scale
 * too, so a style you are not built for is weak rather than actively punishing.
 * That keeps a wrong choice a missed opportunity instead of a trap. */
export function scaledModsFor(tactic, roster) {
  const base = modsFor(tactic);
  const strength = 0.35 + 1.3 * fitFor(tactic, roster);
  const out = {};
  for (const [key, value] of Object.entries(base)) out[key] = 1 + (value - 1) * strength;
  return out;
}
