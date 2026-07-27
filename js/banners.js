// Team banners: the first earnable reward. You unlock a franchise's banner by
// drafting enough of its players in games you actually won, then equip one to
// fly it on your profile and home screen.
//
// Why this shape:
//  - It rewards depth in a franchise rather than luck, which is the same thing
//    the game already tests. Farming one team means genuinely knowing its
//    roster across eras.
//  - It's cosmetic only. Nothing here touches simulation or rank - a reward
//    that granted an edge would turn ranked into a measure of playtime instead
//    of knowledge.
//  - Art is a color pair plus initials, generated from the franchise entry
//    below. No player likenesses, nothing to license, and it scales to every
//    team without commissioning a single asset.

import { PLAYERS } from "./data.js";

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
  { id: "hawks", name: "Atlanta Hawks", abbr: "ATL", colors: ["#e03a3e", "#26282a"], aliases: [] },
  { id: "celtics", name: "Boston Celtics", abbr: "BOS", colors: ["#007a33", "#ba9653"], aliases: [] },
  {
    id: "nets",
    name: "Brooklyn Nets",
    abbr: "BKN",
    colors: ["#000000", "#ffffff"],
    aliases: ["New Jersey Nets", "Brooklyn/New Jersey Nets"],
  },
  {
    id: "hornets",
    name: "Charlotte Hornets",
    abbr: "CHA",
    colors: ["#1d1160", "#00788c"],
    aliases: ["Charlotte Bobcats"],
  },
  { id: "bulls", name: "Chicago Bulls", abbr: "CHI", colors: ["#ce1141", "#000000"], aliases: [] },
  { id: "cavaliers", name: "Cleveland Cavaliers", abbr: "CLE", colors: ["#860038", "#fdbb30"], aliases: [] },
  { id: "mavericks", name: "Dallas Mavericks", abbr: "DAL", colors: ["#00538c", "#002b5e"], aliases: [] },
  { id: "nuggets", name: "Denver Nuggets", abbr: "DEN", colors: ["#0e2240", "#fec524"], aliases: [] },
  { id: "pistons", name: "Detroit Pistons", abbr: "DET", colors: ["#c8102e", "#1d42ba"], aliases: [] },
  { id: "warriors", name: "Golden State Warriors", abbr: "GSW", colors: ["#1d428a", "#ffc72c"], aliases: [] },
  { id: "rockets", name: "Houston Rockets", abbr: "HOU", colors: ["#ce1141", "#000000"], aliases: [] },
  { id: "pacers", name: "Indiana Pacers", abbr: "IND", colors: ["#002d62", "#fdbb30"], aliases: [] },
  {
    id: "clippers",
    name: "LA Clippers",
    abbr: "LAC",
    colors: ["#c8102e", "#1d428a"],
    aliases: ["San Diego Clippers", "Los Angeles Clippers"],
  },
  { id: "lakers", name: "LA Lakers", abbr: "LAL", colors: ["#552583", "#fdb927"], aliases: ["Los Angeles Lakers"] },
  {
    id: "grizzlies",
    name: "Memphis Grizzlies",
    abbr: "MEM",
    colors: ["#5d76a9", "#12173f"],
    aliases: ["Vancouver Grizzlies"],
  },
  { id: "heat", name: "Miami Heat", abbr: "MIA", colors: ["#98002e", "#f9a01b"], aliases: [] },
  { id: "bucks", name: "Milwaukee Bucks", abbr: "MIL", colors: ["#00471b", "#eee1c6"], aliases: [] },
  { id: "timberwolves", name: "Minnesota Timberwolves", abbr: "MIN", colors: ["#0c2340", "#78be20"], aliases: [] },
  {
    id: "pelicans",
    name: "New Orleans Pelicans",
    abbr: "NOP",
    colors: ["#0c2340", "#c8102e"],
    aliases: ["New Orleans Hornets", "New Orleans Hornets/Pelicans"],
  },
  { id: "knicks", name: "New York Knicks", abbr: "NYK", colors: ["#006bb6", "#f58426"], aliases: [] },
  {
    // Sonics and Thunder are one franchise on paper, and the 2000s squad
    // deliberately spans the move, so they share a banner.
    id: "thunder",
    name: "Thunder / SuperSonics",
    abbr: "OKC",
    colors: ["#007ac1", "#ef3b24"],
    aliases: ["Oklahoma City Thunder", "Seattle SuperSonics", "Seattle SuperSonics / OKC Thunder"],
  },
  { id: "magic", name: "Orlando Magic", abbr: "ORL", colors: ["#0077c0", "#c4ced4"], aliases: [] },
  { id: "sixers", name: "Philadelphia 76ers", abbr: "PHI", colors: ["#006bb6", "#ed174c"], aliases: [] },
  { id: "suns", name: "Phoenix Suns", abbr: "PHX", colors: ["#1d1160", "#e56020"], aliases: [] },
  { id: "blazers", name: "Portland Trail Blazers", abbr: "POR", colors: ["#e03a3e", "#000000"], aliases: [] },
  { id: "kings", name: "Sacramento Kings", abbr: "SAC", colors: ["#5a2d81", "#63727a"], aliases: [] },
  { id: "spurs", name: "San Antonio Spurs", abbr: "SAS", colors: ["#c4ced4", "#000000"], aliases: [] },
  { id: "raptors", name: "Toronto Raptors", abbr: "TOR", colors: ["#ce1141", "#000000"], aliases: [] },
  { id: "jazz", name: "Utah Jazz", abbr: "UTA", colors: ["#002b5c", "#00471b"], aliases: [] },
  {
    id: "wizards",
    name: "Washington Wizards",
    abbr: "WAS",
    colors: ["#002b5c", "#e31837"],
    aliases: ["Washington Bullets"],
  },
];

