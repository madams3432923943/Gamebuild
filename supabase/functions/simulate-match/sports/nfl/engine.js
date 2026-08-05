// NFL simulation. EMPTY - not built.
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

import {
  DRIVES_PER_TEAM, BASE_POINTS_PER_DRIVE, DRIVE_START_YARD, FG_RANGE_YARD,
  DRIVE_OUTCOMES, POINTS, OFFENSE_WEIGHTS, DEFENSE_WEIGHTS, TALENT_PARITY,
  TEAM_QUARTER_VARIANCE_MIN, TEAM_QUARTER_VARIANCE_MAX, FORFEIT_PENALTY,
} from "./constants.js";
import { buildRatingContext, rateEntry, isUnit } from "./units.js";

export function computeDatasetStats(players, units) {
  return buildRatingContext(players, units);
}

/** Weighted mean of the slots on one side of the ball. A forfeited slot is not
 * a zero - it is a replacement-level body, which is what actually takes the
 * field when you have nobody. Zero would mean eleven men playing ten. */
function sideRating(roster, weights, forfeits, ctx) {
  let total = 0;
  for (const [slot, weight] of Object.entries(weights)) {
    const entry = roster[slot];
    const rated = entry ? rateEntry(entry, ctx) : 0.5;
    const penalised = forfeits?.includes(slot) ? rated * (1 - FORFEIT_PENALTY) : rated;
    total += weight * penalised;
  }
  return total;
}

/** Turns an offence/defence gap into a multiplier on drive quality.
 *
 * TALENT_PARITY compresses it: football has enormous per-possession variance,
 * and a sim where the better roster converts every mismatch would produce
 * scores no real game reaches. Centred on 1 so an even matchup is average. */
function edge(off, def) {
  return 1 + TALENT_PARITY * (off - def);
}

/** Picks a drive's ending from the league-average chart, tilted by the edge.
 * Scoring outcomes scale up with a good offence and punts/turnovers take the
 * difference, so the four still sum to 1 and no probability can go negative. */
function driveOutcome(mult, rand) {
  const td = DRIVE_OUTCOMES.touchdown * mult;
  const fg = DRIVE_OUTCOMES.fieldGoal * mult;
  const scoring = Math.min(0.92, td + fg);
  const remaining = 1 - scoring;
  const puntShare = DRIVE_OUTCOMES.punt / (DRIVE_OUTCOMES.punt + DRIVE_OUTCOMES.turnover);

  const roll = rand();
  if (roll < td / (td + fg) * scoring) return "touchdown";
  if (roll < scoring) return "fieldGoal";
  if (roll < scoring + remaining * puntShare) return "punt";
  return "turnover";
}

/** Who scored. Weighted by each player's real share of the roster's touchdowns,
 * so the popup is a claim the box score can back - a drafted Randy Moss shows
 * up in highlights about as often as he really did. */
