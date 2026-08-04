// Team banners: the first earnable reward. You unlock a franchise's banner by
// drafting enough of its players in games you actually won, then equip one to
// fly it on your profile and home screen.
//
// Why this shape:
//  - Only ranked wins count. Practice is client-side and unverified, so
//    banners earned there would mean nothing; a banner should say you beat a
//    real opponent with that franchise.
//  - It rewards depth in a franchise rather than luck, which is the same thing
//    the game already tests. Farming one team means genuinely knowing its
//    roster across eras.
//  - It's cosmetic only. Nothing here touches simulation or rank - a reward
//    that granted an edge would turn ranked into a measure of playtime instead
//    of knowledge.
//  - Art is a color pair plus initials, generated from the franchise entry
//    below. No player likenesses, nothing to license, and it scales to every
//    team without commissioning a single asset.

/** Players from a franchise you must draft in winning games to earn it. */
export const BANNER_THRESHOLD = 10;

/**
 * One entry per franchise, not per team name. Franchises get renamed and
 * relocated (Bullets -> Wizards, New Jersey -> Brooklyn, Vancouver ->
 * Memphis), and a banner should track the franchise across all of it -
 * otherwise drafting the 90s Bullets and the 2010s Wizards would build two
 * unrelated banners for what is one team.
 *
 * `aliases` lists every team string that maps here, including era-accurate
 * names used by older squads.
 */
