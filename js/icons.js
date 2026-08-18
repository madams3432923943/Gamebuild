// Profile icons: the mark on your identity card, and the third thing you can
// earn after banners and badges.
//
// WHAT THIS REPLACED
//
// The circle on the home card was the literal character "🏀", typed into
// index.html, never touched by any code. The comment beside it said it showed
// your top sport; nothing anywhere derived a top sport. So a football player
// who had never opened basketball still wore a basketball, and the one piece
// of the identity card most obviously personal was the only one that was not.
//
// Icons fix that twice over: the DEFAULT icon really does follow whichever
// sport you play best, and everything else on the shelf is something you
// earned.
//
// WHY IT IS SHAPED LIKE js/banners.js
//
// Deliberately the same catalogue-plus-progress shape as banners: a list of
// entries, each with a threshold and a progress() over the normalized profile,
// plus an owner grant escape hatch. Doing it any other way would have meant a
// second set of unlock semantics for the Rewards screen to special-case, and
// the tiles on that screen are one renderer.
//
// TEAM ICONS ARE EARNED WITH AN MVP, AND ONLY ONLINE
//
// A team banner is drafting ten of a franchise's players in ranked wins - it
// measures how well you know the roster. A team icon asks for something
// sharper: one of that franchise's players had to be the best player on the
// floor in a ranked game you won. Once. It is a thing you remember, which is
// what makes it worth wearing.
//
// Only ONLINE ranked games count, for the same reason banners only count them:
// practice runs entirely on the client, so an offline MVP is self-reportable
// and an award you can hand yourself is not an award. profiles.mvp_counts
// exists and is explicitly the offline tally - it is deliberately NOT what
// this reads. The counter here, profiles.mvp_teams, is written by the trusted
// server inside finalize_match_result and by nothing else.
//
// COSMETIC ONLY, like everything else on this shelf. Nothing reachable from
// here touches a rating, a record or a simulation.

import { FRANCHISES, franchisesForSport, teamNamesFor } from "./banners.js";
import { emblemIdFor, EMBLEMS } from "./emblems.js";
import { SPORTS, sportById, DEFAULT_SPORT_ID } from "./sports/index.js";

/** MVPs from a franchise's players, in won ranked games, to wear its mark. */
export const ICON_MVP_THRESHOLD = 1;

/** Worn by anyone who has not chosen otherwise, and never lockable. */
export const DEFAULT_ICON_ID = "sport";

/** Ids of team icons are namespaced so they can never be confused with a
 * franchise's BANNER id, which is the bare nickname. The two live in different
 * columns, but they are read side by side on the Rewards screen and in the
 * grant list, and "lakers" meaning one thing in one column and another in the
 * next is a trap nobody needs. */
export const TEAM_ICON_PREFIX = "team-";

/**
 * The sport this player is best at, for the default icon.
 *
 * Ranked rating first, since that is the only comparable measure across
 * sports, and games played as the tie-break so a fresh 500 in a sport you have
 * touched once does not outrank the one you actually play. Falls back to the
 * app's default sport for a profile with no ranked history at all, rather than
 * to nothing - a new player still gets a mark.
 */
export function topSportId(profile) {
  const ratings = (profile && profile.sportRatings) || {};
  let best = null;
  for (const meta of SPORTS) {
    if (!meta.live) continue;
    const entry = ratings[meta.id];
    if (!entry || !entry.games) continue;
    const score = [entry.rating || 0, entry.games || 0];
    if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) {
      best = { id: meta.id, score };
    }
  }
  return best ? best.id : DEFAULT_SPORT_ID;
}

/** Ids force-unlocked for this player, from profiles.granted_icons.
 *
 * The same owner override banners and badges already have, and the same
 * contract: an unknown id grants nothing rather than breaking a screen, and
 * nothing grantable here affects a rating or a record. See
 * docs/granting-unlocks.md. */
function isGranted(profile, id) {
  const granted = profile && profile.grantedIcons;
  return Array.isArray(granted) && granted.includes(id);
}

