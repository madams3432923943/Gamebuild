#!/usr/bin/env node
// THE ROTATION SCREEN READS AS TWO GROUPS: the starters, and the men who spell
// them.
//
// WHY THIS EXISTS
//
// .rotation-grid used to fill ROW-WISE, so a ten-man rotation read PG, SG /
// SF, PF / C, Bench / Bench, Bench - the five who start interleaved down both
// columns with the five who do not. Nobody thinks about a rotation that way,
// and nothing in the suite would have noticed: the screen rendered, every
// slider worked, the budget held. A layout bug of this kind is invisible to
// every check that does not measure where things actually land, which is why
// this one measures geometry rather than markup.
//
// The fix is split across two files - the ordering and --rotation-rows in
// js/ui/strategy.js, `grid-auto-flow: column` in css/style.css - and either
// half alone produces a wrong screen rather than an obviously broken one. That
// is the other reason to pin it here.
//
// WHAT IT CHECKS
//
//   1. On a laptop, the five starters run down one column and the bench down
//      the other.
//   2. On a phone it collapses to ONE column with the starters first, and the
//      page does not scroll sideways. Column flow into a single column would
//      otherwise leave the bench wherever the row count ran out.
//   3. The 240-minute budget is still structurally unbreakable. The layout was
//      deliberately built on one grid rather than two sibling containers so
//      that the minute-coupling in renderRotationPicker could not be forked;
//      this is the check that says it was not.
//
// It drives the REAL renderRotationPicker against the REAL stylesheet through
// a small harness page, rather than the full draft flow, so it costs seconds
// rather than the selftest's minutes.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { serveStatic } from "./selftest/static-server.mjs";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.BK_ROTATION_PORT || 8947);
const HARNESS = `http://127.0.0.1:${PORT}/scripts/selftest/rot-harness.html`;

// The centre column of the draft board is about 475px on a 1366px laptop, which
// is the width the 14rem track in .rotation-grid was measured against.
const LAPTOP = 1366;
const PHONE = 360;

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

const server = await serveStatic(ROOT, PORT);
const browser = await chromium.launch();
const errors = [];

/** Opens the harness at a width and reports where every player's cell landed. */
async function openAt(width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", (e) => errors.push(`${width}px: ${String(e.message).slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${width}px: ${m.text().slice(0, 200)}`);
  });
  await page.goto(HARNESS, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__ready === true", null, { timeout: 20000 });
  return page;
}

/** Each rotation cell, with the column it landed in and whether it is a
 * reserve. A starter's label opens with his slot (PG/SG/SF/PF/C); a reserve's
 * opens with the word Bench. */
const cellsOf = (page) => page.$$eval(".rotation-cell", (els) => els.map((el) => {
  const box = el.getBoundingClientRect();
  const label = el.querySelector(".rotation-label")?.textContent?.trim() || "";
  return { bench: label.startsWith("Bench"), x: Math.round(box.x), y: Math.round(box.y) };
}));

try {
  console.log(renderSection("Rotation screen (starters and bench, laptop and phone)"));

  // ---- 1. two columns, grouped ---------------------------------------------
  {
    const page = await openAt(LAPTOP);
    const cells = await cellsOf(page);
    const columns = [...new Set(cells.map((c) => c.x))].sort((a, b) => a - b);
    const left = cells.filter((c) => c.x === columns[0]);
    const right = cells.filter((c) => c.x === columns[1]);
    const grouped =
      columns.length === 2 &&
      left.length > 0 && right.length > 0 &&
      left.every((c) => !c.bench) &&
      right.every((c) => c.bench);
    check(
      "The starters run down one column and the bench down the other",
      grouped,
      `${columns.length} column(s); left ${left.length} cell(s) (${left.filter((c) => c.bench).length} bench), ` +
      `right ${right.length} cell(s) (${right.filter((c) => c.bench).length} bench)`
    );
    // Reading ORDER within the starters column, because a correct grouping
    // dealt in the wrong order is still the wrong screen.
    const descending = left.every((c, i) => i === 0 || c.y > left[i - 1].y);
    check("Each column reads top to bottom", descending, `${left.length} starters in y order`);
    await page.close();
  }

  // ---- 2. one column on a phone, starters first ----------------------------
  {
    const page = await openAt(PHONE);
    const cells = await cellsOf(page);
    const columns = [...new Set(cells.map((c) => c.x))];
    const order = [...cells].sort((a, b) => a.y - b.y);
    const startersFirst = order.every((c, i) => (c.bench ? true : order.slice(0, i).every((p) => !p.bench)));
    check(
      "A phone gets one column with the starters first",
      columns.length === 1 && startersFirst,
      `${columns.length} column(s), order ${order.map((c) => (c.bench ? "B" : "S")).join("")}`
    );
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    check("Nothing scrolls sideways at 360px", !sideways, sideways ? "the page scrolls horizontally" : "no horizontal scroll");
    await page.close();
  }

  // ---- 3. the budget is still unbreakable ----------------------------------
  {
    const page = await openAt(LAPTOP);
    // Drag ONE slider to the top of its range. Every other slider's cap has to
    // fall with it, so the total cannot pass the budget - that coupling is the
    // reason this screen is one grid rather than two.
    const spent = await page.evaluate(() => {
      const sliders = [...document.querySelectorAll(".rotation-slider")];
      const before = sliders.reduce((sum, s) => sum + Number(s.value), 0);
      sliders[0].value = sliders[0].max;
      sliders[0].dispatchEvent(new Event("input", { bubbles: true }));
      return { before, after: sliders.reduce((sum, s) => sum + Number(s.value), 0) };
    });
    const budget = await page.evaluate(() => window.__rotationBudget);
    check(
      "Dragging a starter to his maximum cannot break the minute budget",
      spent.before === budget && spent.after <= budget,
      `${spent.before} -> ${spent.after} of ${budget} minutes`
    );
    await page.close();
  }

  check("The screen renders without a console error", errors.length === 0, errors.join(" | ") || "none");
} catch (e) {
  check("the harness ran", false, e.message);
}

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);

await browser.close();
server.close();
process.exit(ok ? 0 : 1);
