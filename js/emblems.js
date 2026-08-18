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

import { contrastRatio, luminance, colourDistance } from "./kits.js";

/** Shape space for every glyph below. Square, so a mark drops into a circular
 * avatar without per-glyph fitting. */
const VIEW_BOX = "0 0 100 100";

/** Thickness of the second-colour ring, in viewBox units. Wide enough to read
 * as a band of colour at 34px rather than as an outline. */
const RIM_WIDTH = 9;

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

/** A five-pointed star, as path data.
 *
 * Generated for the same reason spokes() is: a hand-eyeballed star is subtly
 * lopsided, and three of them at different sizes in one glyph makes that
 * obvious. `inner` is the waist radius as a fraction of `r` - 0.4 is the
 * classic proportion.
 */
function starPath(cx, cy, r, inner = 0.4) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * inner;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)} ${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(" L")} Z`;
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
  paw: {
    name: "Paw",
    paths: [
      { tone: "mark", d: disc(24, 30, 12) },
      { tone: "mark", d: disc(44, 20, 12) },
      { tone: "mark", d: disc(66, 22, 12) },
      { tone: "mark", d: disc(84, 38, 12) },
      { tone: "mark", d: "M52 44C68 44 82 56 82 70C82 84 70 92 56 90C50 89 46 89 40 90C26 92 16 84 16 70C16 56 36 44 52 44Z" },
    ],
  },
  bell: {
    name: "Bell",
    paths: [
      { tone: "mark", d: "M50 8C56 8 60 12 60 18C74 24 80 40 80 58L88 74H12L20 58C20 40 26 24 40 18C40 12 44 8 50 8Z" },
      { tone: "accent", d: disc(50, 84, 9) },
      { tone: "cut", d: "M34 58C34 42 40 30 50 30V64Z" },
    ],
  },
  flag: {
    name: "Flag",
    paths: [
      { tone: "mark", d: "M20 6H30V94H20Z" },
      { tone: "accent", d: "M30 12C48 4 66 20 86 12V50C66 58 48 42 30 50Z" },
      { tone: "cut", d: "M30 24C44 19 58 27 70 26V38C58 39 44 31 30 36Z" },
    ],
  },
  // ---- Birds. Seven teams wear a bird and they all used to wear the SAME
  // bird, which made half the football shelf one silhouette in different
  // colours. Each is now its own species-ish shape: a raptor head, a whole
  // perched bird, spread wings, a dive, a long bill, a crest. ----
  hawk: {
    name: "Hawk",
    paths: [
      { tone: "mark", d: "M16 46C16 26 32 12 52 12C66 12 78 19 84 30L60 44L84 52C78 68 66 78 50 78C32 78 16 66 16 46Z" },
      { tone: "cut", d: "M26 34L54 26L52 38L28 43Z" },
      { tone: "cut", d: disc(38, 50, 6) },
      { tone: "accent", d: "M34 78L44 94L54 78Z" },
    ],
  },
  pelican: {
    name: "Pelican",
    paths: [
      { tone: "mark", d: "M32 10C48 10 58 22 58 38C58 46 55 52 50 57L30 62C16 57 10 46 10 33C10 20 20 10 32 10Z" },
      { tone: "accent", d: "M52 34L94 46C96 52 92 58 84 60L50 58C55 51 54 42 52 34Z" },
      { tone: "accent", d: "M54 54C66 72 80 78 92 68L88 60L54 50Z" },
      { tone: "cut", d: disc(30, 28, 6) },
    ],
  },
  raven: {
    name: "Raven",
    paths: [
      { tone: "mark", d: "M76 10C58 6 40 14 30 28C20 42 20 60 28 74L16 90L40 84C58 86 76 74 82 58C88 42 86 20 76 10Z" },
      { tone: "accent", d: "M30 30L2 36L28 46Z" },
      { tone: "cut", d: disc(42, 32, 6) },
      { tone: "cut", d: "M52 50C64 54 72 62 74 74C64 70 56 62 52 50Z" },
    ],
  },
  eagle: {
    name: "Eagle",
    paths: [
      { tone: "mark", d: "M46 34L2 8L16 36L4 46L28 58L46 58Z" },
      { tone: "mark", d: "M54 34L98 8L84 36L96 46L72 58L54 58Z" },
      { tone: "mark", d: "M50 10C58 10 64 17 64 26C64 32 61 37 57 40L54 94H46L43 40C39 37 36 32 36 26C36 17 42 10 50 10Z" },
      { tone: "accent", d: "M63 22L86 28L63 34Z" },
      { tone: "cut", d: disc(55, 24, 4) },
    ],
  },
  falcon: {
    name: "Falcon",
    paths: [
      { tone: "mark", d: "M46 24L2 70L26 78L46 52Z" },
      { tone: "mark", d: "M54 24L98 70L74 78L54 52Z" },
      { tone: "mark", d: "M50 4C58 4 64 11 64 21C64 29 60 35 55 38L53 96H47L45 38C40 35 36 29 36 21C36 11 42 4 50 4Z" },
      { tone: "accent", d: "M62 17L84 23L62 29Z" },
      { tone: "cut", d: disc(54, 19, 4) },
    ],
  },
  seahawk: {
    name: "Seahawk",
    paths: [
      { tone: "mark", d: "M42 14C64 14 78 32 78 52C78 74 62 90 42 90C22 90 10 74 10 52C10 30 20 14 42 14Z" },
      { tone: "accent", d: "M72 42L98 54L72 68L66 55Z" },
      { tone: "cut", d: disc(38, 44, 8) },
      { tone: "cut", d: "M14 30L44 24L42 34L18 38Z" },
    ],
  },
  cardinal: {
    name: "Cardinal",
    paths: [
      { tone: "mark", d: "M32 34C48 24 68 26 80 38C92 50 90 70 76 80L84 94L58 88C40 88 26 74 26 58C26 50 28 40 32 34Z" },
      { tone: "mark", d: "M34 32L24 8L44 20L54 2L56 28Z" },
      { tone: "accent", d: "M28 48L6 54L28 62Z" },
      { tone: "cut", d: disc(44, 48, 5) },
    ],
  },

  // ---- Everything else that used to double up ----
  hoop: {
    name: "Hoop",
    paths: [
      { tone: "mark", d: "M12 26H88V40H12Z" },
      { tone: "accent", d: "M20 40H80L58 88H42Z" },
      { tone: "cut", d: "M44 44H56L54 82H46Z" },
      { tone: "cut", d: "M28 46H36L44 78H36Z" },
      { tone: "cut", d: "M64 46H72L64 78H56Z" },
    ],
  },
  sword: {
    name: "Sword",
    paths: [
      { tone: "mark", d: "M50 2L62 26V58H38V26Z" },
      { tone: "accent", d: "M16 58H84V70H16Z" },
      { tone: "mark", d: "M43 70H57V88H43Z" },
      { tone: "accent", d: disc(50, 92, 8) },
    ],
  },
  bridge: {
    name: "Bridge",
    paths: [
      { tone: "accent", d: "M4 44C20 20 26 16 32 16C38 16 46 34 50 34C54 34 62 16 68 16C74 16 80 20 96 44V56C80 32 74 26 68 26C62 26 54 44 50 44C46 44 38 26 32 26C26 26 20 32 4 56Z" },
      { tone: "mark", d: "M26 12H38V66H26Z" },
      { tone: "mark", d: "M62 12H74V66H62Z" },
      { tone: "mark", d: "M4 66H96V78H4Z" },
    ],
  },
  checkflag: {
    name: "Checkered flag",
    paths: [
      { tone: "mark", d: "M12 4H22V96H12Z" },
      { tone: "accent", d: "M22 10H90V56H22Z" },
      { tone: "cut", d: "M22 10H39V33H22Z" },
      { tone: "cut", d: "M56 10H73V33H56Z" },
      { tone: "cut", d: "M39 33H56V56H39Z" },
      { tone: "cut", d: "M73 33H90V56H73Z" },
    ],
  },
  tower: {
    name: "Tower",
    paths: [
      { tone: "mark", d: "M34 22H58V94H34Z" },
      { tone: "accent", d: "M62 46H86V94H62Z" },
      { tone: "accent", d: "M10 56H30V94H10Z" },
      { tone: "mark", d: "M40 2L46 22H38Z" },
      { tone: "cut", d: "M40 34H52V44H40Z" },
      { tone: "cut", d: "M40 54H52V64H40Z" },
    ],
  },
  pine: {
    name: "Pine",
    paths: [
      { tone: "mark", d: "M50 4L70 32H60L78 58H64L88 84H12L36 58H22L40 32H30Z" },
      { tone: "accent", d: "M43 84H57V98H43Z" },
    ],
  },
  hat: {
    name: "Cowboy hat",
    paths: [
      { tone: "mark", d: "M32 60C30 40 32 22 40 14C46 7 56 7 62 14C70 22 72 40 70 60Z" },
      { tone: "mark", d: "M4 64C4 53 25 46 50 46C75 46 96 53 96 64C96 75 75 82 50 82C25 82 4 75 4 64Z" },
      { tone: "cut", d: "M28 52C38 57 62 57 72 52V63C62 68 38 68 28 63Z" },
    ],
  },
  stars: {
    name: "Stars",
    paths: [
      { tone: "mark", d: starPath(38, 42, 30) },
      { tone: "accent", d: starPath(76, 22, 17) },
      { tone: "accent", d: starPath(72, 74, 20) },
    ],
  },
  wizardhat: {
    name: "Wizard hat",
    paths: [
      { tone: "mark", d: "M52 2C58 26 68 50 78 70H26C36 50 46 26 52 2Z" },
      { tone: "accent", d: "M8 70H92C92 80 73 88 50 88C27 88 8 80 8 70Z" },
      { tone: "cut", d: starPath(56, 48, 11) },
      { tone: "cut", d: starPath(44, 26, 6) },
    ],
  },
  note: {
    name: "Double note",
    paths: [
      { tone: "mark", d: "M34 22H41V74H34Z" },
      { tone: "mark", d: "M67 14H74V64H67Z" },
      { tone: "accent", d: "M34 14H74V30H34Z" },
      { tone: "mark", d: disc(24, 76, 13) },
      { tone: "mark", d: disc(57, 66, 13) },
    ],
  },
  buffalo: {
    name: "Buffalo",
    paths: [
      { tone: "accent", d: "M6 42C0 24 16 10 32 18L28 32C20 28 14 34 16 44Z" },
      { tone: "accent", d: "M94 42C100 24 84 10 68 18L72 32C80 28 86 34 84 44Z" },
      { tone: "mark", d: "M50 18C70 18 82 32 82 52C82 64 76 74 66 80L62 94H38L34 80C24 74 18 64 18 52C18 32 30 18 50 18Z" },
      { tone: "cut", d: disc(36, 48, 6) },
      { tone: "cut", d: disc(64, 48, 6) },
      { tone: "cut", d: "M38 68H62V80H38Z" },
    ],
  },
  cheese: {
    name: "Cheese",
    paths: [
      { tone: "mark", d: "M8 80L82 14C90 22 94 32 94 44V80Z" },
      { tone: "cut", d: disc(62, 52, 9) },
      { tone: "cut", d: disc(80, 68, 6) },
      { tone: "cut", d: disc(44, 68, 5) },
    ],
  },
  tiger: {
    name: "Tiger",
    paths: [
      { tone: "mark", d: "M10 8L38 28L18 42Z" },
      { tone: "mark", d: "M90 8L62 28L82 42Z" },
      { tone: "mark", d: "M50 20C72 20 86 38 86 56C86 78 70 94 50 94C30 94 14 78 14 56C14 38 28 20 50 20Z" },
      { tone: "cut", d: "M14 40L32 48L14 52Z" },
      { tone: "cut", d: "M16 58L34 64L16 68Z" },
      { tone: "cut", d: "M86 40L68 48L86 52Z" },
      { tone: "cut", d: "M84 58L66 64L84 68Z" },
      { tone: "cut", d: "M50 64L60 72L50 80L40 72Z" },
    ],
  },
  lion: {
    name: "Lion",
    paths: [
      { tone: "mark", d: spokes(11, 26, 50, 0.42) },
      { tone: "mark", d: disc(50, 50, 36) },
      { tone: "cut", d: disc(50, 52, 24) },
      { tone: "mark", d: disc(41, 46, 4) },
      { tone: "mark", d: disc(59, 46, 4) },
      { tone: "mark", d: "M50 56C58 56 63 62 63 67C63 73 57 77 50 77C43 77 37 73 37 67C37 62 42 56 50 56Z" },
    ],
  },
  helmet: {
    name: "Helmet",
    paths: [
      { tone: "mark", d: "M14 52C14 28 32 12 54 12C76 12 92 28 92 52C92 60 88 66 82 68H46C28 68 14 64 14 52Z" },
      { tone: "accent", d: "M44 68H88V80H50C44 80 42 74 44 68Z" },
      { tone: "cut", d: "M52 13H62L59 44H49Z" },
    ],
  },
  horseshoe: {
    name: "Horseshoe",
    paths: [
      { tone: "mark", d: "M50 6C74 6 90 26 90 52V92H66V52C66 40 60 32 50 32C40 32 34 40 34 52V92H10V52C10 26 26 6 50 6Z" },
      { tone: "cut", d: disc(20, 62, 5) },
      { tone: "cut", d: disc(20, 80, 5) },
      { tone: "cut", d: disc(80, 62, 5) },
      { tone: "cut", d: disc(80, 80, 5) },
    ],
  },
  anchor: {
    name: "Anchor",
    paths: [
      { tone: "mark", d: disc(50, 14, 11) },
      { tone: "cut", d: disc(50, 14, 5) },
      { tone: "mark", d: "M45 22H55V88H45Z" },
      { tone: "accent", d: "M22 32H78V43H22Z" },
      { tone: "mark", d: "M10 56C10 76 27 92 50 94C73 92 90 76 90 56H78C78 70 66 81 50 83C34 81 22 70 22 56Z" },
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
 * EVERY TEAM IN A SPORT WEARS A DIFFERENT GLYPH. Sharing a glyph and relying
 * on colour to separate two teams worked until two teams shared a palette too,
 * and it made whole stretches of the shelf one silhouette in slightly
 * different colours - five of football's birds were literally the same bird.
 * Glyphs ARE reused across sports, since a player only ever sees one sport's
 * shelf at a time (San Antonio and Dallas both wear the hat).
 *
 * The pairings are the obvious generic reading of the nickname. Where a
 * nickname has no creature behind it - Knicks, 76ers, Pacers - the mark is
 * something plainly associated with the city or the sport rather than a
 * stand-in shape, so it still says something.
 */
export const FRANCHISE_EMBLEMS = {
  // ---- NBA ----
  hawks: "hawk",
  celtics: "clover",
  nets: "hoop",
  hornets: "insect",
  bulls: "bull",
  cavaliers: "sword",
  mavericks: "horse",
  nuggets: "mountain",
  pistons: "gear",
  warriors: "bridge",
  rockets: "rocket",
  pacers: "checkflag",
  clippers: "ship",
  lakers: "wave",
  grizzlies: "bear",
  heat: "flame",
  bucks: "ram",
  timberwolves: "wolf",
  pelicans: "pelican",
  knicks: "tower",
  thunder: "bolt",
  magic: "stars",
  sixers: "bell",
  suns: "sun",
  blazers: "pine",
  kings: "crown",
  spurs: "hat",
  raptors: "claw",
  jazz: "note",
  wizards: "wizardhat",

  // ---- NFL ----
  "nfl-bills": "buffalo",
  "nfl-dolphins": "fish",
  "nfl-patriots": "flag",
  "nfl-jets": "rocket",
  "nfl-ravens": "raven",
  "nfl-bengals": "tiger",
  "nfl-browns": "helmet",
  "nfl-steelers": "gear",
  "nfl-texans": "bull",
  "nfl-colts": "horseshoe",
  "nfl-jaguars": "bigcat",
  "nfl-titans": "flame",
  "nfl-broncos": "horse",
  "nfl-chiefs": "arrow",
  "nfl-raiders": "skull",
  "nfl-chargers": "bolt",
  "nfl-cowboys": "hat",
  "nfl-giants": "shield",
  "nfl-eagles": "eagle",
  "nfl-commanders": "sword",
  "nfl-bears": "bear",
  "nfl-lions": "lion",
  "nfl-packers": "cheese",
  "nfl-vikings": "ship",
  "nfl-falcons": "falcon",
  "nfl-panthers": "paw",
  "nfl-saints": "clover",
  "nfl-buccaneers": "anchor",
  "nfl-cardinals": "cardinal",
  "nfl-rams": "ram",
  "nfl-49ers": "mountain",
  "nfl-seahawks": "seahawk",
};

const WHITE = "#ffffff";
const BLACK = "#151515";

/** Legible against `bg`, whichever way the background leans. */
function inkOn(bg) {
  return contrastRatio(WHITE, bg) >= contrastRatio(BLACK, bg) ? WHITE : BLACK;
}

function mix(a, b, t) {
  const pa = hexToRgbLocal(a);
  const pb = hexToRgbLocal(b);
  const ch = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${ch(pa.r, pb.r)}${ch(pa.g, pb.g)}${ch(pa.b, pb.b)}`;
}

