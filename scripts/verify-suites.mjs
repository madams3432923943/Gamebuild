#!/usr/bin/env node
// Every check this repo owns runs, or says why it does not.
//
// WHY THIS EXISTS
//
// `verify:node` was a single `&&` chain of thirty-three commands on one line
// of package.json. It worked, and it had two problems that only show up over
// time.
//
// A new check had to be remembered INTO it. Nothing failed when one was not:
// the file existed, the npm script existed, the suite was green, and the check
// simply never ran. Two of the checks added this week - verify:replay and
// verify:contrast - were wired in by hand, and either could as easily have
// been left out with nothing to say so.
//
// And it could only be run whole. After an engine change the useful question
// is "did I break the engine", and the only available answer took the full
// suite including every screen and asset check.
//
// So the chain is four tags now - rules, assets, engine, screens - which are
// runnable on their own and compose into the two suites CI calls. This file is
// what keeps that honest: it fails if a check exists and no tag reaches it.
//
// WHAT COUNTS AS REACHABLE
//
// Expanded through npm scripts rather than pattern-matched, so a check nested
// two tags deep still counts and a check named in a comment does not.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

console.log(renderSection("Verify suites (every check runs, or says why not)"));

const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const scripts = pkg.scripts || {};

/** Every shell command a script runs, following `npm run` into other scripts. */
function expand(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const out = [];
  for (const raw of String(scripts[name] || "").split("&&")) {
    const part = raw.trim();
    const nested = part.match(/^npm run ([\w:.-]+)/);
    if (nested && scripts[nested[1]]) out.push(...expand(nested[1], seen));
    else if (part) out.push(part);
  }
  return out;
}

const SUITES = ["verify:node", "verify:browser"];
const reached = new Set();
for (const suite of SUITES) {
  for (const cmd of expand(suite)) {
    for (const m of cmd.matchAll(/(?:scripts|tools)\/([\w-]+)\.m?js/g)) reached.add(m[1]);
  }
}

/**
 * Checks that deliberately sit outside the two suites, each with the reason.
 *
 * An exception has to be WRITTEN DOWN here to be allowed, which is the point:
 * the cost of leaving a check out of the suites is naming it, and naming it is
 * what makes the next person able to argue with the decision.
 */
const OUTSIDE = {
  "verify-schema-documented":
    "needs SUPABASE_DB_URL - it compares applied migrations against db/, and there is no database in a plain checkout",
  "verify-build-stamp":
    "compares a commit against its PARENT, so it is meaningless outside CI and is run there by verify-main.yml",
  "verify-dataset-published":
    "asks the live project what it published; run by the seed workflows after they publish",
};

/**
 * A CHECK is a file that runs and exits. A file that EXPORTS is a library the
 * checks share, and holding one to "which suite runs you" is a category error
 * - scripts/verify-browser.mjs exports runBrowserChecks and is imported by the
 * selftest runners, so no suite names it and none should.
 *
 * Told apart by whether the file exports anything, which is the actual
 * difference rather than a naming convention that can be got wrong. The first
 * version of this guard matched on the filename and duly reported the shared
 * library as an orphaned check.
 */
const candidates = (await readdir(path.join(ROOT, "scripts")))
  .filter((f) => /^verify-.*\.m?js$/.test(f));
const files = [];
for (const file of candidates) {
  const source = await readFile(path.join(ROOT, "scripts", file), "utf8");
  if (/^export\s/m.test(source)) continue;
  files.push(file.replace(/\.m?js$/, ""));
}

const orphans = files.filter((f) => !reached.has(f) && !(f in OUTSIDE));
check(
  `Every check in scripts/ is reachable from a suite (${files.length} checks)`,
  orphans.length === 0,
  orphans.length === 0
    ? `${reached.size} reached by ${SUITES.join(" + ")}, ${Object.keys(OUTSIDE).length} deliberately outside`
    : orphans.map((f) => `scripts/${f} runs in no suite - add it to a tag, or to OUTSIDE with a reason`).join("\n    ")
);

// An exception that no longer names a real file is a note about something that
// has been deleted, and it would quietly start excusing nothing.
const staleExceptions = Object.keys(OUTSIDE).filter((f) => !files.includes(f));
check(
  "Every documented exception still names a real check",
  staleExceptions.length === 0,
  staleExceptions.length === 0
    ? Object.entries(OUTSIDE).map(([f, why]) => `${f}: ${why}`).join("\n    ")
    : `no such file: ${staleExceptions.join(", ")}`
);

// A tag that is empty, or that no suite composes, is a tag nobody runs.
const TAGS = ["verify:rules", "verify:assets", "verify:engine", "verify:screens"];
const unusedTags = TAGS.filter((tag) => {
  if (!scripts[tag]) return true;
  return !SUITES.some((suite) => String(scripts[suite]).includes(tag));
});
check(
  `Every tag is composed into a suite (${TAGS.length} tags)`,
  unusedTags.length === 0,
  unusedTags.length === 0
    ? TAGS.map((t) => `${t}: ${expand(t).length} checks`).join("\n    ")
    : `not reachable from any suite: ${unusedTags.join(", ")}`
);

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
