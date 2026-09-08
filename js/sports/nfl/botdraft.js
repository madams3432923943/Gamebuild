// WHAT A PRACTICE DIFFICULTY MEANS IN FOOTBALL.
//
// The shared bot picks a difficulty WINDOW over one ranked board (see
// difficultyWindow in js/draft.js): Easy takes from the bottom of whatever is
// on offer, Hard from the top. One ranking, one target, both sides of the ball
// treated as the same list. That is the right shape for basketball, where a
// roster is five interchangeable-ish scorers, and the wrong one for football,
// where a team is an offense and a defense and the interesting difficulty
// question is which of the two the bot is allowed to be good at.
//
// So football answers the difficulty question PER POSITION GROUP:
//
//   EASY    weak everywhere. A beginner should be able to win while still
//           learning who the players are.
//   MEDIUM  a real offense - competent starters, not MVP seasons - in front of
//           a deliberately soft defense. The identity is "you can put up
//           points and so can it", which is a more fun game than a roster that
//           is uniformly average.
//   HARD    good on both sides. You cannot draft a great offense, ignore your
//           defense, and win.
//
// NOTHING HERE IS A GAMEPLAY BONUS. Every number below is a TARGET RATING for
// a pick, read through the same public js/sports/nfl/units.js rating the draft
// board shows the human and the same eligibility rules the human drafts under.
// The bot sees no future round, rerolls nothing, and the simulation is never
// told which difficulty was chosen - scripts/verify-mode-rules.mjs asserts
// that structurally and behaviourally, and
// scripts/verify-nfl-practice-difficulty.mjs measures the rosters that come
// out.
//
// WHY A TARGET RATING RATHER THAN A SLICE OF THE BOARD.
//
// Measured over the shipped dataset, an average rolled squad offers about 24
// distinct offensive candidates and only about 3 defensive ones - a squad is a
// team-era, and a team-era has exactly one cornerback unit, one line, one
// safety group. But each of those units appears once per SEASON in the era
// (about 8.6 rows), and those seasons spread from roughly 0.24 to 0.76 in
// rating. So the quality lever on defense is not "which of the defenses on the
// board" - there is one - it is WHICH SEASON OF IT, and a slice of a
// board ranked by distinct player cannot express that at all.
//
// A target rating can. Every pick is weighted by how close it lands to the
// target for its position group, which reaches season rows, keeps the pick
// legal by construction, and stays honest on a squad that has nothing near the
// target: the closest thing available simply wins, rather than the bot
// refusing to fill a slot.

/** How far off target a pick can drift before it stops being drawn, as a
 * standard deviation on each side of the target.
 *
 * TWO SIDES BECAUSE THE TWO MISTAKES ARE NOT THE SAME MISTAKE. A Medium bot
 * that lands under its target has drafted a slightly worse starter, which is
 * within its identity; one that lands well over it has drafted a superstar,
 * which is exactly the thing Medium is defined by not doing. So `above` is
 * tighter than `below` everywhere the target is not already at the top.
 */
const DEFAULT_SPREAD = { below: 0.14, above: 0.10 };

const target = (rating, spread = {}) => ({
  rating,
  below: spread.below ?? DEFAULT_SPREAD.below,
  above: spread.above ?? DEFAULT_SPREAD.above,
});

// The quality tiers, in the rating space the draft board already uses:
// a percentile among others at the same position (js/sports/nfl/units.js), so
// 0.85 means the same "top of his position" for a cornerback unit as for a
// quarterback and no per-position raw thresholds are needed.
//
// The numbers are chosen against what a squad ACTUALLY OFFERS, measured over
// the shipped dataset rather than assumed: averaged across squads, the worst
// row at a given slot sits near 0.13-0.28 and the best near 0.73-0.91. A
// target outside that range is not a harder or an easier bot, it is a target
// the board can never meet, and every pick would collapse onto the same
// extreme row - which is also how variance dies.
const TIERS = {
  // Bottom of what the board offers. Legal, complete, and comfortably beatable.
  weak: target(0.24, { below: 0.16, above: 0.09 }),
  // Below-average starters. Functional, never frightening - Medium's defense.
  soft: target(0.36, { below: 0.14, above: 0.10 }),
  // The middle of the league, which is where a kicker sits on Medium.
  average: target(0.52),
  // A recognisable starter having a good season. Above average, short of a
  // year anybody would call elite: `above` is deliberately the tightest in the
  // table, because Medium's whole identity is an offense that moves the ball
  // without being stacked.
  starter: target(0.70, { below: 0.15, above: 0.085 }),
  // Very good, and allowed to be elite. `above` is wide open here - there is
  // nothing above the top of the board to protect against - and `below` is
  // what keeps Hard from being a script: it will take a merely good player
  // often enough that two Hard rosters are not the same roster.
  elite: target(0.87, { below: 0.13, above: 0.30 }),
};

