#!/usr/bin/env node
// The sponsor inventory is coherent: every campaign is well formed, every
// placement it names exists on a screen, and the date arithmetic works.
//
// WHY THIS EXISTS
//
// A sponsorship is a commercial promise made in a config file, and every way it
// can be wrong is quiet:
//
//   A campaign naming a placement nothing renders never appears. Nobody notices
//   until the sponsor asks why they have no impressions.
//   A campaign whose `end` has passed keeps showing if the date comparison is
//   wrong - which means running someone's creative past what they paid for.
//   A creative outside assets/sponsor/ is blocked by the CSP with no error
//   anywhere: the slot renders, the image does not, and the page looks broken
//   in a way only that sponsor sees.
//   An id reused between campaigns silently merges two campaigns' reporting.
//
// None of that shows up in a browser test, because the failing case is usually
// a campaign that is not running yet.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { CAMPAIGNS, EXAMPLE_CAMPAIGN, PLACEMENTS, activeCampaigns, isRunning } = await import(
  path.join(ROOT, "js/ads/campaigns.js")
);

// THE SHAPE CHECKS RUN OVER WHATEVER IS RUNNING, PLUS THE EXAMPLE.
//
// CAMPAIGNS is empty today - nothing is meant to render anywhere - so a suite
// that only looped over it would pass by having nothing to check, and would go
// on passing after somebody added a malformed campaign with a typo'd placement
// and no end date. EXAMPLE_CAMPAIGN is the documented shape and is held to
// every rule a real one is, so the rules stay live while the inventory is
// dormant.
const SHAPE_CHECKED = [...CAMPAIGNS, EXAMPLE_CAMPAIGN];

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

const indexHtml = await readFile(path.join(ROOT, "index.html"), "utf8");
const styleCss = await readFile(path.join(ROOT, "css/style.css"), "utf8");
const mainJs = await readFile(path.join(ROOT, "js/main.js"), "utf8");

// ---- 1. every declared placement has somewhere to draw ---------------------
// A placement is a promise about a slot on a screen. `event` is the deliberate
// exception: it is declared so the shape exists for the first sponsored
// tournament, and the brief says not to put an empty box on a screen for it.
const RENDERED = {
  [PLACEMENTS.HOME_RAIL_LEFT]: "sponsor-rail-left",
  [PLACEMENTS.HOME_RAIL_RIGHT]: "sponsor-rail-right",
  [PLACEMENTS.POSTGAME]: "sponsor-postgame",
};
const DECLARED_ONLY = new Set([PLACEMENTS.EVENT]);

for (const [placement, elementId] of Object.entries(RENDERED)) {
  const inHtml = indexHtml.includes(`id="${elementId}"`);
  const inJs = mainJs.includes(elementId.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + "El") || mainJs.includes(`"${elementId}"`);
  check(
    `Placement "${placement}" has a container in index.html`,
    inHtml,
    inHtml ? `#${elementId}` : `no #${elementId} - a campaign here would never appear`
  );
  check(
    `Placement "${placement}" is rendered by js/main.js`,
    inJs,
    inJs ? "renderSponsor is wired to it" : `#${elementId} exists but nothing fills it`
  );
}

// ---- 2. nothing is running, which is the current intent --------------------
// Stated as an assertion rather than left implicit: "no sponsor slot appears
// anywhere on the site" is a product decision, and a campaign added by accident
// - or a placeholder left in after a demo - would otherwise ship a house ad to
// every player silently.
//
// WHEN A REAL SPONSOR GOES LIVE this check is the one to change, deliberately,
// in the same commit that adds them. Everything below keeps working.
check(
  "No campaign is currently running",
  CAMPAIGNS.length === 0,
  CAMPAIGNS.length === 0
    ? "CAMPAIGNS is empty - every placement draws nothing and no slot is visible"
    : `${CAMPAIGNS.map((c) => c.id).join(", ")} would render. If that is intended, update this check in the same commit.`
);

for (const placement of Object.values(PLACEMENTS)) {
  check(
    `Placement "${placement}" draws nothing`,
    activeCampaigns(placement).length === 0,
    "no active campaign, so renderSponsor hides the container"
  );
}

// ---- 3. no campaign names a placement that cannot draw ---------------------
for (const campaign of SHAPE_CHECKED) {
  const unrenderable = campaign.placements.filter((p) => !RENDERED[p] && !DECLARED_ONLY.has(p));
  check(
    `${campaign.id}: every placement it names is real`,
    unrenderable.length === 0,
    unrenderable.length === 0
      ? campaign.placements.join(", ")
      : `${unrenderable.join(", ")} - not a declared placement`
  );
  const declaredOnly = campaign.placements.filter((p) => DECLARED_ONLY.has(p));
  check(
    `${campaign.id}: is not relying on a placement nothing renders yet`,
    declaredOnly.length === 0,
    declaredOnly.length === 0
      ? "all of its placements draw"
      : `${declaredOnly.join(", ")} is declared but has no container - this campaign would silently never show`
  );
}

// ---- 4. the shape of a campaign --------------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ids = new Set();

