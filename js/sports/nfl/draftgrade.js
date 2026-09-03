// Draft grades. Rates the roster you built against what was available, not
// against an absolute - the point is whether you drafted well from the squads
// you were offered, which is the only thing you controlled.

import { OFFENSE_WEIGHTS, DEFENSE_WEIGHTS } from "./constants.js";
import { rateEntry, unitLabel, isUnit } from "./units.js";
import { letterFor as curveLetter, sampleRosterScores } from "../../gradecurve.js";
import { matchupNotes } from "../../matchups.js";
import { statNote, adviceNote } from "../../gradenotes.js";

const canonicalSlot = (slot) => String(slot || "").replace(/\d+$/, "").toUpperCase();

/**
 * Who actually lines up across from whom.
 *
 * FOOTBALL IS OFFENCE AGAINST DEFENCE, and reading a roster slot-for-slot the
 * way basketball does produced sentences describing nothing that happens on a
 * field: "your TE badly outmatches their TE" (no tight end covers a tight end),
 * "their OL has an advantageous matchup against your OL" (offensive lines never
 * meet). True of the ratings, meaningless as football.
 *
 * Both directions are listed, because a mismatch matters whichever side of the
 * ball it is on - their pass rush eating your line is as much the story of a
 * game as your receivers eating their corners.
 *
 * Special teams is the one pairing where like really does face like: your
 * kicking game and theirs are measured against the same field, so it stays.
 */
const MATCHUPS = [
  // The line of scrimmage, both ways.
  { mine: "OL", theirs: "DL", label: "offensive line", against: "pass rush" },
  { mine: "DL", theirs: "OL", label: "pass rush", against: "offensive line" },
  // The passing game against the coverage behind it.
  { mine: "WR1", theirs: "CB", label: "WR1", against: "secondary" },
  { mine: "WR2", theirs: "CB", label: "WR2", against: "secondary" },
  { mine: "CB", theirs: "WR1", label: "secondary", against: "WR1" },
  // Tight ends are a safety and linebacker problem, not a tight end problem.
  { mine: "TE", theirs: "S", label: "TE", against: "safeties" },
  { mine: "S", theirs: "TE", label: "safeties", against: "TE" },
  // The run game against the men paid to stop it.
  { mine: "RB", theirs: "LB", label: "RB", against: "linebackers" },
  { mine: "LB", theirs: "RB", label: "linebackers", against: "RB" },
  // The one honest like-for-like in football.
  { mine: "ST", theirs: "ST", label: "special teams", against: "special teams" },

  // QUICK PLAY IS A DIFFERENT ROSTER SHAPE. Ranked drafts the defence in four
  // units (DL/LB/CB/S); Quick Play drafts one combined DEF, and its receivers
  // are a single WR rather than WR1-3. Pairings naming only the ranked slots
  // resolved to nothing at all on a Quick Play roster - crossMatchups skips a
  // pair when either side is unfilled, so the read came back silently empty.
  // Both shapes are listed and each roster matches the half that applies to it.
  { mine: "OL", theirs: "DEF", label: "offensive line", against: "defence" },
  { mine: "DEF", theirs: "OL", label: "defence", against: "offensive line" },
  { mine: "WR", theirs: "DEF", label: "WR", against: "defence" },
  { mine: "RB", theirs: "DEF", label: "RB", against: "defence" },
  { mine: "TE", theirs: "DEF", label: "TE", against: "defence" },
  { mine: "QB", theirs: "DEF", label: "QB", against: "defence" },
];

/** Units identify themselves with `group` (DL/LB/CB/S/OL/ST), while players
 * expose `pos`. The old curve sampled only `pos`, so defensive unit slots had
 * no candidate pool and the resulting curve was not representative of an NFL
 * draft. Keep one eligibility rule for both shapes. */
function eligibleForSlot(entry, slot) {
  const wanted = canonicalSlot(slot);
  if (!entry) return false;
  if (String(entry.group || "").toUpperCase() === wanted) return true;
  return (entry.pos || []).some((pos) => String(pos).toUpperCase() === wanted);
}

