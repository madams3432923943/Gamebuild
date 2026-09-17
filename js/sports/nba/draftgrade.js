// Draft grades: a letter and a sentence, handed out the moment a roster is
// finished and before a single minute is simulated.
//
// The point is feedback you can act on. A box score tells you that you lost;
// a grade tells you that the roster was always going to lose, and why - "B+
// because your defense is elite but nobody can create a shot". Getting that
// BEFORE the game is what turns the next draft into a decision instead of a
// repeat.
//
// WHAT CHANGED, AND WHY THE OLD GRADE HAD TO GO
//
// It read four numbers - balance, coverage, versatility, talent - summed them
// with weights, and took a PERCENTILE against 240 rosters sampled uniformly
// from the dataset. Both halves were wrong in the same direction.
//
// The percentile first, because it is the larger fault and football already
// fixed it (see the note above GRADE_BREAKPOINTS in ./constants.js). A draft
// does not produce uniform rosters; it produces good ones, because a drafter
// picks the best name a rolled squad offers and so does the bot. A real roster
// therefore sat in the top few percent of a random-assembly distribution almost
// by construction and collected an A or an A+ for doing nothing in particular.
// The reported screen graded A+ on 81 talent, 74 balance, no cover at point
// guard and a 41% hole at small forward - a letter and an analysis, printed
// two inches apart, disagreeing about the same roster.
//
// The four numbers second. `versatility` was the share of the bench listed at
// more than one position, and the shipped dataset lists exactly one position
// for 10,289 of its 10,290 rows - so it was 0 for essentially every roster ever
// drafted, and a seventh of the score was a constant. `balance` read the
// weakest of four broad categories and nothing read what those categories are
// made of: a roster could have no shooting, no rim protection and no secondary
// creator and score full marks for "scoring" on the strength of two volume
// scorers.
//
// So the grade now reads CAPABILITIES - the things a basketball team either has
// or does not - and scores construction the way football does: talent sets the
// level and what is missing takes away from it. A roster of great players built
// badly is priced as exactly that.

import { impact, rosterTilt } from "./engine.js";
import {
  isBenchSlot,
  orderedRosterSlots,
  basePosition,
  STARTER_SLOTS,
  CAPABILITY_FLOOR,
  CAPABILITY_CEILING,
  TALENT_FLOOR,
  TALENT_CEILING,
  CAPABILITY_SOFT_SPOT,
  CAPABILITY_SPREAD_TOLERANCE,
  TOP_HEAVY_TOLERANCE,
  GRADE_WEIGHTS,
  MAX_CONSTRUCTION_PENALTY,
  FORFEIT_GRADE_PENALTY,
  GRADE_BREAKPOINTS,
} from "./constants.js";
import { matchupNotes } from "../../matchups.js";
import { statNote, adviceNote } from "../../gradenotes.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** True shooting, or null for a row with no shooting profile.
 *
 * NULL RATHER THAN A PLAUSIBLE DEFAULT. Some seasons in the dataset carry no
 * attempt columns at all, and scoring those players as league-average shooters
 * would be exactly the silent failure CLAUDE.md names - a believable number
 * standing in for a fact nobody has. They are left out of the mean instead, and
 * a roster where NOBODY has a shooting profile simply does not get the row. */
function trueShooting(player) {
  const fga = Number(player?.fga);
  if (!Number.isFinite(fga) || fga <= 0) return null;
  const fta = Number(player.fta) || 0;
  return player.ppg / (2 * (fga + 0.44 * fta));
}

/** Three-pointers made a game: the volume and the accuracy together, which is
 * what spacing actually is. A 42% shooter who takes one a game stretches
 * nobody's defense, and neither does a 28% shooter who takes eight. */
function spacing(player) {
  const tpa = Number(player?.tpa);
  const tpp = Number(player?.tpp);
  if (!Number.isFinite(tpa) || !Number.isFinite(tpp)) return null;
  return tpa * tpp;
}

/** Ball security: assists per turnover.
 *
 * RAW TURNOVERS ARE A USAGE STATISTIC, NOT A FAULT, and reading them as one
 * inverted the whole category. Measured over 60 bot drafts, a hard bot's roster
 * scored 0.03 on "care" and an easy bot's scored 0.96 - because good players
 * handle the ball more and therefore lose it more. The card was telling the best
 * rosters in the game that they gave the ball away. A ratio asks the question
 * that was meant: how much does this roster produce for what it gives up. */
