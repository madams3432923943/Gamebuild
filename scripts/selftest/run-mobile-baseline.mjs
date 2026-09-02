#!/usr/bin/env node
// The phone baseline: every screen, at every phone size, photographed and
// measured. `npm run baseline:mobile`.
//
// WHY THIS EXISTS SEPARATELY FROM verify-browser.mjs
//
// The verification harness drives the app to decide pass or fail. It audits
// layout at four widths and screenshots on failure, which is the right shape
// for a gate and the wrong shape for design work: a gate tells you the build
// is not broken, and says nothing about whether a screen is COMFORTABLE on a
// phone. This walks the same flow to produce evidence a person looks at -
// a screenshot per screen per width, plus the numbers that a screenshot
// cannot show.
//
// WHAT IT MEASURES beyond the layout audit
//
//   - tap targets under 44x44 CSS px, the floor both Apple and Google
//     publish, counted and named. A control that is merely small still
//     passes every overlap and overflow check the gate runs.
//   - text under 12px, which survives a layout audit perfectly and cannot be
//     read on a couch.
//   - how much of the screen the app can actually use once the browser's own
//     chrome is accounted for, which is what `dvh` is for and what a fixed
//     `vh` gets wrong.
//
// It is a REPORT, not a gate: it exits 0 whatever it finds. The numbers here
// become assertions later, once the redesign has decided what "good" is.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { execFileSync } from "node:child_process";

import { chromium, devices } from "playwright";

import { LAYOUT_AUDIT, TOUCH_AUDIT, TAP_TARGET_MIN, MIN_FONT_PX } from "../lib/browser-instrumentation.mjs";
import { driveDraft, driveStrategyPhases, loadSquadIndex, signIn, sleep } from "../lib/app-driver.mjs";
import { serveStatic } from "./static-server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/**
 * The phones this game is actually played on.
 *
 * 360 is the Android floor the suite already holds itself to. 390 is the
 * iPhone 12/13/14/15 body, far and away the most common single size. 430 is
 * the Pro Max, which matters because a wider phone is where a layout tuned
 * only at 360 starts to look empty rather than broken. Landscape is included
 * because a phone falls into it by accident, and because someone propping a
 * phone against the TV will choose it deliberately.
 */
const PHONES = [
  { name: "android-360", width: 360, height: 800 },
  { name: "iphone-390", width: 390, height: 844 },
  { name: "iphone-max-430", width: 430, height: 932 },
  { name: "landscape-844", width: 844, height: 390 },
];

/** One screen, at one size: screenshot plus both audits. */
async function capture(page, shotDir, screen, phone, notes = []) {
  await page.setViewportSize({ width: phone.width, height: phone.height });
  // Two frames, so a resize-driven relayout has actually landed before the
  // shutter. One is not enough - the first frame after a resize can still
  // carry the old geometry.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(120);

  const layout = await page.evaluate(LAYOUT_AUDIT).catch(() => null);
  const touch = await page.evaluate(TOUCH_AUDIT).catch(() => null);

  // VIEWPORT, NOT fullPage - and that is a correctness requirement, not a
  // framing choice.
  //
  // page.screenshot({fullPage: true}) permanently resets Chromium's device
  // emulation on that page: `matchMedia("(pointer: coarse)")` reports true
  // before the call and false after, and nothing restores it - not
  // setViewportSize, not a later screenshot. Every reading taken after the
  // first fullPage shot was therefore taken on a page that had stopped being
  // a phone. It reported the landscape bottom bar as missing when it was
  // present and correct, and would have sent the next person to fix CSS that
  // had nothing wrong with it. A viewport screenshot leaves emulation alone.
  //
  // Nothing is lost: `verticalScroll` below already records how far past one
  // screen each page runs, and what a player can see at once is the more
  // useful picture for a readability audit anyway.
  const file = path.join(shotDir, `${screen}--${phone.name}.png`);
  await page.screenshot({ path: file }).catch(() => {});

  return {
    screen,
    phone: phone.name,
    width: phone.width,
    height: phone.height,
    shot: path.relative(ROOT, file),
    overlaps: layout?.overlapCount ?? null,
    escaping: layout?.escapingCount ?? null,
    hOverflowPx: layout?.documentOverflowPx ?? null,
    worstLayout: [
      ...(layout?.escaping || []).slice(0, 3).map((e) => `escapes: ${e.el} (${e.left}..${e.right} vs ${e.viewport}px)`),
      ...(layout?.overlaps || []).slice(0, 3).map((o) => `overlaps: ${o.a} / ${o.b} by ${o.overlapPx}px`),
    ],
    smallTargetCount: touch?.smallTargetCount ?? null,
    smallTargets: touch?.smallTargets || [],
    tinyTextCount: touch?.tinyTextCount ?? null,
    tinyText: touch?.tinyText || [],
    verticalScroll: touch?.verticalScroll ?? null,
    notes,
  };
}

