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
// Draft Nova lands near that anchor on the scoreboard - about 24 points a team
// in Ranked, 23 in Quick Play - and deliberately above it on YARDAGE, at 413
// yards a team at 6.6 a play against the real league's 340 at 5.4. SCORING_LIFT
// is where that decision lives. It is one number in one place because for a
// long time it was neither: it was a side effect of two rating scales not
// lining up. See that constant.
//
// SOLVED, NOT PICKED
//
// The balance levers at the bottom - TALENT_PARITY and the quarter-variance
// range - used to be placeholders carrying basketball's shape, and this note
// used to say so. They are now solved by tools/calibrate-nfl-variance.mjs, the
// football counterpart to the two NBA calibrators, in the order that file
// insists on: variance first, gameplans second
// (tools/calibrate-nfl-gamestyles.mjs). Re-run both after any engine change
// that touches drives, yardage or ratings, variance first - a gameplan solved
// against the wrong noise floor is solved wrong.
//
// Anything below that is still authored says so at its own definition. The
// slot weights are the main ones, and deliberately: they are a game-feel
// decision about how much a pick matters, not something a win rate can settle.

/** Possessions per team per game. Real NFL sits near 11. Both sides get the
 * same count because possessions alternate - a game where one team simply got
 * more chances would report luck as skill. */
export const DRIVES_PER_TEAM = 11;

/** Where a drive starts, in yards from the team's own goal line. 25 is the
 * touchback spot and where most drives really begin. */
export const DRIVE_START_YARD = 25;

/** Yards downfield before a kick is realistic. Past this a stalled drive still
 * has three points available, which is what gives the ST pick its teeth. */
export const FG_RANGE_YARD = 62;

/**
 * Outcome weights for a league-average drive, before any offense/defense
 * adjustment and BEFORE the field-position rules below act on the result.
 * Sums to 1: most drives end in a punt, and turnovers are rarer than people
 * remember.
 *
 * `fieldGoal` IS NOT THE RATE A REAL DRIVE ENDS IN A KICK, and the previous
 * version of this comment implied it was. It carried real football's 0.17, and
 * the engine then converted every stalled drive inside FG_RANGE_YARD from a
 * punt into an attempt as well - because nobody punts from field-goal range,
 * which is correct. Those attempts land ON TOP of this share rather than
 * inside it, so the REALISED rate was well above the chart: measured over 400
 * drafted games, 2.47 field goals made per team per game against real
 * football's ~1.7, and a touchdown-to-field-goal ratio of 1.12 where the
 * league's is about 1.3. Kicking is the least interesting way a drive can end
 * and the game was doing it half again too often.
 *
 * 0.11 is what makes the number that reaches the scoreboard football's:
 * 2.05 made a game at a 1.33 ratio. The chart is the INPUT to a field-position
 * model, not a description of its output, and only the output can be checked
 * against a real season - which scripts/verify-nfl-realism.mjs now does.
 */
export const DRIVE_OUTCOMES = {
  touchdown: 0.21,
  fieldGoal: 0.11,
  punt: 0.55,
  turnover: 0.13,
};