function ballSecurity(player) {
  const tov = Number(player?.tov);
  if (!Number.isFinite(tov) || tov <= 0) return null;
  return player.apg / tov;
}

/** Shot creation: scoring plus the passing that produces someone else's. The
 * 1.5 on assists is not a points conversion - it is the weighting that stops a
 * pure volume scorer from reading as a creator, which is the distinction the
 * "no one to create" complaint is about. */
const creation = (player) => player.ppg + 1.5 * player.apg;

/**
 * THE THINGS A BASKETBALL TEAM EITHER HAS OR DOES NOT.
 *
 * Eight reads, each a per-player quantity the dataset actually carries. They
 * are deliberately narrower than the four categories the old grade used: a
 * roster with two volume scorers and no shooting, no passing and no rim
 * protection scored full marks for "scoring" and the card never mentioned the
 * other three.
 *
 * `label` is a chip on the card and has to stay chip-short - see gridNote in
 * js/gradenotes.js for the measurements behind that.
 */
const CAPABILITIES = [
  { key: "scoring", label: "Score", of: (p) => p.ppg,
    strong: "your scoring is elite", weak: "there aren't enough points here" },
  { key: "efficiency", label: "Eff", of: trueShooting,
    strong: "you score efficiently", weak: "your shots are hard ones" },
  { key: "spacing", label: "Space", of: spacing,
    strong: "the floor is wide open", weak: "nobody stretches the floor" },
  { key: "playmaking", label: "Pass", of: (p) => p.apg,
    strong: "the ball moves", weak: "there's no one to create" },
  { key: "security", label: "Care", of: ballSecurity,
    strong: "you look after the ball", weak: "you give the ball away" },
  { key: "rebounding", label: "Reb", of: (p) => p.rpg,
    strong: "you own the glass", weak: "nobody rebounds" },
  { key: "rimProtection", label: "Rim", of: (p) => p.bpg,
    strong: "the rim is protected", weak: "the rim is unguarded" },
  { key: "perimeter", label: "Ball D", of: (p) => p.spg,
    strong: "you hound the ball", weak: "you can't pressure the ball" },
  // Read off the roster's two best rather than off everybody - see
  // rosterCapabilities. A team needs someone who can get a shot, not five
  // players who are all a bit above average at it.
  { key: "creation", label: "Create", of: creation, topTwo: true,
    strong: "you have a go-to scorer", weak: "there's no one to go to" },
];

/** Anyone who is not one of the five who start.
 *
 * THE 6TH MAN IS A RESERVE and `isBenchSlot` does not think so - it matches the
 * BENCH slots a Ranked roster has, and the legacy 6-man shape spells its one
 * reserve "6TH". Reading it as a starter gave that shape six starters and no
 * bench. Every other module that has to make this distinction spells it the same
 * way (see renderRotationPicker in js/ui/strategy.js). */
const isReserve = (slot) => isBenchSlot(slot) || slot === "6TH";

/** A starter is on the floor about twice as long as a reserve, so a roster read
 * that averaged all ten equally would let five good bench players paper over a
 * bad starting five. The weights are a proxy for minutes, not the rotation the
 * player is about to set - the grade is handed out before that exists. */
const slotWeight = (slot) => (isReserve(slot) ? 0.45 : 1);

/**
 * WHAT AN AVERAGE PLAYER IS, MEASURED OFF THE DATASET IN PLAY.
 *
 * Every capability is a ratio against one of these, so the grade means the same
 * thing after a dataset change as before it - which is the property the old
 * fixed cutoffs kept losing - and which the percentile curve that replaced them
 * lost again, by making the same argument and then answering it with the wrong
 * reference population (uniform samples of the dataset, not drafted rosters).
 *
 * Memoised on the stats object, because it is a full pass over ten thousand
 * rows and the answer only changes when the data does.
 */
function baselineFor(datasetStats) {
  if (datasetStats.__nbaGradeBaseline === undefined) {
    const all = datasetStats.__allEntries || [];
    datasetStats.__nbaGradeBaseline = all.length ? measureBaseline(all) : null;
  }
  return datasetStats.__nbaGradeBaseline;
}

