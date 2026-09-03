// Pre-game gamestyles. Chosen after the draft, once you know the roster
// you're actually working with. Fifteen permanent styles; each game offers 3 at
// random so the choice is never the same menu twice, and no single style can
// become "the meta" for the whole field. Fifteen rather than ten so the
// three-card menu repeats far less often - with ten, the same trio came round
// noticeably within a session.
//
// The one rule these are designed around: a style must be a real choice, not
// a power gain. If one option were simply strongest, ranked would stop
// measuring basketball knowledge and start measuring whether you picked
// Style 3. So every style pays for what it boosts, and the `pts` multipliers
// below are deliberately near-neutral in total - what changes is WHERE your
// production comes from, which matters because it interacts with the roster
// you drafted and the one you're facing.
//
// Mapping method (the user's design brief lists bonus/tradeoff dimensions
// richer than the 6 stats this engine actually simulates - pts, reb, ast,
// stl, blk, tov - and the dataset has no OREB/DREB or interior/perimeter
// split per player). Rather than build a parallel stat model, every
// dimension maps onto those 6 keys:
//   - Pace                          -> a mild uniform lean across all 6 keys
//   - Offense / Defense              -> pts / (stl+blk)
//   - 3PT Shooting                   -> pts (see shooting.js for the cosmetic
//                                       shot-split nudge this also drives)
//   - Perimeter / Interior Defense   -> stl / blk
//   - Passing / Offensive IQ         -> ast
//   - Forced Turnovers               -> no separate lever needed - the
//                                       engine's turnoverFactor already
//                                       scales off defender spg, so the stl
//                                       mod does double duty
//   - Offensive / Defensive Rebounding (no split in the data) -> both
//                                       collapse onto the single reb key
//   - Spacing, Team Chemistry, Foul Discipline -> FLAVOR ONLY. These have no
//                                       mechanical target in a 6-stat engine
//                                       and are not faked onto an unrelated
//                                       number - the blurb says so.
//
// One genuine engine extension: Isolation Heavy's "+2 Clutch Scoring" is a
// real clutchMods bonus applied only in the 4th quarter and any overtime
// (see engine.js), not an approximation folded into the full-game pts mod.
//
// The identity stats (reb/ast/stl/blk/tov, and Isolation Heavy's fixed
// clutchMods.pts bonus) were chosen by hand from the design brief; `pts` was
// then SOLVED for by simulation the same way the original 5-tactic catalog
// was - see tools/calibrate-gamestyles.mjs - because points are the only
// thing this engine converts directly into wins, and hand-picked scoring
// bonuses on a pace/transition style previously ran away with a 65% win rate
// before that pass. Re-solved after defender ratings were damped, since that
// changed how much defence suppresses scoring.
//
// Re-solved again after real per-game stats replaced the 1980s-2020s
// placeholder data and scoringEfficiencyFactor (engine.js) started letting
// real shooting efficiency affect scoring - a real engine-behavior change,
// exactly the case this file's own instructions call for a re-run on.
// Re-solved again for the fifteen-style catalog, after Zone Defense brought a
// real engine effect with it (applyZoneDefense suppresses the OPPONENT'S
// front-court scoring) and after the draft-construction, counterplay and
// defensive-scheme terms started reaching the scoreboard - all of them things
// a style's pts is now solved against.
// Verified over the full 15x14 field (150 games per matchup): 47.4-52.8%,
// spread 5.4 - tighter than the ten-style field it replaces. Re-run the script
// and paste in new mods whenever a style's identity stats or the engine's
// balance change.
// RE-SOLVED, and this is the run that says why re-solving is not optional.
//
// The `pts` values below are the output of tools/calibrate-gamestyles.mjs run
// against the CURRENT engine and the current TALENT_PARITY. Four engine
// changes had landed since the previous solve without the tool being re-run,
// and the mods were still the answer to the engine as it had been. Started
// from a flat 1.0, the spread between the best and worst style measured 25.2
// points of win rate before this run and 6.3 after it.
//
// Every defensive style moved the same way - Lockdown Defense 0.9378 ->
// 0.9544, Defensive Pressure 0.9656 -> 0.9740, Zone Defense 0.9788 -> 0.9862 -
// which is what a raised TALENT_PARITY does: more of a roster's talent reaches
// the scoreboard, so a style that buys defence with points was being charged
// for points that had become worth more. That is a coherent story rather than
// fifteen independent nudges, and it is the kind of drift nobody can see by
// reading the numbers.
//
// Only `pts` is solved. reb/ast/stl/blk/tov are what a style IS and are held
// exactly as authored - see the tool's header, and the same rule in
// js/sports/nfl/tactics.js, which solves `off` and `def` and holds the
// thirteen mods that give a football gameplan its character.

