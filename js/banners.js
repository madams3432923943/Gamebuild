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

// The era-mastery ladder needs to know which brackets a sport HAS, and how a
// per-era record is keyed. Both come from the registry rather than being
// restated here, so the ladder follows a sport that changes its eras.
import { activeSport, eraRecordKey } from "./sports/index.js";

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

/** Shared shape for an artwork banner. The id is derived from the filename so
 * the two can never drift apart, and `hideAbbr` is always on: stamping a
 * three-letter code over real artwork is a label competing with the thing it
 * labels, and the tile prints the name underneath anyway. */
function bannerBase(t) {
  return {
    // The id is PERSISTED - profiles.equipped_banner and granted_banners store
    // it - so it cannot follow the filename around. `id` overrides the derived
    // value for exactly that case: Pink Blossom's file was renamed from
    // blossom to Pink-Blossom during the artwork upload, and deriving the id
    // from the new name would have silently unequipped every player flying it
    // and voided their grant.
    id: t.id || t.file.toLowerCase(),
    name: t.name,
    abbr: t.name.slice(0, 3).toUpperCase(),
    colors: t.colors,
    // Case-sensitive: GitHub Pages serves these paths literally.
    // JPEG, not PNG: the artwork is photographic texture, where lossless
    // costs ~6x the bytes for no visible gain. See tools/build-banner-art.mjs.
    image: `assets/banners/${t.file}.jpg`,
    hideAbbr: true,
  };
}

/** The fewest online wins this player has in any one era bracket.
 *
 * Reads era_records directly rather than through eraRecord() in js/profile.js,
 * because profile.js imports THIS file for DEFAULT_BANNER_ID and importing
 * back would be a cycle - the same reason the streak ladder this replaced
 * inlined its own loop.
 *
 * Only the ONLINE counter counts. Practice is unverified, and a reward you can
 * grant yourself against a bot isn't worth earning - the same rule every other
 * ranked banner follows.
 *
 * The bracket list comes from the sport, not a hardcoded array, so this stays
 * correct when a second sport brings its own eras. "All Years" is skipped: it
 * is every player in the dataset, so winning there says nothing about knowing
 * a particular decade.
 */
function winsInEveryEra(profile) {
  const sport = activeSport();
  const brackets = (sport.eras || []).filter((e) => e.id !== "all");
  if (!brackets.length) return 0;
  const records = profile.eraRecords || {};
  let fewest = Infinity;
  for (const era of brackets) {
    const record = records[eraRecordKey(sport.id, era.id)] || {};
    fewest = Math.min(fewest, record.online_wins || 0);
  }
  return fewest === Infinity ? 0 : fewest;
}

