// Cartoon emblems: the artwork behind team icons.
//
// WHY THESE ARE ORIGINAL DRAWINGS AND NOT TEAM LOGOS
//
// Every real NBA and NFL logo is a registered trademark. Reproducing one -
// traced, redrawn, "cartoonified", or copied from a sprite sheet - is a
// trademark problem that no amount of stylisation fixes, and it would put a
// licensing liability into a hobby project for the sake of an avatar. So none
// of these are derived from a real mark. They are generic mascot silhouettes:
// a bear is A bear, not any team's bear, and the only thing tying one to a
// franchise is the franchise's own colours and abbreviation, both of which
// this app already generates its banner art from (see css/style.css's
// .banner-art: "no image assets to ship and no likeness to license").
//
// The consequence worth stating plainly: a Bulls icon looks like a cartoon
// bull in Bulls colours. It does not look like the Bulls logo, and it is not
// supposed to.
//
// WHY SVG, IN A CODEBASE THAT IS OTHERWISE ALL EMOJI
//
// Sixty-two franchises need sixty-two marks that tint to arbitrary colour
// pairs and stay sharp from a 34px avatar to a 96px reward tile. Emoji cannot
// be recoloured. Bitmaps would be sixty-two files to ship, generate and
// cache-bust. Paths do both for free and cost nothing to download, since they
// are already in the bundle.
//
// This is the only file in the app that builds SVG, and emblemSvg is the only
// way to get one. Everything else - the home card, the profile, the Rewards
// grid - goes through it, so the shapes are drawn identically wherever they
// appear and there is one place to fix if they are not.

import { contrastRatio, luminance } from "./kits.js";

/** Shape space for every glyph below. Square, so a mark drops into a circular
 * avatar without per-glyph fitting. */
const VIEW_BOX = "0 0 100 100";

/** A radial ring of teeth/rays, used by the gear and the sun.
 *
 * Written as a generator rather than a literal path because eight evenly
 * spaced spokes is exactly the kind of thing that looks subtly wrong when
 * eyeballed by hand, and subtly wrong at 34px reads as a rendering bug rather
 * than a style. Everything else here is hand-drawn; these two are arithmetic.
 */
function spokes(count, inner, outer, halfWidth) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    const pt = (r, offset) => {
      const t = a + offset;
      return `${(50 + r * Math.cos(t)).toFixed(1)} ${(50 + r * Math.sin(t)).toFixed(1)}`;
    };
    parts.push(
      `M${pt(inner, -halfWidth)} L${pt(outer, -halfWidth * 0.62)} ` +
        `L${pt(outer, halfWidth * 0.62)} L${pt(inner, halfWidth)} Z`
    );
  }
  return parts.join(" ");
}

