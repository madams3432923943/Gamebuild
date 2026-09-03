// NFL simulation: a drive model, and the numbers a football box score is made of.
//
// The contract it must satisfy, read off what js/sports/nba/index.js declares
// and what js/main.js actually calls:
//
//   computeDatasetStats(players)          -> whatever the sim needs precomputed
//   simulate(rosterA, rosterB, stats, opts)
//        opts: { tacticA, tacticB, minutesA, minutesB, matchupsA, matchupsB,
//                forfeitsA, forfeitsB }   - football will want its own set;
//                what matters is that forfeited picks still cost something,
//                since that is a rule about the GAME, not about basketball
//        returns: { teamScoreA, teamScoreB, boxA, boxB, quarterBoxScores,
//                   overtimePeriods, winner, analysis, drives }
//   draftAnalysis(roster, oppRoster, stats, forfeits)
//
// Why the basketball engine cannot be reused, in one line: it models five
// defenders guarding five attackers over 48 shared minutes. Football is
// unit-on-unit over ~22 drives, scoring in 7s and 3s. See docs/nfl-plan.md.
//
// ---------------------------------------------------------------------------
// THE PART THAT SHAPES EVERYTHING: `drives`
// ---------------------------------------------------------------------------
//
// The game is watched, not read. Basketball's presentation works because a
// quarter box score IS the drama - points accumulate smoothly and a table
// filling in tells the story. Football's drama is field position swinging and
// somebody's NAME on the score. A quarter box score throws away both: it can
// say a team scored 14, but not that the drive stalled at the 40, or that it
// was your third receiver who broke it open.
//
// So `drives` is a first-class return value, not a debug log, and the engine
// has to be built to produce it rather than have it reconstructed afterward.
// Reconstruction is impossible anyway - once you have only "14 points in Q2"
// the scorer is gone.
//
//   drives: [{
//     team: "A" | "B",
//     quarter: 1..4 (or 5+ for overtime),
//     startYard: number,      // from the drive team's own goal line
//     endYard: number,        // where it finished - the arrow's destination
//     outcome: "touchdown" | "fieldGoal" | "punt" | "turnover" | "downs",
//     points: number,
//     scorer: string | null,  // "Zay Flowers", "Adam Vinatieri" - null if no score
//     scorerSlot: string | null,   // "WR3", "ST" - lets the UI show the pick
//     credit: string | null,  // the defensive UNIT that ended it, for stops:
//                             // "S" when the secondary picked it off
//     text: string,           // ready-to-show: "Zay Flowers 24 yd TD reception"
//   }]
//
// ATTRIBUTION IS A MODELLING JOB, NOT A COSMETIC ONE
//
// "Zay Flowers touchdown" requires the engine to decide WHICH receiver scored,
// and that decision has to be honest or the popup becomes a lie the box score
// then repeats. Weight each pass-catcher by his real share of the roster's
// rec_td, each rusher by rush_td share, and let the quarterback take rushing
// scores at his own rate. A drafted 2013 Josh Gordon should show up in the
// highlights about as often as he really did, because his share of the team's
// touchdowns is what put him there.
//
// The same rule makes the ST pick visible: a field goal is attributed to the
// kicker by name, and whether it goes through comes off HIS fg_pct at that
// distance. That is the whole reason ST is a draft slot rather than a constant.
//
// Defensive credit matters just as much and is easier to forget. A drive that
// ends in an interception should name the unit that caused it - the drafter
// picked the 2013 Seahawks secondary specifically so it would take the ball
// away, and a sim that says only "turnover" hides the payoff for the pick.
//
// FIELD POSITION HAS TO BE CONTINUOUS
//
// startYard/endYard exist so the UI can animate the ball up and down the field
// rather than cutting between scores. That means a punt is not "nothing
// happened" - it moves the opponent's next startYard, and a drive that reaches
// the 45 and stalls has to hand over better position than one that went three
// and out. Field position compounding across drives is most of what makes a
// football game feel like it has momentum, and dropping it would leave the
// arrow teleporting between scoring plays.
//
// quarterBoxScores stays in the return for the existing screens, but it is a
// SUMMARY OF `drives`, derived from it, never tracked in parallel. Two writers
// for one truth is how a scoreboard and a play-by-play end up disagreeing.
//
// ---------------------------------------------------------------------------
// WHAT DRAWS THIS
// ---------------------------------------------------------------------------
//
// Football has its own playback now, and none of it lives here. The engine
// returns drives; js/sports/nfl/playback.js turns them into a timeline,
// js/sports/nfl/field.js draws the horizontal field the ball moves along, and
// the box score renders football's own columns rather than basketball's six.
// The return value below is the whole interface between them - nothing in the
// view reaches back into the simulation.
//

import {
  DRIVES_PER_TEAM, SCORING_LIFT, EDGE_BASELINE, DRIVE_START_YARD, FG_RANGE_YARD,
  DRIVE_OUTCOMES, POINTS, OFFENSE_WEIGHTS, DEFENSE_WEIGHTS, TALENT_PARITY, EDGE_FLOOR,
  TEAM_QUARTER_VARIANCE_MIN, TEAM_QUARTER_VARIANCE_MAX, FORFEIT_PENALTY,
  RUSH_CARRIER_WEIGHTS, EXTRA_POINT_SUCCESS, TWO_POINT_SUCCESS,
  TWO_POINT_BASELINE_RATE, TWO_POINT_MARGINS, TWO_POINT_CHART_QUARTER,
} from "./constants.js";
import { buildRatingContext, rateEntry, isUnit } from "./units.js";
import { composedModsFor, affinityRevealFor } from "./tactics.js";

export function computeDatasetStats(players, units) {
  const ctx = buildRatingContext(players, units);
  // Kept so the draft grade can sample real rosters to build its curve
  // without re-reading the dataset. See js/gradecurve.js.
  ctx.__allEntries = [...(players || []), ...(units || [])];
  return ctx;
}

/** Weighted mean of the slots on one side of the ball. A forfeited slot is not
 * a zero - it is a replacement-level body, which is what actually takes the
 * field when you have nobody. Zero would mean eleven men playing ten. */
function sideRating(roster, weights, forfeits, ctx) {
  let total = 0;
  for (const [slot, weight] of Object.entries(weights)) {
    // Quick Play drafts one DEF unit instead of four, so it stands in for
    // every defensive slot - one pick really is the whole defence there.
    //
    // The same rule has to reach the OFFENCE, and for a long time it did not.
    // Quick Play drafts a bare "WR" while the weights are keyed WR1/WR2/WR3, so
    // all three missed, fell to the 0.5 below, and pinned a fifth of the Quick
    // Play offence at league average - the drafted receiver changed the rating
    // by nothing at all. Stripping the depth ordinal is the same resolution the
    // rest of football already uses (pickScorer does it for carries, the draft
    // board does it for eligibility): the trailing digit is a depth-chart index,
    // not a different position. Written generically rather than as a test for
    // "WR" so any numbered slot added later inherits it.
    const entry =
      roster[slot] ??
      (DEFENSE_WEIGHTS[slot] ? roster.DEF : undefined) ??
      roster[slot.replace(/\d+$/, "")];
    const rated = entry ? rateEntry(entry, ctx) : 0.5;
    const penalised = forfeits?.includes(slot) ? rated * (1 - FORFEIT_PENALTY) : rated;
    total += weight * penalised;
  }
  return total;
}

/**
 * Both sides of the ball for one roster, rated exactly as the simulation
 * rates them.
 *
 * Exported for the calibrators, which have to measure the talent gap between
 * two drafted rosters before they can ask how often the better one wins. A
 * harness that scored rosters with its OWN formula would be solving the
 * balance levers against a gap the engine never sees - which is how you get
 * numbers that look solved and are not.
 */
export function rosterRatings(roster, ctx, forfeits) {
  return {
    off: sideRating(roster, OFFENSE_WEIGHTS, forfeits, ctx),
    def: sideRating(roster, DEFENSE_WEIGHTS, forfeits, ctx),
  };
}

/**
 * Turns an offence/defence gap into a multiplier on drive quality.
 *
 * TALENT_PARITY compresses it: football has enormous per-possession variance,
 * and a sim where the better roster converted every mismatch would produce
 * scores no real game reaches.
 *
 * `baseline` IS THE FIX FOR THE THING THIS COMMENT USED TO CLAIM. It said
 * "centred on 1 so an even matchup is average", and it was not: it compared
 * one roster's OFFENCE rating against another's DEFENCE rating as if the two
 * were the same measurement, and they are not. Over 600 bot-drafted ranked
 * rosters offence rates 0.904 and defence 0.794, so both sides of every game
 * carried a systematic +0.11 - which is a lift on all scoring, not a talent
 * edge, and it moved whenever TALENT_PARITY did. See SCORING_LIFT in
 * constants.js for the full account and for the second symptom, Quick Play
 * quietly scoring 20% lower than Ranked.
 *
 * The baseline passed in is what an average matchup of this ROSTER SHAPE
 * rates at (EDGE_BASELINE), so subtracting it puts an average game at 1 and
 * leaves everything else measured from there. It is deliberately not the two
 * rosters' OWN mean, which is the tempting version and is wrong: centring each
 * pair on itself makes the model purely relative, so a poor offence stops
 * being poor in absolute terms and only makes its opponent look good. Measured
 * that way, a bottom-tier quarterback threw for 231 yards a game instead of
 * 161 - the model had stopped saying anything about him.
 *
 * SCORING_LIFT then puts the explosiveness back, deliberately and in one
 * place, at a value nobody has to derive from two rating scales agreeing by
 * accident.
 */
function edge(off, def, baseline = 0, parity = TALENT_PARITY) {
  // Floored: see EDGE_FLOOR. Without it a wide enough talent gap sent the
  // multiplier negative, which inverts the drive-outcome weights rather than
  // merely shrinking them.
  return Math.max(EDGE_FLOOR, SCORING_LIFT * (1 + parity * (off - def - baseline)));
}

/**
 * Which roster SHAPE this game is being played at, for EDGE_BASELINE.
 *
 * Football drafts two shapes: ranked names four defensive slots (DL/LB/CB/S),
 * Quick Play names one DEF unit that stands in for all of them, and they rate
 * differently enough that using the wrong baseline moves the scoreboard about
 * 20%.
 *
 * Decided from every slot the game KNOWS ABOUT - both rosters' keys plus the
 * slots either side forfeited - rather than from the entries that happen to be
 * present. A forfeited pick leaves no key behind, so reading filled slots
 * alone makes a Quick Play game where both sides skipped the defence look like
 * a ranked one. Forfeits are exactly the case this has to survive, since they
 * are the reason a slot can be missing at all.
 */
function rosterShape(rosterA, rosterB, opts = {}) {
  const named = new Set([
    ...Object.keys(rosterA || {}),
    ...Object.keys(rosterB || {}),
    ...(opts.forfeitsA || []),
    ...(opts.forfeitsB || []),
  ]);
  // Any of the four individual defensive slots means this is the ranked shape.
  // Absence of all four is Quick Play - including the degenerate case where
  // nothing defensive was drafted at all, which is nearer Quick Play's rating
  // than ranked's and, either way, is a roster that has already lost.
  for (const slot of Object.keys(DEFENSE_WEIGHTS)) {
    if (named.has(slot)) return "ranked";
  }
  return "quickPlay";
}

/**
 * The balance levers a calibration harness may override, resolved once per
 * simulation.
 *
 * Solving TALENT_PARITY and the quarter-variance range means running the
 * engine AT candidate values and reading the win rates back. Basketball has
 * had that door since it was calibrated (opts.parity and opts.teamVariance -
 * see tools/calibrate-variance.mjs); football never did, which is most of why
 * its levers stayed authored: every candidate value would have meant editing
 * constants.js between runs and re-copying the vendored engine each time.
 *
 * The defaults ARE the shipped constants, so a game that passes no overrides
 * runs exactly as it did before this existed - including consuming the random
 * stream in the same order, which verify:parity would otherwise catch.
 */
function resolveTuning(opts) {
  const variance = opts.teamVariance || null;
  const min = Number(variance?.min);
  const max = Number(variance?.max);
  return {
    parity: Number.isFinite(opts.parity) ? opts.parity : TALENT_PARITY,
    varianceMin: Number.isFinite(min) ? min : TEAM_QUARTER_VARIANCE_MIN,
    varianceMax: Number.isFinite(max) ? max : TEAM_QUARTER_VARIANCE_MAX,
  };
}

/** The shipped levers, for a call site that has no opts to read. */
const DEFAULT_TUNING = resolveTuning({});

/** Picks a drive's ending from the league-average chart, tilted by the edge.
 * Scoring outcomes scale up with a good offence and punts/turnovers take the
 * difference, so the four still sum to 1 and no probability can go negative. */
