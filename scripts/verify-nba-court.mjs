#!/usr/bin/env node
// BASKETBALL'S COURT, WATCHED IN A REAL BROWSER.
//
// WHY THIS EXISTS SEPARATELY FROM verify-nba-shot-ledger.mjs
//
// The ledger test proves the arithmetic: every point reconciles with the
// engine, every three is outside the arc, the clock counts down. That is
// necessary and it is not sufficient. A correct ledger wired into the screen
// incorrectly still shows the viewer an empty floor - and CLAUDE.md is blunt
// about this: a green verify means the modules parse and the contracts hold,
// not that the app runs. Two blank-screen bugs have shipped past one.
//
// So this drives the actual app in Chromium, watches an actual basketball game,
// and asserts what a person could see: that markers land, that they land where
// the shot says, that the strip counts, that the quarter card appears, and that
// the picture is still there after the whistle.
//
// AND THAT THE PRESENTATION CHANGED NOTHING. The final score on the board must
// equal the sum of the quarter columns beside it, and the banner must agree
// with both. The court is a picture of a result that was decided before the
// first marker was drawn; if any of those three disagree, it is not.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = Number(process.env.BK_COURT_PORT || 8943);

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

/** Everything a viewer could read off the court at one instant. */
const SAMPLE = () => {
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() || "";
  const markers = [...document.querySelectorAll("#basketball-court .bc-shot")];
  return {
    courtVisible: !document.querySelector("#basketball-court")?.classList.contains("hidden"),
    fieldVisible: !document.querySelector("#football-field")?.classList.contains("hidden"),
    markers: markers.length,
    made: markers.filter((m) => m.classList.contains("made")).length,
    missed: markers.filter((m) => m.classList.contains("miss")).length,
    // A make is a <circle> and a miss is a <path> cross. Shape, not only
    // colour - the distinction has to survive a reader who cannot separate the
    // two hues, and reading the tag name is how that is measured rather than
    // asserted.
    //
    // Arrays, deduped by hand. A Set does not survive the trip out of the page:
    // it arrives in Node as {}, which is truthy, has no size, and is not
    // iterable - so the check that read one threw instead of failing.
    madeShapes: [...new Set(markers.filter((m) => m.classList.contains("made")).map((m) => m.tagName))],
    missShapes: [...new Set(markers.filter((m) => m.classList.contains("miss")).map((m) => m.tagName))],
    status: text("#live-scoreboard .scoreboard-period"),
    possession: text("#basketball-court .bc-possession"),
    run: text("#basketball-court .bc-run"),
    call: (() => {
      const el = document.querySelector("#basketball-court .bc-call");
      return el && el.classList.contains("show") ? el.textContent.trim() : "";
    })(),
    breakShown: !document.querySelector("#basketball-court .bc-break")?.classList.contains("hidden"),
    breakText: text("#basketball-court .bc-break"),
    fg: text('#basketball-court [data-stat="a-fg"]'),
    reb: text('#basketball-court [data-stat="a-reb"]'),
    feed: [...document.querySelectorAll("#play-feed .play-card")].map((c) => c.textContent.trim()),
    scores: [...document.querySelectorAll("#live-scoreboard .scoreboard-score")].map((el) => Number(el.textContent.trim()) || 0),
    finalShown: !document.querySelector("#final-banner")?.classList.contains("hidden"),
    finalText: text("#final-banner"),
  };
};

async function signIn(page, baseUrl, who) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const home = page.locator("#screen-home:not(.hidden)");
  if (await home.isVisible().catch(() => false)) return;
  await page.locator("#screen-auth:not(.hidden)").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#input-auth-identifier").fill(who);
  await page.locator("#input-auth-password").fill("nba-court-password");
  await page.locator("#btn-auth-submit").click();
  await home.waitFor({ state: "visible", timeout: 30000 });
}

/** Draft by taking whatever card is offered - Easy practice is the difficulty
 * that offers cards, and nothing about the court depends on which difficulty
 * drafted the roster. */
