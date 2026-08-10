// Tunable constants for the NFL simulation.
//
// None of basketball's numbers transfer, and none are reused here. That engine
// models five players guarding five over shared minutes; this one models
// drives. The units below are yards, drives and points.
//
// WHERE THE TARGETS COME FROM
//
// An NFL team averages roughly 11 possessions a game and scores about 22
// points on them. Those two anchor everything: get drives per game and points
// per drive right and the scoreboard lands in the right place on its own,
// without anyone tuning the scoreboard directly. That indirection is the whole
// reason to model drives rather than fitting final scores.
//
// PROVISIONAL, AND HONEST ABOUT IT
//
// The balance levers at the bottom (TALENT_PARITY, the quarter-variance range)
// are PLACEHOLDERS carrying basketball's shape, not solved values. Football's
// have to be solved the same way basketball's were - by tools/calibrate-*.mjs
// against a running engine, variance first and tactics second. Until that
// engine exists there is nothing to solve against, so these are starting
// points chosen to be plausible rather than numbers anyone should trust. See
// the note at the top of js/sports/nba/tactics.js for why picked balance
// values are a trap.

/** Possessions per team per game. Real NFL sits near 11. Both sides get the
 * same count because possessions alternate - a game where one team simply got
 * more chances would report luck as skill. */
export const DRIVES_PER_TEAM = 11;

/** Points a league-average offence produces per drive. Multiplied by
 * DRIVES_PER_TEAM this gives ~22, which is the number the model aims at. */
export const BASE_POINTS_PER_DRIVE = 2.0;

/** Where a drive starts, in yards from the team's own goal line. 25 is the
 * touchback spot and where most drives really begin. */
export const DRIVE_START_YARD = 25;

/** Yards downfield before a kick is realistic. Past this a stalled drive still
 * has three points available, which is what gives the ST pick its teeth. */
export const FG_RANGE_YARD = 62;

/** Outcome weights for a league-average drive, before any offence/defence
 * adjustment. Sums to 1, and matches the shape of a real drive chart: most
 * drives end in a punt, and turnovers are rarer than people remember. */
export const DRIVE_OUTCOMES = {
  touchdown: 0.21,
  fieldGoal: 0.17,
  punt: 0.49,
  turnover: 0.13,
};

/** Points by scoring type. The extra point is folded into the touchdown at its
 * real conversion rate rather than simulated - a 94% kick is not a decision
 * anyone makes, and rolling for it would add a coin flip nobody would feel. */
export const POINTS = { touchdown: 6.94, fieldGoal: 3, safety: 2 };

/** How much each roster slot feeds the offence rating. Quarterback is the most
 * important position in team sport and the weights say so; the line is second,
 * because a passer under pressure stops being a passer. Sums to 1. */
export const OFFENSE_WEIGHTS = {
  // QB raised from 0.36. He is the most important position in team sport and
  // the weights should say so louder than they did: at 0.36 a replacement-level
  // passer moved his offence's rating by too little to show up as a
  // replacement-level line. Everything else is scaled down proportionally so
  // the weights still sum to 1 - this redistributes influence rather than
  // inflating offence.
  QB: 0.44, OL: 0.18, RB: 0.09, WR1: 0.11, WR2: 0.07, WR3: 0.045, TE: 0.065,
};

/** Same for the defence. The front seven outweighs the secondary because
 * pressure is what breaks a drive - coverage matters most when the quarterback
 * has time, which is the rush's business. Sums to 1. */
export const DEFENSE_WEIGHTS = { DL: 0.3, LB: 0.24, CB: 0.26, S: 0.2 };

/**
 * Who is allowed to carry the ball on a designed run, as a multiplier on that
 * player's own rushing production.
 *
 * A player's `rush_td` already encodes how often he really scored on the
 * ground, so this is not a second opinion about talent - it is a gate on the
 * PLAY. Without it any nonzero figure in the data made a man a candidate, and
 * tight ends carry small ones: a career's worth of tackle-eligible sneaks and
 * fumble recoveries averages out to a number just above zero, which is enough
 * to be drawn for a carry roughly every other game.
 *
 * TE is zero, not small. A tight end taking a handoff is a specific called
 * play, and this model has no plays to call - it works in drives. Until there
 * is a play-level ledger that can say "end-around to the tight end", the
 * honest answer is that it does not happen, rather than that it happens at a
 * rate nobody chose.
 *
 * Receivers keep a small share for the end-arounds and jet sweeps that are a
 * real part of a modern offence and that the data does support.
 */
export const RUSH_CARRIER_WEIGHTS = { RB: 1, QB: 1, FLEX: 0.6, WR: 0.12, TE: 0 };

/** Games of a unit's season needed before it is rated as itself rather than
 * regressed toward the mean. A three-game sample is noise wearing a name. */
export const MIN_RATED_GAMES = 6;

/** How far talent separates a great offence from a poor one.
 *
 * SOLVED, at last, by tools/calibrate-nfl-variance.mjs. It was 0.42, which
 * was measured as far too compressed: `edge` moved by only about ten percent
 * across the entire talent range, so a replacement-level quarterback cost his
 * offence roughly four yards a drive. That is what let a backup post a
 * starter's line - Skylar Thompson 2022 threw for 76 yards a game in real
 * life and 280 in this simulation.
 *
 * Raising it widens the SPREAD without moving the mean, because edge is 1 at
 * parity. Two evenly matched teams play exactly the same game as before; a
 * mismatch now looks like a mismatch. */
export const TALENT_PARITY = 0.95;

/** PROVISIONAL - see the header. Per-quarter multiplier on drive quality, so a
 * game can swing the way real ones do. Symmetric around 1 so it adds noise
 * without handing either side points over a season. Must be solved. */
export const TEAM_QUARTER_VARIANCE_MIN = 0.78;
export const TEAM_QUARTER_VARIANCE_MAX = 1.22;

/** What a forfeited pick costs. Football has no bench, so an unfilled slot is
 * a hole in the lineup rather than a worse player standing in - steeper than
 * basketball's penalty for exactly that reason. */
export const FORFEIT_PENALTY = 0.55;
