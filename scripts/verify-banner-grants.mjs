#!/usr/bin/env node
// The owner's override: granted banners and badges.
//
// WHY THIS EXISTS
//
// The first version of "give the founder every banner" was a hardcoded id check
// in js/banners.js. It worked and it was the wrong shape: every future favour -
// a friend, a tester, an apology for a bug - would have been a code change, a
// test run, a push, and a wait on a Pages deploy that has failed with a 503 more
// than once. Grants live in profiles.granted_banners / granted_badges now, so a
// grant is one row edit and takes effect on the next page load.
//
// An override that unlocks things is exactly the code that gets generalised by
// accident - a truthy test, a renamed field, a profile that arrives without the
// column - and the failure is silent and generous: everyone gets everything and
// nothing looks broken. That is what this pins down.
//
// The other half is the line that must never move: grants are COSMETIC. Ratings,
// records and results are the trusted server's. A grant that could reach them
// would turn the ladder everyone else is ranked against into a favour.

import {
  FRANCHISES,
  GENERAL_BANNERS,
  bannerProgress,
  generalBannerProgress,
} from "../js/banners.js";
import { BADGES, badgeProgress } from "../js/badges.js";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const add = (title, ok, detail) => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

const bare = {
  onlineWins: 0, onlineLosses: 0, offlineWins: 0, offlineLosses: 0,
  friendCount: 0, eraRecords: {}, teamBanners: {}, careerTotals: {},
  personalBests: {}, draftCounts: {}, history: [],
};

// ---- nothing granted, nothing unlocked -------------------------------------
// The floor. If this ever passes with unlocks, every check below is meaningless.
const ungranted = { ...bare, grantedBanners: [], grantedBadges: [] };
const baselineGeneral = GENERAL_BANNERS.filter((b) => generalBannerProgress(b, ungranted).unlocked);
add(
  "With no grant, only what is genuinely earned is unlocked",
  baselineGeneral.length === 1 && baselineGeneral[0].id === "rookie",
  baselineGeneral.length === 1
    ? "only Rookie, which everyone starts with"
    : `${baselineGeneral.length} unlocked without a grant: ${baselineGeneral.map((b) => b.id).join(", ")}`
);
add(
  "With no grant, no franchise banner is unlocked",
  FRANCHISES.every((f) => !bannerProgress(f, ungranted).unlocked),
  `${FRANCHISES.length} franchises, all locked`
);
add(
  "With no grant, no badge has a tier",
  BADGES.every((b) => badgeProgress(b, ungranted).tierIndex < 0),
  `${BADGES.length} badges, none earned`
);

// ---- a grant unlocks exactly what it names, and nothing else ---------------
const oneOfEach = {
  ...bare,
  grantedBanners: ["crystal", "nfl-eagles"],
  grantedBadges: ["gunslinger"],
};
add(
  "A granted general banner unlocks",
  generalBannerProgress(GENERAL_BANNERS.find((b) => b.id === "crystal"), oneOfEach).unlocked,
  "crystal, which needs 500 ranked wins, from a profile with zero"
);
add(
  "A granted franchise banner unlocks",
  bannerProgress(FRANCHISES.find((f) => f.id === "nfl-eagles"), oneOfEach).unlocked,
  "nfl-eagles, from a profile that has drafted nobody"
);
add(
  "A granted badge lands at its TOP tier, not Bronze",
  badgeProgress(BADGES.find((b) => b.id === "gunslinger"), oneOfEach).tierIndex ===
    BADGES.find((b) => b.id === "gunslinger").thresholds.length - 1,
  "a grant that produced Bronze would leave the player grinding for something they were given"
);

