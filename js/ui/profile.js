// The player's own screens: rank, banners, icons, badges, records, history.
//
// Extracted from js/ui.js - see the note at the top of that file. This is the
// largest of the pieces and the most cosmetic, which is why it comes out last
// of the four: everything here is about how a player is PRESENTED rather than
// about how a game is played, so it is the half most likely to be edited on its
// own, and it was the half hardest to find while it sat in the middle of a
// 3,182-line file.
//
// bannerArt is not here. It went out first, in js/ui/banner-art.js, because the
// squad screens need it too.

import { escapeHtml } from "../lib/escape-html.js";
import { SPORTS, sportById, eraRecordKey, DEFAULT_SPORT_ID, activeSport } from "../sports/index.js";
import { badgesForSport, badgeProgress, badgeSummary, badgeById } from "../badges.js";
import {
  BANNER_THRESHOLD,
  bannerProgress,
  bannerSummary,
  franchiseById,
  franchisesForSport,
  bannerById,
  FOUNDER_BANNER,
  isFounder,
  FIRST_PLAYER_BANNER,
  isFirstPlayer,
  GENERAL_BANNERS,
  generalBannerProgress,
  DEFAULT_BANNER_ID,
} from "../banners.js";
import {
  GENERAL_ICONS,
  teamIconsForSport,
  iconById,
  iconGlyph,
  iconProgress,
  iconSummary,
  equippedIcon,
  DEFAULT_ICON_ID,
} from "../icons.js";
import { emblemSvg } from "../emblems.js";
import { squadTierForRep } from "../squads.js";
import { bannerArt } from "./banner-art.js";
import { renderNote } from "./note.js";
import { roundStat } from "./format.js";
import {
  FEATURED_BADGE_SLOTS,
  RECENT_GAMES_SHOWN,
  eraRecord,
  mostDraftedPlayer,
  personalBestsFor,
  gameRecordFor,
  mostTripleDoubles,
  winStreaks,
  mostMVPs,
  historyFor,
} from "../profile.js";

export function renderTierSummary(badgeContainer, captionContainer, rankInfo) {
  badgeContainer.innerHTML = "";
  const badge = document.createElement("span");
  badge.className = "tier-badge";

  if (rankInfo.provisional) {
    badge.textContent = "Provisional";
    badgeContainer.appendChild(badge);
    const g = rankInfo.gamesNeeded;
    captionContainer.textContent = `${g} more online ${g === 1 ? "game" : "games"} to get a rank.`;
    return;
  }

  const { tier, next, percentile, rank, totalQualifying } = rankInfo;
  badge.textContent = tier.name;
  badgeContainer.appendChild(badge);

  const track = document.createElement("div");
  track.className = "progress-bar-track";
  const fill = document.createElement("div");
  fill.className = "progress-bar-fill";
  const pct = next
    ? Math.min(100, (100 * (percentile - tier.minPercentile)) / (next.minPercentile - tier.minPercentile))
    : 100;
  fill.style.width = `${pct}%`;
  track.appendChild(fill);
  badgeContainer.appendChild(track);

  // The rating leads, because it is the thing that actually moved: a player
  // who won and gained 18 points wants to see the 18, and the percentile only
  // changes when someone else's rating does.
  const ratingPart = rankInfo.rating === undefined ? "" : `${rankInfo.rating} rating — `;
  const standing = `${ratingPart}top ${Math.max(1, Math.round(100 - percentile))}% (#${rank} of ${totalQualifying})`;
  // The top rung is named by whichever ladder this is - the sport ladders end
  // in Legend, the all-sports one in GOAT - so it is read off the tier rather
  // than written in here.
  captionContainer.textContent = next
    ? `${standing} — climb into the top ${Math.round(100 - next.minPercentile)}% to reach ${next.name}.`
    : `${standing} — you've reached the top tier, ${tier.name}.`;
}

/** "Est. MM/YYYY" - a join-date plate in the style of a franchise banner's
 * own "Est. 1946", built from the account's creation date. */
function formatJoinTag(createdAt) {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `Est. ${mm}/${d.getFullYear()}`;
}

/** The player card: who you are, plus your online rep/rank and badges. It
 * leads the home screen, and both sides of the matchup intro are the same
 * card - see createPlayerBannerCard/renderPlayerBannerCard below.
 *
 * Deliberately doesn't show total games played or a per-sport breakdown -
 * those are private, and with only one sport live a per-sport list is just
 * one entry repeated. Total games still lives on the Profile screen itself
 * (your own stats, not something the banner broadcasts). */
/** Creates-or-updates one absolutely-positioned mark on the home banner card,
 * removing it when the equipped banner doesn't call for one. Idempotent
 * because renderPlayerBannerCard re-runs on every profile refresh. */
function setCardMark(card, className, text) {
  let el = card.querySelector(`.${className}`);
  if (!text) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("span");
    el.className = className;
    card.appendChild(el);
  }
  el.textContent = text;
}

/** Whether each artwork URL loaded. Checked once - renderPlayerBannerCard runs on
 *  every refreshHome(), and re-fetching the same file to ask the same question
 *  would be waste. `null` while in flight, so a slow load cannot queue a
 *  second probe for the same URL. */
const artLoadCache = new Map();

/** Drops the card back to the banner's own two colours when its artwork cannot
 *  be loaded - the same fallback the Rewards tiles use.
 *
 *  Worth having rather than trusting the files: the card paints the art on a
 *  layer over its own background, so without this a missing file leaves an
 *  empty layer covering the fallback, and the card renders as a blank slab. It
 *  earned its keep the day a banner was renamed in the browser and its file
 *  arrived two bytes long.
 *
 *  Whether the file is big enough is NOT checked here. That was the job of an
 *  earlier version, back when the artwork was too small to fill the card and
 *  the layout had a second treatment to fall back on. There is no second
 *  treatment now, and a size problem is better caught before it ships:
 *  scripts/verify-banner-resolution.mjs fails the build for it. */
function applyArtFallback(card, src) {
  if (artLoadCache.has(src)) {
    if (artLoadCache.get(src) === false) card.classList.remove("has-banner-image");
    return;
  }
  artLoadCache.set(src, null);
  const probe = new Image();
  probe.onload = () => artLoadCache.set(src, true);
  probe.onerror = () => {
    artLoadCache.set(src, false);
    // The card may have re-rendered onto a different banner while we waited.
    if (card.style.getPropertyValue("--banner-image").includes(src)) {
      card.classList.remove("has-banner-image");
    }
  };
  probe.src = src;
}

