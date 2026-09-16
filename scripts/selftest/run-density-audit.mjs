#!/usr/bin/env node
// The density audit: how much of the GAME a player can see at once.
// `npm run audit:density`.
//
// WHY THIS IS NOT THE MOBILE BASELINE
//
// baseline:mobile answers "is this readable and reachable on a phone" - tap
// targets, type sizes, overflow. It is the right report for a redesign and the
// wrong one for the complaint this exists to measure: the app reads as ZOOMED
// IN. Nothing is broken, nothing overlaps, every target is reachable, and a
// laptop still shows a header, a banner and a strip of chips before it shows
// the thing you are on the screen to do.
//
// So this measures the one number that complaint is about: what share of the
// viewport the ACTUAL GAME occupies, and how much furniture sits above it.
// For each screen at each size it records
//
//   chromePx        how far down the page the screen's own primary content
//                   starts - top nav plus anything before the first thing a
//                   player interacts with
//   primaryTop      where the screen's primary control sits, and whether it is
//                   above the fold at all
//   pages           document height in viewport-fuls; 1.0 is "fits"
//   visibleRows     how many roster slots are on screen at once
//
// It is a REPORT, not a gate - it exits 0 whatever it finds - and it runs the
// laptop sizes as well as the phones, because the laptop half of the complaint
// is the half nothing in this repo was measuring.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { chromium } from "playwright";

import { LAYOUT_AUDIT, TOUCH_AUDIT } from "../lib/browser-instrumentation.mjs";
import { driveDraft, loadSquadIndex, signIn, sleep } from "../lib/app-driver.mjs";
import { serveStatic } from "./static-server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/**
 * The sizes the complaint named, plus the two this suite already holds itself
 * to.
 *
 * The laptops are the point. 1366x768 is still the single most common desktop
 * resolution in the wild and 1536x864 is what a 1920 panel at 125% scaling
 * reports - which is most Windows laptops sold in the last five years. Both are
 * SHORTER than the 900-1080 a development monitor reports, and height is what a
 * density complaint is actually about.
 */
const VIEWPORTS = [
  { name: "desktop-1920", width: 1920, height: 1080, touch: false },
  { name: "laptop-1536", width: 1536, height: 864, touch: false },
  { name: "laptop-1440", width: 1440, height: 900, touch: false },
  { name: "laptop-1366", width: 1366, height: 768, touch: false },
  { name: "phone-430", width: 430, height: 932, touch: true },
  { name: "phone-390", width: 390, height: 844, touch: true },
  { name: "phone-375", width: 375, height: 667, touch: true },
];

/**
 * What counts as "the game" on each screen.
 *
 * `primary` is the one element a player is there to use - the search box on a
 * draft, the minutes grid on a rotation, the scoreboard in a game. Where it
 * sits, relative to the fold, IS the density number: everything above it is
 * furniture the screen spent before getting to the point.
 */
const PRIMARY = {
  play: "#mode-toggle",
  "draft-open": "#pool-search",
  "draft-mid": "#pool-search",
  rotation: "#rotation-grid",
  matchups: "#matchup-grid",
  gameplan: "#tactic-grid",
  "game-live": "#scoreboard, .scoreboard, #game-stage",
  "game-final": "#final-box, #btn-play-again",
};

function measureIn(primarySelector) {
  const vh = window.innerHeight;
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { top: Math.round(r.top + window.scrollY), height: Math.round(r.height) };
  };
  const primary = primarySelector ? box(primarySelector) : null;
  const rows = [...document.querySelectorAll(".roster-slot")];
  const visibleRows = rows.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= vh;
  }).length;
  return {
    viewportH: vh,
    docH: Math.round(document.documentElement.scrollHeight),
    pages: Number((document.documentElement.scrollHeight / vh).toFixed(2)),
    navH: box(".top-nav")?.height ?? null,
    bannerH: box("#squad-banner")?.height ?? null,
    positionsH: box("#position-selector")?.height ?? null,
    gradeH: box("#draft-grade:not(.hidden)")?.height ?? null,
    primaryTop: primary ? primary.top : null,
    primaryVisible: primary ? primary.top < vh : null,
    rosterRows: rows.length,
    visibleRows,
  };
}

