#!/usr/bin/env node
// Every finished online match records what produced it.
//
// WHY THIS EXISTS - issue #30
//
// match_results carries four provenance columns: engine_version,
// dataset_version, rules_version and simulation_seed. Together they are what
// makes a finished game re-derivable: which engine ran, against which dataset,
// under which rules, from which seed.
//
// Football filled all four from the day it shipped. Basketball filled none -
// fourteen stored results with a null seed - because provenance had been
// written into the football path rather than the shared one. Nobody noticed,
// because a game with no provenance looks exactly like a game with provenance
// until the day you need to ask a question of it.
//
// It also removed the only cheap way to catch a whole class of bug. The
// football provenance string is what exposed the truncated-pool bug:
// `nfl-generated-1000-2024` recorded a 1000-row dataset for a 13,874-row
// table, and that number is the entire reason it was noticed. Basketball had
// the SAME truncation at the same time and left no trace at all.
//
// The code is fixed - the versions are computed from `sportId` on the shared
// path now, so every sport gets them. This is the third item on that issue:
// something that fails if a sport is ever added, or a path ever refactored,
// that does not record all four. The point is not to re-test today's code, it
// is to make the next sport unable to land without provenance.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SPORTS } from "../js/sports/index.js";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FN = path.join(ROOT, "supabase", "functions", "simulate-match");

const checks = [];
const add = (title, ok, detail) => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

const indexTs = await readFile(path.join(FN, "index.ts"), "utf8");
const adapters = await readFile(path.join(FN, "sports", "index.ts"), "utf8");

// Comments quote these identifiers while explaining them, so prose would
// otherwise read as code. Blanked, not deleted, so offsets still line up.
const code = indexTs
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + m.slice(p.length).replace(/./g, " "));

// ---- all four are computed, and none of them behind a sport test -----------
for (const [label, name] of [
  ["engine version", "engineVersion"],
  ["dataset version", "datasetVersion"],
  ["rules version", "rulesVersion"],
  ["simulation seed", "seed"],
]) {
  const assigned = new RegExp(`const\\s+${name}\\s*=`).test(code);
  add(
    `The ${label} is computed for every simulation`,
    assigned,
    assigned ? `const ${name} = ... on the shared path` : `no unconditional 'const ${name} ='`
  );
}

// The specific shape of the original bug: provenance living inside a branch
// that only one sport takes. Each value has to be derived from the sport
// rather than from a literal naming one.
const sportIdDerived = /const\s+engineVersion\s*=\s*`\$\{sportId\}/.test(code);
add(
  "The engine version is derived from the sport, not written for one of them",
  sportIdDerived,
  sportIdDerived ? "`${sportId}-engine-...`" : "engineVersion does not interpolate sportId"
);

// ---- all four are actually PASSED to the write -----------------------------
const finalizeArgs = code.slice(code.indexOf("finalize_match_result"));
for (const arg of ["p_seed", "p_engine_version", "p_dataset_version", "p_rules_version"]) {
  const passed = finalizeArgs.includes(arg);
  add(`${arg} is handed to finalize_match_result`, passed, passed ? "passed" : "MISSING from the RPC call");
}

// ---- every live sport can produce a dataset version ------------------------
// The adapter type requires it, but TypeScript is not run anywhere in this
// repo's verify chain - the Edge Function is deployed from source - so the
// contract is checked here rather than assumed.
const live = SPORTS.filter((s) => s.live);
const missing = live.filter((s) => !new RegExp(`datasetVersion:\\s*\\(rows\\)`).test(adapters) ||
                                   !adapters.includes(`${s.id}-`) && !adapters.includes(`${s.id}-generated`));
add(
  "Every live sport's server adapter declares a dataset version",
  missing.length === 0,
  missing.length === 0
    ? `${live.map((s) => s.id).join(", ")} all declare one`
    : `no datasetVersion for: ${missing.map((s) => s.id).join(", ")}`
);

// The dataset version has to carry the ROW COUNT. That is the whole reason the
// truncated pool was caught: 1000 rows recorded against a 13,874-row table.
// A version string that is only a date would have hidden it.
const countsRows = (adapters.match(/datasetVersion:\s*\(rows\)\s*=>\s*`[^`]*\$\{rows\.length\}/g) || []).length;
add(
  "A dataset version records how many rows were actually loaded",
  countsRows >= live.length,
  countsRows >= live.length
    ? `${countsRows} adapters interpolate rows.length`
    : `only ${countsRows} of ${live.length} record a row count - a truncated pool would leave no trace`
);

// ---- the seed is seeded, not decorative ------------------------------------
const seedUsed = /withSeededMathRandom\(\s*seed/.test(code);
add(
  "The stored seed is the one the simulation actually ran under",
  seedUsed,
  seedUsed
    ? "withSeededMathRandom(seed, ...) wraps the simulate call"
    : "the seed is stored but never used to seed anything - it would not reproduce the game"
);

console.log(renderSection("Result provenance: every finished match says what produced it (#30)"));
// ---- the client's copy of the same strings ---------------------------------
//
// js/lib/provenance.js computes engine_version and rules_version from the same
// two literals, because an offline game has to stamp what produced it too and
// the Edge Function cannot import from js/. That is the same duplication the
// vendored engines live with, and it gets the same treatment: checked rather
// than trusted. If the two drift, an offline result and an online one claim to
// have come from different simulations while running identical code - or, far
// worse, claim to have come from the same one while not.
{
  const client = await readFile(path.join(ROOT, "js", "lib", "provenance.js"), "utf8");
  const stamp = (text, name) => text.match(new RegExp(`${name}-\\d{4}-\\d{2}-\\d{2}\\.\\d+`))?.[0] ?? null;
  const clientEngine = stamp(client, "engine");
  const serverEngine = stamp(indexTs, "engine");
  const clientRules = stamp(client, "rules");
  const serverRules = stamp(indexTs, "rules");
  add(
    "Client and Edge Function agree on the engine version stamp",
    !!clientEngine && clientEngine === serverEngine,
    `client ${clientEngine} / server ${serverEngine}`
  );
  add(
    "Client and Edge Function agree on the rules version stamp",
    !!clientRules && clientRules === serverRules,
    `client ${clientRules} / server ${serverRules}`
  );
}

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