/** Ranked MVPs won with players from one franchise.
 *
 * Keyed server-side by the RAW team name on the player, folded across the
 * franchise's aliases here - identical to banner progress, and for the same
 * reason: the server never needs a copy of the alias table, and a franchise
 * renamed later re-aggregates instead of stranding its history under a dead
 * key. */
export function mvpsForFranchise(franchise, profile) {
  const counts = (profile && profile.mvpTeams) || {};
  return teamNamesFor(franchise).reduce((sum, team) => sum + (counts[team] || 0), 0);
}

/** Every ranked MVP this player has won, across all franchises. */
function totalRankedMvps(profile) {
  return Object.values((profile && profile.mvpTeams) || {}).reduce((sum, n) => sum + (n || 0), 0);
}

/**
 * Icons that belong to no franchise.
 *
 * Built on counters that already exist and are already trusted - ranked wins,
 * friendships, and the MVP tally these icons introduce. Nothing here invents a
 * requirement it cannot measure, which is the mistake the clan banners are
 * honest about rather than repeating.
 */
export const GENERAL_ICONS = [
  {
    id: DEFAULT_ICON_ID,
    name: "Your Sport",
    blurb: "Follows whichever sport you rank highest in.",
    // Resolved per profile rather than fixed, which is the whole point of it -
    // see iconGlyph below.
    dynamic: true,
    progress: () => ({ value: 1, required: 1, unlocked: true }),
  },
  ...[
    { id: "spark", emoji: "🔥", need: 5 },
    { id: "comet", emoji: "☄️", need: 25 },
    { id: "crown-icon", emoji: "👑", need: 100 },
    { id: "gem", emoji: "💎", need: 250 },
  ].map((t) => ({
    id: t.id,
    name: { spark: "Spark", comet: "Comet", "crown-icon": "Crown", gem: "Gem" }[t.id],
    emoji: t.emoji,
    blurb: `Win ${t.need} online ranked games.`,
    progress: (profile) => {
      const value = profile.onlineWins || 0;
      return { value, required: t.need, unlocked: value >= t.need };
    },
  })),
  {
    id: "handshake",
    name: "Handshake",
    emoji: "🤝",
    blurb: "Add 3 friends.",
    progress: (profile) => {
      const value = profile.friendCount || 0;
      return { value, required: 3, unlocked: value >= 3 };
    },
  },
  ...[
    { id: "trophy", name: "Trophy", emoji: "🏆", need: 1 },
    { id: "dynasty", name: "Dynasty", emoji: "🏛️", need: 25 },
  ].map((t) => ({
    id: t.id,
    name: t.name,
    emoji: t.emoji,
    blurb:
      t.need === 1
        ? "Have one of your players win MVP in a ranked game you won."
        : `Win ${t.need} ranked MVPs.`,
    progress: (profile) => {
      const value = totalRankedMvps(profile);
      return { value, required: t.need, unlocked: value >= t.need };
    },
  })),
];

/**
 * What a team icon is CALLED: the city, never the nickname.
 *
 * "Buffalo", not "Buffalo Bills". The nickname is the registered trademark -
 * the city is a place, and naming the place a team plays in is not a use of
 * anyone's mark. The emblem beside it is original art in the team's colours,
 * so between the two nothing on this shelf is a team's mark or a team's logo,
 * which is exactly what the shelf should be able to say for itself.
 *
 * This does NOT make the app trademark-free, and it is not meant to read that
 * way: the draft board, the squad banners and the reward banners all still
 * name real teams in full, because a game about recalling real players cannot
 * avoid naming the teams they played for. See the disclaimer on the sign-in
 * screen. This is the one surface where the full name bought nothing.
 *
 * Cities are an explicit field on each franchise rather than the team name
 * with the last word chopped off. "Portland Trail Blazers" and "Thunder /
 * SuperSonics" both defeat that trick, and a franchise whose city silently
 * came out wrong would be the kind of plausible-looking error that never gets
 * noticed - scripts/verify-icons.mjs fails the build if one is missing.
 */
function cityLabel(franchise) {
  return franchise.city || franchise.name;
}

/**
 * Two teams in one sport can share a city - Los Angeles and New York each have
 * two football teams, and LA has two basketball teams - so the city alone is
 * not a label. Where it collides, the emblem's own plain-English name comes
 * along: "New York · Rocket", "New York · Shield". That describes the picture
 * on the tile, which is the thing that actually tells them apart, and it is a
 * description of our own drawing rather than anyone's nickname.
 */
