// Badge catalog. Modeled on NBA 2K badges: a badge isn't just earned, it
// *ranks up* through tiers as you keep playing, so there's always a next
// notch rather than a one-time unlock that goes dead.
//
// Every badge is a pure predicate over the normalized profile object from
// profile.js - no per-badge state is persisted, exactly like the TIERS
// system. That means the catalog can be re-tuned or extended freely without
// a migration or any risk of stranding someone's saved progress.
//
// Badges are scoped by sport so the tab can grow with NFL/NHL/soccer later.

export const BADGE_TIERS = [
  { name: "Bronze", icon: "🥉" },
  { name: "Silver", icon: "🥈" },
  { name: "Gold", icon: "🥇" },
  { name: "Hall of Fame", icon: "🏛️" },
];

/** Career counting stats accumulate across every game you've played.
 * `personalBests` only ever holds single-game highs, so these are tracked
 * separately (profile.careerTotals). */
const career = (key) => (p) => (p.careerTotals && p.careerTotals[key]) || 0;
const bestInGame = (key) => (p) => (p.personalBests[key] && p.personalBests[key].value) || 0;

export const BADGES = [
  // ---- Career volume: the "keep playing" spine of the system ----
  {
    id: "dimer",
    name: "Dimer",
    sport: "nba",
    icon: "🎩",
    blurb: "Career assists by your drafted players",
    unit: "assists",
    value: career("ast"),
    thresholds: [100, 500, 1500, 4000],
  },
  {
    id: "glass-cleaner",
    name: "Glass Cleaner",
    sport: "nba",
    icon: "🧹",
    blurb: "Career rebounds by your drafted players",
    unit: "rebounds",
    value: career("reb"),
    thresholds: [200, 1000, 3000, 8000],
  },
  {
    id: "bucket-getter",
    name: "Bucket Getter",
    sport: "nba",
    icon: "🎯",
    blurb: "Career points by your drafted players",
    unit: "points",
    value: career("pts"),
    thresholds: [500, 2500, 7500, 20000],
  },
  {
    id: "pickpocket",
    name: "Pickpocket",
    sport: "nba",
    icon: "🖐️",
    blurb: "Career steals by your drafted players",
    unit: "steals",
    value: career("stl"),
    thresholds: [25, 125, 400, 1000],
  },
  {
    id: "rim-protector",
    name: "Rim Protector",
    sport: "nba",
    icon: "🛡️",
    blurb: "Career blocks by your drafted players",
    unit: "blocks",
    value: career("blk"),
    thresholds: [25, 125, 400, 1000],
  },

  // ---- Single-game peaks: reward the one great night, not just volume ----
  {
    id: "microwave",
    name: "Microwave",
    sport: "nba",
    icon: "🔥",
    blurb: "Most points by one player in a game",
    unit: "points",
    value: bestInGame("pts"),
    thresholds: [30, 40, 50, 60],
  },
  {
    id: "vacuum",
    name: "Vacuum",
    sport: "nba",
    icon: "🌀",
    blurb: "Most rebounds by one player in a game",
    unit: "rebounds",
    value: bestInGame("reb"),
    thresholds: [15, 18, 22, 26],
  },
  {
    id: "maestro",
    name: "Maestro",
    sport: "nba",
    icon: "🪄",
    blurb: "Most assists by one player in a game",
    unit: "assists",
    value: bestInGame("ast"),
    thresholds: [12, 15, 18, 22],
  },

  // ---- Record ----
  {
    id: "winner",
    name: "Winner",
    sport: "nba",
    icon: "🏆",
    blurb: "Games won across every mode",
    unit: "wins",
    value: (p) => p.onlineWins + p.offlineWins,
    thresholds: [1, 10, 50, 150],
  },
  {
    id: "ranked-rep",
    name: "Ranked Reputation",
    sport: "nba",
    icon: "⚔️",
    blurb: "Ranked wins against real opponents",
    unit: "ranked wins",
    value: (p) => p.onlineWins,
    thresholds: [1, 10, 30, 75],
  },

  // ---- Drafting habits ----
  {
    id: "scout",
    name: "Scout",
    sport: "nba",
    icon: "🔍",
    blurb: "Different players you've drafted",
    unit: "players",
    value: (p) => Object.keys(p.draftCounts).length,
    thresholds: [10, 40, 120, 300],
  },
  {
    id: "loyalist",
    name: "Loyalist",
    sport: "nba",
    icon: "🤝",
    blurb: "Times you've drafted your most-picked player",
    unit: "picks",
    value: (p) => Math.max(0, ...Object.values(p.draftCounts)),
    thresholds: [5, 15, 40, 100],
  },
];

/**
 * Where a profile currently stands on one badge.
 * `tierIndex` is -1 when it hasn't been earned at all yet; otherwise it
 * indexes BADGE_TIERS. `next` is null once Hall of Fame is reached.
 */
export function badgeProgress(badge, profile) {
  const value = badge.value(profile);
  let tierIndex = -1;
  for (let i = 0; i < badge.thresholds.length; i++) {
    if (value >= badge.thresholds[i]) tierIndex = i;
  }

  const nextThreshold = badge.thresholds[tierIndex + 1];
  const floor = tierIndex >= 0 ? badge.thresholds[tierIndex] : 0;
  const percent =
    nextThreshold === undefined
      ? 100
      : Math.max(0, Math.min(100, ((value - floor) / (nextThreshold - floor)) * 100));

  return {
    value,
    tierIndex,
    tier: tierIndex >= 0 ? BADGE_TIERS[tierIndex] : null,
    next: nextThreshold === undefined ? null : { threshold: nextThreshold, tier: BADGE_TIERS[tierIndex + 1] },
    percent,
  };
}

export function badgesForSport(sport = "nba") {
  return BADGES.filter((b) => b.sport === sport);
}

/** Headline for the badges tab: how many badges are earned at all, and how
 * many have been maxed out. */
export function badgeSummary(profile, sport = "nba") {
  const list = badgesForSport(sport);
  let earned = 0;
  let maxed = 0;
  for (const badge of list) {
    const { tierIndex } = badgeProgress(badge, profile);
    if (tierIndex >= 0) earned += 1;
    if (tierIndex === badge.thresholds.length - 1) maxed += 1;
  }
  return { earned, maxed, total: list.length };
}
