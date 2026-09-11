// Drawing a sponsor slot, and counting it honestly.
//
// AN IMPRESSION IS A VIEW, NOT A RENDER. This is the whole difficulty and the
// thing the brief was explicit about. A screen in this app re-renders for
// reasons that have nothing to do with anyone looking at it: the home screen
// redraws every time you come back to it, the profile reloads after a game,
// and the sponsor rails are rebuilt each time. Counting renders would produce a
// number that measures how often the app called a function - which is worse
// than having no number, because it looks like a number a sponsor could be
// billed against.
//
// So a slot is counted when the browser says it is actually on screen: an
// IntersectionObserver at a real visibility threshold, held for long enough to
// mean somebody could have seen it, and at most once per campaign per placement
// per page session (js/analytics.js trackOnce with a composite key). Scrolling
// a slot out of view and back does not count twice. A slot rendered into a
// hidden screen does not count at all, which is exactly right - the rails are
// built whether or not the home screen is showing.
//
// WHAT THIS MEANS FOR THE NUMBERS. Impressions here are conservative and
// deliberately so: viewable, deduplicated, and lower than a render count would
// be. CTR computed from them is a real ratio rather than clicks divided by
// re-renders.

import { activeCampaigns } from "./campaigns.js";
import { track, trackOnce, EVENTS } from "../analytics.js";

/** Half the slot on screen, which is the usual floor for "viewable". */
const VIEWABLE_RATIO = 0.5;
/** Held for a second, so a slot swept past while scrolling is not an
 * impression. Long enough to be a look, short enough not to lose a real one. */
const VIEWABLE_MS = 1000;

/** Observers currently watching a slot, so a re-render disconnects the old one
 * rather than accumulating observers on detached nodes. Keyed by the container
 * element, which is stable across renders. */
const watchers = new WeakMap();

// NOTHING HERE IS BUILT FROM MARKUP. Every string a campaign supplies goes in
// as textContent, so a headline containing a "<" is a headline containing a
// "<" - there is no escaping step for anyone to forget, and no path from this
// config to innerHTML. Keep it that way.
/** `href` if it is somewhere a sponsor may send a player, else null. An
 * unparseable or wrong-scheme destination renders the card without its button
 * rather than with a dead or dangerous one. */
function safeDestination(href) {
  if (!href) return null;
  try {
    const url = new URL(href, window.location.href);
    if (url.protocol === "https:" || url.protocol === "mailto:") return href;
    console.error(`sponsor: refusing a ${url.protocol} destination -`, href);
    return null;
  } catch {
    console.error("sponsor: refusing an unparseable destination -", href);
    return null;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Starts counting one slot as viewable.
 *
 * IntersectionObserver rather than a scroll handler: it reports actual
 * visibility (including a parent that is display:none, which a scroll position
 * cannot tell you) and costs nothing while nothing is moving.
 */
function countWhenSeen(container, campaign, placement) {
  watchers.get(container)?.disconnect();

  // No IntersectionObserver means no impression, on purpose. The alternative -
  // counting the render because we cannot measure the view - is the exact
  // overcount this function exists to prevent, and it would be invisible in
  // the data. A browser this old is a rounding error either way.
  if (typeof IntersectionObserver !== "function") return;

  let timer = null;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (timer) continue;
          timer = window.setTimeout(() => {
            timer = null;
            // Once per campaign per placement per session. The key is what
            // makes a second rail, or a second campaign in the same rail,
            // count separately while the same one does not count twice.
            const counted = trackOnce(
              EVENTS.SPONSOR_IMPRESSION,
              { placement, campaign: campaign.id },
              `sponsor_impression:${placement}:${campaign.id}`
            );
            // Nothing left to watch once it has been counted.
            if (counted) observer.disconnect();
          }, VIEWABLE_MS);
        } else if (timer) {
          // Scrolled away before the dwell elapsed: not a look.
          window.clearTimeout(timer);
          timer = null;
        }
      }
    },
    { threshold: VIEWABLE_RATIO }
  );

  observer.observe(container);
  watchers.set(container, observer);
}