/**
 * How far above a real drive chart this game deliberately plays.
 *
 * DRIVE_OUTCOMES above is football's, and Draft Nova is not trying to be a
 * league average - see the design-target note at the top of
 * scripts/verify-nfl-realism.mjs, which aims at about 350 yards a team at 5.8
 * a play against the real league's 340 at 5.4. Every scoring probability and
 * every yard gained is multiplied by this.
 *
 * IT USED TO BE AN ACCIDENT, WHICH IS WHY IT IS A CONSTANT NOW. The lift was
 * real and shipped, but nobody had chosen it: `edge` compared a roster's
 * offense rating against its opponent's defense rating as though the two were
 * on the same scale, and they are not. Measured over 600 bot-drafted ranked
 * rosters, offense rates 0.904 and defense 0.794 - so EVERY team, in every
 * game, carried a systematic +0.11 that TALENT_PARITY then multiplied into a
 * 1.18x on all scoring. The number the game shipped at was that product.
 *
 * Two things followed from it, and both were bugs:
 *
 *   Raising TALENT_PARITY inflated scoring. It is supposed to control how much
 *   talent decides a game, and it also silently controlled how many points
 *   were in it - which is why it could never be solved. Every candidate value
 *   moved a target it was not aiming at.
 *
 *   Quick Play scored less than Ranked. A Quick Play roster drafts ONE defensive
 *   unit standing in for four slots, and it rates 0.884 against ranked's 0.794
 *   while its offense rates lower - a gap of -0.02 against ranked's +0.11. The
 *   same two rosters therefore played a ~20% lower-scoring game in one mode
 *   than the other, for a reason no player could see and no comment mentioned.
 *
 * `edge` subtracts EDGE_BASELINE now, so the accidental term is gone from both
 * modes. This is what is left: one number, in one place, that says how far
 * above a real drive chart this game plays.
 *
 * IT IS 1.0, WHICH IS A DECISION AND NOT A DEFAULT. At 1.0 the chart runs at
 * exactly its real-football rate and the explosiveness comes from the yardage
 * model instead - measured over bot-drafted rosters, 24.1 points a team in
 * Ranked and 22.7 in Quick Play against the real league's ~22, on 413 yards at
 * 6.6 a play against 340 at 5.4. So the game is football-shaped on the
 * scoreboard and deliberately above it on yardage, which is the design target
 * scripts/verify-nfl-realism.mjs states and now measures against the rosters
 * people actually draft.
 *
 * Raising it raises both together. 1.18 was the value that preserved what
 * Ranked shipped BEFORE any of this was fixed - about 29 a team - and it is
 * recorded here because it is the number to return to if the scoreboard is
 * ever judged too quiet, not because anything is still set to it.
 */
export const SCORING_LIFT = 1.0;

/**
 * What an average matchup rates at, per roster shape - the zero point `edge`
 * measures talent from.
 *
 * `edge` compares one roster's OFFENCE rating against another's DEFENCE
 * rating, and the two are not on the same scale. Measured over 600
 * bot-drafted rosters of each shape: a ranked roster rates 0.904 on offense
 * and 0.794 on defense, so every ranked game carried a systematic +0.11 that
 * TALENT_PARITY multiplied into a lift on all scoring. Quick Play, where ONE
 * drafted DEF unit stands in for four defensive slots, rates -0.02 the other
 * way. Subtracting the right one puts an average game of either shape at 1.
 *
 * Two bugs came out of not having this, and both are worth naming because
 * either alone would have been enough to make football uncalibratable:
 *
 *   TALENT_PARITY moved the scoreboard. It is meant to say how much talent
 *   decides a game, and it also silently said how many points were in one, so
 *   every candidate value moved a target it was not aiming at. Anyone sweeping
 *   it would have watched scoring inflate and stopped early - which is the
 *   right instinct about a knob doing two things, and is most likely why the
 *   value stayed hand-set for as long as it did.
 *
 *   Quick Play scored ~20% lower than Ranked, from the same two rosters, for
 *   a reason no player could see and no comment mentioned: 22.5 points a team
 *   against 28.9. It is 22.7 against 24.1 now - a 6% gap that is the roster
 *   shape itself rather than a rating-scale mismatch.
 *
 * MEASURED, NOT PICKED. Re-measure after any change to the slot weights, to
 * units.js, to the defensive axis weights, or to the dataset - all of them move
 * where average is.
 *
 * THE PREVIOUS VERSION OF THIS NOTE SAID tools/calibrate-nfl-variance.mjs
 * re-measures these on every run, "prints these two numbers first, before it
 * solves anything". IT DOES NOT, and never did - the string EDGE_BASELINE does
 * not appear in that file. The claim was load-bearing in the worst way: it told
 * the next person these numbers keep themselves current, so when the defensive
 * rating scale changed underneath them nobody thought to look. Measure them
 * with the engine's own `edge` inputs (offAdj - defAdj over drafted pairs of
 * each shape under balanced plans), which is the only quantity that makes an
 * average game come out at exactly 1.
 *
 * 0.111 -> 0.029 and -0.020 -> -0.198 is that re-measurement, after defensive
 * units began to be rated on disruption RATE rather than counting volume and
 * after each defensive axis started multiplying its own gameplan mod. Quick
 * Play moves furthest because one drafted DEF unit answers all four axes there,
 * so the axis term amplifies whatever that single pick is.
 *
 * 0.029 -> -0.058 and -0.198 -> -0.241 is the NEXT re-measurement, after the
 * rating moved to per-season z-scores and defensive units began to carry
 * points allowed. Both of those lift defences relative to offences at the
 * drafted end of the board - measured slot by slot, cornerbacks gained 0.096
 * and defensive lines 0.051 while quarterbacks lost 0.018 - so the average
 * matchup is no longer offence-favoured and the baseline has to say so.
 * Leaving it stale showed up exactly where the note above predicts: yards per
 * play fell to 5.58 and yards per drive to 30.9, both just under the floor
 * scripts/verify-nfl-realism.mjs holds them to.
 *
 * The harness that produced these is in this commit's scratch work and was
 * validated before it was trusted: run against the PREVIOUS rating it returns
 * 0.039 and -0.202, reproducing the two numbers above to within sampling
 * noise. It replicates edge()'s own inputs - offAdj = off * mine.off,
 * defAdj = def * theirs.def * mean(swing(axis, AXIS_SWING)) - over 440 drafted
 * rosters of each shape under balanced plans. The axis term is not optional:
 * omitting it moves the ranked answer by about 0.11.
 */