/** The grade curve for this dataset, built once. Fixed cutoffs were the old
 * approach and they drift the moment the data changes. Memoised on the rating
 * context so it costs one pass per session. */
function curveFor(ctx, slots) {
  if (!ctx.__gradeCurve) {
    const all = ctx.__allEntries || [];
    ctx.__gradeCurve = sampleRosterScores(
      slots,
      (slot) => all.filter((entry) => eligibleForSlot(entry, slot)),
      (roster) => (sideScore(roster, OFFENSE_WEIGHTS, ctx) + sideScore(roster, DEFENSE_WEIGHTS, ctx)) / 2
    );
  }
  return ctx.__gradeCurve;
}

/** The entry that actually answers for a slot.
 *
 * Resolve a Quick Play roster the same way the engine's sideRating does, or the
 * grade praises a roster the simulation is playing differently. Both stand-ins
 * are needed and both were missing: Quick Play holds one "WR" against the
 * weights' WR1/WR2/WR3, and one "DEF" against DL/LB/CB/S. So every offensive
 * receiver slot AND every defensive slot was skipped, which left the defensive
 * half of a Quick Play grade at a flat 0.5 - the same letter whoever you
 * drafted. */
function entryForSlot(roster, slot) {
  return (
    roster[slot] ??
    (DEFENSE_WEIGHTS[slot] ? roster.DEF : undefined) ??
    roster[canonicalSlot(slot)]
  );
}

/** Weighted rating of one side of the ball. These are the same slot weights
 * the simulation consumes, so the grade cannot praise a roster for strengths
 * the engine itself ignores. */
function sideScore(roster, weights, ctx) {
  let total = 0;
  let weight = 0;
  for (const [slot, w] of Object.entries(weights)) {
    const entry = entryForSlot(roster, slot);
    if (!entry) continue;
    total += w * rateEntry(entry, ctx);
    weight += w;
  }
  return weight > 0 ? total / weight : 0.5;
}

/**
 * WHICH HALF OF THE ROSTER DECIDED IT, and which single pick decided that.
 *
 * The complaint this answers, verbatim: "in what world is that team beating
 * this team". A roster of famous skill players lost to one whose names nobody
 * recognised, and every screen the player could reach agreed with him - the box
 * score lists quarterbacks and receivers, the highlight feed names scorers, and
 * neither can show that the game was lost at offensive line and defensive line.
 * Six of the twelve football slots are units, and a unit never appears in a
 * stat line. They were decisive and invisible at the same time.
 *
 * Reported as CONTRIBUTION - weight x rating - not as raw rating, because that
 * is what the simulation actually consumed. A slot can be far behind on rating
 * and barely matter, or close on rating and matter a lot; ranking on the raw
 * number would point at the wrong pick and teach the wrong lesson.
 */
function decidingRead(roster, oppRoster, ctx) {
  const gaps = [];
  let offGap = 0;
  let defGap = 0;
  for (const [side, weights] of [["offence", OFFENSE_WEIGHTS], ["defence", DEFENSE_WEIGHTS]]) {
    for (const [slot, w] of Object.entries(weights)) {
      const mine = entryForSlot(roster, slot);
      const theirs = entryForSlot(oppRoster, slot);
      if (!mine || !theirs) continue;
      const a = rateEntry(mine, ctx);
      const b = rateEntry(theirs, ctx);
      const delta = w * (a - b);
      if (side === "offence") offGap += delta;
      else defGap += delta;
      gaps.push({ slot, side, delta, mine: a, theirs: b });
    }
  }
  if (!gaps.length) return [];

  const notes = [];
  // The half that cost the most, or - if nothing cost anything - the half that
  // won it. A player who WON deserves to be told why just as much.
  const behind = [offGap, defGap].some((g) => g < 0);
  const side = behind
    ? (offGap <= defGap ? "offence" : "defence")
    : (offGap >= defGap ? "offence" : "defence");
  const gap = side === "offence" ? offGap : defGap;
  const points = Math.round(100 * Math.abs(gap));
  // "THEY OUT-RATE YOU THERE BY 0" was printed for real - a claim that a half
  // of the roster decided the game, with a magnitude of nothing behind it.
  // Rounding to zero means the two halves are level, which is worth saying as
  // itself rather than as a decisive read with the number filed off.
  if (points === 0) {
    notes.push(statNote("Both halves", "level"));
  } else {
    notes.push(statNote(
      gap < 0 ? `Behind on ${side}` : `Ahead on ${side}`,
      `${points}`,
      gap < 0 ? "bad" : "good"
    ));
  }

  // The single pick that moved it most, whichever way it went. Named by slot
  // because that is the thing the player chose - and followed by the clause
  // that says what to do about it, which is what a grade is for.
  const worst = gaps.reduce((a, b) => (b.delta < a.delta ? b : a));
  if (worst.delta < 0) {
    notes.push(statNote(
      `Worst pick: ${worst.slot}`,
      `${Math.round(100 * worst.mine)}-${Math.round(100 * worst.theirs)}`,
      "bad"
    ));
    notes.push(adviceNote(`Take a ${worst.slot} earlier next draft.`));
  }
  return notes;
}