/**
 * Draws the campaign currently running in `placement` into `container`.
 *
 * Renders NOTHING when no campaign is running - no frame, no placeholder, no
 * "advertisement" label, no reserved space. An empty ad box makes a product
 * look abandoned, and the brief says not to clutter the site with them. The
 * container is hidden, so a layout built around it collapses cleanly.
 *
 * @returns the campaign drawn, or null.
 */
export function renderSponsor(container, placement, { now = new Date() } = {}) {
  if (!container) return null;

  watchers.get(container)?.disconnect();
  watchers.delete(container);
  container.replaceChildren();

  const [campaign] = activeCampaigns(placement, now);
  if (!campaign) {
    container.hidden = true;
    return null;
  }

  const card = el("div", `sponsor-card${campaign.house ? " sponsor-house" : ""}`);

  // SAID OUT LOUD, EVERY TIME. A paid placement that does not announce itself
  // is the thing that makes people distrust a site, and for a house slot the
  // label is the honest description of what the space is. Not decoration: this
  // line is why the rest of the card is allowed to look designed.
  card.appendChild(el("span", "sponsor-kicker", campaign.house ? "Sponsorship" : "Sponsored"));

  if (campaign.image) {
    const img = document.createElement("img");
    img.className = "sponsor-image";
    img.src = campaign.image;
    // The sponsor's name, not the headline: the headline is already text below
    // and a screen reader should not hear it twice.
    img.alt = campaign.sponsor;
    img.loading = "lazy";
    img.decoding = "async";
    card.appendChild(img);
  }

  card.appendChild(el("span", "sponsor-name", campaign.sponsor));
  card.appendChild(el("span", "sponsor-headline", campaign.headline));
  if (campaign.body) card.appendChild(el("span", "sponsor-body", campaign.body));

  // A DESTINATION IS CHECKED AT RENDER TIME AS WELL AS AT BUILD TIME.
  //
  // scripts/verify-sponsors.mjs already fails a campaign whose href is not
  // https or mailto, and the config is committed code a person reviewed. Both
  // of those are true today and neither is a property of THIS function - the
  // moment campaigns come out of a database (see the note in campaigns.js), the
  // build check stops covering them and this is the line that still does. A
  // `javascript:` href in a sponsor slot is script execution inside the page.
  const destination = safeDestination(campaign.href);
  if (destination && campaign.cta) {
    const link = document.createElement("a");
    link.className = "sponsor-cta";
    link.href = destination;
    link.textContent = campaign.cta;
    // A sponsor's destination is off-site and not ours: a new tab, no referrer
    // beyond the origin, and no window.opener handle back into the game.
    if (!destination.startsWith("mailto:")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    // THE CLICK IS COUNTED EVERY TIME, unlike the impression. Two clicks are
    // two clicks - that is the point of a click - so this is track() rather
    // than trackOnce(). Recorded on the way out; navigation is not blocked on
    // it, because track() does not await anything.
    link.addEventListener("click", () => {
      track(EVENTS.SPONSOR_CLICK, { placement, campaign: campaign.id });
    });
    card.appendChild(link);
  }

  // Named for what it is, so a screen reader announcing the region says
  // "sponsorship" rather than reading an unlabelled group of text.
  container.setAttribute("role", "complementary");
  container.setAttribute("aria-label", campaign.house ? "Sponsorship information" : `Sponsored by ${campaign.sponsor}`);
  container.appendChild(card);
  container.hidden = false;

  countWhenSeen(container, campaign, placement);
  return campaign;
}

/** Stops watching a slot. For a screen that tears its DOM down - the
 * observer would otherwise hold a reference to a detached node until the
 * WeakMap entry is collected, and a slot that is gone cannot be seen. */
export function releaseSponsor(container) {
  if (!container) return;
  watchers.get(container)?.disconnect();
  watchers.delete(container);
}
