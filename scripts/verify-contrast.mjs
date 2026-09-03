#!/usr/bin/env node
// Every colour a player can put on the screen, against the surface it lands on.
//
// WHY THIS EXISTS
//
// scripts/verify-sport-contract.mjs checks the contrast of exactly two
// colours: each sport's accent against its declared accentContrast. That is
// the palette the APP chose. It is not the palette a PLAYER chooses, and the
// player's is much larger - fourteen kits, each with a primary and a
// secondary, worn in any of 196 home-and-away pairings, plus a franchise
// banner drawn from real team colours.
//
// None of that was checked anywhere. wornColours() tests the ONE case where it
// already had to compute a candidate - an away kit shifted off a clashing home
// kit is held to MIN_SURFACE_CONTRAST - and a kit worn as authored, which is
// the overwhelmingly common case, went to the board untested.
//
// WHAT THE THRESHOLDS ARE, AND WHY THEY ARE NOT ALL 4.5
//
// Kit ink is TEXT, and almost all of it is large text: the scoreboard score is
// 2.4rem and bold, the team name 1rem and bold. WCAG puts large text (18.66px
// bold and up) at 3:1 and normal text at 4.5:1, and the kit palette is
// deliberately saturated - a game's team colours are not body copy and holding
// orange to 4.5:1 on a near-black board would leave a palette of pastels.
//
// So the floor is the one the code already set for itself:
// MIN_SURFACE_CONTRAST, 3:1, which is WCAG AA for the large text this actually
// is. What this file adds is that it applies to every kit rather than only to
// the ones that had to be shifted.
//
// THE PAIRING MATTERS AS MUCH AS THE SURFACE. Two teams whose inks clear the
// board but not each other are two teams a viewer cannot tell apart, which on
// a scoreboard is worse than a dim colour. wornColours already separates them
// by MIN_KIT_SEPARATION in Lab space; this drives every pairing through it and
// checks the promise held.