export const FRANCHISES = [
  { id: "hawks", name: "Atlanta Hawks", abbr: "ATL", sport: "nba", colors: ["#e03a3e", "#26282a"], aliases: [] },
  { id: "celtics", name: "Boston Celtics", abbr: "BOS", sport: "nba", colors: ["#007a33", "#ba9653"], aliases: [] },
  {
    id: "nets",
    name: "Brooklyn Nets",
    abbr: "BKN",
    sport: "nba",
    colors: ["#000000", "#ffffff"],
    aliases: ["New Jersey Nets", "Brooklyn/New Jersey Nets"],
  },
  {
    id: "hornets",
    name: "Charlotte Hornets",
    abbr: "CHA",
    sport: "nba",
    colors: ["#1d1160", "#00788c"],
    aliases: ["Charlotte Bobcats"],
  },
  { id: "bulls", name: "Chicago Bulls", abbr: "CHI", sport: "nba", colors: ["#ce1141", "#000000"], aliases: [] },
  { id: "cavaliers", name: "Cleveland Cavaliers", abbr: "CLE", sport: "nba", colors: ["#860038", "#fdbb30"], aliases: [] },
  { id: "mavericks", name: "Dallas Mavericks", abbr: "DAL", sport: "nba", colors: ["#00538c", "#002b5e"], aliases: [] },
  { id: "nuggets", name: "Denver Nuggets", abbr: "DEN", sport: "nba", colors: ["#0e2240", "#fec524"], aliases: [] },
  { id: "pistons", name: "Detroit Pistons", abbr: "DET", sport: "nba", colors: ["#c8102e", "#1d42ba"], aliases: [] },
  { id: "warriors", name: "Golden State Warriors", abbr: "GSW", sport: "nba", colors: ["#1d428a", "#ffc72c"], aliases: [] },
  { id: "rockets", name: "Houston Rockets", abbr: "HOU", sport: "nba", colors: ["#ce1141", "#000000"], aliases: [] },
  { id: "pacers", name: "Indiana Pacers", abbr: "IND", sport: "nba", colors: ["#002d62", "#fdbb30"], aliases: [] },
  {
    id: "clippers",
    name: "LA Clippers",
    abbr: "LAC",
    sport: "nba",
    colors: ["#c8102e", "#1d428a"],
    aliases: ["San Diego Clippers", "Los Angeles Clippers"],
  },
  { id: "lakers", name: "LA Lakers", abbr: "LAL", sport: "nba", colors: ["#552583", "#fdb927"], aliases: ["Los Angeles Lakers"] },
  {
    id: "grizzlies",
    name: "Memphis Grizzlies",
    abbr: "MEM",
    sport: "nba",
    colors: ["#5d76a9", "#12173f"],
    aliases: ["Vancouver Grizzlies"],
  },
  { id: "heat", name: "Miami Heat", abbr: "MIA", sport: "nba", colors: ["#98002e", "#f9a01b"], aliases: [] },
  { id: "bucks", name: "Milwaukee Bucks", abbr: "MIL", sport: "nba", colors: ["#00471b", "#eee1c6"], aliases: [] },
  { id: "timberwolves", name: "Minnesota Timberwolves", abbr: "MIN", sport: "nba", colors: ["#0c2340", "#78be20"], aliases: [] },
  {
    id: "pelicans",
    name: "New Orleans Pelicans",
    abbr: "NOP",
    sport: "nba",
    colors: ["#0c2340", "#c8102e"],
    aliases: ["New Orleans Hornets", "New Orleans Hornets/Pelicans"],
  },
  { id: "knicks", name: "New York Knicks", abbr: "NYK", sport: "nba", colors: ["#006bb6", "#f58426"], aliases: [] },
  {
    // Sonics and Thunder are one franchise on paper, and the 2000s squad
    // deliberately spans the move, so they share a banner.
    id: "thunder",
    name: "Thunder / SuperSonics",
    abbr: "OKC",
    sport: "nba",
    colors: ["#007ac1", "#ef3b24"],
    aliases: ["Oklahoma City Thunder", "Seattle SuperSonics", "Seattle SuperSonics / OKC Thunder"],
  },
  { id: "magic", name: "Orlando Magic", abbr: "ORL", sport: "nba", colors: ["#0077c0", "#c4ced4"], aliases: [] },
  { id: "sixers", name: "Philadelphia 76ers", abbr: "PHI", sport: "nba", colors: ["#006bb6", "#ed174c"], aliases: [] },
  { id: "suns", name: "Phoenix Suns", abbr: "PHX", sport: "nba", colors: ["#1d1160", "#e56020"], aliases: [] },
  { id: "blazers", name: "Portland Trail Blazers", abbr: "POR", sport: "nba", colors: ["#e03a3e", "#000000"], aliases: [] },
  { id: "kings", name: "Sacramento Kings", abbr: "SAC", sport: "nba", colors: ["#5a2d81", "#63727a"], aliases: [] },
  { id: "spurs", name: "San Antonio Spurs", abbr: "SAS", sport: "nba", colors: ["#c4ced4", "#000000"], aliases: [] },
  { id: "raptors", name: "Toronto Raptors", abbr: "TOR", sport: "nba", colors: ["#ce1141", "#000000"], aliases: [] },
  { id: "jazz", name: "Utah Jazz", abbr: "UTA", sport: "nba", colors: ["#002b5c", "#00471b"], aliases: [] },
  {
    id: "wizards",
    name: "Washington Wizards",
    abbr: "WAS",
    sport: "nba",
    colors: ["#002b5c", "#e31837"],
    aliases: ["Washington Bullets"],
  },

  // ---- NFL: sport field is what makes this a drop-in extension rather than
  // a rewrite - franchisesForSport() below is the only new plumbing needed.
  // Not earnable yet (no NFL draft engine/dataset exists - see constants.js's
  // SPORTS list), so every one of these sits locked at 0 progress until NFL
  // goes live. IDs are sport-prefixed since a future sport (NHL, soccer)
  // could otherwise collide with a short team nickname. ----
  { id: "nfl-bills", name: "Buffalo Bills", abbr: "BUF", sport: "nfl", colors: ["#00338d", "#c60c30"], aliases: [] },
  { id: "nfl-dolphins", name: "Miami Dolphins", abbr: "MIA", sport: "nfl", colors: ["#008e97", "#fc4c02"], aliases: [] },
  { id: "nfl-patriots", name: "New England Patriots", abbr: "NE", sport: "nfl", colors: ["#002244", "#c60c30"], aliases: [] },
  { id: "nfl-jets", name: "New York Jets", abbr: "NYJ", sport: "nfl", colors: ["#125740", "#000000"], aliases: [] },
  { id: "nfl-ravens", name: "Baltimore Ravens", abbr: "BAL", sport: "nfl", colors: ["#241773", "#000000"], aliases: [] },
  { id: "nfl-bengals", name: "Cincinnati Bengals", abbr: "CIN", sport: "nfl", colors: ["#fb4f14", "#000000"], aliases: [] },
  { id: "nfl-browns", name: "Cleveland Browns", abbr: "CLE", sport: "nfl", colors: ["#311d00", "#ff3c00"], aliases: [] },
  { id: "nfl-steelers", name: "Pittsburgh Steelers", abbr: "PIT", sport: "nfl", colors: ["#ffb612", "#101820"], aliases: [] },
  { id: "nfl-texans", name: "Houston Texans", abbr: "HOU", sport: "nfl", colors: ["#03202f", "#a71930"], aliases: [] },
  { id: "nfl-colts", name: "Indianapolis Colts", abbr: "IND", sport: "nfl", colors: ["#002c5f", "#a2aaad"], aliases: [] },
  { id: "nfl-jaguars", name: "Jacksonville Jaguars", abbr: "JAX", sport: "nfl", colors: ["#101820", "#d7a22a"], aliases: [] },
  { id: "nfl-titans", name: "Tennessee Titans", abbr: "TEN", sport: "nfl", colors: ["#0c2340", "#4b92db"], aliases: [] },
  { id: "nfl-broncos", name: "Denver Broncos", abbr: "DEN", sport: "nfl", colors: ["#fb4f14", "#002244"], aliases: [] },
  { id: "nfl-chiefs", name: "Kansas City Chiefs", abbr: "KC", sport: "nfl", colors: ["#e31837", "#ffb81c"], aliases: [] },
  { id: "nfl-raiders", name: "Las Vegas Raiders", abbr: "LV", sport: "nfl", colors: ["#000000", "#a5acaf"], aliases: [] },
  { id: "nfl-chargers", name: "Los Angeles Chargers", abbr: "LAC", sport: "nfl", colors: ["#0080c6", "#ffc20e"], aliases: [] },
  { id: "nfl-cowboys", name: "Dallas Cowboys", abbr: "DAL", sport: "nfl", colors: ["#041e42", "#869397"], aliases: [] },
  { id: "nfl-giants", name: "New York Giants", abbr: "NYG", sport: "nfl", colors: ["#0b2265", "#a71930"], aliases: [] },
  { id: "nfl-eagles", name: "Philadelphia Eagles", abbr: "PHI", sport: "nfl", colors: ["#004c54", "#a5acaf"], aliases: [] },
  { id: "nfl-commanders", name: "Washington Commanders", abbr: "WAS", sport: "nfl", colors: ["#5a1414", "#ffb612"], aliases: [] },
  { id: "nfl-bears", name: "Chicago Bears", abbr: "CHI", sport: "nfl", colors: ["#0b162a", "#c83803"], aliases: [] },
  { id: "nfl-lions", name: "Detroit Lions", abbr: "DET", sport: "nfl", colors: ["#0076b6", "#b0b7bc"], aliases: [] },
  { id: "nfl-packers", name: "Green Bay Packers", abbr: "GB", sport: "nfl", colors: ["#203731", "#ffb612"], aliases: [] },
  { id: "nfl-vikings", name: "Minnesota Vikings", abbr: "MIN", sport: "nfl", colors: ["#4f2683", "#ffc62f"], aliases: [] },
  { id: "nfl-falcons", name: "Atlanta Falcons", abbr: "ATL", sport: "nfl", colors: ["#a71930", "#000000"], aliases: [] },
  { id: "nfl-panthers", name: "Carolina Panthers", abbr: "CAR", sport: "nfl", colors: ["#0085ca", "#101820"], aliases: [] },
  { id: "nfl-saints", name: "New Orleans Saints", abbr: "NO", sport: "nfl", colors: ["#d3bc8d", "#101820"], aliases: [] },
  { id: "nfl-buccaneers", name: "Tampa Bay Buccaneers", abbr: "TB", sport: "nfl", colors: ["#d50a0a", "#34302b"], aliases: [] },
  { id: "nfl-cardinals", name: "Arizona Cardinals", abbr: "ARI", sport: "nfl", colors: ["#97233f", "#000000"], aliases: [] },
  { id: "nfl-rams", name: "Los Angeles Rams", abbr: "LAR", sport: "nfl", colors: ["#003594", "#ffa300"], aliases: [] },
  { id: "nfl-49ers", name: "San Francisco 49ers", abbr: "SF", sport: "nfl", colors: ["#aa0000", "#b3995d"], aliases: [] },
  { id: "nfl-seahawks", name: "Seattle Seahawks", abbr: "SEA", sport: "nfl", colors: ["#002244", "#69be28"], aliases: [] },
];