async function capture(page, shotDir, sportId, screen, vp, rows) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(140);
  await page.evaluate(() => window.scrollTo(0, 0));

  const m = await page.evaluate(measureIn, PRIMARY[screen] || null).catch((e) => {
    console.error(`  measure failed on ${screen}: ${e.message}`);
    return null;
  });
  const layout = await page.evaluate(LAYOUT_AUDIT).catch(() => null);
  const touch = vp.touch ? await page.evaluate(TOUCH_AUDIT).catch(() => null) : null;

  const file = path.join(shotDir, `${sportId}-${screen}--${vp.name}.png`);
  await page.screenshot({ path: file }).catch(() => {});

  rows.push({
    screen: `${sportId}-${screen}`,
    viewport: vp.name,
    width: vp.width,
    height: vp.height,
    ...(m || {}),
    hOverflowPx: layout?.documentOverflowPx ?? null,
    escaping: layout?.escapingCount ?? null,
    overlaps: layout?.overlapCount ?? null,
    smallTargets: touch?.smallTargetCount ?? null,
    tinyText: touch?.tinyTextCount ?? null,
    shot: path.relative(ROOT, file),
  });
}

async function captureAll(page, shotDir, sportId, screen, rows, log) {
  const before = rows.length;
  for (const vp of VIEWPORTS) await capture(page, shotDir, sportId, screen, vp, rows);
  for (const r of rows.slice(before)) {
    log(
      `    ${r.screen} @ ${r.viewport}: ${r.pages} pages, primary at ${r.primaryTop}px ` +
        `(${r.primaryVisible ? "above" : "BELOW"} fold), ${r.visibleRows}/${r.rosterRows} roster rows visible`
    );
  }
}

const shown = (page, id) =>
  page.locator(`#${id}:not(.hidden)`).waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);

async function openSport(page, sportId, log) {
  await page.locator("#nav-play").click().catch(() => {});
  const card = page.locator(`.sport-card[data-sport="${sportId}"] .sport-card-open`);
  if (!(await card.isVisible().catch(() => false))) {
    await page.locator("#btn-back-home, #nav-play").first().click().catch(() => {});
    await sleep(300);
  }
  await card.click({ timeout: 10000 }).catch(() => {});
  const ok = await shown(page, "screen-play");
  log(`  ${sportId}: play screen ${ok ? "open" : "NOT reached"}`);
  return ok;
}

/** Which strategy panel is open right now, or "game" once it has started. */
const PANELS = [
  { name: "rotation", panel: "#rotation-phase", confirm: "#btn-confirm-rotation" },
  { name: "matchups", panel: "#matchup-phase", confirm: "#btn-confirm-matchups" },
  { name: "gameplan", panel: "#tactic-phase", confirm: "#btn-play-game" },
];

/** Walks the strategy phases, PHOTOGRAPHING each before confirming it. This is
 * why the shared driveStrategyPhases is not used: it confirms as fast as it
 * can, and the screens this audit is about only exist in between. */
async function walkStrategy(page, shotDir, sportId, rows, log, deadline) {
  const seen = new Set();
  let idle = 0;
  while (Date.now() < deadline && idle < 20) {
    const open = await page
      .evaluate((panels) => {
        if (!document.querySelector("#screen-game")?.classList.contains("hidden")) return "game";
        for (const p of panels) {
          const el = document.querySelector(p.panel);
          if (el && !el.classList.contains("hidden")) return p.name;
        }
        return null;
      }, PANELS.map(({ name, panel }) => ({ name, panel })))
      .catch(() => null);

    if (open === "game") return;
    if (!open) {
      idle += 1;
      await sleep(250);
      continue;
    }
    idle = 0;
    if (!seen.has(open)) {
      seen.add(open);
      await captureAll(page, shotDir, sportId, open, rows, log);
    }
    const phase = PANELS.find((p) => p.name === open);
    if (phase.name === "gameplan") {
      await page.locator("#tactic-grid .tactic-card, #tactic-grid button").first().click().catch(() => {});
    }
    await page.locator(phase.confirm).click({ timeout: 10000 }).catch(() => {});
    await sleep(500);
  }
}

function requestedSports() {
  const arg = process.argv.find((a) => a.startsWith("--sport="));
  const all = ["nba", "nfl"];
  if (!arg) return all;
  const want = arg.slice("--sport=".length).split(",").map((n) => n.trim());
  return all.filter((s) => want.includes(s));
}

/** `--label=before` keeps two runs apart, which is the whole point of running
 * this twice. Without it the second run overwrites the evidence for the first.
 *
 * THE SPORTS ARE PART OF THE NAME TOO, and leaving them out cost a run. Two
 * invocations of `--label=v2-final`, one per sport, wrote the same
 * `v2-final.json` in the same commit's directory, and the football leg silently
 * replaced the basketball one - a report that says 42 rows where 91 were
 * measured, which is exactly the kind of quietly-wrong evidence this whole tool
 * exists to replace. The sports it actually drove go in the filename. */
function runLabel() {
  const arg = process.argv.find((a) => a.startsWith("--label="));
  const label = arg ? arg.slice("--label=".length) : "run";
  return `${label}-${requestedSports().join("-")}`;
}

