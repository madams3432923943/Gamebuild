// Fourth down, and the rest of the late game, as DECISIONS.
//
// This file exists because the engine had none. A drive's ending was drawn
// from a fixed chart (DRIVE_OUTCOMES) and the single correction applied to it
// was "nobody punts from field-goal range". Everything else - the score, the
// clock, how many possessions were left, how far it was to the sticks - was
// invisible to the call. The one situational flag that did exist keyed off a
// possession INDEX, so behaviour flipped at the third-quarter boundary instead
// of sliding with the game: measured over 120 games, a trailing team punted 47
// times in the third quarter, down as much as 24, and in the fourth could not
// punt at all.
//
// It is a separate file rather than more of engine.js for two reasons. It is
// one responsibility - given a situation, what does a coach do - and it is the
// part that has to be TESTABLE ON ITS OWN. "Down 8 with four minutes left on
// 4th-and-2" is a question you should be able to ask directly, without
// simulating a thousand games and hoping the case comes up.
//
// WHAT IT DOES NOT DO. It does not make the engine simulate downs. The drive
// model is unchanged and deliberately so; this decides what happens at the
// fourth down a stalled drive implies, using a distance drawn from real
// fourth-down frequencies rather than one the engine tracked. See
// FOURTH_DOWN_DISTANCES.

import {
  FOURTH_DOWN_CONVERSION_BY_DISTANCE,
  FOURTH_DOWN_DISTANCES,
  FOURTH_DOWN_DRIVE_LIVES,
  FOURTH_DOWN_AGGRESSION,
  FG_RANGE_YARD,
  POINTS,
} from "./constants.js";

/**
 * A game situation, as much of one as this engine can honestly describe.
 *
 * `minutesLeft` is derived from the possession index, and that is not a
 * shortcut - it is the only figure that matches what the player will SEE.
 * Playback fits every quarter to exactly 900 seconds (see clockScaleByQuarter)
 * and the engine assigns a drive to a quarter by possession index, so
 * `60 * (1 - index / possessions)` reproduces the displayed clock. Deriving
 * time from the seconds the plays happened to burn would put the decision on a
 * different clock from the one on screen, which is precisely the mismatch that
 * made the reported punt look wrong: it was a third-quarter call that read as
 * a fourth-quarter one.
 */
export function situationFor({ possessionIndex, possessions, margin, quarter }) {
  const played = possessions > 0 ? possessionIndex / possessions : 0;
  // Your own drives left, this one included. The opponent gets the same
  // number, which is what "we may not get the ball back" actually means.
  const possessionsLeft = Math.max(1, possessions - possessionIndex);
  return {
    margin,
    quarter,
    possessionsLeft,
    minutesLeft: Math.max(0, 60 * (1 - played)),
    scoresNeeded: scoresNeeded(margin),
  };
}

/**
 * How many scoring drives it takes to draw level, from the trailing side.
 *
 * Eight, not seven: a team down eight needs a touchdown AND the two-point play,
 * which is one possession. Down nine needs two. This is the arithmetic the
 * two-point chart in constants.js is built on, and it is the same arithmetic a
 * coach does before deciding whether the punt team comes out.
 *
 * Zero when level or ahead - there is nothing to catch up.
 */
export function scoresNeeded(margin) {
  if (margin >= 0) return 0;
  return Math.ceil(-margin / (POINTS.touchdown + 2));
}

/** Conversion odds at this distance, from the real table. Clamped at both
 * ends rather than extrapolated: nobody has useful data on 4th-and-40. */
export function conversionOdds(distance) {
  const table = FOURTH_DOWN_CONVERSION_BY_DISTANCE;
  const index = Math.max(0, Math.min(table.length - 1, Math.round(distance)));
  return table[index];
}

/** The fourth down this drive died on. Drawn, because the engine decides a
 * drive's ending before it narrates the downs within it. */
export function drawDistance(rand) {
  const roll = rand();
  let seen = 0;
  for (const [yards, share] of FOURTH_DOWN_DISTANCES) {
    seen += share;
    if (roll < seen) return yards;
  }
  return FOURTH_DOWN_DISTANCES[FOURTH_DOWN_DISTANCES.length - 1][0];
}

/**
 * How much a field goal is worth to this team RIGHT NOW.
 *
 * Not "is it three points" - whether those three points change what the team
 * still needs. Down 8, a field goal leaves you needing another score and
 * having given up the ball, which is why a kick there is usually the wrong
 * call even though it puts points up. Down 3 it ties the game.
 */
function fieldGoalHelps(situation) {
  const { margin, possessionsLeft } = situation;
  if (margin >= 0) return true; // ahead or level: points are points
  const afterKick = margin + POINTS.fieldGoal;
  // A kick that still leaves you needing a touchdown is only worth it if you
  // can realistically expect the ball back to get that touchdown.
  if (afterKick < 0) return scoresNeeded(afterKick) < possessionsLeft;
  return true;
}

/**
 * THE CALL.
 *
 * Returns one of "go", "punt" or "fieldGoal", plus the distance and the odds
 * behind it so a test - or a future explanation in the UI - can say why.
 *
 * The shape of the model: compute how badly this team needs the ball, express
 * that as a threshold, and go for it when the conversion odds clear it. Every
 * term is continuous. There is no rule of the form "if down eight and under
 * five minutes", because that rule would be right in one game state and wrong
 * in the nine beside it.
 */
