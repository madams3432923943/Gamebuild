#!/usr/bin/env node
// The vendored engine is byte-identical to the one the app runs.
//
// verify:parity already proves a great deal about these two copies - the
// engine sources match with comments normalised, the constants match by value,
// the gamestyles match by value, and both engines produce the same box score
// under a shared seed. What it does not do is enumerate the FILES, and a file
// it never named could drift without failing anything.
//
// One did. js/sports/nfl/units.js gained a function and its vendored twin did
// not, through a whole session of green suites, because units.js was on
// nobody's list. This is the list, and the comparison is bytes rather than
// normalised source: a comment that disagrees between the two copies is a
// reader being told something untrue about the code they are looking at, which
// is worth failing over even though it cannot change a score.

import { vendorEngines, VENDORED } from "../tools/vendor-engines.mjs";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

console.log(renderSection("Vendored engine (the Edge Function runs the same code)"));

// write:false - this is a check, and a check that fixes what it finds is a
// check that always passes.
const drifted = await vendorEngines({ write: false });
const pairs = VENDORED.filter(([, to]) => to);

const checks = [
  {
    title: `Every vendored file matches its source, byte for byte (${pairs.length} files)`,
    status: drifted.length === 0 ? PASS : FAIL,
    detail:
      drifted.length === 0
        ? pairs.map(([from]) => from).join("\n    ")
        : drifted.map(({ from, to }) => `${from} != ${to} - run \`npm run vendor\``).join("\n    "),
  },
];

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