for (const campaign of SHAPE_CHECKED) {
  const required = ["id", "sponsor", "headline", "placements", "start"];
  const missing = required.filter((key) => !campaign[key]);
  check(
    `${campaign.id || "(no id)"}: has every required field`,
    missing.length === 0,
    missing.length === 0 ? required.join(", ") : `missing ${missing.join(", ")}`
  );

  // An id is the analytics key. Reusing one merges two campaigns' impressions
  // and clicks into a single row that can never be separated again.
  check(
    `${campaign.id}: id is unique`,
    !ids.has(campaign.id),
    ids.has(campaign.id) ? "duplicate - reporting for both would merge" : "unique"
  );
  ids.add(campaign.id);

  check(
    `${campaign.id}: start is an ISO date`,
    ISO_DATE.test(campaign.start),
    ISO_DATE.test(campaign.start) ? campaign.start : `"${campaign.start}" - the comparison is a string compare, so any other format sorts wrong`
  );
  check(
    `${campaign.id}: end is an ISO date or null`,
    campaign.end === null || campaign.end === undefined || ISO_DATE.test(campaign.end),
    campaign.end ? String(campaign.end) : "open-ended"
  );
  if (ISO_DATE.test(campaign.start) && ISO_DATE.test(campaign.end || "")) {
    check(
      `${campaign.id}: does not end before it starts`,
      campaign.end >= campaign.start,
      campaign.end >= campaign.start ? `${campaign.start} → ${campaign.end}` : `${campaign.start} → ${campaign.end}`
    );
  }

  // A click that goes nowhere, or a button with no destination, is a broken
  // placement either way.
  const hasHref = !!campaign.href;
  const hasCta = !!campaign.cta;
  check(
    `${campaign.id}: a destination and a button, or neither`,
    hasHref === hasCta,
    hasHref === hasCta ? (hasHref ? campaign.href : "not clickable") : "one without the other renders a dead or invisible link"
  );
  if (hasHref) {
    const safe = campaign.href.startsWith("https://") || campaign.href.startsWith("mailto:");
    check(
      `${campaign.id}: destination is https or mailto`,
      safe,
      safe ? campaign.href : `${campaign.href} - http: would be blocked as mixed content`
    );
  }

  // THE CSP CONSTRAINT. img-src is 'self' and data:, so a remote creative does
  // not load and says nothing about why.
  if (campaign.image) {
    const local = campaign.image.startsWith("assets/sponsor/");
    check(
      `${campaign.id}: creative is served from this origin`,
      local,
      local ? campaign.image : `${campaign.image} - the CSP img-src is 'self' and data:, so this will not load`
    );
    if (local) {
      const exists = existsSync(path.join(ROOT, campaign.image));
      check(
        `${campaign.id}: creative file exists`,
        exists,
        exists ? campaign.image : `${campaign.image} is not in the repository`
      );
    }
  }
}

// ---- 5. the date window actually filters -----------------------------------
// Exercised against fixed dates rather than trusting the comparison, because
// getting this wrong means running a campaign past what a sponsor bought.
const windowed = {
  id: "verify-window",
  sponsor: "Test",
  headline: "Test",
  placements: [PLACEMENTS.POSTGAME],
  start: "2026-06-01",
  end: "2026-06-30",
};
const cases = [
  ["2026-05-31", false, "the day before it starts"],
  ["2026-06-01", true, "its first day"],
  ["2026-06-15", true, "mid-flight"],
  ["2026-06-30", true, "its last day"],
  ["2026-07-01", false, "the day after it ends"],
];
for (const [day, expected, why] of cases) {
  // Midday local, so the assertion is about the date and not about a timezone
  // rolling it over.
  const actual = isRunning(windowed, new Date(`${day}T12:00:00`));
  check(
    `A campaign is ${expected ? "running" : "not running"} on ${why}`,
    actual === expected,
    `${day} → ${actual}`
  );
}

const openEnded = { ...windowed, end: null };
check(
  "An open-ended campaign keeps running",
  isRunning(openEnded, new Date("2030-01-01T12:00:00")),
  "end: null has no expiry"
);

check(
  "An unknown placement returns no campaigns",
  activeCampaigns("not-a-placement").length === 0,
  "returns [] rather than throwing"
);

// ---- 6. the rails cannot cost the game any width ---------------------------
// The whole justification for the side rails is that they use space the
// centred content was not using. A rail laid out in the flow, or shown at a
// width where there is no spare space, breaks that promise - and it breaks it
// as a squeezed game screen rather than as an error.
check(
  "The rails are fixed rather than in the content flow",
  /\.sponsor-rail\b[\s\S]{0,400}?position:\s*fixed/.test(styleCss),
  "position: fixed - the game's column is unchanged at every width"
);
check(
  "The rails are hidden by default",
  /\.sponsor-rail\s*\{\s*display:\s*none/.test(styleCss),
  "display: none until a media query says there is room"
);
const railGate = styleCss.match(/@media\s*\(min-width:\s*(\d+)px\)\s*and\s*\(min-height:\s*(\d+)px\)/);
check(
  "The rails only appear once there is genuinely room",
  !!railGate && Number(railGate[1]) >= 1100 + 2 * (160 + 24 + 16),
  railGate
    ? `min-width ${railGate[1]}px against 1100px of content plus two 160px rails and their gutters (needs ≥ ${1100 + 2 * (160 + 24 + 16)}px)`
    : "no width+height gate found - a fixed rail on a phone overlaps the game"
);
check(
  "The rails only appear on the home screen",
  styleCss.includes("body:has(#screen-home:not(.hidden)) .sponsor-rail"),
  "gated on the home screen being the visible one, in CSS rather than per navigation path"
);

console.log(renderSection("Sponsor inventory"));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