function labelFor(franchise) {
  const sameCity = FRANCHISES.filter(
    (f) => f.sport === franchise.sport && cityLabel(f) === cityLabel(franchise)
  );
  if (sameCity.length < 2) return cityLabel(franchise);
  const emblem = EMBLEMS[emblemIdFor(franchise.id)];
  return emblem ? `${cityLabel(franchise)} · ${emblem.name}` : cityLabel(franchise);
}

/** One icon per franchise, derived from the franchise table rather than
 * restated - a franchise added there gets its icon the same day. */
function teamIcon(franchise) {
  const label = labelFor(franchise);
  return {
    id: `${TEAM_ICON_PREFIX}${franchise.id}`,
    name: label,
    city: cityLabel(franchise),
    sport: franchise.sport,
    franchise,
    emblem: emblemIdFor(franchise.id),
    // "a player from Atlanta" rather than "a Atlanta player": the city goes
    // after the noun so the sentence never has to pick between a and an.
    blurb: `Win a ranked MVP with a player from ${cityLabel(franchise)}.`,
    progress: (profile) => {
      const value = mvpsForFranchise(franchise, profile);
      return { value, required: ICON_MVP_THRESHOLD, unlocked: value >= ICON_MVP_THRESHOLD };
    },
  };
}

export const TEAM_ICONS = FRANCHISES.map(teamIcon);

/** Team icons for one sport - mirrors franchisesForSport/badgesForSport so
 * the Rewards subtabs filter all three shelves the same way. */
export function teamIconsForSport(sport = DEFAULT_SPORT_ID) {
  return franchisesForSport(sport).map(teamIcon);
}

const BY_ID = new Map([...GENERAL_ICONS, ...TEAM_ICONS].map((icon) => [icon.id, icon]));

export function iconById(id) {
  return BY_ID.get(id) || null;
}

/** The icon a profile actually wears.
 *
 * Never null. An id that no longer resolves - a retired icon, a typo, a column
 * written by a newer client - falls back to the default rather than leaving
 * the identity card with a hole in it, the same contract equippedBanner and
 * equippedKit already hold. */
export function equippedIcon(profile) {
  return iconById(profile && profile.equippedIcon) || iconById(DEFAULT_ICON_ID);
}

/**
 * What to actually draw for an icon, resolved against the profile wearing it.
 *
 * Two shapes come back and a renderer has to tell them apart:
 *   { kind: "emoji", glyph }              a character, drawn as text
 *   { kind: "emblem", emblem, colors }    a drawing, drawn by emblemSvg
 *
 * The default icon is the reason this takes a profile at all: "Your Sport" is
 * not one glyph, it is whichever sport you rank highest in today.
 */
export function iconGlyph(icon, profile) {
  if (!icon) return { kind: "emoji", glyph: "★" };
  if (icon.dynamic) {
    const sport = sportById(topSportId(profile)) || sportById(DEFAULT_SPORT_ID);
    return { kind: "emoji", glyph: (sport && sport.icon) || "★" };
  }
  if (icon.franchise) {
    return { kind: "emblem", emblem: icon.emblem, colors: icon.franchise.colors, label: icon.name };
  }
  return { kind: "emoji", glyph: icon.emoji || "★" };
}

/** Progress for one icon, in the shape the reward tiles already read for
 * banners: { value, required, unlocked, percent, granted }. */
export function iconProgress(icon, profile) {
  const { value, required, unlocked } = icon.progress(profile);
  if (!unlocked && isGranted(profile, icon.id)) {
    return { value, required, unlocked: true, percent: 100, granted: true };
  }
  return { value, required, unlocked, percent: Math.min(100, (100 * value) / required) };
}

/** How many of a sport's team icons are unlocked, for the shelf's subtitle. */
export function iconSummary(profile, sport = DEFAULT_SPORT_ID) {
  const list = teamIconsForSport(sport);
  return { unlocked: list.filter((i) => iconProgress(i, profile).unlocked).length, total: list.length };
}
