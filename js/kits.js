// Team kits: the two colours a player wears, and the rules that keep two
// players' choices apart.
//
// WHY THIS IS CURATED RATHER THAN A COLOUR PICKER
//
// A live game's legibility rests on team identity being the LOUD channel: the
// scoreboard digits and the play feed distinguish the two teams by colour
// before anything else. Before kits that was the sport accent against a cool
// grey - two colours chosen once, by us, guaranteed to be far apart.
//
// Handing that channel to players is the whole point of this feature and also
// its only real danger: two people can both pick navy, and at that moment the
// game stops being readable. A free hex picker makes that the runtime's problem
// to patch. A curated palette makes it a design-time problem that is already
// solved, and scripts/verify-kits.mjs proves it stays solved.
//
// HOME AND AWAY
//
// The second half of the answer is the one real sport arrived at long ago: the
// away side changes kit. Home wears its PRIMARY, away wears its SECONDARY, and
// if that is still too close to what home is wearing the away colour is shifted
// around the wheel until it is not. So a clash is impossible rather than
// unlikely, and each player still sees their own colours - they dress their own
// side of the board and their own endzone either way.

/** The surface a kit colour has to be legible ON.
 *
 * Was the court floor. The court is gone - the scoreboard is the whole stage -
 * so it is the board's own background, and the kit colours now show up as the
 * score digits rather than as marks on a floor. The lighter of the board's two
 * gradient stops, because that is the harder of the two to be seen against. */
export const BOARD_SURFACE = "#12161d";

/** Minimum contrast a worn colour must have against the floor.
 *
 * 3:1 rather than 4.5:1 because these are graphical marks, not text - that is
 * the WCAG threshold for non-text contrast, and holding a shot marker to a
 * body-copy standard would cut every dark kit for no accessibility gain. */
export const MIN_SURFACE_CONTRAST = 3;

/** Minimum perceptual distance between the two colours actually on the floor.
 *
 * CIE76 dE. Roughly: under 10 is "same colour to most people", 25 is
 * comfortably distinct at a glance and at the size of a shot marker. Chosen at
 * the top of that range because these are 8-pixel dots in peripheral vision,
 * not swatches being compared side by side. */
export const MIN_KIT_SEPARATION = 25;

/**
 * The catalogue.
 *
 * Hues are spread deliberately - this is the axis that keeps kits apart, and a
 * palette of fourteen greens would fail its own test. Each kit's secondary is
 * its ALTERNATE, so it has to be far enough from its own primary to work as a
 * change of kit rather than a shade of the same one.
 */
export const KITS = [
  { id: "nova",     name: "Nova",      primary: "#ff8a3d", secondary: "#ffd166" },
  { id: "ember",    name: "Ember",     primary: "#e8503a", secondary: "#ffb4a2" },
  { id: "crimson",  name: "Crimson",   primary: "#c2334d", secondary: "#f2c6d0" },
  { id: "rose",     name: "Rose",      primary: "#e5679f", secondary: "#ffd9e8" },
  { id: "violet",   name: "Violet",    primary: "#9b6cf0", secondary: "#d9c6ff" },
  { id: "royal",    name: "Royal",     primary: "#5566e8", secondary: "#b9c2ff" },
  { id: "midnight", name: "Midnight",  primary: "#3d7fd6", secondary: "#9fd0ff" },
  { id: "arctic",   name: "Arctic",    primary: "#4fc3e8", secondary: "#cdeefb" },
  { id: "teal",     name: "Teal",      primary: "#2fb3a3", secondary: "#a8ede4" },
  { id: "jade",     name: "Jade",      primary: "#3cb464", secondary: "#b6ecc4" },
  { id: "lime",     name: "Lime",      primary: "#8fc93a", secondary: "#dcf0a8" },
  { id: "gold",     name: "Gold",      primary: "#e0b135", secondary: "#f7e3a1" },
  { id: "steel",    name: "Steel",     primary: "#8fa3c4", secondary: "#dbe4f2" },
  // Bone's alternate is a saturated tan rather than the warm grey it started
  // as: a warm grey and Steel's cool grey are the same KIND of colour, and no
  // amount of hue rotation separates two near-neutrals (see wornColours).
  { id: "bone",     name: "Bone",      primary: "#d8cfc0", secondary: "#9c6b3f" },
];

