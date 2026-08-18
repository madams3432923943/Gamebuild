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
import {
  EMBLEMS,
  FRANCHISE_EMBLEMS,
  emblemPalette,
  MIN_MARK_CONTRAST,
  MIN_ICON_SEPARATION,
  iconSeparation,
  contrastRatio,
} from "../js/emblems.js";
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

// ---- 3b. two teams in one sport must not wear the same icon -----------------
//
// 24 glyphs cover 62 franchises, so teams share marks and COLOUR is what
// separates them. That works until two teams that share a glyph also share a
// palette, and then they have literally the same icon. Measured before this
// check existed: Orlando and Philadelphia were dE 5.5 apart on the disc and 0
// on the mark - the same picture twice, for two teams a player is meant to be
// able to tell apart at 34px.
//
// Perceptual distance (CIE76), not RGB arithmetic, using the colourDistance
// already exported from js/kits.js - the same helper and the same reasoning as
// MIN_KIT_SEPARATION, which exists for exactly this problem one layer down.
// This is a FAIL rather than a warning because the failure mode is silent: two
// teams look identical and nothing about the app misbehaves.
const tooClose = [];
for (let i = 0; i < FRANCHISES.length; i++) {
  for (let j = i + 1; j < FRANCHISES.length; j++) {
    const a = FRANCHISES[i];
    const b = FRANCHISES[j];
    // Only within a sport. A player only ever sees one sport's shelf at a time,
    // and holding basketball against football would fail pairs nobody can
    // confuse.
    if (a.sport !== b.sport) continue;
    if (FRANCHISE_EMBLEMS[a.id] !== FRANCHISE_EMBLEMS[b.id]) continue;
    const separation = iconSeparation(a.colors, b.colors);
    if (separation < MIN_ICON_SEPARATION) {
      tooClose.push(`${a.id}/${b.id} (${FRANCHISE_EMBLEMS[a.id]}, dE ${separation.toFixed(1)})`);
    }
  }
}
check(
  `No two teams in one sport wear the same glyph in confusable colours (dE >= ${MIN_ICON_SEPARATION})`,
  tooClose.length === 0,
  tooClose.length ? `too close: ${tooClose.join(", ")}` : "every same-glyph pair is separated by colour"
);

// ---- 3c. every franchise has a city, and no two icons share a label ---------
//
// Team icons are labelled by CITY, never by nickname - the nickname is the
// registered trademark and the city is a place (see cityLabel in js/icons.js).
// Two things can go wrong with that and both are silent:
//
//   A MISSING CITY falls back to the full team name, which quietly puts the
//   nickname back on the shelf for that one team. Deriving the city by chopping
//   the last word off the name was rejected for the same reason - "Portland
//   Trail Blazers" and "Thunder / SuperSonics" both defeat it, and the wrong
//   answer looks plausible.
//
//   A DUPLICATE LABEL is what happens when two teams in one sport share a city:
//   both New York football teams, both Los Angeles ones, both LA basketball
//   ones. Two tiles reading "New York" is not a shelf a player can use.
const cityless = FRANCHISES.filter((f) => !f.city).map((f) => f.id);
check(
  "Every franchise has an explicit city",
  cityless.length === 0,
  cityless.length ? `no city for: ${cityless.join(", ")}` : `${FRANCHISES.length} franchises`
);

const nicknamed = TEAM_ICONS.filter((icon) => icon.name === icon.franchise.name).map((i) => i.id);
check(
  "No team icon is labelled with the team's nickname",
  nicknamed.length === 0,
  nicknamed.length ? `still using the full name: ${nicknamed.join(", ")}` : "every label is a city"
);

const labels = new Map();
const clashes = [];
for (const icon of TEAM_ICONS) {
  const key = `${icon.sport}|${icon.name}`;
  if (labels.has(key)) clashes.push(`${labels.get(key)} / ${icon.id} both read "${icon.name}"`);
  labels.set(key, icon.id);
}
check(
  "No two team icons in one sport share a label",
  clashes.length === 0,
  clashes.length ? clashes.join("; ") : `${TEAM_ICONS.length} labels, all distinct within their sport`
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