export function fourthDownCall({ endYard, situation, rand, distance = null }) {
  const toGo = distance ?? drawDistance(rand);
  const odds = conversionOdds(toGo);
  const { margin, possessionsLeft } = situation;
  const need = situation.scoresNeeded;

  const inFieldGoalRange = Math.round(endYard) >= FG_RANGE_YARD;
  const kickIsUseful = inFieldGoalRange && fieldGoalHelps(situation);

  // NOTHING ELSE WILL DO. More scores needed than drives left to get them: the
  // ball can never come back often enough, so there is no version of punting
  // that wins. This is the one branch that is absolute, and it is absolute
  // because the arithmetic is, not because a threshold was picked.
  if (need > possessionsLeft) {
    return { action: "go", toGo, odds, why: "more scores needed than possessions left" };
  }

  // Exactly enough drives left, and a kick does not finish the job. Going is
  // strongly preferred; the only thing that argues back is a conversion so
  // unlikely that pinning them deep and hoping for a stop really is better.
  if (need >= possessionsLeft && !kickIsUseful) {
    const desperate = odds >= 0.20 || !inOwnTerritory(endYard);
    if (desperate) {
      return { action: "go", toGo, odds, why: "last realistic possession" };
    }
    return { action: "punt", toGo, odds, why: "long way to go, deep in own half, a stop can still return it" };
  }

  if (kickIsUseful) {
    return { action: "fieldGoal", toGo, odds, why: "in range and the points change the picture" };
  }

  // The general case, sliding rather than stepping.
  const threshold = goThreshold(situation, endYard);
  if (odds >= threshold) {
    return { action: "go", toGo, odds, why: "odds clear the situational threshold" };
  }
  if (inFieldGoalRange) {
    return { action: "fieldGoal", toGo, odds, why: "in range, not worth the down" };
  }
  return { action: "punt", toGo, odds, why: "ordinary fourth down" };
}

/** Inside your own half, where a failed fourth hands over a short field. */
function inOwnTerritory(endYard) {
  return endYard < 50;
}

/**
 * WHAT A FAILED FOURTH DOWN COSTS, by where it is attempted.
 *
 * The conversion odds are the same on 4th-and-2 from your own 15 as from the
 * opponent's 40; what differs is the price of missing. Failing on your own 15
 * hands over a field goal and probably seven. Failing on their 40 gives them
 * the ball where a punt would roughly have left them anyway, which is why real
 * teams are far bolder past midfield.
 *
 * Without this the model went for it on 4th-and-2 from its own 40 in a tied
 * first quarter, which is not football - it is a spreadsheet that has not been
 * told the other team gets the ball.
 *
 * Returns a number SUBTRACTED from aggression, so it is largest deep in your
 * own end and slightly negative in opponent territory.
 */
function fieldPositionCost(endYard) {
  const spot = Math.max(1, Math.min(99, Number(endYard) || 50));
  if (spot >= 50) {
    // Past midfield: mildly emboldening, and more so the closer you are.
    return -0.06 * ((spot - 50) / 50);
  }
  // Own half: the cost climbs steeply toward your own goal line.
  return 0.34 * ((50 - spot) / 50) ** 1.4;
}

/**
 * The conversion probability a team needs to see before going for it.
 *
 * LOW means aggressive. A trailing team's threshold falls as the deficit grows
 * and as its possessions run out; a leading team's rises, so it punts, takes
 * the points and makes the other team use their drives.
 */
export function goThreshold(situation, endYard = 50) {
  const { margin, possessionsLeft } = situation;
  const cfg = FOURTH_DOWN_AGGRESSION;
  let aggression = cfg.base - fieldPositionCost(endYard);

  if (margin < 0) {
    const need = situation.scoresNeeded;
    // Urgency is scores needed against drives available. At 1:1 the team is
    // out of slack; well under 1 there is still a normal game to play.
    const urgency = Math.min(cfg.urgencyCap, need / Math.max(1, possessionsLeft) * 2);
    aggression += cfg.perScoreBehind * need * urgency;
  } else if (margin > 0) {
    const ahead = Math.ceil(margin / (POINTS.touchdown + 2));
    // Protecting hardens as the game shortens - a two-score lead in the first
    // quarter is not the same instruction as the same lead with two drives to
    // play.
    const lateness = 1 + Math.max(0, (6 - possessionsLeft)) / 6;
    aggression -= cfg.perScoreAhead * ahead * lateness;
  }

  // An aggression of 0 means "go only on a certainty"; high aggression means
  // "go on almost anything". Mapped into a probability threshold, floored so a
  // desperate team still will not go for it on a hopeless conversion for no
  // reason, and capped so a comfortable leader still goes for fourth-and-inches
  // occasionally, which real teams do.
  return Math.max(0.12, Math.min(0.92, 0.62 - aggression));
}

/**
 * Whether a drive that MUST have seven can still settle for three.
 *
 * Replaces a rule that only ever fired on the final possession of the game and
 * only when the deficit was bigger than a field goal. The idea was right and
 * the window was too narrow: a team down eight with two drives left is already
 * in a game where three points do not help, and it kicked anyway.
 */
export function mustScoreTouchdown(situation) {
  if (situation.margin >= 0) return false;
  return !fieldGoalHelps(situation);
}

/** Whether the two-point chart's arithmetic is close enough to mean anything.
 * Possessions, not a quarter - see TWO_POINT_CHART_QUARTER. */
export function twoPointWindow(situation, chartQuarter, chartPossessions) {
  return situation.quarter >= chartQuarter && situation.possessionsLeft <= chartPossessions;
}

/** Share of converted fourth downs that go on to score. Exported so the engine
 * and the tests read the same number. */
export const DRIVE_LIVES_ON = FOURTH_DOWN_DRIVE_LIVES;
