// Ladder arithmetic, and the one ladder that belongs to no sport.
//
// There are two kinds of rank in the game now:
//
//   - A per-sport rank, on that sport's own ladder. Basketball climbs YMCA to
//     Legend, football Pop Warner to Legend. Those live in js/sports/<id>/,
//     because what a rung is CALLED is the sport's business.
//   - One general rank across every sport, on the ladder below. It has to be
//     legible to someone who plays either sport, so it is written in the slang
//     all of them share - nobody has to know what a Sweet Sixteen is to know
//     that a Hooper outranks a Role Player.
//
// The maths is identical for both and lives here once, taking the ladder as an
// argument rather than reaching for a particular one.

/** The all-sports ladder, shown on a player's banner.
 *
 * General sporting terms only - no basketball tournaments, no football bowls,
 * nothing that stops meaning something when a third sport arrives. The rungs
 * climb from "barely on the team" through the descriptive middle a real player
 * gets called (a sniper, a speedster, a bucket getter) and out the top into
 * the words reserved for the very best.
 *
 * Bands widen at the bottom and narrow at the top for the same reason every
 * ladder here does: most of a playing population never leaves the middle, and
 * the top rungs should stay rare enough to mean something. */
export const GENERAL_TIERS = [
  { name: "Practice Squad", minPercentile: 0 },
  { name: "Walk-On", minPercentile: 6 },
  { name: "Benchwarmer", minPercentile: 13 },
  { name: "Role Player", minPercentile: 21 },
  { name: "Starter", minPercentile: 30 },
  { name: "Sniper", minPercentile: 39 },
  { name: "Speedster", minPercentile: 48 },
  { name: "Playmaker", minPercentile: 57 },
  { name: "Bucket Getter", minPercentile: 66 },
  { name: "Hooper", minPercentile: 74 },
  { name: "Baller", minPercentile: 81 },
  { name: "Dawg", minPercentile: 87 },
  { name: "Franchise Player", minPercentile: 92 },
  { name: "Superstar", minPercentile: 96 },
  { name: "Icon", minPercentile: 98.5 },
  { name: "GOAT", minPercentile: 99.5 },
];

/** The rung a percentile stands on. Never null for a non-empty ladder: the
 * bottom tier starts at 0, so everyone is somewhere. */
export function tierAt(tiers, percentile) {
  let tier = tiers[0] || null;
  for (const t of tiers) if (percentile >= t.minPercentile) tier = t;
  return tier;
}

/** The next rung up, or null at the top of the ladder. */
export function tierAbove(tiers, percentile) {
  return tiers.find((t) => t.minPercentile > percentile) || null;
}
