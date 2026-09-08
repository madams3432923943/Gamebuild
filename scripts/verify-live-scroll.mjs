#!/usr/bin/env node
// THE PAGE MAY NOT SCROLL ITSELF WHILE A GAME IS BEING PLAYED.
//
// THE BUG THIS EXISTS FOR
//
// On a phone, during a live simulation, scrolling down to read the box score
// pulled you back up toward the scoreboard within a second or two. Every time.
// The game is four quarters long and the thing you most want to look at while
// it runs is below the fold, so the one interaction the screen invites was the
// one it fought.
//
// There is no scrollIntoView, no window.scrollTo and no focus() call anywhere
// in this app - which is why the cause was not found by reading for one. It was
// layout: the scoreboard was TORN DOWN AND REBUILT sixteen times a second for
// the first 1.5s of every quarter (tickScoreTo -> renderScoreboard, which began
// with container.innerHTML = ""), and the play feed under it grew from nothing
// to four variable-height cards over the game. Both sit ABOVE the box score.
// Destroying and recreating a subtree above the viewport gives the browser's
// scroll anchoring nothing stable to anchor to, and a feed that grows moves
// everything below it - so the reading position drifted, repeatedly, in the
// direction of the top of the page.
//
// WHAT IS ASSERTED
//
// After the viewer scrolls down, their position may not travel back UP while
// the game plays. Not "must be pixel-identical": the page legitimately grows
// as quarters are published and the feed fills, and growth below the viewport
// does not move the reader. Upward travel is the failure, because upward travel
// is the app deciding where the viewer should be looking.
//
// ACROSS EVERY WIDTH, IN ONE GAME. Five viewports - three phones, a tablet, a
// desktop - are driven inside a single live game by resizing between sampling
// windows, rather than by drafting five times. A draft is a minute; a game is
// seventeen seconds. Resizing is also a harder test than a fresh load: it
// forces a full relayout mid-playback, which is exactly the moment a screen
// that fights the user would fight hardest.
//
// BOTH SPORTS, because the fix is in shared UI (js/ui/game.js) and the two
// stages differ - basketball's board IS its stage, football adds a field that
// redraws on every play.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = Number(process.env.BK_SCROLL_PORT || 8941);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serve(root, port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/" || rel.endsWith("/")) rel += "index.html";
      const file = path.join(root, rel);
      if (!file.startsWith(root)) return res.writeHead(403).end("forbidden");
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The widths a phone, a tablet and a desktop actually are. 360 is the floor
 * this app supports (see the mobile standards in CLAUDE.md); 390 and 430 are
 * the two commonest modern phones. */
const VIEWPORTS = [
  { label: "phone 360", width: 360, height: 780 },
  { label: "phone 390", width: 390, height: 844 },
  { label: "phone 430", width: 430, height: 932 },
  { label: "tablet 820", width: 820, height: 1180 },
  { label: "desktop 1280", width: 1280, height: 900 },
];

/** THE BOTTOM OF THE PAGE, because that is where the bug lived.
 *
 * A reader at the bottom is pinned to the page's maximum scroll, so any
 * reduction in document height drags them upward - the browser has nowhere else
 * to put them. Measured before the fix at 360px: three page shrinks in one
 * basketball game, three upward jumps, 45px, one-for-one. Sampling from 60% of
 * the way down never caught it, because at 60% there is slack below and a
 * shrink is absorbed instead of being felt.
 *
 * It is also where a viewer actually sits: the box score is the last thing on
 * the page and reading it is the reason to scroll at all. */
const READ_POSITION = 1;

/** How long to watch one width for. Five of these have to fit inside a game.
 *
 * SAMPLED INSIDE THE PAGE, at SAMPLE_MS, rather than by round-tripping an
 * evaluate() per sample. The first version of this test polled from Node every
 * 120ms and passed against the un-fixed app: the shrinks it is looking for are
 * three discrete events in a seventeen-second game, and a poll that coarse -
 * with the driver's own latency on top - walked straight past them. An interval
 * running in the page cannot miss one it is fast enough to see. */
const WATCH_MS = 2600;
const SAMPLE_MS = 25;

/** Downward drift is fine and expected - a growing page moves nothing the
 * reader can see. Upward travel beyond this is the app taking the viewport
 * back, and a few pixels of tolerance covers sub-pixel layout rounding and the
 * scrollbar appearing. */
const UPWARD_TOLERANCE_PX = 24;

