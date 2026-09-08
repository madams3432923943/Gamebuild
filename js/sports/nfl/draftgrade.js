// Draft grades. Rates the roster you built against what was available, not
// against an absolute - the point is whether you drafted well from the squads
// you were offered, which is the only thing you controlled.

import { OFFENSE_WEIGHTS, DEFENSE_WEIGHTS } from "./constants.js";
import { rateEntry, unitLabel, isUnit } from "./units.js";
import { letterFor as curveLetter, sampleRosterScores } from "../../gradecurve.js";
import { matchupNotes } from "../../matchups.js";
import { statNote, adviceNote, gridNote } from "../../gradenotes.js";

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

  // QUICK PLAY IS A DIFFERENT ROSTER SHAPE. Ranked drafts the defense in four
  // units (DL/LB/CB/S); Quick Play drafts one combined DEF, and its receivers
  // are a single WR rather than WR1-3. Pairings naming only the ranked slots
  // resolved to nothing at all on a Quick Play roster - crossMatchups skips a
  // pair when either side is unfilled, so the read came back silently empty.
  // Both shapes are listed and each roster matches the half that applies to it.
  { mine: "OL", theirs: "DEF", label: "offensive line", against: "defense" },
  { mine: "DEF", theirs: "OL", label: "defense", against: "offensive line" },
  { mine: "WR", theirs: "DEF", label: "WR", against: "defense" },
  { mine: "RB", theirs: "DEF", label: "RB", against: "defense" },
  { mine: "TE", theirs: "DEF", label: "TE", against: "defense" },
  { mine: "QB", theirs: "DEF", label: "QB", against: "defense" },
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

/**
 * WHY THE OFFENSE AND DEFENSE GRADES ARE NUMBERS AND THE OVERALL ONE IS A
 * LETTER, WHICH IS A DELIBERATE INCONSISTENCY.
 *
 * The obvious thing is a letter for each half, against a curve built the way
 * the overall one is. It was written that way first and it does not work, for
 * a reason worth recording so nobody writes it again.
 *
 * js/gradecurve.js samples a curve by drawing UNIFORMLY from every eligible
 * entry in the dataset - its header says it "samples rosters the way a draft
 * actually produces them", and that is the one thing it does not do. Measured
 * over 80 bot drafts against the shipped data:
 *
 *   drafted offense   0.496     a uniformly sampled offense   ~0.49
 *   drafted defense   0.691     a uniformly sampled defense   ~0.50
 *
 * Offensive picks land near the random baseline and defensive picks land far
 * above it, and the asymmetry is structural rather than a fault in either
 * rating: a rolled squad offers about ten candidates at a defensive slot (one
 * unit per season) against fifty at receiver, and the top-of-board ban that
 * shapes a bot draft therefore bites the offense much harder. So a half-curve
 * graded 68% of every defense ever drafted as A+ while the same rosters' offense
 * spread from D+ to A. Both letters were technically correct percentiles and
 * neither told a player anything.
 *
 * Fixing that properly means curving against what OTHER DRAFTS produce rather
 * than against random assemblies, which needs the draft engine - and
 * js/draft.js imports the sport registry, so importing it from a sport module
 * would close an import cycle for a cosmetic gain. It is recorded as follow-up
 * work rather than done badly here.
 *
 * So the two halves are reported as 0-100, the same scale the per-slot chips
 * already use, which is directly comparable between the two teams and needs no
 * curve to be honest. The overall grade keeps the letter it has always had.
 */
const gradeOutOf100 = (value) => Math.round(100 * value);