export const EDGE_BASELINE = { ranked: -0.058, quickPlay: -0.241 };

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

/** The quarter from which the chart above starts applying.
 *
 * KEPT AS A FLOOR, not as the test. The chart now fires on POSSESSIONS
 * REMAINING (see TWO_POINT_POSSESSIONS), because a quarter is not a unit of
 * urgency: a touchdown on the first drive of the fourth still has four
 * possessions of arithmetic left in it, and the chart's whole argument is that
 * the arithmetic has run out. The quarter test remains so the chart can never
 * fire in the first half, however few possessions a slow-paced game has left. */
export const TWO_POINT_CHART_QUARTER = 4;

/** How many possessions must remain for the two-point chart to mean anything.
 *
 * Two: your own next drive and theirs. Past that, "this makes it a field goal
 * game" is a claim about a game with too much left in it to plan that far. */
export const TWO_POINT_POSSESSIONS = 2;

/**
 * HOW MUCH OF A DRAFT GRADE IS HOW YOU BUILT THE ROSTER, rather than how good
 * its best players are.
 *
 * These are PENALTIES against a talent score, not shares of a weighted mean.
 * Summing four terms instead gave a uniformly terrible roster full marks for
 * balance and for having no spread, and the Easy bot outscored the Medium bot
 * for it. Talent sets the level; construction takes away from it.
 *
 * Construction outweighs talent in effect, which is the point. The grade
 * exists to argue with
 * "take the highest-rated name on the board", and a grade that is a weighted
 * mean of slot ratings cannot argue with it - it IS it. Basketball reached
 * this conclusion first (js/sports/nba/draftgrade.js weights balance 0.42
 * against talent 0.23); football's grade was 100% talent until now, which is
 * why a roster with a 96 running back and a 43 offensive line graded A+ on a
 * card that called the line its soft spot.
 *
 * Sums to 1, so the score stays on the 0-1 scale verify-mode-rules.mjs asserts
 * the difficulty ladder on.
 */
export const GRADE_WEIGHTS = {
  /** How much a hole costs. The largest, because a hole is the thing a grade
   * should notice first and an average is exactly the operation that hides
   * one. A roster whose worst unit is at zero loses this much outright. */
  floor: 0.42,
  /** How much drafting half a team costs. */
  balance: 0.45,
  /** How much a chasm between the best unit and the worst costs. */
  spread: 0.35,
};

/**
 * Score floors for each letter, in descending order.
 *
 * SOLVED by tools/calibrate-nfl-gradecurve.mjs against rosters that real bot
 * drafts produce, not against random assemblies from the dataset - which is
 * what the old runtime curve sampled, and why nearly every real draft landed
 * in its top few percent and graded A+.
 *
 * Re-run that tool after any change to GRADE_WEIGHTS, to the slot weights, to
 * units.js, or to the dataset - all of them move where a draft scores. Solved
 * over 450 rosters drafted across the full skill range.
 */
