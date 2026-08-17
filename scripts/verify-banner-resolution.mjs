#!/usr/bin/env node
// How large the banner artwork is allowed to be drawn.
//
// WHY THIS EXISTS
//
// The twenty general banners are real PNGs of about 265x90. The home identity
// card used one as full-bleed wallpaper with `background-size: cover`, which on
// a desktop-width card is a ~3.9x upscale. It shipped, and it read as a
// rendering fault rather than as a style - the first thing said about it was
// "big error here".
//
// Nothing in CSS invents detail that is not in the file, and tiling is not
// available either: these textures do not wrap. That is measured, not assumed -
// see the seam figures below. So the rule is the only one that can hold: never
// draw the art at more than MAX_UPSCALE, and fill the rest of the card with a
// blur where softness is obviously deliberate.
//
// This file guards the two halves of that. First, that the source art is the
// size the CSS was written against - if someone drops in bigger or smaller
// PNGs, the numbers baked into the layout stop meaning anything. Second, that
// the textures still do not tile, because "just repeat it" is the obvious
// suggestion and it has already been measured and rejected once.
//
// The real fix, when it is available, is bigger source art. At 1060x360 or so
// the card could go back to plain `cover` and this whole treatment could be
// deleted. That is a design commission, not a code change.

import { readFileSync, readdirSync } from "node:fs";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const add = (title, ok, detail) => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

const DIR = "assets/banners";
const CSS = readFileSync("css/style.css", "utf8");

// The widest the home card gets in the app's own layout, measured rather than
// guessed: the page is capped and the card fills it.
const CARD_MAX_WIDTH = 1100;
// Past this the upscale stops reading as softness and starts reading as broken.
const MAX_UPSCALE = 1.6;

/** PNG dimensions straight out of the IHDR chunk - no image library needed. */
function pngSize(path) {
  const head = readFileSync(path).subarray(0, 33);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".png"));
const sizes = files.map((f) => ({ f, ...pngSize(`${DIR}/${f}`) }));

// ---- the art is the size the layout was written against ---------------------
const widths = sizes.map((s) => s.width);
const minW = Math.min(...widths);
const maxW = Math.max(...widths);
add(
  "Every banner PNG is still the small texture the card was designed around",
  minW >= 200 && maxW <= 400,
  `${sizes.length} files, ${minW}-${maxW}px wide. If this fails because the art got BIGGER, ` +
    `that is good news: re-check whether the wash/plate treatment is still needed at all.`
);

// ---- full-bleed cover is off on wide cards ----------------------------------
// The actual defect, asserted against the stylesheet. A card 1060px wide
// showing a 270px image is the 3.9x that got reported.
const worstUpscale = CARD_MAX_WIDTH / maxW;
add(
  "Full-bleed art on a desktop-width card would exceed the upscale limit",
  worstUpscale > MAX_UPSCALE,
  `${worstUpscale.toFixed(1)}x at ${CARD_MAX_WIDTH}px - which is why the treatment below exists`
);

// The container query is the mechanism, so its absence is the regression. A
// plain string check, because the alternative is parsing CSS to prove a
// negative; verify-browser.mjs asserts the rendered result.
//
// The art must be painted on a DESCENDANT of the card, not on the card itself.
// That is not a style preference: an element cannot match a container query on
// itself, so art painted on the card ignores the query entirely and stays
// stretched. It was written the wrong way round first and the browser check is
// what caught it.
add(
  "The artwork is painted on a layer inside the card, where the container query can reach it",
  /@container \(min-width: 480px\)/.test(CSS) &&
    /\.player-banner\.has-banner-image > \.pb-banner-wash \{[^}]*background-image: var\(--banner-image\)/.test(CSS) &&
    !/\.player-banner\.has-banner-image \{\s*\n\s*background-image:/.test(CSS),
  "the card itself paints no artwork - .pb-banner-wash does, and it is a descendant"
);

add(
  "The sharp plate is capped near native size",
  /width: min\(351px, 38%\)/.test(CSS),
  `351px against ${maxW}px of source is ${(351 / maxW).toFixed(2)}x, inside the ${MAX_UPSCALE}x limit`
);

// The layers are absolutely positioned decoration inside a flex column. Left
// in the flow they would each take the card's 0.9rem gap and shove its
// contents apart on every phone, where the treatment is not even active.
// The layers are absolutely positioned decoration inside a flex column. Left
// in the flow they would take the card's 0.9rem gap and shove its contents
// apart - including on banners that have no artwork at all.
add(
  "The layers stay out of the flex flow until they have artwork to draw",
  /\.pb-banner-wash,\s*\n\.pb-banner-plate \{\s*\n(\s*\/\*[\s\S]*?\*\/\s*\n)?\s*display: none;/.test(CSS),
  "display:none by default; only .has-banner-image turns them on"
);

// ---- the textures still do not tile ----------------------------------------
// Guarding the rejected alternative. Measured with Chromium's canvas in
// tools/, and recorded here as the conclusion: seam difference at the wrap
// ran 2-20x each image's own neighbouring-pixel difference, so `repeat` draws
// a visible grid. If someone commissions seamless art, THIS is the check to
// re-run and delete - not the treatment to quietly turn off.
add(
  "Tiling is documented as measured-and-rejected, not merely untried",
  /Tiling was measured and rejected/.test(CSS) && /seams/.test(CSS),
  "the stylesheet says why repeat is wrong, so the next person does not re-litigate it"
);

console.log(renderSection("Banner artwork: how far a 265x90 texture may be stretched"));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