function hexToRgbLocal(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/**
 * `colour` pushed toward whichever ink the field can carry, just far enough to
 * be visible on it.
 *
 * WHY THIS EXISTS. The accent is the tone that carries a glyph's identifying
 * DETAIL - a bird's beak, a bull's horns, a rocket's fins. It used to be set to
 * the franchise's raw second colour whenever that colour was too dark to be the
 * mark, which is exactly the case where it is also too dark to be seen: the
 * Ravens are purple and black, so the beak was black on dark purple and the
 * bird rendered as a featureless blob. A detail nobody can see is not a detail.
 *
 * Mixing rather than replacing keeps the team's hue - a black second colour on
 * purple becomes grey, not white - so the icon still reads as that team's
 * palette. Ten steps is finer than the eye needs and terminates.
 */
function readableOn(colour, field) {
  const ink = inkOn(field);
  let out = colour;
  for (let i = 1; i <= 10 && contrastRatio(out, field) < MIN_MARK_CONTRAST; i++) {
    out = mix(colour, ink, i / 10);
  }
  return out;
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

/**
 * Minimum perceptual distance between two teams' icons before they read as the
 * same picture. CIE76 dE, same units and same reasoning as MIN_KIT_SEPARATION
 * in js/kits.js - under 10 is "same colour to most people", 25 is comfortably
 * distinct at a glance.
 *
 * 25 rather than something looser because these are compared at 34px in a grid
 * of sixty other circles, not held up side by side.
 */
export const MIN_ICON_SEPARATION = 25;

export function emblemPalette(colors = []) {
  const field = colors[0] || "#3a3f45";
  const second = colors[1] || WHITE;
  const secondReads = contrastRatio(second, field) >= MIN_MARK_CONTRAST;
  const mark = secondReads ? second : inkOn(field);
  return {
    field,
    mark,
    // The accent sits on the field alongside the mark, so it is held to the
    // field; the cut is knocked out of the mark and is held to the mark.
    // When the second colour is already carrying the mark, the accent is the
    // ink; when it is not, the accent is that second colour dragged far enough
    // toward the ink to actually be visible - see readableOn.
    accent: secondReads ? inkOn(field) : readableOn(second, field),
    cut: field,
    // THE RIM IS WHY THE SECOND COLOUR IS NEVER WASTED.
    //
    // When a team's two colours are both dark - Utah is navy on forest green -
    // the mark falls back to white or black and the second colour disappears
    // from the icon entirely. That is what made Orlando and Philadelphia the
    // same picture: near-identical blue discs, and both second colours thrown
    // away in favour of the same white mark.
    //
    // Drawn as a ring around the disc, the second colour is always somewhere on
    // the icon, so every team gets two colour channels rather than one. It sits
    // on the outside edge where it borders the page rather than the mark, so it
    // is not held to the mark's contrast rule - it only has to be visible, and
    // a ring of the team's own colour against a dark page always is.
    rim: second,
  };
}

/**
 * How far apart two teams' icons are, as one number.
 *
 * Disc and rim, combined as a root-mean-square weighted by how much of the
 * circle each one covers. A 9-unit rim on a 100-unit circle is the annulus
 * from r=41 to r=50, which is a third of the area - substantial enough that a
 * colour difference living entirely in the rim really does separate two icons.
 *
 * WHY NOT THE SIMPLER OPTIONS. Taking the minimum of the two channels was tried
 * first and is far too strict: Baltimore and Atlanta both have black as their
 * second colour, so their rims are identical and the minimum is zero, even
 * though one disc is deep purple and the other is crimson and nobody would
 * confuse them. Taking the mean is too lax in the opposite direction - it lets
 * a small difference in each channel add up to a passing number when neither
 * one is visible. RMS keeps a real difference in EITHER channel while still
 * going to zero when the whole icon matches.
 *
 * The mark is deliberately excluded. It is white on both sides of many pairs
 * by contrast fallback, so counting it would report near-identical icons as
 * separated by an accident of the palette rather than by anything a player
 * can see.
 */
const RIM_AREA_SHARE = 1 - ((50 - RIM_WIDTH) / 50) ** 2;

export function iconSeparation(colorsA = [], colorsB = []) {
  const a = emblemPalette(colorsA);
  const b = emblemPalette(colorsB);
  const field = colourDistance(a.field, b.field);
  const rim = colourDistance(a.rim, b.rim);
  return Math.sqrt((1 - RIM_AREA_SHARE) * field ** 2 + RIM_AREA_SHARE * rim ** 2);
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

  // The rim, in the team's second colour - see emblemPalette. Drawn as a
  // stroked circle inset by half its width so it sits fully inside the
  // viewBox; a stroke centred on the edge would be clipped to half its
  // thickness and read as a hairline.
  const rim = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  rim.setAttribute("cx", "50");
  rim.setAttribute("cy", "50");
  rim.setAttribute("r", String(50 - RIM_WIDTH / 2));
  rim.setAttribute("fill", "none");
  rim.setAttribute("stroke", palette.rim);
  rim.setAttribute("stroke-width", String(RIM_WIDTH));
  svg.appendChild(rim);

  // Glyphs are drawn edge to edge in a 100-unit box; inset so nothing clips
  // against the rim of the disc.
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("transform", "translate(50 50) scale(0.62) translate(-50 -50)");
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
