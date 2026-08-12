#!/usr/bin/env node
// Startup cost, MEASURED - and measured the same way every time.
//
// WHY THIS EXISTS
//
// "The app feels slow to boot" is not something you can fix, because you
// cannot tell whether you fixed it. #21 asks for repeatable measurements
// rather than tuning by feel, so this is the measurement, and it runs in the
// verify chain as a BUDGET: the numbers are asserted, not just printed, which
// is what stops the cost creeping back a hundred kilobytes at a time.
//
// WHAT IT FOUND
//
// The sport registry imports every sport eagerly, and each sport imports its
// dataset at module scope. So opening the app to play basketball also fetched,
// parsed and evaluated 4.2MB of football data - two files that a basketball
// player will never look at. The budget below is what holds that closed.
//
// The transfer figures are of UNCOMPRESSED bytes over a local server. GitHub
// Pages serves gzip, so the real-world numbers are smaller - but the ratio
// between "what we load" and "what we need" is the same either way, and that
// ratio is what this is measuring.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderCheck, renderSection, renderTable, summarize, PASS, FAIL } from "./lib/report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = Number(process.env.BK_STARTUP_PORT || 8939);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** Every file the browser actually asked for, with its size. */
const served = [];

function serve(root, port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/" || rel.endsWith("/")) rel += "index.html";
      const file = path.join(root, rel);
      if (!file.startsWith(root)) return res.writeHead(403).end("forbidden");
      const body = await readFile(file);
      served.push({ path: rel, bytes: body.length });
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

/** Datasets, which are the only files big enough to matter here. */
const isNflData = (p) => /\/data\/nfl-/.test(p);
const isNbaData = (p) => /\/data\/nba-/.test(p);
const kb = (bytes) => `${(bytes / 1024).toFixed(0)}KB`;
const sumBytes = (rows) => rows.reduce((t, r) => t + r.bytes, 0);

async function main() {
  const { chromium } = await import("playwright");
  const server = await serve(ROOT, PORT);
  const baseUrl = `http://127.0.0.1:${PORT}/`;
  console.log(renderSection("Startup performance (real Chromium, cold cache)"));

  const stub = await readFile(path.join(HERE, "selftest", "supabase-stub.js"), "utf8");
  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const checks = [];

  try {
    const context = await browser.newContext();
    await context.route("**/esm.sh/**", (route) =>
      route.fulfill({ status: 200, body: stub, contentType: "text/javascript; charset=utf-8" })
    );
    const page = await context.newPage();

    // ---- boot -------------------------------------------------------------
    const bootStart = Date.now();
    await page.goto(baseUrl, { waitUntil: "load" });
    // Interactive means the app has decided what to show, not merely that the
    // HTML parsed - a boot that paints an empty shell is not a boot.
    await page.locator("#screen-auth:not(.hidden), #screen-home:not(.hidden)")
      .first().waitFor({ state: "visible", timeout: 30000 });
    const interactiveMs = Date.now() - bootStart;

    const nav = await page.evaluate(() => {
      const [entry] = performance.getEntriesByType("navigation");
      return entry
        ? { domContentLoaded: entry.domContentLoadedEventEnd, load: entry.loadEventEnd }
        : { domContentLoaded: 0, load: 0 };
    });

    const bootFiles = [...served];
    const nflOnBoot = bootFiles.filter((f) => isNflData(f.path));
    const nbaOnBoot = bootFiles.filter((f) => isNbaData(f.path));
    const bootBytes = sumBytes(bootFiles);

    console.log(
      renderTable([
        ["metric", "value"],
        ["time to interactive", `${interactiveMs}ms`],
        ["DOMContentLoaded", `${Math.round(nav.domContentLoaded)}ms`],
        ["load", `${Math.round(nav.load)}ms`],
        ["bytes on boot", kb(bootBytes)],
        ["NBA data on boot", nbaOnBoot.length ? kb(sumBytes(nbaOnBoot)) : "none"],
        ["NFL data on boot", nflOnBoot.length ? kb(sumBytes(nflOnBoot)) : "none"],
      ])
    );

    checks.push({
      // THE POINT OF THE WHOLE EXERCISE. A basketball player must not pay for
      // football's dataset, which is larger than everything else on the page
      // put together.
      title: "Football's dataset is not loaded to open the app",
      ok: nflOnBoot.length === 0,
      detail: nflOnBoot.length
        ? `${kb(sumBytes(nflOnBoot))} of NFL data fetched on boot: ${nflOnBoot.map((f) => f.path).join(" ")}`
        : "no NFL data fetched before a sport was chosen",
    });
    checks.push({
      // 3.5MB, not a round number picked to pass. The default sport's dataset
      // is the floor: the hub opens on basketball, so basketball's 2.3MB is
      // genuinely needed to boot, and the remaining ~850KB is the app itself.
      // Deferring that too would mean the hub no longer defaults to a sport,
      // which is a product decision rather than a performance one - noted as
      // the next move rather than done quietly here.
      title: "Boot payload stays under 3.5MB",
      ok: bootBytes < 3.5 * 1024 * 1024,
      detail: `${kb(bootBytes)} across ${bootFiles.length} files (basketball's dataset is ${kb(sumBytes(nbaOnBoot))} of it)`,
    });
    checks.push({
      title: "The app reaches an interactive screen inside 10s",
      ok: interactiveMs < 10000,
      detail: `${interactiveMs}ms`,
    });

    // ---- choosing football -------------------------------------------------
    // Sign in far enough to reach the sport hub, then pick football and time
    // how long its data takes to arrive.
    const home = page.locator("#screen-home:not(.hidden)");
    if (!(await home.isVisible().catch(() => false))) {
      await page.locator("#input-auth-identifier").fill("StartupPerfTest");
      await page.locator("#input-auth-password").fill("startup-perf-password");
      await page.locator("#btn-auth-submit").click();
      await home.waitFor({ state: "visible", timeout: 30000 });
    }

    const beforeNfl = served.length;
    const pickStart = Date.now();
    await page.locator('[data-sport="nfl"]').first().click();
    await page.locator('#mode-toggle [data-mode="practice-easy"]').waitFor({ state: "visible", timeout: 30000 });
    // READY means the data has landed, not that a toggle painted. The mode
    // toggle appears in ~70ms while 4.2MB is still in flight, so measuring
    // there timed the button rather than the load - and found no data fetched
    // because none had arrived yet. Start Draft stays disabled and says
    // "Loading NFL…" until the dataset is in memory, which is the real signal.
    await page.locator("#btn-start-draft:not([disabled])").waitFor({ state: "visible", timeout: 60000 });
    const pickMs = Date.now() - pickStart;
    const afterPick = served.slice(beforeNfl);
    const nflAfterPick = afterPick.filter((f) => isNflData(f.path));

    checks.push({
      title: "Choosing football loads football's data",
      ok: nflAfterPick.length > 0,
      detail: nflAfterPick.length
        ? `${kb(sumBytes(nflAfterPick))} fetched on selection, ready in ${pickMs}ms`
        : "no NFL data fetched even after selecting football",
    });
    checks.push({
      title: "Football is ready to play within 8s of being chosen",
      ok: pickMs < 8000,
      detail: `${pickMs}ms from click to mode toggle`,
    });

    // The draft is the first thing that genuinely needs every row.
    const draftStart = Date.now();
    await page.locator("#btn-start-draft").click();
    const reachedDraft = await page.locator("#screen-draft:not(.hidden)")
      .waitFor({ state: "visible", timeout: 60000 }).then(() => true).catch(() => false);
    const draftMs = Date.now() - draftStart;
    const poolPainted = await page.locator("#pool-list .player-card").first()
      .waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false);

    checks.push({
      title: "The first football draft board renders",
      ok: reachedDraft && poolPainted,
      detail: reachedDraft ? `draft screen in ${draftMs}ms, pool painted: ${poolPainted}` : "draft never appeared",
    });

    // THE MOMENT THE DRAFT ENDS. The grade curve is built lazily on the first
    // graded roster, which is exactly when the last slot is filled - so its
    // cost lands as a frozen screen at the end of the draft rather than
    // anywhere a loading state would be expected. It was 9.2 seconds for
    // football and 1.4 for basketball, because the per-slot candidate pool was
    // being re-filtered inside the sampling loop: 240 samples x 11 slots x
    // 13,874 entries.
    //
    // Measured in the page, not in Node, because that is where the player
    // waits. A budget rather than a printout - the whole point of this file.
    const gradeMs = await page.evaluate(async () => {
      const { NFL } = await import("/js/sports/nfl/index.js");
      await NFL.preload();
      const ctx = NFL.computeDatasetStats();
      const rows = NFL.playersInEra(NFL.players(), NFL.defaultEra);
      const roster = {};
      for (const slot of NFL.slots.ranked) {
        const base = NFL.basePosition(slot);
        const hit = rows.find((p) => (p.pos || []).includes(base) || (p.group || "") === base);
        if (hit) roster[slot] = hit;
      }
      const t0 = performance.now();
      NFL.gradeDraft(roster, ctx, { oppRoster: roster, forfeits: [] });
      return Math.round(performance.now() - t0);
    }).catch(() => null);

    checks.push({
      title: "Grading the first finished football roster is not a freeze (< 1.5s)",
      ok: gradeMs != null && gradeMs < 1500,
      detail: gradeMs == null ? "could not be measured" : `${gradeMs}ms to build the curve and grade`,
    });

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }

  const report = checks.map((c) => ({ title: c.title, status: c.ok ? PASS : FAIL, detail: c.detail }));
  for (const c of report) console.log(renderCheck(c));
  const { counts, ok } = summarize(report);
  console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
