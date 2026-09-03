// Every live sport must implement everything the SHARED ui/main code calls.
//
// This exists because NFL work broke NBA. js/ui.js is one draft board serving
// both sports, so it asks the active sport for things - cardStats, rate,
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

import { SPORTS, ensureSportData } from "../js/sports/index.js";

// A sport may load its dataset on demand rather than on boot - football does,
// because its data is larger than the rest of the app combined. The contract
// is about the sport's SURFACE, so every live sport is loaded up front here
// and then checked exactly as before.
for (const meta of SPORTS) {
  if (meta.live) await ensureSportData(meta.id);
}

/** Called by shared code on whatever sport is active. */
const REQUIRED_FUNCTIONS = [
  "computeDatasetStats", "simulate", "rate", "cardStats",
  "basePosition", "isBenchSlot", "isUnit", "unitLabel", "orderedRosterSlots",
  "players", "playersInEra", "eraById",
  "buildRecap", "buildGameScript", "gradeDraft",
  "defaultMinutes", "botMinutes", "defaultMatchups",
  // Both live sports fetch their dataset on selection, so shared code has to be
  // able to ask whether the pool is here yet WITHOUT triggering the download -
  // js/main.js warmDatasetStats() would otherwise pull 2.3MB at boot to warm a
  // cache, which is the cost the lazy load exists to avoid.
  "dataReady",
  // Which dataset this client is holding, in the same string the Edge Function
  // stamps on a finished match. js/main.js compares the two before it shows a
  // draft analysis, so a sport without one would have its analysis ranked
  // against whatever pool happened to be loaded, silently.
  "datasetVersion",
];

const REQUIRED_VALUES = ["id", "name", "groupKey", "slots", "eras", "theme", "labels",
  // The profile screen builds its records and career totals from these, so a
  // sport without its own would show basketball's categories under its tab.
  "statKeys", "lineKeys", "statLabels",
  // Vocabulary and shape shared code would otherwise have to assume. Each of
  // these was once hardcoded to basketball in js/main.js or js/ui.js, and each
  // one showed up as football being narrated in boards, dimes and minutes.
  "boxColumns", "highlights", "usesMatchups",
  // Which stage the sport is WATCHED on. Shared code shows the declared one
  // and hides the rest; a sport that does not declare it would play on
  // whatever the previous sport left on screen.
  "presentation"];

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

/** Hooks inside `presentation`, per stage.
 *
 * "presentation" in REQUIRED_VALUES only checks that the KEY exists, so an
 * empty object passed - and a sport declaring stage "field" with no renderField
 * would fail at the first snap rather than at the build. These are the ones
 * shared code calls unconditionally once a stage is declared. */
const REQUIRED_PRESENTATION = {
  field: ["renderField", "showEvent", "buildTimeline", "createLiveState", "applyEvent", "liveBox", "liveScore"],
  board: [],
};

/** liveStatusLabel writes straight into the scoreboard's centre cell, so a
 * sport returning anything but a string or null puts "[object Object]" between
 * the two scores. Optional by design: basketball has no play clock and omits
 * it, which is why shared code calls it with ?. */
const SAMPLE_EVENT = { quarter: 3, clock: "12:29", scoreA: 9, scoreB: 7, possession: "A", down: 4, distance: 1 };


/** WCAG 2.1 relative luminance, then the contrast ratio between two colours.
 *
 * Inlined rather than pulled from a package: it is twelve lines of arithmetic
 * from a published formula, and a dependency for it would be the only runtime
 * package in a repo that deliberately has none. */
