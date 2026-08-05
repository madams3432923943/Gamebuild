// Every live sport must implement everything the SHARED ui/main code calls.
//
// This exists because NFL work broke NBA. js/ui.js is one draft board serving
// both sports, so it asks the active sport for things - cardStatLine, rate,
// basePosition. A per-sport hook was added, wired into NFL, and the edit
// adding it to NBA silently matched nothing. Shared code then called undefined
// as a function on the first card and took the whole board down. Quick Play
// went blank in BASKETBALL because of a change made for football.
//
// The sports are otherwise properly separate - own engine, own constants, own
// data, own tactics. The coupling is the shared UI, and it cannot be removed
// without maintaining two draft boards. So it is made SAFE instead: shared
// code may only call what every live sport is checked to provide.
//
// Add a hook to js/ui.js, add its name here.

import { SPORTS } from "../js/sports/index.js";

/** Called by shared code on whatever sport is active. */
const REQUIRED_FUNCTIONS = [
  "computeDatasetStats", "simulate", "rate", "cardStatLine",
  "basePosition", "isBenchSlot", "orderedRosterSlots",
  "players", "playersInEra", "eraById",
  "buildRecap", "buildGameScript", "gradeDraft",
  "defaultMinutes", "botMinutes", "defaultMatchups",
];

const REQUIRED_VALUES = ["id", "name", "groupKey", "slots", "eras", "theme", "labels"];

/** Hooks whose ARITY shared code depends on. A signature mismatch is invisible
 * - NFL's playersInEra took (eraId) while shared code passes (players, eraId),
 * so it filtered on nothing and the era picker silently did nothing. */
const REQUIRED_ARITY = { playersInEra: 2 };

let failures = 0;
for (const meta of SPORTS) {
  if (!meta.live) {
    console.log(`  ${meta.name.padEnd(6)} not live - skipped`);
    continue;
  }
  const sport = (await import(`../js/sports/${meta.id}/index.js`))[meta.id.toUpperCase()];
  const missing = [];
  for (const fn of REQUIRED_FUNCTIONS) if (typeof sport?.[fn] !== "function") missing.push(`${fn}()`);
  for (const key of REQUIRED_VALUES) if (sport?.[key] === undefined) missing.push(key);
  // A slot list shared code iterates must actually exist for both modes.
  if (!sport?.slots?.quickPlay?.length || !sport?.slots?.ranked?.length) missing.push("slots.quickPlay/ranked");
  for (const [fn, arity] of Object.entries(REQUIRED_ARITY)) {
    if (typeof sport?.[fn] === "function" && sport[fn].length < arity) {
      missing.push(`${fn}() takes ${sport[fn].length} args, shared code passes ${arity}`);
    }
  }

  if (missing.length) {
    failures++;
    console.log(`  ${meta.name.padEnd(6)} MISSING: ${missing.join(", ")}`);
  } else {
    console.log(`  ${meta.name.padEnd(6)} implements all ${REQUIRED_FUNCTIONS.length + REQUIRED_VALUES.length}`);
  }
}

if (failures) {
  console.error(`\nSport contract FAILED for ${failures} sport(s) - shared UI would throw on a live sport.`);
  process.exit(1);
}
console.log("\nSport contract passed.");
