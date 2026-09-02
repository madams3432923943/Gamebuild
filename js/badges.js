import { statsKey } from "./sports/index.js";
// Badge catalog. Modeled on NBA 2K badges: a badge isn't just earned, it
// *ranks up* through tiers as you keep playing, so there's always a next
// notch rather than a one-time unlock that goes dead.
//
// Every badge is a pure predicate over the normalized profile object from
// profile.js - no per-badge state is persisted, exactly like the rank ladder
// (each sport's `tiers`). That means the catalog can be re-tuned or extended
// freely without a migration or any risk of stranding someone's saved progress.
//
// Badges are scoped by sport so the tab can grow as sports are added.

export const BADGE_TIERS = [
  { name: "Bronze", icon: "🥉" },
  { name: "Silver", icon: "🥈" },
  { name: "Gold", icon: "🥇" },
  { name: "Hall of Fame", icon: "🏛️" },
];

/** Career counting stats accumulate across every game you've played.
 * `personalBests` only ever holds single-game highs, so these are tracked
 * separately (profile.careerTotals).
 *
 * BOTH MAPS ARE NAMESPACED BY SPORT, and for a long time neither of these
 * helpers knew it. profile.js writes career totals and personal bests under
 * statsKey(sport, key) - bare for basketball, `nfl:` prefixed for football -
 * while these read the bare key. So basketball worked, football silently read
 * undefined, and all twenty NFL badges sat at zero no matter how much football
 * anybody played. The stats were being recorded correctly the whole time;
 * nothing was looking at them.
 *
 * The sport is threaded in from the badge itself rather than passed at each
 * call site, so a badge can only ever read its own sport's numbers and a future
 * sport cannot be added with this bug re-introduced by omission. */
const career = (key) => (p, sport) => (p.careerTotals && p.careerTotals[statsKey(sport, key)]) || 0;
const bestInGame = (key) => (p, sport) => {
  const record = p.personalBests && p.personalBests[statsKey(sport, key)];
  return (record && record.value) || 0;
};