function measureBaseline(players) {
  const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

  // THE TOP QUARTILE BY IMPACT - "what a drafted player looks like" - and NOT
  // the dataset's mean. The mean includes every deep reserve who ever appeared
  // in eleven games, and a drafted roster clears it on every category by
  // construction: measured over 60 bot drafts, even an EASY bot's roster came
  // out at 0.8-1.0x the mean and a hard bot's at 1.2-1.9x, so the scale
  // saturated and good drafts could not be told from great ones. Against this
  // reference the same rosters spread 0.42 to 1.26.
  const byImpact = [...players].sort((a, b) => impact(b) - impact(a));
  const drafted = byImpact.slice(0, Math.max(1, Math.round(byImpact.length * 0.25)));

  const means = {};
  for (const cap of CAPABILITIES) {
    means[cap.key] = mean(drafted.map(cap.of).filter((v) => Number.isFinite(v)));
  }

  // THE CREATOR BASELINE IS THE TOP DECILE, because the roster side of this
  // ratio is a roster's own two best. Comparing a team's best creator against
  // the average of every rotation player in the pool would rate every roster
  // ever drafted as elite at it.
  const creators = players.map(creation).filter(Number.isFinite).sort((a, b) => b - a);
  const decile = creators.slice(0, Math.max(1, Math.round(creators.length * 0.1)));
  means.creation = mean(decile);

  // ONE TALENT BASELINE for both halves of the roster - see TALENT_FLOOR in
  // ./constants.js for why the two-band version had to go.
  const rated = byImpact.map(impact).filter(Number.isFinite);
  const top = rated.slice(0, Math.max(1, Math.round(rated.length * 0.15)));
  return { means, player: mean(top) || 1 };
}

/** A ratio onto the 0-1 the grade works in. See CAPABILITY_FLOOR. */
const normalize = (ratio) =>
  clamp((ratio - CAPABILITY_FLOOR) / (CAPABILITY_CEILING - CAPABILITY_FLOOR), 0, 1);

/**
 * Every capability this roster can actually be read for, 0-1.
 *
 * A capability whose baseline the dataset cannot supply is OMITTED rather than
 * scored 0.5. A missing value that defaults to something plausible is the
 * silent failure CLAUDE.md names, and this one has a history: `versatility` was
 * 0 for every roster ever drafted because the dataset does not carry second
 * positions, and a seventh of the grade was a constant nobody could see.
 */
function rosterCapabilities(roster, datasetStats) {
  const baseline = baselineFor(datasetStats);
  if (!baseline) return {};
  const slots = orderedRosterSlots(roster);
  const out = {};

  for (const cap of CAPABILITIES) {
    const base = baseline.means[cap.key];
    if (!Number.isFinite(base) || base <= 0) continue;

    let value;
    if (cap.topTwo) {
      const best = slots
        .map((slot) => cap.of(roster[slot]))
        .filter(Number.isFinite)
        .sort((a, b) => b - a)
        .slice(0, 2);
      if (!best.length) continue;
      value = best.reduce((s, v) => s + v, 0) / best.length;
    } else {
      let total = 0;
      let weight = 0;
      for (const slot of slots) {
        const v = cap.of(roster[slot]);
        if (!Number.isFinite(v)) continue;
        total += slotWeight(slot) * v;
        weight += slotWeight(slot);
      }
      if (weight <= 0) continue;
      value = total / weight;
    }

    out[cap.key] = normalize(value / base);
  }
  return out;
}

/** How many things the card may say in total, rows and clause together. Five,
 * because that is what a reader takes in at a glance under a running clock -
 * and because every larger number this card has been given (eleven, then eight,
 * then six) was reported as a wall. */
const NOTE_BUDGET = 5;

/** Where a capability stops being ordinary and becomes something the roster is
 * built on. The mirror of CAPABILITY_SOFT_SPOT, and the other half of what the
 * card considers worth a chip. */
const STRENGTH = 0.75;

/** How far below the soft-spot line a capability sits, as a share of it. */
const shortfall = (value) => Math.max(0, CAPABILITY_SOFT_SPOT - value) / CAPABILITY_SOFT_SPOT;

/**
 * Everything the grade reads, in one pass.
 *
 * Deliberately NOT engine.js's constructionMetrics. That function feeds
 * constructionFactor, which multiplies team points during a simulation, and it
 * is vendored into the Edge Function for parity - so every change to what a
 * GRADE reads would be a change to what the SERVER simulates. The two questions
 * are different anyway: the engine asks how a roster performs, this asks how
 * well it was built.
 */