/** Every phone size for one screen, so a screen is captured once and measured
 * four times rather than driven to four times. */
async function captureAll(page, shotDir, screen, log, notes = []) {
  // `screen` is "<sport>-<NN>-<name>"; the filter names the <name> half.
  const only = requestedScreens();
  if (only && !only.has(screen.replace(/^[a-z]+-\d+-/, ""))) return [];
  const rows = [];
  for (const phone of PHONES) {
    const row = await capture(page, shotDir, screen, phone, notes);
    rows.push(row);
    log(
      `    ${screen} @ ${phone.name}: ` +
        `${row.smallTargetCount} small target(s), ${row.tinyTextCount} tiny text, ` +
        `${row.escaping} escaping, ${row.hOverflowPx}px h-overflow`
    );
  }
  return rows;
}

async function show(page, screenId) {
  const el = page.locator(`#${screenId}:not(.hidden)`);
  return el.waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
}

/** Signed in, on the hub, with `sportId` selected - the state every capture
 * run starts from. */
async function openSport(page, sportId, log) {
  await page.locator("#nav-play").click().catch(() => {});
  const card = page.locator(`.sport-card[data-sport="${sportId}"] .sport-card-open`);
  if (!(await card.isVisible().catch(() => false))) {
    // Already inside a sport: back out to the hub first.
    await page.locator("#btn-back-home, #nav-play").first().click().catch(() => {});
    await sleep(300);
  }
  await card.click({ timeout: 10000 }).catch(() => {});
  const ok = await show(page, "screen-play");
  log(`  ${sportId}: play screen ${ok ? "open" : "NOT reached"}`);
  return ok;
}

/**
 * Which screens to walk, from `--screens=hub,play,profile`.
 *
 * A full run drives two complete drafts and takes twenty-odd minutes, which
 * is the right cost for a baseline and a ridiculous one for confirming that
 * a rule you just changed did what you expected. Most changes touch a few
 * screens; this re-measures those and nothing else.
 *
 * Names match the screen labels without their sport prefix and index -
 * `hub`, `play`, `draft-empty`, `game-live`, `game-final`, `profile`,
 * `badges`, `squads`. Empty means everything, which is what a real baseline
 * wants.
 */
function requestedScreens() {
  const arg = process.argv.find((a) => a.startsWith("--screens="));
  if (!arg) return null;
  const names = arg.slice("--screens=".length).split(",").map((n) => n.trim()).filter(Boolean);
  return names.length ? new Set(names) : null;
}

/** The sports to walk, from `--sport=nba`. Both by default. */
function requestedSports() {
  const arg = process.argv.find((a) => a.startsWith("--sport="));
  const all = ["nba", "nfl"];
  if (!arg) return all;
  const want = arg.slice("--sport=".length).split(",").map((n) => n.trim());
  return all.filter((s) => want.includes(s));
}

/**
 * Whether this run needs to play a game at all.
 *
 * The screens behind a draft - the board, the live game, the box score - are
 * the ones that cost the twenty minutes, because reaching them means driving
 * ten or twelve rounds of picks in a real browser. Profile, rewards and
 * squads are one nav click from the hub and cost seconds.
 *
 * Filtering the CAPTURES alone saved nothing: the run still drove the whole
 * draft and then threw the screenshots away. This is what makes --screens
 * worth having.
 */
