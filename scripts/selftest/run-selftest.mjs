#!/usr/bin/env node
// Self-test for the browser harness: `npm run verify:selftest`.
//
// The harness is verification code, so it needs verifying too - a broken
// selector or a mis-timed wait would make `npm run verify` report a green
// build it never actually drove. This serves the repo on localhost, swaps the
// Supabase CDN module for a stub (scripts/selftest/supabase-stub.js), and runs
// the same runBrowserChecks() the real harness runs, in offline mode.
//
// What it proves: the automation drives a real match to a real final score in
// a real browser - sign-in, mode select, a full ranked draft, rotation,
// matchups, gamestyle, the animated simulation - and that the frame sampler,
// layout audit and console watcher all produce readings.
//
// What it does NOT prove: anything about the live site, matchmaking, or the
// simulate-match Edge Function. Those need `npm run verify -- --online`.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderCheck, renderSection, summarize, PASS, FAIL, SKIP, WARN } from "../lib/report.mjs";
import { runBrowserChecks } from "../verify-browser.mjs";
import { serveStatic } from "./static-server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");


async function main() {
  const port = Number(process.env.BK_SELFTEST_PORT || 8931);
  const server = await serveStatic(ROOT, port);
  const baseUrl = `http://127.0.0.1:${port}/`;
  console.log(renderSection("Browser harness self-test (local server, stubbed backend)"));
  console.log(`  serving ${ROOT} at ${baseUrl}`);

  const stub = await readFile(path.join(HERE, "supabase-stub.js"), "utf8");

  const checks = await runBrowserChecks({
    baseUrl,
    mode: "offline",
    accounts: [{ username: "SelfTest", password: "selftest-password" }],
    artifactDir: path.join(ROOT, "verify-artifacts", "selftest"),
    headless: !process.argv.includes("--headed"),
    device: process.argv.includes("--mobile") ? "iPhone 13" : null,
    budgetMs: 180000,
    // Serve the stub in place of the CDN module the import map points at, so
    // the app boots with a session and every backend call resolves.
    routes: [
      {
        pattern: "**/esm.sh/**",
        body: stub,
        contentType: "text/javascript; charset=utf-8",
      },
    ],
  });

  for (const c of checks) console.log(renderCheck(c));
  const { counts, ok } = summarize(checks);
  console.log(
    `\n  passed ${counts[PASS]}  failed ${counts[FAIL]}  warnings ${counts[WARN]}  skipped ${counts[SKIP]}\n`
  );

  server.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