export const GRADE_BREAKPOINTS = [
  [0.74, "A+"], [0.69, "A"], [0.64, "A-"],
  [0.54, "B+"], [0.45, "B"], [0.36, "B-"],
  [0.30, "C+"], [0.26, "C"], [0.24, "C-"],
  [0.22, "D+"], [0.19, "D"], [0.00, "F"],
];

/**
 * FOURTH DOWN, AS A DECISION.
 *
 * None of this existed. A drive ending short of the sticks drew the label
 * "punt" from a fixed chart and the only correction was a field-goal rule, so
 * the punt team came out at every score, every spot and every point of the
 * game at the same rate. Measured over 120 simulated games before this was
 * written: a trailing team punted 47 times in the third quarter - down as much
 * as 24 - and could not punt in the fourth AT ALL, because the one situational
 * flag the engine had removed the punt branch entirely. The behaviour flipped
 * at a possession index rather than sliding with the situation.
 */

/**
 * How often a fourth down is converted, by yards to go. Real NFL rates, which
 * are far higher than most viewers expect - going for it on 4th-and-1 is close
 * to a coin flip in the offense's favour, not a gamble.
 *
 * Indexed by distance, clamped at both ends. The curve is what makes
 * 4th-and-2 and 4th-and-15 different decisions rather than the same one, which
 * a model built on score and time alone cannot do.
 */
export const FOURTH_DOWN_CONVERSION_BY_DISTANCE = [
  /* 0 */ 0.70, /* 1 */ 0.68, /* 2 */ 0.60, /* 3 */ 0.55, /* 4 */ 0.51,
  /* 5 */ 0.48, /* 6 */ 0.44, /* 7 */ 0.41, /* 8 */ 0.38, /* 9 */ 0.36,
  /* 10 */ 0.35, /* 11 */ 0.32, /* 12 */ 0.30, /* 13 */ 0.28, /* 14 */ 0.27,
  /* 15+ */ 0.25,
];

/**
 * What distance a stalled drive stalled AT.
 *
 * The engine decides a drive's ending before it narrates the downs inside it
 * (see buildPlays), so the fourth down a team faces has to be drawn rather
 * than read. These are real fourth-down distance frequencies: most are short,
 * because a drive that reaches fourth down has usually just failed on third
 * and medium rather than gone backwards.
 *
 * Weighted pairs of [yards, share]; shares sum to 1.
 */
export const FOURTH_DOWN_DISTANCES = [
  [1, 0.21], [2, 0.15], [3, 0.12], [4, 0.10], [5, 0.09],
  [6, 0.07], [7, 0.06], [8, 0.05], [10, 0.07], [13, 0.05], [17, 0.03],
];

/**
 * How much a drive that converts on fourth down still has to do to score.
 *
 * Converting extends the drive; it does not award points. This is the share of
 * converted fourth downs that go on to put something on the board, and it is
 * deliberately well under 1 - the old FOURTH_DOWN_CONVERSION constant folded
 * these two together into a single 0.34 and could therefore never be checked
 * against either real number on its own.
 */
export const FOURTH_DOWN_DRIVE_LIVES = 0.52;

/**
 * How hard a losing team is willing to push, and how much a winning team
 * protects. Multiplies the go-for-it threshold.
 *
 * Aggression rises with the deficit and as possessions run out, CONTINUOUSLY -
 * there is no cliff at a score or a clock reading. A team down four scores
 * with the ball and eight possessions left is playing a normal game; the same
 * team with two possessions left is not.
 */
export const FOURTH_DOWN_AGGRESSION = {
  /** Baseline willingness on a neutral fourth down, before situation. Matches
   * roughly how often real teams go for it in the first three quarters. */
  base: 0.05,
  /** Added per score the team trails by, once the possessions left make that
   * deficit urgent. */
  perScoreBehind: 0.30,
  /** Subtracted per score the team LEADS by. A team protecting a lead punts,
   * takes the points, and does not hand over a short field. */
  perScoreAhead: 0.22,
  /** How sharply urgency climbs as possessions run out: the multiplier is
   * scaled by scoresNeeded / possessionsLeft, capped here so a hopeless game
   * does not produce nonsense. */
  urgencyCap: 3.0,
};