/** Franchises for one sport - mirrors badgesForSport()'s pattern so the
 * Rewards > Banners subtabs can filter the same way the Badges subtabs
 * already do. */
export function franchisesForSport(sport = "nba") {
  return FRANCHISES.filter((f) => f.sport === sport);
}

const TEAM_TO_FRANCHISE = new Map();
for (const f of FRANCHISES) {
  TEAM_TO_FRANCHISE.set(f.name, f.id);
  for (const alias of f.aliases) TEAM_TO_FRANCHISE.set(alias, f.id);
}

export function franchiseById(id) {
  return FRANCHISES.find((f) => f.id === id) || null;
}

// Hardcoded, non-earnable banners for specific accounts - deliberately live
// outside FRANCHISES: folding them into that array would inflate everyone
// else's "X of 30 unlocked" count for a banner they can never earn.
const FOUNDER_USER_ID = "eb5b91cf-7a08-4757-b2a7-967db2424846"; // madams
export const FOUNDER_BANNER = {
  id: "founder",
  name: "Founder",
  abbr: "★",
  colors: ["#f2c14e", "#15181f"],
  // The star used to ride the generic ghosted-abbreviation slot, which is
  // deliberately bled off the bottom-right corner so a three-letter code
  // reads as a watermark - fine for "ATL", but it sliced the star in half.
  // As an emblem it sits fully inside the frame at full opacity, and the
  // corner carries readable words instead of a clipped glyph.
  art: "founder",
  emblem: "★",
  label: "The Founder",
  hideAbbr: true,
};