export const BADGES = [
  // ---- FOOTBALL ------------------------------------------------------------
  // Named after the Madden ability/X-Factor idiom the user asked for, but each
  // one is earned by a REAL career total accumulated by the players you drafted
  // - nothing here is cosmetic or hand-awarded. The keys are football's own
  // (see NFL.statLabels); a badge cannot exist for a statistic the ledger does
  // not honestly produce, which is why there is no tackle or coverage badge.
  {
    id: "gunslinger",
    name: "Gunslinger",
    sport: "nfl",
    icon: "🔫",
    blurb: "Career passing yards",
    unit: "passing yards",
    value: career("pass_yds"),
    thresholds: [2500, 12000, 35000, 80000],
  },
  {
    id: "deadeye",
    name: "Deadeye",
    sport: "nfl",
    icon: "🎯",
    blurb: "Career passing TDs",
    unit: "passing TDs",
    value: career("pass_tds"),
    thresholds: [15, 80, 250, 600],
  },
  {
    id: "surgeon",
    name: "Surgeon",
    sport: "nfl",
    icon: "🩺",
    blurb: "Career completions",
    unit: "completions",
    value: career("comp"),
    thresholds: [200, 1000, 3000, 7000],
  },
  {
    id: "bulldozer",
    name: "Bulldozer",
    sport: "nfl",
    icon: "🚜",
    blurb: "Career rushing yards",
    unit: "rushing yards",
    value: career("rush_yds"),
    thresholds: [1000, 5000, 15000, 35000],
  },
  {
    id: "goal-line-stalker",
    name: "Goal Line Stalker",
    sport: "nfl",
    icon: "🐂",
    blurb: "Career rushing TDs",
    unit: "rushing TDs",
    value: career("rush_tds"),
    thresholds: [10, 50, 150, 350],
  },
  {
    id: "yac-em-up",
    name: "YAC 'Em Up",
    sport: "nfl",
    icon: "💨",
    blurb: "Career receiving yards",
    unit: "receiving yards",
    value: career("rec_yds"),
    thresholds: [1500, 7000, 20000, 50000],
  },
  {
    id: "end-zone-magnet",
    name: "End Zone Magnet",
    sport: "nfl",
    icon: "🧲",
    blurb: "Career receiving TDs",
    unit: "receiving TDs",
    value: career("rec_tds"),
    thresholds: [12, 60, 180, 420],
  },
  {
    id: "sure-hands",
    name: "Sure Hands",
    sport: "nfl",
    icon: "🧤",
    blurb: "Career receptions",
    unit: "receptions",
    value: career("rec"),
    thresholds: [150, 800, 2400, 6000],
  },
  {
    id: "ball-hawk",
    name: "Ball Hawk",
    sport: "nfl",
    icon: "🦅",
    blurb: "Career interceptions",
    unit: "interceptions",
    value: career("ints"),
    thresholds: [10, 45, 130, 300],
  },
  {
    id: "strip-specialist",
    name: "Strip Specialist",
    sport: "nfl",
    icon: "🪓",
    blurb: "Career forced fumbles",
    unit: "forced fumbles",
    value: career("fumbles"),
    thresholds: [8, 35, 100, 240],
  },
  // ---- FOOTBALL, SINGLE-GAME ----------------------------------------------
  // The career badges above reward showing up; these reward one enormous
  // afternoon. Same split basketball already uses, and the thresholds are real
  // football peaks - 400 passing yards is a genuine day out, 550 is historic.
  {
    id: "bombs-away",
    name: "Bombs Away",
    sport: "nfl",
    icon: "💣",
    blurb: "Best game: passing yards",
    unit: "yards",
    value: bestInGame("pass_yds"),
    thresholds: [300, 400, 475, 550],
  },
  {
    id: "five-alarm",
    name: "Five Alarm",
    sport: "nfl",
    icon: "🚨",
    blurb: "Best game: passing TDs",
    unit: "passing TDs",
    value: bestInGame("pass_tds"),
    thresholds: [3, 4, 5, 7],
  },
  {
    id: "metronome",
    name: "Metronome",
    sport: "nfl",
    icon: "⏱️",
    blurb: "Best game: completions",
    unit: "completions",
    value: bestInGame("comp"),
    thresholds: [25, 30, 36, 45],
  },
  {
    id: "downhill",
    name: "Downhill",
    sport: "nfl",
    icon: "⛰️",
    blurb: "Best game: rushing yards",
    unit: "yards",
    value: bestInGame("rush_yds"),
    thresholds: [100, 150, 200, 275],
  },
  {
    id: "vulture",
    name: "Vulture",
    sport: "nfl",
    icon: "🍖",
    blurb: "Best game: rushing TDs",
    unit: "rushing TDs",
    value: bestInGame("rush_tds"),
    thresholds: [2, 3, 4, 5],
  },
  {
    id: "human-joystick",
    name: "Human Joystick",
    sport: "nfl",
    icon: "🕹️",
    blurb: "Best game: receiving yards",
    unit: "yards",
    value: bestInGame("rec_yds"),
    thresholds: [100, 150, 200, 275],
  },
  {
    id: "triple-threat",
    name: "Triple Threat",
    sport: "nfl",
    icon: "🎪",
    blurb: "Best game: receiving TDs",
    unit: "receiving TDs",
    value: bestInGame("rec_tds"),
    thresholds: [2, 3, 4, 5],
  },
  {
    id: "larceny",
    name: "Larceny",
    sport: "nfl",
    icon: "🥷",
    blurb: "Best game: interceptions",
    unit: "interceptions",
    value: bestInGame("ints"),
    thresholds: [2, 3, 4, 5],
  },
  {
    id: "automatic",
    name: "Automatic",
    sport: "nfl",
    icon: "🎰",
    blurb: "Best game: field goals",
    unit: "field goals",
    value: bestInGame("fgs"),
    thresholds: [3, 4, 5, 7],
  },
  {
    id: "ice-in-veins",
    name: "Ice In Veins",
    sport: "nfl",
    icon: "🧊",
    blurb: "Career field goals",
    unit: "field goals",
    value: career("fgs"),
    thresholds: [20, 100, 300, 700],
  },

  // ---- Career volume: the "keep playing" spine of the system ----
  {
    id: "dimer",
    name: "Dimer",
    sport: "nba",
    icon: "🎩",
    blurb: "Career assists",
    unit: "assists",
    value: career("ast"),
    thresholds: [100, 500, 1500, 4000],
  },
  {
    id: "glass-cleaner",
    name: "Glass Cleaner",
    sport: "nba",
    icon: "🧹",
    blurb: "Career rebounds",
    unit: "rebounds",
    value: career("reb"),
    thresholds: [200, 1000, 3000, 8000],
  },
  {
    id: "bucket-getter",
    name: "Bucket Getter",
    sport: "nba",
    icon: "🎯",
    blurb: "Career points",
    unit: "points",
    value: career("pts"),
    thresholds: [500, 2500, 7500, 20000],
  },
  {
    id: "pickpocket",
    name: "Pickpocket",
    sport: "nba",
    icon: "🖐️",
    blurb: "Career steals",
    unit: "steals",
    value: career("stl"),
    thresholds: [25, 125, 400, 1000],
  },
  {
    id: "rim-protector",
    name: "Rim Protector",
    sport: "nba",
    icon: "🛡️",
    blurb: "Career blocks",
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
    blurb: "Best game: points",
    unit: "points",
    value: bestInGame("pts"),
    thresholds: [30, 40, 50, 60],
  },
  {
    id: "vacuum",
    name: "Vacuum",
    sport: "nba",
    icon: "🌀",
    blurb: "Best game: rebounds",
    unit: "rebounds",
    value: bestInGame("reb"),
    thresholds: [15, 18, 22, 26],
  },
  {
    id: "maestro",
    name: "Maestro",
    sport: "nba",
    icon: "🪄",
    blurb: "Best game: assists",
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
    blurb: "Wins in any mode",
    unit: "wins",
    value: (p) => p.onlineWins + p.offlineWins,
    thresholds: [1, 10, 50, 150],
  },
  {
    id: "ranked-rep",
    name: "Ranked Reputation",
    sport: "nba",
    icon: "⚔️",
    blurb: "Ranked wins",
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
    blurb: "Different players drafted",
    unit: "players",
    value: (p) => Object.keys(p.draftCounts).length,
    thresholds: [10, 40, 120, 300],
  },
  {
    id: "loyalist",
    name: "Loyalist",
    sport: "nba",
    icon: "🤝",
    blurb: "Picks of one favourite",
    unit: "picks",
    value: (p) => Math.max(0, ...Object.values(p.draftCounts)),
    thresholds: [5, 15, 40, 100],
  },

  // ---- Two-way and defensive volume ----
  {
    id: "menace",
    name: "Menace",
    sport: "nba",
    icon: "😈",
    blurb: "Career steals + blocks",
    unit: "stops",
    value: (p, sport) => career("stl")(p, sport) + career("blk")(p, sport),
    thresholds: [100, 500, 1500, 4000],
  },
  {
    id: "two-way",
    name: "Two-Way Threat",
    sport: "nba",
    icon: "🔄",
    blurb: "Career pts + reb + ast",
    unit: "counted stats",
    value: (p, sport) => career("pts")(p, sport) + career("reb")(p, sport) + career("ast")(p, sport),
    thresholds: [1000, 6000, 18000, 50000],
  },
  {
    id: "swiss-army",
    name: "Swiss Army",
    sport: "nba",
    icon: "🧰",
    blurb: "Your weakest stat's best game",
    unit: "in every stat",
    value: (p, sport) => Math.min(...["pts", "reb", "ast", "stl", "blk"].map((k) => bestInGame(k)(p, sport))),
    thresholds: [3, 6, 9, 12],
  },

  // ---- Consistency and commitment ----
  {
    id: "regular",
    name: "Regular",
    sport: "nba",
    icon: "📅",
    blurb: "Games played",
    unit: "games",
    value: (p) => p.onlineWins + p.onlineLosses + p.offlineWins + p.offlineLosses,
    thresholds: [5, 25, 100, 500],
  },
  {
    id: "closer",
    name: "Closer",
    sport: "nba",
    icon: "🧊",
    blurb: "Win rate after 10 games",
    unit: "% wins",
    value: (p) => {
      const games = p.onlineWins + p.onlineLosses + p.offlineWins + p.offlineLosses;
      if (games < 10) return 0;
      return Math.round((100 * (p.onlineWins + p.offlineWins)) / games);
    },
    thresholds: [50, 60, 70, 80],
  },

  // ---- The hard ones. These are meant to sit unearned for a long time:
  // a collection with no distant peaks stops being interesting the moment
  // everything is gold. ----
  {
    id: "untouchable",
    name: "Untouchable",
    sport: "nba",
    icon: "👑",
    blurb: "Ranked wins only",
    unit: "ranked wins",
    value: (p) => p.onlineWins,
    thresholds: [25, 100, 300, 1000],
  },
  {
    id: "encyclopedia",
    name: "Encyclopedia",
    sport: "nba",
    icon: "📚",
    blurb: "Different players drafted (150+)",
    unit: "players",
    value: (p) => Object.keys(p.draftCounts).length,
    thresholds: [150, 400, 800, 1500],
  },
  {
    id: "immortal",
    name: "Immortal",
    sport: "nba",
    icon: "🐐",
    blurb: "Best scoring game",
    unit: "points",
    value: bestInGame("pts"),
    thresholds: [45, 55, 65, 75],
  },
];

