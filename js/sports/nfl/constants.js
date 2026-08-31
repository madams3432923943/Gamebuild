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

/** Points by scoring type. A touchdown is six; what comes after it is played
 * out rather than folded in - see the conversion constants below. */
export const POINTS = { touchdown: 6, fieldGoal: 3, safety: 2 };

/**
 * THE PLAY AFTER THE TOUCHDOWN.
 *
 * This used to be a constant: a touchdown was worth 6.94, the extra point
 * folded in at its real rate, on the reasoning that a 94% kick is not a
 * decision anyone makes. That reasoning is right about the kick and wrong about
 * the moment, because the decision is not "will this kick go through" - it is
 * "should we be kicking at all". A team that scores to go from eight down to
 * two down and takes the extra point has declined to tie the game, and folding
 * the conversion into the touchdown made that the only thing it could ever do.
 * It was reported from a real game, and it is the kind of thing a viewer
 * notices immediately because it is the whole point of the drive.
 *
 * Scoring is unchanged in aggregate - six plus a 94% kick is the 6.94 this
 * replaces - so nothing above needs recalibrating for it.
 */
export const EXTRA_POINT_SUCCESS = 0.94;
export const TWO_POINT_SUCCESS = 0.48;

/** How often a coach goes for two when the score does not demand it.
 *
 * ZERO, DELIBERATELY. Real coaches do this at a low rate and the first version
 * modelled that, at one attempt in twenty touchdowns. It reads as a bug rather
 * than as colour: a viewer who sees a team go for two while up eleven in the
 * second quarter does not think "interesting call", they think the simulation
 * is broken - and from the outside those look identical, because the reasoning
 * behind a real off-chart try is not visible in a box score.
 *
 * So the conversion is a DECISION or it is a kick. Every two-point try in this
 * game can be explained by pointing at the scoreboard, which is the property
 * that makes it read as football rather than as noise. */
export const TWO_POINT_BASELINE_RATE = 0;

/**
 * The margins - AFTER the six points, from the scoring team's side - at which
 * the two-point play is the right call, and the reason for each.
 *
 * This is the standard chart every NFL staff carries, not an invention:
 *   -2   the try TIES it. This is the case that was reported.
 *   -5   makes it a field goal game instead of needing a touchdown.
 *   -10  sets up tying with a touchdown and a field goal rather than two scores.
 *   -16  the same logic a touchdown earlier: get inside two scores.
 *   +1   makes it a field goal game the other way rather than a one-point lead.
 *   +4   pushes the lead past a field goal to a touchdown.
 *   +5   pushes it to a touchdown-and-a-two rather than a touchdown.
 *  +12   makes it three scores instead of two.
 *
 * Applied only late, because earlier in a game the arithmetic has too many
 * possessions left in it to mean anything.
 */
export const TWO_POINT_MARGINS = [-2, -5, -10, -16, 1, 4, 5, 12];

/** The quarter from which the chart above starts applying. */
export const TWO_POINT_CHART_QUARTER = 4;