async function signIn(page, baseUrl, who) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const home = page.locator("#screen-home:not(.hidden)");
  if (await home.isVisible().catch(() => false)) return;
  await page.locator("#screen-auth:not(.hidden)").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#input-auth-identifier").fill(who);
  await page.locator("#input-auth-password").fill("scroll-regression-password");
  await page.locator("#btn-auth-submit").click();
  await home.waitFor({ state: "visible", timeout: 30000 });
}

/** Draft a whole roster by taking whatever card is offered, then click through
 * however many strategy rounds the sport asks for. Sport-agnostic on purpose -
 * this test is about the screen after all of that, not about drafting well. */
async function playToGameScreen(page, sportId) {
  await page.locator(`[data-sport="${sportId}"]`).first().click();
  const mode = page.locator('#mode-toggle [data-mode="practice"]');
  await mode.waitFor({ state: "visible", timeout: 15000 });
  await mode.click();
  // Easy: an open board and no pick clock, so the harness can take its time
  // without a timeout forfeiting a slot underneath it.
  const easy = page.locator('#difficulty-toggle [data-mode="easy"]');
  await easy.waitFor({ state: "visible", timeout: 15000 });
  await easy.click();
  await page.locator("#btn-start-draft:not([disabled])").waitFor({ state: "visible", timeout: 60000 });
  await page.locator("#btn-start-draft").click();
  await page.locator("#screen-draft:not(.hidden)").waitFor({ state: "visible", timeout: 60000 });

  const pastDraft = async () => {
    for (const sel of ["#rotation-phase", "#matchup-phase", "#tactic-phase", "#screen-game:not(.hidden)"]) {
      if (await page.locator(sel).isVisible().catch(() => false)) return true;
    }
    return false;
  };
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && !(await pastDraft())) {
    const card = page.locator("#pool-list .player-card:not(.disabled)").first();
    if (!(await card.isVisible().catch(() => false))) {
      await sleep(250);
      continue;
    }
    await card.click().catch(() => {});
    const modal = page.locator("#modal-backdrop:not(.hidden)");
    if (await modal.isVisible().catch(() => false)) {
      const season = page.locator("#modal-backdrop .season-option:not([disabled])").first();
      if (await season.isVisible().catch(() => false)) await season.click().catch(() => {});
    }
    if (await modal.isVisible().catch(() => false)) {
      await page.locator("#modal-backdrop .modal-slot-grid button").first().click().catch(() => {});
    }
    await sleep(180);
  }
  if (!(await pastDraft())) throw new Error(`${sportId}: the draft never completed`);

  for (const [panel, button] of [
    ["#rotation-phase", "#btn-confirm-rotation"],
    ["#matchup-phase", "#btn-confirm-matchups"],
  ]) {
    if (!(await page.locator(panel).isVisible().catch(() => false))) continue;
    await page.locator(button).click({ timeout: 10000 }).catch(() => {});
  }
  // The gameplan is rounds, not a screen - football splits offence and defence.
  for (let round = 0; round < 4; round++) {
    if (!(await page.locator("#tactic-phase").isVisible().catch(() => false))) break;
    const card = page.locator("#tactic-phase .tactic-card").first();
    if (await card.isVisible().catch(() => false)) await card.click().catch(() => {});
    await page.locator("#btn-play-game").click({ timeout: 10000 }).catch(() => {});
    await sleep(350);
  }
  await page.locator("#screen-game:not(.hidden)").waitFor({ state: "visible", timeout: 60000 });
}

/**
 * Scroll to the reading position and watch what happens to it.
 *
 * Returns the worst UPWARD travel seen - measured against the highest point
 * reached so far rather than against the starting position, so a slow drift
 * down followed by a snap back up is caught at its full size instead of being
 * hidden by the drift - and the page shrinks that cause it.
 */