const TEAM_TO_FRANCHISE = new Map();
for (const f of FRANCHISES) {
  TEAM_TO_FRANCHISE.set(f.name, f.id);
  for (const alias of f.aliases) TEAM_TO_FRANCHISE.set(alias, f.id);
}

/** Franchise id for a squad's team string, or null if it isn't one we know.
 * Returning null rather than guessing keeps a renamed team from silently
 * building progress toward the wrong banner. */
export function franchiseIdForTeam(teamName) {
  return TEAM_TO_FRANCHISE.get(teamName) || null;
}

export function franchiseById(id) {
  return FRANCHISES.find((f) => f.id === id) || null;
}

/** Any team string in the dataset that no franchise claims. Surfaces naming
 * drift (a new era-accurate label, a typo) instead of letting it quietly
 * break banner progress. */
export function unmappedTeams(players = PLAYERS) {
  const missing = new Set();
  for (const p of players) {
    if (!franchiseIdForTeam(p.team)) missing.add(p.team);
  }
  return [...missing];
}

export function bannerProgress(franchise, profile) {
  const drafted = (profile.teamBanners && profile.teamBanners[franchise.id]) || 0;
  return {
    drafted,
    required: BANNER_THRESHOLD,
    unlocked: drafted >= BANNER_THRESHOLD,
    percent: Math.min(100, (100 * drafted) / BANNER_THRESHOLD),
  };
}

export function bannerSummary(profile) {
  const unlocked = FRANCHISES.filter((f) => bannerProgress(f, profile).unlocked).length;
  return { unlocked, total: FRANCHISES.length };
}

/**
 * Per-franchise counts to add after a win, given the teams of the players you
 * drafted. Losses contribute nothing - a banner is meant to say you won with
 * that team, not that you played with them.
 */
export function bannerGainsFromWin(draftedTeams) {
  const gains = {};
  for (const team of draftedTeams) {
    const id = franchiseIdForTeam(team);
    if (id) gains[id] = (gains[id] || 0) + 1;
  }
  return gains;
}