/**
 * How a drive ends - and, when it matters, whether punting is even a choice.
 *
 * NOTHING TO LOSE. This used to take no game state at all, so a team trailing
 * by three in overtime punted 49% of the time exactly like the opening drive
 * of the game. That is not a football decision, it is a coin flip that hands
 * the ball back when handing the ball back loses. A team that must score does
 * not punt: it goes for it, and either converts or turns it over on downs
 * where the drive died.
 *
 * The punt share is redistributed rather than deleted, so the drive count and
 * the pace of the game are unchanged - what changes is that the ball stays on
 * the field.
 */
function driveOutcome(mult, rand, mustScore = false, mustTouchdown = false) {
  const td = DRIVE_OUTCOMES.touchdown * mult;
  // A FIELD GOAL THAT CANNOT TIE THE GAME IS NOT AN OUTCOME. Reported from a
  // live game: down seven in overtime, the offence kicked three. No team has
  // ever done that, because three points on the last possession of a game you
  // trail by seven loses by four instead of by seven. When the deficit is
  // bigger than a field goal and there is no next possession, the drive is
  // playing for the touchdown - it either gets in or it ends on downs, and the
  // kicking share goes to those two rather than to the scoreboard.
  const fg = mustTouchdown ? 0 : DRIVE_OUTCOMES.fieldGoal * mult;
  let scoring = Math.min(0.92, td + fg);
  let remaining = 1 - scoring;
  const puntShare = DRIVE_OUTCOMES.punt / (DRIVE_OUTCOMES.punt + DRIVE_OUTCOMES.turnover);

  if (mustScore) {
    // Fourth down, going for it. Some of those attempts convert and the drive
    // goes on to score; the rest end where they stood.
    scoring = Math.min(0.95, scoring + remaining * puntShare * FOURTH_DOWN_CONVERSION);
    remaining = 1 - scoring;
  }

  const roll = rand();
  if (roll < td / (td + fg) * scoring) return "touchdown";
  if (roll < scoring) return "fieldGoal";
  if (mustScore) {
    // No punt exists in this situation. What is left is a failed fourth down
    // or a genuine takeaway, and a failed fourth is much the more common.
    return roll < scoring + remaining * 0.72 ? "downs" : "turnover";
  }
  if (roll < scoring + remaining * puntShare) return "punt";
  return "turnover";
}

/** How often a fourth-down attempt by a desperate offence converts AND the
 * drive goes on to score. Real fourth-down conversion runs near 50%, and not
 * every conversion produces points. */
const FOURTH_DOWN_CONVERSION = 0.34;

/** Who scored. Weighted by each player's real share of the roster's touchdowns,
 * so the popup is a claim the box score can back - a drafted Randy Moss shows
 * up in highlights about as often as he really did. */
function pickScorer(roster, kind, rand) {
  const field = kind === "rush" ? "rush_td" : "rec_td";
  const candidates = [];
  let total = 0;
  for (const [slot, entry] of Object.entries(roster)) {
    if (!entry || isUnit(entry)) continue;
    // A quarterback does not catch his own pass. The dataset carries the odd
    // receiving touchdown for one - trick plays, where somebody else threw it -
    // and without this he was drawn as his own receiver, which credited him a
    // completion and a reception on the same play and put the box score's
    // completions one ahead of its receptions.
    if (kind === "rec" && slot === "QB") continue;
    let share = Number(entry[field]) || 0;
    // On the ground, the POSITION gates the play before production weighs it.
    // WR3 and WR are the same job; the trailing digit is a depth-chart index,
    // not a different position.
    if (kind === "rush") share *= RUSH_CARRIER_WEIGHTS[slot.replace(/\d+$/, "")] ?? 0;
    if (share <= 0) continue;
    candidates.push({ slot, entry, share });
    total += share;
  }
  if (total <= 0) return null;
  let roll = rand() * total;
  for (const c of candidates) {
    roll -= c.share;
    if (roll <= 0) return c;
  }
  return candidates[candidates.length - 1];
}

/**
 * WHICH UNIT GOT HOME. Weighted by each unit's real sack production, so the
 * front that actually rushed the passer is the one that shows up in the box
 * score - which is the point of drafting it.
 *
 * The same shape as pickStopper below, and next to it on purpose: both answer
 * "who on defence did this", and a sack is exactly as much of a defensive play
 * as a takeaway. It was the one that had no answer at all - a sack existed
 * only as a cost to the quarterback, so a drafted pass rush was invisible in
 * the table however often it got there.
 */
function pickSacker(roster, rand) {
  const candidates = [];
  let total = 0;
  for (const slot of Object.keys(DEFENSE_WEIGHTS)) {
    const entry = roster?.[slot];
    if (!entry) continue;
    // The small floor keeps a secondary that never recorded a sack able to
    // produce the occasional coverage sack, rather than making it impossible.
    const share = (Number(entry.sacks) || 0) + 0.04;
    candidates.push({ slot, share });
    total += share;
  }
  if (!candidates.length) return null;
  let roll = rand() * total;
  for (const c of candidates) {
    roll -= c.share;
    if (roll <= 0) return c;
  }
  return candidates[0];
}

/** Which defensive unit gets credit for ending a drive. Weighted by takeaway
 * production, because somebody drafted the 2013 Seahawks secondary precisely
 * so it would take the ball away - a bare "turnover" hides that payoff. */
function pickStopper(roster, rand) {
  const candidates = [];
  let total = 0;
  for (const slot of Object.keys(DEFENSE_WEIGHTS)) {
    const entry = roster[slot];
    if (!entry) continue;
    const share = (Number(entry.ints) || 0) + (Number(entry.ff) || 0) + 0.05;
    candidates.push({ slot, entry, share });
    total += share;
  }
  if (!candidates.length) return null;
  let roll = rand() * total;
  for (const c of candidates) {
    roll -= c.share;
    if (roll <= 0) return c;
  }
  return candidates[0];
}

/** Yards a drive covered, given how it ended. Touchdowns go the distance by
 * definition; a punt that reached midfield hands over worse position than one
 * that went three and out, which is what makes field position compound. */
function driveYards(outcome, startYard, mult, rand) {
  // The WHOLE reach scales with talent, not just the variable part. With the
  // floor outside the multiplier a hopeless offence still marched 18 yards a
  // drive for free, which is most of why a backup quarterback's yardage
  // looked like a starter's.
  //
  // 24/53. THIS IS ABOVE REAL FOOTBALL ON PURPOSE - read the DESIGN TARGET note
  // at the top of scripts/verify-nfl-realism.mjs before "correcting" it. Draft
  // Nova aims for 350 yards a team at 5.8 a play against the NFL's 340 and 5.4,
  // because a drafted roster of all-time seasons playing to a league average is
  // a disappointing product. Measured at 369 and 6.05. The realism bands were
  // always wide enough to hold this; what they forbid is football stopping
  // being football.
  //
  // The number has moved three times. First 18/42 -> 22/50, when adding SAF to
  // tools/build-nfl-data.mjs pulled 43 more (mostly weaker) safety units into
  // the pool, shifting the S percentile distribution, lifting every safety's
  // rating and suppressing offence about 8%. Then 22/50 -> 28/62 for the target
  // above.
  //
  // Then 28/62 -> 24/53, and that one is worth reading, because 28/62 was never
  // really measured. verify-nfl-realism rates every drive on ONE fixture, and
  // its offensive line came out of `unitFor('OL')` - the middle of an unsorted
  // list. That line rated 0.155, near the floor, and a floor-rated line drags a
  // whole sample's offence down. 28/62 was solved against that suppression, so
  // the bands passed while the engine actually produced 5.44 a carry for any
  // ordinary roster - outside the band it was being certified against.
  //
  // Fixing the offensive-line data (sacks_suffered, see buildOlUnit) re-rated
  // every line and the fixture's became an ordinary 0.495. The suppression
  // vanished, the sample jumped to 411 yards at 6.47, and three bands failed at
  // once. Nothing about the engine got worse that day; a number that had been
  // wrong all along stopped being hidden.
  //
  // 24/53 is the value solved against a representative line. It was chosen over
  // a lower one that hit the 350 target more exactly, because measuring the two
  // against the SHIPPED game - same probe, same seed, stashed working tree -
  // showed 24/53 reproduces it almost exactly (369 yards against 377, 6.05 a
  // play against 6.09, 4.77 a carry against 4.85) while a lower reach drifted
  // further from it for no gain the bands asked for. Scoring is 21.3 a team
  // against the shipped 20.4, and the talent-to-win curve is unchanged.
  //
  // The 350-yard figure in the target above was itself solved against the
  // suppressed fixture, so treating it as ground truth here would have meant
  // re-fitting the game to a measurement error. Match the shipped product, not
  // the stale number.
  //
  // IT IS ONE OF THREE AND THEY ONLY WORK TOGETHER. Raising this alone also
  // raises the snap count and the game clock, because buildPlays derives snaps
  // from yardage - at 37/80 a game ran 69.8 plays across 64.9 minutes, which is
  // not a football game at any scoring level. The snaps divisor absorbs that,
  // and RUN_YARD_WEIGHT keeps the extra yardage off the ground game. Re-tuned by
  // hand against verify:nfl-realism; there is still no calibrator for football.
  const reach = (24 + 53 * rand()) * mult;
  if (outcome === "touchdown") return 100 - startYard;
  if (outcome === "fieldGoal") return Math.max(FG_RANGE_YARD - startYard, reach);
  // A DRIVE THAT DID NOT SCORE DID NOT GO FAR. This was `reach - 14`, about 25
  // yards, which is roughly double what a real punting drive gains - and since
  // three drives in five end this way it was most of why the simulation
  // produced 438 yards a game against football's 340. Scaled rather than
  // shifted, so a good offence still out-gains a poor one on the drives it
  // fails to finish instead of both clamping at the floor.
  return Math.max(-8, Math.min(100 - startYard - 1, reach * 0.55 - 10));
}

/** Where the opponent starts after a drive ends. A punt from deep pins them
 * further back than one from midfield, and a takeaway hands the ball over on
 * the spot - the single biggest reason a defensive pick pays off. */
function nextStart(outcome, endYard) {
  if (outcome === "turnover") return Math.max(8, Math.min(92, 100 - endYard));
  if (outcome === "punt") return Math.max(10, Math.min(45, 100 - endYard - 38));
  return DRIVE_START_YARD;
}

/** Whether a kick from this distance goes through, using the DRAFTED kicker's
 * accuracy rather than a constant. Falls back to a league-ish rate when the ST
 * slot was forfeited, scaled down for distance either way. */
function fieldGoalGood(kicker, endYard, rand, fgMod = 1) {
  const distance = 100 - endYard + 17;
  const base = (Number(kicker?.fg_pct) || 0.78) * fgMod;
  const longPenalty = Math.max(0, distance - 38) * 0.011;
  return rand() < Math.max(0.25, base - longPenalty);
}

/** What to call a roster entry out loud. A drafted unit carries the team it
 * came from, so "the Ravens special teams" beats "the unit" - which is what a
 * kicker with no named members used to be announced as, in a sentence that
 * read "Field goal by the unit". */
const label = (entry) => {
  // NULL for a missing entry, not a placeholder string. Returning "the unit"
  // here made every `label(x) || fallback` dead code, because the placeholder
  // is truthy - which is exactly how "Field goal by the unit" survived a
  // fallback written to prevent it.
  if (!entry) return null;
  if (entry.name) return entry.name;
  const team = entry.team ? `${entry.team} ` : "";
  return entry.group ? `${team}${GROUP_NAMES[entry.group] || entry.group}`.trim() : (team.trim() || null);
};

/** Plain names for the unit groups, so a sentence reads like football rather
 * than like a slot id. */
/** Which roster slot kicks. Ranked drafts special teams; Quick Play does not
 * have the slot at all, which is why a field goal there used to be announced
 * as "by the unit" - roster.ST was simply undefined and the fallback said so
 * out loud. */
function kickerSlot(roster) {
  for (const slot of ["ST", "K"]) if (roster && roster[slot]) return slot;
  return null;
}

function kickingEntry(roster) {
  const slot = kickerSlot(roster);
  return slot ? roster[slot] : null;
}

/** The team this roster was drafted from, for sentences that need a subject
 * when no individual is responsible. A roster is picked across several teams,
 * so this is the most common one rather than "the" team. */
function teamName(roster) {
  const counts = new Map();
  for (const entry of Object.values(roster || {})) {
    if (!entry?.team) continue;
    counts.set(entry.team, (counts.get(entry.team) || 0) + 1);
  }
  let best = null;
  for (const [team, n] of counts) if (!best || n > best[1]) best = [team, n];
  return best ? best[0] : "the offense";
}

const GROUP_NAMES = {
  ST: "special teams", OL: "offensive line", DL: "defensive line",
  LB: "linebackers", CB: "cornerbacks", S: "safeties", DEF: "defense",
};

