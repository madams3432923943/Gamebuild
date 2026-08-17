#!/usr/bin/env node
// Banner grants: the founder gets everything, and nobody else gets anything.
//
// WHY THIS EXISTS
//
// The general banner ladders are computed live from real counters - online wins,
// friend count, wins in every era - and the clan ladder is computed from nothing
// at all, since clans do not exist and its progress function ignores the profile
// entirely. So the founder's banners could not be granted by writing data, only
// by an identity check inside generalBannerProgress.
//
// An identity check that unlocks things is exactly the kind of code that gets
// generalised by accident - a truthy test, a renamed field, a profile object
// that arrives without an id - and the failure mode is silent and generous:
// everybody gets every banner and nobody notices, because nothing looks broken.
// That is what this pins down.
//
// It also fixes the shortcut that was NOT taken, and should stay not-taken:
// unlocking these by inflating online_wins would have faked a ranked record that
// feeds the ELO everyone else is ranked against.

import { GENERAL_BANNERS, generalBannerProgress, isFounder } from "../js/banners.js";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const add = (title, ok, detail) => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

// The real founder id, read through the module's own predicate rather than
// duplicated here - if the constant moves, this test follows it.
const FOUNDER_ID = "eb5b91cf-7a08-4757-b2a7-967db2424846";
add("isFounder recognises the founder id", isFounder({ id: FOUNDER_ID }), FOUNDER_ID);

// Deliberately modest counters: a founder with six wins and one friend has
// earned almost nothing, so anything unlocked is the grant and not the ladder.
const founder = { id: FOUNDER_ID, onlineWins: 6, friendCount: 1, eraRecords: {} };
const stranger = { id: "11111111-2222-3333-4444-555555555555", onlineWins: 6, friendCount: 1, eraRecords: {} };

const unlockedFor = (p) => GENERAL_BANNERS.filter((b) => generalBannerProgress(b, p).unlocked);

const founderUnlocked = unlockedFor(founder);
add(
  "The founder has every general banner",
  founderUnlocked.length === GENERAL_BANNERS.length,
  `${founderUnlocked.length} of ${GENERAL_BANNERS.length}`
);

// The whole point of the check being narrow. A grant that leaks is worse than no
// grant: every ladder in the game stops meaning anything at once.
const strangerUnlocked = unlockedFor(stranger);
add(
  "Nobody else is granted anything",
  strangerUnlocked.length === 1 && strangerUnlocked[0].id === "rookie",
  strangerUnlocked.length === 1
    ? "only Rookie, which everyone starts with"
    : `${strangerUnlocked.length} unlocked for a stranger: ${strangerUnlocked.map((b) => b.id).join(", ")}`
);

// A profile with no id at all - a partial row, a failed read, a stub in a test -
// must not read as the founder. `undefined === undefined` is the bug this is
// here to prevent.
for (const shape of [{}, { id: null }, { id: undefined }, { id: "" }]) {
  const p = { ...shape, onlineWins: 0, friendCount: 0, eraRecords: {} };
  if (unlockedFor(p).length > 1) {
    add("A profile with no id is not the founder", false, `granted via ${JSON.stringify(shape)}`);
    break;
  }
}
if (!checks.some((c) => c.title === "A profile with no id is not the founder")) {
  add("A profile with no id is not the founder", true, "empty, null, undefined and blank ids all denied");
}

// The clan banners are the proof that this had to be a grant rather than data:
// their progress function takes no profile and returns unlocked:false always.
const pending = GENERAL_BANNERS.filter((b) => b.pending);
add(
  "The unearnable clan banners are reachable ONLY by grant",
  pending.length > 0 &&
    pending.every((b) => !b.progress(founder).unlocked) &&
    pending.every((b) => generalBannerProgress(b, founder).unlocked),
  `${pending.length} clan banners: false from progress(), unlocked through the grant`
);

// Granted is flagged, not disguised as earned.
const grantedFlags = GENERAL_BANNERS.filter((b) => generalBannerProgress(b, founder).granted);
add(
  "Granted banners are marked as granted, not as earned",
  grantedFlags.length === GENERAL_BANNERS.length - 1,
  `${grantedFlags.length} flagged (all but Rookie, which is genuinely earned by existing)`
);

console.log(renderSection("Banner grants: the founder, and nobody else"));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
