#!/usr/bin/env node
// Banner artwork: does every banner have a real file, big enough, shaped right?
//
// WHY THIS EXISTS
//
// Two rounds of trouble, and the second one is why the first check below is
// first.
//
// Round one: the artwork was ~265x90 and the home identity card is ~1060px
// wide, so it drew at a ~3.9x upscale and shipped looking like a rendering
// fault. That was fixed by supplying artwork at 2120x720.
//
// Round two, during that upload: one banner stopped rendering. The file was
// named Pink-Blossom.png while the catalogue asked for blossom.png, AND the
// file was two bytes long - GitHub's web "rename" had opened a PNG in its text
// editor and saved a newline over it. Nothing in the suite noticed either
// thing. A catalogue entry pointing at a file that does not exist is invisible
// to every test that only looks at the files present on disk, which is what
// this file used to do.
//
// So the checks run in the order the failures happen:
//   1. every banner the app asks for actually resolves to a real image
//   2. it is big enough to fill the card
//   3. it is shaped like the card, so `cover` does not crop away the picture
//   4. it is not so heavy that the Rewards grid becomes a download
//
// Case matters. GitHub Pages serves from a case-sensitive filesystem while
// macOS does not, so `Blossom.png` for `blossom.png` works locally and 404s in
// production. The existence check compares against the real directory listing
// rather than asking the filesystem, precisely so it cannot be fooled by that.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { FRANCHISES, GENERAL_BANNERS } from "../js/banners.js";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const add = (title, ok, detail) => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

const DIR = "assets/banners";
const CSS = readFileSync("css/style.css", "utf8");

// The card's own proportions, and how far off a file may be before `cover`
// starts throwing away a meaningful part of the picture.
const CARD_ASPECT = 2120 / 720;
const ASPECT_TOLERANCE = 0.25;
// Artwork narrower than this cannot fill the card without visible upscaling.
// There is no longer a fallback treatment for art that misses it - the card
// simply stretches - so this is a build-time gate rather than a runtime branch.
const FULL_BLEED_MIN_WIDTH = 900;
// The Rewards grid renders every banner at once. The uploaded originals came in
// at 1.1-3.4 MB each, 48 MB in total, which is a download rather than a page.
const MAX_FILE_KB = 700;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Dimensions straight out of the file's own header - no image library needed,
 *  and no decode either. Handles both formats because the shipped artwork is
 *  JPEG while anything hand-added is likely to be PNG.
 *
 *  Returns null for anything that is not actually an image, which is the case
 *  the two-byte file taught us to check: a name is not a picture. */
function imageInfo(path) {
  let buf;
  try {
    buf = readFileSync(path);
  } catch {
    return null;
  }
  const bytes = statSync(path).size;

  if (buf.length >= 33 && buf.subarray(0, 8).equals(PNG_MAGIC)) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes, format: "png" };
  }

  // JPEG: walk the segment chain to the frame header, which is the only place
  // the dimensions live. SOF0-SOF15 carry them, except the four markers in that
  // range that mean something else (DHT, JPG, DAC, and the restart markers).
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), bytes, format: "jpeg" };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

// The real directory listing, used for a case-sensitive membership test.
const onDisk = new Set(readdirSync(DIR));

// Every banner the APP asks for - the catalogue is the source of truth here,
// not the folder. A file nobody references is harmless; a reference with no
// file is a blank banner in production.
const wanted = [...FRANCHISES, ...GENERAL_BANNERS].filter((b) => b.image);

// ---- 1. every referenced file resolves --------------------------------------
const missing = [];
const notPng = [];
const resolved = [];
for (const banner of wanted) {
  const name = banner.image.slice(`${DIR}/`.length);
  if (!banner.image.startsWith(`${DIR}/`) || !onDisk.has(name)) {
    missing.push(`${banner.id} -> ${banner.image}`);
    continue;
  }
  const info = imageInfo(banner.image);
  if (!info) {
    notPng.push(`${banner.id} -> ${banner.image}`);
    continue;
  }
  resolved.push({ id: banner.id, name, ...info });
}

add(
  "Every banner the app asks for has a file, at the exact path and case",
  missing.length === 0,
  missing.length === 0
    ? `${wanted.length} referenced banners, all present in ${DIR}/`
    : `no such file: ${missing.join(", ")} — Pages is case-sensitive even where your laptop is not`
);

add(
  "Every one of those files is a real image, not just a name",
  notPng.length === 0,
  notPng.length === 0
    ? `${resolved.length} files carry a valid ${[...new Set(resolved.map((r) => r.format))].join("/")} header`
    : `present but not an image: ${notPng.join(", ")} — a renamed-in-the-browser binary lands here`
);

