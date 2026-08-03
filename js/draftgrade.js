// Draft grades: a letter and a sentence, handed out the moment a roster is
// finished and before a single minute is simulated.
//
// The point is feedback you can act on. A box score tells you that you lost;
// a grade tells you that the roster was always going to lose, and why - "B+
// because your defense is elite but your shooting held you back". Getting
// that BEFORE the game is what turns the next draft into a decision instead
// of a repeat.
//
// The grade is deliberately built on the same numbers the simulation itself
// uses (constructionMetrics/rosterTilt in engine.js), so it is a real
// prediction rather than a decoration. If the grade says your bench is thin,
// the engine is about to charge you for a thin bench.

import { constructionMetrics, rosterTilt, impact } from "./engine.js";
import { isBenchSlot, orderedRosterSlots } from "./constants.js";

// Weighted toward how the roster is BUILT rather than how good its players
// are. Talent still counts - a grade that ignored it would call a squad of
// scrubs perfect for being evenly bad - but it is the smallest term, because
// "picked the highest overall player available" is the habit this grade
// exists to argue with.
const WEIGHTS = { balance: 0.42, coverage: 0.22, versatility: 0.13, talent: 0.23 };

// Cut points, highest first. Tuned so an average roster lands in the C+/B-
// range and A+ genuinely requires balance, depth and versatility together.
const GRADES = [
  { min: 0.94, letter: "A+" },
  { min: 0.87, letter: "A" },
  { min: 0.81, letter: "A-" },
  { min: 0.75, letter: "B+" },
  { min: 0.68, letter: "B" },
  { min: 0.61, letter: "B-" },
  { min: 0.54, letter: "C+" },
  { min: 0.46, letter: "C" },
  { min: 0.38, letter: "C-" },
  { min: 0.3, letter: "D+" },
  { min: 0.22, letter: "D" },
  { min: 0.12, letter: "D-" },
  { min: 0, letter: "F" },
];

const CATEGORY_WORDS = {
  scoring: { strong: "your scoring is elite", weak: "your shooting held you back" },
  rebounding: { strong: "you own the glass", weak: "nobody rebounds" },
  playmaking: { strong: "the ball moves", weak: "there's no one to create" },
  defense: { strong: "your defense is elite", weak: "you can't get a stop" },
};

function letterFor(score) {
  return (GRADES.find((g) => score >= g.min) || GRADES[GRADES.length - 1]).letter;
}

/** The one player a rotation should be built around who isn't a starter -
 * "players who deserved more minutes should be recognized". Only flagged when
 * he genuinely outclasses the weakest starter, since a bench that's merely
 * decent isn't news. */
function benchStandout(roster) {
  const slots = orderedRosterSlots(roster);
  const bench = slots.filter((slot) => isBenchSlot(slot) || slot === "6TH");
  const starters = slots.filter((slot) => !isBenchSlot(slot) && slot !== "6TH");
  if (bench.length === 0 || starters.length === 0) return null;

  const best = bench.reduce((a, b) => (impact(roster[a]) >= impact(roster[b]) ? a : b));
  const worstStarter = starters.reduce((a, b) => (impact(roster[a]) <= impact(roster[b]) ? a : b));
  if (impact(roster[best]) <= impact(roster[worstStarter]) * 1.15) return null;
  return { slot: best, player: roster[best], overSlot: worstStarter, overPlayer: roster[worstStarter] };
}

/** Plain-English name for the shape a roster took, used in the grade blurb
 * and by the counterplay hint. */