/** What a player has before they have chosen. Nova, because it is the app's own
 * palette - a new account looks like Draft Nova rather than like nothing. */
export const DEFAULT_KIT_ID = "nova";

/**
 * THE BOT'S KITS, WHICH ARE NOT IN THE CATALOGUE ABOVE.
 *
 * The bot used to wear Steel - the most neutral thing a player could pick, and
 * the colour the opponent was before kits existed. Neutral is the wrong answer
 * now that the post-game scoring summary colours every row by the side that
 * scored (see renderScoringSummary in js/ui/game.js): "who scored this" has to
 * be answerable at a glance, and a pale blue-grey against a player's own colour
 * is the weakest pairing the palette can produce.
 *
 * So the bot wears RED, and BLUE when the player is already wearing something
 * red. Two colours, chosen for maximum separation from each other (111 apart in
 * CIE76, where 25 is "comfortably distinct") and both legible as text on the
 * game screen's darkest surface.
 *
 * SEPARATE FROM `KITS` ON PURPOSE. That list is the picker's - what a PLAYER
 * may choose - and these two are not offered there. Adding a strong red to the
 * catalogue to give the bot one would change what fourteen human players can
 * wear in order to solve a problem the bot has.
 *
 * A kit's SECONDARY is what it wears away, and the bot is always away offline
 * (js/main.js dresses the stage with the player at home), so the secondary is
 * the colour these exist to set. The primary is the deeper version of the same
 * hue, so the pair still reads as one kit if the seats are ever swapped.
 */
export const BOT_KITS = [
  // The red is pulled toward crimson rather than sitting at pure red, and that
  // is measured rather than taste: Nova is the DEFAULT player kit, so an orange
  // player is the common case, and a fire-engine red sits 27 from Nova's orange
  // - close enough to read as the same team. This one is 43 away, so the
  // default matchup is red against orange and legible, while the players who
  // really are wearing red (Ember at 18, Crimson at 25) get the blue kit.
  { id: "bot-red",  name: "Bot Red",  primary: "#c62740", secondary: "#ff3b52" },
  { id: "bot-blue", name: "Bot Blue", primary: "#2a6fc8", secondary: "#4aa3ff" },
];

/** What the bot wears unless the player forces the change. */
export const BOT_KIT_ID = BOT_KITS[0].id;

/**
 * How close a player's colour may come to the bot's first choice before the bot
 * changes kit.
 *
 * DELIBERATELY WIDER THAN MIN_KIT_SEPARATION. That threshold answers "can these
 * two be told apart", and 25 is enough for that. This one answers a different
 * question - "does the opponent read as the same TEAM COLOUR as me" - and the
 * eye groups by family long before it fails to discriminate: measured against
 * the shipped palette, Nova sits 27.4 from the bot's red and Crimson 28.8, both
 * clear of 25 and both plainly "the red one" next to it. 35 is what puts those
 * two on the blue kit, which is what a player asking for this actually means.
 */
export const BOT_KIT_CLEARANCE = 35;

const BY_ID = new Map([...KITS, ...BOT_KITS].map((k) => [k.id, k]));

/**
 * Never returns undefined.
 *
 * Same contract as sportById and bannerById, for the same reason: a profile
 * carrying a kit that has since been retired, or no kit at all because the
 * column predates its row, must land on a default rather than take a screen
 * down.
 */
export function kitById(id) {
  return BY_ID.get(id) || BY_ID.get(DEFAULT_KIT_ID);
}

/**
 * Which kit the bot wears against a player wearing `playerKitId`.
 *
 * Red, unless the player's own colour is close enough to red that the two would
 * read as the same team - then blue. Nothing here is a preference the bot has;
 * it is entirely a function of what the player is wearing, which is why it is
 * computed rather than stored.
 *
 * Distances are measured between what each side actually WEARS: the player is
 * home and wears their primary, the bot is away and wears its secondary. The
 * general clash rule in wornColours below still runs on top of this and is
 * still the guarantee - this only decides which of the two the bot brings.
 */