/**
 * How much each roster slot feeds the offense rating. Sums to 1.
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
 *   decides a game - just no longer most of the offense on its own.
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
 * KNOWN ASYMMETRY, ACCEPTED ON PURPOSE. Every defensive slot is 0.25 while OL -
 * the thing that answers a pass rush on a real field - is 0.10, the smallest
 * offensive one. So a drafted front will feel strong while a drafted line feels
 * close to inert, which is not what football looks like. That is the trade being
 * made for legibility. If OL ever reads as TOO dead, trim the defensive weights
 * rather than restoring OL: putting OL back would undo the point.
 *
 * The sharper version of the same asymmetry is per PICK, not per slot: these
 * seven weights share 1.0 and the four defensive ones share 1.0, so a defensive
 * pick is worth about 1.75x an offensive one. See DEFENSE_WEIGHTS below.
 *
 * AUTHORED, NOT SOLVED - like TALENT_PARITY and the quarter-variance range
 * below. No football calibrator exists; only the two NBA ones do. Anyone
 * changing these is exercising the same judgement, not correcting a computation.
 */
export const OFFENSE_WEIGHTS = {
  QB: 0.4, WR1: 0.13, RB: 0.125, OL: 0.1, TE: 0.09, WR2: 0.085, WR3: 0.07,
};

/**
 * Same for the defense: FLAT. Every defensive slot is worth the same. Sums to 1.
 *
 * This replaces { DL: 0.30, LB: 0.24, CB: 0.26, S: 0.20 }, whose comment argued
 * the front seven should outweigh the secondary because pressure is what breaks
 * a drive. That is a real football opinion, and it is the kind of opinion this
 * game has no way to earn: unlike the offense, where a quarterback demonstrably
 * touches the ball on every snap, nothing here measures whether a rush or a
 * coverage actually decided more drives. The spread was authored, not observed,
 * and an unearned spread is worse than none - it silently made the DL pick the
 * most valuable on the board and the safety pick the least, for reasons no
 * player could see and no calibrator had checked.
 *
 * Flat is the honest default until something measures otherwise. It also makes
 * the defensive half of a draft legible: four picks, equal stakes.
 *
 * KNOWN, AND NOT FIXED HERE. Seven offensive slots share a weight of 1.0 and
 * four defensive slots share a weight of 1.0, so a defensive pick moves a
 * roster's rating about 1.75x as much as an offensive one (0.25 against 0.143
 * on average). That is why a roster of famous skill players can lose to one
 * that quietly won the defensive picks. Flattening redistributes WITHIN the
 * defense; it does not touch defense's share of the outcome. Changing that is a
 * separate decision about what the game wants to be.
 */
export const DEFENSE_WEIGHTS = { DL: 0.25, LB: 0.25, CB: 0.25, S: 0.25 };

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
 * real part of a modern offense and that the data does support.
 */
export const RUSH_CARRIER_WEIGHTS = { RB: 1, QB: 1, FLEX: 0.6, WR: 0.12, TE: 0 };

/** Games of a unit's season needed before it is rated as itself rather than
 * regressed toward the mean. A three-game sample is noise wearing a name. */
export const MIN_RATED_GAMES = 6;

