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
  { id: "balanced", name: "Balanced",
    up: ["+1 Offense", "+1 Defense"], down: ["-1 Explosive Plays", "-1 Specialization"],
    mods: { off: 1.04, def: 1.04, explosive: 0.92, security: 1, takeaway: 1, passRush: 1, coverage: 1, runDef: 1, fg: 1, pace: 1 } },

  { id: "air-raid", name: "Air Raid",
    up: ["+2 Passing", "+2 Big Play Passing"], down: ["-2 Rushing", "-1 Time of Possession"],
    mods: { off: 1.1, def: 1, explosive: 1.18, security: 0.94, takeaway: 1, passRush: 1, coverage: 1, runDef: 1, fg: 1, pace: 1.08 } },

  { id: "ground-and-pound", name: "Ground & Pound",
    up: ["+2 Rushing", "+2 Ball Control"], down: ["-2 Deep Passing", "-1 Comeback Ability"],
    mods: { off: 1.05, def: 1, explosive: 0.82, security: 1.12, takeaway: 1, passRush: 1, coverage: 1, runDef: 1, fg: 1, pace: 0.88 } },

  { id: "west-coast", name: "West Coast Offense",
    up: ["+2 Short Passing", "+2 QB Accuracy"], down: ["-2 Deep Passing", "-1 Explosive Plays"],
    mods: { off: 1.09, def: 1, explosive: 0.8, security: 1.08, takeaway: 1, passRush: 1, coverage: 1, runDef: 1, fg: 1, pace: 1 } },

  { id: "vertical-attack", name: "Vertical Attack",
    up: ["+2 Deep Passing", "+2 WR Separation"], down: ["-2 Sack Avoidance", "-1 Ball Security"],
    mods: { off: 1.08, def: 1, explosive: 1.26, security: 0.85, takeaway: 1, passRush: 1, coverage: 1, runDef: 1, fg: 1, pace: 1 } },

  { id: "lockdown-defense", name: "Lockdown Defense",
    up: ["+2 Pass Defense", "+2 Coverage"], down: ["-2 Offensive Production", "-1 Pace"],
    mods: { off: 0.9, def: 1.1, explosive: 1, security: 1, takeaway: 1, passRush: 1, coverage: 1.3, runDef: 1, fg: 1, pace: 0.94 } },

  { id: "blitz-brigade", name: "Blitz Brigade",
    up: ["+2 Pass Rush", "+2 Sacks"], down: ["-2 Pass Coverage", "-1 Big Play Prevention"],
    mods: { off: 1, def: 1.02, explosive: 1, security: 1, takeaway: 1.12, passRush: 1.35, coverage: 0.74, runDef: 1, fg: 1, pace: 1 } },

  { id: "steel-curtain", name: "Steel Curtain",
    up: ["+2 Run Defense", "+2 Tackling"], down: ["-2 Passing Offense", "-1 Tempo"],
    mods: { off: 0.92, def: 1.08, explosive: 1, security: 1, takeaway: 1, passRush: 1, coverage: 1, runDef: 1.32, fg: 1, pace: 0.92 } },

  { id: "ball-hawks", name: "Ball Hawks",
    up: ["+2 Interceptions", "+2 Forced Turnovers"], down: ["-2 Tackling", "-1 Run Defense"],
    mods: { off: 1, def: 1, explosive: 1, security: 1, takeaway: 1.42, passRush: 1, coverage: 1.05, runDef: 0.76, fg: 1, pace: 1 } },

  { id: "special-teams-edge", name: "Special Teams Edge",
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
