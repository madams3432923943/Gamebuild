#!/usr/bin/env node
// Team kits: the guarantee that two players' colours never collapse into one.
//
// WHY THIS EXISTS
//
// The shot chart distinguishes the two teams by colour before anything else -
// markers, callouts and the buzzer zone summary all key off side. That was safe
// while the two colours were chosen once by us. Kits hand the choice to players,
// which is the point of the feature and also the only way it can break: two
// people pick navy and the game stops being readable.
//
// The design answer is a curated palette plus the away-kit rule. This is the
// part that proves the answer holds, over EVERY pair, rather than over the pairs
// somebody happened to try. Fourteen kits is 196 combinations; a person will
// check four.
//
// If a new kit cannot pass this, the kit is wrong - not the threshold. Loosening
// MIN_KIT_SEPARATION to admit a colour is how the feature quietly stops working.

import {
  KITS,
  kitById,
  wornColours,
  colourDistance,
  contrastRatio,
  luminance,
  hexToRgb,
  rgbString,
  shiftHue,
  COURT_SURFACE,
  MIN_SURFACE_CONTRAST,
  MIN_KIT_SEPARATION,
  DEFAULT_KIT_ID,
  BOT_KIT_ID,
} from "../js/kits.js";
import { SPORTS } from "../js/sports/index.js";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const add = (title, ok, detail) => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

// ---- the catalogue is well formed ------------------------------------------
const badHex = KITS.filter(
  (k) => !/^#[0-9a-f]{6}$/i.test(k.primary) || !/^#[0-9a-f]{6}$/i.test(k.secondary)
);
add(
  "Every kit declares two six-digit hex colours",
  badHex.length === 0,
  badHex.length === 0 ? `${KITS.length} kits` : badHex.map((k) => k.id).join(", ")
);

const dupeIds = KITS.map((k) => k.id).filter((id, i, all) => all.indexOf(id) !== i);
add("Kit ids are unique", dupeIds.length === 0, dupeIds.length ? dupeIds.join(", ") : "no duplicates");

// ---- every colour survives the floor it is drawn on ------------------------
const dim = [];
for (const kit of KITS) {
  for (const [which, hex] of [["primary", kit.primary], ["secondary", kit.secondary]]) {
    const ratio = contrastRatio(hex, COURT_SURFACE);
    if (ratio < MIN_SURFACE_CONTRAST) dim.push(`${kit.id}/${which} ${ratio.toFixed(2)}:1`);
  }
}
add(
  `Every kit colour clears ${MIN_SURFACE_CONTRAST}:1 against the court`,
  dim.length === 0,
  dim.length === 0
    ? `${KITS.length * 2} colours, all visible on ${COURT_SURFACE}`
    : `too dim: ${dim.join(", ")}`
);

// ---- a kit's alternate is actually an alternate ----------------------------
// If the secondary is a shade of the primary it is not a change of kit, and the
// away rule has nothing useful to reach for.
const weakAlternates = KITS.filter((k) => colourDistance(k.primary, k.secondary) < MIN_KIT_SEPARATION)
  .map((k) => `${k.id} (${colourDistance(k.primary, k.secondary).toFixed(1)})`);
add(
  "Each kit's secondary is a real alternate, not a shade of its primary",
  weakAlternates.length === 0,
  weakAlternates.length === 0 ? "all fourteen change visibly" : weakAlternates.join(", ")
);

// ---- THE LOAD-BEARING CHECK: every pairing stays readable ------------------
// Every kit against every other, in both seats, after the away rule has run.
const collisions = [];
let worstPair = { distance: Infinity, label: "" };
let shiftedCount = 0;
let pairs = 0;

for (const home of KITS) {
  for (const away of KITS) {
    pairs += 1;
    const worn = wornColours(home.id, away.id);
    const distance = colourDistance(worn.home.ink, worn.away.ink);
    if (worn.shifted) shiftedCount += 1;
    if (distance < worstPair.distance) {
      worstPair = { distance, label: `${home.id} (home) vs ${away.id} (away)` };
    }
    if (distance < MIN_KIT_SEPARATION) {
      collisions.push(`${home.id} vs ${away.id} = ${distance.toFixed(1)}`);
    }
  }
}
add(
  "No two kits collide once the away rule has run",
  collisions.length === 0,
  collisions.length === 0
    ? `${pairs} pairings, worst ${worstPair.distance.toFixed(1)} (${worstPair.label}), ${shiftedCount} needed a shift`
    : `${collisions.length} collisions: ${collisions.slice(0, 4).join(", ")}`
);

