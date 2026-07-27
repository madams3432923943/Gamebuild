// Pre-game tactics. Five permanent options, chosen before tip-off.
//
// The one rule these are designed around: a tactic must be a real choice, not
// a power gain. If one option were simply strongest, ranked would stop
// measuring basketball knowledge and start measuring whether you picked
// Tactic 3. So every tactic pays for what it boosts, and the multipliers below
// are deliberately near-neutral in total - what changes is WHERE your
// production comes from, which matters because it interacts with the roster
// you drafted and the one you're facing.
//
// Rough counters, though nothing is a hard rock-paper-scissors:
//  - Run and Gun outruns slow teams but bleeds turnovers, which Full Court
//    Press feeds on.
//  - Full Court Press smothers ball-dominant rosters but gives up the glass,
//    which Pound the Glass punishes.
//  - Pound the Glass overpowers small lineups but is slow, so Run and Gun can
//    outscore it.
//  - Motion Offense beats packed-in defenses but needs passers to work.
//  - Balanced gives up the extremes and is never badly countered.

/** Multipliers folded into a player's stats before matchups are evaluated
 * (see effectiveStats in engine.js). Above 1 helps, except `tov` where higher
 * means more giveaways.
 *
 * The identity stats were chosen by hand; the `pts` values were then SOLVED
 * for by simulation, because points are the only thing this engine converts
 * directly into wins. Hand-picked scoring bonuses made Run and Gun win 65% of
 * everything - a 12% scoring boost simply outweighed any defensive counter.
 * Calibrating pts against the field brought all five to 48.8-52.5% over 5,200
 * games, so which tactic wins depends on the rosters, not the menu. */
export const TACTICS = [
  {
    id: "balanced",
    name: "Balanced",
    icon: "⚖️",
    blurb: "No strengths, no holes. Never badly countered.",
    mods: { pts: 1, reb: 1, ast: 1, stl: 1, blk: 1, tov: 1 },
  },
  {
    id: "run-and-gun",
    name: "Run and Gun",
    icon: "🏃",
    blurb: "Push the pace for more points — and more giveaways.",
    mods: { pts: 1.055, reb: 0.96, ast: 1.05, stl: 0.85, blk: 0.85, tov: 1.25 },
  },
  {
    id: "full-court-press",
    name: "Full Court Press",
    icon: "🕸️",
    blurb: "Hound the ball. Great steals and blocks, weaker offense.",
    mods: { pts: 0.901, reb: 0.97, ast: 0.93, stl: 1.45, blk: 1.35, tov: 0.85 },
  },
  {
    id: "pound-the-glass",
    name: "Pound the Glass",
    icon: "💪",
    blurb: "Own the boards and the paint. Slower, less ball movement.",
    mods: { pts: 0.991, reb: 1.3, ast: 0.88, stl: 0.93, blk: 1.2, tov: 0.95 },
  },
  {
    id: "motion-offense",
    name: "Motion Offense",
    icon: "🔀",
    blurb: "Everybody touches it. Big assists, but you give up the glass.",
    mods: { pts: 1.026, reb: 0.88, ast: 1.3, stl: 0.95, blk: 0.93, tov: 0.88 },
  },
];

export const DEFAULT_TACTIC = "balanced";

export function tacticById(id) {
  return TACTICS.find((t) => t.id === id) || TACTICS.find((t) => t.id === DEFAULT_TACTIC);
}

/** The multiplier set for a tactic id, safe against unknown/missing ids so a
 * stale saved choice can never break a simulation. */
export function tacticMods(id) {
  return tacticById(id).mods;
}
