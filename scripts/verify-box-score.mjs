#!/usr/bin/env node
// Box-score rendering, per sport, in a real browser.
//
// WHY THIS EXISTS
//
// boxTable() computed its shooting-split columns into a local `splits`, wrote
// the <thead> from it, and then handed boxRow() a `showSplits` that was never
// declared. That is a ReferenceError in a module, and it was masked by a
// `globalThis.showSplits = []` planted in js/celebrate.js - an unrelated file -
// which stopped the crash and left every NBA box score emitting three header
// columns (FG, 3PT, FT) with no cells under them. The table was misaligned,
// not merely missing numbers, and it looked deliberate enough to survive.
//
// The general rule this enforces: a sport's box score renders exactly the
// columns that sport declares, and every row carries the same number of cells
// as the header. Shooting splits are basketball's and only basketball's, so
// NFL must show none of them - the football box score going misaligned in the
// other direction would be the same bug wearing the other sport's colours.

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
    const section = (label, fn) => {
      try {
        return fn();
      } catch (e) {
        check(label, false, `threw: ${e.message}`);
        return null;
      }
    };

    const { setActiveSport, activeSport } = await import("/js/sports/index.js");
    const { DraftState } = await import("/js/draft.js");
    const { renderFullBoxScore, buildShotLines } = await import("/js/ui.js");
    // Imported for its SIDE EFFECT, not its exports. The workaround this
    // change removes lived at module scope in celebrate.js and defined a
    // global that ui.js then read; without loading it, the "no global
    // survives" check below would pass whether or not the workaround came
    // back. The app loads this module, so the test has to as well.
    await import("/js/celebrate.js");

    const host = document.getElementById("box");

    /**
     * Plays a real game of one sport and renders its FINAL box score - the
     * `final` flag is what turns shooting splits on, so a live-only render
     * would have missed this entirely.
     */
    const renderFinalBoxScore = (sportId) => {
      setActiveSport(sportId);
      const sport = activeSport();
      const rows = sport.playersInEra(sport.players(), sport.defaultEra);
      const slots = sport.slots.quickPlay;

      // Fill both rosters the way verify-playable does, through the draft.
      const draft = new DraftState(rows, [], slots);
      let guard = 0;
      while (!draft.isComplete() && guard++ < slots.length * 8) {
        const squad = draft.rollNextSquad();
        if (!squad) break;
        for (const side of ["A", "B"]) {
          const roster = side === "A" ? draft.rosterA : draft.rosterB;
          for (const player of squad.players) {
            const open = slots.filter((s) => !roster[s]);
            let placed = false;
            for (const slot of open) {
              try {
                draft.makePick(side, player, slot);
                placed = true;
                break;
              } catch {
                /* not eligible there; try the next open slot */
              }
            }
            if (placed) break;
          }
        }
      }

      const ctx = sport.computeDatasetStats(sport.players(), sport.units?.());
      const result = sport.simulate(draft.rosterA, draft.rosterB, ctx, {});
      const { boxA, boxB } = result;
      const shotsA = sport.shotLine ? buildShotLines(draft.rosterA, boxA) : null;
      const shotsB = sport.shotLine ? buildShotLines(draft.rosterB, boxB) : null;

      renderFullBoxScore(host, draft.rosterA, boxA, "A", draft.rosterB, boxB, "B",
                         shotsA, shotsB, null, null, true);

      const table = host.querySelector(".box-table");
      const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
      const bodyRows = [...table.querySelectorAll("tbody tr")];
      const cellCounts = [...new Set(bodyRows.map((tr) => tr.querySelectorAll("td").length))];
      return { sport, headers, bodyRows, cellCounts, headerCount: headers.length };
    };

    // ---- NBA: the shooting splits are back, with cells under them ---------
    const nba = section("NBA box score renders FG/3PT/FT", () => renderFinalBoxScore("nba"));
    if (nba) {
      const wanted = ["FG", "3PT", "FT"];
      const present = wanted.filter((h) => nba.headers.includes(h));
      check(
        "NBA box score renders FG/3PT/FT columns",
        present.length === 3,
        `headers: ${nba.headers.join(" ")}`
      );

      // The header/body count is the assertion that actually catches this
      // bug. Headers alone were always right; it was the rows that were
      // three cells short, which is what made the table misaligned.
      check(
        "NBA rows carry one cell per header column",
        nba.cellCounts.length === 1 && nba.cellCounts[0] === nba.headerCount,
        `headers=${nba.headerCount} row cell counts=[${nba.cellCounts.join(",")}]`
      );

      // A made/attempted pair, not an empty placeholder for every player -
      // a table of "-" would satisfy the count check while still being the
      // silent failure this is here to stop.
      const fgIndex = nba.headers.indexOf("FG");
      const fgValues = nba.bodyRows.map((tr) => tr.querySelectorAll("td")[fgIndex]?.textContent.trim());
      const real = fgValues.filter((v) => /^\d+\/\d+$/.test(v || ""));
      check(
        "NBA FG cells hold real makes/attempts",
        real.length > 0,
        `${real.length}/${fgValues.length} rows, e.g. ${real.slice(0, 4).join(" ")}`
      );

      const expected = [
        "Slot", "Player",
        ...((nba.sport.rotationBudget || 0) > 0 ? ["MIN"] : []),
        ...nba.sport.boxColumns.map(([, h]) => h),
        ...(nba.sport.splitColumns || []).map(([, h]) => h),
      ];
      check(
        "NBA header is exactly the sport's declared contract",
        JSON.stringify(nba.headers) === JSON.stringify(expected),
        `rendered: ${nba.headers.join(" ")}\n         declared: ${expected.join(" ")}`
      );
    }

    // ---- NFL: football columns, and no basketball shooting columns --------
    const nfl = section("NFL box score has no shooting columns", () => renderFinalBoxScore("nfl"));
    if (nfl) {
      // NOT a blocklist of header text. NFL declares its own "FG" column and
      // it means field goals, so matching on the word would fail an entirely
      // correct football box score. What must be absent is basketball's
      // SHOOTING SPLITS - which NFL declares as none - plus the rotation
      // column, which belongs to sports that have a minutes budget.
      check(
        "NFL declares no shooting splits and renders none",
        (nfl.sport.splitColumns || []).length === 0 && !nfl.headers.includes("3PT") && !nfl.headers.includes("FT"),
        `splitColumns=${JSON.stringify(nfl.sport.splitColumns)} headers: ${nfl.headers.join(" ")}`
      );
      check(
        "NFL box score shows no MIN column (no rotation budget)",
        (nfl.sport.rotationBudget || 0) === 0 && !nfl.headers.includes("MIN"),
        `rotationBudget=${nfl.sport.rotationBudget}`
      );

      // The strongest form: the rendered header is exactly what the sport
      // declares, in order. Any leakage from shared code shows up here
      // whatever it is called.
      const expected = [
        "Slot", "Player",
        ...((nfl.sport.rotationBudget || 0) > 0 ? ["MIN"] : []),
        ...nfl.sport.boxColumns.map(([, h]) => h),
        ...(nfl.sport.splitColumns || []).map(([, h]) => h),
      ];
      check(
        "NFL header is exactly the sport's declared contract",
        JSON.stringify(nfl.headers) === JSON.stringify(expected),
        `rendered: ${nfl.headers.join(" ")}\n         declared: ${expected.join(" ")}`
      );
      check(
        "NFL rows carry one cell per header column",
        nfl.cellCounts.length === 1 && nfl.cellCounts[0] === nfl.headerCount,
        `headers=${nfl.headerCount} row cell counts=[${nfl.cellCounts.join(",")}]`
      );
    }

    // ---- the workaround is gone, and stays gone ---------------------------
    check(
      "no global showSplits binding survives",
      !("showSplits" in globalThis),
      "showSplits" in globalThis ? "globalThis.showSplits is still defined" : "clean"
    );

    return checks;
  });
}

async function main() {
  const port = Number(process.env.BK_BOX_SCORE_PORT || 8936);
  const server = await serve(ROOT, port);
  console.log(renderSection("Box-score rendering per sport (real Chromium, real data)"));

  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text());
  });

  let checks = [];
  try {
    await page.goto(`http://127.0.0.1:${port}/scripts/selftest/box-score-harness.html`);
    checks = await runInPage(page);
  } catch (e) {
    checks.push({ name: "harness ran", ok: false, detail: e.message });
  }

  checks.push({
    name: "no console or page errors",
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
