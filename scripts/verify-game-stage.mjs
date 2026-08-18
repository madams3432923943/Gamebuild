#!/usr/bin/env node
// Which stage a sport is watched on, in a real browser.
//
// WHY THIS EXISTS
//
// Football played on a basketball court. The field was toggled on whether the
// engine happened to return `drives`, and the court had no code path that ever
// hid it - so NFL drew a field underneath a visible basketball court, opened
// with the word "Tip-off" on the scoreboard, and seeded its live box score
// with basketball's six stat keys, which left the football columns with
// nothing behind them to accumulate into.
//
// None of that is visible to a module-level test: it is the game screen's
// markup and the sport's declared vocabulary disagreeing. This drives the real
// showStage() and the real renderScoreboard() against both live sports, and
// switches between them to prove nothing is left behind - the failure mode
// that a single-sport check would pass straight through.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
      if (!file.startsWith(root)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      // Read BEFORE writing headers. The other way round, a request for a file
      // that does not exist sends 200, then throws, then tries to send 404 on
      // top of it - ERR_HTTP_HEADERS_SENT, which kills the whole harness
      // rather than returning a 404. A single optional asset in index.html was
      // enough to take the run down.
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function runInPage(page) {
  return page.evaluate(async () => {
    const checks = [];
    const check = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail: String(detail) });

    const { setActiveSport, activeSport, ensureSportData } = await import("/js/sports/index.js");
    // Football loads its dataset on demand now, and this harness reads its
    // columns and stage - so it has to be asked for before any of that.
    await ensureSportData("nfl");
    const { renderScoreboard } = await import("/js/ui.js");

    // The real markup, lifted from index.html rather than mocked - the point
    // is that the page's stages and the sports' declarations agree.
    const stage = document.getElementById("court-stage");
    const board = document.getElementById("live-scoreboard");

    // Mirrors showStage() in js/main.js. Kept as its own copy on purpose:
    // main.js boots the whole app on import (auth, Supabase, the home screen),
    // which cannot run here, so the alternative is not testing the rule at
    // all. If the two drift, the "declared stage exists in the page" check
    // below is what catches it.
    const showStage = (name) => {
      for (const el of stage.querySelectorAll("[data-stage]")) {
        el.classList.toggle("hidden", el.dataset.stage !== name);
      }
    };
    const visible = () =>
      [...stage.querySelectorAll("[data-stage]")]
        .filter((el) => !el.classList.contains("hidden"))
        .map((el) => el.dataset.stage);

    const openingLabel = () => {
      const w = activeSport().labels.opening || "";
      return w.charAt(0).toUpperCase() + w.slice(1);
    };

    // ---- the shipped markup commits to NO sport ---------------------------
    // The bug this catches is not "showStage is wrong" - showStage was always
    // right. It is that the game screen could be PAINTED before showStage ran,
    // and the markup had already picked a side: the court shipped without
    // `hidden`, so the default stage was basketball. Online football awaits a
    // cold-starting Edge Function for seconds between showing the screen and
    // playing the result, and sat on a basketball court for all of it.
    //
    // Asserted on the page as loaded, before this harness has toggled
    // anything, so it fails if any stage is ever given back its default
    // visibility.
    const initiallyVisible = visible();
    check(
      "no stage is visible until a sport chooses one",
      initiallyVisible.length === 0,
      initiallyVisible.length ? `visible on load: ${initiallyVisible.join(",")}` : "all stages start hidden"
    );

    // ---- every live sport declares a stage that the page actually has -----
    // A stage either resolves to an element on the page or is the one name
    // that deliberately has none. Basketball's live stage is "board": the
    // scoreboard IS the stage, and it lives outside this rotation because
    // every sport shows it - so "board" correctly reveals no field art at all.
    // Spelled out as an allow-list rather than "missing is fine", because
    // "missing is fine" is how a typo becomes a blank screen.
    const ARTLESS_STAGES = new Set(["board"]);
    const declared = {};
    for (const id of ["nba", "nfl"]) {
      setActiveSport(id);
      declared[id] = activeSport().presentation?.stage;
      const resolves = !!stage.querySelector(`[data-stage="${declared[id]}"]`);
      check(
        `${id.toUpperCase()} declares a stage the page provides`,
        !!declared[id] && (resolves || ARTLESS_STAGES.has(declared[id])),
        `stage=${declared[id]}${resolves ? "" : " (artless by declaration)"}`
      );
    }

    // ---- NBA: court, and no field ----------------------------------------
    setActiveSport("nba");
    showStage(activeSport().presentation.stage);
    // Basketball shows NO field art at any point: the board is the whole
    // stage. There is no court to reveal - it was removed, not hidden.
    check("NBA plays on the board, with no field art at all", visible().length === 0, `visible: ${visible().join(",") || "none"}`);
    check(
      "the court is gone from the page, not merely hidden",
      !stage.querySelector('[data-stage="court"]') && !document.querySelector(".court"),
      stage.querySelector('[data-stage="court"]') ? "a court element is still in the DOM" : "no court element exists"
    );
    check(
      "NBA opens on Tip-off",
      openingLabel() === "Tip-off",
      openingLabel()
    );

    // ---- NFL: field, and the court is GONE, not merely covered -----------
    setActiveSport("nfl");
    showStage(activeSport().presentation.stage);

    check("NFL shows the field and nothing else", visible().join(",") === "field", `visible: ${visible().join(",") || "none"}`);
    check(
      "NFL opens on Kickoff, not Tip-off",
      openingLabel() === "Kickoff",
      openingLabel()
    );

    // The scoreboard's status line is where "Tip-off" was hardcoded, so it is
    // asserted on the rendered DOM rather than on the helper alone.
    renderScoreboard(board, "A", "B", [], 4, 0, 0, openingLabel(), true);
    check(
      "NFL scoreboard shows no basketball opening language",
      !/tip.?off/i.test(board.textContent) && /kickoff/i.test(board.textContent),
      board.textContent.replace(/\s+/g, " ").trim().slice(0, 80)
    );

    // ---- switching back leaves nothing behind ----------------------------
    setActiveSport("nba");
    showStage(activeSport().presentation.stage);
    check(
      "switching NFL -> NBA leaves no stale field",
      visible().length === 0,
      `visible: ${visible().join(",") || "none"}`
    );
    renderScoreboard(board, "A", "B", [], 4, 0, 0, openingLabel(), true);
    check(
      "switching back restores basketball's opening word",
      /tip.?off/i.test(board.textContent),
      board.textContent.replace(/\s+/g, " ").trim().slice(0, 80)
    );

    // ---- the live box score can hold this sport's stats -------------------
    // The seed used to be basketball's six literals, so football's columns had
    // no key behind them and the live table sat at zero all game.
    for (const id of ["nba", "nfl"]) {
      setActiveSport(id);
      const sport = activeSport();
      const line = { pts: 0 };
      for (const key of sport.lineKeys) line[key] = 0;
      // Every column the sport draws, including the ones inside its box
      // GROUPS - football splits its table into offence/defence/kicking, and a
      // column that only appears in a group still needs somewhere to
      // accumulate. Derived columns are skipped: they are computed from other
      // keys at render time and deliberately have no stored key of their own.
      const drawn = [
        ...sport.boxColumns.map((col) => col),
        ...(sport.boxGroups || []).flatMap((g) => g.columns),
      ];
      const missing = [...new Set(
        drawn.filter(([, , derive]) => typeof derive !== "function").map(([key]) => key)
      )].filter((key) => !(key in line));
      check(
        `${id.toUpperCase()} live box score has a key for every column it draws`,
        missing.length === 0,
        missing.length ? `no key for: ${missing.join(" ")}` : `${new Set(drawn.map(([k]) => k)).size} columns covered`
      );
    }

    return checks;
  });
}