/** WHO on this unit made the play. Weighted by each member's real takeaways of
 * that kind, so Richard Sherman turns up on 2013 Seahawks interceptions about
 * as often as he actually made them - and a corner who never picked one off
 * does not get handed a highlight he never earned.
 *
 * Falls back to the unit's name when nobody on it recorded that takeaway, which
 * is the honest answer rather than crediting a random body. */
function pickTakeawayMan(entry, kindOfTakeaway, rand) {
  const members = Array.isArray(entry?.members) ? entry.members : [];
  const field = kindOfTakeaway === "fumble" ? "ff" : "ints";
  let total = 0;
  for (const m of members) total += Number(m?.[field]) || 0;
  if (total <= 0) return null;
  let roll = rand() * total;
  for (const m of members) {
    roll -= Number(m?.[field]) || 0;
    if (roll <= 0) return m.name;
  }
  return members[0]?.name ?? null;
}

/**
 * What to do after a touchdown, and whether it worked.
 *
 * @param margin the score difference AFTER the six points, from the scoring
 *   team's side - which is the number the chart is written in terms of.
 */
function runConversion(margin, quarter, rand) {
  const chart = quarter >= TWO_POINT_CHART_QUARTER && TWO_POINT_MARGINS.includes(margin);
  // The roll happens either way, so the random stream does not depend on
  // whether the chart fired - which keeps a replay of the same seed identical
  // however the baseline rate is set.
  const goForTwo = chart || rand() < TWO_POINT_BASELINE_RATE;
  const good = rand() < (goForTwo ? TWO_POINT_SUCCESS : EXTRA_POINT_SUCCESS);
  return { type: goForTwo ? "two" : "xp", good, points: good ? (goForTwo ? 2 : 1) : 0 };
}

/** How the conversion reads in the feed. A made extra point is not news and
 * says nothing; the other three are all worth a sentence. */
function describeConversion(conversion) {
  if (!conversion) return "";
  if (conversion.type === "two") {
    return conversion.good ? " - two-point conversion good" : " - two-point try no good";
  }
  return conversion.good ? "" : " - extra point missed";
}

/** One team's drive. Returns the record the UI animates and the field position
 * the opponent inherits.
 *
 * @param margin this team's score minus the opponent's, entering the drive.
 *   Only the conversion decision reads it; a drive itself does not care.
 */
function runDrive(ctx, side, off, def, roster, oppRoster, startYard, quarter, rand, mine, theirs, mustScore = false, margin = 0, lastChance = false, tuning = DEFAULT_TUNING, quarterRoll = 1, baseline = 0) {
  // The gamestyle acts on BOTH sides: yours lifts your offence, theirs lifts
  // the defence you are running into. A style that only helped its owner would
  // make the opponent's choice invisible, which is half the decision gone.
  const offAdj = off * mine.off;
  const defAdj = def * theirs.def * ((theirs.passRush + theirs.coverage + theirs.runDef) / 3);
  const mult = edge(offAdj, defAdj, baseline, tuning.parity) * quarterRoll;
  // No next possession AND three points do not get you level: the only thing
  // worth playing for is the touchdown. `margin` is this team's score minus
  // theirs entering the drive, so -3 can still be tied by a kick and -4 cannot.
  //
  // Deliberately narrower than mustScore, which also covers the possession
  // BEFORE the last one - there, kicking to cut a two-score deficit to five is
  // a call a coach really makes. On the last possession of the game it is not
  // a call at all.
  const mustTouchdown = lastChance && margin < -POINTS.fieldGoal;
  let outcome = driveOutcome(mult, rand, mustScore, mustTouchdown);

  // Ball Hawks and Blitz Brigade turn stops into takeaways; Ground & Pound's
  // ball control resists them. Applied as a re-roll of a stop rather than as
  // free points, so a takeaway style wins the ball rather than the game.
  if (outcome === "punt") {
    const steal = (theirs.takeaway - 1) * 0.5 + (1 - mine.security) * 0.5;
    if (steal > 0 && rand() < steal) outcome = "turnover";
  }
  // Explosive styles convert their scoring drives into touchdowns rather than
  // field goals - the difference between Vertical Attack and West Coast.
  // Finishing a drive is a CONTEST, not a property of the offence. How hard you
  // go for the touchdown is your explosiveness and your red-zone intent
  // together; how well they hold you to three is theirs. A defence that keeps
  // everything in front of it really does turn touchdowns into field goals.
  const finish = (mine.explosive * mine.redZone) / (theirs.explosivePrevention || 1);
  if (outcome === "fieldGoal" && finish > 1 && rand() < (finish - 1)) {
    outcome = "touchdown";
  } else if (outcome === "touchdown" && finish < 1 && rand() < (1 - finish) * 0.6) {
    // ...but a defence cannot hold a team to three when three is not on offer:
    // an offence that must have seven is going for it on fourth down, so a
    // stop here is a stop on downs. Without this the mustTouchdown rule above
    // could still be undone one branch later.
    outcome = mustTouchdown ? "downs" : "fieldGoal";
  }
  let endYard = Math.max(1, Math.min(100, startYard + driveYards(outcome, startYard, mult, rand)));

  // NOBODY PUNTS FROM FIELD-GOAL RANGE.
  //
  // The outcome is drawn before the drive is placed on the field, so a drive
  // labelled "punt" could still be handed an end spot in the opponent's half -
  // and 11% of punts were, some from inside the 10. It read exactly as wrong as
  // it was: a team reaching the opponent's 20 and sending out the punt team.
  //
  // A fourth down inside FG_RANGE_YARD is a kick, so it becomes one here. The
  // branch below then attempts it with the DRAFTED kicker's accuracy, and a
  // miss already turns the ball over at the spot - which is the real cost of
  // trying, and the reason this is not just free points.
  //
  // Note this deliberately does NOT touch the "downs" outcome. That one is a
  // team choosing to go for it, which is a real decision a real team makes in
  // exactly this territory.
  // Rounded, because the drive record rounds before anyone sees it: an
  // unrounded 61.6 is out of range by this test and a punt from the 62 on the
  // screen, which is the same complaint in a smaller font.
  if (outcome === "punt" && Math.round(endYard) >= FG_RANGE_YARD) outcome = "fieldGoal";
  let points = 0;
  let scorer = null;
  let scorerSlot = null;
  let credit = null;
  let text = "";
  // Kept on the drive, not just spent on the text. The box score needs to know
  // whether a touchdown was run or caught, and reconstructing it from a string
  // would be parsing English to recover a fact we already had.
  let kind = null;
  // Interception or strip. Decided here and carried on the drive for the same
  // reason `kind` is: the box score needs the fact, and recovering it later
  // would mean guessing at something we already knew.
  let takeaway = null;
  // The play after the touchdown. Kept on the drive rather than only spent on
  // the points, so the box score, the feed and any future replay all read the
  // same decision instead of three of them inferring it from a total.
  let conversion = null;

  if (outcome === "touchdown") {
    // Rushing scores are rarer than receiving ones and go to backs and
    // quarterbacks, which is why the kind is drawn before the man.
    //
    // 0.38, not the 0.32 this shipped with. The TOTAL was never the problem -
    // the simulation produced 2.48 touchdowns a team a game against football's
    // 2.40 - but only 31% of them came on the ground where the real game is
    // about 40%. Every drafted back was quieter near the goal line than he had
    // been and every quarterback more prolific, and because the total looked
    // right nothing was measuring the half that was wrong.
    //
    // This constant is the DRAWN share, not the realised one - a roster with
    // nobody to carry it falls through to a receiving score below, so the two
    // never match exactly. 0.38 measures out at 41% on the ground.
    // scripts/verify-nfl-realism.mjs is what measures it; re-read that after
    // changing this rather than reasoning forward from the number here.
    kind = rand() < 0.38 ? "rush" : "rec";
    // If nobody on this roster can carry it, the play was not a run. The
    // fallback used to draw from the OTHER pool while leaving `kind` alone, so
    // an empty backfield produced a receiver - very often the tight end -
    // credited with a rushing touchdown he had no carry for. The kind of the
    // play and the man who made it have to agree, so the kind moves too.
    let who = pickScorer(roster, kind, rand);
    if (!who) {
      kind = kind === "rush" ? "rec" : "rush";
      who = pickScorer(roster, kind, rand);
    }
    points = POINTS.touchdown;
    conversion = runConversion(margin + POINTS.touchdown, quarter, rand);
    points += conversion.points;
    scorer = who ? who.entry.name : null;
    scorerSlot = who?.slot ?? null;
    text = (scorer
      ? `${scorer} ${kind === "rush" ? "rushing" : "receiving"} touchdown`
      : "Touchdown") + describeConversion(conversion);
  } else if (outcome === "fieldGoal") {
    const kicker = kickingEntry(roster);
    if (fieldGoalGood(kicker, endYard, rand, mine.fg)) {
      points = POINTS.fieldGoal;
      scorer = kicker?.members?.[0]?.name || label(kicker) || teamName(roster);
      scorerSlot = kickerSlot(roster);
      text = `Field goal by ${scorer}`;
    } else {
      // A miss is still a drive that got into range, and it still hands the
      // ball over at the spot - which is why the arrow should show it.
      outcome = "downs";
      text = `Field goal missed by ${kicker?.members?.[0]?.name || label(kicker) || teamName(roster)}`;
    }
  } else if (outcome === "turnover") {
    const stop = pickStopper(oppRoster, rand);
    credit = stop?.slot ?? null;
    // Which kind, from the unit's REAL rates. A secondary that intercepted a
    // lot picks the ball off; a front seven that forced fumbles strips it. So
    // drafting the 2013 Seahawks gets you interceptions specifically, which is
    // what that pick was for.
    const ints = Number(stop?.entry?.ints) || 0;
    const ff = Number(stop?.entry?.ff) || 0;
    takeaway = ints + ff <= 0 ? "int" : rand() < ints / (ints + ff) ? "int" : "fumble";
    const man = stop ? pickTakeawayMan(stop.entry, takeaway, rand) : null;
    scorer = man;
    text = !stop
      ? "Turnover"
      : man
        ? `${man} ${takeaway === "int" ? "interception" : "forces a fumble"}`
        : `${takeaway === "int" ? "Intercepted" : "Fumble forced"} by ${label(stop.entry) || "the defense"}`;
  } else {
    text = "Punt";
  }

  const from = Math.round(startYard);
  const to = Math.round(endYard);
  const plays = buildPlays(from, to, outcome, kind, scorerSlot, roster, rand, {
    runShare: mine.runShare,
    sackRate: (theirs.passRush || 1) / (mine.protection || 1),
    // The man actually throwing it. 0..1 from his OWN per-game production -
    // nothing invented, just the rating the rest of the engine already trusts.
    qbRating: roster.QB ? rateEntry(roster.QB, ctx) : 0.5,
  });
  // Credited AFTER the snaps exist, next to where a takeaway is credited,
  // rather than inside buildPlays - that function reconstructs one offence's
  // downs and has no business knowing who lined up across from it.
  for (const play of plays) {
    if (play.type === "sack") play.sackBy = pickSacker(oppRoster, rand)?.slot ?? null;
  }
  return {
    // How you attack and how they rush the passer both change the SNAPS, not
    // just the drive's outcome: a ground plan hands it off more, and a blitz
    // against a thin line puts the quarterback on the floor.
    drive: { team: side, quarter, startYard: from, endYard: to,
             outcome, points, scorer, scorerSlot, credit, kind, takeaway, conversion, text,
             plays },
    nextStart: nextStart(outcome, endYard),
  };
}

/**
 * Who touches the ball, and how often, from each man's REAL per-game
 * production. Computed once per drive rather than per play - it depends only
 * on the roster, and rebuilding it 6 times a drive would be 130 rebuilds a
 * game for an identical answer.
 */
function usageWeights(roster) {
  const skill = Object.entries(roster || {})
    .filter(([, e]) => e && !isUnit(e))
    .map(([slot, entry]) => ({ slot, entry }));
  const build = (list, weightOf) => {
    const items = list.map(({ slot, entry }) => ({ slot, weight: Math.max(0, weightOf(slot, entry) || 0) }));
    const total = items.reduce((s, i) => s + i.weight, 0);
    // A roster with no production in this column (a data gap) shares evenly
    // rather than dropping the touches on the floor.
    if (total <= 0) return items.map((i) => ({ ...i, weight: 1 / (items.length || 1) }));
    return items.map((i) => ({ ...i, weight: i.weight / total }));
  };
  return {
    catchers: build(skill.filter(({ slot }) => slot !== "QB"), (slot, entry) => Number(entry.rec) || 0),
    rushers: capBellCow(
      build(skill, (slot, entry) => carriesPerGame(entry) * (CARRY_SHARE[slot.replace(/\d+$/, "")] ?? 0)),
      roster
    ),
  };
}

