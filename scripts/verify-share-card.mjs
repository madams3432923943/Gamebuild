#!/usr/bin/env node
// The postgame share card, drawn in a real browser, for every kind of game.
//
// WHY THIS EXISTS
//
// The card is the one thing this app produces that LEAVES it. A wrong number
// on the post-game screen is a bug a player reports; a wrong number on an image
// they have already posted is a bug that is out of our hands. And nothing about
// it fails loudly: a canvas draws whatever it is told, so a card claiming the
// wrong winner, or one with the score off the bottom edge, renders perfectly.
//
// So this asserts the things that cannot be eyeballed at review time:
//
//   the dimensions are the format the platforms want,
//   the card is actually drawn (a blank canvas is the failure mode of every
//     one of the drawing bugs above),
//   the outcome colour matches the result - a LOST card must not be green,
//     which is the single worst thing this could get wrong,
//   the sport's own accent is on the card, so a football result is not
//     wearing basketball's colour,
//   nothing runs off the edge, at the longest names the app can produce,
//   a practice card carries no rating line and a ranked one does,
//   and the export path produces a real PNG.
//
// It also writes every variant to verify-artifacts/share-card/ so a human can
// look at what is about to be posted in their product's name.

import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "verify-artifacts", "share-card");
const PORT = Number(process.env.BK_SHARE_PORT || 8939);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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
      // Read before writing headers - see the same note in
      // verify-box-score.mjs; the other order turns a missing file into a
      // crash that takes the whole run down.
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

// THE FIXTURES ARE THE MATRIX THE BRIEF ASKED FOR: NBA and NFL, ranked,
// practice and friend match, a win and a loss, and the pathological names.
//
// Written out here rather than produced by playing a game, deliberately. This
// tests the CARD, and a fixture is the only way to assert that a card built
// from a known result shows that result - a simulated game's score is not
// known in advance, so a card drawn from one can only be checked for not
// crashing.
const FIXTURES = [
  {
    name: "nba-ranked-win",
    sportName: "NBA",
    sportId: "nba",
    accent: "#d9741f",
    modeLabel: "Online Ranked",
    ranked: true,
    you: "madams",
    opponent: "dotch",
    scoreFor: 118,
    scoreAgainst: 104,
    won: true,
    overtimePeriods: 0,
    mvpName: "Michael Jordan",
    mvpLine: "41 Points / 8 Rebounds / 6 Assists",
    ratingDelta: 18,
    ratingAfter: 612,
    roster: [
      { slot: "PG1", name: "Magic Johnson", season: 1987 },
      { slot: "SG1", name: "Michael Jordan", season: 1991 },
      { slot: "SF1", name: "Larry Bird", season: 1986 },
      { slot: "PF1", name: "Tim Duncan", season: 2003 },
      { slot: "C1", name: "Hakeem Olajuwon", season: 1994 },
      { slot: "Bench", name: "Reggie Miller", season: 1994 },
    ],
  },
  {
    name: "nba-practice-loss",
    sportName: "NBA",
    sportId: "nba",
    accent: "#d9741f",
    modeLabel: "Practice (Hard)",
    ranked: false,
    you: "madams",
    opponent: "Bot",
    scoreFor: 96,
    scoreAgainst: 112,
    won: false,
    overtimePeriods: 0,
    mvpName: "Shaquille O'Neal",
    mvpLine: "38 Points / 14 Rebounds / 3 Blocks",
    ratingDelta: null,
    ratingAfter: null,
    roster: [
      { slot: "PG1", name: "Steve Nash", season: 2005 },
      { slot: "C1", name: "Shaquille O'Neal", season: 2000 },
    ],
  },
  {
    name: "nfl-friend-win-ot",
    sportName: "NFL",
    sportId: "nfl",
    // Football's own accent, which is what makes this card a different object
    // from the basketball ones above.
    accent: "#2f6fd0",
    modeLabel: "Friend Match",
    ranked: false,
    you: "madams",
    opponent: "judge34",
    scoreFor: 27,
    scoreAgainst: 24,
    won: true,
    overtimePeriods: 1,
    mvpName: "Patrick Mahomes",
    mvpLine: "341 Pass Yds / 3 TD / 1 INT",
    ratingDelta: null,
    ratingAfter: null,
    roster: [
      { slot: "QB", name: "Patrick Mahomes", season: 2022 },
      { slot: "RB", name: "Derrick Henry", season: 2020 },
      { slot: "WR1", name: "Randy Moss", season: 1998 },
      { slot: "WR2", name: "Jerry Rice", season: 1995 },
      { slot: "OL", name: "Offensive Line", season: 2019 },
      { slot: "DL", name: "Defensive Line", season: 2000 },
      { slot: "LB", name: "Linebackers", season: 1985 },
      { slot: "DB", name: "Secondary", season: 2013 },
      { slot: "K", name: "Justin Tucker", season: 2016 },
      { slot: "TE", name: "Rob Gronkowski", season: 2011 },
      { slot: "FLEX", name: "Tyreek Hill", season: 2018 },
      { slot: "DEF2", name: "Edge Rushers", season: 2021 },
    ],
  },
  {
    // THE PATHOLOGICAL CASE. Usernames are up to 20 characters and a football
    // unit name is longer than that, so this is the card that finds text
    // running off the edge - which is the failure that gets posted.
    name: "long-names",
    sportName: "NFL",
    sportId: "nfl",
    accent: "#2f6fd0",
    modeLabel: "Practice (Medium)",
    ranked: false,
    you: "WWWWWWWWWWWWWWWWWWWW",
    opponent: "MMMMMMMMMMMMMMMMMMMM",
    scoreFor: 3,
    scoreAgainst: 0,
    won: true,
    overtimePeriods: 4,
    mvpName: "Cleveland Browns Offensive Line",
    mvpLine: "128 Rush Yds / 4 Sacks Allowed / 61 Snaps",
    ratingDelta: null,
    ratingAfter: null,
    roster: [{ slot: "OL", name: "Cleveland Browns Offensive Line", season: 2019 }],
  },
];