/** Adds or removes one of the card's background layers. Reused rather than
 *  recreated for the same reason as setCardMark: this runs on every
 *  refreshHome(), and appending would stack a new layer per refresh. */
function setCardLayer(card, className, on) {
  let el = card.querySelector(`.${className}`);
  if (!on) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.className = className;
    // Decoration, not content. The card already announces the equipped banner
    // in text, so a screen reader gains nothing from two empty divs.
    el.setAttribute("aria-hidden", "true");
    // First, so the layers paint under the name, badges and stats rather than
    // over them - the card's children are z-index 1.
    card.prepend(el);
  }
  return el;
}

/**
 * The DOM one player-banner card needs, built to match the static markup in
 * index.html's #player-banner element class for class.
 *
 * Exists because the card is no longer only the home screen's: the matchup
 * intro shows both players' cards, and those have to be created rather than
 * looked up. Two builders would be two cards that drift - which is exactly
 * what the intro was before this, a bare strip of banner artwork with a name
 * under it while the home screen showed the same player's icon, join date,
 * featured badges and rank.
 *
 * @param extraClass  a modifier for the context the card is being dropped
 *                    into (see .matchup-card in style.css). The card itself
 *                    is identical either way; only its scale changes.
 * @returns the same `refs` shape renderPlayerBannerCard takes, so a built
 *          card and the home screen's markup are interchangeable.
 */
export function createPlayerBannerCard(extraClass = "") {
  const card = document.createElement("div");
  card.className = "player-banner card" + (extraClass ? ` ${extraClass}` : "");

  const top = document.createElement("div");
  top.className = "pb-top";
  const avatar = document.createElement("span");
  avatar.className = "player-avatar";
  const identity = document.createElement("div");
  identity.className = "pb-identity";
  const username = document.createElement("div");
  username.className = "player-name";
  const tags = document.createElement("div");
  tags.className = "pb-tags";
  const joined = document.createElement("span");
  joined.className = "pb-joined hidden";
  tags.appendChild(joined);
  identity.append(username, tags);
  top.append(avatar, identity);

  const featured = document.createElement("div");
  featured.className = "pb-badges";
  const record = document.createElement("div");
  record.className = "pb-stats";
  card.append(top, featured, record);

  return { card, avatar, username, joined, featured, record };
}

/**
 * Paints one player-banner card: the equipped banner as the card's own
 * background, then the icon, name, join plate, featured badges and rank/record
 * on top of it.
 *
 * ONE renderer for every place a player's card appears - the home screen and
 * both sides of the matchup intro - for the same reason renderPlayerIcon is
 * one renderer: the two drifted the moment they were separate, and an
 * opponent's card showing less than your own makes the intro look like it is
 * hiding something rather than introducing someone.
 *
 * `profile` is a full normalized profile (see normalizeProfileRow in
 * js/profile.js), including an opponent's - which is why the opponent read in
 * js/online.js pulls the columns this reads rather than a hand-picked five.
 */
export function renderPlayerBannerCard(refs, profile, rankInfo) {
  refs.username.textContent = profile.username || "Player";

  // The equipped banner's own colors and ghosted abbreviation become the
  // whole card's background (see .player-banner.has-banner in style.css) -
  // a real banner behind the player, not a small icon next to their name.
  // Falls back to the plain panel background when nothing is equipped, so
  // the layout never depends on having earned something.
  const franchise = profile.equippedBanner ? bannerById(profile.equippedBanner) : null;
  refs.card.classList.toggle("has-banner", !!franchise);

  // Patterned banners (camo, the crew tiers, Founder) paint the card with the
  // same CSS treatment their tile uses, rather than flattening to a two-color
  // gradient. Equipping a camo and finding a plain fade on your profile is
  // the reward not actually being worn.
  for (const cls of [...refs.card.classList]) {
    if (cls.startsWith("banner-art-")) refs.card.classList.remove(cls);
  }

  if (franchise) {
    refs.card.style.setProperty("--banner-c1", franchise.colors[0]);
    refs.card.style.setProperty("--banner-c2", franchise.colors[1]);
    refs.card.style.setProperty("--art-c1", franchise.colors[0]);
    refs.card.style.setProperty("--art-c2", franchise.colors[1]);
    // Real artwork wins over the generated pattern.
    refs.card.classList.toggle("has-banner-image", !!franchise.image);
    // Resolved against the DOCUMENT, not left relative. A relative url() inside
    // a custom property resolves against the STYLESHEET that consumes it, so
    // "assets/banners/X.jpg" became "css/assets/banners/X.jpg" and 404'd - the
    // card silently fell back to its gradient. The tiles never hit this because
    // they set an <img src>, which resolves against the document. baseURI
    // rather than a leading slash, since Pages serves this from /Gamebuild/.
    if (franchise.image) {
      const src = new URL(franchise.image, document.baseURI).href;
      refs.card.style.setProperty("--banner-image", `url("${src}")`);
      applyArtFallback(refs.card, src);
    } else {
      refs.card.style.removeProperty("--banner-image");
    }
    // The artwork is the card. It is painted on a layer rather than on the card
    // itself so that a file which fails to load falls back to the card's own
    // background instead of covering it - see applyArtFallback above.
    setCardLayer(refs.card, "pb-banner-wash", !!franchise.image);
    if (franchise.art && !franchise.image) {
      refs.card.classList.add(`banner-art-${franchise.art}`);
      refs.card.dataset.bannerArt = franchise.art;
    } else {
      delete refs.card.dataset.bannerArt;
    }
    if (franchise.hideAbbr) delete refs.card.dataset.bannerAbbr;
    else refs.card.dataset.bannerAbbr = franchise.abbr;
  } else {
    for (const prop of ["--banner-c1", "--banner-c2", "--art-c1", "--art-c2", "--banner-image"]) {
      refs.card.style.removeProperty(prop);
    }
    refs.card.classList.remove("has-banner-image");
    setCardLayer(refs.card, "pb-banner-wash", false);
    delete refs.card.dataset.bannerAbbr;
    delete refs.card.dataset.bannerArt;
  }

  // Reused rather than recreated: this runs on every refreshHome(), and
  // appending would stack a new star on the card each time.
  setCardMark(refs.card, "pb-banner-emblem", franchise?.emblem);
  setCardMark(refs.card, "pb-banner-label", franchise?.label);
  // Lets the phone layout reserve room for the emblem, but only on the
  // banners that actually have one - every other banner would just get a
  // dead gutter down the right-hand side.
  refs.card.classList.toggle("has-emblem", !!franchise?.emblem);

  const joinTag = formatJoinTag(profile.createdAt);
  refs.joined.textContent = joinTag || "";
  refs.joined.classList.toggle("hidden", !joinTag);

  renderPlayerIcon(refs.avatar, profile);
  renderFeaturedBadges(refs.featured, profile);

  // The banner carries the GENERAL rank - the one on js/ranks.js's sport-
  // neutral ladder, off a rating averaged across every sport played. A banner
  // is the thing other players see in the matchup intro, and it should say
  // what kind of player you are rather than what kind of basketball player,
  // now that a second sport exists. Per-sport ranks live on the profile
  // screen, under that sport's own subtab.
  const rankName = rankInfo.provisional ? "Provisional" : rankInfo.tier.name;
  refs.record.innerHTML = "";
  const parts = [
    { label: "Rep", value: `${profile.onlineWins}-${profile.onlineLosses}` },
    { label: "Rank", value: rankName },
  ];
  // The rating itself, only once it means something. Showing "500" to someone
  // with two games would present the starting number as an achievement.
  if (!rankInfo.provisional) parts.push({ label: "Rating", value: String(rankInfo.rating) });
  for (const part of parts) {
    const stat = document.createElement("div");
    stat.className = "pb-stat";
    stat.innerHTML = `<span class="pb-stat-value"></span><span class="pb-stat-label"></span>`;
    stat.querySelector(".pb-stat-value").textContent = part.value;
    stat.querySelector(".pb-stat-label").textContent = part.label;
    refs.record.appendChild(stat);
  }
}