/**
 * How many times a man really was handed the ball, per game: his rushing yards
 * divided by his yards per carry. Both are in the dataset, so this is measured,
 * not modelled.
 *
 * IT REPLACES RUSHING YARDS AS THE CARRY WEIGHT, and the difference is the
 * whole point. Yards say Ben Roethlisberger (6 a game at 2.6 a carry - two
 * carries) and Lamar Jackson (80 a game at 6.9 - twelve) are 13x apart; carries
 * say they are 6x apart, which is the number that decides how often the ball is
 * in each man's hands. Weighting by yards and then handing every carry the same
 * average gain is what put 52 rushing yards on eight carries next to Big Ben's
 * name in a live game - a stat line he never produced in his life.
 *
 * A player with yards but no rate falls back to the league's 4.3, rather than
 * to zero: a data gap should not delete a man from the running game.
 */
function carriesPerGame(entry) {
  const yards = Math.max(0, Number(entry?.rush_yds) || 0);
  if (yards <= 0) return 0;
  const ypc = Number(entry?.ypc) || 0;
  return ypc > 0 ? yards / ypc : yards / LEAGUE_YARDS_PER_CARRY;
}

const LEAGUE_YARDS_PER_CARRY = 4.3;

/** What one man's carry is worth against an average one, from his own yards
 * per carry. Banded because a drive's total is fixed before the carriers are
 * drawn - this decides how the drive's ground yardage is SHARED OUT, and a
 * scale wide enough to hand one man everything would leave the rest of a
 * backfield with carries worth nothing. */
const CARRIER_YARD_SCALE_MIN = 0.45;
const CARRIER_YARD_SCALE_MAX = 1.7;

/**
 * Carries a starting back gets in a real season, per game. The divisor for
 * deciding how much of a man's own rate to believe.
 *
 * THIS GAME HAS ONE RUNNING BACK SLOT AND NO BACKUPS, so whoever is drafted
 * absorbs the whole backfield - about 22 carries. That is right, and it is also
 * why a rate measured on far fewer carries cannot be used as-is: Mike James
 * 2013 carried 8.6 times a game, which is a backup's workload, and handing him
 * 22 carries at his small-sample 4.92 produced 105 yards a game against the
 * 42 he really averaged. He was not a bell-cow and should not run like one.
 *
 * So his rate regresses toward the league's in proportion to how far short of a
 * starter's load he really carried. A proven every-down back is believed
 * outright; a backup is believed halfway and treated as ordinary for the rest.
 * Nobody is forced DOWN - a regressed back moves toward 4.3 from whichever side
 * he began on, which is the honest thing to do with a thin sample.
 */
const STARTER_CARRIES_PER_GAME = 16;

function carrierWorkloadTrust(entry) {
  const perGame = Number(entry?.car_pg);
  // Rows built before car_pg existed carry no role information. Unknown must
  // mean full trust, not "backup", or every pre-refresh dataset silently
  // flattens its runners.
  if (!Number.isFinite(perGame) || perGame <= 0) return 1;
  return Math.max(0, Math.min(1, perGame / STARTER_CARRIES_PER_GAME));
}

function carrierYardScale(entry) {
  const ypc = Number(entry?.ypc) || 0;
  if (ypc <= 0) return 1;
  const trust = carrierWorkloadTrust(entry);
  const believed = LEAGUE_YARDS_PER_CARRY + (ypc - LEAGUE_YARDS_PER_CARRY) * trust;
  return Math.max(
    CARRIER_YARD_SCALE_MIN,
    Math.min(CARRIER_YARD_SCALE_MAX, believed / LEAGUE_YARDS_PER_CARRY)
  );
}

/**
 * How far a gameplan is allowed to move a VOLUME number - how often you hand
 * it off, and so how often you throw it.
 *
 * A plan is an intent, not a different sport. Vertical Attack applied at full
 * strength put 63 attempts on a quarterback in a live game and Ground Control
 * put 39 carries on a back, both of which are among the most extreme games
 * anyone has ever played, from an ordinary Sunday's plan. The square root keeps
 * the direction and the ORDER of the plans exactly as authored while pulling
 * their reach in: a 1.50 ground tilt becomes 1.22, a 0.55 passing tilt becomes
 * 0.74. Choosing a plan should be worth a handful of snaps a game, not a
 * different offence.
 *
 * The efficiency mods (off, explosive, redZone, security, protection) are NOT
 * damped - those are what a plan is actually for, and they are already solved
 * against a win-rate band in scripts/verify-nfl-gameplans.mjs.
 */
function planTilt(mod) {
  const value = Number(mod);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.sqrt(value);
}

/** The most of a team's carries one man can take.
 *
 * NO BACK CARRIES EVERY SNAP. A roster drafts one running back, and weighting
 * carries by rushing production alone handed him essentially all of them - the
 * receivers have no rushing yards to speak of and most quarterbacks little, so
 * he came out at 95% and drew 27 carries a game. Real bell-cows top out near
 * three quarters: the rest goes to a second back, quarterback scrambles and
 * sneaks, and the occasional jet sweep.
 *
 * There is no second back on this roster to give them to, so the other skill
 * slots stand in for the whole of that work. That is the honest reading of a
 * twelve-slot roster - the drafted back is the backfield, but he is not the
 * entire running game. */
const BELL_COW_CEILING = 0.74;

/**
 * A REAL TEAM'S RUSHING ATTEMPTS IN A GAME, and the denominator that turns a
 * man's own carry count into the share of a backfield he really was.
 *
 * Modern NFL teams run the ball about 26-27 times a game. It is a fact about
 * football rather than a lever, and nothing should tune it.
 */
const TEAM_CARRIES_PER_GAME = 27;

/**
 * The least of a team's carries the drafted back can be cut to.
 *
 * THIS ROSTER HAS ONE RUNNING BACK SLOT, so whoever is drafted stands in for a
 * whole backfield and cannot be held to the share he had when he was splitting
 * one. Half is the floor: a committee back promoted to being somebody's only
 * back would carry more than he ever did, which is true, and he still does.
 */
const COMMITTEE_CARRY_CEILING = 0.50;

/**
 * THE CEILING IS PERSONAL, AND IT USED NOT TO BE.
 *
 * BELL_COW_CEILING was applied flat to every back, so the ceiling was the only
 * thing deciding the carry count and every back got the same one. Measured over
 * 1,200 games, bucketed by what each man really carried:
 *
 *   committee  (<12 real carries a game)   21.4 simulated against 11.4   1.88x
 *   starter    (12-18)                     20.6 against 15.6            1.32x
 *   workhorse  (18+)                       20.7 against 20.3            1.02x
 *
 * A workhorse was right and everyone else was handed his workload. That is not
 * only unrealistic, it flattens a draft decision: knowing which backs were
 * bell cows is exactly the kind of thing this game is meant to reward, and
 * there was no cost at all to drafting a man who split carries his whole
 * career.
 *
 * So a man's ceiling is the share of a real backfield HE really was - his own
 * carries against a real team's - bounded at both ends. The bounds are what
 * keep it honest about this roster's shape rather than about his old team's:
 * never below COMMITTEE_CARRY_CEILING, because he is the only back here, and
 * never above BELL_COW_CEILING, because nobody carries every snap.
 *
 * Nothing here invents a number. carriesPerGame is measured from the dataset's
 * own rushing yards and yards per carry.
 */
function backfieldShare(entry) {
  return carriesPerGame(entry) / TEAM_CARRIES_PER_GAME;
}

function bellCowCeilingFor(entry) {
  const share = backfieldShare(entry);
  if (!(share > 0)) return COMMITTEE_CARRY_CEILING;
  return Math.min(BELL_COW_CEILING, Math.max(COMMITTEE_CARRY_CEILING, share));
}

/** The most of a team's carries a QUARTERBACK can take, however the rest of
 * the backfield is capped.
 *
 * This is the Roethlisberger rule. The spare carries taken off a bell cow used
 * to be shared out in proportion to what each other man already had, and on a
 * roster whose only other rusher of note is the quarterback, "in proportion"
 * meant essentially all of them: a statue of a passer inherited eleven carries
 * a game and ran for 58 yards. A quarterback's own record is the only thing
 * that should decide how often he runs, so the redistribution can never lift
 * him above the share his real carries already justify - a scramble or two for
 * Big Ben, a third of the ground game for Lamar Jackson.
 *
 * The small floor is the sneak-and-kneel share every quarterback has. */
const QB_CARRY_FLOOR = 0.04;

/** The same floor for everyone else: the jet-sweep and end-around share a
 * receiving corps has whatever its members' own records say. Real teams give
 * ALL their receivers and tight ends about 2% of their carries between them,
 * so a single slot's floor is a fraction of that - enough that the sweep
 * exists, far too little to be a running game. */
const SKILL_CARRY_FLOOR = 0.01;

function capBellCow(items, roster) {
  if (items.length < 2) return items;
  let top = items[0];
  for (const item of items) if (item.weight > top.weight) top = item;
  // The ceiling belongs to the MAN, not to the slot - see bellCowCeilingFor.
  const ceiling = bellCowCeilingFor(roster?.[top.slot]);
  if (top.weight <= ceiling) return items;

  const spare = top.weight - ceiling;
  // THE ROETHLISBERGER RULE IS FOR EVERYONE, and it used to be for the
  // quarterback alone. Every other slot was handed a ceiling of 1 - no limit
  // at all - so the carries taken off the bell cow went almost entirely to the
  // receivers, who between them offered four times the room the quarterback
  // did and had no record justifying any of it.
  //
  // Measured over 500 games before this line changed:
  //
  //   RB 64.1% of team carries   (real NFL RB1 alone is about 70%)
  //   WR 19.3%                   (real NFL: about 2%)
  //   TE  6.2%                   (real NFL: about 0.3%)
  //   QB 10.5%                   (real NFL: about 12%)
  //
  // A receiver was carrying it 5.4 times a game and as many as 17, when a real
  // team hands off to ALL of its receivers about once. The reported line - a
  // WR3 with five carries and a WR2 with six, on a roster with Derrick Henry
  // in the backfield - is exactly what a 19% share looks like from a chair.
  //
  // The argument the quarterback's floor already makes is not about
  // quarterbacks: a man's own record is the only thing that should decide how
  // often he runs. A receiver who never took an end-around does not start
  // taking them because the back beside him is capped.
  const ceilingFor = (item) =>
    item.slot === "QB"
      ? Math.max(QB_CARRY_FLOOR, item.weight)
      : Math.max(SKILL_CARRY_FLOOR, item.weight);
  const rest = items.filter((item) => item !== top);
  // Only men whose own record says they carry the ball can absorb the spare,
  // and none of them past his own ceiling. What nobody can take stays with the
  // back: he really is the whole backfield on a twelve-slot roster, and
  // inventing carries for a quarterback who never ran is the worse error.
  const room = rest.map((item) => Math.max(0, ceilingFor(item) - item.weight));
  const roomTotal = room.reduce((sum, r) => sum + r, 0);
  const absorbed = Math.min(spare, roomTotal);

  return items.map((item) => {
    if (item === top) return { ...item, weight: top.weight - absorbed };
    const i = rest.indexOf(item);
    const share = roomTotal > 0 ? room[i] / roomTotal : 0;
    return { ...item, weight: item.weight + absorbed * share };
  });
}

/** Who the ball is handed to on an ordinary carry, as a multiplier on that
 * man's own carries per game.
 *
 * Much closer to 1 than it used to be, because the weight it multiplies is now
 * a measured carry count rather than a yardage total - the data already knows
 * that a quarterback runs less often than a back, so the gate no longer has to
 * say it a second time. What is left is the ROSTER correction: a real team
 * spreads its carries over two or three backs and this roster has one, so
 * everyone else is scaled down toward him rather than splitting a real team's
 * whole non-RB share between a quarterback and three receivers. */
const CARRY_SHARE = { RB: 1, QB: 0.6, FLEX: 0.9, WR: 0.5, TE: 0.15 };

/** One weighted draw. Returns a SLOT. */
function pickBySlotWeight(items, rand) {
  if (!items || !items.length) return null;
  let roll = rand();
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item.slot;
  }
  return items[items.length - 1].slot;
}

/** Seconds a play takes off the clock, by what kind of play it was. An
 * incompletion stops it; a run does not. Solved against the only constraint
 * that matters here: both teams' possession has to add up to about sixty
 * minutes, because that is how long a football game is. */
const PLAY_SECONDS = { run: 38, shortPass: 32, deepPass: 30, incompletion: 6, sack: 36 };