export function isFounder(profile) {
  return profile.id === FOUNDER_USER_ID;
}

// dotch: the first person to download the game. Platinum, not silver/gray -
// distinct from an ordinary team's colors and reads as a tier above them at
// a glance, which is the point of a prestige banner nobody else can earn.
// "1ST" rather than a bare "1" so the ghosted abbreviation (see bannerArt in
// ui.js) is unambiguous even without reading the name label underneath.
const FIRST_PLAYER_USER_ID = "94f3e329-60ce-425d-9a86-1046df04e660"; // dotch
export const FIRST_PLAYER_BANNER = {
  id: "first-player",
  name: "1st Player",
  abbr: "1ST",
  colors: ["#e8e6e1", "#4a4d52"],
};

export function isFirstPlayer(profile) {
  return profile.id === FIRST_PLAYER_USER_ID;
}

// ---- General banners -------------------------------------------------------
// Earned through play, but not through any one franchise or sport, so they
// can't live in FRANCHISES (which is per-sport and counted as "X of 30").
// Each carries its own requirement and reads its own progress off the
// profile, so adding another is one entry here and nothing else.
//
// `art` picks a CSS treatment in bannerArt (ui.js). Plain color-pair banners
// leave it off; the camo ladder uses it to get a real pattern rather than a
// flat gradient, since a camo that isn't patterned isn't a camo.

/** Everyone starts with this equipped (see DEFAULT_BANNER_ID) - a new player
 * on a blank card looked broken, and "no banner" isn't a reward state. Worn
 * leather brown: deliberately the plainest thing in the game, so every real
 * unlock reads as an upgrade on it. */
export const DEFAULT_BANNER_ID = "rookie";

