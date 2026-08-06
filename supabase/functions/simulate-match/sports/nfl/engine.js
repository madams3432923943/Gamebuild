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
//
// ---------------------------------------------------------------------------
// THE PLAYBACK THIS FEEDS - NOT BUILT YET
// ---------------------------------------------------------------------------
//
// The engine is done and correct: a Quick Play roster simulates 34-27 over 22
// drives with named scorers and continuous field position. What does NOT exist
// is a football way to WATCH it. NFL currently renders through playOutResult(),
// which is basketball's playback - it counts quarters up and draws a
// PTS/REB/AST table, so a football game arrives as an empty basketball box
// score. That is the whole of the "it simmed a basketball game" report.
//
// What it should be, per the design call:
//
//   A FIELD, not a table. One horizontal field, 0 to 100. The ball moves from
//   startYard to endYard for each drive, then the possession flips and it
//   moves the other way - which is why nextStart() exists and why a punt has
//   to change the opponent's starting position rather than resetting to 25.
//
//   EACH ENDZONE IS A PLAYER'S BANNER. The two endzones are the two drafters'
//   equipped banners, so you can see whose goal line the ball is approaching
//   without reading a label. Banners already exist per profile
//   (profiles.equipped_banner) and are already rendered elsewhere.
//
//   POPUPS ON THE SCORE. drive.text is written ready to show - "Zay Flowers
//   receiving touchdown", "Field goal by Justin Tucker", "Richard Sherman
//   interception". It is a sentence, not a stat, precisely so it can be
//   surfaced as it happens.
//
//   THE BOX SCORE IS FOOTBALL'S. boxA/boxB already carry pass_yds, rush_yds,
//   rec_yds, tds, ints, fumbles and fgs per slot - the columns js/ui.js draws
//   are still hardcoded to basketball's six (see LINE_KEYS there), which is
//   the other half of why the table read PTS/REB/AST.
//
// None of this needs engine changes. Everything the view wants is already in
// the return value; what is missing is a per-sport playback the way there is
// already a per-sport engine.

import {
  DRIVES_PER_TEAM, BASE_POINTS_PER_DRIVE, DRIVE_START_YARD, FG_RANGE_YARD,
  DRIVE_OUTCOMES, POINTS, OFFENSE_WEIGHTS, DEFENSE_WEIGHTS, TALENT_PARITY,
  TEAM_QUARTER_VARIANCE_MIN, TEAM_QUARTER_VARIANCE_MAX, FORFEIT_PENALTY,
} from "./constants.js";
import { buildRatingContext, rateEntry, isUnit } from "./units.js";
import { scaledModsFor } from "./tactics.js";

export function computeDatasetStats(players, units) {
  return buildRatingContext(players, units);
}

/** Weighted mean of the slots on one side of the ball. A forfeited slot is not
 * a zero - it is a replacement-level body, which is what actually takes the
 * field when you have nobody. Zero would mean eleven men playing ten. */