export function botKitFor(playerKitId) {
  const worn = kitById(playerKitId).primary;
  const clear = BOT_KITS.find((kit) => colourDistance(worn, kit.secondary) >= BOT_KIT_CLEARANCE);
  // Nothing clears only if the palette changes underneath this - take the
  // furthest of the two rather than the first, so the worst case is still the
  // best pairing available instead of an arbitrary one.
  return (clear || [...BOT_KITS].sort(
    (a, b) => colourDistance(worn, b.secondary) - colourDistance(worn, a.secondary)
  )[0]).id;
}

// ---------------------------------------------------------------------------
// Colour maths. Nothing in the repo to reuse - there were no colour helpers
// anywhere before this file.
// ---------------------------------------------------------------------------

export function hexToRgb(hex) {
  const h = String(hex).replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** "217, 116, 31" - the form CSS needs for rgba(var(--x), 0.5). */
export function rgbString(hex) {
  const { r, g, b } = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
}

const linear = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance. */
export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function toLab(hex) {
  const { r, g, b } = hexToRgb(hex);
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  // sRGB -> XYZ (D65), then XYZ -> CIE Lab.
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 colour difference. Perceptual rather than numeric: #ff0000 and
 * #00ff00 are far apart in RGB arithmetic AND far apart to a person, but plenty
 * of pairs are only one of those two things. */
export function colourDistance(a, b) {
  const p = toLab(a);
  const q = toLab(b);
  return Math.sqrt((p.L - q.L) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2);
}

/** Rotates a colour around the hue wheel, keeping its lightness and saturation.
 * Used only as the last resort when a kit clash survives the alternate. */
export function shiftHue(hex, degrees) {
  const { r, g, b } = hexToRgb(hex);
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  h = (((h + degrees) % 360) + 360) % 360;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const table = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
  const out = table.map((v) => Math.round((v + m) * 255));
  return `#${out.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}

/** Moves a colour toward white (positive) or black (negative), keeping its hue.
 * The axis hue rotation cannot reach: two near-neutrals differ in lightness or
 * they do not differ at all. */
export function lighten(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  const mix = (c) => Math.round(c + (target - c) * t);
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * What each side actually WEARS, given who is home.
 *
 * Home wears its primary. Away wears its secondary - the alternate - and if
 * that is still too close to what home is wearing it is walked around the hue
 * wheel until it clears. The walk is bounded and deterministic: same two kits
 * always produce the same result, on both players' machines, which matters for
 * the same reason the shot ledger is seeded.
 *
 * @returns { home: {ink, trim}, away: {ink, trim}, shifted: boolean }
 */
export function wornColours(homeKitId, awayKitId) {
  const home = kitById(homeKitId);
  const away = kitById(awayKitId);

  const homeInk = home.primary;
  let awayInk = away.secondary;
  let shifted = false;

  // 30 degrees at a time, both directions tried in a fixed order so the result
  // is reproducible. Bounded at a full turn: if nothing on the wheel clears,
  // the last candidate stands rather than looping forever.
  //
  // HUE ALONE IS NOT ENOUGH, and finding that out is what this rule is for.
  // Rotating a near-neutral barely moves it - a warm grey and a cool grey are
  // almost the same point in Lab space no matter which way you spin them - so a
  // hue-only rule left Bone's alternate sitting 17.8 from Steel's primary and
  // called it done. Lightness is the axis that always has room, so it is tried
  // second. Both passes are bounded and ordered, because both clients compute
  // this independently and must agree.
  if (colourDistance(homeInk, awayInk) < MIN_KIT_SEPARATION) {
    const candidates = [];
    for (let step = 30; step <= 180; step += 30) {
      for (const direction of [1, -1]) candidates.push(shiftHue(away.secondary, step * direction));
    }
    // Then the same colour pushed lighter and darker. Ordered coarse-to-fine so
    // the smallest change that works is the one taken - an away kit should stay
    // recognisable as the player's choice.
    for (const amount of [0.18, 0.3, 0.42]) {
      candidates.push(lighten(away.secondary, amount), lighten(away.secondary, -amount));
    }
    for (const candidate of candidates) {
      if (
        colourDistance(homeInk, candidate) >= MIN_KIT_SEPARATION &&
        contrastRatio(candidate, BOARD_SURFACE) >= MIN_SURFACE_CONTRAST
      ) {
        awayInk = candidate;
        shifted = true;
        break;
      }
    }
  }

  return {
    home: { ink: homeInk, trim: home.secondary },
    away: { ink: awayInk, trim: away.primary },
    shifted,
  };
}