// The narrowness is the whole point. A grant that leaks is worse than no grant:
// every ladder in the game stops meaning anything at once.
const leakedGeneral = GENERAL_BANNERS.filter(
  (b) => b.id !== "crystal" && b.id !== "rookie" && generalBannerProgress(b, oneOfEach).unlocked
);
const leakedFranchise = FRANCHISES.filter(
  (f) => f.id !== "nfl-eagles" && bannerProgress(f, oneOfEach).unlocked
);
const leakedBadges = BADGES.filter((b) => b.id !== "gunslinger" && badgeProgress(b, oneOfEach).tierIndex >= 0);
add(
  "Granting one thing grants only that thing",
  leakedGeneral.length === 0 && leakedFranchise.length === 0 && leakedBadges.length === 0,
  leakedGeneral.length + leakedFranchise.length + leakedBadges.length === 0
    ? "two banners and one badge granted; nothing else moved"
    : `leaked: ${[...leakedGeneral, ...leakedFranchise].map((x) => x.id).join(", ")} ${leakedBadges.map((b) => b.id).join(", ")}`
);

// ---- malformed grants deny rather than break -------------------------------
// A missing column, a null, a string where an array belongs - all of these
// arrive in practice, and the safe reading of every one of them is "no grant".
for (const shape of [{}, { grantedBanners: null }, { grantedBanners: "crystal" }, { grantedBanners: {} }]) {
  const p = { ...bare, ...shape };
  const unlocked = GENERAL_BANNERS.filter((b) => generalBannerProgress(b, p).unlocked);
  if (unlocked.length !== 1) {
    add("A malformed grant denies rather than throws or leaks", false, JSON.stringify(shape));
    break;
  }
}
if (!checks.some((c) => c.title === "A malformed grant denies rather than throws or leaks")) {
  add(
    "A malformed grant denies rather than throws or leaks",
    true,
    "missing, null, string and object all read as no grant"
  );
}

// An id for something that does not exist grants nothing, so a typo is harmless.
const typo = { ...bare, grantedBanners: ["cyrstal", "", null, 42] };
add(
  "An unknown or junk id grants nothing",
  GENERAL_BANNERS.filter((b) => generalBannerProgress(b, typo).unlocked).length === 1,
  "a typo costs the grant, not the screen"
);

// ---- granted is flagged, never disguised as earned -------------------------
add(
  "Granted unlocks are marked granted",
  generalBannerProgress(GENERAL_BANNERS.find((b) => b.id === "crystal"), oneOfEach).granted === true &&
    bannerProgress(FRANCHISES.find((f) => f.id === "nfl-eagles"), oneOfEach).granted === true &&
    badgeProgress(BADGES.find((b) => b.id === "gunslinger"), oneOfEach).granted === true,
  "so a tile can say how it was come by rather than implying 500 ranked wins"
);

// A genuinely earned unlock is NOT flagged as granted - the distinction is the
// only thing keeping the flag meaningful.
const earned = { ...bare, grantedBanners: [], onlineWins: 600 };
const crystalEarned = generalBannerProgress(GENERAL_BANNERS.find((b) => b.id === "crystal"), earned);
add(
  "An earned unlock is not flagged as granted",
  crystalEarned.unlocked && !crystalEarned.granted,
  "600 ranked wins earns Crystal outright"
);

// ---- the line that must not move -------------------------------------------
// Grants are cosmetic. This asserts the shape of what a grant returns: an
// unlock and a flag, and nothing that any rating, record or result reads.
const shape = generalBannerProgress(GENERAL_BANNERS.find((b) => b.id === "crystal"), oneOfEach);
const allowed = new Set(["drafted", "value", "required", "unlocked", "percent", "granted"]);
const unexpected = Object.keys(shape).filter((k) => !allowed.has(k));
add(
  "A grant returns only cosmetic progress fields",
  unexpected.length === 0,
  unexpected.length === 0
    ? Object.keys(shape).join(", ")
    : `a grant is leaking non-cosmetic fields: ${unexpected.join(", ")}`
);

console.log(renderSection("Granted unlocks: the owner's override, and its limits"));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