/** How much of a drive is snaps that gained nothing - incompletions and
 * sacks. Carved out of the play count rather than added to it, so the count
 * stays at football's ~64 a side.
 *
 * THIS IS A BAND NOW, NOT A NUMBER. It was a single constant, which meant
 * every quarterback who ever played completed the same share of his throws:
 * measured across the whole dataset, a bottom-tier passer completed 62.2% and
 * an elite one 62.1%. Player quality reached the drive model and stopped
 * there, so the box score was always reconstructed at league-average
 * efficiency however good the man throwing was.
 *
 * The band is real football's: a poor starter completes about 57%, an elite
 * one about 70%.
 *
 * IT IS THE BAND THAT IS FOOTBALL'S, NOT EITHER END ON ITS OWN, and the elite
 * end used to miss. Measured over bot-drafted ranked rosters across all five
 * offensive and all five defensive plans, 0.20 put an elite passer on 65.1% -
 * eight and a half points above a poor one rather than football's thirteen.
 * The poor end was already right at 56.6%, so the whole shortfall was at the
 * top: the pick that most decides a football game read almost the same in the
 * box score whether you spent it on Peyton Manning or on a rookie. 0.14 puts
 * the two ends on 57.1% and 70.0%.
 *
 * THIS COSTS NOTHING ELSEWHERE, which is why it can be changed without
 * re-running the calibrators. Dead plays are carved out of a play count that
 * is already fixed, and the yards a drive gains are decided before any of them
 * are dealt, so this moves only HOW a drive's yardage was gained - more
 * completions of fewer yards each. Measured across the same 6,000 sides either
 * side of the change: 397 yards a team at 6.38 a play for 24.4 points before,
 * and 397 at 6.38 for 24.4 after. Only yards per completion moves, 13.2 to
 * 12.7, toward real football's 11.5.
 *
 * WHY IT WAS LOOKED AT. A live 9-6 game was reported, in which the winning
 * quarterback completed 8 of 28. The final was not the fault: both sides had
 * drafted bottom-third passers, and that pair's expected game is 17-18 points
 * on about 270 yards a side, so 9-6 was its bad night rather than a bug. The
 * 28.6% was, and it is why verify-nfl-realism.mjs now holds a floor under the
 * LOW tail of a passing line as well as a ceiling over the high one. */
const DEAD_PLAY_SHARE_POOR = 0.40;
const DEAD_PLAY_SHARE_ELITE = 0.14;

/** ...and how many of those are sacks rather than incompletions. */
const SACK_SHARE_OF_DEAD = 0.13;

/** The snaps a drive spends before any ground is counted, by how it ended.
 *
 * A scoring drive buys its yards more cheaply than a failing one - it is
 * finding chunk plays, not grinding - so it pays LESS overhead per snap and
 * more of its count comes from the distance. A drive that stalls pays the
 * overhead and gets nothing for it, which is what a three-and-out is. */
const SNAPS_BASE = { touchdown: 1, fieldGoal: 2, punt: 3, downs: 3, turnover: 3 };

/** How much of a PRODUCTIVE drive is carried on the ground.
 *
 * Note the word productive: incompletions and sacks are carved out before this
 * applies, and every one of them is a pass. So this is not the run share of a
 * team's snaps, it is the run share of the snaps that did something - which
 * runs higher. Real football is 27 carries against 21 completions, or 56%,
 * while the same team's run share of ALL its plays is 43%. Reading this as the
 * latter is why the simulation handed the ball off 16 times a game.
 *
 * 0.56 IS THE 56% THIS COMMENT NAMES. It held 0.63 for a long time, which the
 * paragraph above never justified - it explains why the number is higher than
 * 43% and then does not explain why it is higher than 56% either. Measured
 * over 400 bot-drafted games it produced 30.3 carries against 27 pass attempts
 * a team, where football is 27 and 33: the ball was handed off about three
 * times a game too often and thrown six times too few, and a quarterback's
 * median line sat under the 28-attempt floor scripts/verify-nfl-realism.mjs
 * sets for it. At the value the comment already named, carries land on 27.0
 * and yards per carry on 4.20, against real football's 27 and 4.3. */
const RUN_SHARE = 0.56;

/** The extremes a GAMEPLAN may push that to.
 *
 * These are measured off real seasons rather than picked as guard rails: the
 * most pass-happy offences in the league run the ball on about 35% of their
 * snaps and the most committed ground teams on about 68%. A team outside that
 * pair of numbers is not running a plan, it is playing from four scores down -
 * which is a game state, not a gameplan, and this band is about gameplans. */
const RUN_SHARE_MIN = 0.45;
const RUN_SHARE_MAX = 0.77;
// BOTH ENDS ARE THE COMMENT'S OWN ANCHORS, CONVERTED. The band is quoted above
// in shares of ALL snaps - 35% for the most pass-happy offences, 68% for the
// most committed ground ones - while the constant is a share of PRODUCTIVE
// snaps, and the two are not the same number. Converting at football's
// completion rate: 0.35 / (0.35 + 0.65 x 0.62) = 0.46, and 0.68 / (0.68 + 0.32
// x 0.62) = 0.77. The floor already matched; the ceiling did not.
//
// It read 0.66, which was consistent with a RUN_SHARE of 0.63 and stopped
// being consistent when that moved to the 0.56 its own comment named. The
// visible cost was that Ground Control stopped being a running plan: measured
// on a roster built for it, 18 carries against balanced's 15, where the whole
// identity of the plan is that it hands the ball off. At 0.77 it is 21 against
// 15.
//
// An older note here warned that 0.70 let the ground plan hand off on seven
// snaps in ten. That was measured against the 0.63 base, where 0.70 was a
// ceiling barely above the middle and every plan piled into it; against 0.56
// there is room for the tilt to be damped by roster fit before it ever reaches
// the edge, which is the mechanism that note wanted and did not have.

/** What a carry is worth against a COMPLETION, as a multiplier on the yardage
 * it draws. Not against an attempt: the incompletions are already carved out,
 * so the throws this competes with are the ones that were caught. Real football
 * is about 4.3 a carry against 11 a completion.
 *
 * 0.17, and this is what decides WHERE the extra offence goes.
 *
 * Runs and passes draw their gains from one normalised pool, so without this
 * weight yards per carry simply tracks yards per play - and lifting the game to
 * 5.8 a play took carries to 5.63, past the 5.0 ceiling that keeps a ground
 * game recognisable. Cutting the weight sends the increase through the air
 * instead, with the passing game absorbing nearly all of the extra yards.
 *
 * That is the right shape for the target as well as the safe one. A
 * high-scoring, explosive game is a PASSING game - chunk plays down the field,
 * not a back averaging six a carry, which no era of football has looked like.
 * The cost is paid by the drafted back's median line: 74 yards against a real
 * 80, where an unweighted pool would give him 86.
 *
 * WHY 0.17 RATHER THAN THE 0.20 THIS REPLACES. The offence weights above were
 * rebalanced (OL 0.18 -> 0.10), which lifted total yardage and carried yards
 * per carry from 4.90 to 5.18 - outside the band. Re-solving this weight is the
 * documented response to exactly that symptom, and it is the honest one, so it
 * was re-solved rather than the weights being walked back.
 *
 * Measuring it also showed the 5.0 ceiling had been held by luck. The realism
 * harness rates every drive on ONE fixture whose offensive line rates 0.155,
 * near the floor (scripts/verify-nfl-realism.mjs, rosterWith), and the old 0.18
 * OL weight leaned on that bad line to drag the whole sample down into the
 * band. Swap in a league-average line and the OLD weights produced 5.44 a
 * carry - already outside the band, and worse than the new ones' 5.39. The
 * check was passing for the wrong reason. It passes on its own merits now.
 *
 * This lever moves ONLY the run/pass split: yards per play held at 6.11 across
 * a 0.15-0.20 sweep, so nothing about total offence is being tuned here. */
const RUN_YARD_WEIGHT = 0.17;

/**
 * The plays inside one drive.
 *
 * STRICTLY DERIVED. The drive already knows where it started, where it ended
 * and how it finished; this reconstructs a sequence of downs that arrives at
 * exactly those numbers. It cannot change a score, a yard or an outcome - the
 * final play is pinned to endYard, and the gains before it are a partition of
 * the same distance.
 *
 * That constraint is the point. A play-by-play that could disagree with the
 * drive it belongs to would be a second source of truth, and a scoreboard and
 * a play feed that contradict each other is worse than having no feed at all.
 * What this adds is DETAIL, not information: down, distance, where the ball
 * sat, and what kind of play moved it - everything the field needs to draw a
 * line of scrimmage and a first-down marker, and none of it invented past
 * what the drive already committed to.
 */