function pickScorer(roster, kind, rand) {
  const field = kind === "rush" ? "rush_td" : "rec_td";
  const candidates = [];
  let total = 0;
  for (const [slot, entry] of Object.entries(roster)) {
    if (!entry || isUnit(entry)) continue;
    const share = Number(entry[field]) || 0;
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
  const reach = 18 + 42 * mult * rand();
  if (outcome === "touchdown") return 100 - startYard;
  if (outcome === "fieldGoal") return Math.max(FG_RANGE_YARD - startYard, reach);
  return Math.max(-8, Math.min(100 - startYard - 1, reach - 14));
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
function fieldGoalGood(kicker, endYard, rand) {
  const distance = 100 - endYard + 17;
  const base = Number(kicker?.fg_pct) || 0.78;
  const longPenalty = Math.max(0, distance - 38) * 0.011;
  return rand() < Math.max(0.25, base - longPenalty);
}

const label = (entry) => entry?.name || entry?.group || "the unit";

/** One team's drive. Returns the record the UI animates and the field position
 * the opponent inherits. */
function runDrive(ctx, side, off, def, roster, oppRoster, startYard, quarter, rand) {
  const mult = edge(off, def) * (TEAM_QUARTER_VARIANCE_MIN +
    rand() * (TEAM_QUARTER_VARIANCE_MAX - TEAM_QUARTER_VARIANCE_MIN));
  let outcome = driveOutcome(mult, rand);
  let endYard = Math.max(1, Math.min(100, startYard + driveYards(outcome, startYard, mult, rand)));
  let points = 0;
  let scorer = null;
  let scorerSlot = null;
  let credit = null;
  let text = "";

  if (outcome === "touchdown") {
    // Rushing scores are rarer than receiving ones and go to backs and
    // quarterbacks, which is why the kind is drawn before the man.
    const kind = rand() < 0.32 ? "rush" : "rec";
    const who = pickScorer(roster, kind, rand) || pickScorer(roster, kind === "rush" ? "rec" : "rush", rand);
    points = POINTS.touchdown;
    scorer = who ? who.entry.name : null;
    scorerSlot = who?.slot ?? null;
    text = scorer
      ? `${scorer} ${kind === "rush" ? "rushing" : "receiving"} touchdown`
      : "Touchdown";
  } else if (outcome === "fieldGoal") {
    const kicker = roster.ST;
    if (fieldGoalGood(kicker, endYard, rand)) {
      points = POINTS.fieldGoal;
      scorer = kicker?.members?.[0] || label(kicker);
      scorerSlot = "ST";
      text = `Field goal by ${scorer}`;
    } else {
      // A miss is still a drive that got into range, and it still hands the
      // ball over at the spot - which is why the arrow should show it.
      outcome = "downs";
      text = `Field goal missed by ${kicker?.members?.[0] || label(kicker)}`;
    }
  } else if (outcome === "turnover") {
    const stop = pickStopper(oppRoster, rand);
    credit = stop?.slot ?? null;
    text = stop ? `Turnover forced by the ${label(stop.entry)}` : "Turnover";
  } else {
    text = "Punt";
  }

  return {
    drive: { team: side, quarter, startYard: Math.round(startYard), endYard: Math.round(endYard),
             outcome, points, scorer, scorerSlot, credit, text },
    nextStart: nextStart(outcome, endYard),
  };
}

export function simulate(rosterA, rosterB, stats, opts = {}) {
  const rand = opts.rand || Math.random;
  const ctx = stats;

  const offA = sideRating(rosterA, OFFENSE_WEIGHTS, opts.forfeitsA, ctx);
  const offB = sideRating(rosterB, OFFENSE_WEIGHTS, opts.forfeitsB, ctx);
  const defA = sideRating(rosterA, DEFENSE_WEIGHTS, opts.forfeitsA, ctx);
  const defB = sideRating(rosterB, DEFENSE_WEIGHTS, opts.forfeitsB, ctx);

  const drives = [];
  let startA = DRIVE_START_YARD;
  let startB = DRIVE_START_YARD;

  // Possessions alternate, so both sides get the same count - a game where one
  // team simply got more chances would be reporting luck as skill.
  for (let i = 0; i < DRIVES_PER_TEAM; i++) {
    const quarter = Math.min(4, Math.floor((i / DRIVES_PER_TEAM) * 4) + 1);
    const a = runDrive(ctx, "A", offA, defB, rosterA, rosterB, startA, quarter, rand);
    drives.push(a.drive);
    startB = a.nextStart;
    const b = runDrive(ctx, "B", offB, defA, rosterB, rosterA, startB, quarter, rand);
    drives.push(b.drive);
    startA = b.nextStart;
  }

  // quarterBoxScores is DERIVED from drives, never tracked alongside it. Two
  // writers for one truth is how a scoreboard and a play-by-play disagree.
  const quarterBoxScores = [1, 2, 3, 4].map((q) => ({
    period: q,
    a: drives.filter((d) => d.team === "A" && d.quarter === q).reduce((s, d) => s + d.points, 0),
    b: drives.filter((d) => d.team === "B" && d.quarter === q).reduce((s, d) => s + d.points, 0),
  }));

  const teamScoreA = Math.round(quarterBoxScores.reduce((s, q) => s + q.a, 0));
  const teamScoreB = Math.round(quarterBoxScores.reduce((s, q) => s + q.b, 0));

  const boxFor = (side, roster) => {
    const box = {};
    for (const slot of Object.keys(roster)) {
      const mine = drives.filter((d) => d.team === side && d.scorerSlot === slot);
      box[slot] = { td: mine.length, pts: mine.reduce((s, d) => s + d.points, 0) };
    }
    return box;
  };

  return {
    teamScoreA, teamScoreB,
    boxA: boxFor("A", rosterA), boxB: boxFor("B", rosterB),
    quarterBoxScores, drives, overtimePeriods: 0,
    winner: teamScoreA === teamScoreB ? null : teamScoreA > teamScoreB ? "A" : "B",
    analysis: { offA, offB, defA, defB },
  };
}