/**
 * Badge collection. Each badge ranks up through tiers rather than flipping
 * from locked to unlocked once, so an unearned badge still shows what it
 * tracks and how far along you are.
 */
/**
 * The mark on a player's identity card, drawn into `container`.
 *
 * ONE renderer for both places it appears - the home card and the profile
 * header - because they are the same thing and drifted apart the last time
 * they were not: the home card was a hardcoded basketball and the profile a
 * hardcoded star, so the same player had two identities depending on which
 * screen you were looking at.
 *
 * Two kinds of mark come back from iconGlyph and both are handled here, so no
 * caller has to know that some icons are characters and others are drawings.
 */
export function renderPlayerIcon(container, profile) {
  if (!container) return;
  const icon = equippedIcon(profile);
  const glyph = iconGlyph(icon, profile);
  container.innerHTML = "";
  container.classList.toggle("has-emblem-icon", glyph.kind === "emblem");
  // The name is on the container rather than inside the SVG so it reads the
  // same for the emoji case, which has no element to hang a title on.
  container.title = icon ? icon.name : "";

  if (glyph.kind === "emblem") {
    const svg = emblemSvg(glyph.emblem, glyph.colors, glyph.label);
    // A glyph id that does not resolve falls back to the character rather than
    // leaving an empty circle - see emblemSvg on why it returns null.
    if (svg) {
      container.appendChild(svg);
      return;
    }
  }
  container.textContent = glyph.glyph || "★";
}

/** The up-to-three badges a player chose to show off on their banner. Empty
 * slots are drawn as outlines so the feature reads as "you can fill these"
 * rather than looking broken. */
function renderFeaturedBadges(container, profile) {
  container.innerHTML = "";
  const ids = (profile.featuredBadges || []).slice(0, FEATURED_BADGE_SLOTS);

  for (let i = 0; i < FEATURED_BADGE_SLOTS; i++) {
    const id = ids[i];
    const badge = id ? badgeById(id) : null;
    const slot = document.createElement("div");
    slot.className = "pb-badge" + (badge ? "" : " empty");

    if (badge) {
      const progress = badgeProgress(badge, profile);
      slot.title = `${badge.name}${progress.tier ? ` — ${progress.tier.name}` : ""}`;
      const icon = document.createElement("span");
      icon.className = "pb-badge-icon";
      icon.textContent = badge.icon;
      slot.appendChild(icon);
      const tier = document.createElement("span");
      tier.className = "pb-badge-tier";
      tier.textContent = progress.tier ? progress.tier.icon : "";
      slot.appendChild(tier);
    } else {
      slot.textContent = "+";
      slot.title = "Feature a badge from the Badges tab";
    }
    container.appendChild(slot);
  }
}

/** The kinds of thing under the Rewards tab. Both get their own
 * sport-scoped subtabs underneath (see renderBadgeSportTabs/
 * renderBannerSportTabs) now that franchise banners come per-sport too. */
const UNLOCKABLE_KINDS = [
  { id: "badges", label: "Badges" },
  { id: "banners", label: "Banners" },
  { id: "icons", label: "Icons" },
  // Team Color is NOT here. It was added on the argument that this shelf is
  // "what you are wearing", but it is the one entry that is not an unlockable
  // - every kit is available from the first game - so it sat among three
  // grids of things you earn, looking like a fourth. It lives on the profile
  // screen, which is where it started and where it is the only picker on
  // screen rather than the odd one out.
];

export function renderUnlockableTabs(container, active, onSelect) {
  container.innerHTML = "";
  for (const kind of UNLOCKABLE_KINDS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "subtab" + (kind.id === active ? " active" : "");
    btn.textContent = kind.label;
    btn.addEventListener("click", () => onSelect(kind.id));
    container.appendChild(btn);
  }
}

/** Sport subtabs for the badges screen. Sports with no badges yet still get
 * a tab so the roadmap is visible, but it's marked locked and says so when
 * opened rather than showing a confusing empty grid. */
export function renderBadgeSportTabs(container, activeId, onSelect) {
  container.innerHTML = "";
  for (const sport of SPORTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "subtab" + (sport.id === activeId ? " active" : "") + (sport.live ? "" : " locked");
    btn.textContent = `${sport.icon} ${sport.name}`;
    btn.addEventListener("click", () => onSelect(sport.id));
    container.appendChild(btn);
  }
}

