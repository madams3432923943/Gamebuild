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

/** A canonical season key at the UI boundary.
 *
 * Basketball keys name the season's start year, so 2012 is 2012-13. Football
 * keys name a single NFL season and remain 2012. Keeping the sport explicit
 * prevents shared UI from silently applying an NBA convention globally. */
export function formatSeason(season, sportId) {
  if (season === undefined || season === null || season === "") return "";
  const start = Number(season);
  if (sportId !== "nba" || !Number.isInteger(start)) return String(season);
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