/**
 * WHAT A DRAFTED OFFENSE RATES MINUS WHAT A DRAFTED DEFENSE RATES.
 *
 * The zero point for every "is this roster offense-heavy or defense-first"
 * judgement below, and it is not zero. The two halves are weighted means of
 * ratings from different pools reached through a different draft: measured over
 * 80 bot drafts against the shipped dataset, offense comes out at 0.496 and
 * defense at 0.691. A rolled squad offers about ten candidates at a defensive
 * slot (one unit per season) against fifty at receiver, and the top-of-board
 * ban therefore takes far more off the offense - so a defensive pick lands
 * nearer the top of what was available than an offensive one does.
 *
 * Comparing the two raw numbers therefore says "defense-first" about every
 * roster ever drafted, which is what the headline and the identity advice did
 * before this existed: five of five sampled drafts were told they were built to
 * win ugly, including ones whose defense was the weaker half of the pair.
 *
 * MEASURED, NOT PICKED, and the same species of constant as EDGE_BASELINE in
 * constants.js - re-measure it after any change to the ratings, the slot
 * weights or the dataset. It only ever decides wording; nothing about the
 * simulation reads it.
 */
const DRAFTED_SIDE_BASELINE = -0.195;

/** How far this roster leans, once the systematic gap above is taken out.
 * Positive is genuinely offense-heavy, negative genuinely defense-first. */