// Same kit against itself is the case a player will actually hit - two friends
// both picking Nova - and it MUST be the hardest one that still works.
const mirror = wornColours(DEFAULT_KIT_ID, DEFAULT_KIT_ID);
const mirrorDistance = colourDistance(mirror.home.ink, mirror.away.ink);
add(
  "Two players in the same kit are still told apart",
  mirrorDistance >= MIN_KIT_SEPARATION,
  `${DEFAULT_KIT_ID} vs ${DEFAULT_KIT_ID}: ${mirrorDistance.toFixed(1)} (${mirror.home.ink} vs ${mirror.away.ink})`
);

// ---- determinism -----------------------------------------------------------
// Both clients compute this independently. If it is not deterministic the two
// players watch differently coloured versions of the same game.
const once = wornColours("nova", "ember");
const twice = wornColours("nova", "ember");
add(
  "The same pairing always produces the same kits",
  JSON.stringify(once) === JSON.stringify(twice),
  `${once.home.ink} vs ${once.away.ink}, stable`
);

// Home and away are not symmetric - swapping the seats should change who wears
// what, or "home" means nothing.
const swapped = wornColours("ember", "nova");
add(
  "Home and away wear different things when the seats swap",
  once.home.ink !== swapped.home.ink,
  `nova home: ${once.home.ink}, ember home: ${swapped.home.ink}`
);

// ---- never undefined -------------------------------------------------------
const junk = ["", null, undefined, "not-a-kit", "../../etc/passwd", 42];
const resolved = junk.map((id) => kitById(id));
add(
  "kitById never returns undefined, whatever it is handed",
  resolved.every((k) => k && k.primary && k.secondary),
  `${junk.length} junk ids all resolved to ${resolved[0]?.id}`
);
add(
  "The bot has a kit and it is a real one",
  !!kitById(BOT_KIT_ID) && kitById(BOT_KIT_ID).id === BOT_KIT_ID,
  `bot wears ${kitById(BOT_KIT_ID).name}`
);

// ---- helpers behave -------------------------------------------------------
add(
  "rgbString gives CSS the form it needs",
  rgbString("#ff8a3d") === "255, 138, 61",
  rgbString("#ff8a3d")
);
add(
  "A full turn of the hue wheel comes back where it started",
  colourDistance(shiftHue("#3cb464", 360), "#3cb464") < 2,
  `distance ${colourDistance(shiftHue("#3cb464", 360), "#3cb464").toFixed(2)}`
);
add(
  "Luminance is ordered the way eyes are",
  luminance("#ffffff") > luminance("#8fa3c4") && luminance("#8fa3c4") > luminance("#000000"),
  "white > steel > black"
);

// ---- while we are here: the sport rule nothing was enforcing ---------------
// CLAUDE.md: "A sport's accentContrast must clear 4.5:1 against its accent."
// That was stated and never checked anywhere in the repo. The colour maths this
// feature needed is the maths that can finally check it.
const badAccents = [];
for (const sport of SPORTS) {
  const t = sport.theme;
  if (!t?.accent || !t?.accentContrast) continue;
  const ratio = contrastRatio(t.accentContrast, t.accent);
  if (ratio < 4.5) badAccents.push(`${sport.id} ${ratio.toFixed(2)}:1`);
  // The declared rgb triple has to match the hex, or rgba() tints drift away
  // from the solid colour they are supposed to be a transparent version of.
  if (t.accentRgb && t.accentRgb.replace(/\s/g, "") !== rgbString(t.accent).replace(/\s/g, "")) {
    badAccents.push(`${sport.id} accentRgb ${t.accentRgb} != ${rgbString(t.accent)}`);
  }
}
add(
  "Every sport's accentContrast clears 4.5:1 on its accent, and accentRgb matches",
  badAccents.length === 0,
  badAccents.length === 0
    ? SPORTS.filter((s) => s.theme?.accent).map((s) => `${s.id} ${contrastRatio(s.theme.accentContrast, s.theme.accent).toFixed(1)}:1`).join(", ")
    : badAccents.join("; ")
);

console.log(renderSection(`Team kits: ${KITS.length} kits, ${pairs} pairings, one readable game`));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
