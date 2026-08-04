// What changed about YOU after a game, and making it feel like something.
//
// Badges, banners and rank in this game are all derived - they are read out of
// profile counters on demand rather than being "unlocked" by an event. That is
// the right way to store them (there is no unlock table to drift out of sync)
// but it means nothing ever announces itself: you finish a game, and a badge
// you just earned is sitting quietly on a tab you might open next week.
//
// So this snapshots the derived state before a game and diffs it after. The
// diff is the announcement.

import { BADGES, badgeProgress, badgesForSport } from "./badges.js";
import { franchisesForSport, bannerProgress } from "./banners.js";

/** Everything worth noticing a change in, flattened so two snapshots can be
 * compared without either knowing how the other was produced. */
export function snapshotProgress(profile, sportId = "nba") {
  if (!profile) return null;

  const badges = {};
  for (const badge of badgesForSport(sportId)) {
    badges[badge.id] = badgeProgress(badge, profile).tierIndex;
  }

  // Read through bannerProgress rather than off the raw counters: progress is
  // stored per RAW team name and folded into franchises at read time (see
  // banners.js), so a franchise's total isn't a single field to snapshot.
  const banners = {};
  for (const franchise of franchisesForSport(sportId)) {
    banners[franchise.id] = bannerProgress(franchise, profile).unlocked;
  }

  return {
    badges,
    banners,
    onlineWins: profile.onlineWins || 0,
    onlineLosses: profile.onlineLosses || 0,
    totalGames: (profile.history && profile.history.length) || 0,
  };
}

/**
 * What to celebrate, most significant first.
 *
 * Ordering matters more than it looks: a game can produce a rank-up AND two
 * badge tiers AND a banner, and showing all four at once is noise. The caller
 * takes the top item as the headline and lists the rest.
 *
 * @returns [{ kind, title, detail }] - empty when nothing improved, which is
 *   most games, and is exactly when nothing should pop up.
 */
export function progressGains(before, after, { rankBefore, rankAfter } = {}) {
  const gains = [];
  if (!before || !after) return gains;

  // Rank first: it's the thing the ladder is for.
  const tierBefore = rankBefore && !rankBefore.provisional ? rankBefore.tier.name : null;
  const tierAfter = rankAfter && !rankAfter.provisional ? rankAfter.tier.name : null;
  if (tierAfter && tierAfter !== tierBefore) {
    // Read off the tiers the two standings already carry rather than looking
    // them up again: a lookup goes through the ACTIVE sport's ladder, and
    // these two standings belong to whichever sport was just played. The
    // moment those differ, a rank-up in one sport would be measured against
    // another sport's bands.
    const climbed = !tierBefore || rankAfter.tier.minPercentile > rankBefore.tier.minPercentile;
    if (climbed) {
      gains.push({
        kind: "rank",
        title: `Ranked up: ${tierAfter}`,
        detail: tierBefore ? `Up from ${tierBefore}.` : "You've been placed on the ladder.",
      });
    }
  } else if (rankBefore && rankBefore.provisional && rankAfter && !rankAfter.provisional) {
    gains.push({
      kind: "rank",
      title: `Placed: ${rankAfter.tier.name}`,
      detail: "Your placement games are done - you're on the ladder.",
    });
  }

  // Badge tiers.
  for (const badge of BADGES) {
    const wasAt = before.badges[badge.id];
    const nowAt = after.badges[badge.id];
    if (wasAt === undefined || nowAt === undefined || nowAt <= wasAt) continue;
    gains.push({
      kind: "badge",
      title: wasAt < 0 ? `Badge earned: ${badge.name}` : `Badge upgraded: ${badge.name}`,
      detail: badge.blurb || "",
      badgeId: badge.id,
      tierIndex: nowAt,
    });
  }

  // Banners: only a newly COMPLETED one is news. Progress toward one is
  // already visible on the Rewards tab and doesn't need announcing.
  for (const id of Object.keys(after.banners)) {
    if (before.banners[id] || !after.banners[id]) continue;
    gains.push({
      kind: "banner",
      title: "Banner raised",
      detail: "A new team banner is yours to equip on the Profile tab.",
      franchiseId: id,
    });
  }

  return gains;
}
