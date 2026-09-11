// Sponsorship inventory: what a campaign is, and which ones are running.
//
// THIS IS NOT AN AD NETWORK AND MUST NOT BECOME ONE. There is no third-party
// script, no tag manager, no auction, no cookie and no cross-site anything.
// A campaign is a row in the list below - a name, a piece of creative, a
// destination and two dates - and a placement is a slot on a screen that draws
// whichever of those is currently running. That is the whole system.
//
// WHY A CONFIG MODULE AND NOT MARKUP. A sponsor hardcoded into a screen is a
// sponsor that needs a code change to end, which means a campaign whose end
// date is a promise nobody can keep. Dates are data here, and a campaign that
// has ended stops drawing on the next load with nothing to deploy.
//
// WHY NOT A DATABASE TABLE. There will be single digits of these for a long
// time, they change on human timescales, and every one of them has to be
// reviewed by a person before it goes live anyway. A table would add a
// round trip on the home screen, a schema to migrate, an admin screen to write
// and a way for a bad row to put an unreviewed image in front of players. When
// there are enough campaigns that editing this file is the bottleneck, the
// shape below is already the shape of the row - `activeCampaigns()` is the only
// thing that would have to learn to fetch.
//
// THE CSP CONSTRAINS THE CREATIVE. img-src is 'self' and data:, so a sponsor's
// artwork has to be committed into assets/sponsor/ or inlined as a data URI. A
// remotely hosted creative will not load, silently - which is the correct
// default for a game whose players should not be fetching anything from a
// sponsor's servers. Hosting a real sponsor's image remotely would need a CSP
// change and a deliberate decision; see docs/sponsorship.md.

/**
 * Where a campaign can run. A placement is a promise about a slot on a screen,
 * so adding one means adding somewhere for it to draw; a campaign naming a
 * placement nothing renders is caught by scripts/verify-sponsors.mjs rather
 * than silently never appearing.
 *
 *   home-rail-left / home-rail-right
 *     The unused columns either side of the centred content on a wide desktop.
 *     Desktop only, and genuinely optional - see js/ads/placements.js.
 *   postgame
 *     Under the final screen's actions, after a game has been played. The most
 *     valuable inventory on the site and the most easily ruined: a person who
 *     has just won reads this screen, and an ad above the box score would be
 *     the reason they stop.
 *   event
 *     A sponsored tournament, challenge or event. Declared so the shape exists
 *     for the first one; nothing renders it yet, because an empty box on a
 *     screen is worse than no box.
 */
export const PLACEMENTS = {
  HOME_RAIL_LEFT: "home-rail-left",
  HOME_RAIL_RIGHT: "home-rail-right",
  POSTGAME: "postgame",
  EVENT: "event",
};

const PLACEMENT_IDS = new Set(Object.values(PLACEMENTS));

/**
 * The campaigns. Each one is:
 *
 *   id          stable, and the analytics key - never reuse or rename one, or
 *               two campaigns' numbers merge in the reporting.
 *   sponsor     who it is, as a reader sees it.
 *   headline    the one line of the creative. Kept as TEXT rather than baked
 *               into an image so it stays legible at any width, readable by a
 *               screen reader, and translatable later.
 *   body        an optional second line.
 *   cta         what the button says. Omit for a placement that is not
 *               clickable.
 *   image       optional, relative to the repo root, and must be under
 *               assets/sponsor/ for the CSP reason above.
 *   href        where a click goes. Omit for a house slot with nowhere to go.
 *   placements  which slots it is eligible for.
 *   start, end  ISO dates, inclusive. `end: null` means open-ended.
 *   house       a Draft Nova slot rather than a paid one. Marked so reporting
 *               can exclude it and so the label reads "Draft Nova" instead of
 *               claiming a sponsor that does not exist.
 *
 * NOT EXPORTED, AND THAT IS THE POINT. This is the shape a campaign has and a
 * fixture the tests and the docs can point at; it is deliberately NOT in
 * CAMPAIGNS, so nothing renders it.
 */
export const EXAMPLE_CAMPAIGN = {
  id: "house-sponsorship-2026",
  sponsor: "Draft Nova",
  headline: "Sponsorship available",
  body: "This slot reaches people mid-draft, deciding between eras. Reach us and it's yours.",
  // NOT THE ADDRESS ITSELF. "business@draftnovagame.com" is 26 characters and
  // the side rail is 160px wide, so it cannot fit on one line at any legible
  // size - it rendered as "business@draftn / ovagame.com", broken mid-word,
  // which reads as a layout bug rather than as an invitation. The mailto
  // carries the address; the button says what it does.
  cta: "Get in touch",
  href: "mailto:business@draftnovagame.com",
  placements: [PLACEMENTS.HOME_RAIL_LEFT, PLACEMENTS.HOME_RAIL_RIGHT],
  start: "2026-09-11",
  end: null,
  house: true,
};

/**
 * THE RUNNING CAMPAIGNS. EMPTY, ON PURPOSE.
 *
 * Every placement therefore draws nothing: renderSponsor() hides its container
 * and returns null, the rails stay `hidden` at every width, and the postgame
 * slot is not in the layout. There is no empty box, no "advertisement" label,
 * no reserved space, and nothing on the site tells a player that sponsorship
 * exists. Nobody sees a house ad for a product they are already using.
 *
 * WHAT IS STILL HERE is the whole system: four placements with containers and
 * renderers for three of them, viewable-impression counting, click tracking,
 * the date window, the CSP-constrained creative path, and a verify script that
 * holds all of it. Going live with a sponsor is one object in this array - the
 * shape is EXAMPLE_CAMPAIGN above - and nothing else.
 *
 * Which is why the array is empty rather than the code being deleted: the
 * expensive part of advertising inventory is having somewhere trustworthy to
 * put it, and that part is done and tested. Turning it on should be a one-line
 * change reviewed by a person, not a sprint.
 */
export const CAMPAIGNS = [];

/** Midnight-anchored comparison, so a campaign that starts today is running
 * from the start of today rather than from whenever the file was loaded. */
function onOrAfter(dateString, today) {
  return !dateString || dateString <= today;
}

function onOrBefore(dateString, today) {
  return !dateString || dateString >= today;
}

/** Today as YYYY-MM-DD in the viewer's own timezone, which is the one a
 * campaign's dates should be read in - a sponsor buying "through Sunday" means
 * their reader's Sunday. */
function todayKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Whether one campaign is live right now. Exported because
 * scripts/verify-sponsors.mjs checks the date arithmetic directly, and because
 * "is this running" is the question a future admin screen would ask.
 */
export function isRunning(campaign, now = new Date()) {
  const today = todayKey(now);
  return onOrAfter(campaign.start, today) && onOrBefore(campaign.end, today);
}

/**
 * The campaigns eligible for one placement, in declaration order.
 *
 * Returns a LIST rather than one campaign so the caller decides what to do with
 * more than one - today `renderSponsor` takes the first, which makes the list
 * order the priority order. Rotation would be a change to one function here
 * rather than to any screen.
 *
 * An unknown placement id returns nothing rather than throwing: a screen asking
 * for a slot that has no campaigns is the ordinary case, and it should draw
 * nothing quietly.
 */
export function activeCampaigns(placement, now = new Date()) {
  if (!PLACEMENT_IDS.has(placement)) {
    console.warn(`sponsor: unknown placement "${placement}"`);
    return [];
  }
  return CAMPAIGNS.filter((c) => c.placements.includes(placement) && isRunning(c, now));
}