/** How far talent separates a great offense from a poor one.
 *
 * SOLVED, by tools/calibrate-nfl-variance.mjs, and it went DOWN - 1.6 to 1.29 -
 * while the thing it exists to buy went up. That is the whole story of this
 * constant's last revision and it is worth reading before touching it.
 *
 * The calibrator solves parity against a product target: a roster whose
 * combined offense-plus-defense rating beats its opponent's by 0.10 or more -
 * the top quartile of bot-drafted pairs - should win 75% of the time. That
 * figure is deliberately basketball's, because ranked runs ONE ELO ladder
 * across both sports, so the same rating point has to mean the same thing
 * whichever tile you tapped.
 *
 * THE PREVIOUS VERSION OF THIS NOTE SAID FOOTBALL COULD NOT REACH IT. It read:
 * "Football's engine does not reach it... At 1.6 the better roster wins about
 * 65% of the time at that gap rather than 75%, and the shortfall is a property
 * of the model." The measurement was right - 66.3% +/- 0.8 over 12,000 games -
 * and the diagnosis was wrong. The shortfall was not a property of how football
 * converts talent into drives. It was that half the talent was not being
 * measured: defensive units were rated on per-game COUNTING STATS, which track
 * how many snaps a unit faced and how many men a team rotated through it rather
 * than how well it defended (see the long note in js/sports/nfl/units.js). A
 * defence the player had deliberately drafted rated ordinary, so the gap the
 * engine saw was smaller than the gap the player had built, and no value of
 * this constant could amplify a signal that had already been thrown away.
 *
 * With defences rated on disruption RATE, and with each defensive axis
 * multiplying its own gameplan mod (AXIS_SWING), the same measurement gives
 * 72.8% +/- 0.8 at a LOWER parity. The old note's closing advice was exactly
 * right and is worth keeping: "Closing the gap means changing how football
 * converts talent into drives. It does not mean turning this knob further."
 * That is what was done.
 *
 * The ceiling argument still stands and still binds. Solved without a bound the
 * bisection runs away, and past about 1.6 a bottom-tier quarterback stops being
 * rated and starts being erased - 29 yards a game instead of 64.
 * scripts/verify-nfl-realism.mjs holds a floor against that, and
 * scripts/verify-nfl-talent-response.mjs now holds the other end: a beaten
 * roster is shut out in under 3% of drafted games. Between the two, this
 * constant can no longer be raised into an unbelievable box score quietly.
 *
 * What changed underneath it earlier: `edge` subtracts EDGE_BASELINE, so this
 * number no longer moves the scoreboard as a side effect. It is the first
 * version of this constant that controls only what its name says.
 *
 * IT STAYS AT 1.53 AFTER THE FOURTH-DOWN MODEL, and the solver disagrees.
 * Re-run with situational fourth downs in, tools/calibrate-nfl-variance.mjs
 * returns 1.60 - exactly the PARITY_CEILING above - because the model does
 * what it was built to do: a trailing team now converts fourth downs instead
 * of punting, so it comes back more often and the mean margin falls to 9.5
 * against the real league's 11.5, with 57% of games inside one score against
 * 45%. The solver reaches for parity to widen those margins again and runs
 * straight into the ceiling.
 *
 * Taking 1.60 would be doing the thing the paragraph above says not to do:
 * pinning the constant at the value its own note calls the point where a
 * bottom-tier quarterback stops being rated and starts being erased, in order
 * to undo a comeback rate that is the feature working. 1.53 passes all eleven
 * checks in scripts/verify-nfl-talent-response.mjs, including the one that
 * matters here - a clearly better roster still wins 66-90% of the time. So the
 * tighter margins are recorded as a known consequence rather than calibrated
 * away, and the ceiling is left doing its job.
 *
 * The quarter-variance range below re-solved to the values it already had.
 *
 * 1.29 -> 1.53 is the re-solve after the rating moved to per-season z-scores
 * and defensive units gained points allowed. It went UP for a reason that is
 * not "turning the knob further": removing the old top-end clamp gave the
 * rating back its resolution at the top of the board, so the gap between two
 * drafted rosters is now a smaller number than it was for the same difference
 * in talent, and parity is the conversion factor on that gap. The verification
 * run reports 77.6% at a gap of 0.1, an 11.59 mean margin and 48.0% one-score
 * games against references of 11.5 and 45% - so the game it produces is the
 * same game, reached from a different scale. Still under the 1.6 ceiling the
 * paragraph above defends. */
export const TALENT_PARITY = 1.53;