export function gradeMetrics(roster, datasetStats) {
  const slots = orderedRosterSlots(roster);
  const starters = slots.filter((slot) => !isReserve(slot));
  const bench = slots.filter(isReserve);
  const hasBench = bench.length > 0;
  // COVERAGE IS ONLY A DECISION SOME ROSTER SHAPES HAVE. Charging "four of five
  // positions have no cover" against a 6-man roster with exactly one reserve
  // marks it down for a shape it was dealt - the same mistake the old grade
  // made in reverse when it capped every Quick Play draft at a C for having no
  // depth to grade. Derived from the roster, never assumed.
  const gradesCoverage = bench.length >= STARTER_SLOTS.length;
  const baseline = baselineFor(datasetStats);
  const capabilities = rosterCapabilities(roster, datasetStats);
  const keys = Object.keys(capabilities);

  // Which starting positions have a second body behind them. Read off the
  // bench players' own listed positions rather than off slot names, because a
  // bench slot has no position of its own - BENCH3 is a draft-order accident.
  const covered = new Set();
  for (const slot of bench) {
    for (const pos of roster[slot]?.pos || []) {
      if (STARTER_SLOTS.includes(pos)) covered.add(pos);
    }
  }
  const uncovered = gradesCoverage ? STARTER_SLOTS.filter((pos) => !covered.has(pos)) : [];

  const mean = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0);
  const talentOf = (group, base) =>
    group.length && base > 0
      ? clamp((mean(group.map((slot) => impact(roster[slot]))) / base - TALENT_FLOOR) /
          (TALENT_CEILING - TALENT_FLOOR), 0, 1)
      : 0;

  const starterTalent = baseline ? talentOf(starters, baseline.player) : 0;
  const benchTalent = baseline && hasBench ? talentOf(bench, baseline.player) : 0;
  const talent = hasBench ? 0.68 * starterTalent + 0.32 * benchTalent : starterTalent;

  // A TWO-MAN TEAM, as a multiple of an even split rather than a flat share -
  // see TOP_HEAVY_TOLERANCE for why roster shape makes the flat version
  // meaningless.
  const rated = slots.map((slot) => impact(roster[slot])).filter(Number.isFinite).sort((a, b) => b - a);
  const total = rated.reduce((s, v) => s + v, 0);
  const topTwoShare = total > 0 ? rated.slice(0, 2).reduce((s, v) => s + v, 0) / total : 0;
  const evenSplit = rated.length ? 2 / rated.length : 1;
  const topHeavy = clamp(
    (topTwoShare - evenSplit * TOP_HEAVY_TOLERANCE) / Math.max(1e-6, 1 - evenSplit * TOP_HEAVY_TOLERANCE),
    0,
    1
  );

  const values = keys.map((k) => capabilities[k]);
  const worstKey = keys.length ? keys.reduce((a, b) => (capabilities[a] <= capabilities[b] ? a : b)) : null;
  const bestKey = keys.length ? keys.reduce((a, b) => (capabilities[a] >= capabilities[b] ? a : b)) : null;

  // DEPTH AND BREADTH, because one hole and four are not the same roster and
  // the worst capability alone cannot tell them apart - the same split
  // football's constructionScore makes, and for the same reported reason.
  const deepest = values.length ? Math.max(...values.map(shortfall)) : 0;
  const spread = values.length ? mean(values.map(shortfall)) : 0;
  const hole = 0.45 * deepest + 0.55 * spread;
  const chasm = values.length
    ? Math.max(0, Math.max(...values) - Math.min(...values) - CAPABILITY_SPREAD_TOLERANCE)
    : 0;
  const coverGap = gradesCoverage ? uncovered.length / STARTER_SLOTS.length : 0;

  const penalty = Math.min(
    MAX_CONSTRUCTION_PENALTY,
    GRADE_WEIGHTS.hole * hole +
      GRADE_WEIGHTS.coverage * coverGap +
      GRADE_WEIGHTS.topHeavy * topHeavy +
      GRADE_WEIGHTS.spread * chasm
  );

  return {
    capabilities,
    talent,
    starterTalent,
    benchTalent,
    hasBench,
    gradesCoverage,
    uncovered,
    topHeavy,
    topTwoShare,
    hole,
    chasm,
    penalty,
    weakest: worstKey,
    strongest: bestKey,
    // The construction score itself: talent, scaled by what is missing.
    score: clamp(talent * (1 - penalty), 0, 1),
  };
}

