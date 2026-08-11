#!/usr/bin/env node
// Build verification harness - `npm run verify`.
//
// Two independent legs, either of which can run alone:
//
//   parity  - offline (client) engine vs online (Edge Function) engine.
//             Pure Node, no browser, no network needed for the engine checks.
//   browser - a real Chromium driving a real match on a real site, measuring
//             paint and frame timings and watching the console.
//
// Exits 0 when every check passed or was skipped, 1 when any check failed.
// Writes a machine-readable report (verify-report.json by default) that CI can
// assert on without parsing console output.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PASS, FAIL, WARN, SKIP, check, renderCheck, renderSection, renderTable, summarize, formatMs } from "./lib/report.mjs";
import { runParityChecks } from "./verify-parity.mjs";
import { runBrowserChecks, DEFAULT_BASE_URL } from "./verify-browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// The whole run has to fit inside 5 minutes. The browser leg gets the bulk of
// it because it is the one waiting on a network and a live opponent; parity is
// CPU-bound and finishes in well under a second.
const TOTAL_BUDGET_MS = 5 * 60 * 1000;
const BROWSER_BUDGET_MS = 4 * 60 * 1000;

function parseArgs(argv) {
  const args = {
    parity: true,
    browser: true,
    network: true,
    mode: "offline",
    baseUrl: process.env.BK_BASE_URL || DEFAULT_BASE_URL,
    json: path.join(ROOT, "verify-report.json"),
    artifactDir: path.join(ROOT, "verify-artifacts"),
    headless: true,
    device: null,
  };
  for (const arg of argv) {
    if (arg === "--no-parity") args.parity = false;
    else if (arg === "--no-browser") args.browser = false;
    else if (arg === "--no-network") { args.network = false; args.browser = false; }
    else if (arg === "--online") args.mode = "online";
    else if (arg === "--offline") args.mode = "offline";
    else if (arg === "--headed") args.headless = false;
    else if (arg === "--mobile") args.device = "iPhone 13";
    else if (arg.startsWith("--device=")) args.device = arg.slice("--device=".length);
    else if (arg.startsWith("--base-url=")) args.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--json=")) args.json = path.resolve(arg.slice("--json=".length));
    else if (arg.startsWith("--artifacts=")) args.artifactDir = path.resolve(arg.slice("--artifacts=".length));
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

const HELP = `
Usage: npm run verify [-- <options>]

  --online          Run the browser leg as a real online ranked match. Needs
                    BK_USER_A/BK_PASS_A and BK_USER_B/BK_PASS_B. Creates a
                    REAL ranked result on the live database - throwaway
                    accounts only.
  --offline         Run the browser leg as Ranked Practice vs the bot
                    (default). Needs BK_USER_A/BK_PASS_A.
  --no-browser      Engine parity only.
  --no-parity       Browser only.
  --no-network      Everything that works with no network at all.
  --mobile          Run the browser leg as a real emulated iPhone 13 (touch
                    events, mobile user agent, device pixel ratio) rather
                    than a narrowed desktop window.
  --device=NAME     Any Playwright device, e.g. --device="Pixel 7".
  --base-url=URL    Site under test (default ${DEFAULT_BASE_URL}).
  --json=PATH       Where to write the JSON report.
  --artifacts=DIR   Where screenshots/video land on failure.
  --headed          Show the browser.

Environment:
  BK_USER_A / BK_PASS_A     first account
  BK_USER_B / BK_PASS_B     second account (online mode)
  BK_VERBOSE=1              stream per-pick draft progress
`;

function accountsFromEnv() {
  const out = [];
  if (process.env.BK_USER_A && process.env.BK_PASS_A) {
    out.push({ username: process.env.BK_USER_A, password: process.env.BK_PASS_A });
  }
  if (process.env.BK_USER_B && process.env.BK_PASS_B) {
    out.push({ username: process.env.BK_USER_B, password: process.env.BK_PASS_B });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  const startedAt = Date.now();
  const sections = [];

  console.log(renderSection("Draft Nova - build verification"));
  console.log(`  site:   ${args.baseUrl}`);
  console.log(`  mode:   ${args.mode}${args.browser ? "" : " (browser leg disabled)"}`);
  console.log(`  budget: ${formatMs(TOTAL_BUDGET_MS)}`);

  if (args.parity) {
    const checks = await runParityChecks({ network: args.network });
    sections.push({ name: "Engine parity (offline client vs online Edge Function)", checks });
  }

  if (args.browser) {
    const elapsed = Date.now() - startedAt;
    const budgetMs = Math.min(BROWSER_BUDGET_MS, TOTAL_BUDGET_MS - elapsed - 5000);
    const checks =
      budgetMs <= 10000
        ? [check("browser:run", "Real-browser match completes", SKIP, { detail: "No time left in the 5-minute budget." })]
        : await runBrowserChecks({
            baseUrl: args.baseUrl,
            mode: args.mode,
            accounts: accountsFromEnv(),
            artifactDir: args.artifactDir,
            headless: args.headless,
            budgetMs,
            device: args.device,
          });
    sections.push({ name: `Live site (${args.mode}${args.device ? `, ${args.device}` : ""})`, checks });
  }

  const all = sections.flatMap((s) => s.checks);
  const { counts, ok } = summarize(all);
  const durationMs = Date.now() - startedAt;

  for (const section of sections) {
    console.log(renderSection(section.name));
    for (const c of section.checks) console.log(renderCheck(c));
  }

  console.log(renderSection("Summary"));
  console.log(
    renderTable(
      [
        ["result", "count"],
        ["passed", String(counts[PASS])],
        ["failed", String(counts[FAIL])],
        ["warnings", String(counts[WARN])],
        ["skipped", String(counts[SKIP])],
      ]
    )
      .split("\n")
      .map((l) => "  " + l)
      .join("\n")
  );
  console.log(`\n  ran in ${formatMs(durationMs)}${durationMs > TOTAL_BUDGET_MS ? "  (OVER the 5-minute budget)" : ""}`);

  const report = {
    schema: "ball-knowledge/verify-report@1",
    ok,
    startedAt: new Date(startedAt).toISOString(),
    durationMs,
    withinBudget: durationMs <= TOTAL_BUDGET_MS,
    site: args.baseUrl,
    mode: args.mode,
    counts,
    sections: sections.map((s) => ({
      name: s.name,
      checks: s.checks.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        durationMs: c.durationMs ?? null,
        detail: c.detail ?? null,
        table: c.table ?? null,
        evidence: c.evidence ?? null,
        artifacts: c.artifacts ?? null,
      })),
    })),
  };

  await mkdir(path.dirname(args.json), { recursive: true });
  await writeFile(args.json, JSON.stringify(report, null, 2));
  console.log(`  report: ${path.relative(ROOT, args.json)}`);

  console.log(
    ok
      ? "\n  \x1b[32mVERIFICATION PASSED\x1b[0m\n"
      : "\n  \x1b[31mVERIFICATION FAILED\x1b[0m\n"
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("\n  verification harness crashed:", e?.stack || e);
  process.exit(1);
});