async function watchScroll(page, ms) {
  const start = await page.evaluate(
    ({ share, sampleMs }) => {
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const target = Math.round(max * share);
      window.scrollTo(0, target);
      // The sampler lives in the page so that nothing between here and the
      // layout can smooth over a transient. Cleared and restarted per window.
      clearInterval(window.__bkScrollTimer);
      window.__bkScrollLog = [];
      window.__bkScrollTimer = setInterval(() => {
        window.__bkScrollLog.push({
          y: window.scrollY,
          height: document.documentElement.scrollHeight,
          // Whether anything is still playing. A finished game stops moving,
          // and a sample taken after the final whistle proves nothing.
          live: !!document.querySelector("#live-scoreboard .scoreboard-score.pulse"),
        });
      }, sampleMs);
      return { target, max, y: window.scrollY, height: document.documentElement.scrollHeight };
    },
    { share: READ_POSITION, sampleMs: SAMPLE_MS }
  );

  await sleep(ms);

  const samples = await page.evaluate(() => {
    clearInterval(window.__bkScrollTimer);
    return window.__bkScrollLog || [];
  });

  let peak = start.y;
  let worstUp = 0;
  // The MECHANISM, tracked alongside the symptom. A page that never gets
  // shorter cannot take a bottom-pinned reader upward, so a failure here says
  // which of the two the regression is: the scroll moved, or the layout did.
  let shrinks = 0;
  let shrinkPx = 0;
  let previous = start;
  for (const s of samples) {
    if (s.y > peak) peak = s.y;
    worstUp = Math.max(worstUp, peak - s.y);
    if (s.height < previous.height) {
      shrinks += 1;
      shrinkPx += previous.height - s.height;
    }
    previous = s;
  }
  return { start, samples, worstUp, peak, shrinks, shrinkPx };
}

async function main() {
  const only = (process.argv.find((a) => a.startsWith("--sport=")) || "").split("=")[1];
  const sports = only ? [only] : ["nba", "nfl"];

  const { chromium } = await import("playwright");
  const server = await serve(ROOT, PORT);
  const baseUrl = `http://127.0.0.1:${PORT}/`;
  console.log(renderSection("Live simulation never takes the viewport back (real Chromium)"));
  console.log(`  serving ${ROOT} at ${baseUrl}`);

  const stub = await readFile(path.join(HERE, "selftest", "supabase-stub.js"), "utf8");
  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const checks = [];
  const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });
  const pageErrors = [];

  try {
    for (const sportId of sports) {
      const context = await browser.newContext({
        viewport: { width: VIEWPORTS[0].width, height: VIEWPORTS[0].height },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      });
      await context.route("**/esm.sh/**", (route) =>
        route.fulfill({ status: 200, body: stub, contentType: "text/javascript; charset=utf-8" })
      );
      const page = await context.newPage();
      page.on("pageerror", (e) => pageErrors.push(`${sportId}: ${e}`));

      await signIn(page, baseUrl, `ScrollTest${sportId.toUpperCase()}`);
      await playToGameScreen(page, sportId);

      let sawLive = false;
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        // One frame for the relayout to settle before deciding where 60% is.
        await sleep(180);
        const { start, samples, worstUp, shrinks, shrinkPx } = await watchScroll(page, WATCH_MS);
        const live = samples.filter((s) => s.live).length;
        sawLive = sawLive || live > 0;
        const grew = samples.length
          ? samples[samples.length - 1].height - start.height
          : 0;

        // A page with nothing below the fold cannot demonstrate anything. On a
        // desktop the game screen may genuinely fit, and that is reported
        // rather than passed off as a result.
        if (start.max < 80) {
          check(
            `${sportId.toUpperCase()} @ ${vp.label}: nothing to scroll`,
            true,
            `page fits the viewport (${start.max}px of scroll) - no reading position to lose`
          );
          continue;
        }

        check(
          `${sportId.toUpperCase()} @ ${vp.label}: the viewer keeps their place while the game plays`,
          worstUp <= UPWARD_TOLERANCE_PX,
          `sat at ${start.y}px of ${start.max}px, worst upward travel ${worstUp}px ` +
            `over ${samples.length} samples (page grew ${grew}px, ${live} live)`
        );

        check(
          `${sportId.toUpperCase()} @ ${vp.label}: the page never gets shorter under the reader`,
          shrinks === 0,
          shrinks === 0
            ? "document height only ever grew"
            : `${shrinks} shrinks totalling ${shrinkPx}px - each one clamps a bottom-pinned reader upward`
        );
      }

      check(
        `${sportId.toUpperCase()}: the game really was playing during the watch`,
        sawLive,
        sawLive
          ? "the live pulse was on the board while scroll was being sampled"
          : "no sample caught a live game - the assertions above watched a finished screen"
      );

      await context.close();
    }

    check("No page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "clean");
  } finally {
    await browser.close();
    server.close();
  }

  for (const c of checks) console.log(renderCheck(c));
  const { counts, ok } = summarize(checks);
  console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
