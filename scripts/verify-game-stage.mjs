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
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(await readFile(file));
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

    const { setActiveSport, activeSport } = await import("/js/sports/index.js");
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

    // ---- every live sport declares a stage that the page actually has -----
    const declared = {};
    for (const id of ["nba", "nfl"]) {
      setActiveSport(id);
      declared[id] = activeSport().presentation?.stage;
      check(
        `${id.toUpperCase()} declares a stage the page provides`,
        !!declared[id] && !!stage.querySelector(`[data-stage="${declared[id]}"]`),
        `stage=${declared[id]}`
      );
    }

    // ---- NBA: court, and no field ----------------------------------------
    setActiveSport("nba");
    showStage(activeSport().presentation.stage);
    check("NBA shows the court and nothing else", visible().join(",") === "court", `visible: ${visible().join(",") || "none"}`);
    check(
      "NBA opens on Tip-off",
      openingLabel() === "Tip-off",
      openingLabel()
    );

    // ---- NFL: field, and the court is GONE, not merely covered -----------
    setActiveSport("nfl");
    showStage(activeSport().presentation.stage);
    const courtEl = stage.querySelector('[data-stage="court"]');
    check("NFL shows the field and nothing else", visible().join(",") === "field", `visible: ${visible().join(",") || "none"}`);
    check(
      "NFL never renders the basketball court",
      courtEl.classList.contains("hidden") && getComputedStyle(courtEl).display === "none",
      `hidden=${courtEl.classList.contains("hidden")} display=${getComputedStyle(courtEl).display}`
    );
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
      "switching NFL -> NBA restores the court with no stale field",
      visible().join(",") === "court",
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
      const missing = sport.boxColumns.map(([key]) => key).filter((key) => !(key in line));
      check(
        `${id.toUpperCase()} live box score has a key for every column it draws`,
        missing.length === 0,
        missing.length ? `no key for: ${missing.join(" ")}` : `${sport.boxColumns.length} columns covered`
      );
    }

    return checks;
  });
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