function buildPlays(startYard, endYard, outcome, kind, scorerSlot, roster, rand, plan = {}) {
  const net = endYard - startYard;
  // Longer drives get more snaps, with a floor of one: a drive exists because
  // somebody ran a play.
  // SNAPS PER DRIVE, from how the drive ended as much as from how far it went.
  //
  // This was yardage alone - net/9, then /11, then /12 - and yardage alone
  // cannot get this right, because the relationship is not the same for a
  // drive that scored and a drive that did not. Real football: a touchdown
  // drive covers about 70 yards in 7.5 snaps (nearly ten a play), while a
  // punting drive covers about 12 in 4.3 (under three). One divisor has to
  // split the difference, and splitting it gave 52 snaps a game against
  // football's 63, each worth 8.4 yards against football's 5.4 - a game of
  // very few, very long plays, which is what put 9.8 yards on every carry.
  //
  // The base is the overhead every drive pays whatever it achieves: you do not
  // go three-and-out in one snap. The yardage term is what marching adds on
  // top. Weighted across the outcome chart these come to 5.4 snaps a drive,
  // which over eleven drives is football's 60.
  // The cap is on the WHOLE count, not just the base. Capping only the base
  // (which is at most 3) capped nothing, and the yardage term is unbounded, so
  // a 90-yard drive in a shootout ran seventeen snaps and a game could reach
  // 108 offensive plays. No offence runs that many; twelve snaps is already a
  // long, chain-moving drive.
  //
  // The divisor is 16, up from 13, and it is the counterweight to driveYards'
  // higher `reach`. Snaps come from yardage, so lifting yards to the 350-a-game
  // design target dragged the snap count to 64.5 and the game clock past 60
  // minutes with it. Sixteen holds the game at 60.4 plays over 56.3 minutes
  // while the yards go up - which is the whole point: MORE YARDS PER SNAP, not
  // more snaps. A drive that gains more without taking longer is an explosive
  // offence; one that gains more by running more plays is just a longer game.
  const count = Math.min(
    12,
    Math.max(1, (SNAPS_BASE[outcome] ?? 3) + Math.round(Math.abs(net) / 16) + Math.floor(rand() * 3))
  );
  const plays = [];

  // Gains are drawn, then normalised so they sum to exactly `net`. Drawing
  // first and scaling after keeps the SHAPE of a drive - a chunk play among
  // short ones - which a flat division would iron out.
  // DEAD PLAYS. A drive is not only the snaps that gained something: without
  // incompletions and sacks the quarterback completed every pass he threw and
  // was never once brought down, which is not football, and it left the clock
  // running 78 minutes because every play took a run's worth of it.
  //
  // They are carved OUT of the play count rather than added to it - the total
  // was already right at about 64 a side - and a sack's lost yardage is added
  // back into the pool the productive plays share, so the drive still lands
  // exactly where the simulation said.
  // A good quarterback wastes fewer downs. Clamped to the band above so no
  // plan and no rating can produce a passer who never misses or never hits.
  const qbRating = Math.max(0, Math.min(1, Number(plan.qbRating) ?? 0.5));
  const deadShare = DEAD_PLAY_SHARE_POOR - (DEAD_PLAY_SHARE_POOR - DEAD_PLAY_SHARE_ELITE) * qbRating;
  const dead = Math.min(count - 1, Math.round(count * deadShare));
  const productive = Math.max(1, count - dead);
  // Rounded PROBABILISTICALLY, not to nearest. A drive has about two dead
  // plays, so round-to-nearest turned 0.4 sacks into 0 every single time and
  // the whole league finished the season with none.
  // Pressure against protection. Clamped because a plan should tilt a rate,
  // never invent a game where every dead play is a sack.
  const sackRate = Math.max(0.25, Math.min(3, Number(plan.sackRate) || 1));
  const sackFloat = Math.min(dead, dead * SACK_SHARE_OF_DEAD * sackRate);
  const sacks = Math.floor(sackFloat) + (rand() < sackFloat % 1 ? 1 : 0);
  let sackLoss = 0;
  const deadPlays = [];
  for (let i = 0; i < dead; i++) {
    const isSack = i < sacks;
    const loss = isSack ? -(3 + Math.floor(rand() * 7)) : 0;
    sackLoss += loss;
    deadPlays.push({ type: isSack ? "sack" : "incompletion", gain: loss });
  }

  // Type is decided BEFORE the yardage, and then weights it. Assigning gains
  // first and labelling them afterwards made a carry worth exactly as much as
  // a throw, so matching football's yardage split (about 66:34) forced the
  // play split to 71% passes - a league that threw it on nearly every down.
  // A run gains less than a pass, which is why both can be right at once.
  // A ground plan really does hand it off more. Held inside a believable band
  // so no plan produces a team that never throws or never runs.
  //
  // THE BAND IS REAL FOOTBALL'S, NOT A GUARD RAIL. It was 0.12 to 0.82, which
  // is wide enough not to be a limit at all: Vertical Attack at full fit lands
  // on 0.26 before clamping, so a well-built deep-passing roster ran the ball
  // on one snap in eight and its quarterback threw 61 times. No NFL team has
  // ever played a season anywhere near that, and the games that get close are
  // the ones spent two scores behind. The narrowed band still leaves Ground
  // Control and Vertical Attack at opposite ends of the league - about 70% runs
  // against about 70% throws - which is the whole point of the choice.
  const runShare = Math.max(
    RUN_SHARE_MIN,
    Math.min(RUN_SHARE_MAX, RUN_SHARE * planTilt(plan.runShare))
  );
  const usage = usageWeights(roster);
  // Relative to THIS backfield's own average, so weighting a carry by the man
  // taking it decides how the ground yards are shared out without changing how
  // many there are. An absolute scale would quietly hand a team with a 5.8-a-
  // carry back extra offence and take it off his quarterback's passing line.
  const meanCarrierScale = usage.rushers.reduce(
    (sum, r) => sum + r.weight * carrierYardScale(roster[r.slot]), 0
  ) || 1;
  const raw = [];
  const kinds = [];
  const carriers = [];
  for (let i = 0; i < productive; i++) {
    const isRun = rand() < runShare;
    kinds[i] = isRun ? "run" : "pass";
    // THE MAN IS CHOSEN BEFORE THE YARDS, so the yards can know who is running.
    // Every carry used to draw from the same pool whatever the carrier's own
    // rate, which is how a quarterback with a 2.6-yard average finished a game
    // at 6.5 a carry: he was handed a running back's gains. A carrier's own
    // yards per carry now weights the draw, so a plodder's carries are short
    // ones and a burner's are not.
    carriers[i] = isRun ? pickBySlotWeight(usage.rushers, rand) : null;
    const carrierBoost = isRun ? carrierYardScale(roster[carriers[i]]) / meanCarrierScale : 1;
    // meanCarrierScale goes back IN as an absolute, having been divided out of
    // carrierBoost above. The relative form alone decided only how a fixed pool
    // of ground yards was SHARED, so with one running back slot and no backups
    // it cancelled entirely: whoever was drafted got the same rushing total,
    // and a backup's regressed rate reached nothing. The comment this replaces
    // worried that an absolute scale would "hand a team with a 5.8-a-carry back
    // extra offence and take it off his quarterback's passing line". That is
    // not a bug, it is the run game mattering - and because every raw weight is
    // normalised against the same gainPool below, it moves the RUN/PASS SPLIT
    // of a drive rather than the drive's total. A weak back means fewer yards
    // on the ground and more through the air, which is what a team with no run
    // game actually does.
    raw[i] = (0.35 + rand() * 1.3) * (isRun ? RUN_YARD_WEIGHT * carrierBoost * meanCarrierScale : 1);
  }
  const rawTotal = raw.reduce((s, v) => s + v, 0);
  // The productive plays make up whatever the sacks gave away.
  let gainPool = net - sackLoss;

  // A DRIVE THAT LOST GROUND LOST IT ON A SACK, NOT ON A SERIES OF NEGATIVE
  // COMPLETIONS.
  //
  // `raw` is all positive, so a negative pool flips every productive play at
  // once and the drive is reported as a set of catches for minus yards. That
  // is not a thing football does. It showed up as receiving lines like -13 on
  // three catches, and on 9.3% of player lines once TALENT_PARITY was solved -
  // a suppressed offence reaches a negative net far more often than the old
  // hand-set value ever let it, so the artefact went from rare to routine
  // without anything about it changing.
  //
  // The loss belongs on the dead plays, which is where football puts it: the
  // sack, and the tackle behind the line that this model represents as one.
  // Deepening them keeps the drive's total exactly where the simulation put it
  // - the play ledger still reconciles to `net` - while the men who caught the
  // ball are credited with having caught it.
  //
  // The drive's total is untouched either way - the play ledger still sums to
  // `net` - which scripts/verify-nfl-box-score.mjs checks directly.
  if (gainPool < 0) {
    let absorbers = deadPlays.filter((p) => p.type === "sack");
    if (!absorbers.length) {
      // A drive that went backwards with no sack on it has nowhere to put the
      // loss, so sacks are ADDED rather than incompletions being converted into
      // them. Converting was the first version and it was wrong in a way worth
      // recording: an incompletion is a pass ATTEMPT and a sack is not, so
      // turning one into the other quietly deleted a miss from the
      // quarterback's line. The struggling passers this branch fires for are
      // exactly the ones whose misses matter, and their completion rate rose
      // from 45% to 64% - the tier separation that
      // scripts/verify-nfl-realism.mjs exists to protect, erased by a fix to
      // something else entirely.
      //
      // HOW MANY, not one. A single absorber meant a drive that lost twenty
      // yards reported a twenty-yard sack, which is longer than any in the
      // record books. Real football loses that much ground over two or three
      // plays, so the deficit is split at about nine yards each - the top of
      // the ordinary range - and capped at three, past which the drive is
      // already the worst anyone has seen and one more sack adds nothing but
      // snaps.
      const needed = Math.max(1, Math.min(3, Math.ceil(Math.abs(gainPool) / 9)));
      absorbers = Array.from({ length: needed }, () => {
        const added = { type: "sack", gain: 0 };
        deadPlays.push(added);
        return added;
      });
    }
    const share = gainPool / absorbers.length;
    for (const play of absorbers) {
      play.gain += share;
      sackLoss += share;
    }
    gainPool = 0;
  }

  let yard = startYard;
  let down = 1;
  let toGo = 10;
  let carried = 0;

  // Dead plays are shuffled in among the productive ones rather than bolted on
  // at the front, so a drive reads like a drive: an incompletion on second
  // down, not three of them before anybody touches the ball.
  const order = [];
  for (let i = 0; i < productive; i++) order.push({ productive: true, index: i });
  for (const d of deadPlays) order.push({ productive: false, dead: d });
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // The drive has to END on a play that moves it to endYard, so whichever
  // productive play sorted last is pulled to the back.
  const lastProductive = order.map((o, i) => (o.productive ? i : -1)).filter((i) => i >= 0).pop();
  if (lastProductive != null && lastProductive !== order.length - 1) {
    const [pulled] = order.splice(lastProductive, 1);
    order.push(pulled);
  }

  for (let i = 0; i < order.length; i++) {
    const slot = order[i];
    const last = i === order.length - 1;
    const gain = last
      ? endYard - yard
      : slot.productive
        ? Math.round((gainPool * raw[slot.index]) / rawTotal)
        : slot.dead.gain;
    carried += gain;

    // The play that scores has to BE the play the drive says it was. Left to
    // the ordinary draw, a drive recorded as a rushing touchdown could end on
    // a pass, and the scorer would be credited with a rushing score he had no
    // carry for - the box score contradicting the drive it came from.
    const scoringTd = last && outcome === "touchdown" && scorerSlot;

    let type;
    if (scoringTd) type = kind === "rush" ? "run" : gain >= 18 ? "deepPass" : "shortPass";
    else if (!slot.productive) type = slot.dead.type;
    else if (kinds[slot.index] === "run") type = "run";
    else if (gain >= 18) type = "deepPass";
    else type = "shortPass";

    const before = yard;
    yard = Math.max(1, Math.min(99, yard + gain));
    const gotFirst = gain >= toGo;

    // WHO DID IT. Every play names its participants, which is what makes the
    // box score a LEDGER rather than a share-out: each stat is written by the
    // play that produced it, so a total can never be something other than the
    // sum of the plays behind it.
    //
    // The play that ends a scoring drive is pinned to the man the drive
    // already named. Drawing a fresh one here would let the popup say one
    // name and the box score another.
    let carrier = null;
    let receiver = null;
    if (type === "run") {
      // Drawn with the yardage above, not here: the gain this play was given
      // was weighted by THIS man's yards per carry, so drawing a different one
      // now would hand his gain to somebody else.
      carrier = scoringTd && kind === "rush"
        ? scorerSlot
        : carriers[slot.index] ?? pickBySlotWeight(usage.rushers, rand);
    } else if (type === "sack") {
      carrier = "QB";
    } else if (type === "incompletion") {
      receiver = null;
    } else {
      receiver = scoringTd && kind === "rec" ? scorerSlot : pickBySlotWeight(usage.catchers, rand);
    }

    plays.push({
      type,
      down,
      distance: Math.max(1, Math.round(toGo)),
      startYard: Math.round(before),
      endYard: Math.round(last ? endYard : yard),
      gain: Math.round(gain),
      firstDown: gotFirst && !last,
      seconds: PLAY_SECONDS[type] || 35,
      // Slots, not names: the roster is what turns a slot into a person, and
      // storing the name here would duplicate it into a second place that can
      // fall out of step.
      carrier,
      receiver,
      // The terminal play carries the drive's own result, so playback has one
      // event to read the score off rather than inferring it from position.
      result: last ? outcome : null,
      kind: last ? kind : null,
      scorer: last ? scorerSlot : null,
    });

    if (gotFirst) {
      down = 1;
      toGo = 10;
    } else {
      down = Math.min(4, down + 1);
      toGo = Math.max(1, toGo - gain);
    }
  }
  return plays;
}

// COIN TOSS, WITH A CORRECTION ON THE RECORD.
//
// This was first added to fix an apparent 5-point bias: identical rosters came
// out 45.1% for side A, read as proof that driving first mattered. That reading
// was wrong. Splitting the outcomes properly gives A 47.4%, B 45.9% and 6.8%
// TIES - 50.8% among decided games, which is symmetric. The missing 10 points
// were draws nobody had counted, not an advantage.
//
// The toss stays because it is real football and a genuine choice: electing to
// kick hands over the first possession to take the ball out of halftime, which
// is what a coach with a strong defence actually does. The second-half reversal
// gives each side exactly one opening drive, so the structure is fair by
// construction rather than by measurement.
//
// OVERTIME breaks the 6.8% of games that ended tied. Both sides get a
// possession before it can end - the modern rule, and the right one here for a
// reason beyond realism: a sudden-death first score would make the overtime
// coin toss worth more than the entire draft, and this game is about the
// draft. Paired possessions repeat until somebody leads after both have had
// the ball.
// THE MAN OF THE MATCH.
//
// Football had no MVP at all. Basketball's engine returns one and every
// consumer assumes it: main.js reads `result.mvp.side` when the final whistle
// goes, and the Edge Function reads `result.mvp.player.name` before it writes
// a match result. For football both were reading `undefined`, which threw -
// and because the throw happened partway through the post-game routine, the
// Play Again and Home buttons never came back. A finished football game left
// the viewer on a dead screen.
//
// The weights below are the ordinary currency of football value - a passing
// yard is worth a quarter of a rushing one, a touchdown is worth six - and
// they are applied to the SAME box score the game prints, so the line beside
// the MVP's name is the line in the table. Nothing here invents a statistic:
// every input is a number some play already wrote.
//
// FOOTBALL-SPECIFIC REASONING, WHICH THIS DID NOT HAVE. The weights below are
// the ordinary currency of a normal football game, and they were applied flat
// to every game - which is why a 9-6 final named a running back with 32 yards.
// Two faults, both visible in the measurements in tools/tmp and both fixed
// below: a pass rush was worth literally nothing, and a kicker who scored all
// of his team's points could not win a game his kicking decided.
const MVP_WEIGHTS = {
  pass_yds: 0.04, pass_tds: 4,
  rush_yds: 0.1, rush_tds: 6,
  rec_yds: 0.1, rec_tds: 6, rec: 0.5,
  fgs: 3,
  // A takeaway swings a possession, which is worth about what a score is.
  ints: 6, fumbles: 5,
  // A SACK USED TO BE WORTH ZERO. `sacked` is the quarterback's charge for
  // taking one; nothing credited the unit that got there. Measured over 400
  // games a drafted pass rush reaches six in a game and sits at one or more in
  // 28% of them, so the most visible thing a defensive line does was absent
  // from the only ranking that names a defender. Half a takeaway is the usual
  // ratio - a sack kills a down and the yardage behind it, a turnover kills
  // the possession - and half of `ints` is what that comes to here.
  sacks: 3,
  sacked: -0.5,
};

/**
 * What a point was worth in THIS game, as a multiplier on scoring and
 * takeaways.
 *
 * THE COMPLAINT THIS ANSWERS. A live 9-6 game named a running back with 32
 * yards, in a game whose every point came off a kicker's foot. The flat
 * weights above cannot get that right, because they price a yard the same in a
 * game where nobody could move the ball as in a 41-point one - and a game has
 * far more yards in it than points, so yardage always wins.
 *
 * The correction is the one a fan makes without thinking: WHEN NOBODY COULD
 * SCORE, SCORING IS THE STORY, and yards that never became points were not.
 * So scoring plays, field goals and takeaways are valued against how scarce a
 * point actually was, while yardage keeps the flat weight it already had.
 * Boosting one is the same as discounting the other, and this way round a
 * normal game is left exactly as it was.
 *
 * DELIBERATELY INERT IN A NORMAL GAME. At the reference and above the
 * multiplier is 1, so nothing about a 24-21 or a 41-14 changes - only games
 * the flat weights were already getting wrong move at all.
 */