/**
 * The floor under a drive-quality multiplier.
 *
 * `edge` is 1 + TALENT_PARITY * (off - def) and had no lower bound, so a gap
 * wider than 1/TALENT_PARITY - about 0.63 of rating, which real drafted rosters
 * do reach - drove it to zero and through it. A NEGATIVE multiplier is not a
 * very bad offense, it is a nonsensical one: it scales the drive-outcome
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

/** Per-quarter multiplier on drive quality, so a game can swing the way real
 * ones do. Symmetric around 1 so it adds noise without handing either side
 * points over a season.
 *
 * SOLVED, by tools/calibrate-nfl-variance.mjs, against the real league's mean
 * final margin (11.5 points) and its share of one-score games (45%) measured
 * over every drafted pair - see that tool for where those two figures come
 * from and for the honest note that nothing in this repository measures them.
 *
 * ONE DRAW PER TEAM PER QUARTER, which is new and is why the value could move
 * at all. It used to be drawn per DRIVE, and eleven independent draws a game
 * cancel out: measured before the fix, widening this range from ±22% to ±54%
 * moved the mean final margin by 0.2 of a point. The constant has always been
 * named for a quarter; this is the first version where the engine agrees (see
 * quarterRoll in engine.js).
 *
 * ±46%, AND IT IS NO LONGER PINNED TO THE EDGE OF THE SWEEP. The previous
 * value was ±54%, and the note here said it was "a cap rather than an
 * optimum": with parity at its ceiling, noise was the only lever left that
 * could widen margins toward football's, so an unbounded sweep kept improving
 * as long as it was offered more range - it reached ±86% and was still going.
 * A solve that always wants more of a knob is a solve telling you the knob is
 * standing in for something else.
 *
 * It was. Once defensive units were rated on disruption rate rather than
 * counting volume, talent itself widened the margins and the sweep stopped
 * running away: it now picks ±46% from the middle of the range offered, with
 * ±54% scoring worse. Less noise and more talent, which is the direction this
 * lever should always move if the engine underneath it is getting better.
 *
 * What that leaves, said plainly: the shape targets are met rather than
 * approached. A 45.2% one-score share against the league's 45%, and 11.88
 * points of mean margin against 11.5 - where the ±54% version reported 51% and
 * 10.6 and could not close the rest. */
export const TEAM_QUARTER_VARIANCE_MIN = 0.54;
export const TEAM_QUARTER_VARIANCE_MAX = 1.46;

/**
 * HOW HARD A RATED UNIT PUSHES THE THING IT IS GOOD AT.
 *
 * The engine already models four sub-outcomes a defence can decide - a stop
 * turning into a takeaway, a scoring drive held to three, a quarterback put on
 * the floor, and a drive stalling short - and until now every one of them was
 * driven by the GAMEPLAN alone. `theirs.passRush` was Blitz Pressure's 1.40 and
 * nothing else: the men doing the rushing did not appear in it. So a drafted
 * front and a drafted secondary were interchangeable, and the only thing a
 * defensive pick could do was move the one flat number in `edge`.
 *
 * Each axis is now `plan x personnel`, and this is the personnel half: an axis
 * rating of 0.5 - a league-average unit - multiplies by exactly 1, so an
 * ordinary defence behaves precisely as it did before this existed and none of
 * the solved gameplan numbers move underneath it. An elite unit at 0.95 pushes
 * its own axis by +0.32, a replacement one at 0.10 by -0.26.
 *
 * CENTRED ON 1 IS THE WHOLE DESIGN. It is what lets a matchup model be added
 * to a calibrated engine without re-deriving the calibration: the average game
 * is unchanged by construction, and only the spread around it grows.
 *
 * 0.7 is a decision, not a solve. It is the widest swing at which the realism
 * bands in scripts/verify-nfl-realism.mjs all still hold - past it an elite
 * secondary starts erasing passing lines the way TALENT_PARITY above 1.6
 * erases quarterbacks, which is the same trade and the same answer.
 */
export const AXIS_SWING = 0.7;