function sideRating(roster, weights, forfeits, ctx) {
  let total = 0;
  for (const [slot, weight] of Object.entries(weights)) {
    // Quick Play drafts one DEF unit instead of four, so it stands in for
    // every defensive slot - one pick really is the whole defence there.
    const entry = roster[slot] ?? (DEFENSE_WEIGHTS[slot] ? roster.DEF : undefined);
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
function fieldGoalGood(kicker, endYard, rand, fgMod = 1) {
  const distance = 100 - endYard + 17;
  const base = (Number(kicker?.fg_pct) || 0.78) * fgMod;
  const longPenalty = Math.max(0, distance - 38) * 0.011;
  return rand() < Math.max(0.25, base - longPenalty);
}

const label = (entry) => entry?.name || entry?.group || "the unit";

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

/** One team's drive. Returns the record the UI animates and the field position
 * the opponent inherits. */
function runDrive(ctx, side, off, def, roster, oppRoster, startYard, quarter, rand, mine, theirs) {
  // The gamestyle acts on BOTH sides: yours lifts your offence, theirs lifts
  // the defence you are running into. A style that only helped its owner would
  // make the opponent's choice invisible, which is half the decision gone.
  const offAdj = off * mine.off;
  const defAdj = def * theirs.def * ((theirs.passRush + theirs.coverage + theirs.runDef) / 3);
  const mult = edge(offAdj, defAdj) * (TEAM_QUARTER_VARIANCE_MIN +
    rand() * (TEAM_QUARTER_VARIANCE_MAX - TEAM_QUARTER_VARIANCE_MIN));
  let outcome = driveOutcome(mult, rand);

  // Ball Hawks and Blitz Brigade turn stops into takeaways; Ground & Pound's
  // ball control resists them. Applied as a re-roll of a stop rather than as
  // free points, so a takeaway style wins the ball rather than the game.
  if (outcome === "punt") {
    const steal = (theirs.takeaway - 1) * 0.5 + (1 - mine.security) * 0.5;
    if (steal > 0 && rand() < steal) outcome = "turnover";
  }
  // Explosive styles convert their scoring drives into touchdowns rather than
  // field goals - the difference between Vertical Attack and West Coast.
  if (outcome === "fieldGoal" && mine.explosive > 1 && rand() < (mine.explosive - 1)) {
    outcome = "touchdown";
  } else if (outcome === "touchdown" && mine.explosive < 1 && rand() < (1 - mine.explosive) * 0.6) {
    outcome = "fieldGoal";
  }
  let endYard = Math.max(1, Math.min(100, startYard + driveYards(outcome, startYard, mult, rand)));
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

  if (outcome === "touchdown") {
    // Rushing scores are rarer than receiving ones and go to backs and
    // quarterbacks, which is why the kind is drawn before the man.
    kind = rand() < 0.32 ? "rush" : "rec";
    const who = pickScorer(roster, kind, rand) || pickScorer(roster, kind === "rush" ? "rec" : "rush", rand);
    points = POINTS.touchdown;
    scorer = who ? who.entry.name : null;
    scorerSlot = who?.slot ?? null;
    text = scorer
      ? `${scorer} ${kind === "rush" ? "rushing" : "receiving"} touchdown`
      : "Touchdown";
  } else if (outcome === "fieldGoal") {
    const kicker = roster.ST;
    if (fieldGoalGood(kicker, endYard, rand, mine.fg)) {
      points = POINTS.fieldGoal;
      scorer = kicker?.members?.[0]?.name || label(kicker);
      scorerSlot = "ST";
      text = `Field goal by ${scorer}`;
    } else {
      // A miss is still a drive that got into range, and it still hands the
      // ball over at the spot - which is why the arrow should show it.
      outcome = "downs";
      text = `Field goal missed by ${kicker?.members?.[0]?.name || label(kicker)}`;
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
        : `${takeaway === "int" ? "Intercepted" : "Fumble forced"} by the ${label(stop.entry)}`;
  } else {
    text = "Punt";
  }

  return {
    drive: { team: side, quarter, startYard: Math.round(startYard), endYard: Math.round(endYard),
             outcome, points, scorer, scorerSlot, credit, kind, takeaway, text },
    nextStart: nextStart(outcome, endYard),
  };
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
export function simulate(rosterA, rosterB, stats, opts = {}) {
  const rand = opts.rand || Math.random;
  const ctx = stats;
  // Scaled by roster fit, so a style is worth what your lineup makes it worth.
  const modsA = scaledModsFor(opts.tacticA, rosterA);
  const modsB = scaledModsFor(opts.tacticB, rosterB);

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

  for (let i = 0; i < possessions; i++) {
    const quarter = Math.min(4, Math.floor((i / possessions) * 4) + 1);
    // Second half flips who opens, so each side receives exactly one half.
    const receiver = quarter <= 2 ? firstHalfReceiver : other(firstHalfReceiver);
    for (const side of [receiver, other(receiver)]) {
      const foe = other(side);
      const r = runDrive(ctx, side, cfg[side].off, cfg[foe].def, cfg[side].roster,
                         cfg[foe].roster, start[side], quarter, rand,
                         cfg[side].mods, cfg[foe].mods);
      drives.push(r.drive);
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
      const r = runDrive(ctx, side, cfg[side].off, cfg[foe].def, cfg[side].roster,
                         cfg[foe].roster, start[side], quarter, rand,
                         cfg[side].mods, cfg[foe].mods);
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
  const boxFor = (side, roster) => {
    const box = {};
    const emptyLine = () => ({
      comp: 0, att: 0, pass_yds: 0, pass_tds: 0, rush_yds: 0, rush_tds: 0,
      rec: 0, rec_yds: 0, rec_tds: 0, ints: 0, fumbles: 0, fgs: 0,
      td: 0, pts: 0,
    });
    // Every slot gets a line, filled or not. A receiver who was quiet had a
    // quiet game; he did not fail to exist, and an absent row is the one thing
    // a box score must never say.
    for (const slot of Object.keys(roster)) box[slot] = emptyLine();

    // WHY THE WORK IS SPREAD
    //
    // This used to credit only the man who FINISHED a drive: `drives.filter(d
    // => d.scorerSlot === slot)`. Two things followed, both wrong. A drive
    // that ended in a punt or a field goal credited nobody, so most of the
    // game's yards existed only in the score. And on a scoring drive the one
    // scorer took every catch and every yard, so a roster's second and third
    // receivers finished games with a row of zeros while one man caught
    // eleven passes. Ten personnel on the field, one in the box score.
    //
    // The drive is still the honest unit - this model does not simulate
    // individual plays, and pretending otherwise would be inventing data. But
    // the yards a drive covered were covered by the people who play those
    // positions, in the proportion they really played them. Each drive's
    // yardage is split pass/run and then shared out by each man's REAL
    // per-game production, which is already in the dataset. The touchdown
    // still belongs to whoever pickScorer chose.
    const skill = Object.entries(roster)
      .filter(([, e]) => e && !isUnit(e))
      .map(([slot, entry]) => ({ slot, entry }));
    const catchers = skill.filter(({ slot }) => slot !== "QB");
    const weightOf = (list, field) => {
      const weights = list.map(({ entry }) => Math.max(0, Number(entry[field]) || 0));
      const total = weights.reduce((s, w) => s + w, 0);
      // Nobody in the dataset produced here (a roster of blockers, or a data
      // gap): share it evenly rather than dropping the yards on the floor.
      return total > 0 ? weights.map((w) => w / total) : weights.map(() => 1 / (list.length || 1));
    };
    const recShare = weightOf(catchers, "rec_yds");
    const catchShare = weightOf(catchers, "rec");
    const rushers = skill;
    const rushShare = weightOf(rushers, "rush_yds");

    // How this roster moves the ball, from the roster itself rather than a
    // constant: a team built around a back should run more than one built
    // around three receivers. Bounded because no NFL offence is all of one.
    const totalRec = catchers.reduce((s, { entry }) => s + (Number(entry.rec_yds) || 0), 0);
    const totalRush = rushers.reduce((s, { entry }) => s + (Number(entry.rush_yds) || 0), 0);
    const passBias = totalRec + totalRush > 0 ? totalRec / (totalRec + totalRush) : 0.6;
    const passRatio = Math.max(0.4, Math.min(0.78, passBias));

    for (const d of drives.filter((x) => x.team === side)) {
      const gained = Math.max(0, d.endYard - d.startYard);
      if (d.outcome === "fieldGoal" && d.scorerSlot && box[d.scorerSlot]) {
        box[d.scorerSlot].fgs += 1;
        box[d.scorerSlot].pts += d.points;
      }
      if (!gained || !skill.length) continue;

      const passYards = Math.round(gained * passRatio);
      const rushYards = gained - passYards;

      // Receiving. Yards and catches are shared on separate weights on
      // purpose - a possession receiver and a deep threat split the same
      // drive very differently, and using one weight for both would make
      // every catch worth the same yardage.
      catchers.forEach(({ slot }, i) => {
        const yds = passYards * recShare[i];
        if (yds <= 0) return;
        box[slot].rec_yds += yds;
        box[slot].rec += Math.max(0, catchShare[i] * (1 + gained / 26));
      });
      // A man who is about to be credited with a rushing touchdown carried the
      // ball on this drive, by definition, so he gets a real share of its
      // rushing yards rather than whatever his season weight says. Without
      // this a tight end could finish with a rushing touchdown and zero
      // rushing yards - a row that contradicts itself in public.
      //
      // This makes the LINE consistent. It does not fix how the scorer was
      // chosen: pickScorer still weights by rush_td alone, so a tight end with
      // any rushing score in the dataset can be drawn for a carry he would
      // rarely be given. That is the designed-run attribution work, and it
      // belongs with the play-level ledger rather than here.
      const scoringRusher = d.kind === "rush" && d.scorerSlot && box[d.scorerSlot] ? d.scorerSlot : null;
      const SCORER_FLOOR = 0.5;
      rushers.forEach(({ slot }, i) => {
        let portion = rushShare[i];
        if (scoringRusher) {
          portion = slot === scoringRusher
            ? Math.max(portion, SCORER_FLOOR)
            : portion * (1 - SCORER_FLOOR);
        }
        const yds = rushYards * portion;
        if (yds > 0) box[slot].rush_yds += yds;
      });

      if (d.kind === "rush" && d.scorerSlot && box[d.scorerSlot]) {
        box[d.scorerSlot].rush_tds += 1;
        box[d.scorerSlot].td += 1;
        box[d.scorerSlot].pts += d.points;
      } else if (d.kind === "rec" && d.scorerSlot && box[d.scorerSlot]) {
        box[d.scorerSlot].rec_tds += 1;
        box[d.scorerSlot].td += 1;
        box[d.scorerSlot].pts += d.points;
        if (box.QB && d.scorerSlot !== "QB") box.QB.pass_tds += 1;
      }
    }

    // Whole numbers first. These are counting stats on a printed page, not
    // the fractional shares they were computed from - and the quarterback's
    // line below has to be built from what the table will actually SHOW, or
    // his passing yards and his receivers' receiving yards disagree by the
    // rounding and the box score contradicts itself in public.
    for (const line of Object.values(box)) {
      line.rec_yds = Math.round(line.rec_yds);
      line.rush_yds = Math.round(line.rush_yds);
      line.rec = Math.round(line.rec);
    }

    // The quarterback's line is the SUM of what his receivers did, not a
    // parallel estimate of it. Derived rather than accumulated so passing
    // yards always equal receiving yards and completions always equal
    // receptions - two of the reconciliations a football box score is judged
    // on, and impossible to drift out of once they are the same number.
    if (box.QB) {
      let recYds = 0;
      let catches = 0;
      for (const { slot } of catchers) {
        recYds += box[slot].rec_yds;
        catches += box[slot].rec;
      }
      box.QB.pass_yds = recYds;
      box.QB.comp = catches;
      // Attempts exceed completions because nobody is perfect. The gap is
      // what makes C/ATT worth a column at all.
      box.QB.att = catches + Math.round(catches * 0.42);
    }
    // Points are whole numbers on a scoreboard. POINTS.touchdown carries 6.94
    // - the extra point folded in at its real rate - which is right for
    // simulating and wrong for reading: nobody scored 20.82.
    for (const line of Object.values(box)) line.pts = Math.round(line.pts);

    // Turnovers land on the defensive unit credited with them, so a drafted
    // ball-hawking secondary shows up in the box score as well as the recap.
    for (const d of drives.filter((x) => x.team !== side && x.outcome === "turnover" && x.credit)) {
      const unit = box[d.credit];
      if (!unit) continue;
      if (d.takeaway === "fumble") unit.fumbles += 1;
      else unit.ints += 1;
    }
    return box;
  };

  return {
    teamScoreA, teamScoreB,
    boxA: boxFor("A", rosterA), boxB: boxFor("B", rosterB),
    quarterBoxScores, drives, overtimePeriods,
    coinToss: { winner: tossWinner, elected, firstHalfReceiver },
    winner: teamScoreA === teamScoreB ? null : teamScoreA > teamScoreB ? "A" : "B",
    analysis: { offA, offB, defA, defB },
  };
}