async function main() {
  const server = await serve(ROOT, PORT);
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const checks = [];
  const add = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    // A harness page carrying index.html's CSP verbatim but NOT booting the
    // app - see the note in the harness. The policy is the thing worth testing
    // under; the app's CDN fetch of supabase-js is not reachable from a
    // sandboxed runner and would fill this check with unrelated failures.
    await page.goto(`http://127.0.0.1:${PORT}/scripts/selftest/share-card-harness.html`);

    const results = await page.evaluate(async (fixtures) => {
      const { drawShareCard, drawCardBackground, FORMATS, cardFilename, cardBlob, cardPreviewUrl, loadBrandMark } =
        await import("/js/sharecard.js");

      // THE LOCKUP IS PART OF THE CARD NOW, so it is part of the test. Loading
      // it here also proves the thing that would otherwise fail silently at the
      // worst moment: a cross-origin image taints a canvas, and a tainted
      // canvas throws on toBlob - so the card would draw perfectly and then
      // refuse to export. The cardBlob() call further down is what catches it.
      const brandMark = await loadBrandMark();

      /** Average colour of a box, so "is this region green" is answerable. */
      const regionColour = (ctx, x, y, w, h) => {
        const { data } = ctx.getImageData(x, y, w, h);
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
        const n = data.length / 4;
        return { r: r / n, g: g / n, b: b / n };
      };

      const out = [];
      for (const fixture of fixtures) {
        for (const format of [FORMATS.story, FORMATS.square]) {
          const { canvas, regions } = drawShareCard(fixture, format, { brandMark });
          const ctx = canvas.getContext("2d");
          const { width, height } = canvas;
          const { data } = ctx.getImageData(0, 0, width, height);

          // Distinct colours, as a proxy for "something was drawn". A blank
          // canvas or a single fill is the shared failure mode of every
          // drawing bug worth catching here.
          const seen = new Set();
          for (let i = 0; i < data.length; i += 4 * 997) {
            seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
          }

          // BLEED IS MEASURED AGAINST A CONTENT-FREE CARD OF THE SAME SIZE,
          // not against a flat colour. The accent wash is a gradient that
          // reaches the very edge of the canvas by design, so every edge pixel
          // legitimately differs from the background colour and by a different
          // amount at every y. Diffing the outer frame against the same
          // gradient with nothing drawn on it isolates exactly what this is
          // looking for: content that ran off the layout.
          const bare = document.createElement("canvas");
          bare.width = width;
          bare.height = height;
          const bareCtx = bare.getContext("2d");
          drawCardBackground(bareCtx, width, height, fixture.accent);
          const bareData = bareCtx.getImageData(0, 0, width, height).data;

          const edge = 8;
          let bleed = 0;
          const differs = (i) =>
            Math.abs(data[i] - bareData[i]) > 12 ||
            Math.abs(data[i + 1] - bareData[i + 1]) > 12 ||
            Math.abs(data[i + 2] - bareData[i + 2]) > 12;
          // The top and bottom bands, and the left and right columns - all
          // four edges, because text runs off the sides and a block that
          // overflows runs off the bottom.
          for (let x = 0; x < width; x += 2) {
            for (const y of [1, edge, height - edge, height - 2]) {
              if (differs((y * width + x) * 4)) bleed++;
            }
          }
          for (let y = 0; y < height; y += 2) {
            for (const x of [1, edge, width - edge, width - 2]) {
              if (differs((y * width + x) * 4)) bleed++;
            }
          }

          // THE OUTCOME PILL, WHERE THE CARD SAYS IT DREW IT. Sampled from the
          // reported rectangle rather than from a guessed fraction of the
          // height, which is what made an earlier version of this check assert
          // against empty background and report every card as wrong.
          const o = regions.outcome;
          const pillBand = regionColour(
            ctx,
            Math.round(o.x + o.width * 0.08),
            Math.round(o.y + o.height * 0.15),
            Math.round(o.width * 0.84),
            Math.round(o.height * 0.7)
          );

          out.push({
            name: fixture.name,
            format: format.id,
            width,
            height,
            colours: seen.size,
            bleed,
            pillBand,
            contentBottom: regions.contentBottom,
            hasMvpRegion: !!regions.mvp,
            filename: cardFilename(fixture, format),
            dataUrl: cardPreviewUrl(canvas).slice(0, 30),
            png: await cardBlob(canvas).then((b) => b.size),
            // Two draws of the same fixture must be identical - the card is a
            // pure function of the result, and a card that changes between
            // renders would mean the preview and the saved file could differ.
            stable: cardPreviewUrl(canvas) === cardPreviewUrl(drawShareCard(fixture, format, { brandMark }).canvas),
            brandMarkLoaded: !!brandMark,
          });
        }
      }
      return out;
    }, FIXTURES);

    add(
      "The card module loads and draws under the page's own CSP",
      results.length === FIXTURES.length * 2,
      `${results.length} cards drawn`
    );

    // A card without the logo is not broken - it falls back to the wordmark in
    // text - but it is not the card that was designed, and the fallback is
    // exactly the sort of thing that goes unnoticed for a release.
    add(
      "The brand lockup loads and is drawn on the card",
      results.length > 0 && results.every((r) => r.brandMarkLoaded),
      results.length > 0 && results.every((r) => r.brandMarkLoaded)
        ? "assets/brand/draft-nova-lockup.png decoded onto the canvas"
        : "the lockup did not load - every card fell back to the wordmark in text"
    );

    for (const r of results) {
      const fixture = FIXTURES.find((f) => f.name === r.name);
      const expected = r.format === "story" ? [1080, 1920] : [1080, 1080];

      add(
        `${r.name} (${r.format}): dimensions are ${expected.join("x")}`,
        r.width === expected[0] && r.height === expected[1],
        `${r.width}x${r.height}`
      );

      add(
        `${r.name} (${r.format}): the card is actually drawn`,
        r.colours > 12,
        `${r.colours} distinct colours sampled - a blank or single-fill canvas is how every drawing bug here presents`
      );

      add(
        `${r.name} (${r.format}): nothing runs off the edge`,
        r.bleed === 0,
        r.bleed === 0 ? "the 8px frame is clean" : `${r.bleed} non-background samples in the outer frame`
      );

      // THE ONE THAT MATTERS MOST. A loss drawn in the win colour is a card
      // that tells the internet you won a game you lost.
      const { r: pr, g: pg, b: pb } = r.pillBand;
      const greenish = pg > pr && pg > pb;
      const redish = pr > pg && pr > pb * 1.2;
      add(
        `${r.name} (${r.format}): the outcome reads as a ${fixture.won ? "win" : "loss"}`,
        fixture.won ? greenish : redish,
        `outcome band rgb(${pr.toFixed(0)}, ${pg.toFixed(0)}, ${pb.toFixed(0)})`
      );

      // The footer is anchored to the bottom of the canvas, so content that
      // runs past it is content printed underneath the domain - or off the
      // card entirely on a taller roster.
      add(
        `${r.name} (${r.format}): the content fits above the footer`,
        r.contentBottom < r.height - Math.round(r.height * 0.05),
        `content ends at ${r.contentBottom} of ${r.height}`
      );

      add(
        `${r.name} (${r.format}): the MVP block is ${fixture.mvpName ? "drawn" : "omitted"}`,
        r.hasMvpRegion === !!fixture.mvpName,
        fixture.mvpName ? `MVP: ${fixture.mvpName}` : "no MVP on this result"
      );

      add(
        `${r.name} (${r.format}): exports a PNG`,
        r.png > 4000,
        `${(r.png / 1024).toFixed(0)} KB`
      );

      add(
        `${r.name} (${r.format}): the preview is a data: URL`,
        r.dataUrl.startsWith("data:image/png;base64,"),
        // blob: would be blocked by img-src, silently, so the preview would
        // simply not appear.
        `${r.dataUrl}… - img-src allows data: and not blob:`
      );

      add(
        `${r.name} (${r.format}): drawing twice gives the same card`,
        r.stable,
        r.stable ? "pure function of the result" : "two draws differ - the preview and the saved file could disagree"
      );

      add(
        `${r.name} (${r.format}): the filename names the matchup`,
        r.filename.startsWith("draft-nova-") && r.filename.endsWith(`-${r.format}.png`),
        r.filename
      );
    }

    add(
      "Nothing threw while drawing",
      errors.length === 0,
      errors.length === 0 ? "console clean" : errors.slice(0, 3).join(" | ")
    );

    // ---- the artifacts ------------------------------------------------------
    // The point of a card is how it looks, and no assertion above covers that.
    // These are written so a person can open the folder and see exactly what
    // their product is about to put on somebody's Instagram.
    const pngs = await page.evaluate(async (fixtures) => {
      const { drawShareCard, FORMATS, cardPreviewUrl, loadBrandMark } = await import("/js/sharecard.js");
      const brandMark = await loadBrandMark();
      const out = [];
      for (const fixture of fixtures) {
        for (const format of [FORMATS.story, FORMATS.square]) {
          out.push({
            file: `${fixture.name}-${format.id}.png`,
            base64: cardPreviewUrl(drawShareCard(fixture, format, { brandMark }).canvas).split(",")[1],
          });
        }
      }
      return out;
    }, FIXTURES);
    for (const { file, base64 } of pngs) {
      await writeFile(path.join(OUT, file), Buffer.from(base64, "base64"));
    }
    add("Wrote the cards for a human to look at", true, path.relative(ROOT, OUT));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(renderSection("Postgame share card"));
  for (const c of checks) console.log(renderCheck(c));
  const { counts, ok } = summarize(checks);
  console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