/**
 * WHERE THE BALL IS WHEN THE DRIVE STARTS, AND WHY IT USED TO BE WORTH
 * NOTHING.
 *
 * `driveOutcome` took no field position at all. A drive starting on the
 * opponent's 40 after a takeaway had exactly the same touchdown probability as
 * one starting on its own 3, and the only thing a short field bought was a
 * shorter distance to travel in `driveYards`. Two things followed:
 *
 *   A DEFENCE COULD NOT COMPOUND. Forcing a three-and-out pins the opponent
 *   deep, and pinning them deep did nothing, so the reward for a dominant
 *   defensive series was a single stop rather than a stop plus the bad field
 *   position that a real defence turns it into. This is most of why sustained
 *   defensive quality was invisible on the scoreboard.
 *
 *   A TAKEAWAY WAS UNDERPAID. The short field is the entire reason a turnover
 *   swings a football game, and the model was throwing it away.
 *
 * So drive quality is scaled by how far there is to go, against the ordinary
 * touchback start as the zero point. The multiplier at DRIVE_START_YARD is
 * exactly 1, which - like AXIS_SWING - is what keeps every solved constant
 * above meaning what it meant: an average drive from the usual place is
 * untouched, and only drives that start somewhere unusual move.
 *
 * Bounded because the ends are where a linear term stops being football: a
 * drive from the opponent's 45 is a good spot, not a guaranteed touchdown, and
 * one from your own 2 is hard rather than hopeless.
 */
export const FIELD_POSITION_SWING = 0.9;
export const FIELD_POSITION_MIN = 0.62;
export const FIELD_POSITION_MAX = 1.55;

/**
 * How much of a quarterback reaches the things a quarterback decides.
 *
 * His rating carried OFFENSE_WEIGHTS.QB into the drive multiplier and stopped
 * there. Everywhere else football actually separates passers - giving the ball
 * away, taking a sack, finishing a drive with seven instead of three - was a
 * gameplan number with no man attached, so an elite quarterback and a
 * replacement one threw the same interceptions behind the same protection.
 * The one place his rating did reach, `deadShare` in buildPlays, changes only
 * how a drive's yardage is spelled out across downs: it cannot move a point.
 *
 * Same centring rule as AXIS_SWING: a 0.5 quarterback multiplies by 1.
 *
 * Deliberately smaller than AXIS_SWING because he is already the largest
 * single weight in OFFENSE_WEIGHTS, and this is an addition to that rather
 * than a replacement for it. Double-counting him is the failure mode here.
 */
export const QB_SWING = 0.45;

/**
 * What ONE forfeited pick costs, as a flat deduction from BOTH of a roster's
 * side ratings. Equal for every slot, special teams included.
 *
 * MEASURED, NOT AUTHORED. The previous shape scaled the forfeited slot's own
 * rating by 0.55, so the cost tracked that slot's weight: measured over 3,000
 * seeded sims, forfeiting the QB cost 15.6 win points and forfeiting WR3 cost
 * 3.1, while forfeiting ST cost nothing at all because special teams carries no
 * weight to scale. A number no player can predict is not a penalty, it is a
 * trap. At this value every slot costs 3-5 win points, which is what a missed
 * pick out of twelve should be worth.
 *
 * DELIBERATELY NOT WEIGHTED BY SLOT. How much a missed pick costs is a fairness
 * decision about the draft, not a football opinion about position value - the
 * slot weights stay the place where position value lives.
 *
 * SOLVED AGAINST THE ENGINE THAT SHIPS, and re-solved once already. At 0.014 a
 * forfeit cost 3.6 win points; wiring special teams into the simulation then
 * dropped the same constant to 2.4, because a kicking game decided by the
 * unit's real accuracy adds outcomes that talent does not control, and noise
 * flattens the curve talent is spent on. 0.018 puts it back at 4.0 - measured
 * as the mean over three seeds of 8,000 games, reading 3.2, 4.2 and 4.5.
 *
 * AIMED AT THE MIDDLE OF THE BAND, NOT ITS EDGE, and that is not tidiness: a
 * win-rate difference over 8,000 games carries about +/-0.8 of noise, so a
 * constant solved to land on 5.0 would measure outside the band about half the
 * time it was checked. 0.021 was tried first and did exactly that.
 *
 * Re-measure with scripts/verify-nfl-forfeit-cost.mjs after any change to the
 * slot weights, to units.js, or to TALENT_PARITY.
 */
export const FORFEIT_RATING_COST = 0.018;