function relativeLuminance(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a, b) {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** WCAG AA for normal text. accentContrast is the colour that prints ON the
 *  accent - button labels, the scoreboard, the active pill - so it is normal
 *  text at normal weight and this is the threshold that applies. */
const MIN_CONTRAST = 4.5;

let failures = 0;
const contrastNotes = [];
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
  // The stage a sport declares brings obligations with it.
  const stage = sport?.presentation?.stage;
  if (stage && !(stage in REQUIRED_PRESENTATION)) {
    missing.push(`presentation.stage "${stage}" is not a stage shared code knows how to show`);
  }
  for (const hook of REQUIRED_PRESENTATION[stage] || []) {
    if (typeof sport?.presentation?.[hook] !== "function") missing.push(`presentation.${hook}`);
  }
  // Optional, but if present it has to answer with something a board can print.
  if (sport?.presentation?.liveStatusLabel !== undefined) {
    if (typeof sport.presentation.liveStatusLabel !== "function") {
      missing.push("presentation.liveStatusLabel is not a function");
    } else {
      const label = sport.presentation.liveStatusLabel(SAMPLE_EVENT);
      if (label !== null && typeof label !== "string") {
        missing.push(`presentation.liveStatusLabel returned ${typeof label}, not a string or null`);
      }
      if (sport.presentation.liveStatusLabel({}) === undefined) {
        missing.push("presentation.liveStatusLabel returned undefined for an event with no clock - return null");
      }
    }
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
  // cardStats() returns PAIRS, and the pairing is the whole point.
  //
  // Both sports used to return a "·"-joined string, which shared code drew as
  // one run of text that wrapped between a value and its label on every card
  // at phone width. The grid renderer in js/ui.js can only keep them together
  // if it is given them apart, so a sport quietly going back to a string - or
  // to {stat, val}, or to a bare array of numbers - has to fail here rather
  // than render "[object Object]" down the pool.
  if (typeof sport?.cardStats === "function") {
    try {
      const all = sport.playersInEra(sport.players(), sport.defaultEra);
      // A UNIT as well as a person where the sport has them: football branches
      // on p.group and only the unit branch emits a lead pair.
      const samples = [all[0], (sport.units?.() || [])[0]].filter(Boolean);
      for (const sample of samples) {
        const pairs = sport.cardStats(sample);
        if (!Array.isArray(pairs)) {
          missing.push(`cardStats() returned ${typeof pairs}, not an array of pairs`);
          continue;
        }
        if (!pairs.length) {
          missing.push("cardStats() returned an empty array");
          continue;
        }
        for (const pair of pairs) {
          if (pair?.value === undefined) missing.push("cardStats() returned a pair with no .value");
          // A label may be "" - that is the documented LEAD form, which shared
          // code gives full width. It may not be missing or non-string.
          if (typeof pair?.label !== "string") missing.push("cardStats() returned a pair whose .label is not a string");
        }
      }
    } catch (e) {
      missing.push(`cardStats() threw: ${e.message}`);
    }
  }

  // The opponent is READ, not just accepted.
  //
  // NFL.draftAnalysis took (roster, oppRoster, ctx, forfeits) and passed only
  // the forfeits on, so football's "how your roster stacks against theirs" was
  // the solo draft grade printed twice. Nothing caught it because the output
  // was a plausible grade with plausible sentences under it - the failure mode
  // CLAUDE.md names, where a believable wrong answer outlives an obvious one.
  //
  // Checked on the OUTPUT rather than by diffing two runs: a roster comparison
  // can legitimately come out even, so "these two readings differ" is not a
  // property that always holds. "The grade named one of their players" is.
  if (typeof sport?.gradeDraft === "function") {
    try {
      const ctx = sport.computeDatasetStats(sport.players(), sport.units?.());
      const all = ctx.__allEntries || sport.playersInEra(sport.players(), sport.defaultEra);
      const build = (pool) => {
        const roster = {};
        const used = new Set();
        for (const slot of sport.slots.quickPlay) {
          const base = String(sport.basePosition(slot)).toUpperCase();
          const fit = pool.find(
            (e) =>
              !used.has(e.name) &&
              (String(e.group || "").toUpperCase() === base ||
                (e.pos || []).some((p) => String(p).toUpperCase() === base))
          );
          if (fit) {
            roster[slot] = fit;
            used.add(fit.name);
          }
        }
        return roster;
      };

      const mine = build(all);
      // Drawn from the other end of the pool, so the two rosters share no names
      // and "did it name one of THEIRS" is an unambiguous question.
      const theirs = build([...all].reverse());
      const myNames = new Set(Object.values(mine).map((p) => p.name));
      const theirNames = Object.values(theirs)
        .map((p) => p.name)
        .filter((n) => !myNames.has(n));

      const graded = sport.gradeDraft(mine, ctx, { oppRoster: theirs, forfeits: [] });
      const text = (graded?.reasons || []).join(" ");
      const named = theirNames.filter((n) => text.includes(n));

      if (theirNames.length === 0) {
        missing.push("could not build two distinct rosters to check the opponent read");
      } else if (named.length === 0) {
        missing.push("gradeDraft() with an oppRoster never names an opponent - the matchup read is missing");
      }
    } catch (e) {
      missing.push(`gradeDraft() with an oppRoster threw: ${e.message}`);
    }
  }

  // A sport's identity is four custom properties, and one of them is the text
  // colour that prints on the other. CLAUDE.md has required 4.5:1 between them
  // since the theme hook existed, and nothing enforced it - both live sports
  // happen to pass (5.85 and 4.70), so the next sport would have been the one
  // to find out, in production, on the only colour a player cannot avoid.
  const theme = sport?.theme;
  if (theme?.accent && theme?.accentContrast) {
    const ratio = contrastRatio(theme.accent, theme.accentContrast);
    if (ratio < MIN_CONTRAST) {
      missing.push(
        `theme.accentContrast ${theme.accentContrast} on accent ${theme.accent} ` +
          `is ${ratio.toFixed(2)}:1, under the ${MIN_CONTRAST}:1 minimum`
      );
    } else {
      contrastNotes.push(`${meta.name} ${ratio.toFixed(2)}:1`);
    }
  } else {
    missing.push("theme.accent/accentContrast");
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
console.log(`\n  accent contrast: ${contrastNotes.join(", ")} (minimum ${MIN_CONTRAST}:1)`);
console.log("\nSport contract passed.");