/**
 * @param onlyEarned  show only badges this player has actually earned.
 *   The Customize view passes true - it is a wardrobe, and a shelf of things
 *   you cannot wear is the Rewards screen's job, not a picker's. The Rewards
 *   screen passes false and shows the whole ladder with its progress.
 */
export function renderBadgeCollection(
  container,
  summaryEl,
  profile,
  sport = "nba",
  onToggleFeature,
  onlyEarned = false
) {
  const list = badgesForSport(sport);
  container.innerHTML = "";

  if (list.length === 0) {
    const name = (SPORTS.find((s) => s.id === sport) || {}).name || sport;
    summaryEl.textContent = `${name} badges arrive with ${name} drafts.`;
    renderNote(container, `No ${name} badges yet — this sport isn't playable at the moment.`);
    return;
  }

  const { earned, maxed, total } = badgeSummary(profile, sport);
  summaryEl.textContent = `${earned} of ${total} badges earned${maxed > 0 ? ` · ${maxed} at Hall of Fame` : ""}`;

  // Highest tier first, so what you've actually achieved leads the screen and
  // unearned badges settle at the bottom. Ties break on how far into the
  // current tier you are, then name, so the order is stable between renders
  // rather than shuffling every time the screen is opened.
  const ranked = list
    .map((badge) => ({ badge, progress: badgeProgress(badge, profile) }))
    .sort(
      (x, y) =>
        y.progress.tierIndex - x.progress.tierIndex ||
        y.progress.percent - x.progress.percent ||
        x.badge.name.localeCompare(y.badge.name)
    );

  const shown = onlyEarned ? ranked.filter((entry) => entry.progress.tierIndex >= 0) : ranked;
  if (onlyEarned) {
    summaryEl.textContent = shown.length
      ? `${shown.length} badge${shown.length === 1 ? "" : "s"} you can show off`
      : "";
    if (shown.length === 0) {
      renderNote(container, "None earned in this sport yet.");
      return;
    }
  }

  for (const { badge, progress } of shown) {
    const earnedIt = progress.tierIndex >= 0;

    const tile = document.createElement("div");
    tile.className = "badge-tile" + (earnedIt ? "" : " locked");

    const head = document.createElement("div");
    head.className = "badge-head";

    const icon = document.createElement("span");
    icon.className = "badge-icon";
    icon.textContent = badge.icon;
    head.appendChild(icon);

    const titles = document.createElement("div");
    const name = document.createElement("div");
    name.className = "badge-name";
    name.textContent = badge.name;
    titles.appendChild(name);

    const tier = document.createElement("div");
    tier.className = "badge-tier";
    tier.textContent = earnedIt ? `${progress.tier.icon} ${progress.tier.name}` : "Not earned yet";
    titles.appendChild(tier);
    head.appendChild(titles);
    tile.appendChild(head);

    const blurb = document.createElement("div");
    blurb.className = "badge-blurb";
    blurb.textContent = badge.blurb;
    tile.appendChild(blurb);


    const track = document.createElement("div");
    track.className = "progress-bar-track";
    const fill = document.createElement("div");
    fill.className = "progress-bar-fill";
    fill.style.width = `${progress.percent}%`;
    track.appendChild(fill);
    tile.appendChild(track);

    const caption = document.createElement("div");
    caption.className = "badge-progress";
    caption.textContent = progress.next
      ? `${roundStat(progress.value)} / ${progress.next.threshold} ${badge.unit} to ${progress.next.tier.name}`
      : `${roundStat(progress.value)} ${badge.unit} — maxed out`;
    tile.appendChild(caption);

    // Only earned badges can be shown off - featuring one you haven't earned
    // would say nothing about you.
    if (earnedIt && onToggleFeature) {
      const featured = (profile.featuredBadges || []).includes(badge.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-secondary badge-feature" + (featured ? " is-featured" : "");
      btn.textContent = featured ? "On your banner" : "Feature";
      btn.addEventListener("click", () => onToggleFeature(badge.id));
      tile.appendChild(btn);
    }

    container.appendChild(tile);
  }
}


/** The equipped banner's name, shown as a small caption under the player's
 * name on the home header - the banner artwork itself is now the whole
 * card's background (see renderPlayerBannerCard), so this is just enough text to
 * say which team it is, not a second copy of the art. */
export function renderEquippedBanner(container, profile) {
  container.innerHTML = "";
  const franchise = profile.equippedBanner ? bannerById(profile.equippedBanner) : null;
  container.hidden = !franchise;
  if (!franchise) return;
  const label = document.createElement("span");
  label.className = "banner-flying";
  label.textContent = `Flying ${franchise.name}`;
  container.appendChild(label);
}

/**
 * Warms the artwork for a set of banner ids, resolving when they are decoded
 * or when `timeoutMs` runs out, whichever comes first.
 *
 * The intro is an animation with a fixed running time, so the art has to be in
 * the browser BEFORE it starts - marking the image eager only helps if there is
 * something to wait on, and the animation does not wait. Hence a real preload.
 *
 * The timeout is the important half. A player on a slow connection should see
 * the intro late-loading its artwork, not sit on a frozen screen waiting for a
 * decorative image: whatever has arrived by then flies in, and the rest appears
 * when it appears.
 */
export function preloadBannerArt(bannerIds, timeoutMs = 1200) {
  const sources = bannerIds
    .map((id) => (id ? bannerById(id) : null))
    .filter((b) => b && b.image)
    .map((b) => b.image);
  if (sources.length === 0) return Promise.resolve();

  const loads = sources.map(
    (src) =>
      new Promise((resolve) => {
        const img = new Image();
        // Resolve either way: a banner whose file is missing must not hold the
        // intro for the full timeout on every single match.
        img.addEventListener("load", () => resolve());
        img.addEventListener("error", () => resolve());
        img.src = src;
      })
  );
  return Promise.race([
    Promise.all(loads),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * One side of the pre-draft matchup intro: that player's WHOLE card, the same
 * one they see on their home screen - equipped banner as the background, their
 * icon, name, join plate, the badges they chose to feature, and their rep,
 * rank and rating.
 *
 * It used to be the banner ARTWORK alone with a name and a tier caption
 * underneath, which showed the one thing about a player that carries no
 * information about them - two players flying Crystal were indistinguishable -
 * and dropped everything they had actually earned.
 *
 * @param refs.slot  the element the card is mounted into.
 * @param profile    a full normalized profile, yours or the opponent's.
 * @param rankInfo   from loadOverallRankInfo - the sport-neutral ladder, the
 *                   same one the home card shows, so a player's rank reads the
 *                   same here as it does there.
 */
export function renderMatchupSide(refs, { profile, rankInfo }) {
  refs.slot.innerHTML = "";
  // Rebuilt per intro rather than cached: the intro plays once per match, and
  // a card held across matches would have to be reset field by field for the
  // next opponent - a second, quieter copy of the renderer below.
  const card = createPlayerBannerCard("matchup-card");
  refs.slot.appendChild(card.card);
  renderPlayerBannerCard(card, profile, rankInfo);
}

/**
 * The banner collection. Locked banners still show the franchise and how far
 * along you are - a reward you can't see the shape of isn't motivating.
 */
/** A hardcoded, always-unlocked banner tile (Founder, 1st Player) - no
 * progress bar, just the art, name, equip state, and a distinct glow class
 * marking it as different in kind from an earnable team banner. */
function specialBannerTile(banner, glowClass, profile, onEquip) {
  const equipped = profile.equippedBanner === banner.id;
  const tile = document.createElement("div");
  tile.className = `banner-tile ${glowClass}` + (equipped ? " equipped" : "");
  tile.appendChild(bannerArt(banner));

  const name = document.createElement("div");
  name.className = "banner-name";
  name.textContent = banner.name;
  tile.appendChild(name);

  const caption = document.createElement("div");
  caption.className = "banner-progress";
  caption.textContent = equipped ? "Flying now" : "Unlocked";
  tile.appendChild(caption);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-secondary banner-equip";
  btn.textContent = equipped ? "Take down" : "Fly this";
  btn.addEventListener("click", () => onEquip(equipped ? null : banner.id));
  tile.appendChild(btn);

  return tile;
}

/** A general banner tile: like a franchise tile, but its caption comes from
 * the banner's own requirement ("Win 500 online ranked games") rather than a
 * shared draft threshold, since each one is earned a different way. */
function generalBannerTile(banner, progress, profile, onEquip) {
  const equipped = profile.equippedBanner === banner.id;
  const tile = document.createElement("div");
  tile.className = "banner-tile" + (progress.unlocked ? "" : " locked") + (equipped ? " equipped" : "");
  tile.appendChild(bannerArt(banner));

  const name = document.createElement("div");
  name.className = "banner-name";
  name.textContent = banner.name;
  tile.appendChild(name);

  if (!progress.unlocked) {
    const track = document.createElement("div");
    track.className = "progress-bar-track";
    const fill = document.createElement("div");
    fill.className = "progress-bar-fill";
    fill.style.width = `${progress.percent}%`;
    track.appendChild(fill);
    tile.appendChild(track);
  }

  const caption = document.createElement("div");
  caption.className = "banner-progress";
  caption.textContent = progress.unlocked
    ? equipped ? "Flying now" : "Unlocked"
    : `${progress.value} / ${progress.required} — ${banner.blurb}`;
  tile.appendChild(caption);

  // The default banner has no "take down": clearing it just falls back to
  // itself (see normalize() in profile.js), so the button would do nothing.
  if (progress.unlocked && !(equipped && banner.id === DEFAULT_BANNER_ID)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary banner-equip";
    btn.textContent = equipped ? "Take down" : "Fly this";
    btn.addEventListener("click", () => onEquip(equipped ? null : banner.id));
    tile.appendChild(btn);
  }

  return tile;
}

/** Sport subtabs for the banners screen - same pattern as
 * renderBadgeSportTabs, just filtering FRANCHISES instead of BADGES. */
// A pseudo-sport tab, not a real entry in SPORTS (constants.js) - it holds
// banners that aren't earned through any sport's play at all (Founder, 1st
// Player), so they don't belong filed under NBA just because that's where
// they used to live. Prepended to the real sport tabs rather than folded in
// as sport id "general" anywhere else, so nothing outside banner rendering
// needs to know it exists.
const GENERAL_BANNERS_TAB = { id: "general", name: "General", icon: "⭐", live: true };

export function renderBannerSportTabs(container, activeId, onSelect) {
  container.innerHTML = "";
  for (const sport of [GENERAL_BANNERS_TAB, ...SPORTS]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "subtab" + (sport.id === activeId ? " active" : "") + (sport.live ? "" : " locked");
    btn.textContent = `${sport.icon} ${sport.name}`;
    btn.addEventListener("click", () => onSelect(sport.id));
    container.appendChild(btn);
  }
}

/** `onlyUnlocked` filters franchise banners down to ones this profile can
 * actually equip - what Profile > Customize Banner shows, since offering to
 * "customize" with a banner you haven't earned yet is just the Rewards tab
 * with extra steps. Rewards itself always passes false, since showing what's
 * still locked (and how close you are) is the whole point there. */
export function renderBanners(container, summaryEl, profile, onEquip, sport = "nba", onlyUnlocked = false) {
  container.innerHTML = "";

  // Founder and 1st Player: not earned through any sport's play, so they
  // get their own tab rather than being filed under whichever sport
  // happened to be active when they were added.
  if (sport === "general") {
    const hasFounder = isFounder(profile);
    const hasFirstPlayer = isFirstPlayer(profile);
    if (hasFounder) container.appendChild(specialBannerTile(FOUNDER_BANNER, "founder-tile", profile, onEquip));
    if (hasFirstPlayer) container.appendChild(specialBannerTile(FIRST_PLAYER_BANNER, "first-player-tile", profile, onEquip));

    let unlockedCount = 0;
    let shownGeneral = 0;
    for (const banner of GENERAL_BANNERS) {
      const progress = generalBannerProgress(banner, profile);
      if (progress.unlocked) unlockedCount += 1;
      if (onlyUnlocked && !progress.unlocked) continue;
      shownGeneral += 1;
      container.appendChild(generalBannerTile(banner, progress, profile, onEquip));
    }

    summaryEl.textContent = onlyUnlocked
      ? `${unlockedCount} of ${GENERAL_BANNERS.length} unlocked · pick one to fly`
      : `${unlockedCount} of ${GENERAL_BANNERS.length} unlocked · earned game-wide, not per franchise`;
    if (onlyUnlocked && shownGeneral === 0 && !hasFounder && !hasFirstPlayer) {
      renderNote(container, "None unlocked yet.");
    }
    return;
  }

  const list = franchisesForSport(sport);
  const { unlocked, total } = bannerSummary(profile, sport);
  summaryEl.textContent = onlyUnlocked
    ? `${unlocked} of ${total} unlocked · pick one to fly`
    : `${unlocked} of ${total} unlocked · ${BANNER_THRESHOLD} ranked picks from a franchise`;

  let shown = 0;
  for (const franchise of list) {
    const progress = bannerProgress(franchise, profile);
    if (onlyUnlocked && !progress.unlocked) continue;
    shown += 1;
    const equipped = profile.equippedBanner === franchise.id;

    const tile = document.createElement("div");
    tile.className = "banner-tile" + (progress.unlocked ? "" : " locked") + (equipped ? " equipped" : "");
    tile.appendChild(bannerArt(franchise));

    const name = document.createElement("div");
    name.className = "banner-name";
    name.textContent = franchise.name;
    tile.appendChild(name);

    const track = document.createElement("div");
    track.className = "progress-bar-track";
    const fill = document.createElement("div");
    fill.className = "progress-bar-fill";
    fill.style.width = `${progress.percent}%`;
    track.appendChild(fill);
    tile.appendChild(track);

    const caption = document.createElement("div");
    caption.className = "banner-progress";
    caption.textContent = progress.unlocked
      ? equipped
        ? "Flying now"
        : "Unlocked"
      : `${progress.drafted} / ${progress.required} in ranked wins`;
    tile.appendChild(caption);

    if (progress.unlocked) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-secondary banner-equip";
      btn.textContent = equipped ? "Take down" : "Fly this";
      btn.addEventListener("click", () => onEquip(equipped ? null : franchise.id));
      tile.appendChild(btn);
    }

    container.appendChild(tile);
  }

  if (onlyUnlocked && shown === 0) {
    renderNote(container, "You haven't unlocked any banners here yet - draft players from a franchise in ranked wins to earn one.");
  }
}

/**
 * The icon shelf: General icons on their own tab, then one team emblem per
 * franchise under each sport.
 *
 * Reuses renderBannerSportTabs for its subtabs rather than growing a third
 * near-identical tab renderer - General/NBA/NFL means the same thing on both
 * shelves, and a player who learns the banner tabs has already learned these.
 *
 * `onlyUnlocked` is the same switch banners take, for the same reason: the
 * Customize view is a wardrobe and the Rewards view is a ladder.
 */
export function renderIcons(container, summaryEl, profile, onEquip, sport = "nba", onlyUnlocked = false) {
  container.innerHTML = "";
  const general = sport === GENERAL_BANNERS_TAB.id;
  const list = general ? GENERAL_ICONS : teamIconsForSport(sport);

  if (!general && list.length === 0) {
    const name = (SPORTS.find((s) => s.id === sport) || {}).name || sport;
    summaryEl.textContent = `${name} icons arrive with ${name} teams.`;
    renderNote(container, `No ${name} icons yet — this sport isn't playable at the moment.`);
    return;
  }

  if (general) {
    const unlocked = list.filter((icon) => iconProgress(icon, profile).unlocked).length;
    summaryEl.textContent = onlyUnlocked
      ? `${unlocked} of ${list.length} unlocked · pick one for your card`
      : `${unlocked} of ${list.length} unlocked`;
  } else {
    const { unlocked, total } = iconSummary(profile, sport);
    summaryEl.textContent = onlyUnlocked
      ? `${unlocked} of ${total} unlocked · pick one for your card`
      : `${unlocked} of ${total} unlocked · earn one with a ranked MVP from that team`;
  }

  let shown = 0;
  for (const icon of list) {
    const progress = iconProgress(icon, profile);
    if (onlyUnlocked && !progress.unlocked) continue;
    shown += 1;
    const equipped = (profile.equippedIcon || DEFAULT_ICON_ID) === icon.id;

    const tile = document.createElement("div");
    tile.className = "icon-tile" + (progress.unlocked ? "" : " locked") + (equipped ? " equipped" : "");

    // The mark itself, drawn exactly as it will appear on the identity card -
    // a preview that renders differently from the real thing is not a preview.
    const art = document.createElement("div");
    art.className = "icon-art";
    const glyph = iconGlyph(icon, profile);
    if (glyph.kind === "emblem") {
      const svg = emblemSvg(glyph.emblem, glyph.colors, glyph.label);
      if (svg) art.appendChild(svg);
      else art.textContent = "★";
    } else {
      art.textContent = glyph.glyph;
      art.classList.add("is-emoji");
    }
    tile.appendChild(art);

    const name = document.createElement("div");
    name.className = "icon-name";
    name.textContent = icon.name;
    tile.appendChild(name);

    const track = document.createElement("div");
    track.className = "progress-bar-track";
    const fill = document.createElement("div");
    fill.className = "progress-bar-fill";
    fill.style.width = `${progress.percent}%`;
    track.appendChild(fill);
    tile.appendChild(track);

    const caption = document.createElement("div");
    caption.className = "icon-progress";
    caption.textContent = progress.unlocked
      ? equipped
        ? "Worn now"
        : progress.granted
          ? "Unlocked (granted)"
          : "Unlocked"
      : icon.franchise
        ? `${progress.value} / ${progress.required} ranked MVPs`
        : `${progress.value} / ${progress.required} — ${icon.blurb}`;
    tile.appendChild(caption);

    if (progress.unlocked && onEquip) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-secondary icon-equip";
      // The default icon has nothing to fall back TO, so it never offers to be
      // taken off - removing it would leave the card with no mark at all.
      const removable = icon.id !== DEFAULT_ICON_ID;
      btn.textContent = equipped ? (removable ? "Take off" : "Worn") : "Wear this";
      btn.disabled = equipped && !removable;
      btn.addEventListener("click", () => onEquip(equipped ? DEFAULT_ICON_ID : icon.id));
      tile.appendChild(btn);
    }

    container.appendChild(tile);
  }

  if (onlyUnlocked && shown === 0) {
    renderNote(
      container,
      "No icons unlocked here yet — win a ranked game where one of this team's players is MVP to earn its icon."
    );
  }
}

/** One row per era bracket, online and offline broken out separately - a
 * rank earned in Modern Ball says nothing about Grandpa's Game, so folding
 * them into one number would hide more than it showed. Lives on the Profile
 * tab only; the home screen's era chips are for picking what to play next,
 * not for re-showing a record.
 *
 * The online side also shows a per-era rank. Today that's always
 * "Provisional" - loadRankInfo() (profile.js) only computes the one
 * cross-era percentile shown at the top of the profile; a real per-era
 * version (same idea, scoped to eraRecord's online_wins/online_losses
 * instead of the profile-wide total) is a follow-up, not built yet. */
function renderEraRecords(container, profile, sport) {
  container.innerHTML = "";
  // The active sport's brackets, and its record keys. Era ids are only unique
  // within a sport (every sport wants an "all"), so the key is namespaced -
  // see eraRecordKey in js/sports/index.js.
  for (const era of sport.eras) {
    const rec = eraRecord(profile, eraRecordKey(sport.id, era.id));
    const row = document.createElement("div");
    row.className = "era-record-row";
    row.innerHTML =
      `<span class="era-record-name"><span aria-hidden="true">${era.emoji}</span> ${era.label}</span>` +
      `<span class="era-record-split"><span class="era-record-label">Online</span> ${rec.online_wins}-${rec.online_losses}` +
      `<span class="era-record-rank">Provisional</span></span>` +
      `<span class="era-record-split"><span class="era-record-label">Offline</span> ${rec.offline_wins}-${rec.offline_losses}</span>`;
    container.appendChild(row);
  }
}

/**
 * One Top Performances row.
 *
 * A row becomes a button when the record carries the box score of the game it
 * was set in, and stays a plain div when it doesn't - which is every record
 * written before snapshots existed, and every empty placeholder. That is the
 * honest split: a row only looks clickable when there is something behind it.
 */
function performanceRow(label, value, game = null, onOpenGame = null) {
  const clickable = !!(game && game.boxA && game.boxB && onOpenGame);
  const row = document.createElement(clickable ? "button" : "div");
  row.className = "performance-row" + (clickable ? " record-link" : "");
  if (clickable) {
    row.type = "button";
    row.addEventListener("click", () => onOpenGame(game));
  }
  row.innerHTML = `<span></span><span class="performance-line"></span>`;
  // innerHTML for the label because callers pass pre-escaped markup for the
  // player-name half; the value is always ours and goes in as text.
  row.firstChild.innerHTML = label;
  row.lastChild.textContent = value;
  return row;
}

/**
 * @param rankInfo the player's GENERAL, all-sports standing - the one on their
 *   banner. It sits at the top of the screen because it is the headline.
 * @param sport which sport's career stats to show. Everything below the subtab
 *   row is scoped to it, including `sportRankInfo` - that sport's own ELO
 *   standing on its own ladder, which is a different number from `rankInfo`
 *   and is the whole point of ratings being per-sport.
 * @param onOpenGame called with a stored game snapshot when a record row is
 *   clicked. Rows without a snapshot are not clickable at all.
 */
export function renderProfileScreen(
  refs,
  profile,
  rankInfo,
  sport = sportById(DEFAULT_SPORT_ID),
  sportRankInfo = null,
  onOpenGame = null
) {
  refs.usernameInput.value = profile.username || "";
  // The name as a HEADING, not only as the value of a text box. The input is
  // still the way to change it - it just lives under "Account settings" now,
  // and a profile whose only statement of who you are is an editable field
  // reads as a form rather than as yours.
  if (refs.displayName) refs.displayName.textContent = profile.username || "Player";
  renderPlayerIcon(refs.avatar, profile);
  renderTierSummary(refs.tierBadge, refs.tierCaption, rankInfo);

  if (refs.sportRankHeading) refs.sportRankHeading.textContent = `${sport.name} Rank`;
  if (refs.sportRank) {
    refs.sportRank.innerHTML = "";
    if (!sportRankInfo) {
      refs.sportRank.innerHTML = `<div class="empty-note">${sport.name} isn't playable yet, so there's no rank to earn here.</div>`;
    } else if (sportRankInfo.provisional) {
      const g = sportRankInfo.gamesNeeded;
      refs.sportRank.innerHTML =
        `<div class="empty-note">${g} more online ${g === 1 ? "game" : "games"} in ${sport.name} to get a ${sport.name} rank.</div>`;
    } else {
      const badge = document.createElement("span");
      badge.className = "tier-badge";
      badge.textContent = sportRankInfo.tier.name;
      const line = document.createElement("div");
      line.className = "performance-line";
      line.textContent =
        `${sportRankInfo.rating} rating — #${sportRankInfo.rank} of ${sportRankInfo.totalQualifying} in ${sport.name}`;
      refs.sportRank.append(badge, line);
    }
  }

  refs.onlineRecord.textContent = `${profile.onlineWins}-${profile.onlineLosses}`;
  refs.offlineRecord.textContent = `${profile.offlineWins}-${profile.offlineLosses}`;
  // Practice games don't move rank, but they are still games you played, so
  // the total counts every mode.
  refs.totalGames.textContent = String(
    profile.onlineWins + profile.onlineLosses + profile.offlineWins + profile.offlineLosses
  );

  renderEraRecords(refs.eraRecords, profile, sport);

  const top = mostDraftedPlayer(profile, sport.id);
  refs.mostDrafted.innerHTML = top
    ? `<div class="performance-row"><span>${escapeHtml(top.name)}</span><span class="performance-line">${top.count}x drafted</span></div>`
    : `<div class="empty-note">Play a ${sport.name} draft to start tracking this.</div>`;

  // Labels come from the sport, so the NFL tab lists passing yards rather than
  // rebounds. A sport nobody has played yet still draws every row as a dash -
  // showing what WILL be tracked is more useful than an empty card.
  refs.topPerformances.innerHTML = "";
  const statLabels = sport.statLabels || {};
  const bests = personalBestsFor(profile, sport.id);
  const bestKeys = Object.keys(statLabels);
  if (!bestKeys.length) {
    refs.topPerformances.innerHTML = `<div class="empty-note">No stats tracked for ${sport.name} yet.</div>`;
  } else if (!bestKeys.some((k) => bests[k])) {
    refs.topPerformances.innerHTML = `<div class="empty-note">No ${sport.name} games played yet.</div>`;
  } else {
    for (const key of bestKeys) {
      const best = bests[key];
      const label = `Most ${statLabels[key]}`;
      refs.topPerformances.appendChild(
        best
          ? performanceRow(
              `${label} — ${escapeHtml(best.season ? `${best.season} ${best.playerName}` : best.playerName)}`,
              `${roundStat(best.value)} — ${new Date(best.date).toLocaleDateString()}`,
              best.game,
              onOpenGame
            )
          : performanceRow(label, "—")
      );
    }
  }

  // Both game records are keyed by sport now, so the football tab cannot show
  // your best basketball night. gameRecordFor also reads the old flat shape.
  const scoringGame = gameRecordFor(profile.highestScoringGame, sport.id);
  refs.highestScoringGame.replaceWith(
    (refs.highestScoringGame = performanceRow(
      scoringGame ? `Highest Scoring Game — vs ${escapeHtml(scoringGame.opponentLabel)}` : "Highest Scoring Game",
      scoringGame ? `${scoringGame.scoreFor} — ${new Date(scoringGame.date).toLocaleDateString()}` : "—",
      scoringGame,
      onOpenGame
    ))
  );

  const marginGame = gameRecordFor(profile.largestMarginGame, sport.id);
  refs.largestMargin.innerHTML = "";
  refs.largestMargin.appendChild(
    performanceRow(
      marginGame ? `Biggest Win — vs ${escapeHtml(marginGame.opponentLabel)}` : "Biggest Win",
      marginGame
        ? `${marginGame.value}-point win — ${new Date(marginGame.date).toLocaleDateString()}`
        : "—",
      marginGame,
      onOpenGame
    )
  );

  // A TRIPLE-DOUBLE IS BASKETBALL'S. It was rendered unconditionally, so the
  // football tab carried a row for a thing football does not have and can
  // never record - permanently a dash, and a dash that reads as "you have not
  // done this yet" rather than "this does not exist here". The sport says
  // whether it has a signature record; one that does not gets no row.
  if (sport.signatureRecord) {
    const holder = mostTripleDoubles(profile, sport.id);
    refs.mostTripleDoubles.hidden = false;
    refs.mostTripleDoubles.innerHTML = holder
      ? `<div class="performance-row"><span>${escapeHtml(sport.signatureRecord.label)} — ${escapeHtml(holder.name)}</span><span class="performance-line">${holder.count}x</span></div>`
      : `<div class="performance-row"><span>${escapeHtml(sport.signatureRecord.label)}</span><span class="performance-line">—</span></div>`;
  } else {
    refs.mostTripleDoubles.innerHTML = "";
    refs.mostTripleDoubles.hidden = true;
  }

  // Scoped to this sport: a football win did not extend a basketball streak.
  const streaks = winStreaks(profile, sport.id);
  const streakScope = streaks.complete ? "" : ` (last ${streaks.sampled})`;
  const streakLine =
    streaks.longest > 0
      ? `${streaks.longest} game${streaks.longest === 1 ? "" : "s"}` +
        (streaks.current > 1 ? ` — on ${streaks.current} now` : "")
      : "—";
  refs.longestWinStreak.innerHTML =
    `<div class="performance-row"><span>Longest Win Streak${streakScope}</span>` +
    `<span class="performance-line">${streakLine}</span></div>`;

  const mvps = mostMVPs(profile, sport.id);
  refs.mostMvps.innerHTML = mvps
    ? `<div class="performance-row"><span>Most MVPs — ${mvps.name}</span><span class="performance-line">${mvps.count}x</span></div>`
    : `<div class="performance-row"><span>Most MVPs</span><span class="performance-line">—</span></div>`;

  refs.historyBody.innerHTML = "";
  const scopedHistory = historyFor(profile, sport.id);
  // The most recent handful, not the whole stored history - see
  // RECENT_GAMES_SHOWN. History is newest-first, so this is the last N played.
  const shown = scopedHistory.games.slice(0, RECENT_GAMES_SHOWN);
  for (const entry of shown) {
    const tr = document.createElement("tr");
    tr.className = entry.won ? "win-row" : "loss-row";
    const date = new Date(entry.date).toLocaleDateString();
    // "local" was pass-and-play, which no longer exists - but games played
    // before it was removed are still in saved history and should keep their
    // real label rather than being mislabelled as bot games.
    const modeTag = entry.mode === "online" ? "Online" : entry.mode === "local" ? "Local" : "Practice";
    // Mode is its own element rather than "(Online)" inside the result text:
    // on a phone that parenthetical was what pushed the result cell to three
    // lines, and as a tag it can drop underneath instead of widening the
    // column. Escaped because an opponent's username and an MVP name are
    // both player-supplied.
    tr.innerHTML =
      `<td>${date}</td>` +
      `<td>${entry.won ? "Win" : "Loss"} vs ${escapeHtml(entry.opponentLabel)}` +
      `<span class="history-mode">${modeTag}</span></td>` +
      `<td class="history-score">${entry.scoreFor}-${entry.scoreAgainst}</td>` +
      `<td>${escapeHtml(entry.mvpName)}</td>`;
    refs.historyBody.appendChild(tr);
  }
  if (!scopedHistory.games.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" class="empty-note">No ${escapeHtml(sport.name)} games played yet.</td>`;
    refs.historyBody.appendChild(tr);
  }
  // A shorter list than the player has games for should say so. The older ones
  // are not gone - they still count toward the streak records above - they are
  // just not what this panel is for.
  const hidden = scopedHistory.games.length - shown.length;
  if (hidden > 0) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td colspan="4" class="empty-note">Showing your last ${shown.length} of ` +
      `${scopedHistory.games.length} ${escapeHtml(sport.name)} games. ` +
      `Older games still count toward the records above.</td>`;
    refs.historyBody.appendChild(tr);
  }
  // Said out loud rather than quietly dropped. These are games from before
  // history recorded which sport it was, and there is no honest way to assign
  // them - so they are counted and named instead of being guessed into one
  // sport's list.
  if (scopedHistory.unattributed > 0) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td colspan="4" class="empty-note">${scopedHistory.unattributed} earlier game` +
      `${scopedHistory.unattributed === 1 ? "" : "s"} predate per-sport history and are not shown under any sport.</td>`;
    refs.historyBody.appendChild(tr);
  }
}