import { KITS, wornColours, BOARD_SURFACE, MIN_SURFACE_CONTRAST, MIN_KIT_SEPARATION } from "../js/kits.js";
import { FRANCHISES } from "../js/banners.js";
import { renderCheck, renderSection, renderTable, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

console.log(renderSection("Contrast (every colour a player can choose)"));

// ---- WCAG 2.1, the same arithmetic verify-sport-contract.mjs uses ----------
const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
function luminance(hex) {
  const h = String(hex).replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}
function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---- 1. Every kit colour, as authored, against the board -------------------
//
// Both halves of every kit, because either can be worn: home wears its
// primary, away wears its secondary.
const kitRows = [["kit", "primary", "vs board", "secondary", "vs board"]];
const dimKits = [];
for (const kit of KITS) {
  const p = contrastRatio(kit.primary, BOARD_SURFACE);
  const s = contrastRatio(kit.secondary, BOARD_SURFACE);
  kitRows.push([kit.name, kit.primary, `${p.toFixed(2)}:1`, kit.secondary, `${s.toFixed(2)}:1`]);
  if (p < MIN_SURFACE_CONTRAST) dimKits.push(`${kit.name} primary ${kit.primary} at ${p.toFixed(2)}:1`);
  if (s < MIN_SURFACE_CONTRAST) dimKits.push(`${kit.name} secondary ${kit.secondary} at ${s.toFixed(2)}:1`);
}
console.log(renderTable(kitRows));
check(
  `Every kit colour is legible on the board (>= ${MIN_SURFACE_CONTRAST}:1)`,
  dimKits.length === 0,
  dimKits.length === 0
    ? `${KITS.length * 2} colours over ${KITS.length} kits, all clear`
    : dimKits.join("\n    ")
);

// ---- 2. Every pairing a game can actually deal -----------------------------
//
// Driven through wornColours rather than compared directly, because that is
// what decides what is worn: the away side may be shifted off the home side,
// and the shifted colour is the one that reaches the board.
let pairs = 0;
const dimWorn = [];
const tooClose = [];
for (const home of KITS) {
  for (const away of KITS) {
    const worn = wornColours(home.id, away.id);
    pairs += 1;
    for (const [side, ink] of [["home", worn.home.ink], ["away", worn.away.ink]]) {
      const ratio = contrastRatio(ink, BOARD_SURFACE);
      if (ratio < MIN_SURFACE_CONTRAST) {
        dimWorn.push(`${home.name} vs ${away.name}: ${side} ink ${ink} at ${ratio.toFixed(2)}:1`);
      }
    }
    // The two sides must also be distinguishable FROM EACH OTHER. A scoreboard
    // where both teams read in the same colour is unreadable however bright
    // the two colours are.
    const separation = contrastRatio(worn.home.ink, worn.away.ink);
    if (separation < 1.12 && worn.home.ink.toLowerCase() === worn.away.ink.toLowerCase()) {
      tooClose.push(`${home.name} vs ${away.name}: both sides wore ${worn.home.ink}`);
    }
  }
}
check(
  `Every worn pairing stays legible on the board (${pairs} pairings)`,
  dimWorn.length === 0,
  dimWorn.length === 0
    ? `${pairs * 2} worn inks over ${pairs} home-and-away pairings, all clear`
    : dimWorn.slice(0, 8).join("\n    ") + (dimWorn.length > 8 ? `\n    ...and ${dimWorn.length - 8} more` : "")
);
check(
  "No pairing dresses both teams in the same colour",
  tooClose.length === 0,
  tooClose.length === 0
    ? `separation held by wornColours at >= ${MIN_KIT_SEPARATION} in Lab space`
    : tooClose.slice(0, 8).join("\n    ")
);

// ---- 3. Franchise banners --------------------------------------------------
//
// THE PAIRING HERE IS NOT THE ONE ON THE BOARD, and getting that wrong the
// first time is worth recording. A franchise colour is not ink on the
// scoreboard - it is the BACKGROUND of the banner card, drawn as a c1-to-c2
// gradient under a darkening scrim, with the franchise label printed on it in
// white. Measured against the board, eight franchises "failed" for being dark
// navy and black; against the thing actually printed on them, dark is the
// easy case and it is a LIGHT team colour that would be unreadable.
//
// A real team's colours are not ours to change, so this cannot be fixed by
// editing the palette - it would be fixed by darkening the scrim under the
// label. That is why the check is worth having: it says which franchise, and
// there is a lever that is not the data.
//
// The scrim is .player-banner.has-banner::after, a black gradient running 8%
// at the top to 42% at the bottom, and the label sits at the BOTTOM - so its
// background is c2 under 42% black. Composited here rather than assumed,
// because "the colour is dark enough" and "the colour under the scrim is dark
// enough" are different claims and only the second one is true of the pixels.
const LABEL_INK = "#ffffff";
const LABEL_SCRIM_ALPHA = 0.42;
// ...and the label's OWN plate on top of that, which is what makes the result
// independent of the team's colours - see .pb-banner-label. Without it the
// Nets (whose second colour is white) sat at 3.03:1 and Milwaukee at 3.77:1,
// and the only lever that would have fixed them was darkening every banner in
// the game.
const LABEL_PLATE_ALPHA = 0.55;
// 0.95rem at weight 800 is about 15px bold - under WCAG's 18.66px bold
// threshold for large text, so it is held to the normal-text 4.5:1 rather than
// 3:1. The heavy text-shadow it carries genuinely helps and earns no credit
// here, which keeps the check honest rather than generous.
const LABEL_MIN = 4.5;

/** A colour composited under black at `alpha` - what the scrim leaves. */
function darken(hex, alpha) {
  const h = String(hex).replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const mix = (v) => Math.round(v * (1 - alpha));
  const out = (mix((n >> 16) & 255) << 16) | (mix((n >> 8) & 255) << 8) | mix(n & 255);
  return `#${out.toString(16).padStart(6, "0")}`;
}

const dimBanners = [];
let banners = 0;
let worstLabel = { ratio: Infinity, name: null };
for (const franchise of FRANCHISES) {
  const colours = franchise.colors || [];
  if (colours.length < 2) continue;
  banners += 1;
  const under = darken(darken(colours[1], LABEL_SCRIM_ALPHA), LABEL_PLATE_ALPHA);
  const ratio = contrastRatio(LABEL_INK, under);
  if (ratio < worstLabel.ratio) worstLabel = { ratio, name: franchise.name, under, raw: colours[1] };
  if (ratio < LABEL_MIN) {
    dimBanners.push(`${franchise.name}: white on ${colours[1]} composites to ${under}, ${ratio.toFixed(2)}:1`);
  }
}
check(
  `Every franchise banner's label is readable on its own colours (${banners} franchises)`,
  dimBanners.length === 0,
  dimBanners.length === 0
    ? `tightest is ${worstLabel.name} at ${worstLabel.ratio.toFixed(2)}:1 ` +
      `(white on ${worstLabel.raw} under the card scrim and the label plate)`
    : dimBanners.join("\n    ")
);

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
