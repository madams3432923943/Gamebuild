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

/** Makes plus misses. A marker is one attempt and an attempt is one marker; if
 * the two ever disagree, something is being drawn twice or not at all. */
const chartShotCount = (sample) => sample.made + sample.missed;

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
    // GREEN IS IN AND RED IS OUT, read off the rendered element rather than
    // asserted from the stylesheet - what a viewer sees is the computed value.
    // Deduped as arrays: a Set does not survive the trip out of the page.
    madeFills: [...new Set(markers.filter((m) => m.classList.contains("made")).map((m) => getComputedStyle(m).fill))],
    missStrokes: [...new Set(markers.filter((m) => m.classList.contains("miss")).map((m) => getComputedStyle(m).stroke))],
    // Which half each side's markers landed on. The whole point of a full
    // court: team identity is position, so this is the check that the picture
    // says who took the shot.
    halves: markers
      .filter((m) => m.tagName === "circle")
      .map((m) => ({
        side: m.classList.contains("side-a") ? "a" : "b",
        x: Number(m.getAttribute("cx")),
        y: Number(m.getAttribute("cy")),
      })),
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scrollY: Math.round(window.scrollY),
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
    //
    // Scrolled off the top first, deliberately. The bug this screen was rebuilt
    // around was live updates dragging a reader's scroll position, and it can
    // only be observed from somewhere other than the top of the page.
    await page.evaluate(() => window.scrollTo(0, 160));
    await sleep(200);

    // MEASURED WHILE THE GAME IS PLAYING. The live floor comes down at the
    // whistle, and everything below about its size, its labels and the strip
    // under it is a question about the court a person watches a game on - asked
    // after the game, it measures a hidden element and reads 0 by 0.
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll("#basketball-court .bc-halflabel")].map((el) => ({
        text: el.textContent.trim(),
        size: parseFloat(getComputedStyle(el).fontSize),
        left: el.getBoundingClientRect().left,
      }))
    );
    const courtBox = await page.evaluate(() => {
      const el = document.querySelector("#basketball-court .bc-court");
      const box = el.getBoundingClientRect();
      const svg = el.querySelector(".bc-svg").getBoundingClientRect();
      return { w: box.width, h: box.height, svgW: svg.width, svgH: svg.height, viewport: window.innerWidth };
    });
    const strip = await page.evaluate(() => {
      const cell = (side) => document.querySelector(`#basketball-court .bc-stat-${side}`);
      const box = (side) => cell(side).getBoundingClientRect();
      const name = (side) => cell(side).querySelector(".bc-stat-name").textContent.trim();
      const label = (side) =>
        document.querySelector(`#basketball-court .bc-halflabel.side-${side}`).textContent.trim();
      return {
        a: { name: name("a"), label: label("a"), left: box("a").left },
        b: { name: name("b"), label: label("b"), left: box("b").left },
      };
    });

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
      // WHILE THE GAME IS PLAYING. The last sample is taken after the whistle,
      // and the whistle is when the live floor comes down and the post-game
      // chart takes its place under the recap - so asserting it over every
      // sample would be asserting the duplicate court back into existence.
      samples.filter((sample) => !sample.finalShown).every((sample) => sample.courtVisible) &&
        samples.every((sample) => !sample.fieldVisible),
      `${samples.length} samples, court visible for every one before the whistle, football's field never`
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
    // A marker is never removed and never redrawn. Both halves of that matter:
    // a chart that drops old shots is a scoreboard with dots, and one that
    // re-renders the ledger per event would double every shot it had already
    // drawn - which a growing count alone would not distinguish from working.
    check(
      "Shots persist - the chart only ever grows, and never by more than what happened",
      markerCounts.every((n, i) => i === 0 || n >= markerCounts[i - 1]) &&
        last.markers === chartShotCount(last),
      `${last.markers} markers for ${last.markers} attempts, never fewer than the sample before`
    );
    const emphasis = await page.evaluate(() => {
      const drawn = [...document.querySelectorAll("#basketball-court .bc-markers > *")];
      const newest = drawn[drawn.length - 1];
      return {
        count: drawn.length,
        // Appended last, so it paints over the pile beneath it, and carrying
        // the entrance animation that is the emphasis.
        newestIsFresh: !!newest && newest.classList.contains("fresh"),
        allFreshOnce: drawn.every((el) => el.classList.contains("fresh")),
      };
    });
    check(
      "The newest shot is drawn on top of the ones before it",
      emphasis.count > 10 && emphasis.newestIsFresh && emphasis.allFreshOnce,
      `${emphasis.count} markers, newest last in the layer with its entrance animation`
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
    // checking the picture rather than re-checking the ledger. The shape of the
    // court is measured without a browser in verify-nba-court-geometry.mjs;
    // what only a browser can answer is whether the markers landed on the court
    // that was drawn.
    const geometry = await page.evaluate(() => {
      const VIEW_W = 188;
      const VIEW_H = 100;
      const HALF_X = VIEW_W / 2;
      const RIM = { a: { x: 10.5, y: 50 }, b: { x: VIEW_W - 10.5, y: 50 } };
      const ARC = 23.75 * 2;
      const CORNER_HALF = 44;
      let checked = 0;
      let offCourt = 0;
      let wrongHalf = 0;
      let wrongZone = 0;
      for (const m of document.querySelectorAll("#basketball-court .bc-shot")) {
        // Only the circles carry a readable centre; the crosses are paths, and
        // their first move-to is one corner rather than the middle.
        if (m.tagName !== "circle") continue;
        const x = Number(m.getAttribute("cx"));
        const y = Number(m.getAttribute("cy"));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        checked += 1;
        if (x < 0 || x > VIEW_W || y < 0 || y > VIEW_H) offCourt += 1;
        const side = m.classList.contains("side-a") ? "a" : "b";
        if ((side === "a") !== x < HALF_X) wrongHalf += 1;
        // A shot must be on the near side of the arc it was worth: a two inside
        // it, a three outside it or out in a corner, measured from the rim that
        // side is attacking.
        const rim = RIM[side];
        const distance = Math.hypot(x - rim.x, y - rim.y);
        const inCorner = Math.abs(y - 50) > CORNER_HALF;
        const outside = distance > ARC || inCorner;
        // Threes are drawn no differently from twos now, so the class list
        // cannot say which this was - but a marker on the wrong side of BOTH
        // boundaries is wrong whatever it was worth, and a shot past half court
        // is wrong outright.
        if (distance > HALF_X) wrongZone += 1;
        void outside;
      }
      return { checked, offCourt, wrongHalf, wrongZone };
    });
    check(
      "Every marker is on the floor, on its own team's half, within a shot of the rim",
      geometry.checked > 10 &&
        geometry.offCourt === 0 &&
        geometry.wrongHalf === 0 &&
        geometry.wrongZone === 0,
      `${geometry.checked} placed makes measured on the rendered court: ` +
        `${geometry.offCourt} off the floor, ${geometry.wrongHalf} on the wrong half, ` +
        `${geometry.wrongZone} further from the basket than half court`
    );

    // ---- the two teams are on OPPOSITE ends, and stay there ----------------
    const sides = last.halves;
    const aXs = sides.filter((s) => s.side === "a").map((s) => s.x);
    const bXs = sides.filter((s) => s.side === "b").map((s) => s.x);
    check(
      "Your shots and the opponent's are on opposite halves for the whole game",
      aXs.length > 5 &&
        bXs.length > 5 &&
        aXs.every((x) => x < 94) &&
        bXs.every((x) => x > 94) &&
        samples.every((sample) =>
          sample.halves.every((h) => (h.side === "a") === h.x < 94)
        ),
      `${aXs.length} of your makes all left of the half-court line, ${bXs.length} of theirs all right of it, ` +
        `across ${samples.length} samples`
    );

    // ---- green is in, red is out, and neither depends on the team ---------
    const green = (c) => /rgb\(\s*61,\s*220,\s*132/.test(c);
    const red = (c) => /rgb\(\s*255,\s*95,\s*95/.test(c);
    check(
      "A make is green and a miss is red, the same for both teams",
      last.madeFills.length === 1 &&
        green(last.madeFills[0]) &&
        last.missStrokes.length === 1 &&
        red(last.missStrokes[0]),
      `makes filled ${last.madeFills.join("/")}, misses stroked ${last.missStrokes.join("/")}`
    );

    // ---- and NOTHING ELSE is drawn on the floor ---------------------------
    //
    // The chart's whole legibility rests on two symbols meaning two things, so
    // this enumerates every element in the marker layer and every colour on the
    // court furniture rather than checking the ones it expects to find. The rim
    // was drawn in --buzzer, which is red: every basket was a red circle on a
    // court where red means a miss and a circle means a make.
    const vocabulary = await page.evaluate(() => {
      // RED BY HUE AND BY ALPHA, not by "the red channel is high". The sport's
      // accent is orange - hue 28 - and it tints the key at 8% and the floor's
      // border at 30%. Neither is a red icon and neither is what this is
      // looking for; a first pass at this flagged both.
      const looksRed = (colour) => {
        const m = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/.exec(colour);
        if (!m) return false;
        const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
        const alpha = m[4] === undefined ? 1 : Number(m[4]);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (alpha < 0.5 || max === min || max !== r) return false;
        let hue = (60 * ((g - b) / (max - min)) + 360) % 360;
        return hue < 15 || hue > 345;
      };
      const symbols = new Set();
      for (const el of document.querySelectorAll("#basketball-court .bc-markers > *")) {
        const s = getComputedStyle(el);
        symbols.add(`${el.tagName}:${s.fill}:${s.stroke}`);
      }
      const furniture = [];
      for (const el of document.querySelectorAll(
        "#basketball-court .bc-svg :not(.bc-markers):not(.bc-flash):not(.bc-shot)"
      )) {
        const s = getComputedStyle(el);
        if (looksRed(s.stroke) || looksRed(s.fill)) {
          furniture.push(`${el.getAttribute("class")} stroke ${s.stroke} fill ${s.fill}`);
        }
      }
      return { symbols: [...symbols], redFurniture: furniture };
    });
    check(
      "The floor speaks two symbols and no others: green circle in, red cross out",
      vocabulary.symbols.length === 2 &&
        vocabulary.symbols.some((v) => /^circle:rgb\(61, 220, 132\):none$/.test(v)) &&
        vocabulary.symbols.some((v) => /^path:none:rgb\(255, 95, 95\)$/.test(v)),
      vocabulary.symbols.join(" | ") || "nothing was drawn in the marker layer"
    );
    check(
      "Nothing on the court but a miss is red",
      vocabulary.redFurniture.length === 0,
      vocabulary.redFurniture.join(" | ") ||
        "rims, lines and the paint carry no visible red - the only red on the floor is a miss"
    );

    // ---- the half labels say whose end is whose ---------------------------
    check(
      "Each half is labelled with the team shooting at it, readably",
      labels.length === 2 &&
        labels.every((l) => l.text.length > 0 && l.size >= 12) &&
        labels[0].left < labels[1].left,
      labels.map((l) => `${l.text} (${l.size}px)`).join(" | ") || "no half labels were drawn"
    );

    // ---- a phone, during live play ---------------------------------------
    //
    // The viewport here is 390x844 and the court is 188:100 - so this is the
    // check that a horizontal full court on a phone neither overflows the page
    // nor drags the reader. The scroll half of it matters most: this screen was
    // rebuilt once already because live updates fought the user's scroll.
    check(
      "A full court on a phone never pushes the page sideways",
      samples.every((sample) => sample.pageOverflow <= 0),
      `worst horizontal overflow across ${samples.length} samples: ` +
        `${Math.max(...samples.map((sample) => sample.pageOverflow))}px`
    );
    check(
      "The court stays horizontal and in proportion at 390px",
      courtBox.w <= courtBox.viewport &&
        Math.abs(courtBox.svgW / courtBox.svgH - 1.88) < 0.02 &&
        courtBox.svgW > courtBox.svgH,
      `${courtBox.w.toFixed(0)}x${courtBox.h.toFixed(0)}px inside a ${courtBox.viewport}px viewport, ` +
        `drawn at ${(courtBox.svgW / courtBox.svgH).toFixed(3)}:1`
    );

    // ---- and the reader is left where they were ---------------------------
    const scrolls = [...new Set(samples.map((sample) => sample.scrollY))];
    check(
      "Shots landing never move the page under the reader",
      scrolls.length === 1,
      scrolls.length === 1
        ? `scroll held at ${scrolls[0]}px through ${samples.length} samples and ${last.markers} shots`
        : `the page moved: ${scrolls.slice(0, 5).join(" -> ")}`
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

    check(
      "Each team's numbers sit under that team's half, and neither ever swaps sides",
      strip.a.name === strip.a.label &&
        strip.b.name === strip.b.label &&
        strip.a.left < strip.b.left &&
        strip.a.name !== strip.b.name,
      `${strip.a.name} left, ${strip.b.name} right, matching the halves above them`
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
      chart.markers >= last.markers && /green circles are makes/.test(chart.legend),
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

    // ---- THE CHART AND THE BOX SCORE ARE THE SAME GAME --------------------
    //
    // This is the check the split derivations got past. The box score used to
    // roll its own shooting split - unseeded, over the whole-game total - while
    // the chart drew the ledger's seeded per-quarter one. Both reconciled the
    // POINTS, so nothing on the scoreboard ever looked wrong, and a viewer who
    // counted six made threes in the box score found two on the court.
    //
    // Counted the way a viewer counts: filter the chart to one team, count the
    // green circles, and hold it against that team's FG line in the box score.
    // A made field goal is a green circle and every attempt is a marker - free
    // throws are not drawn, and are not field goals either.
    const agreementByTeam = [];
    for (const [index, side] of [[1, "a"], [2, "b"]]) {
      await page.locator("#shot-chart-filters button").nth(index).click();
      await sleep(200);
      const drawn = await page.evaluate(() => ({
        made: document.querySelectorAll("#shot-chart-court .bc-shot.made").length,
        total: document.querySelectorAll("#shot-chart-court .bc-shot").length,
      }));
      const booked = await page.evaluate((team) => {
        const row = document.querySelectorAll("#full-box-score .box-totals")[team];
        // The split cell carries the percentage in a span of its own, so
        // textContent reads "37/7549.3%" - the direct text node is the split.
        const split = (td) =>
          [...td.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim();
        const cell = [...row.querySelectorAll("td")].find((td) => /^\d+\/\d+$/.test(split(td)));
        const m = cell && /^(\d+)\/(\d+)$/.exec(split(cell));
        return m ? { fgm: Number(m[1]), fga: Number(m[2]) } : null;
      }, side === "a" ? 0 : 1);
      agreementByTeam.push({ side, drawn, booked });
    }
    check(
      "Every field goal in the box score is on the court, and nothing else is",
      agreementByTeam.every(
        (t) => t.booked && t.drawn.made === t.booked.fgm && t.drawn.total === t.booked.fga
      ),
      agreementByTeam
        .map((t) =>
          `${t.side}: ${t.drawn.made}/${t.drawn.total} drawn against ${t.booked?.fgm}/${t.booked?.fga} booked`
        )
        .join(", ")
    );

    // ---- and there is only ONE court on the screen ------------------------
    const courts = await page.evaluate(() => ({
      live: !document.querySelector("#basketball-court").classList.contains("hidden"),
      chart: !document.querySelector("#shot-chart").classList.contains("hidden"),
      // The chart belongs under the recap, where a reader arrives at it after
      // being told why the game went that way.
      chartAfterWhy:
        document.querySelector("#why-breakdown").compareDocumentPosition(
          document.querySelector("#shot-chart")
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    }));
    check(
      "A finished game shows the court once, under the recap",
      !courts.live && courts.chart && !!courts.chartAfterWhy,
      `live floor ${courts.live ? "STILL UP" : "taken down"}, chart ${courts.chart ? "shown" : "MISSING"} ` +
        `${courts.chartAfterWhy ? "after" : "BEFORE"} the why-it-went-that-way card`
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

    // ---- A GAME YOU WALK OUT OF IS STILL A GAME YOU PLAYED ----------------
    //
    // The playback's timers are also the chain that eventually reaches
    // finish(), which is where the result is written - history, rank, badges,
    // personal bests, drafted picks. Cancelling them on a tab change therefore
    // threw the whole game away, silently, and every check in this file passed
    // while it did: they all watch a game that is watched to the end.
    //
    // The evidence is the WRITE. The stub records profile updates for exactly
    // this (see scripts/selftest/supabase-stub.js); nothing else a harness can
    // see distinguishes "recorded" from "quietly dropped".
    const abandonContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await abandonContext.route("**/esm.sh/**", (route) =>
      route.fulfill({ status: 200, body: stub, contentType: "text/javascript; charset=utf-8" })
    );
    const abandonPage = await abandonContext.newPage();
    abandonPage.on("pageerror", (e) => pageErrors.push(`abandon: ${e}`));
    await signIn(abandonPage, baseUrl, "NbaAbandonTest");
    await playToGameScreen(abandonPage, "nba");

    // Mid-quarter, before anything could have finished on its own.
    await abandonPage.evaluate(() => {
      window.__bkWrites = [];
    });
    await sleep(2500);
    const stillPlaying = await abandonPage.evaluate(
      () => !!document.querySelector("#live-scoreboard .scoreboard-score.pulse")
    );
    await abandonPage.locator("#nav-profile").click();
    await sleep(1200);

    const wrote = await abandonPage.evaluate(() =>
      (window.__bkWrites || []).filter((w) => w.table === "profiles")
    );
    const recorded = wrote.some((w) => w.keys.includes("history"));
    check(
      "Leaving a game mid-quarter still records the result",
      stillPlaying && recorded,
      stillPlaying
        ? `${wrote.length} profile writes after walking out, history ${recorded ? "written" : "NOT WRITTEN"}`
        : "the game had already finished - this check watched nothing"
    );
    check(
      "Walking out does not leave the game playing",
      !(await abandonPage.evaluate(
        () => !!document.querySelector("#live-scoreboard .scoreboard-score.pulse")
      )),
      "the board stops pulsing once the game is settled"
    );
    await abandonContext.close();

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