/**
 * The half of the rule a DOM test cannot reach.
 *
 * The checks above prove the stages are correct once something sets them.
 * They passed throughout the entire life of the bug, because the defect was
 * ORDERING: the online flow showed the game screen, then awaited the server,
 * and only set the stage when the result came back. Nothing in the page can
 * observe that - js/main.js boots the whole app on import (auth, Supabase,
 * the home screen), so the harness above deliberately blocks it and works on
 * markup alone.
 *
 * So this reads the source. Crude, and it earns its place: the rule it
 * protects is "the stage is decided before the screen is shown", and the only
 * evidence of that rule is the order of two calls in a file the browser test
 * is not allowed to run.
 */
async function checkStageIsSetBeforeTheScreenIsShown() {
  const raw = await readFile(path.join(ROOT, "js", "main.js"), "utf8");
  // Comments in this file quote these very call sites while explaining the
  // ordering, so scanning the raw text finds prose and reports it as code.
  // Blanked rather than deleted so byte offsets still point at real source.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + m.slice(p.length).replace(/./g, " "));
  const out = [];

  // resetGameScreen is the one place that knows the screen is being prepared
  // for a sport, so it is where the stage is chosen. If that call goes away,
  // every flow silently inherits whatever the last game left behind.
  const reset = src.match(/function resetGameScreen\(\)\s*\{[\s\S]*?\n\}/);
  out.push({
    name: "resetGameScreen sets the stage",
    ok: !!reset && /showStage\(/.test(reset[0]),
    detail: reset ? (/showStage\(/.test(reset[0]) ? "calls showStage" : "does NOT call showStage") : "resetGameScreen not found",
  });

  // Every route onto the game screen has to have chosen a stage first. Checked
  // by position rather than by reading the flow: for each showScreen("game"),
  // the nearest preceding resetGameScreen must be closer than the nearest
  // preceding showScreen("game"), i.e. this entry reset the screen itself.
  const shows = [...src.matchAll(/showScreen\("game"\)/g)].map((m) => m.index);
  const resets = [...src.matchAll(/resetGameScreen\(\)/g)].map((m) => m.index);
  const unguarded = shows.filter((at) => {
    const priorReset = resets.filter((r) => r < at).pop();
    if (priorReset === undefined) return true;
    // Anything between the reset and the reveal other than whitespace and a
    // comment means these are not the same entry into the screen.
    return !/^[\s;]*$/.test(src.slice(priorReset + "resetGameScreen()".length, at).replace(/\/\/[^\n]*/g, ""));
  });
  out.push({
    name: 'every showScreen("game") resets the screen first',
    ok: shows.length > 0 && unguarded.length === 0,
    detail: shows.length
      ? unguarded.length
        ? `${unguarded.length} of ${shows.length} reveal the screen without resetting it (offsets ${unguarded.join(", ")})`
        : `${shows.length} call sites, all reset first`
      : 'no showScreen("game") call sites found - has the screen been renamed?',
  });

  return out;
}

async function main() {
  const port = Number(process.env.BK_STAGE_PORT || 8937);
  const server = await serve(ROOT, port);
  console.log(renderSection("Game-screen stage per sport (real Chromium, real markup)"));

  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  let checks = [];
  try {
    // The real index.html, so the stages under test are the ones that ship.
    // Scripts are blocked so the app does not boot: this is about markup and
    // declarations, and a half-started app would only add noise.
    await page.route("**/js/main.js*", (r) => r.fulfill({ body: "", contentType: "text/javascript" }));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    checks = await runInPage(page);
  } catch (e) {
    checks.push({ name: "harness ran", ok: false, detail: e.message });
  }

  checks.push(...(await checkStageIsSetBeforeTheScreenIsShown()));

  checks.push({
    name: "no page errors",
    ok: pageErrors.length === 0,
    detail: pageErrors.slice(0, 3).join(" | ") || "clean",
  });

  await browser.close();
  server.close();

  const report = checks.map((c) => ({ title: c.name, status: c.ok ? PASS : FAIL, detail: c.detail }));
  for (const c of report) console.log(renderCheck(c));
  const { counts, ok } = summarize(report);
  console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