/**
 * The target quality for every football position group, per difficulty.
 *
 * Keyed by BASE position (js/sports/nfl/index.js basePosition), so WR1, WR2
 * and WR3 all read WR, and both roster shapes are covered: ranked drafts the
 * defense as DL/LB/CB/S, Quick Play as a single DEF.
 *
 * Read the columns rather than the rows - the point of the table is that
 * Medium's offense and Medium's defense are two different decisions.
 */
const PLANS = {
  easy: {
    // Bad across the board. Nothing here is drafted out of position and every
    // slot still gets filled; the bot simply lives at the bottom of the pool.
    QB: TIERS.weak, RB: TIERS.weak, WR: TIERS.weak, TE: TIERS.weak,
    OL: TIERS.weak, FLEX: TIERS.weak,
    DL: TIERS.weak, LB: TIERS.weak, CB: TIERS.weak, S: TIERS.weak,
    DEF: TIERS.weak,
    ST: TIERS.weak,
  },
  medium: {
    // A legitimate NFL offense: a quarterback who can move it, productive
    // receivers, a line that holds up. Not an all-star team.
    QB: TIERS.starter, RB: TIERS.starter, WR: TIERS.starter, TE: TIERS.starter,
    OL: TIERS.starter, FLEX: TIERS.starter,
    // Soft on purpose. This is the half of the table that makes Medium the
    // mode where a player gets to enjoy scoring, and it is a product decision,
    // not a shortcut: the bot's defense being beatable is what produces the
    // higher-scoring game, rather than any hidden help for the human.
    DL: TIERS.soft, LB: TIERS.soft, CB: TIERS.soft, S: TIERS.soft,
    DEF: TIERS.soft,
    // Kicking sits between the two. A middling kicker keeps Medium's endings
    // honest without handing it the points its defense is meant to concede.
    ST: TIERS.average,
  },
  hard: {
    // Good everywhere, elite often. The complete team the mode is for.
    QB: TIERS.elite, RB: TIERS.elite, WR: TIERS.elite, TE: TIERS.elite,
    OL: TIERS.elite, FLEX: TIERS.elite,
    DL: TIERS.elite, LB: TIERS.elite, CB: TIERS.elite, S: TIERS.elite,
    DEF: TIERS.elite,
    ST: TIERS.elite,
  },
};

/** Any position the table forgot still has to draft something sensible rather
 * than defaulting to "weak" (which would make a new slot silently easier) or
 * throwing (which would forfeit the slot). The middle of the pool is the
 * honest answer to "no opinion", and adding a slot to js/sports/nfl/index.js
 * without adding it here is caught by
 * scripts/verify-nfl-practice-difficulty.mjs. */
const FALLBACK = TIERS.average;

/**
 * Football's answer to "how good should this bot's picks be", or null when the
 * shared window path should be used instead.
 *
 * Returns { targets, fallback }: `targets` maps a base position to
 * { rating, below, above }, and js/draft.js turns that into a weight per legal
 * pick. Data rather than a function so the plan can be read and asserted
 * without running a draft.
 */
export function botDraftPlan(difficultyId) {
  const targets = PLANS[difficultyId];
  return targets ? { targets, fallback: FALLBACK } : null;
}

/** The tiers, exported for the verification script so the thresholds it
 * reports are the ones the bot actually drafted against rather than a second
 * copy that can drift out of step. */
export const QUALITY_TIERS = TIERS;
