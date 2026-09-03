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
// IT PLAYS BOTH SPORTS, AND UNTIL NOW IT PLAYED ONLY BASKETBALL. That gap is
// not a missing nicety; it is where football's bugs have been living, and the
// reason they reached players before they reached this file. The MVP callout
// crashed on `result.mvp.player.name` for a whole release and took the Play
// Again button down with it. The MVP was announced with a rebound and an
// assist total that do not exist in football. Two blank-screen bugs shipped
// past a green verify. Every one of those is a football post-game screen, and
// nothing here had ever rendered one.
//
// Football costs about five minutes to the basketball leg's two - twelve draft
// rounds instead of ten, and unit names typed a character at a time. That is
// the price of the gate covering the half of the app it was blind to. Run one
// sport with `--sport=nfl` while iterating; the default runs both, because a
// default that skips a sport is how this gap opened in the first place.
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


/** Which sports to drive, from `--sport=nfl` or `--sport=nba,nfl`.
 *
 * Both by default. SELFTEST_SPORT is honoured too, so the invocation that
 * already existed - `SELFTEST_SPORT=nfl npm run verify:selftest` - still
 * selects one sport rather than being silently overridden by the new default. */
function requestedSports() {
  const arg = process.argv.find((a) => a.startsWith("--sport="));
  const raw = arg ? arg.slice("--sport=".length) : process.env.SELFTEST_SPORT;
  const all = ["nba", "nfl"];
  if (!raw) return all;
  const want = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const chosen = all.filter((s) => want.includes(s));
  if (!chosen.length) {
    throw new Error(`--sport=${raw} names no live sport (choose from ${all.join(", ")})`);
  }
  return chosen;
}

async function main() {
  const port = Number(process.env.BK_SELFTEST_PORT || 8931);
  const server = await serveStatic(ROOT, port);
  const baseUrl = `http://127.0.0.1:${port}/`;
  const sports = requestedSports();
  console.log(renderSection("Browser harness self-test (local server, stubbed backend)"));
  console.log(`  serving ${ROOT} at ${baseUrl}`);
  console.log(`  sports: ${sports.join(", ")}`);

  const stub = await readFile(path.join(HERE, "supabase-stub.js"), "utf8");

  const checks = [];
  for (const sport of sports) {
    // A HEADING PER SPORT, because otherwise two runs of identically-named
    // checks scroll past and a reader cannot tell which sport failed - and
    // "which sport" is the entire question this file now answers.
    console.log(renderSection(`${sport.toUpperCase()} — a full offline match`));
    const sportChecks = await runBrowserChecks({
      baseUrl,
      sport,
      mode: "offline",
      // A DISTINCT ACCOUNT PER SPORT. The stub persists a profile, and two
      // legs sharing one account would have the second inherit the first's
      // history - which is the sort of cross-run coupling that makes a
      // failure depend on the order the sports were run in.
      accounts: [{ username: `SelfTest${sport.toUpperCase()}`, password: "selftest-password" }],
      artifactDir: path.join(ROOT, "verify-artifacts", "selftest", sport),
      headless: !process.argv.includes("--headed"),
      device: process.argv.includes("--mobile") ? "iPhone 13" : null,
      // Football legitimately needs more wall clock than basketball: twelve
      // draft rounds against ten, and names like "Cleveland Browns Offensive
      // Line" typed a character at a time. A single budget generous enough for
      // football would stop being a hang guard for basketball.
      budgetMs: sport === "nfl" ? 420000 : 180000,
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
    // The check ids repeat across sports, so the sport goes in the id as well
    // as the heading - a summary that lists "browser:mvp-callout" twice is
    // ambiguous about which one failed.
    for (const c of sportChecks) {
      const tagged = { ...c, id: `${sport}:${c.id}` };
      checks.push(tagged);
      console.log(renderCheck(tagged));
    }
  }

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