/**
 * Where a profile currently stands on one badge.
 * `tierIndex` is -1 when it hasn't been earned at all yet; otherwise it
 * indexes BADGE_TIERS. `next` is null once Hall of Fame is reached.
 */
/** Badge ids force-unlocked for this player, from profiles.granted_badges.
 * Same override as banners, same rule: cosmetic only, never a rating. */
function isBadgeGranted(profile, id) {
  const granted = profile && profile.grantedBadges;
  return Array.isArray(granted) && granted.includes(id);
}

export function badgeProgress(badge, profile) {
  // The badge's OWN sport, so career() and bestInGame() look in the right
  // namespace. See the note on those helpers for what happened when they did
  // not know which sport they were counting.
  const value = badge.value(profile, badge.sport);
  let tierIndex = -1;
  for (let i = 0; i < badge.thresholds.length; i++) {
    if (value >= badge.thresholds[i]) tierIndex = i;
  }

  // A granted badge lands at its TOP tier. A grant that produced Bronze would
  // leave the player still visibly grinding for something they were given.
  if (tierIndex < badge.thresholds.length - 1 && isBadgeGranted(profile, badge.id)) {
    const top = badge.thresholds.length - 1;
    return {
      value,
      tierIndex: top,
      tier: BADGE_TIERS[top],
      next: null,
      percent: 100,
      granted: true,
    };
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

export function badgeById(id) {
  return BADGES.find((b) => b.id === id) || null;
}
