#!/usr/bin/env node
// Copies the simulation into the Edge Function, and is the ONLY thing that
// should.
//
// WHY THE COPY EXISTS AT ALL
//
// The Edge Function cannot import from js/ - it is deployed to Supabase as its
// own directory and has no access to the repo around it. So the engine lives
// twice, and CLAUDE.md's rule is blunt about the consequence: "Change one, copy
// it across, or online games diverge from offline ones."
//
// WHY THIS FILE EXISTS
//
// Because "copy it across" was a human step, and a human step that must never
// be forgotten will be forgotten. It was, tonight: js/sports/nfl/units.js
// gained a function and its vendored twin did not, and nothing failed -
// verify:parity compares engine.js, rating.js, constants and tactics, and
// units.js was in none of those lists. The drift shipped.
//
// Now the copy is a command and the check is byte-for-byte. Run
// `npm run vendor` after touching anything below, or let
// `npm run verify:vendored` tell you that you did not.
//
// WHY NOT COPY AT DEPLOY TIME INSTEAD
//
// That is the better end state and it is a bigger change than it looks: the
// deploy workflow triggers on `supabase/functions/**`, so a repo where those
// files are generated rather than committed would stop triggering a deploy on
// an engine edit - the exact failure this is meant to prevent, arrived at from
// the other direction. Doing it properly means moving the trigger to
// js/sports/** as well and proving the generated tree deploys, which cannot be
// rehearsed from here. Written down rather than half-done.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FN = path.join(ROOT, "supabase", "functions", "simulate-match");

/**
 * Source -> vendored copy, and this list is the contract.
 *
 * A file the simulation needs and this list does not name is a file that can
 * drift, which is what happened to units.js. Anything the Edge Function's
 * engine imports belongs here.
 */
export const VENDORED = [
  ["js/rating.js", "supabase/functions/simulate-match/rating.js"],
  ["js/sports/nba/engine.js", "supabase/functions/simulate-match/sports/nba/engine.js"],
  ["js/sports/nba/constants.js", "supabase/functions/simulate-match/sports/nba/constants.js"],
  ["js/sports/nba/tactics.js", "supabase/functions/simulate-match/sports/nba/tactics.js"],
  ["js/sports/nfl/engine.js", "supabase/functions/simulate-match/sports/nfl/engine.js"],
  ["js/sports/nfl/constants.js", "supabase/functions/simulate-match/sports/nfl/constants.js"],
  ["js/sports/nfl/tactics.js", "supabase/functions/simulate-match/sports/nfl/tactics.js"],
  ["js/sports/nfl/units.js", "supabase/functions/simulate-match/sports/nfl/units.js"],
  ["js/lib/seeded-rng.js", null], // see below
];

/**
 * seeded-rng has a TypeScript twin rather than a copy.
 *
 * supabase/functions/simulate-match/seeded-rng.ts is the same algorithm with
 * type annotations, so it cannot be a byte copy and is not listed as one. It
 * is checked by scripts/verify-result-provenance.mjs, which compares the two
 * version stamps, and by verify:replay, which proves a seed round-trips.
 */
const PAIRS = VENDORED.filter(([, to]) => to);

export async function vendorEngines({ write = true } = {}) {
  const drifted = [];
  for (const [from, to] of PAIRS) {
    const source = await readFile(path.join(ROOT, from), "utf8");
    let current = null;
    try {
      current = await readFile(path.join(ROOT, to), "utf8");
    } catch {
      /* not there yet - counts as drift, and writing fixes it */
    }
    if (current !== source) {
      drifted.push({ from, to });
      if (write) await writeFile(path.join(ROOT, to), source);
    }
  }
  return drifted;
}

// Run directly: do the copy and say what moved.
if (import.meta.url === `file://${process.argv[1]}`) {
  const drifted = await vendorEngines({ write: true });
  if (!drifted.length) console.log(`vendored copies already match (${PAIRS.length} files)`);
  else {
    for (const { from, to } of drifted) console.log(`copied ${from} -> ${to}`);
    console.log(`\n${drifted.length} of ${PAIRS.length} file(s) updated.`);
  }
}