/** The letter, from breakpoints solved against real drafts. */
function letterForScore(score) {
  for (const [floor, letter] of GRADE_BREAKPOINTS) {
    if (score >= floor) return letter;
  }
  return "F";
}

/**
 * Grades a finished roster.
 *
 * @param roster the drafted roster (slot -> player)
 * @param datasetStats from computeDatasetStats()
 * @param opts.oppRoster the opponent's roster, if it's already known - adds
 *   the counterplay read ("you drafted small into their size")
 * @param opts.forfeits slots the pick clock filled, which no grade should
 *   quietly forgive
 * @returns {{letter, score, headline, reasons: string[], metrics}}
 */
export function gradeDraft(roster, datasetStats, opts = {}) {
  const metrics = gradeMetrics(roster, datasetStats);
  const forfeits = (opts.forfeits || []).filter((slot) => roster[slot]);

  // Forfeits are a draft failure, not a simulation one, so the grade says so as
  // well. Subtracted after construction rather than folded into it: a pick the
  // clock made is not a thing the roster does badly, it is a pick nobody made.
  const score = Math.max(0, metrics.score - FORFEIT_GRADE_PENALTY * forfeits.length);
  const letter = letterForScore(score);

  // ROWS AND CLAUSES, NOT SENTENCES. Measured on a real bot draft these ran
  // 54-91 characters each, seven of them, on a card body about 27 characters
  // wide on a phone. See js/gradenotes.js.
  // THREE BUCKETS, BECAUSE THE CARD CANNOT HOLD EVERYTHING and what it drops
  // matters. `always` is the reading of the roster itself; `optional` is
  // everything else, IN PRIORITY ORDER, and gets whatever rows are left. A flat
  // list appended in the order the code happens to compute things put the
  // opponent matchup rows last, so the two most useful rows on the card - where
  // they beat you, where you beat them - were the two the cap cut off.
  const always = [];
  const optional = [];
  // Only two clauses fit on the card, and a clause naming the opponent beats a
  // restatement of the rows above it - so opponent advice is collected
  // separately and goes first.
  const keyAdvice = [];
  const advice = [];

  const strong = CAPABILITIES.find((c) => c.key === metrics.strongest);
  const weak = CAPABILITIES.find((c) => c.key === metrics.weakest);
  const headline = headlineFor(metrics, strong, weak);

  const pct = (value) => `${Math.round(100 * value)}`;
  always.push(statNote("Starters", pct(metrics.starterTalent), metrics.starterTalent >= 0.6 ? "good" : "bad"));
  if (metrics.hasBench) {
    // BESIDE THE STARTERS, ON THE SAME RULER. This is what the rotation nudge
    // was reaching for and said as an instruction: how much the roster drops
    // when the second unit comes on. As a row it is a fact about the team the
    // player built, not a demand that they rebuild it.
    always.push(statNote("Bench", pct(metrics.benchTalent), metrics.benchTalent >= 0.5 ? "good" : "bad"));
  }

  // ONE ROW FOR THE THING THIS ROSTER CANNOT DO.
  //
  // This was a grid of chips - nine of them first, then the five with a verdict
  // attached - and both were reported as too much. The chip grid is a second
  // layout inside a card that is already a list, with its own heading, its own
  // alignment and its own number floating off to the right; five of those chips
  // is not five facts, it is a table.
  //
  // What the grid was for survives as one row. The headline already says the
  // weakness in words ("nobody stretches the floor"); this puts the number next
  // to it, which is the half a sentence cannot carry. Everything else the grid
  // showed was a capability sitting in the middle of its range, which is the
  // absence of news, and the letter itself is the summary of all nine.
  // `weak`, not a second lookup of the same capability: the headline is built
  // from it a few lines above, and two independent reads of "the weakest thing
  // this roster does" are two things that can drift apart.
  if (weak && metrics.weakest in metrics.capabilities) {
    const value = metrics.capabilities[metrics.weakest];
    always.push(statNote(weak.label, pct(value), value <= CAPABILITY_SOFT_SPOT ? "bad" : "neutral"));
  }

  // A pick the clock made is the one thing here the player can see they did
  // wrong, so it outranks every other optional row.
  if (forfeits.length > 0) {
    optional.push(statNote(
      "Clock drafted",
      forfeits.length <= 3 ? forfeits.join(", ") : `${forfeits.length} picks`,
      "bad"
    ));
    advice.push("Picks that ran out of clock cost you a letter.");
  }

  const uncovered = [];
  if (metrics.gradesCoverage && metrics.uncovered.length > 0) {
    const short = metrics.uncovered.length <= 2
      ? metrics.uncovered.join(", ")
      : `${metrics.uncovered.length} spots`;
    uncovered.push(statNote("No cover at", short, "bad"));
    advice.push("Those starters play all 48 and tire late.");
  } else if (metrics.gradesCoverage) {
    uncovered.push(statNote("Bench cover", "complete", "good"));
  }

  const carried = [];
  if (metrics.topHeavy > 0.25) {
    carried.push(statNote("Top two carry", `${Math.round(100 * metrics.topTwoShare)}%`, "bad"));
    advice.push("Two players are carrying this roster.");
  }

  const matchups = [];
  if (opts.oppRoster) {
    // Two readings of the same board, and they answer different questions.
    // counterRead is about SHAPE - "they are big, you are small" - which is
    // what the simulation's counterFactor actually multiplies by. The matchup
    // lines are about PEOPLE, and they are the ones a drafter can act on:
    // knowing their small forward eats yours tells you where to send help.
    const read = counterRead(rosterTilt(roster, datasetStats), rosterTilt(opts.oppRoster, datasetStats));
    if (read) keyAdvice.push(read);

    for (const note of matchupNotes(roster, opts.oppRoster, {
      rate: impact,
      // "SF", not "SF2" - the bench slot's number is a roster-shape detail,
      // and a row about a position should name the position.
      label: basePosition,
      // STARTERS ONLY. A bench is deliberately not position-locked (see
      // STARTER_SLOTS in ./constants.js), so BENCH1 is a draft-order accident:
      // my BENCH1 does not guard theirs, and comparing the two compares
      // nothing. basePosition also returns null for a bench slot, which the old
      // prose interpolated straight into the sentence - the card really did
      // read "Their null Damian Lillard".
      slots: orderedRosterSlots(roster).filter((slot) => !isReserve(slot)),
    })) {
      if (note.kind === "advice") keyAdvice.push(note.text);
      else matchups.push(note);
    }
  }

  // The worst matchup first - the one you can still do something about with a
  // rotation, a gameplan or a defensive assignment - then what the roster
  // cannot cover, then your own best matchup, then the two-man-team read.
  optional.push(matchups[0], ...uncovered, ...matchups.slice(1), ...carried);

  return {
    letter,
    score,
    headline,
    // Numbers, then the clauses about them, each capped - see the NFL grade for
    // the same reasoning. Eleven notes is a screen; six rows and two clauses is
    // a card.
    // FIVE THINGS, AND THE CLAUSE IS ONE OF THEM.
    //
    // It was six rows and two clauses, then five and one, and the card was still
    // reported as messy. The cap is the only thing keeping a grade that knows
    // nine things about a roster from saying all nine, so it is now a cap on the
    // WHOLE card rather than on the rows alone: three facts about the roster
    // (starters, bench, the thing it cannot do), whatever ranks highest of what
    // is left, and one clause. What survives is ranked, never truncated
    // arbitrarily - see `optional`.
    reasons: (() => {
      const clause = [...keyAdvice, ...advice].slice(0, 1).map(adviceNote);
      const room = Math.max(0, NOTE_BUDGET - always.length - clause.length);
      return [...always, ...optional.filter(Boolean).slice(0, room), ...clause];
    })(),
    metrics,
    forfeits,
  };
}

