#!/usr/bin/env node
// ARE THE PRECOMPUTED STATISTICS THE ONES THE SERVER WOULD HAVE COMPUTED?
//
// The Edge Function no longer derives its rating context per request. It reads
// a context baked at build time by tools/bake-server-stats.mjs, because
// deriving it meant paging the whole player table in every time - about 19MB
// of database egress per online football match, for a number that changes only
// when someone regenerates the dataset.
//
// That trade buys a great deal and introduces exactly one new way to be wrong:
// the baked numbers could describe a pool that is not the one being played.
// Nothing about that failure looks like a failure. Every rating would still be
// a number between zero and one, every game would still finish, and the only
// symptom would be that a drafted player rated against the wrong distribution.
//
// So this compares the whole context, key by key, against one computed live
// from the same rows the seed writes - and it fails if a single value differs.
//
// TWO SEPARATE QUESTIONS, and both are asked:
//
//   IS IT CURRENT? The committed file has to be what today's dataset produces.
//   This is the `--check` half of the bake tool, and it is the one that catches
//   a dataset regenerated without re-running `npm run bake`.
//
//   IS IT RIGHT? Being current only says the file matches the tool. This
//   recomputes through the server's own registry and compares, so a bug in the
//   baking - a key dropped, a number rounded, __allEntries stripped from the
//   wrong object - cannot pass by being consistently wrong.

import { build } from "esbuild";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { seedRowsFor } from "../tools/lib/seed-rows.mjs";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const run = promisify(execFile);
const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

console.log(renderSection("Baked server stats (the Edge Function's precomputed rating context)"));

const dir = await mkdtemp(path.join(tmpdir(), "bk-baked-"));
const outfile = path.join(dir, "sports.mjs");
await build({
  entryPoints: ["supabase/functions/simulate-match/sports/index.ts"],
  bundle: true,
  platform: "neutral",
  format: "esm",
  outfile,
  logLevel: "silent",
});
const registry = await import(pathToFileURL(outfile).href);

// ---- is it current? --------------------------------------------------------
let bakeOk = true;
let bakeDetail = "";
try {
  const { stdout } = await run("node", ["tools/bake-server-stats.mjs", "--check"]);
  bakeDetail = stdout.trim().split("\n").filter(Boolean).slice(0, 3).join("; ");
} catch (error) {
  bakeOk = false;
  bakeDetail = String(error.stdout || error.message).trim().split("\n").slice(-3).join(" ");
}
check("The committed stats are what today's dataset bakes to", bakeOk, bakeDetail);

// ---- is it right? ----------------------------------------------------------
//
// The comparison is on the SERIALISED form, because that is what ships and
// what the server reads back. A structural walk would let a value that
// survives in memory but not through JSON pass - and the file is JSON in a
// module wrapper.
const stable = (value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v
  );

/** The first key whose value differs, so a failure names a place rather than
 * announcing that two 460KB strings are not equal. */
function firstDifference(a, b) {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort();
  for (const key of keys) {
    if (stable(a?.[key]) !== stable(b?.[key])) {
      const left = stable(a?.[key]) ?? "(absent)";
      const right = stable(b?.[key]) ?? "(absent)";
      return `${key}: baked ${left.slice(0, 60)}… vs computed ${right.slice(0, 60)}…`;
    }
  }
  return null;
}

for (const sportId of registry.supportedSports()) {
  const engine = registry.engineFor(sportId);
  const label = sportId.toUpperCase();

  const baked = engine.baked;
  check(
    `${label}: the function ships a baked context at all`,
    !!baked?.stats && Number.isFinite(baked.rowCount) && typeof baked.datasetVersion === "string",
    baked ? `${baked.rowCount} rows, "${baked.datasetVersion}"` : "no baked stats on the engine"
  );
  if (!baked?.stats) continue;

  const rows = await seedRowsFor(sportId);
  const live = engine.computeDatasetStats(rows);
  // The server drops these too - the browser's draft-grade curve wants every
  // entry, the server never reads one back, and on football they are 4.8MB.
  delete live.__allEntries;

  check(
    `${label}: the baked row count is the seed's row count`,
    baked.rowCount === rows.length,
    `baked ${baked.rowCount}, seed writes ${rows.length}`
  );
  check(
    `${label}: the baked dataset version is the one a live read would stamp`,
    baked.datasetVersion === engine.datasetVersion(rows),
    `baked "${baked.datasetVersion}", live "${engine.datasetVersion(rows)}"`
  );

  const difference = firstDifference(baked.stats, live);
  check(
    `${label}: every value in the baked context matches a live computation`,
    difference === null,
    difference ?? `${Object.keys(live).length} keys identical ` +
      `(${(Buffer.byteLength(stable(live)) / 1024).toFixed(0)}KB)`
  );

  // The saving, stated rather than assumed - and it is the reason the whole
  // arrangement exists, so it belongs in the output a person reads.
  const readBytes = Buffer.byteLength(JSON.stringify(rows));
  const bakedBytes = Buffer.byteLength(stable(baked.stats));
  check(
    `${label}: baking is worth doing (the read it replaces is far bigger)`,
    bakedBytes < readBytes / 2,
    `a full read is ${(readBytes / 1048576).toFixed(2)}MB, the baked context is ` +
      `${(bakedBytes / 1024).toFixed(0)}KB - ${(readBytes / bakedBytes).toFixed(0)}x smaller`
  );

  // __allEntries is the single biggest thing baking removes, and it is removed
  // because the server never reads it. If it ever reappears in the baked file
  // the saving quietly evaporates and nothing else would notice.
  check(
    `${label}: the baked context does not carry the browser's entry list`,
    !("__allEntries" in baked.stats),
    "__allEntries" in baked.stats ? "__allEntries is in the baked file" : "absent, as intended"
  );
}

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