function needsDraft() {
  const only = requestedScreens();
  if (!only) return true;
  return ["draft-empty", "game-live", "game-final"].some((n) => only.has(n));
}

async function main() {
  // The commit, not just the date. Two runs on one day overwrote each other -
  // which is exactly what a BEFORE and an AFTER are - and a set of numbers
  // that does not say which build produced it cannot be compared to anything.
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT })
    .toString()
    .trim();
  const stamp = `${new Date().toISOString().slice(0, 10)}-${sha}`;

  // The screenshots and the report go to DIFFERENT places on purpose.
  //
  // 56 full-page captures at a phone's device pixel ratio is ~55MB, and this
  // repo is served to the web from its own root - committing them would put
  // them in every clone, every diff and the live site, permanently, to say
  // what one command regenerates. They go to verify-artifacts/, which is
  // already gitignored for exactly this.
  //
  // The report and its numbers are text, they are the part worth keeping, and
  // they are what a future run gets compared against. Those are committed.
  const shotDir = path.join(ROOT, "verify-artifacts", "mobile-baseline", stamp);
  const outDir = path.join(ROOT, "docs", "audits", `${stamp}-mobile-baseline`);
  await mkdir(shotDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const port = Number(process.env.BK_BASELINE_PORT || 8934);
  const server = await serveStatic(ROOT, port);
  const baseUrl = `http://127.0.0.1:${port}/`;
  const stub = await readFile(path.join(HERE, "supabase-stub.js"), "utf8");

  const lines = [];
  const log = (m) => {
    console.log(m);
    lines.push(m);
  };

  log(`Mobile baseline — serving ${ROOT} at ${baseUrl}`);
  log(`Writing to ${path.relative(ROOT, outDir)}`);

  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const rows = [];

  try {
    for (const sportId of requestedSports()) {
      log(`\n${sportId.toUpperCase()}`);

      // A real phone context - touch, a mobile user agent, a device pixel
      // ratio - rather than a desktop browser resized. Hover-only affordances
      // and :active styling behave differently under the two, and this run is
      // about what a phone shows.
      const context = await browser.newContext({
        ...devices["iPhone 13"],
        viewport: { width: PHONES[1].width, height: PHONES[1].height },
      });
      await context.route("**/esm.sh/**", (route) =>
        route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: stub })
      );
      const page = await context.newPage();

      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

      // The auth screen only exists before the stub restores a session, so it
      // is captured first or not at all.
      if (await show(page, "screen-auth")) {
        rows.push(...(await captureAll(page, shotDir, `${sportId}-01-auth`, log)));
      }
      await signIn(page, { username: "Baseline", password: "baseline-password" }, log);

      if (await show(page, "screen-home")) {
        rows.push(...(await captureAll(page, shotDir, `${sportId}-02-hub`, log)));
      }

      if (!(await openSport(page, sportId, log))) {
        await context.close();
        continue;
      }
      rows.push(...(await captureAll(page, shotDir, `${sportId}-03-play`, log)));

      if (needsDraft()) {
        const squadIndex = await loadSquadIndex(sportId);
        await page.locator("#btn-start-draft").click({ timeout: 10000 }).catch(() => {});

        // Mid-draft, not at its start: an empty board says nothing about how a
        // full one reads, and a full one is what a player looks at for ten
        // rounds.
        if (await page.locator("#pool-search").isVisible().catch(() => false)) {
          rows.push(...(await captureAll(page, shotDir, `${sportId}-04-draft-empty`, log)));
        }

        // Generous, because overrunning it costs SCREENS. The first run gave
        // the draft 240s; basketball's ten rounds ran past it at round five, so
        // the live game and the box score - two of the three screens this whole
        // exercise is about - were never reached and never photographed. A
        // capture run is not a performance gate and has no reason to be tight.
        const deadline = Date.now() + 900000;
        const picks = await driveDraft(page, squadIndex, sportId, log, deadline).catch((e) => {
          log(`  draft did not complete: ${e.message}`);
          return 0;
        });
        log(`  drafted ${picks} round(s)`);

        const shape = await driveStrategyPhases(page, sportId, log, deadline).catch(() => []);
        log(`  strategy rounds: ${shape.length}`);

        if (await show(page, "screen-game")) {
          // Live, then final. The live scoreboard is the screen people watch
          // together and the box score is the one they argue over, and they are
          // different layouts behind the same id.
          rows.push(...(await captureAll(page, shotDir, `${sportId}-05-game-live`, log)));
          await page
            .locator("#final-box, #btn-play-again")
            .first()
            .waitFor({ state: "visible", timeout: 180000 })
            .catch(() => {});
          rows.push(...(await captureAll(page, shotDir, `${sportId}-06-game-final`, log)));
        }
      } else {
        log("  skipping the draft: no draft or game screen was asked for");
      }

      for (const [tab, screen] of [
        ["#nav-profile", "screen-profile"],
        ["#nav-badges", "screen-badges"],
        ["#nav-squads", "screen-squads"],
      ]) {
        await page.locator(tab).click({ timeout: 10000 }).catch(() => {});
        if (await show(page, screen)) {
          rows.push(...(await captureAll(page, shotDir, `${sportId}-07-${screen.replace("screen-", "")}`, log)));
        }
      }

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  // A filtered run is a SPOT CHECK, not a baseline, and is written where it
  // cannot be mistaken for one or overwrite one. Comparing a three-screen run
  // against a full one as though both were baselines is how a number that
  // only moved because fewer things were measured gets reported as progress.
  const partial = requestedScreens() || requestedSports().length < 2;
  const suffix = partial ? "-partial" : "";
  await writeFile(path.join(outDir, `report${suffix}.md`), renderReport(rows, lines, stamp), "utf8");
  await writeFile(path.join(outDir, `rows${suffix}.json`), JSON.stringify(rows, null, 2), "utf8");
  if (partial) log(`\nPARTIAL RUN - ${rows.length} captures, not a baseline.`);

  const totals = rows.reduce(
    (a, r) => ({
      small: a.small + (r.smallTargetCount || 0),
      tiny: a.tiny + (r.tinyTextCount || 0),
      overflow: a.overflow + (r.hOverflowPx > 0 ? 1 : 0),
    }),
    { small: 0, tiny: 0, overflow: 0 }
  );
  console.log(
    `\n  ${rows.length} captures — ${totals.small} undersized tap targets, ` +
      `${totals.tiny} tiny-text elements, ${totals.overflow} views with horizontal overflow`
  );
  console.log(`  report: ${path.relative(ROOT, path.join(outDir, `report${suffix}.md`))}\n`);
}