/** A circle as path data, so every glyph is the same kind of thing. */
function disc(cx, cy, r) {
  return `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
}

/**
 * The glyph library.
 *
 * Each entry is a list of paths painted back to front. `tone` picks which of
 * the three resolved colours the path takes (see emblemSvg): "mark" is the
 * body of the drawing, "accent" is the detail on top of it, and "cut" is the
 * knocked-out detail that has to read against the mark itself - eyes, a
 * muzzle, a window.
 *
 * Kept deliberately chunky. These are drawn at 34px on the home card, where
 * anything finer than a few pixels of stroke disappears into the background.
 */
export const EMBLEMS = {
  bird: {
    name: "Bird",
    paths: [
      { tone: "mark", d: "M42 14C64 14 78 32 78 52C78 74 62 90 42 90C22 90 10 74 10 52C10 30 20 14 42 14Z" },
      { tone: "accent", d: "M72 42L98 54L72 68L66 55Z" },
      { tone: "cut", d: disc(38, 44, 8) },
    ],
  },
  bigcat: {
    name: "Big cat",
    paths: [
      { tone: "mark", d: "M10 8L38 28L18 42Z" },
      { tone: "mark", d: "M90 8L62 28L82 42Z" },
      { tone: "mark", d: "M50 20C72 20 86 38 86 56C86 78 70 94 50 94C30 94 14 78 14 56C14 38 28 20 50 20Z" },
      { tone: "cut", d: "M26 48L44 54L26 60Z" },
      { tone: "cut", d: "M74 48L56 54L74 60Z" },
      { tone: "cut", d: "M50 66L60 74L50 82L40 74Z" },
    ],
  },
  bear: {
    name: "Bear",
    paths: [
      { tone: "mark", d: disc(24, 26, 13) },
      { tone: "mark", d: disc(76, 26, 13) },
      { tone: "mark", d: "M50 18C72 18 86 36 86 56C86 78 70 92 50 92C30 92 14 78 14 56C14 36 28 18 50 18Z" },
      { tone: "cut", d: "M50 56C61 56 68 63 68 71C68 80 60 86 50 86C40 86 32 80 32 71C32 63 39 56 50 56Z" },
      { tone: "accent", d: disc(50, 66, 6) },
    ],
  },
  wolf: {
    name: "Wolf",
    paths: [
      { tone: "mark", d: "M50 92L16 62L10 16L34 34H66L90 16L84 62Z" },
      { tone: "cut", d: "M50 84L36 60H64Z" },
      { tone: "cut", d: disc(34, 50, 6) },
      { tone: "cut", d: disc(66, 50, 6) },
    ],
  },
  horse: {
    name: "Horse",
    paths: [
      { tone: "mark", d: "M26 94V62C26 44 34 32 48 24L42 8L58 16L66 4L72 24C88 32 96 46 94 58L62 62L56 94Z" },
      { tone: "accent", d: "M48 24L26 40L30 56L48 40Z" },
      { tone: "cut", d: disc(84, 52, 5) },
      { tone: "cut", d: disc(66, 38, 5) },
    ],
  },
  bull: {
    name: "Bull",
    paths: [
      { tone: "accent", d: "M4 52C-4 22 14 2 42 8L38 24C22 20 10 30 16 50Z" },
      { tone: "accent", d: "M96 52C104 22 86 2 58 8L62 24C78 20 90 30 84 50Z" },
      { tone: "mark", d: "M50 26C66 26 78 38 78 52C78 62 73 70 66 76L62 94H38L34 76C27 70 22 62 22 52C22 38 34 26 50 26Z" },
      { tone: "cut", d: disc(38, 48, 6) },
      { tone: "cut", d: disc(62, 48, 6) },
      { tone: "cut", d: disc(50, 74, 7) },
    ],
  },
  ram: {
    name: "Ram",
    paths: [
      { tone: "accent", d: "M34 14C10 14 -2 38 10 58C20 74 44 74 48 54L36 50C34 60 24 60 20 52C13 40 20 26 36 26Z" },
      { tone: "accent", d: "M66 14C90 14 102 38 90 58C80 74 56 74 52 54L64 50C66 60 76 60 80 52C87 40 80 26 64 26Z" },
      { tone: "mark", d: "M50 22C62 22 70 34 70 50C70 72 62 92 50 92C38 92 30 72 30 50C30 34 38 22 50 22Z" },
      { tone: "cut", d: disc(42, 46, 5) },
      { tone: "cut", d: disc(58, 46, 5) },
    ],
  },
  fish: {
    name: "Fish",
    paths: [
      { tone: "mark", d: "M6 56C24 32 56 26 78 36L94 22L90 46C96 54 94 66 84 72C62 86 28 82 6 56Z" },
      { tone: "accent", d: "M44 32L54 8L62 34Z" },
      { tone: "cut", d: disc(24, 52, 6) },
    ],
  },
  ship: {
    name: "Ship",
    paths: [
      { tone: "accent", d: "M52 6L86 64H52Z" },
      { tone: "accent", d: "M46 22V64H16Z" },
      { tone: "mark", d: "M6 68H94L80 92H20Z" },
    ],
  },
  skull: {
    name: "Skull",
    paths: [
      { tone: "mark", d: "M50 6C72 6 88 24 88 46C88 60 82 71 72 77V92H28V77C18 71 12 60 12 46C12 24 28 6 50 6Z" },
      { tone: "cut", d: disc(34, 46, 10) },
      { tone: "cut", d: disc(66, 46, 10) },
      { tone: "cut", d: "M50 60L58 74H42Z" },
    ],
  },
  rocket: {
    name: "Rocket",
    paths: [
      { tone: "accent", d: "M32 52L12 82L34 74Z" },
      { tone: "accent", d: "M68 52L88 82L66 74Z" },
      { tone: "mark", d: "M50 4C63 18 70 38 70 58L58 74H42L30 58C30 38 37 18 50 4Z" },
      { tone: "cut", d: disc(50, 36, 10) },
    ],
  },
  bolt: {
    name: "Bolt",
    paths: [{ tone: "mark", d: "M62 4L20 54H44L38 96L82 40H56Z" }],
  },
  flame: {
    name: "Flame",
    paths: [
      { tone: "mark", d: "M50 4C66 26 80 38 80 58C80 78 66 92 50 92C34 92 20 78 20 58C20 42 30 36 38 24C40 40 46 44 50 38C54 32 52 18 50 4Z" },
      { tone: "cut", d: "M50 50C58 60 64 66 64 74C64 82 58 88 50 88C42 88 36 82 36 74C36 66 42 60 50 50Z" },
    ],
  },
  star: {
    name: "Star",
    paths: [{ tone: "mark", d: "M50 6L62 38H96L68 58L79 92L50 71L21 92L32 58L4 38H38Z" }],
  },
  crown: {
    name: "Crown",
    paths: [
      { tone: "mark", d: "M10 82L18 26L36 48L50 14L64 48L82 26L90 82Z" },
      { tone: "cut", d: "M20 68H80L82 80H18Z" },
    ],
  },
  gear: {
    name: "Gear",
    paths: [
      { tone: "mark", d: spokes(8, 26, 46, 0.32) },
      { tone: "mark", d: disc(50, 50, 30) },
      { tone: "cut", d: disc(50, 50, 13) },
    ],
  },
  shield: {
    name: "Shield",
    paths: [
      { tone: "mark", d: "M50 4L88 18V50C88 72 72 88 50 96C28 88 12 72 12 50V18Z" },
      { tone: "cut", d: "M50 20L74 28V50C74 64 64 75 50 81C36 75 26 64 26 50V28Z" },
      { tone: "accent", d: "M50 30L62 36V50C62 59 57 66 50 70C43 66 38 59 38 50V36Z" },
    ],
  },
  mountain: {
    name: "Mountain",
    paths: [
      { tone: "mark", d: "M4 86L34 30L50 58L66 20L96 86Z" },
      { tone: "accent", d: "M66 20L78 42L70 46L62 38L56 46L50 34Z" },
    ],
  },
  sun: {
    name: "Sun",
    paths: [
      { tone: "accent", d: spokes(12, 30, 48, 0.16) },
      { tone: "mark", d: disc(50, 50, 28) },
    ],
  },
  clover: {
    name: "Clover",
    paths: [
      { tone: "mark", d: disc(50, 26, 18) },
      { tone: "mark", d: disc(28, 50, 18) },
      { tone: "mark", d: disc(72, 50, 18) },
      { tone: "accent", d: "M46 54H56L58 94H44Z" },
    ],
  },
  wave: {
    name: "Wave",
    paths: [
      { tone: "mark", d: "M6 90C6 54 30 24 62 24C78 24 90 34 90 48C90 60 81 69 69 69C59 69 51 61 51 51H63C63 56 65 58 68 58C72 58 78 55 78 48C78 40 71 36 62 36C38 36 20 58 20 90Z" },
      { tone: "accent", d: "M4 74C20 62 34 84 50 74C64 65 78 86 96 72V88C78 100 64 80 50 88C34 97 20 76 4 88Z" },
    ],
  },
  claw: {
    name: "Claw",
    paths: [
      { tone: "mark", d: "M14 8C30 30 40 58 42 92L26 82C24 54 20 30 14 8Z" },
      { tone: "mark", d: "M46 4C60 28 68 58 68 94L52 84C52 54 50 28 46 4Z" },
      { tone: "mark", d: "M78 10C88 34 92 60 90 92L76 82C78 56 78 32 78 10Z" },
    ],
  },
  insect: {
    name: "Insect",
    paths: [
      { tone: "accent", d: "M36 30C16 20 4 32 12 46C18 58 32 54 38 44Z" },
      { tone: "accent", d: "M64 30C84 20 96 32 88 46C82 58 68 54 62 44Z" },
      { tone: "mark", d: "M50 10C59 10 66 20 66 34C66 64 59 90 50 94C41 90 34 64 34 34C34 20 41 10 50 10Z" },
      { tone: "cut", d: "M36 46H64V56H36Z" },
      { tone: "cut", d: "M38 66H62V76H38Z" },
    ],
  },
  arrow: {
    name: "Arrow",
    paths: [
      { tone: "mark", d: "M50 4L80 42H62V94H38V42H20Z" },
      { tone: "cut", d: "M44 52H56V80H44Z" },
    ],
  },
};

/**
 * Which glyph each franchise wears.
 *
 * Kept here rather than on the FRANCHISES rows in js/banners.js because this
 * is an ART decision about the drawings in this file, not a fact about the
 * franchise - and because a missing entry has to be a loud failure. Every id
 * in FRANCHISES must appear exactly once, and every glyph named must exist;
 * scripts/verify-icons.mjs asserts both in each direction, so a franchise
 * added without a mark fails the build rather than shipping a blank avatar.
 *
 * The pairings are the obvious generic reading of the nickname. Where a
 * nickname has no creature behind it - Jazz, Knicks, 76ers - the mark is a
 * neutral shape and the franchise's colours and abbreviation do the work.
 */
export const FRANCHISE_EMBLEMS = {
  // ---- NBA ----
  hawks: "bird",
  celtics: "clover",
  nets: "shield",
  hornets: "insect",
  bulls: "bull",
  cavaliers: "shield",
  mavericks: "horse",
  nuggets: "mountain",
  pistons: "gear",
  warriors: "shield",
  rockets: "rocket",
  pacers: "bolt",
  clippers: "ship",
  lakers: "wave",
  grizzlies: "bear",
  heat: "flame",
  bucks: "ram",
  timberwolves: "wolf",
  pelicans: "bird",
  knicks: "shield",
  thunder: "bolt",
  magic: "star",
  sixers: "star",
  suns: "sun",
  blazers: "flame",
  kings: "crown",
  spurs: "star",
  raptors: "claw",
  jazz: "mountain",
  wizards: "star",

  // ---- NFL ----
  "nfl-bills": "bull",
  "nfl-dolphins": "fish",
  "nfl-patriots": "star",
  "nfl-jets": "rocket",
  "nfl-ravens": "bird",
  "nfl-bengals": "bigcat",
  "nfl-browns": "shield",
  "nfl-steelers": "gear",
  "nfl-texans": "bull",
  "nfl-colts": "horse",
  "nfl-jaguars": "bigcat",
  "nfl-titans": "flame",
  "nfl-broncos": "horse",
  "nfl-chiefs": "arrow",
  "nfl-raiders": "skull",
  "nfl-chargers": "bolt",
  "nfl-cowboys": "star",
  "nfl-giants": "shield",
  "nfl-eagles": "bird",
  "nfl-commanders": "shield",
  "nfl-bears": "bear",
  "nfl-lions": "bigcat",
  "nfl-packers": "gear",
  "nfl-vikings": "ship",
  "nfl-falcons": "bird",
  "nfl-panthers": "bigcat",
  "nfl-saints": "clover",
  "nfl-buccaneers": "skull",
  "nfl-cardinals": "bird",
  "nfl-rams": "ram",
  "nfl-49ers": "mountain",
  "nfl-seahawks": "bird",
};

const WHITE = "#ffffff";
const BLACK = "#151515";

/** Legible against `bg`, whichever way the background leans. */
function inkOn(bg) {
  return contrastRatio(WHITE, bg) >= contrastRatio(BLACK, bg) ? WHITE : BLACK;
}

/**
 * The three colours a glyph is painted in, resolved from a franchise's own
 * two.
 *
 * The pairs come from real team palettes and several of them are two dark
 * colours - Utah is navy on forest green, Cleveland's football side is brown
 * on near-black. Painting the mark in colour two on a disc of colour one gives
 * those franchises an icon that is a dark smudge, which is both unreadable and
 * an accessibility failure at the size this is drawn. So the second colour is
 * used only when it actually separates from the first; otherwise the mark
 * falls back to plain white or black, whichever the disc can carry.
 *
 * MIN_MARK_CONTRAST is 3:1, the WCAG threshold for non-text graphics - the
 * same bar js/kits.js already holds a worn colour to against the floor.
 */
export const MIN_MARK_CONTRAST = 3;

export function emblemPalette(colors = []) {
  const field = colors[0] || "#3a3f45";
  const second = colors[1] || WHITE;
  const mark = contrastRatio(second, field) >= MIN_MARK_CONTRAST ? second : inkOn(field);
  return {
    field,
    mark,
    // The accent sits on the field alongside the mark, so it is held to the
    // field; the cut is knocked out of the mark and is held to the mark.
    accent: contrastRatio(second, field) >= MIN_MARK_CONTRAST ? inkOn(field) : second,
    cut: field,
  };
}

/**
 * One emblem, as an <svg> element ready to append.
 *
 * @param emblemId  a key of EMBLEMS
 * @param colors    the franchise's [primary, secondary]
 * @param label     accessible name; the element is decorative if omitted
 *
 * Returns null for an unknown glyph rather than throwing: a caller mid-render
 * should draw the rest of the card. Every id that reaches here is checked at
 * build time by scripts/verify-icons.mjs, so a null here means someone typed a
 * literal rather than that data drifted.
 */
export function emblemSvg(emblemId, colors, label = "") {
  const emblem = EMBLEMS[emblemId];
  if (!emblem) return null;
  const palette = emblemPalette(colors);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", VIEW_BOX);
  svg.setAttribute("class", "emblem");
  svg.setAttribute("focusable", "false");
  if (label) {
    svg.setAttribute("role", "img");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = label;
    svg.appendChild(title);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }

  // The disc is part of the mark, not the container: it makes every glyph the
  // same silhouette at any size, and it is what the paths are drawn to
  // contrast against.
  const field = document.createElementNS("http://www.w3.org/2000/svg", "path");
  field.setAttribute("d", disc(50, 50, 50));
  field.setAttribute("fill", palette.field);
  svg.appendChild(field);

  // Glyphs are drawn edge to edge in a 100-unit box; inset so nothing clips
  // against the rim of the disc.
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("transform", "translate(50 50) scale(0.72) translate(-50 -50)");
  for (const path of emblem.paths) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", path.d);
    el.setAttribute("fill", palette[path.tone] || palette.mark);
    group.appendChild(el);
  }
  svg.appendChild(group);
  return svg;
}

/** The glyph a franchise wears, or null if it has none. */
export function emblemIdFor(franchiseId) {
  return FRANCHISE_EMBLEMS[franchiseId] || null;
}

// Re-exported so consumers of an emblem can reason about its colours without
// reaching past this module into the kit palette's internals.
export { contrastRatio, luminance };