const MVP_REFERENCE_POINTS = 22;
/** Below this the multiplier stops climbing: a shutout would divide by zero,
 * and a game won 3-0 is not thirty times more about its kicker than a normal
 * one is about its quarterback. */
const MVP_SCARCITY_FLOOR_POINTS = 6;
const MVP_SCARCITY_CAP = 3;

function pointScarcity(scoreA, scoreB) {
  const best = Math.max(Number(scoreA) || 0, Number(scoreB) || 0);
  const points = Math.max(best, MVP_SCARCITY_FLOOR_POINTS);
  return Math.min(MVP_SCARCITY_CAP, Math.max(1, MVP_REFERENCE_POINTS / points));
}

/** Which weights the scarcity multiplier reaches. Scores, kicks and takeaways
 * - the things that put points on a board or took a possession away - and not
 * yardage, receptions or the sack charge. */
const MVP_SCARCE_KEYS = new Set(["pass_tds", "rush_tds", "rec_tds", "fgs", "ints", "fumbles"]);

/** A man on the losing side does not take this off someone this close to him
 * on the winning side. Not a thumb on the scale for winners generally - a
 * losing player far clear of everyone still wins it, which is how a 400-yard
 * game in a loss should read. */
const MVP_NEAR_TIE_SHARE = 0.12;

function mvpScore(line, scarcity = 1) {
  let total = 0;
  for (const key of Object.keys(MVP_WEIGHTS)) {
    const weight = MVP_WEIGHTS[key] * (MVP_SCARCE_KEYS.has(key) ? scarcity : 1);
    total += (Number(line[key]) || 0) * weight;
  }
  return total;
}

/** One man's own yardage - passing plus rushing plus receiving. The first
 * tie-break, and the same quantity the box score leads its offensive table
 * with, so the MVP and the table rank a performance the same way. */
function totalYards(line) {
  return (Number(line.pass_yds) || 0) + (Number(line.rush_yds) || 0) + (Number(line.rec_yds) || 0);
}

function totalTouchdowns(line) {
  return (Number(line.pass_tds) || 0) + (Number(line.rush_tds) || 0) + (Number(line.rec_tds) || 0);
}

/** WHY this man, in football's own words. One short clause naming the thing he
 * actually did, so a kicker or a secondary winning it reads as a verdict
 * rather than a glitch - which is the whole complaint against a 32-yard back
 * taking a game decided by field goals.
 *
 * Built from the SAME line the box score prints, in the order a fan would say
 * it, and capped at two clauses because a third is a stat sheet. */
function mvpReason(line, scarce) {
  const n = (key) => Number(line[key]) || 0;
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const clauses = [];

  const tds = totalTouchdowns(line);
  const takeaways = n("ints") + n("fumbles");
  const yards = totalYards(line);

  if (n("fgs")) clauses.push(plural(n("fgs"), "field goal"));
  if (takeaways) {
    if (n("ints")) clauses.push(plural(n("ints"), "interception"));
    if (n("fumbles")) clauses.push(plural(n("fumbles"), "forced fumble"));
  }
  if (n("sacks")) clauses.push(plural(n("sacks"), "sack"));
  if (yards >= 1) clauses.push(`${Math.round(yards)} yards`);
  if (tds) clauses.push(plural(tds, "touchdown"));

  if (!clauses.length) return "the quietest game any of them had";
  const said = clauses.slice(0, 2).join(" and ");
  // The scarcity multiplier is the reason the choice looks unusual, so when it
  // was doing the work, say so. A normal game just gets the line.
  return scarce ? `${said} in a game that had nothing else in it` : said;
}

/**
 * The best individual line in the game, from either roster.
 *
 * TIE-BREAKS ARE EXPLICIT AND ORDERED, because "whichever object key came out
 * first" is not a rule anyone can predict or reproduce: value, then total
 * yards, then touchdowns, then the winning side, then slot order. Every step
 * is a fact about the game rather than about iteration order, so the same game
 * always names the same player - which is what makes the MVP checkable at all.
 *
 * SIDE "A" USED TO BREAK EXACT TIES, which is not a fact about the game at
 * all: on two identical lines the home slot won because of how the loop was
 * written, and in an online game "A" is whoever the server listed first. The
 * winner of the game breaks it now, and where neither side won, A still does -
 * a tie needs SOME deterministic answer and there is no better one.
 */
function pickMvp(rosterA, boxA, rosterB, boxB, scoreA = 0, scoreB = 0) {
  const scarcity = pointScarcity(scoreA, scoreB);
  const winner = scoreA === scoreB ? null : scoreA > scoreB ? "A" : "B";
  const candidates = [];
  for (const [roster, box, side] of [
    [rosterA, boxA, "A"],
    [rosterB, boxB, "B"],
  ]) {
    const slots = Object.keys(box);
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const player = roster[slot];
      // TEAM is a bookkeeping line for points no drafted player can be
      // credited with - it keeps the box score adding up to the scoreboard,
      // and it is nobody, so it cannot be the MVP.
      if (!player) continue;
      const line = box[slot];
      candidates.push({
        player, line, side, slot,
        score: mvpScore(line, scarcity),
        yards: totalYards(line),
        tds: totalTouchdowns(line),
        won: winner != null && side === winner,
        order: i,
      });
    }
  }
  if (!candidates.length) return null;
  const preferWinner = (a, b) => (a.won === b.won ? 0 : a.won ? -1 : 1);
  candidates.sort((a, b) =>
    b.score - a.score ||
    b.yards - a.yards ||
    b.tds - a.tds ||
    preferWinner(a, b) ||
    (a.side === b.side ? 0 : a.side === "A" ? -1 : 1) ||
    a.order - b.order
  );

  // THE NEAR-TIE RULE. Ranking alone let a man on the losing side take this
  // off someone a rounding error behind him on the winning one, which is the
  // one case where a fan would say the ranking is simply wrong. Within
  // MVP_NEAR_TIE_SHARE of the best score, the game's winner gets it.
  let best = candidates[0];
  if (winner && !best.won && best.score > 0) {
    const floor = best.score * (1 - MVP_NEAR_TIE_SHARE);
    const contender = candidates.find((c) => c.won && c.score >= floor);
    if (contender) best = contender;
  }

  // Issue #19: the MVP can now say why. `scarce` is what makes a kicker's
  // three field goals beat a hundred quiet yards, so it decides the phrasing.
  return { ...best, reason: mvpReason(best.line, scarcity > 1.35) };
}