/**
 * THE HEADLINE HAS TO AGREE WITH THE LETTER.
 *
 * "You own the glass, but there's no one to create" printed under an A+ is the
 * complaint that started this work, and it was not a wording problem - the
 * letter and the sentence were reading different things. They read the same
 * capabilities now, so the only way to keep them consistent is to let the
 * SEVERITY of what is missing choose the sentence: a roster with a genuine hole
 * says so first, and a roster with nothing missing is allowed to say that.
 */
function headlineFor(metrics, strong, weak) {
  const worst = weak ? metrics.capabilities[weak.key] : 1;
  const best = strong ? metrics.capabilities[strong.key] : 0;
  if (!strong || !weak) return "A serviceable roster with no strong identity.";

  const deep = CAPABILITY_SOFT_SPOT * 0.6;
  const holes = Object.values(metrics.capabilities).filter((v) => v <= deep).length;

  // THREE HOLES IS NOT ONE HOLE, and naming only the worst of them reads as a
  // roster with a single fixable flaw. A card that says "there aren't enough
  // points here" about a roster that also cannot pass, protect the rim or
  // create a shot has told the player about a fifth of what is wrong.
  if (holes >= 3) return `${capitalize(weak.weak)}, and it is not the only hole.`;

  if (worst <= deep) {
    // A hole this deep is the story. WHICH story depends on the rest of the
    // roster, though, and the first version of this got that wrong twice: it
    // told a roster strong at eight things out of nine that "nothing else on
    // this roster fixes that", and it opened a D- card with "you score
    // efficiently" because efficiency was the only thing that roster did at
    // all. The flattering form needs the roster to be good in general, not just
    // to have one number above the others.
    if (metrics.talent >= 0.45 && best >= 0.7) {
      return `${capitalize(strong.strong)}, but ${weak.weak} - that is where they will aim.`;
    }
    // ONE REAL STRENGTH AND LITTLE ELSE. Without this branch a roster rating
    // 100 for spacing and under 40 for everything else was told that "nothing
    // else on this roster fixes that" - with the 100 printed two rows below, in
    // the grid, contradicting it.
    if (best >= STRENGTH) return `${capitalize(strong.strong)} - and not much else.`;
    return `${capitalize(weak.weak)} - and nothing else on this roster fixes that.`;
  }
  if (worst >= 0.6 && best >= 0.75) {
    return "No holes anywhere - nothing on this roster is a soft spot.";
  }
  if (strong.key !== weak.key && best >= 0.55) {
    return `${capitalize(strong.strong)}, but ${weak.weak}.`;
  }
  return `${capitalize(weak.weak)}.`;
}