const sideLean = (offense, defense) => offense - defense - DRAFTED_SIDE_BASELINE;

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
  for (const [side, weights] of [["offense", OFFENSE_WEIGHTS], ["defense", DEFENSE_WEIGHTS]]) {
    for (const [slot, w] of Object.entries(weights)) {
      const mine = entryForSlot(roster, slot);
      const theirs = entryForSlot(oppRoster, slot);
      if (!mine || !theirs) continue;
      const a = rateEntry(mine, ctx);
      const b = rateEntry(theirs, ctx);
      const delta = w * (a - b);
      if (side === "offense") offGap += delta;
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
    ? (offGap <= defGap ? "offense" : "defense")
    : (offGap >= defGap ? "offense" : "defense");
  const gap = side === "offense" ? offGap : defGap;
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

/**
 * THE SCOUTING LINE: one strength, one weakness, in football's own words.
 *
 * Built from the unit grades this same function already computed, never from a
 * list of canned sentences - a grade that praised a passing attack the roster
 * does not have is worse than no grade, because it is confidently wrong and a
 * player will draft against it next time.
 *
 * WHY GROUPS RATHER THAN SLOTS. "Your WR2 is your weakness" is not a scouting
 * report, it is a row from the grid directly above it. What a coach would say
 * names a UNIT OF THE TEAM - the receiving corps, the pass rush, the secondary
 * - so the slots are collapsed into the groups a football conversation
 * actually uses, and each group is scored by the same weights the simulation
 * consumes. A group is only reported when every slot behind it was drafted, so
 * an unfilled roster cannot produce a verdict about a unit that does not exist.
 *
 * DON'T CALL EVERYTHING ELITE. The adjective comes from the group's absolute
 * rating, not from its rank on this roster: the best group on a poor team is
 * not elite, it is merely the least of its problems, and saying otherwise is
 * the flattery that makes a grade worthless. The same rule runs the other way
 * - the weakest group on a strong roster is described as a relative soft spot
 * rather than as a hole.
 */
const SCOUTING_GROUPS = [
  // Offense.
  { key: "passing attack", side: "offense", slots: { QB: 0.62, WR1: 0.16, WR2: 0.12, TE: 0.10 } },
  { key: "receiving corps", side: "offense", slots: { WR1: 0.38, WR2: 0.27, WR3: 0.20, TE: 0.15 } },
  { key: "rushing attack", side: "offense", slots: { RB: 0.62, OL: 0.38 } },
  { key: "offensive line", side: "offense", slots: { OL: 1 } },
  // Defense.
  { key: "pass rush", side: "defense", slots: { DL: 0.68, LB: 0.32 } },
  { key: "run defense", side: "defense", slots: { DL: 0.45, LB: 0.55 } },
  { key: "linebackers", side: "defense", slots: { LB: 1 } },
  { key: "secondary", side: "defense", slots: { CB: 0.58, S: 0.42 } },
  // Special teams earns a mention only when it is genuinely the story, which
  // the caller enforces by requiring a wider margin of it - see scoutingLine.
  { key: "kicking game", side: "special", slots: { ST: 1 } },
];

/** How a rating is described out loud. Absolute, so the words keep meaning the
 * same thing across every roster ever graded. */
function scoutingAdjective(rating) {
  if (rating >= 0.86) return "elite";
  if (rating >= 0.72) return "strong";
  if (rating >= 0.58) return "solid";
  if (rating >= 0.42) return "average";
  if (rating >= 0.28) return "thin";
  return "poor";
}

function scoutingGroups(roster, ctx) {
  const scored = [];
  for (const group of SCOUTING_GROUPS) {
    let total = 0;
    let weight = 0;
    let complete = true;
    for (const [slot, w] of Object.entries(group.slots)) {
      const entry = entryForSlot(roster, slot);
      // A slot nobody drafted makes the whole group unreportable. Scoring it
      // from the slots that ARE filled would describe a unit that is not on the
      // field, which is the silent-failure pattern CLAUDE.md names.
      if (!entry) { complete = false; break; }
      total += w * rateEntry(entry, ctx);
      weight += w;
    }
    if (complete && weight > 0) scored.push({ ...group, rating: total / weight });
  }
  return scored;
}

/**
 * One sentence: the best thing about this roster and the worst.
 *
 * Special teams has to CLEAR the nearest real unit by a margin before it is
 * named, because a kicker is not what a football team is built around - it is
 * mentioned only when it is materially the story, which is the rule the brief
 * for this asked for.
 */
const SPECIAL_TEAMS_MARGIN = 0.12;

export function scoutingLine(roster, ctx) {
  const groups = scoutingGroups(roster, ctx);
  if (groups.length < 2) return null;

  const ranked = [...groups].sort((a, b) => b.rating - a.rating);
  const pickEnd = (list) => {
    const first = list[0];
    if (first.side !== "special") return first;
    // Special teams leads: only let it speak if it clears the next unit by the
    // margin. Otherwise it is a kicker being louder than a football team.
    const next = list.find((g) => g.side !== "special");
    if (!next) return first;
    return Math.abs(first.rating - next.rating) >= SPECIAL_TEAMS_MARGIN ? first : next;
  };

  const best = pickEnd(ranked);
  const worst = pickEnd([...ranked].reverse());
  // A roster whose best and worst resolve to the same group is one flat team;
  // one clause is the honest report rather than a contrived contrast.
  if (best.key === worst.key) {
    return `A ${scoutingAdjective(best.rating)} ${best.key} with no clear weak spot.`;
  }
  // ADJECTIVES ONLY, NEVER A VERB. Half these group names are plural
  // ("linebackers", "special teams") and half are singular ("pass rush",
  // "secondary"), so any sentence that conjugates against one gets the other
  // wrong - "linebackers is thin" was printed for real. Attributive phrasing
  // sidesteps agreement entirely and is how a scout would say it anyway.
  const weakness = worst.rating >= 0.42
    ? `${worst.key}, the relative soft spot`
    : `${scoutingAdjective(worst.rating)} ${worst.key}`;
  return `Strength: ${scoutingAdjective(best.rating)} ${best.key}. Weakness: ${weakness}.`;
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

  // Both halves count equally. A roster that drafted a superb offense and
  // ignored its defense has drafted half a team, not a great full roster.
  const raw = (offense + defense) / 2;
  const penalty = forfeits.length * 0.05;
  const score = Math.max(0, raw - penalty);
  const slots = Object.keys(OFFENSE_WEIGHTS).concat(Object.keys(DEFENSE_WEIGHTS));
  const letter = curveLetter(score, curveFor(ctx, slots));
  const offenseGrade = gradeOutOf100(offense);
  const defenseGrade = gradeOutOf100(defense);
  // Declared here rather than beside its first use: the grid tones below read
  // it, and a `const` used above its declaration is a crash rather than a
  // hoisted undefined.
  const lean = sideLean(offense, defense);
  const scouting = scoutingLine(roster, ctx);

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
  // where "Offense-heavy" is a restatement of the two rows at the top of the
  // card. It is also what scripts/verify-sport-contract.mjs looks for - a
  // grade handed an opponent must name one - so letting a generic clause push
  // it out would fail the build as well as the reader.
  const keyAdvice = [];
  const advice = [];
  const pct = (value) => `${Math.round(100 * value)}`;


  // THE WEAKEST UNIT, WHICH THE OLD DUMP MADE THE READER FIND. Printing
  // "DL 92 · LB 85 · CB 70 · S 68" asks a player to scan four numbers for the
  // smallest; naming it is the same information, shorter, and it is the pick
  // they can go and do something about.
  const rated = Object.keys(DEFENSE_WEIGHTS)
    .filter((slot) => Number.isFinite(defenseGroups[slot]))
    .map((slot) => ({ slot, rating: defenseGroups[slot] }));

  // EVERY PICK, NOT JUST THE TWO EXTREMES. The best and worst rows above answer
  // "which one should I look at"; they cannot answer "what did I actually get",
  // and that is the question a drafter asks first - they just spent twelve
  // picks and the card described two of them.
  //
  // The old comment on the weakest-unit row argued the opposite, that printing
  // "DL 59 · LB 94 · CB 96 · S 90" makes a reader scan for the smallest number.
  // That was right about the DUMP and wrong about the DATA. A run-on line of
  // separators is unreadable at 190px; a grid is not, and it reflows by column
  // instead of wrapping mid-value. So the numbers come back, laid out - see
  // gridNote in js/gradenotes.js.
  //
  // Offense and defense stay separate grids because they are the two halves the
  // card already scores at the top, and a twelve-chip block with no seam in it
  // is a table the eye has to parse rather than two shapes it can compare.
  const gridFor = (weights) =>
    Object.keys(weights)
      .map((slot) => ({ slot, entry: entryForSlot(roster, slot) }))
      .filter(({ entry }) => entry)
      .map(({ slot, entry }) => {
        const rating = rateEntry(entry, ctx);
        return {
          key: slot,
          value: pct(rating),
          // Only the ends are coloured. Tinting every chip by its rating turns
          // the block into a heat map, which reads as decoration rather than as
          // a verdict - the same reason a stat row colours its value and not
          // its label.
          //
          // ABSOLUTE, NOT RELATIVE TO THIS ROSTER. Marking each grid's own best
          // and worst would put a red chip on a roster where every unit is
          // strong, which is a lie about the pick - the weakest of eleven good
          // units is still good. The thresholds are what a rating MEANS: 0.70
          // is a unit that wins its matchup, 0.45 is one that loses it, and in
          // between is a unit that turns up. A roster can legitimately show
          // eleven green chips or none.
          tone: rating >= 0.70 ? "good" : rating <= 0.45 ? "bad" : "neutral",
        };
      });

  const offenseGrid = gridFor(OFFENSE_WEIGHTS);
  const defenseGrid = gridFor(DEFENSE_WEIGHTS);
  if (offenseGrid.length) {
    notes.push(gridNote("Offense", offenseGrid, pct(offense),
      lean >= 0 ? "good" : "neutral"));
  }
  if (defenseGrid.length) {
    notes.push(gridNote("Defense", defenseGrid, pct(defense),
      lean < 0 ? "good" : "neutral"));
  }

  if (forfeits.length) {
    notes.push(statNote("Slots empty", `${forfeits.length}`, "bad"));
  }

  // The identity read, as advice rather than as an observation: a drafter can
  // act on "you have to win this low-scoring" before kickoff, by picking the
  // gameplan that suits it.
  if (lean > 0.15) advice.push("Offense-heavy - your defense will give it back.");
  else if (lean < -0.15) advice.push("Defense-first - you need this game low-scoring.");
  if (forfeits.length) advice.push("Empty slots rate zero - never let the clock draft.");

  // Football's counterplay read, and until now it did not exist. NFL.draftAnalysis
  // accepted an opponent roster and dropped it on the floor, so the "how your
  // roster stacks against theirs" line was this same solo grade printed again -
  // believable output, which is why it survived so long.
  //
  // Units and individuals compare the same way here because rateEntry() already
  // returns one number for both: a secondary and a quarterback are not alike,
  // but "how good is this at its job" is the same question asked of each.
  /**
   * THE OPPONENT, AS THREE LETTERS AND NOTHING ELSE.
   *
   * This used to print the opponent's roster slot by slot: `decidingRead`
   * named the pick that beat you WITH BOTH RATINGS ("Worst pick: QB 45-92"),
   * and `matchupNotes` named their individual units and players ("Falcons OL
   * has the edge on your pass rush"). Read together those two are a scouting
   * report on a roster the player is about to play against and, in ranked,
   * has no business seeing: knowing their quarterback rates 92 and their
   * secondary 40 decides the gameplan before kickoff, and a gameplan chosen
   * against revealed information is not the choice the game is offering.
   *
   * So the opponent is summarised at exactly the altitude the player is
   * entitled to - how good they are overall and on each side of the ball,
   * which is what a team knows about its next opponent - and no lower. Their
   * per-slot grid, their worst pick and their individual matchups are all
   * gone. Ours are all still here: the asymmetry IS the feature.
   *
   * Nothing about the simulation changes; this is only what the card shows.
   */
  let opponent = null;
  if (oppRoster) {
    const oppForfeits = forfeitList(forfeitsOrOpts?.oppForfeits);
    const oppOffense = sideScore(oppRoster, OFFENSE_WEIGHTS, ctx);
    const oppDefense = sideScore(oppRoster, DEFENSE_WEIGHTS, ctx);
    const oppScore = Math.max(0, (oppOffense + oppDefense) / 2 - oppForfeits.length * 0.05);
    opponent = {
      score: oppScore,
      offense: oppOffense,
      defense: oppDefense,
      letter: curveLetter(oppScore, curveFor(ctx, slots)),
      offenseGrade: gradeOutOf100(oppOffense),
      defenseGrade: gradeOutOf100(oppDefense),
    };
    // The one comparative clause that survives, because it is built from the
    // aggregates above rather than from any pick of theirs: which side of the
    // ball you are behind on. That is a thing a team knows about its opponent.
    //
    // THE TWO EDGES ARE COMPARED WITH EACH OTHER, NOT WITH ZERO. An offense
    // rating and a defense rating are not on one scale - measured over bot
    // drafts, a drafted offense rates 0.50 and a drafted defense 0.69 - so
    // `offense - oppDefense < 0` is true of very nearly every roster ever
    // built, and the first version of this clause duly fired on all of them.
    // The DIFFERENCE between the two edges is scale-free, because the same
    // offset sits in both.
    // LIKE FOR LIKE. Your offense against THEIR OFFENSE, your defense against
    // theirs - both same-scale comparisons, so no baseline is needed and no
    // clause can fire on every roster the way the first version did.
    const offEdge = offense - oppOffense;
    const defEdge = defense - oppDefense;
    if (offEdge < -0.05 && offEdge < defEdge) {
      keyAdvice.push("They out-draft you on offense - your defense has to carry this.");
    } else if (defEdge < -0.05 && defEdge < offEdge) {
      keyAdvice.push("They out-draft you on defense - you will have to score to win.");
    }
  }

  return {
    letter,
    offenseGrade,
    defenseGrade,
    scouting,
    opponent,
    headline: lean > 0.15
      ? "Built to outscore people."
      : lean < -0.15
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