/**
 * How much each roster slot feeds the offence rating. Sums to 1.
 *
 * THESE ARE A GAME-FEEL DECISION, NOT A FOOTBALL ONE. Say it plainly, because
 * the previous version of this comment argued the opposite and the numbers
 * quietly stopped agreeing with it. Draft Nova is a DRAFTING game: the fun is
 * in recognising a name, spending a pick on him, and then watching him decide
 * something. A weight is exactly how much a pick matters, so the weights should
 * follow where the enjoyment is rather than where an offensive coordinator
 * would put it.
 *
 * What that changes from the previous set:
 *
 *   QB 0.44 -> 0.40. Still first by a distance, and still the pick that most
 *   decides a game - just no longer most of the offence on its own.
 *
 *   OL 0.18 -> 0.10, from second to last. This is the deliberate one. The line
 *   is the only offensive slot with no box-score presence: it never scores,
 *   never appears in the highlight feed, and a player who spends a pick there
 *   has no way to SEE it pay off. Weight parked on an invisible slot is weight
 *   the game never gets to show anyone.
 *
 *   RB 0.09 -> 0.125, and the pass catchers 0.29 -> 0.375 (WR3 alone rises more
 *   than half, 0.045 -> 0.07). These are the picks players argue about, and a
 *   whiffed WR3 used to cost under 5% of one side of the ball - close enough to
 *   nothing that the back half of an offensive draft carried no stakes.
 *
 * KNOWN ASYMMETRY, ACCEPTED ON PURPOSE. DEFENSE_WEIGHTS.DL is 0.30, the largest
 * single defensive weight, and OL - the thing that answers a pass rush on a real
 * field - is now the smallest offensive one. So a drafted front will feel strong
 * while a drafted line feels close to inert, which is not what football looks
 * like. That is the trade being made for legibility. If OL ever reads as TOO
 * dead, trim DL rather than restoring OL: putting OL back would undo the point.
 *
 * AUTHORED, NOT SOLVED - like TALENT_PARITY and the quarter-variance range
 * below. No football calibrator exists; only the two NBA ones do. Anyone
 * changing these is exercising the same judgement, not correcting a computation.
 */
export const OFFENSE_WEIGHTS = {
  QB: 0.4, WR1: 0.13, RB: 0.125, OL: 0.1, TE: 0.09, WR2: 0.085, WR3: 0.07,
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
 * MEASURED BY HAND, NOT SOLVED. This comment used to say it was "SOLVED, at
 * last, by tools/calibrate-nfl-variance.mjs". That tool has never existed -
 * only the two NBA calibrators do - so the claim was false the day it was
 * written and stayed false through every reading of this file since. Football's
 * balance levers have always been authored. Saying so is worth more than the
 * reassurance was.
 *
 * How 1.6 was arrived at: sweeping the value and measuring two rosters whose
 * ratings differ by eleven points. At 0.95 the better roster won 61.6% of 400
 * games, which is close enough to a coin toss that a draft stops feeling like
 * it decided anything. At 1.6 it wins 73.5%, and a 96-against-7 mismatch stays
 * at 100% either way, so the top end is not distorted to buy the middle.
 *
 * Raising it widens the SPREAD without moving the mean, because edge is 1 at
 * parity. Two evenly matched teams play exactly the same game as before; a
 * mismatch now looks like a mismatch.
 *
 * It should still be solved. A calibrator for football would replace this
 * paragraph with a number nobody had to argue about. */
export const TALENT_PARITY = 1.6;

/**
 * The floor under a drive-quality multiplier.
 *
 * `edge` is 1 + TALENT_PARITY * (off - def) and had no lower bound, so a gap
 * wider than 1/TALENT_PARITY - about 0.63 of rating, which real drafted rosters
 * do reach - drove it to zero and through it. A NEGATIVE multiplier is not a
 * very bad offence, it is a nonsensical one: it scales the drive-outcome
 * weights, so touchdown and field-goal probabilities come out negative and the
 * drive gains negative ground. Games in that state reported negative team
 * yardage and four-point finals.
 *
 * Measured before clamping: 0.34% of random Quick Play matchups landed at or
 * below zero, worst -0.24. Rare, but it had always been reachable, and the
 * board is what decides whether anyone hits it.
 *
 * 0.05 rather than something larger because this is a guard, not a balance
 * lever. At 0.05 a team still scores on about 2% of its drives - annihilated,
 * but recognisably playing football - and legitimate blowouts above the floor
 * are left exactly as they were.
 */
export const EDGE_FLOOR = 0.05;

/** PROVISIONAL - see the header. Per-quarter multiplier on drive quality, so a
 * game can swing the way real ones do. Symmetric around 1 so it adds noise
 * without handing either side points over a season. Must be solved. */
export const TEAM_QUARTER_VARIANCE_MIN = 0.78;
export const TEAM_QUARTER_VARIANCE_MAX = 1.22;

/** What a forfeited pick costs. Football has no bench, so an unfilled slot is
 * a hole in the lineup rather than a worse player standing in - steeper than
 * basketball's penalty for exactly that reason. */
export const FORFEIT_PENALTY = 0.55;