export function buildStyleLabel(tilt) {
  if (tilt.size > 0.12 && tilt.size > tilt.space) return "a big, interior team";
  if (tilt.space > 0.12 && tilt.space > tilt.size) return "a perimeter, ball-movement team";
  if (tilt.size < -0.12 && tilt.space < -0.12) return "a thin roster on both ends";
  return "a balanced roster";
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
  const metrics = constructionMetrics(roster, datasetStats);
  const forfeits = (opts.forfeits || []).filter((slot) => roster[slot]);

  let score =
    WEIGHTS.balance * metrics.balance +
    WEIGHTS.coverage * metrics.coverage +
    WEIGHTS.versatility * metrics.versatility +
    WEIGHTS.talent * metrics.talent;

  // A roster with no bench never had a depth decision to make, so grading it
  // on depth would cap every Quick Play draft at a C no matter how well it
  // was drafted. Re-weight onto what it could actually control.
  if (!metrics.hasBench) {
    score =
      (WEIGHTS.balance * metrics.balance + WEIGHTS.talent * metrics.talent) /
      (WEIGHTS.balance + WEIGHTS.talent);
  }

  // Forfeits are a draft failure, not a simulation one, so the grade says so
  // as well - a third of a letter each.
  score = Math.max(0, score - 0.07 * forfeits.length);

  const letter = letterFor(score);
  const reasons = [];

  const strong = CATEGORY_WORDS[metrics.strongest];
  const weak = CATEGORY_WORDS[metrics.weakest];
  let headline;
  if (metrics.balance >= 0.8 && metrics.coverage >= 0.99) {
    headline = "No holes anywhere - every position backed up and nothing to attack.";
  } else if (strong && weak && metrics.strongest !== metrics.weakest) {
    headline = `${capitalize(strong.strong)}, but ${weak.weak}.`;
  } else if (weak) {
    headline = `${capitalize(weak.weak)}.`;
  } else {
    headline = "A serviceable roster with no strong identity.";
  }

  if (metrics.hasBench) {
    if (metrics.uncovered.length === 0) {
      reasons.push("Every position has a backup - nobody has to play all 48.");
    } else if (metrics.uncovered.length <= 2) {
      reasons.push(
        `No cover at ${metrics.uncovered.join(" or ")} - ${
          metrics.uncovered.length === 1
            ? "that starter has to play the whole game and tires late"
            : "those starters have to play the whole game and tire late"
        }.`
      );
    } else {
      reasons.push(
        `${metrics.uncovered.length} positions have no backup (${metrics.uncovered.join(
          ", "
        )}) - your starters wear down late.`
      );
    }

    if (metrics.versatility >= 0.6) {
      reasons.push("Your bench can cover more than one spot, so it plugs whichever hole opens up.");
    } else if (metrics.versatility <= 0.25) {
      reasons.push("Every bench player is a specialist - they all pile onto the same position.");
    }
  }

  if (metrics.talent >= 0.75 && metrics.balance <= 0.45) {
    reasons.push("Plenty of talent, but it's all pointed the same way - the best player available isn't always the best fit.");
  }

  if (opts.oppRoster) {
    const mine = rosterTilt(roster, datasetStats);
    const theirs = rosterTilt(opts.oppRoster, datasetStats);
    const read = counterRead(mine, theirs);
    if (read) reasons.push(read);
  }

  if (forfeits.length > 0) {
    // Naming the slots is useful when it's one or two you can go and think
    // about; at ten it's a wall of BENCH3, BENCH4, BENCH5 saying nothing the
    // count didn't already say.
    const named = forfeits.length <= 3 ? ` (${forfeits.join(", ")})` : "";
    reasons.push(
      `${forfeits.length} pick${forfeits.length === 1 ? "" : "s"} went to the clock${named} - ` +
        `the game drafted for you and it shows.`
    );
  }

  return { letter, score, headline, reasons, metrics, forfeits };
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

/** The rotation nudge that goes with a grade: who on the bench earned real
 * minutes. Separate from gradeDraft so the rotation screen can show it at the
 * moment it's actionable. */
export function rotationHint(roster) {
  const standout = benchStandout(roster);
  if (!standout) return null;
  return `${standout.player.name} came off your bench better than ${standout.overPlayer.name} at ${standout.overSlot} - he's worth real minutes.`;
}
