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
  RUSH_CARRIER_WEIGHTS,
} from "./constants.js";
import { buildRatingContext, rateEntry, isUnit } from "./units.js";
import { composedModsFor } from "./tactics.js";

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
  // Finishing a drive is a CONTEST, not a property of the offence. How hard you
  // go for the touchdown is your explosiveness and your red-zone intent
  // together; how well they hold you to three is theirs. A defence that keeps
  // everything in front of it really does turn touchdowns into field goals.
  const finish = (mine.explosive * mine.redZone) / (theirs.explosivePrevention || 1);
  if (outcome === "fieldGoal" && finish > 1 && rand() < (finish - 1)) {
    outcome = "touchdown";
  } else if (outcome === "touchdown" && finish < 1 && rand() < (1 - finish) * 0.6) {
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
    scorer = who ? who.entry.name : null;
    scorerSlot = who?.slot ?? null;
    text = scorer
      ? `${scorer} ${kind === "rush" ? "rushing" : "receiving"} touchdown`
      : "Touchdown";
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
  return {
    drive: { team: side, quarter, startYard: from, endYard: to,
             outcome, points, scorer, scorerSlot, credit, kind, takeaway, text,
             // How you attack and how they rush the passer both change the
             // SNAPS, not just the drive's outcome: a ground plan hands it off
             // more, and a blitz against a thin line puts the quarterback on
             // the floor. Passed in rather than read from a constant so the
             // plan is visible in the box score, not only in the score.
             plays: buildPlays(from, to, outcome, kind, scorerSlot, roster, rand, {
               runShare: mine.runShare,
               sackRate: (theirs.passRush || 1) / (mine.protection || 1),
             }) },
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
  const build = (list, field, gate) => {
    const items = list.map(({ slot, entry }) => ({
      slot,
      weight: Math.max(0, Number(entry[field]) || 0) * (gate ? gate[slot.replace(/\d+$/, "")] ?? 0 : 1),
    }));
    const total = items.reduce((s, i) => s + i.weight, 0);
    // A roster with no production in this column (a data gap) shares evenly
    // rather than dropping the touches on the floor.
    if (total <= 0) return items.map((i) => ({ ...i, weight: 1 / (items.length || 1) }));
    return items.map((i) => ({ ...i, weight: i.weight / total }));
  };
  return {
    catchers: build(skill.filter(({ slot }) => slot !== "QB"), "rec"),
    // Carries are gated by POSITION before production weights them, the same
    // way scoring runs are. A quarterback's rushing yards can rival a back's
    // without him being the man the ball is handed to twenty times a game.
    rushers: build(skill, "rush_yds", CARRY_SHARE),
  };
}

/** Who the ball is handed to on an ordinary carry, as a multiplier on that
 * man's rushing production. Backs carry; quarterbacks scramble and keep;
 * receivers get the occasional designed run; tight ends do not carry. */
const CARRY_SHARE = { RB: 1, QB: 0.3, FLEX: 0.7, WR: 0.08, TE: 0 };

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
 * stays at football's ~64 a side. */
const DEAD_PLAY_SHARE = 0.28;

/** ...and how many of those are sacks rather than incompletions. */
const SACK_SHARE_OF_DEAD = 0.13;

/** How much of a productive drive is carried on the ground. Solved against a
 * real team's ~120 rushing yards a game, not chosen. */
const RUN_SHARE = 0.45;

/** What a carry is worth against a throw, as a multiplier on the yardage it
 * draws. Real football is about 4.3 a carry against 7.2 an attempt. */
const RUN_YARD_WEIGHT = 0.6;

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
  const count = Math.max(1, Math.min(12, Math.round(Math.abs(net) / 9) + 1 + Math.floor(rand() * 2)));
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
  const dead = Math.min(count - 1, Math.round(count * DEAD_PLAY_SHARE));
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
  const runShare = Math.max(0.12, Math.min(0.82, RUN_SHARE * (Number(plan.runShare) || 1)));
  const raw = [];
  const kinds = [];
  for (let i = 0; i < productive; i++) {
    const isRun = rand() < runShare;
    kinds[i] = isRun ? "run" : "pass";
    raw[i] = (0.35 + rand() * 1.3) * (isRun ? RUN_YARD_WEIGHT : 1);
  }
  const rawTotal = raw.reduce((s, v) => s + v, 0);
  // The productive plays make up whatever the sacks gave away.
  const gainPool = net - sackLoss;

  const usage = usageWeights(roster);

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
      carrier = scoringTd && kind === "rush" ? scorerSlot : pickBySlotWeight(usage.rushers, rand);
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
// Deliberately modest. Issue #19 replaces this with football-specific MVP
// reasoning that can explain WHY a player was chosen; this exists so that a
// football game can be finished at all in the meantime.
const MVP_WEIGHTS = {
  pass_yds: 0.04, pass_tds: 4,
  rush_yds: 0.1, rush_tds: 6,
  rec_yds: 0.1, rec_tds: 6, rec: 0.5,
  fgs: 3,
  // A takeaway swings a possession, which is worth about what a score is.
  ints: 6, fumbles: 5,
  sacked: -0.5,
};

function mvpScore(line) {
  let total = 0;
  for (const key of Object.keys(MVP_WEIGHTS)) total += (Number(line[key]) || 0) * MVP_WEIGHTS[key];
  return total;
}

/**
 * The best individual line in the game, from either roster.
 *
 * Strictly greater-than, walking A before B and each roster in its own slot
 * order, so an exact tie always resolves the same way rather than on
 * whichever object key happened to come out first.
 */
function pickMvp(rosterA, boxA, rosterB, boxB) {
  let best = null;
  for (const [roster, box, side] of [
    [rosterA, boxA, "A"],
    [rosterB, boxB, "B"],
  ]) {
    for (const slot of Object.keys(box)) {
      const player = roster[slot];
      // TEAM is a bookkeeping line for points no drafted player can be
      // credited with - it keeps the box score adding up to the scoreboard,
      // and it is nobody, so it cannot be the MVP.
      if (!player) continue;
      const score = mvpScore(box[slot]);
      if (!best || score > best.score) best = { player, line: box[slot], side, slot, score };
    }
  }
  return best;
}

export function simulate(rosterA, rosterB, stats, opts = {}) {
  const rand = opts.rand || Math.random;
  const ctx = stats;
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
      rec: 0, rec_yds: 0, rec_tds: 0, ints: 0, fumbles: 0, fgs: 0, fga: 0,
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
      // Points are whole numbers on a scoreboard. POINTS.touchdown carries
      // 6.94 - the extra point folded in at its real rate - which is right for
      // simulating and wrong for reading: nobody scored 20.82.
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

    // Turnovers land on the defensive unit credited with them, so a drafted
    // ball-hawking secondary shows up in the box score as well as the recap.
    for (const d of drives.filter((x) => x.team !== side && x.outcome === "turnover" && x.credit && (onlyQuarter == null || x.quarter === onlyQuarter))) {
      const unit = box[d.credit];
      if (!unit) continue;
      if (d.takeaway === "fumble") unit.fumbles += 1;
      else unit.ints += 1;
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
        mvp: pickMvp(rosterA, a.box, rosterB, b.box),
      };
    })(),
    quarterBoxScores, drives, overtimePeriods,
    coinToss: { winner: tossWinner, elected, firstHalfReceiver },
    winner: teamScoreA === teamScoreB ? null : teamScoreA > teamScoreB ? "A" : "B",
    analysis: { offA, offB, defA, defB },
  };
}
