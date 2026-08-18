#!/usr/bin/env node
// PROFILE ICONS: every franchise has a mark, every mark is legible, and no id
// means two things.
//
// WHY THIS EXISTS
//
// The icon shelf is sixty-two team emblems plus a general ladder, and three
// separate ways for it to break quietly:
//
//   1. A FRANCHISE WITH NO MARK. The emblem a franchise wears is a mapping in
//      js/emblems.js, not a field on the franchise row, so adding a team to
//      FRANCHISES does not add its art. Without this check that team's icon
//      renders as an empty circle - not an error, not a crash, just a hole on
//      the Rewards grid that nobody notices until a player asks why their
//      team's icon is blank.
//
//   2. AN UNREADABLE MARK. The colours come from real team palettes and
//      several are two dark colours - Utah is navy on forest green, the
//      Browns are brown on near-black. Drawn straight, those are a dark smudge
//      at 34px. emblemPalette is supposed to fall back to white or black when
//      the pair does not separate; this checks that it actually did, against
//      the same 3:1 non-text threshold js/kits.js holds a worn colour to.
//
//   3. AN ID THAT MEANS TWO THINGS. Icons, banners and badges are read side by
//      side on one screen and granted from one document, so "lakers" must not
//      be a banner here and an icon there. Team icon ids are namespaced for
//      exactly this reason and the namespacing is worth asserting rather than
//      remembering.
//
// Nothing here renders SVG: emblemSvg needs a DOM. What is checkable without
// one - that the art exists, that the paths are paths, that the colours
// separate - is checked; that it LOOKS like a bear is not, and no test is
// going to tell you that.

import { FRANCHISES } from "../js/banners.js";
import { EMBLEMS, FRANCHISE_EMBLEMS, emblemPalette, MIN_MARK_CONTRAST, contrastRatio } from "../js/emblems.js";
import { GENERAL_ICONS, TEAM_ICONS, iconById, iconProgress, equippedIcon, DEFAULT_ICON_ID } from "../js/icons.js";
import { GENERAL_BANNERS } from "../js/banners.js";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

console.log(renderSection("Profile icons (a mark for every team, legible, uniquely named)"));

// ---- 1. every franchise has a mark, and every mark belongs to a franchise ---
const franchiseIds = new Set(FRANCHISES.map((f) => f.id));
const mapped = Object.keys(FRANCHISE_EMBLEMS);

const missing = FRANCHISES.filter((f) => !FRANCHISE_EMBLEMS[f.id]).map((f) => f.id);
check(
  `All ${FRANCHISES.length} franchises have an emblem`,
  missing.length === 0,
  missing.length ? `no emblem for: ${missing.join(", ")}` : `${mapped.length} mapped`
);

const orphans = mapped.filter((id) => !franchiseIds.has(id));
check(
  "No emblem is mapped to a franchise that doesn't exist",
  orphans.length === 0,
  orphans.length ? `unknown franchise ids: ${orphans.join(", ")}` : "every mapping resolves"
);

const unknownGlyphs = mapped.filter((id) => !EMBLEMS[FRANCHISE_EMBLEMS[id]]);
check(
  "Every emblem named is a glyph that exists",
  unknownGlyphs.length === 0,
  unknownGlyphs.length
    ? unknownGlyphs.map((id) => `${id} -> ${FRANCHISE_EMBLEMS[id]}`).join(", ")
    : `${Object.keys(EMBLEMS).length} glyphs, all resolvable`
);

// Art that nothing wears is art nobody will ever see, and usually means a
// mapping was meant to change and did not.
const used = new Set(Object.values(FRANCHISE_EMBLEMS));
const unused = Object.keys(EMBLEMS).filter((id) => !used.has(id));
check(
  "No glyph is drawn and then never worn",
  unused.length === 0,
  unused.length ? `unused: ${unused.join(", ")}` : `all ${used.size} glyphs in use`
);

// ---- 2. the drawings are drawings ------------------------------------------
const badPaths = [];
for (const [id, emblem] of Object.entries(EMBLEMS)) {
  if (!emblem.paths || emblem.paths.length === 0) badPaths.push(`${id}: no paths`);
  for (const path of emblem.paths || []) {
    if (typeof path.d !== "string" || !path.d.trim().startsWith("M")) {
      badPaths.push(`${id}: path does not start with a move`);
    }
    if (!["mark", "accent", "cut"].includes(path.tone)) {
      badPaths.push(`${id}: unknown tone ${JSON.stringify(path.tone)}`);
    }
  }
}
check(
  "Every glyph is real path data in a known tone",
  badPaths.length === 0,
  badPaths.length ? badPaths.join("; ") : `${Object.keys(EMBLEMS).length} glyphs checked`
);