/** The counterplay sentence: did this roster attack the opponent's shape or
 * mirror it? Returns null when neither side committed to anything, since
 * "you both drafted balanced teams" isn't a read worth printing. */
function counterRead(mine, theirs) {
  const theyAreBig = theirs.size > 0.1 && theirs.size > theirs.space;
  const theyAreSmall = theirs.space > 0.1 && theirs.space > theirs.size;

  if (theyAreBig && mine.space > theirs.space) {
    return "They drafted size and you drafted spacing - their bigs have to defend the perimeter.";
  }
  if (theyAreBig && mine.size >= theirs.size) {
    return "You matched their size instead of stretching them out - it's their game on their terms.";
  }
  if (theyAreSmall && mine.size > theirs.size) {
    return "They went small and you went big - punish them inside.";
  }
  if (theyAreSmall && mine.space >= theirs.space) {
    return "You mirrored their small-ball look, so neither side has anywhere to attack.";
  }
  return null;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * WHY THIS RETURNS NOTHING, AND IS STILL HERE.
 *
 * It used to read "Start Irving over Malone at PF" - the best bench player
 * named against the weakest starter - and it was shown on the screen where the
 * player sets their rotation, under a card grading the roster they had just
 * finished building. Two things were wrong with it.
 *
 * The small one: a drafted roster's positions are not a decision the rotation
 * screen can revisit. Malone is at PF because he was drafted into PF; that
 * screen assigns MINUTES, so "start him over" named a control that does not
 * exist on it.
 *
 * The larger one is the whole point of a post-draft analysis. The player has
 * already made their choices by the time they see this card. An analysis exists
 * to tell them what those choices ADD UP TO - where the lineup they picked is
 * strong, where an opponent will aim at it - not to re-make decisions that are
 * already locked. Everything this sentence was reaching for is now on the card
 * as a reading of the roster they actually built: the bench's own rating sits
 * beside the starters' as a row, and the capability grid says what the lineup
 * can and cannot do.
 *
 * The hook stays because js/main.js and the sport contract both call it, and
 * because football answers it the same way for the same reason (see
 * js/sports/nfl/index.js). A sport with a genuinely actionable rotation nudge
 * may fill it in again; a sport without one returns null rather than inventing
 * an instruction.
 */
export function rotationHint() {
  return null;
}