async function playToGameScreen(page, sportId) {
  await page.locator(`[data-sport="${sportId}"]`).first().click();
  await page.locator('#mode-toggle [data-mode="practice"]').click();
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
    await sleep(160);
  }
  if (!(await pastDraft())) throw new Error(`${sportId}: the draft never completed`);

  for (const [panel, button] of [
    ["#rotation-phase", "#btn-confirm-rotation"],
    ["#matchup-phase", "#btn-confirm-matchups"],
  ]) {
    if (!(await page.locator(panel).isVisible().catch(() => false))) continue;
    await page.locator(button).click({ timeout: 10000 }).catch(() => {});
  }
  for (let round = 0; round < 4; round++) {
    if (!(await page.locator("#tactic-phase").isVisible().catch(() => false))) break;
    const card = page.locator("#tactic-phase .tactic-card").first();
    if (await card.isVisible().catch(() => false)) await card.click().catch(() => {});
    await page.locator("#btn-play-game").click({ timeout: 10000 }).catch(() => {});
    await sleep(350);
  }
  await page.locator("#screen-game:not(.hidden)").waitFor({ state: "visible", timeout: 60000 });
}

async function main() {
  const { chromium } = await import("playwright");
  const server = await serve(ROOT, PORT);
  const baseUrl = `http://127.0.0.1:${PORT}/`;
  console.log(renderSection("NBA court (real Chromium, stubbed backend)"));
  console.log(`  serving ${ROOT} at ${baseUrl}`);

  const stub = await readFile(path.join(HERE, "selftest", "supabase-stub.js"), "utf8");
  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const checks = [];
  const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });
  const pageErrors = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
    });
    await context.route("**/esm.sh/**", (route) =>
      route.fulfill({ status: 200, body: stub, contentType: "text/javascript; charset=utf-8" })
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await signIn(page, baseUrl, "NbaCourtTest");
    await playToGameScreen(page, "nba");

    // ---- record every run and every banner, exactly -----------------------
    //
    // The 140ms poll below is a measure of how fast this script happens to be
    // running, not of what the page did: a run chip that is up for one event
    // and replaced by the next can fall entirely between two samples, and it
    // did - a game with two runs in it reported "no run in this game". A
    // MutationObserver fires on the write itself and cannot miss one.
    // The court has to be on the page before anything can watch it. Waited for
    // rather than assumed: the game screen becomes visible a beat before
    // playOutResult draws the floor into it, and an observer attached to null
    // fails silently and reports an empty game.
    await page.locator("#basketball-court .bc-run").waitFor({ state: "attached", timeout: 20000 });
    const watching = await page.evaluate(() => {
      window.__bkRuns = [];
      window.__bkCalls = [];
      const watch = (el, log) => {
        if (!el) return false;
        new MutationObserver(() => {
          const text = el.textContent.trim();
          if (text && log[log.length - 1] !== text) log.push(text);
        }).observe(el, { childList: true, characterData: true, subtree: true });
        return true;
      };
      return {
        run: watch(document.querySelector("#basketball-court .bc-run"), window.__bkRuns),
        call: watch(document.querySelector("#basketball-court .bc-call"), window.__bkCalls),
      };
    });
    check(
      "The run chip and the big-play banner are both on the court to be watched",
      watching.run && watching.call,
      `run chip ${watching.run ? "found" : "MISSING"}, banner ${watching.call ? "found" : "MISSING"}`
    );

    // ---- sample the whole game -------------------------------------------
    const samples = [];
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const sample = await page.evaluate(SAMPLE);
      samples.push(sample);
      if (sample.finalShown) break;
      await sleep(140);
    }
    const last = samples[samples.length - 1];

    // ---- the floor is there, and football's is not -----------------------
    check(
      "The court is the visible stage for basketball",
      samples.every((s) => s.courtVisible) && samples.every((s) => !s.fieldVisible),
      `${samples.length} samples, court visible throughout, football's field never`
    );

    // ---- markers land, and keep landing ----------------------------------
    const markerCounts = samples.map((s) => s.markers);
    const grew = markerCounts.filter((n, i) => i > 0 && n > markerCounts[i - 1]).length;
    check(
      "Shots land on the floor as the game plays",
      last.markers > 20 && grew >= 8,
      `${last.markers} markers by the whistle, growing at ${grew} of ${samples.length} samples`
    );
    check(
      "The chart starts empty and is built, not pasted in",
      markerCounts[0] < last.markers / 2,
      `${markerCounts[0]} markers on the first sample, ${last.markers} at the end`
    );

    // ---- made and missed are separable without colour --------------------
    check(
      "A make and a miss are different SHAPES, not just different colours",
      last.made > 0 &&
        last.missed > 0 &&
        last.madeShapes.join() === "circle" &&
        last.missShapes.join() === "path",
      `${last.made} makes drawn as ${last.madeShapes.join("/") || "nothing"}, ` +
        `${last.missed} misses as ${last.missShapes.join("/") || "nothing"}`
    );

    // ---- every marker is where its own shot says it is --------------------
    //
    // Measured off the RENDERED DOM, in the SVG's own coordinates, so this is
    // checking the picture rather than re-checking the ledger. A three drawn
    // inside the arc is the single most obvious way for this screen to be
    // wrong, and it would look almost right in a screenshot.
    const geometry = await page.evaluate(() => {
      const RIM = { x: 50, y: 94 - 5.25 * 2 };
      const ARC = 23.75 * 2;
      const CORNER_X = 20 * 2;
      let checked = 0;
      let wrong = 0;
      for (const m of document.querySelectorAll("#basketball-court .bc-shot")) {
        // Only the circles carry a readable centre; the crosses are paths, and
        // their first move-to is one corner rather than the middle.
        if (m.tagName !== "circle") continue;
        const x = Number(m.getAttribute("cx"));
        const y = Number(m.getAttribute("cy"));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        checked += 1;
        if (x < 0 || x > 100 || y < 0 || y > 94) wrong += 1;
        const r = Math.hypot(x - RIM.x, y - RIM.y);
        const inCorner = Math.abs(x - 50) > CORNER_X && y > 94 - 32;
        // Radius 3 markers are threes and radius 2 are twos - the only thing
        // the DOM records about which is which, and enough to check the arc.
        const isThree = Number(m.getAttribute("r")) > 2.1;
        if (isThree && !(r > ARC || inCorner)) wrong += 1;
        if (!isThree && (r > ARC || inCorner)) wrong += 1;
      }
      return { checked, wrong };
    });
    check(
      "No marker is drawn somewhere that contradicts its shot",
      geometry.checked > 10 && geometry.wrong === 0,
      `${geometry.checked} placed makes measured on the rendered court, ${geometry.wrong} wrong`
    );

    // ---- the strip counts ------------------------------------------------
    const fgReadings = new Set(samples.map((s) => s.fg).filter((v) => v && v !== "-"));
    const rebReadings = samples.map((s) => Number(s.reb) || 0);
    check(
      "The live stat strip fills in as the game goes",
      fgReadings.size >= 3 && rebReadings[rebReadings.length - 1] > 0,
      `${fgReadings.size} distinct FG% readings, ${rebReadings[rebReadings.length - 1]} rebounds by the end`
    );
    check(
      "Rebounds only ever go up",
      rebReadings.every((n, i) => i === 0 || n >= rebReadings[i - 1]),
      "the strip is folded forward from the ledger, never recomputed backwards"
    );

    // ---- possession, runs, big plays, quarter cards ----------------------
    check(
      "Possession is stated and changes hands",
      new Set(samples.map((s) => s.possession).filter(Boolean)).size >= 2,
      [...new Set(samples.map((s) => s.possession).filter(Boolean))].join(" / ")
    );
    const runs = await page.evaluate(() => window.__bkRuns || []);
    check(
      "A scoring run is called when there is one",
      runs.length > 0 && runs.every((r) => /^\d+-0 RUN — /.test(r)),
      runs.length ? `${runs.length} runs: ${runs.slice(0, 3).join(" | ")}` : "no run reached the chip in this game"
    );
    const observedCalls = await page.evaluate(() => window.__bkCalls || []);
    const calls = [...new Set([...observedCalls, ...samples.map((s) => s.call).filter(Boolean)])];
    check(
      "Big plays get a banner, and the banner never claims a dunk or an and-1",
      calls.length >= 2 && !calls.some((c) => /DUNK|AND.?1/i.test(c)),
      calls.slice(0, 3).join(" | ")
    );
    const breaks = samples.filter((s) => s.breakShown && /End of Q/.test(s.breakText));
    check(
      "The quarter card appears between periods",
      breaks.length > 0,
      breaks.length ? breaks[0].breakText.replace(/\s+/g, " ").slice(0, 70) : "no quarter card was seen"
    );

    // ---- the feed says who did what --------------------------------------
    const feedLines = [...new Set(samples.flatMap((s) => s.feed))];
    const namedPlays = feedLines.filter((l) => /—/.test(l));
    check(
      "The possession feed names the player and what happened",
      namedPlays.length >= 3,
      namedPlays.slice(0, 2).join(" | ") || "no play lines reached the feed"
    );

    // ---- the clock is on the board and it moves --------------------------
    const clockLike = /^(Q[1-4]|OT\d+) · \d+:\d{2}$/;
    const clocks = samples.map((s) => s.status).filter((t) => clockLike.test(t || ""));
    check(
      "Basketball's derived clock reaches the board and counts",
      clocks.length > 0 && new Set(clocks).size >= 3,
      `${new Set(clocks).size} distinct readings, e.g. ${clocks[0]}`
    );

    // ---- THE PRESENTATION CHANGED NOTHING --------------------------------
    const agreement = await page.evaluate(() => {
      const cells = [...document.querySelectorAll("#live-scoreboard .scoreboard-grid tbody tr")].map((tr) =>
        [...tr.querySelectorAll("td")].slice(1).map((td) => td.textContent.trim())
      );
      const sumRow = (row) =>
        row.slice(0, -1).reduce((sum, v) => sum + (Number(v) || 0), 0);
      return {
        a: { periods: sumRow(cells[0] || []), total: Number(cells[0]?.[cells[0].length - 1]) || 0 },
        b: { periods: sumRow(cells[1] || []), total: Number(cells[1]?.[cells[1].length - 1]) || 0 },
      };
    });
    check(
      "The final score is the sum of the quarters it was built from",
      agreement.a.periods === agreement.a.total && agreement.b.periods === agreement.b.total,
      `${agreement.a.periods}=${agreement.a.total}, ${agreement.b.periods}=${agreement.b.total}`
    );
    const bannerNumbers = (last.finalText || "").match(/(\d+)\s*[-–—]\s*(\d+)/);
    check(
      "The banner, the board and the quarters all agree",
      !!bannerNumbers &&
        Number(bannerNumbers[1]) === last.scores[0] &&
        Number(bannerNumbers[2]) === last.scores[1] &&
        last.scores[0] === agreement.a.total,
      `banner ${bannerNumbers?.[1]}-${bannerNumbers?.[2]}, board ${last.scores.join("-")}`
    );

    // ---- the shot chart survives the whistle ------------------------------
    await page.locator("#shot-chart:not(.hidden)").waitFor({ state: "visible", timeout: 20000 });
    const chart = await page.evaluate(() => ({
      markers: document.querySelectorAll("#shot-chart-court .bc-shot").length,
      legend: document.querySelector("#shot-chart-legend")?.textContent?.trim() || "",
      filters: [...document.querySelectorAll("#shot-chart-filters button")].map((b) => b.textContent.trim()),
      titled: [...document.querySelectorAll("#shot-chart-court .bc-shot title")].length,
    }));
    check(
      "The finished game keeps its shot chart",
      chart.markers >= last.markers && /discs are makes/.test(chart.legend),
      `${chart.markers} markers, "${chart.legend}"`
    );
    check(
      "The chart filters by team, with both as the default",
      chart.filters.length === 3 && chart.filters[0] === "Both",
      chart.filters.join(" / ")
    );
    check(
      "Every marker says its own line, for a reader who is not looking at colours",
      chart.titled === chart.markers,
      `${chart.titled} of ${chart.markers} markers carry the play they were`
    );

    // Filtering to one side must actually reduce the picture - a filter that
    // renders the same chart three times is a filter in name only.
    await page.locator("#shot-chart-filters button").nth(1).click();
    await sleep(200);
    const filtered = await page.evaluate(
      () => document.querySelectorAll("#shot-chart-court .bc-shot").length
    );
    check(
      "Filtering to one team draws only that team's shots",
      filtered > 0 && filtered < chart.markers,
      `${filtered} of ${chart.markers} once filtered to one side`
    );

    await context.close();

    // ---- and none of it ever appears in football -------------------------
    const nflContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await nflContext.route("**/esm.sh/**", (route) =>
      route.fulfill({ status: 200, body: stub, contentType: "text/javascript; charset=utf-8" })
    );
    const nflPage = await nflContext.newPage();
    nflPage.on("pageerror", (e) => pageErrors.push(`nfl: ${e}`));
    await signIn(nflPage, baseUrl, "NflNoCourtTest");
    await playToGameScreen(nflPage, "nfl");
    await sleep(2500);
    const nfl = await nflPage.evaluate(SAMPLE);
    check(
      "Basketball's court never appears in a football game",
      !nfl.courtVisible && nfl.fieldVisible && nfl.markers === 0,
      `court ${nfl.courtVisible ? "VISIBLE" : "hidden"}, field ${nfl.fieldVisible ? "visible" : "HIDDEN"}, ${nfl.markers} shot markers`
    );
    const nflChartHidden = await nflPage.evaluate(
      () => !!document.querySelector("#shot-chart")?.classList.contains("hidden")
    );
    check(
      "A football game offers no shot chart",
      nflChartHidden,
      "#shot-chart stays hidden for a sport that draws none"
    );
    await nflContext.close();

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