export const GENERAL_BANNERS = [
  {
    id: DEFAULT_BANNER_ID,
    name: "Rookie",
    abbr: "RK",
    colors: ["#7a5236", "#3d2a1c"],
    blurb: "Every player starts here.",
    progress: () => ({ value: 1, required: 1, unlocked: true }),
  },
  // Friend-count banners. Three tiers so the reward keeps pace with actually
  // building a circle rather than being a single one-and-done unlock.
  //
  // Each gets its own artwork rather than the ghosted requirement number the
  // generic treatment would stamp in the corner. A banner is worn - it should
  // say something about you, not restate the receipt for how it was earned,
  // and "30" in the corner reads as a jersey number nobody chose. The three
  // designs escalate the same way the tiers do: a huddle of five, a full
  // lineup card, then pinstripes.
  ...[
    { id: "crew-5", name: "Crew", abbr: "5", need: 5, art: "crew-huddle", colors: ["#4f9d69", "#20402c"] },
    { id: "crew-15", name: "Roster", abbr: "15", need: 15, art: "crew-roster", colors: ["#3d7ea6", "#1b3a4d"] },
    { id: "crew-30", name: "Front Office", abbr: "30", need: 30, art: "crew-front-office", colors: ["#8e5ea2", "#3a2547"] },
  ].map((t) => ({
    id: t.id,
    name: t.name,
    abbr: t.abbr,
    colors: t.colors,
    art: t.art,
    hideAbbr: true,
    blurb: `Add ${t.need} friends.`,
    progress: (profile, stats) => {
      const value = stats.friendCount || 0;
      return { value, required: t.need, unlocked: value >= t.need };
    },
  })),
  // The camo ladder, gated on ranked wins. Diamond sits far out on purpose:
  // it's the one banner meant to be genuinely rare, so it can't share a tier
  // with anything reachable in a weekend.
  ...[
    { id: "camo-woodland", name: "Woodland Camo", abbr: "WDL", need: 10, art: "camo-woodland", colors: ["#4b5320", "#2f3317"] },
    { id: "camo-desert", name: "Desert Camo", abbr: "DST", need: 50, art: "camo-desert", colors: ["#c2a373", "#7a6242"] },
    { id: "camo-tiger", name: "Tiger Camo", abbr: "TGR", need: 100, art: "camo-tiger", colors: ["#d99b2b", "#241c10"] },
    { id: "camo-gold", name: "Gold Camo", abbr: "GLD", need: 250, art: "camo-gold", colors: ["#e8c14a", "#8a6a12"] },
    { id: "camo-diamond", name: "Diamond Camo", abbr: "DMD", need: 500, art: "camo-diamond", colors: ["#9fe8ff", "#2b6f86"] },
  ].map((t) => ({
    id: t.id,
    name: t.name,
    abbr: t.abbr,
    colors: t.colors,
    art: t.art,
    // Just the camo. A pattern with "WDL" stamped over it isn't a camo, it's
    // a label on top of one - and the tile already names it underneath.
    hideAbbr: true,
    blurb: `Win ${t.need} online ranked games.`,
    progress: (profile) => {
      const value = profile.onlineWins || 0;
      return { value, required: t.need, unlocked: value >= t.need };
    },
  })),
];

export function generalBannerById(id) {
  return GENERAL_BANNERS.find((b) => b.id === id) || null;
}

/** Progress for one general banner, in the same shape bannerProgress()
 * returns for franchise banners so the tile renderer can treat both alike.
 * `stats` carries anything that isn't on the profile row itself (today just
 * friendCount). */
export function generalBannerProgress(banner, profile, stats = {}) {
  const { value, required, unlocked } = banner.progress(profile, stats);
  return { drafted: value, value, required, unlocked, percent: Math.min(100, (100 * value) / required) };
}

/** Resolves an equipped-banner id to its art/metadata, checking the special
 * hardcoded banners first since they aren't in FRANCHISES. Used everywhere
 * equippedBanner gets displayed, so equipping "founder" or "first-player"
 * renders correctly wherever a plain franchiseById(id) lookup used to be
 * the only option. */
export function bannerById(id) {
  if (id === FOUNDER_BANNER.id) return FOUNDER_BANNER;
  if (id === FIRST_PLAYER_BANNER.id) return FIRST_PLAYER_BANNER;
  return generalBannerById(id) || franchiseById(id);
}

/** Every team string that belongs to a franchise, current name included. */
function teamNamesFor(franchise) {
  return [franchise.name, ...franchise.aliases];
}

/**
 * Progress is stored server-side keyed by the RAW team name on the drafted
 * player, not by franchise id, and folded into franchises here at read time.
 * Two reasons: the server never needs a copy of the alias table (it would be
 * a second source of truth that silently drifts), and if a franchise is
 * renamed later, historical progress re-aggregates correctly instead of being
 * stranded under a dead key.
 */
export function bannerProgress(franchise, profile) {
  const counts = profile.teamBanners || {};
  const drafted = teamNamesFor(franchise).reduce((sum, team) => sum + (counts[team] || 0), 0);
  return {
    drafted,
    required: BANNER_THRESHOLD,
    unlocked: drafted >= BANNER_THRESHOLD,
    percent: Math.min(100, (100 * drafted) / BANNER_THRESHOLD),
  };
}

export function bannerSummary(profile, sport = "nba") {
  const list = franchisesForSport(sport);
  const unlocked = list.filter((f) => bannerProgress(f, profile).unlocked).length;
  return { unlocked, total: list.length };
}

// Banner progress is awarded server-side (a trigger on match_results, see
// the award_banner_progress migration) and only for ranked wins. Practice
// runs entirely on the client, so letting the client grant banners would make
// them self-reportable - and practice isn't supposed to earn them anyway.