export const TACTICS = [
  {
    id: "balanced",
    name: "Balanced",
    icon: "⚖️",
    blurb: "+1 Offense, +1 Defense. Gives up pace and specialization for a roster with no holes.",
    mods: { pts: 1, reb: 1, ast: 1, stl: 1, blk: 1, tov: 1 },
  },
  {
    id: "run-and-gun",
    name: "Run & Gun",
    icon: "🏃",
    blurb: "+2 Pace, +2 Transition Offense. Bleeds halfcourt offense and defense to get there.",
    mods: { pts: 1.0287, reb: 0.92, ast: 1.08, stl: 0.82, blk: 0.82, tov: 1.3 },
  },
  {
    id: "spread-perimeter",
    name: "Spread the Perimeter",
    icon: "🎯",
    blurb: "+2 3PT Shooting, +1 Spacing (flavor only). Costs offensive rebounding and interior scoring.",
    mods: { pts: 1.0065, reb: 0.8, ast: 1.02, stl: 1, blk: 0.95, tov: 1 },
  },
  {
    id: "lockdown-defense",
    name: "Lockdown Defense",
    icon: "🔒",
    blurb: "+2 Perimeter Defense, +2 Interior Defense. Slower pace, less offensive efficiency.",
    mods: { pts: 0.9544, reb: 0.97, ast: 0.9, stl: 1.35, blk: 1.35, tov: 0.85 },
  },
  {
    id: "crash-the-glass",
    name: "Crash the Glass",
    icon: "💪",
    blurb: "+2 Offensive Rebounding, +2 Defensive Rebounding. Weak in transition D, worse from three.",
    mods: { pts: 1.011, reb: 1.4, ast: 0.85, stl: 0.88, blk: 1.05, tov: 0.95 },
  },
  {
    id: "paint-dominance",
    name: "Paint Dominance",
    icon: "🏀",
    blurb: "+2 Interior Scoring, +2 Free Throw Rate. Trades away three-point shooting and pace.",
    mods: { pts: 1.0117, reb: 1.15, ast: 0.85, stl: 0.9, blk: 1.05, tov: 0.92 },
  },
  {
    id: "ball-movement",
    name: "Ball Movement",
    icon: "🔀",
    blurb: "+2 Passing, +2 Offensive IQ. Everybody touches it, but isolation scoring and boards suffer.",
    mods: { pts: 1.0161, reb: 0.9, ast: 1.35, stl: 0.95, blk: 0.9, tov: 0.85 },
  },
  {
    id: "isolation-heavy",
    name: "Isolation Heavy",
    icon: "🌟",
    blurb: "+2 Shot Creation, +2 Clutch Scoring (real 4th-quarter/OT bonus). Passing and chemistry (flavor) take the hit.",
    mods: { pts: 0.9833, reb: 0.9, ast: 0.7, stl: 0.92, blk: 0.9, tov: 1.05 },
    clutchMods: { pts: 1.15 },
  },
  {
    id: "small-ball",
    name: "Small Ball",
    icon: "⚡",
    blurb: "+2 3PT Shooting, +2 Switching Defense (steals). Gives up rebounding and interior defense hard.",
    mods: { pts: 1.0266, reb: 0.7, ast: 1.05, stl: 1.05, blk: 0.65, tov: 1 },
  },
  {
    id: "defensive-pressure",
    name: "Defensive Pressure",
    icon: "🕸️",
    blurb: "+2 Steals, +2 Forced Turnovers. Foul discipline (flavor) and defensive rebounding pay for it.",
    mods: { pts: 0.9740, reb: 0.9, ast: 0.92, stl: 1.4, blk: 1, tov: 0.8 },
  },

  // ---- Second wave ---------------------------------------------------------
  // Five more, taking the catalog to fifteen. Same rule as the first ten: a
  // style is a real choice, not a power gain, so every one of these pays for
  // what it boosts and its `pts` is solved by simulation rather than picked.
  {
    id: "zone-defense",
    name: "Zone Defense",
    icon: "🛡️",
    blurb: "+2 Interior Defense, +2 Help Rotations. Packs the paint - and gives up the perimeter to do it.",
    mods: { pts: 0.9862, reb: 1.08, ast: 0.95, stl: 0.82, blk: 1.3, tov: 0.95 },
    // The one style with an effect outside the six stats: it suppresses the
    // OPPONENT'S front-court scoring directly. Without this, "packs the paint"
    // would be a sentence with nothing behind it - the blk boost alone raises
    // your own block count and barely touches where they score from.
    opponentPaint: 0.88,
  },
  {
    id: "full-court-press",
    name: "Full-Court Press",
    icon: "🥵",
    blurb: "+3 Forced Turnovers, +1 Pace. Costs you the glass, and your own handle goes with it.",
    mods: { pts: 0.9831, reb: 0.85, ast: 1.02, stl: 1.45, blk: 0.9, tov: 1.25 },
  },
  {
    id: "post-up-heavy",
    name: "Post-Up Heavy",
    icon: "🐘",
    blurb: "+2 Interior Scoring, +2 Offensive Rebounding. No pace, no ball movement, no threes.",
    mods: { pts: 1.0094, reb: 1.28, ast: 0.72, stl: 0.9, blk: 1.05, tov: 0.95 },
  },
  {
    id: "switch-everything",
    name: "Switch Everything",
    icon: "🔁",
    blurb: "+2 Perimeter Defense, +1 Versatility. Every switch is a mismatch on the glass.",
    mods: { pts: 0.9910, reb: 0.78, ast: 1.02, stl: 1.28, blk: 0.85, tov: 0.95 },
  },
  {
    id: "grind-it-out",
    name: "Grind It Out",
    icon: "🐢",
    blurb: "+3 Ball Security, +1 Defense. Almost no turnovers - and almost no ceiling either.",
    mods: { pts: 1.0029, reb: 1.05, ast: 0.88, stl: 1.05, blk: 1.05, tov: 0.6 },
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

/** Clutch-only multipliers (4th quarter + OT) for a tactic id, or null if the
 * style has none - most styles don't get a clutch bonus, only the ones whose
 * identity is specifically about crunch time. */
export function tacticClutchMods(id) {
  return tacticById(id).clutchMods || null;
}

/** How much this style suppresses the OPPONENT'S front-court scoring, as a
 * multiplier at or below 1. Only Zone Defense has one - every other style
 * returns 1 and is completely unaffected by the code path that reads this.
 *
 * It exists because "packs the paint" has no expression in six stats that are
 * all about the team holding the ball. Boosting a zone's own blk raises its
 * block count and barely moves where the other team scores from, which is the
 * thing the style actually promises. */
export function tacticOpponentPaint(id) {
  return tacticById(id).opponentPaint ?? 1;
}

/** Picks n distinct styles at random to offer for one game. Every game re-
 * rolls this, so the menu itself is part of the variety, not just the
 * roster. Falls back to the full catalog if asked for more than exists. */
export function randomTacticChoices(n = 3) {
  const pool = [...TACTICS];
  const picked = [];
  while (picked.length < Math.min(n, pool.length)) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
}
