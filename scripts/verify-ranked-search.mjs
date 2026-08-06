// Browser regression coverage for the draft pool shared by Quick Play,
// Ranked Practice, and Online Ranked. This deliberately runs renderPool in a
// real Chromium page: testing resolveTypedInput alone cannot catch a DOM
// rendering exception (the regression this test was added for).

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(ROOT, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(`${ROOT}${path.sep}`)) return res.writeHead(403).end("forbidden");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end("not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { setActiveSport } = await import("/js/sports/index.js");
    const { NBA } = await import("/js/sports/nba/index.js");
    const { buildSquads } = await import("/js/draft.js");
    const { renderPool } = await import("/js/ui.js");
    setActiveSport("nba");

    const squads = buildSquads(NBA.players());
    const squad = squads.find((s) => s.team === "Denver Nuggets" && s.decade === "2020s");
    if (!squad) throw new Error("Denver Nuggets 2020s squad is missing");

    const renderMode = (mode, ruleset, query) => {
      const pool = document.createElement("div");
      pool.dataset.mode = mode;
      document.body.appendChild(pool);
      renderPool(pool, squad, query, {}, null, () => {}, NBA.players(), ruleset,
        ruleset === "easy" ? NBA.slots.quickPlay : NBA.slots.ranked, () => {});
      const names = [...pool.querySelectorAll(".player-card-name")].map((el) => el.childNodes[0].textContent);
      return { mode, cardCount: names.length, names };
    };

    // Both ranked modes intentionally use the same strict renderPool branch;
    // Quick Play uses the easy branch of that same component.
    return [
      renderMode("Quick Play", "easy", "jok"),
      renderMode("Ranked Practice", "strict", "jok"),
      renderMode("Online Ranked", "strict", "jok"),
    ];
  });

  for (const mode of result) {
    if (!mode.names.some((name) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("Jokic"))) {
      throw new Error(`${mode.mode} rendered no Nikola Jokic card: ${JSON.stringify(mode)}`);
    }
  }
  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(" | ")}`);
  console.log(`Ranked player-list rendering verified in Chromium: ${result.map((r) => `${r.mode} (${r.cardCount})`).join(", ")}.`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