export function simulate(rosterA, rosterB, stats, opts = {}) {
  const rand = opts.rand || Math.random;
  const ctx = stats;
  // Overridable only by the calibrators; a real game passes neither and gets
  // the shipped constants. See resolveTuning.
  const tuning = resolveTuning(opts);

  /**
   * The "this team ran hot this quarter" roll - ONE draw per team per quarter,
   * shared by every drive that team runs inside it.
   *
   * IT USED TO BE PER DRIVE, and that made the constant inert. The reasoning
   * is the same one at the top of tools/calibrate-variance.mjs: independent
   * noise AVERAGES OUT. A team runs about eleven drives a game, so eleven
   * independent draws from ±22% collapse to roughly ±7% at the team level and
   * the lever stopped mattering long before it reached the scoreboard.
   * Measured over 960 games per setting: widening the range from ±22% to ±54%
   * moved the mean final margin from 11.0 to 10.8 and the share of one-score
   * games from 49.7% to 49.5% - which is nothing, from a lever that more than
   * doubled. A constant nobody can move is not a balance knob, and it cannot
   * be calibrated either, which is most of why football's never was.
   *
   * A factor every drive in the quarter SHARES survives that averaging, which
   * is exactly what basketball does (see applyTeamRoll in the NBA engine) and
   * why its variance range is a real number rather than a placeholder. The
   * constant's name has always said `TEAM_QUARTER_VARIANCE`; this is the first
   * version where the code agrees with it.
   *
   * Drawn LAZILY, on the quarter's first drive, so the random stream is
   * consumed in the same order it always was - the first drive of each quarter
   * still draws here, and later drives simply reuse it.
   */
  const quarterRolls = new Map();
  const quarterRoll = (side, quarter) => {
    const key = `${side}:${quarter}`;
    let roll = quarterRolls.get(key);
    if (roll === undefined) {
      roll = tuning.varianceMin + rand() * (tuning.varianceMax - tuning.varianceMin);
      quarterRolls.set(key, roll);
    }
    return roll;
  };
  // Scaled by roster fit, so a style is worth what your lineup makes it worth.
  // Each side's bag is composed from BOTH of its plans - how it attacks and
  // how it defends - so the opponent's defensive choice is felt on every drive
  // you run, and yours on every drive they run.
  const modsA = composedModsFor(opts.strategyA ?? opts.tacticA, rosterA);
  const modsB = composedModsFor(opts.strategyB ?? opts.tacticB, rosterB);

  // Who won the toss and what they chose. Both default to random so an
  // automated or bot game still gets an unbiased one - a missing toss must
  // never silently hand the first possession to the same side every time,
  // which is the bug this exists to fix.
  const tossWinner = opts.tossWinner || (rand() < 0.5 ? "A" : "B");
  const elected = opts.elected || (rand() < 0.5 ? "receive" : "kick");
  const other = (side) => (side === "A" ? "B" : "A");
  // Electing to kick means the OTHER side receives the first half - and you
  // receive the second, which is the whole point of the choice.
  const firstHalfReceiver = elected === "receive" ? tossWinner : other(tossWinner);

  const offA = sideRating(rosterA, OFFENSE_WEIGHTS, opts.forfeitsA, ctx);
  const offB = sideRating(rosterB, OFFENSE_WEIGHTS, opts.forfeitsB, ctx);
  const defA = sideRating(rosterA, DEFENSE_WEIGHTS, opts.forfeitsA, ctx);
  const defB = sideRating(rosterB, DEFENSE_WEIGHTS, opts.forfeitsB, ctx);

  // What an average matchup of this roster shape rates at - see edge(), and
  // EDGE_BASELINE in constants.js for the measurement. Keyed on the shape
  // rather than on these two rosters: centring on the PAIR's own mean would
  // remove absolute roster quality from the model altogether, so a bad
  // quarterback would stop dragging his own numbers down and would only make
  // his opponent's better. Measured, that put a bottom-tier passer at 231
  // yards a game against 161 - which is the exact failure
  // scripts/verify-nfl-realism.mjs was written to catch.
  //
  // Quick Play is its own entry because one drafted DEF unit standing in for
  // four defensive slots rates quite differently from four of them: +0.11 for
  // ranked, -0.02 for Quick Play. That one number is why the same two rosters
  // used to play a 20% lower-scoring game in one mode than the other.
  //
  // Read from the SHAPE rather than from what happens to be filled - see
  // rosterShape. Asking `rosterA.DEF || rosterB.DEF` answered "is a DEF slot
  // occupied right now", which is a different question: two Quick Play sides
  // that both forfeited that pick would have been scored as ranked, a 0.21
  // swing in the multiplier and about 20% on the scoreboard, in the one game
  // state where nobody is left to notice.
  const baseline = EDGE_BASELINE[rosterShape(rosterA, rosterB, opts)];

  const drives = [];

  // Possessions alternate, so both sides get the same count - a game where one
  // team simply got more chances would be reporting luck as skill.
  // Pace is a real cost, not flavour: Ground & Pound shortening the game means
  // FEWER possessions for both sides, which is what ball control actually buys
  // and why it pairs with a lead rather than a deficit.
  const possessions = Math.max(6, Math.round(DRIVES_PER_TEAM * ((modsA.pace + modsB.pace) / 2)));

  const cfg = {
    A: { off: offA, def: defA, roster: rosterA, mods: modsA },
    B: { off: offB, def: defB, roster: rosterB, mods: modsB },
  };
  const start = { A: DRIVE_START_YARD, B: DRIVE_START_YARD };

  // A RUNNING SCORE. The engine used to derive the score only after every
  // drive had been played, which meant no drive could know whether its team
  // was ahead or behind - and a team that does not know it is losing punts
  // like a team that is winning.
  const live = { A: 0, B: 0 };

  for (let i = 0; i < possessions; i++) {
    const quarter = Math.min(4, Math.floor((i / possessions) * 4) + 1);
    // Second half flips who opens, so each side receives exactly one half.
    const receiver = quarter <= 2 ? firstHalfReceiver : other(firstHalfReceiver);
    // The last pair of possessions is when punting stops being free.
    const late = i >= possessions - 2;
    for (const side of [receiver, other(receiver)]) {
      const foe = other(side);
      const r = runDrive(ctx, side, cfg[side].off, cfg[foe].def, cfg[side].roster,
                         cfg[foe].roster, start[side], quarter, rand,
                         cfg[side].mods, cfg[foe].mods,
                         late && live[side] < live[foe],
                         live[side] - live[foe],
                         i === possessions - 1 && live[side] < live[foe], tuning,
                         quarterRoll(side, quarter), baseline);
      drives.push(r.drive);
      live[side] += r.drive.points;
      start[foe] = r.nextStart;
    }
  }

  // quarterBoxScores is DERIVED from drives, never tracked alongside it. Two
  // writers for one truth is how a scoreboard and a play-by-play disagree.
  // Shape matters as much as the numbers. Shared playback reads a period as
  // Object.values(q.a).reduce((s, line) => s + line.pts, 0) - a MAP OF SLOT
  // LINES, not a total. Returning a plain number made Object.values() iterate a
  // number, yield nothing, and reduce to 0: the football game simulated
  // correctly and displayed 0-0 in every quarter.
  const periodLines = (side, q) => {
    const lines = {};
    for (const d of drives) {
      if (d.team !== side || d.quarter !== q || !d.points) continue;
      const slot = d.scorerSlot || "TEAM";
      lines[slot] = lines[slot] || { pts: 0 };
      lines[slot].pts += d.points;
    }
    return lines;
  };
  const quarterBoxScores = [1, 2, 3, 4].map((q) => ({
    period: q,
    a: periodLines("A", q),
    b: periodLines("B", q),
  }));

  const periodTotal = (q, side) => Object.values(q[side]).reduce((s, l) => s + l.pts, 0);
  let teamScoreA = Math.round(quarterBoxScores.reduce((s, q) => s + periodTotal(q, "a"), 0));
  let teamScoreB = Math.round(quarterBoxScores.reduce((s, q) => s + periodTotal(q, "b"), 0));

  // Overtime: both sides get the ball, then the lead decides it. Capped so a
  // pathological pair of defences cannot spin forever - at the cap the game is
  // recorded as a genuine tie, which is what football does too.
  let overtimePeriods = 0;
  const OT_CAP = 6;
  while (teamScoreA === teamScoreB && overtimePeriods < OT_CAP) {
    overtimePeriods++;
    const quarter = 4 + overtimePeriods;
    // The team that kicked to open the second half receives in overtime, which
    // keeps the toss's cost and payoff intact rather than re-rolling it.
    const receiver = other(firstHalfReceiver);
    start.A = DRIVE_START_YARD;
    start.B = DRIVE_START_YARD;
    for (const side of [receiver, other(receiver)]) {
      const foe = other(side);
      // In overtime a trailing team has no next possession to punt for. This
      // is the case that was reported: down three, and the offence punted.
      const margin = side === "A" ? teamScoreA - teamScoreB : teamScoreB - teamScoreA;
      const trailing = margin < 0;
      const r = runDrive(ctx, side, cfg[side].off, cfg[foe].def, cfg[side].roster,
                         cfg[foe].roster, start[side], quarter, rand,
                         cfg[side].mods, cfg[foe].mods, trailing, margin, trailing, tuning,
                         quarterRoll(side, quarter), baseline);
      drives.push(r.drive);
      start[foe] = r.nextStart;
      if (side === "A") teamScoreA += r.drive.points;
      else teamScoreB += r.drive.points;
    }
    quarterBoxScores.push({ period: quarter, a: periodLines("A", quarter), b: periodLines("B", quarter) });
  }
  teamScoreA = Math.round(teamScoreA);
  teamScoreB = Math.round(teamScoreB);

  // The box score has to speak the sport's OWN lineKeys, because that is what
  // the profile builds records and career totals from. Emitting {td, pts} left
  // every football record - Passing Yards, Rushing TDs, Field Goals -
  // permanently unsettable, which looks like an empty profile rather than a
  // bug and would never have reported itself.
  /**
   * THE LEDGER.
   *
   * Every number below is written by a PLAY. Nothing is estimated after the
   * fact and nothing is shared out from a total, which is the property that
   * makes the reconciliations hold by construction rather than by luck:
   * team passing yards cannot differ from the sum of receiving yards, because
   * they are the same additions.
   *
   * This replaces two earlier generations. The first credited only the man who
   * finished a drive, so most of a game existed only in the score. The second
   * shared each drive's yardage out across the roster by season usage, which
   * spread the work correctly but still had no play behind any individual
   * number - "who caught it" was a distribution, not an event.
   */
  const boxFor = (side, roster, onlyQuarter = null) => {
    // The quarter filter is what makes the live table and the final table the
    // same table. Period lines used to be a second, much poorer ledger that
    // recorded points and nothing else, so a football box score filled in with
    // zeros all game and only agreed with itself at the final whistle. Running
    // ONE ledger over a subset of drives means summing the quarters cannot
    // disagree with the game - they are the same additions over the same plays.
    const mine = drives.filter(
      (d) => d.team === side && (onlyQuarter == null || d.quarter === onlyQuarter)
    );
    const box = {};
    const emptyLine = () => ({
      comp: 0, att: 0, pass_yds: 0, pass_tds: 0, rush_yds: 0, rush_tds: 0,
      carries: 0, targets: 0, sacked: 0,
      rec: 0, rec_yds: 0, rec_tds: 0, ints: 0, fumbles: 0, sacks: 0, fgs: 0, fga: 0,
      td: 0, pts: 0,
    });
    // Every slot gets a line, filled or not. A quiet receiver had a quiet
    // game; he did not fail to exist, and an absent row is the one thing a box
    // score must never say.
    for (const slot of Object.keys(roster)) box[slot] = emptyLine();
    const at = (slot) => (slot && box[slot] ? box[slot] : null);

    const team = {
      passYards: 0, rushYards: 0, totalYards: 0, firstDowns: 0, turnovers: 0,
      thirdDownAttempts: 0, thirdDownConversions: 0,
      redZoneTrips: 0, redZoneTouchdowns: 0,
      sacksAllowed: 0, possessionSeconds: 0, drives: 0, startYardTotal: 0,
      plays: 0,
    };

    for (const drive of mine) {
      team.drives += 1;
      team.startYardTotal += drive.startYard;
      // A trip inside the opponent's twenty, counted once per drive however
      // many plays it took to get there.
      let enteredRedZone = false;

      for (const play of drive.plays || []) {
        team.plays += 1;
        team.possessionSeconds += play.seconds || 0;
        if (play.firstDown) team.firstDowns += 1;
        if (play.down === 3) {
          team.thirdDownAttempts += 1;
          if (play.firstDown) team.thirdDownConversions += 1;
        }
        if (!enteredRedZone && play.endYard >= 80) {
          enteredRedZone = true;
          team.redZoneTrips += 1;
        }

        const qb = at("QB");
        switch (play.type) {
          case "run": {
            const line = at(play.carrier);
            if (line) {
              line.carries += 1;
              line.rush_yds += play.gain;
            }
            team.rushYards += play.gain;
            break;
          }
          case "sack": {
            // Charged to the quarterback and to the line that let it happen.
            // Sack yardage is lost passing yardage in the NFL's own books.
            if (qb) {
              qb.sacked += 1;
              qb.att += 0;
            }
            team.sacksAllowed += 1;
            team.passYards += play.gain;
            if (qb) qb.pass_yds += play.gain;
            break;
          }
          case "incompletion": {
            if (qb) qb.att += 1;
            break;
          }
          default: {
            // A completion. The quarterback and his receiver are two halves of
            // one event, written together so they can never disagree.
            const line = at(play.receiver);
            if (qb) {
              qb.att += 1;
              qb.comp += 1;
              qb.pass_yds += play.gain;
            }
            if (line) {
              line.targets += 1;
              line.rec += 1;
              line.rec_yds += play.gain;
            }
            team.passYards += play.gain;
            break;
          }
        }
      }

      // The drive's result, credited to the man the drive already named.
      // Points nobody on this roster can be credited with still have to land
      // somewhere, or the box score stops adding up to the scoreboard. Quick
      // Play drafts no kicker, so its field goals have no slot to go to - they
      // go to TEAM, which is not a roster slot and therefore never renders as
      // a row, but does keep every sum honest.
      const teamLine = () => (box.TEAM = box.TEAM || emptyLine());
      const scorer = at(drive.scorerSlot) || (drive.points > 0 ? teamLine() : null);
      if (drive.outcome === "fieldGoal" && scorer) {
        scorer.fgs += 1;
        scorer.fga += 1;
        scorer.pts += drive.points;
      } else if (drive.outcome === "downs" && drive.text && /missed/i.test(drive.text)) {
        const kicker = at("ST");
        if (kicker) kicker.fga += 1;
      } else if (drive.outcome === "touchdown" && scorer) {
        if (drive.kind === "rush") scorer.rush_tds += 1;
        else {
          scorer.rec_tds += 1;
          const qb = at("QB");
          if (qb && drive.scorerSlot !== "QB") qb.pass_tds += 1;
        }
        scorer.td += 1;
        scorer.pts += drive.points;
        if (enteredRedZone) team.redZoneTouchdowns += 1;
      } else if (drive.outcome === "turnover") {
        team.turnovers += 1;
      }
    }

    // Rounding happens once, here, at the boundary between simulating and
    // printing - and BEFORE the team totals are read off the same numbers, so
    // the table and its totals agree to the yard.
    for (const line of Object.values(box)) {
      for (const key of ["rec_yds", "rush_yds", "pass_yds", "rec", "att", "comp", "carries", "targets"]) {
        line[key] = Math.round(line[key] || 0);
      }
      // Whole numbers on a scoreboard. Points are integers now that the
      // conversion is played out rather than folded into the touchdown at
      // 6.94, but the rounding stays: it costs nothing and it is the boundary
      // where simulating stops and printing starts.
      line.pts = Math.round(line.pts);
    }

    // Team yardage is the SUM OF THE LINES, not a parallel tally. Two counters
    // for one truth is how a box score and its totals end up disagreeing.
    const slots = Object.keys(box);
    team.passYards = slots.reduce((sum, k) => sum + box[k].rec_yds, 0);
    team.rushYards = slots.reduce((sum, k) => sum + box[k].rush_yds, 0);
    team.totalYards = team.passYards + team.rushYards;
    team.averageStart = team.drives ? Math.round(team.startYardTotal / team.drives) : 0;
    // A quarterback's passing yards are his receivers' receiving yards. Same
    // additions, so they cannot drift.
    if (box.QB) box.QB.pass_yds = team.passYards;

    // What this defence DID, over on the other side's drives - so a drafted
    // ball-hawking secondary and a drafted pass rush both show up in the box
    // score rather than only in the recap.
    for (const d of drives.filter((x) => x.team !== side && (onlyQuarter == null || x.quarter === onlyQuarter))) {
      if (d.outcome === "turnover" && d.credit && box[d.credit]) {
        if (d.takeaway === "fumble") box[d.credit].fumbles += 1;
        else box[d.credit].ints += 1;
      }
      for (const play of d.plays || []) {
        if (play.type === "sack" && play.sackBy && box[play.sackBy]) box[play.sackBy].sacks += 1;
      }
    }

    return { box, team };
  };

  // Re-emit the per-quarter lines through the real ledger now that it exists.
  // The cheap points-only pass above still runs first because the overtime
  // loop needs a score before a box score is meaningful - but what the UI
  // finally receives is the full football line per quarter, so the live table
  // fills in with completions and yards instead of sitting at zero until the
  // final whistle.
  for (const period of quarterBoxScores) {
    period.a = boxFor("A", rosterA, period.period).box;
    period.b = boxFor("B", rosterB, period.period).box;
  }

  return {
    teamScoreA, teamScoreB,
    ...(() => {
      const a = boxFor("A", rosterA);
      const b = boxFor("B", rosterB);
      // Team totals travel beside the box score, not inside it: they are a
      // different shape (one object per side, not one per slot) and folding
      // them in would make every consumer guard against a fake roster slot.
      // The MVP is picked from these same two ledgers rather than from a
      // third pass, so the man named cannot have a different line to the one
      // the box score prints for him.
      return {
        boxA: a.box, boxB: b.box, teamStatsA: a.team, teamStatsB: b.team,
        mvp: pickMvp(rosterA, a.box, rosterB, b.box, teamScoreA, teamScoreB),
      };
    })(),
    quarterBoxScores, drives, overtimePeriods,
    coinToss: { winner: tossWinner, elected, firstHalfReceiver },
    winner: teamScoreA === teamScoreB ? null : teamScoreA > teamScoreB ? "A" : "B",
    analysis: {
      offA, offB, defA, defB,
      // Which of each side's players were built for the plan that side ran.
      // Computed here rather than in the recap because this is the only place
      // that holds both the roster and the strategy - and it travels in the
      // result so an online game, whose simulation happened on the server,
      // reveals exactly what an offline one does.
      affinityA: affinityRevealFor(opts.strategyA ?? opts.tacticA, rosterA),
      affinityB: affinityRevealFor(opts.strategyB ?? opts.tacticB, rosterB),
    },
  };
}
