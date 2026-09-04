// Franchise banner artwork.
//
// Extracted from js/ui.js, which had grown to 3,182 lines - one file holding
// the draft board, the box score, the profile screen, the strategy pickers and
// the squad screens. Nothing was wrong with the code; the problem was finding
// it. js/ui.js is a barrel now and re-exports everything, so no caller changed.
//
// THIS PIECE COMES OUT FIRST because it is what the squad screens need. They
// are otherwise self-contained, and had this stayed in ui.js the squads module
// would have had to import from the barrel that imports it - a cycle that ESM
// tolerates and nobody should have to reason about.

import { SPORTS } from "../sports/index.js";

/** The thumbnail beside a piece of banner art. tools/build-banner-tiles.mjs
 * writes assets/banners/tiles/<same-name>.jpg, so the path is derived rather
 * than stored - a second field on every banner entry would be one more thing
 * to keep in step with a directory listing. */
function tileVariant(imagePath) {
  return imagePath.replace(/([^/]+)$/, "tiles/$1");
}

/** One franchise banner: a vertical field of the team's two colors with the
 * abbreviation ghosted large in the corner, like a number on a retired
 * jersey banner. The look comes entirely from the franchise entry's colors
 * and abbreviation - no commissioned asset, no player likeness anywhere
 * near it, and it reads as a real banner rather than a badge/icon. */
/**
 * @param eager  fetch the artwork immediately, at high priority.
 * @param tile   use the 424x144 thumbnail instead of the 2120x720 card art.
 *
 * Lazy is right for the Rewards grid, where sixty banners draw at once and
 * most are below the fold - which is every caller today, so both options sit
 * at their defaults. The eager path is not dead weight: it is what a screen
 * showing one or two banners full-bleed needs, and the cost of not having it
 * was learned on the matchup intro, where artwork deferred behind an
 * intersection check arrived after the animation had already played and both
 * players watched a bare colour gradient fly in. (That screen no longer draws
 * banner art directly - it renders whole player cards, which carry the artwork
 * as a CSS background and preload it first; see preloadBannerArt below.)
 *
 * `tile` defaults to the opposite of `eager` because the two questions have
 * had the same answer everywhere: full-bleed art is worth fetching now, and a
 * thumbnail in a grid or a friend row is not. They are still separate
 * arguments, because "when do I fetch" and "which file do I fetch" are
 * separate questions and the next screen that shows a large banner lazily
 * should not have to fetch a 424px image to get there. Card art is up to
 * 640 KB and the grid draws twenty of them; the tiles are 360 KB for the whole
 * set (tools/build-banner-tiles.mjs).
 */
export function bannerArt(franchise, { eager = false, tile = !eager } = {}) {
  const el = document.createElement("div");
  // `art` (general banners only - see GENERAL_BANNERS in banners.js) swaps the
  // flat two-color gradient for a real pattern. The two colors still drive it
  // via CSS vars, so one class covers every camo instead of a rule per banner.
  el.className =
    "banner-art" + (franchise.image ? " has-image" : franchise.art ? ` banner-art-${franchise.art}` : "");
  el.style.setProperty("--art-c1", franchise.colors[0]);
  el.style.setProperty("--art-c2", franchise.colors[1]);
  // `image` is real artwork and beats everything below it. The colors still go
  // on as a background, so a slow or failed load shows the banner's own two
  // colors rather than an empty hole - the art is an upgrade over the
  // generated look, not a dependency of it.
  el.style.background = `linear-gradient(180deg, ${franchise.colors[0]} 0%, ${franchise.colors[1]} 100%)`;
  if (franchise.image) {
    const img = document.createElement("img");
    img.className = "banner-art-img";
    img.src = tile ? tileVariant(franchise.image) : franchise.image;
    img.alt = "";
    // Every banner in the Rewards grid draws at once, so decoding them eagerly
    // stalls that screen on a phone for no benefit - most are below the fold.
    img.loading = eager ? "eager" : "lazy";
    img.decoding = "async";
    if (eager) img.fetchPriority = "high";
    // A missing TILE falls back to the card art rather than to nothing: the
    // tiles are generated from the card art, so a banner added without a
    // re-run of build-banner-tiles.mjs still shows its artwork - heavier than
    // intended, which is the right way round for a build step someone forgot.
    // A missing card file falls back to the gradient already painted
    // underneath, instead of leaving a broken-image glyph.
    let triedFullSize = !tile;
    img.addEventListener("error", () => {
      if (!triedFullSize) {
        triedFullSize = true;
        img.src = franchise.image;
        return;
      }
      img.remove();
    });
    el.appendChild(img);
  } else if (franchise.art) {
    el.className = `banner-art banner-art-${franchise.art}`;
  }
  // The ghosted corner abbreviation is the fallback for banners with no
  // artwork of their own - it gives a flat two-color field something to say.
  // A banner that HAS artwork opts out (`hideAbbr`), because stamping a
  // three-letter code over a camo or a custom design is the label competing
  // with the thing it labels. The tile prints the banner's name underneath
  // either way, so nothing is lost by leaving it off.
  if (!franchise.hideAbbr) el.dataset.abbr = franchise.abbr;

  // A full-opacity mark that sits INSIDE the frame, unlike the abbreviation
  // slot above, which is deliberately bled off the corner.
  if (franchise.emblem) {
    const emblem = document.createElement("span");
    emblem.className = "banner-emblem";
    emblem.textContent = franchise.emblem;
    el.appendChild(emblem);
  }

  if (franchise.label) {
    const label = document.createElement("span");
    label.className = "banner-label";
    label.textContent = franchise.label;
    el.appendChild(label);
  }

  // A placeholder sport marker until franchise banners get real art (city
  // skylines, etc.) - just enough so a banner reads as "this is the NFL one"
  // at a glance once more than one sport has franchises here.
  const sport = SPORTS.find((s) => s.id === franchise.sport);
  if (sport) {
    const badge = document.createElement("span");
    badge.className = "banner-sport-badge";
    badge.textContent = sport.icon;
    el.appendChild(badge);
  }

  return el;
}
