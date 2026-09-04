// Number formatting shared by the screens that print statistics.
//
// Extracted from js/ui.js alongside the other primitives, and renamed on the
// way out. It was `r`, which is fine for a helper sitting twenty lines from its
// only caller and not fine for something the box score and the profile screen
// both import - a shared name has to say what it does, and CLAUDE.md asks for
// descriptive names over brevity precisely here.

/** A statistic as it is shown: whole, and never negative.
 *
 * The clamp is not defensive tidying. A box score reconstructs a line from
 * fractional shares, so rounding alone can produce -0 or a small negative on a
 * man who did nothing, and "-1 rebounds" is worse than useless - it reads as a
 * bug in the simulation to anyone who sees it. */
export function roundStat(n) {
  return Math.max(0, Math.round(n));
}