function defensiveBreakdown(roster, ctx) {
  const groups = {};
  for (const slot of Object.keys(DEFENSE_WEIGHTS)) {
    if (!roster[slot]) continue;
    groups[slot] = rateEntry(roster[slot], ctx);
  }
  return groups;
}

/** The forfeited slots, whatever shape the caller uses.
 *
 * Shared code calls `gradeDraft(roster, stats, opts)` with an OPTIONS OBJECT -
 * that is basketball's signature and therefore the contract - while football's
 * own draftAnalysis hands over a bare array. This declared the third parameter
 * as the array, so the object arrived instead, `.length` was undefined, the
 * penalty was NaN and every football draft graded F. Normalise once, here,
 * rather than at each call site. */
function forfeitList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.forfeits)) return value.forfeits;
  return [];
}

/** The opponent's roster, from either shape the third argument arrives in.
 *  A bare array is a forfeit list and carries no opponent. */
function opponentRoster(value) {
  return Array.isArray(value) ? null : value?.oppRoster || null;
}

export function draftGrade(roster, ctx, forfeitsOrOpts = []) {
  const forfeits = forfeitList(forfeitsOrOpts);
  const oppRoster = opponentRoster(forfeitsOrOpts);
  const offense = sideScore(roster, OFFENSE_WEIGHTS, ctx);
  const defense = sideScore(roster, DEFENSE_WEIGHTS, ctx);
  const defenseGroups = defensiveBreakdown(roster, ctx);

  // Both halves count equally. A roster that drafted a superb offence and
  // ignored its defence has drafted half a team, not a great full roster.
  const raw = (offense + defense) / 2;
  const penalty = forfeits.length * 0.05;
  const score = Math.max(0, raw - penalty);
  const slots = Object.keys(OFFENSE_WEIGHTS).concat(Object.keys(DEFENSE_WEIGHTS));
  const letter = curveLetter(score, curveFor(ctx, slots));

  // ONE ROW PER FACT, SHORTEST FIRST. This used to be a sentence per fact and
  // one of them - the per-unit defensive dump - ran to 50 characters, four
  // lines on a phone, to say four numbers. See js/gradenotes.js for why the
  // card is rows now.
  const notes = [];
  // Facts and advice are two different lists because they are two different
  // things to read - see js/gradenotes.js. They are concatenated into
  // `reasons` at the end so that a card renders the numbers first and the
  // clauses last however many of each there turn out to be.
  //
  // TWO ADVICE LISTS, AND THE ORDER IS NOT PUSH ORDER. Only two clauses fit,
  // so which two is a decision rather than an accident of where in this
  // function they happened to be added. A clause about the OPPONENT wins:
  // "Andrews has the edge on your safeties" names a man on the other roster
  // and a slot on yours, which is the most actionable thing a grade can say,
  // where "Offence-heavy" is a restatement of the two rows at the top of the
  // card. It is also what scripts/verify-sport-contract.mjs looks for - a
  // grade handed an opponent must name one - so letting a generic clause push
  // it out would fail the build as well as the reader.
  const keyAdvice = [];
  const advice = [];
  const pct = (value) => `${Math.round(100 * value)}`;
  notes.push(statNote("Offence", pct(offense), offense >= defense ? "good" : "neutral"));
  notes.push(statNote("Defence", pct(defense), defense > offense ? "good" : "neutral"));

  // THE WEAKEST UNIT, WHICH THE OLD DUMP MADE THE READER FIND. Printing
  // "DL 92 · LB 85 · CB 70 · S 68" asks a player to scan four numbers for the
  // smallest; naming it is the same information, shorter, and it is the pick
  // they can go and do something about.
  const rated = Object.keys(DEFENSE_WEIGHTS)
    .filter((slot) => Number.isFinite(defenseGroups[slot]))
    .map((slot) => ({ slot, rating: defenseGroups[slot] }));
  if (rated.length > 1) {
    const weakest = rated.reduce((a, b) => (b.rating < a.rating ? b : a));
    const strongest = rated.reduce((a, b) => (b.rating > a.rating ? b : a));
    notes.push(statNote("Best unit", `${strongest.slot} ${pct(strongest.rating)}`, "good"));
    notes.push(statNote("Weakest", `${weakest.slot} ${pct(weakest.rating)}`, "bad"));
  }

  if (forfeits.length) {
    notes.push(statNote("Slots empty", `${forfeits.length}`, "bad"));
  }

  // The identity read, as advice rather than as an observation: a drafter can
  // act on "you have to win this low-scoring" before kickoff, by picking the
  // gameplan that suits it.
  if (offense - defense > 0.15) advice.push("Offence-heavy - your defence will give it back.");
  else if (defense - offense > 0.15) advice.push("Defence-first - you need this game low-scoring.");
  if (forfeits.length) advice.push("Empty slots rate zero - never let the clock draft.");

  // Football's counterplay read, and until now it did not exist. NFL.draftAnalysis
  // accepted an opponent roster and dropped it on the floor, so the "how your
  // roster stacks against theirs" line was this same solo grade printed again -
  // believable output, which is why it survived so long.
  //
  // Units and individuals compare the same way here because rateEntry() already
  // returns one number for both: a secondary and a quarterback are not alike,
  // but "how good is this at its job" is the same question asked of each.
  if (oppRoster) {
    // Which half decided it comes FIRST. matchupNotes below is
    // slot-against-slot colour; this is the one row that answers "why did I
    // lose", and burying it under matchup rows is how it gets missed.
    for (const note of decidingRead(roster, oppRoster, ctx)) {
      if (note.kind === "advice") keyAdvice.push(note.text);
      else notes.push(note);
    }
    for (const note of matchupNotes(roster, oppRoster, {
      rate: (entry) => rateEntry(entry, ctx),
      pairings: MATCHUPS,
      // WHAT IDENTIFIES A UNIT IS ITS TEAM. A unit has no surname, and the
      // group alone is worse than useless in a clause about the line of
      // scrimmage - "Offensive Line has the edge on your pass rush" could be
      // any of 32 of them. The team's last word plus the group is what a fan
      // would say: "Falcons OL".
      shorten: (entry) => {
        if (!isUnit(entry)) return null;
        const town = String(entry.team || "").split(/\s+/).pop();
        return town ? `${town} ${entry.group}` : unitLabel(entry);
      },
    })) {
      if (note.kind === "advice") keyAdvice.push(note.text);
      else notes.push(note);
    }
  }

  return {
    letter,
    headline: offense - defense > 0.15
      ? "Built to outscore people."
      : defense - offense > 0.15
        ? "Built to win ugly."
        : "Balanced on both sides of the ball.",
    // Numbers, then the clauses about them. Capped: six rows and two pieces of
    // advice is a card, and the eleven notes this could otherwise produce is a
    // screen nobody reads to the bottom of.
    reasons: [
      ...notes.slice(0, 6),
      ...[...keyAdvice, ...advice].slice(0, 2).map(adviceNote),
    ],
    score,
    offense,
    defense,
    defenseGroups,
  };
}