async function main() {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
  const stamp = `${new Date().toISOString().slice(0, 10)}-${sha}`;
  const label = runLabel();

  const shotDir = path.join(ROOT, "verify-artifacts", "density", `${stamp}-${label}`);
  const outDir = path.join(ROOT, "docs", "audits", `${stamp}-density`);
  await mkdir(shotDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const port = Number(process.env.BK_DENSITY_PORT || 8936);
  const server = await serveStatic(ROOT, port);
  const baseUrl = `http://127.0.0.1:${port}/`;
  const stub = await readFile(path.join(HERE, "supabase-stub.js"), "utf8");

  const lines = [];
  const log = (m) => {
    console.log(m);
    lines.push(m);
  };
  log(`Density audit (${label}) — serving ${ROOT} at ${baseUrl}`);

  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const rows = [];

  try {
    for (const sportId of requestedSports()) {
      log(`\n${sportId.toUpperCase()}`);
      // A DESKTOP CONTEXT, resized down to the phone sizes rather than an
      // emulated phone. The laptop half of this audit needs hover and a fine
      // pointer to be honest about what a laptop shows; running it twice, once
      // per context, doubles a twenty-minute drive to measure the same CSS.
      // The phone rows here are therefore about LAYOUT, not about touch
      // affordances - baseline:mobile owns those.
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      await context.route("**/esm.sh/**", (route) =>
        route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: stub })
      );
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await signIn(page, { username: `Density${sportId.toUpperCase()}`, password: "density-password" }, log);
      await shown(page, "screen-home");

      if (!(await openSport(page, sportId, log))) {
        await context.close();
        continue;
      }
      await captureAll(page, shotDir, sportId, "play", rows, log);

      const squadIndex = await loadSquadIndex(sportId);
      await page.locator("#btn-start-draft").click({ timeout: 10000 }).catch(() => {});
      if (await page.locator("#pool-search").isVisible().catch(() => false)) {
        await captureAll(page, shotDir, sportId, "draft-open", rows, log);
      }

      const deadline = Date.now() + 900000;
      // Half the rounds, then a photograph, then the rest: an empty board and a
      // half-full one are different screens and the half-full one is the one a
      // player looks at for most of a draft.
      // A DELIBERATELY SHORT BUDGET, not a bug: driveDraft runs to the end of
      // the draft, and the half-full board only exists while it is still going.
      // The throw is the signal to stop and photograph.
      await driveDraft(page, squadIndex, `${sportId}-first-half`, log, Date.now() + 45000).catch(() => 0);
      if (await page.locator("#pool-search").isVisible().catch(() => false)) {
        await captureAll(page, shotDir, sportId, "draft-mid", rows, log);
      }
      await driveDraft(page, squadIndex, sportId, log, deadline).catch((e) => {
        log(`  draft did not complete: ${e.message}`);
        return 0;
      });

      await walkStrategy(page, shotDir, sportId, rows, log, deadline);

      if (await shown(page, "screen-game")) {
        await captureAll(page, shotDir, sportId, "game-live", rows, log);
        await page
          .locator("#final-box, #btn-play-again")
          .first()
          .waitFor({ state: "visible", timeout: 240000 })
          .catch(() => {});
        await captureAll(page, shotDir, sportId, "game-final", rows, log);
      }

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  await writeFile(path.join(outDir, `${label}.md`), renderReport(rows, lines, stamp, label), "utf8");
  await writeFile(path.join(outDir, `${label}.json`), JSON.stringify(rows, null, 2), "utf8");
  console.log(`\n  ${rows.length} captures — report: ${path.relative(ROOT, path.join(outDir, `${label}.md`))}\n`);
}

function renderReport(rows, lines, stamp, label) {
  const out = [];
  out.push(`# Density audit — ${stamp} (${label})`);
  out.push("");
  out.push("Captured by `npm run audit:density`. `pages` is document height in viewport-fuls:");
  out.push("1.00 means the screen fits. `primary` is where the thing you are on the screen to");
  out.push("use starts, in pixels from the top of the document.");
  out.push("");
  out.push("| screen | viewport | pages | nav | banner | tabs | primary | above fold | roster rows visible | h-overflow |");
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    out.push(
      `| ${r.screen} | ${r.viewport} | ${r.pages} | ${r.navH ?? "-"} | ${r.bannerH ?? "-"} | ` +
        `${r.positionsH ?? "-"} | ${r.primaryTop ?? "-"} | ${r.primaryVisible === null ? "-" : r.primaryVisible ? "yes" : "NO"} | ` +
        `${r.visibleRows}/${r.rosterRows} | ${r.hOverflowPx}px |`
    );
  }
  out.push("");
  out.push("## Run log");
  out.push("");
  out.push("```");
  out.push(...lines);
  out.push("```");
  return out.join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