export const GENERAL_BANNERS = [
  {
    id: DEFAULT_BANNER_ID,
    name: "Rookie",
    abbr: "RK",
    colors: ["#7a5236", "#3d2a1c"],
    blurb: "Every player starts here.",
    progress: () => ({ value: 1, required: 1, unlocked: true }),
  },
  // ---- The reward ladders -------------------------------------------------
  // Real artwork now (assets/banners/*.jpg), so these carry `image` rather
  // than the generated `art` pattern they used to. `colors` stays as the
  // fallback painted underneath - a slow or missing file shows the banner's
  // own two colors instead of a hole.
  //
  // Four ladders, each measuring a different thing, so a player always has
  // more than one thing to be chasing.

  // 1. Ranked wins. Crystal sits far out on purpose: it is the one banner
  // meant to be genuinely rare, so it can't share a tier with anything
  // reachable in a weekend.
  ...[
    { file: "Forest-Pixel", name: "Forest Pixel", need: 10, colors: ["#4b5320", "#2f3317"] },
    { file: "Desert-Wind", name: "Desert Wind", need: 25, colors: ["#c2a373", "#7a6242"] },
    { file: "Reptile", name: "Reptile", need: 50, colors: ["#8a6a3a", "#241c10"] },
    // id pinned to "blossom": that is what is already stored in players'
    // equipped_banner and granted_banners, from before the file was renamed.
    { file: "Pink-Blossom", id: "blossom", name: "Pink Blossom", need: 75, colors: ["#e88aa8", "#4a3038"] },
    { file: "Purple-Wind", name: "Purple Wind", need: 100, colors: ["#7d3fc4", "#2a1240"] },
    { file: "Blue-Wave", name: "Blue Wave", need: 150, colors: ["#1f5fd0", "#0d1c3a"] },
    { file: "Arctic-Stripe", name: "Arctic Stripe", need: 200, colors: ["#c9d3dc", "#3a434d"] },
    { file: "Carbon-Fiber", name: "Carbon Fiber", need: 300, colors: ["#4a4f55", "#15181b"] },
    { file: "Gold", name: "Gold", need: 400, colors: ["#e8c14a", "#8a6a12"] },
    { file: "Crystal", name: "Crystal", need: 500, colors: ["#cfd8de", "#5b6a75"] },
  ].map((t) => ({
    ...bannerBase(t),
    blurb: `Win ${t.need} online ranked games.`,
    progress: (profile) => {
      const value = profile.onlineWins || 0;
      return { value, required: t.need, unlocked: value >= t.need };
    },
  })),

  // 2. Friends. Counted from accepted friendships (see countFriends in
  // js/friends.js) rather than anything on the profile row, because who is
  // friends with whom lives in its own table and is deliberately not public.
  ...[
    { file: "Wild-Fur", name: "Wild Fur", need: 3, colors: ["#c99a4e", "#2b2015"] },
    { file: "Skulls", name: "Skulls", need: 10, colors: ["#d8d8d8", "#1a1a1a"] },
    { file: "Inferno", name: "Inferno", need: 25, colors: ["#e3541f", "#2a0c05"] },
  ].map((t) => ({
    ...bannerBase(t),
    blurb: `Add ${t.need} friends.`,
    progress: (profile) => {
      const value = profile.friendCount || 0;
      return { value, required: t.need, unlocked: value >= t.need };
    },
  })),

  // 3. Era mastery. The MINIMUM online wins across every narrow era bracket,
  // not the total: this is the one ladder that can't be farmed in a single
  // decade, and taking the minimum is what forces breadth. "All Years" is
  // excluded because it is the unfiltered pool - counting it would let one
  // bracket carry the ladder and defeat the whole point.
  ...[
    { file: "Volcanic", name: "Volcanic", need: 1, colors: ["#e0491a", "#1c0d07"] },
    { file: "Crimson-Splat", name: "Crimson Splat", need: 3, colors: ["#b81f28", "#1a1416"] },
    { file: "Good-Luck", name: "Good Luck", need: 10, colors: ["#2f8f5b", "#12251a"] },
  ].map((t) => ({
    ...bannerBase(t),
    blurb: `Win ${t.need} online game${t.need === 1 ? "" : "s"} in every era.`,
    progress: (profile) => {
      const value = winsInEveryEra(profile);
      return { value, required: t.need, unlocked: value >= t.need };
    },
  })),

  // 4. Clan tournaments. Clans do not exist yet - no table, no code - so
  // these are deliberately unearnable rather than being given a stand-in
  // requirement. A banner nobody can earn YET is honest; one with a fake
  // condition is not, and would have to be taken away later. `pending` lets
  // the tile say so instead of showing 0% progress toward nothing.
  ...[
    { file: "Woodland-Camo", name: "Woodland Camo", need: 1, colors: ["#4b5320", "#2f3317"] },
    { file: "Hunter", name: "Hunter", need: 5, colors: ["#6b5b3e", "#241f14"] },
    { file: "Stealth", name: "Stealth", need: 15, colors: ["#3a3f45", "#111316"] },
    { file: "Urban-Camo", name: "Urban Camo", need: 30, colors: ["#9aa0a6", "#26292d"] },
  ].map((t) => ({
    ...bannerBase(t),
    pending: true,
    blurb: `Win ${t.need} clan tournament${t.need === 1 ? "" : "s"}. Clans are still being built.`,
    // Always zero: there is nothing to count yet. The thresholds are real
    // though, so the ladder reads as a climb now and needs no retuning when
    // clans land - only a source for `value`.
    progress: () => ({ value: 0, required: t.need, unlocked: false }),  })),
];

export function generalBannerById(id) {
  return GENERAL_BANNERS.find((b) => b.id === id) || null;
}

/** Progress for one general banner, in the same shape bannerProgress()
 * returns for franchise banners so the tile renderer can treat both alike. */
export function generalBannerProgress(banner, profile) {
  const { value, required, unlocked } = banner.progress(profile);
  // GRANTED, from profiles.granted_banners - see isGranted above.
  //
  // This replaced a hardcoded founder id check. The ladders here are computed
  // live from real counters, and the clan ladder from nothing at all (clans do
  // not exist; its progress function ignores the profile and returns false), so
  // there is no data to write that would unlock them. Inflating online_wins
  // would have been the obvious shortcut and is wrong twice over: it is a real
  // ranked record, it feeds the ELO and the percentile everyone else is measured
  // against, and it still would not have touched the clan banners.
  //
  // A grant changes what is UNLOCKED without lying about what was PLAYED, and
  // `granted` is passed through so a tile can say so rather than implying 500
  // ranked wins that never happened.
  if (!unlocked && isGranted(profile, banner.id)) {
    return { drafted: required, value, required, unlocked: true, percent: 100, granted: true };
  }
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

/**
 * Ids force-unlocked for this player, from profiles.granted_banners.
 *
 * The override the owner controls. A grant used to be a hardcoded id check in
 * this file, which meant every future favour - a friend, a tester, an apology
 * for a bug - was a code change, a test run, a push, and a wait on a Pages
 * deploy that has failed with a 503 more than once. Now it is one row edit and
 * takes effect on the next page load.
 *
 * Unknown ids are simply never matched, so a typo grants nothing rather than
 * breaking a screen, and an id written for a banner that ships next week starts
 * working the day it does.
 *
 * COSMETIC ONLY. Nothing reachable from here touches a rating, a record or a
 * result - those are the trusted server's and must never be grantable.
 */
function isGranted(profile, id) {
  const granted = profile && profile.grantedBanners;
  return Array.isArray(granted) && granted.includes(id);
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
  if (drafted < BANNER_THRESHOLD && isGranted(profile, franchise.id)) {
    return { drafted, required: BANNER_THRESHOLD, unlocked: true, percent: 100, granted: true };
  }
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