function renderReport(rows, lines, stamp) {
  const out = [];
  out.push(`# Mobile baseline — ${stamp}`);
  out.push("");
  out.push(
    "Captured by `npm run baseline:mobile`. This is the BEFORE state for the phone-first",
    "rework: every screen, at four phone sizes, in a real touch context. It is evidence,",
    "not a gate — the script exits 0 whatever it finds.",
    ""
  );
  out.push(`Tap-target floor: ${TAP_TARGET_MIN}px. Readable-text floor: ${MIN_FONT_PX}px.`);
  out.push("");

  out.push("## Summary");
  out.push("");
  out.push("| screen | phone | tap targets < 44px | text < 12px | escaping | h-overflow |");
  out.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    out.push(
      `| ${r.screen} | ${r.phone} | ${r.smallTargetCount} | ${r.tinyTextCount} | ${r.escaping} | ${r.hOverflowPx}px |`
    );
  }
  out.push("");

  out.push("## What is worst, screen by screen");
  out.push("");
  for (const r of rows) {
    if (!r.smallTargets.length && !r.tinyText.length && !r.worstLayout.length) continue;
    out.push(`### ${r.screen} @ ${r.phone} (${r.width}x${r.height})`);
    out.push("");
    out.push(`Screenshot: \`${r.shot}\` (regenerate with \`npm run baseline:mobile\`)`);
    out.push("");
    for (const t of r.smallTargets) out.push(`- tap target ${t.w}x${t.h}: \`${t.el}\``);
    for (const t of r.tinyText) out.push(`- ${t.px}px text: \`${t.el}\` — "${t.sample}"`);
    for (const w of r.worstLayout) out.push(`- ${w}`);
    out.push("");
  }

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
