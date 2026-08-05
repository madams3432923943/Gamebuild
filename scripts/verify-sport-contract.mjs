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

const REQUIRED_VALUES = ["id", "name", "groupKey", "slots", "eras", "theme", "labels",
  // The profile screen builds its records and career totals from these, so a
  // sport without its own would show basketball's categories under its tab.
  "statKeys", "lineKeys", "statLabels",
  // Vocabulary and shape shared code would otherwise have to assume. Each of
  // these was once hardcoded to basketball in js/main.js or js/ui.js, and each
  // one showed up as football being narrated in boards, dimes and minutes.
  "boxColumns", "highlights", "usesMatchups"];

/** Hooks whose ARITY shared code depends on. A signature mismatch is invisible
 * - NFL's playersInEra took (eraId) while shared code passes (players, eraId),
 * so it filtered on nothing and the era picker silently did nothing. */
const REQUIRED_ARITY = { playersInEra: 2 };

/** Return shapes shared code destructures. A hook that exists but returns the
 * wrong fields is worse than a missing one: showDraftGrade wraps only the CALL
 * in a try/catch, then reads grade.letter and spreads grade.reasons outside it,
 * so NFL returning {grade, notes} instead of {letter, reasons} threw at the
 * render step and killed the whole post-draft flow. The draft finished and
 * nothing ever simulated, with the error buried in the console. */
const REQUIRED_SHAPES = {
  gradeDraft: { fields: ["letter", "headline", "reasons"], arrays: ["reasons"] },
};

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
  // Every label must name a real box-score key, or the profile promises a
  // record the simulation never produces. NFL's engine emits {td, pts} per
  // slot while its labels advertise passing and rushing yards - a record that
  // can never be set, and nothing else would have caught it.
  for (const key of Object.keys(sport?.statLabels || {})) {
    if (!(sport.lineKeys || []).includes(key)) missing.push(`statLabels.${key} is not in lineKeys`);
  }
  // Hooks are CALLED, not just counted. Everything above checks that a
  // function exists; this checks it returns what shared code reads.
  for (const [fn, spec] of Object.entries(REQUIRED_SHAPES)) {
    if (typeof sport?.[fn] !== "function") continue;
    try {
      const ctx = sport.computeDatasetStats(sport.players(), sport.units?.());
      const all = sport.playersInEra(sport.players(), sport.defaultEra);
      const roster = {};
      for (const slot of sport.slots.quickPlay) {
        const base = sport.basePosition(slot);
        roster[slot] = all.find((p) => (p.pos || []).includes(base));
      }
      const out = sport[fn](roster, ctx, []);
      for (const field of spec.fields) {
        if (out?.[field] === undefined) missing.push(`${fn}() returns no .${field}`);
      }
      for (const field of spec.arrays) {
        if (out?.[field] !== undefined && !Array.isArray(out[field])) {
          missing.push(`${fn}().${field} is not an array`);
        }
      }
    } catch (e) {
      missing.push(`${fn}() threw: ${e.message}`);
    }
  }
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