// Everything below needs real files to measure, and would otherwise report a
// second, more confusing failure for the same cause.
if (missing.length === 0 && notPng.length === 0) {
  // ---- 2. big enough to fill the card ---------------------------------------
  const tooSmall = resolved.filter((r) => r.width < FULL_BLEED_MIN_WIDTH);
  const minW = Math.min(...resolved.map((r) => r.width));
  add(
    "Every banner is wide enough to fill the card",
    tooSmall.length === 0,
    tooSmall.length === 0
      ? `narrowest is ${minW}px, over the ${FULL_BLEED_MIN_WIDTH}px full-bleed threshold`
      : `still on the small-art treatment: ${tooSmall.map((r) => `${r.name} (${r.width}px)`).join(", ")}`
  );

  // ---- 3. shaped like the card ----------------------------------------------
  // `cover` crops whatever does not fit. A 1.5:1 file in a 2.94:1 card loses
  // half its height, and nothing about that is visible from a passing test -
  // the card looks fine, it is just showing a different picture than the file.
  const cropped = resolved
    .map((r) => {
      const aspect = r.width / r.height;
      const loss = aspect > CARD_ASPECT ? 1 - CARD_ASPECT / aspect : 1 - aspect / CARD_ASPECT;
      return { ...r, aspect, lossPct: Math.round(loss * 100) };
    })
    .filter((r) => Math.abs(r.aspect - CARD_ASPECT) > ASPECT_TOLERANCE)
    .sort((a, b) => b.lossPct - a.lossPct);
  add(
    "Every banner is shaped like the card, so `cover` crops nothing that matters",
    cropped.length === 0,
    cropped.length === 0
      ? `all ${resolved.length} within ${ASPECT_TOLERANCE} of ${CARD_ASPECT.toFixed(2)}:1`
      : `cropped at render: ${cropped.slice(0, 5).map((r) => `${r.name} ${r.aspect.toFixed(2)}:1 loses ${r.lossPct}%`).join(", ")}`
  );

  // ---- 4. light enough to ship ----------------------------------------------
  const heavy = resolved.filter((r) => r.bytes / 1024 > MAX_FILE_KB).sort((a, b) => b.bytes - a.bytes);
  const totalMb = resolved.reduce((sum, r) => sum + r.bytes, 0) / 1048576;
  add(
    "The banner set is light enough that the Rewards grid is a page, not a download",
    heavy.length === 0,
    heavy.length === 0
      ? `${resolved.length} files, ${totalMb.toFixed(1)} MB total, largest ${Math.round(Math.max(...resolved.map((r) => r.bytes)) / 1024)} KB`
      : `over ${MAX_FILE_KB} KB: ${heavy.slice(0, 5).map((r) => `${r.name} ${Math.round(r.bytes / 1024)} KB`).join(", ")} (${totalMb.toFixed(1)} MB total)`
  );
}

// ---- ids are persisted, so they cannot follow filenames -------------------
// The trap this nearly fell into. A banner's id is derived from its FILENAME,
// and profiles.equipped_banner and profiles.granted_banners store that id. So
// renaming blossom.png to Pink-Blossom.png would have changed the id to
// "pink-blossom" and, with no error anywhere, unequipped every player flying it
// and voided their grant - a data migration disguised as a file rename.
//
// bannerBase() now accepts an explicit `id` override for exactly that case.
// This list is the contract: these ids exist in the database, so they may be
// ADDED to but never renamed or removed without migrating those columns first.
const PERSISTED_IDS = [
  "rookie", "forest-pixel", "desert-wind", "reptile", "blossom", "purple-wind",
  "blue-wave", "arctic-stripe", "carbon-fiber", "gold", "crystal",
  "wild-fur", "skulls", "inferno",
  "volcanic", "crimson-splat", "good-luck",
  "woodland-camo", "hunter", "stealth", "urban-camo",
];
const liveIds = new Set(GENERAL_BANNERS.map((b) => b.id));
const vanished = PERSISTED_IDS.filter((id) => !liveIds.has(id));
add(
  "No banner id has changed out from under the database",
  vanished.length === 0,
  vanished.length === 0
    ? `all ${PERSISTED_IDS.length} stored ids still resolve`
    : `these ids are stored in equipped_banner/granted_banners and no longer exist: ${vanished.join(", ")}. ` +
      `Renaming a file renames its id unless bannerBase() is given an explicit \`id\`.`
);

// ---- the CSS side -----------------------------------------------------------
// The full-bleed path is what all of the above is in service of. It is set by
// applyArtResolution() in js/ui.js measuring the file, so the stylesheet has to
// have somewhere for that measurement to land.
add(
  "The card paints the artwork itself, not a stand-in for it",
  /\.player-banner\.has-banner-image > \.pb-banner-wash \{[^}]*background-image: var\(--banner-image\)/.test(CSS) &&
    !/linear-gradient\(120deg, var\(--banner-c1\)/.test(CSS) &&
    !/\.pb-banner-plate/.test(CSS),
  "no colour field, no plate - both were workarounds for artwork that was too small"
);

// The art must be painted on a DESCENDANT of the card, not on the card itself:
// an element cannot match a container query on itself, so art painted on the
// card ignores the query entirely. Written the wrong way round first, and the
// browser check is what caught it.
// The art goes on a LAYER, never on .player-banner itself. Originally that was
// so a container query could reach it; the query is gone, but the reason to
// keep the layer is now different and just as real - the card's own background
// is the fallback a missing file falls back TO, and painting the artwork
// directly onto the card would cover it.
add(
  "The artwork is painted on a layer, leaving the card's own background as the fallback",
  !/\.player-banner\.has-banner-image \{\s*\n\s*background-image:/.test(CSS),
  "a missing file drops .has-banner-image and the card's own background shows through"
);

console.log(renderSection("Banner artwork: real files, big enough, shaped like the card"));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