// ---- 3. every mark separates from the disc it sits on -----------------------
const dim = [];
for (const franchise of FRANCHISES) {
  const palette = emblemPalette(franchise.colors);
  const ratio = contrastRatio(palette.mark, palette.field);
  if (ratio < MIN_MARK_CONTRAST) dim.push(`${franchise.id} ${ratio.toFixed(2)}:1`);
}
check(
  `Every team mark clears ${MIN_MARK_CONTRAST}:1 against its own disc`,
  dim.length === 0,
  dim.length ? `too dim: ${dim.join(", ")}` : `${FRANCHISES.length} franchises, worst case checked`
);

// ---- 4. ids ----------------------------------------------------------------
const allIcons = [...GENERAL_ICONS, ...TEAM_ICONS];
const seen = new Map();
const dupes = [];
for (const icon of allIcons) {
  if (seen.has(icon.id)) dupes.push(icon.id);
  seen.set(icon.id, icon);
}
check(
  "No two icons share an id",
  dupes.length === 0,
  dupes.length ? `duplicated: ${dupes.join(", ")}` : `${allIcons.length} icons`
);

const bannerIds = new Set([...GENERAL_BANNERS.map((b) => b.id), ...FRANCHISES.map((f) => f.id)]);
const collisions = allIcons.filter((icon) => bannerIds.has(icon.id)).map((icon) => icon.id);
check(
  "No icon id collides with a banner id",
  collisions.length === 0,
  collisions.length ? `collides: ${collisions.join(", ")}` : "icon and banner namespaces are disjoint"
);

// ---- 5. the catalogue survives a profile with nothing in it -----------------
// The state every new account is in, and the one most likely to be skipped
// when a ladder is added: a progress() that assumes a counter exists throws
// here and takes the whole Rewards screen with it.
const EMPTY = {};
let threw = null;
for (const icon of allIcons) {
  try {
    const progress = iconProgress(icon, EMPTY);
    if (!Number.isFinite(progress.percent)) threw = `${icon.id}: percent is ${progress.percent}`;
  } catch (e) {
    threw = `${icon.id}: ${e.message}`;
  }
  if (threw) break;
}
check("Every icon reports progress against an empty profile", threw === null, threw || `${allIcons.length} icons`);

check(
  "The default icon is unlocked for a brand new player",
  iconProgress(iconById(DEFAULT_ICON_ID), EMPTY).unlocked,
  `${DEFAULT_ICON_ID} must never be lockable - it is what an unset card wears`
);

// An id the catalogue no longer knows - a retired icon, a typo, a column
// written by a newer client - must not leave the identity card blank.
const junk = equippedIcon({ equippedIcon: "no-such-icon-ever" });
check(
  "An unresolvable equipped icon falls back to the default",
  junk && junk.id === DEFAULT_ICON_ID,
  `resolved to ${junk ? junk.id : "null"}`
);

// ---- 6. the unlock rule reads the trusted counter ---------------------------
// mvp_teams is written by finalize_match_result. mvp_counts is the offline,
// client-written tally. Reading the wrong one would make every team icon
// self-grantable from practice, which is the exact thing the ranked-only rule
// exists to prevent - and it would still look like it worked.
const bulls = iconById("team-bulls");
const fromOffline = iconProgress(bulls, { mvpCounts: { "Michael Jordan": 50 } });
const fromRanked = iconProgress(bulls, { mvpTeams: { "Chicago Bulls": 1 } });
check(
  "Offline MVPs do not unlock a team icon",
  !fromOffline.unlocked,
  `mvp_counts alone gave unlocked=${fromOffline.unlocked}`
);
check(
  "A ranked MVP does unlock its team's icon",
  fromRanked.unlocked,
  `mvp_teams gave unlocked=${fromRanked.unlocked}`
);

// Relocations and renames fold into one franchise, exactly as banner progress
// does - a Bullets MVP is a Wizards MVP.
const wizards = iconById("team-wizards");
const viaAlias = iconProgress(wizards, { mvpTeams: { "Washington Bullets": 1 } });
check(
  "A franchise's old name counts toward its icon",
  viaAlias.unlocked,
  `Washington Bullets -> Wizards gave unlocked=${viaAlias.unlocked}`
);

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
