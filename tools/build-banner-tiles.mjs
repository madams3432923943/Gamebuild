#!/usr/bin/env node
/**
 * Builds the Rewards-grid tile variants from the shipped banner artwork.
 *
 * WHY THIS EXISTS
 *
 * tools/build-banner-art.mjs sizes every banner for the identity CARD - 2120x720,
 * 2x the ~1060px that card reaches on desktop. That is the right size for the
 * one banner a player has equipped, and the wrong size twenty times over for the
 * Rewards grid, where each tile draws at roughly 200px wide on a phone. The grid
 * was pulling 8.1 MB of full-size art to paint thumbnails, some files 640 KB
 * each. docs/banner-artwork.md has flagged this since the art landed.
 *
 * The tiles are exactly 1/5 of the card in both axes, so the aspect ratio is
 * identical and `cover` crops nothing differently between the two sizes. A tile
 * is never shown large: js/ui.js picks the full file for the card and the
 * matchup intro, and the tile only for the grid.
 *
 * INPUT IS THE SHIPPED ART, NOT THE ORIGINALS. Unlike build-banner-art.mjs this
 * needs no uncommitted source directory - it downsamples assets/banners/*.jpg,
 * which are in the repo. That means anyone can re-run it, and it re-runs
 * correctly after the artwork itself is rebuilt.
 *
 * USAGE
 *
 *     node tools/build-banner-tiles.mjs
 *
 * Rendering is Chromium's canvas, the same as build-banner-art.mjs - this repo
 * has no image library and does not need one for a resize and a re-encode.
 */

import { chromium } from "playwright";
import http from "node:http";
import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_DIR = "assets/banners";
const OUT_DIR = "assets/banners/tiles";
const PORT = Number(process.env.BANNER_TILE_PORT || 8994);

/** Exactly a fifth of the card's 2120x720, so the crop is identical and a tile
 *  stays sharp at the ~212px the grid reaches on a 2x phone. */
const WIDTH = 424;
const HEIGHT = 144;
/** Higher than the card's 0.9: at this size the file is small either way, and
 *  the grid is the first look a player gets at art they have not unlocked. */
const QUALITY = 0.82;

async function main() {
  const sources = (await readdir(SOURCE_DIR))
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort();

  if (!sources.length) {
    console.error(`No banner artwork in ${SOURCE_DIR}. Run tools/build-banner-art.mjs first.`);
    process.exit(1);
  }

  const server = http.createServer(async (req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    if (!rel) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>tile build</title>");
      return;
    }
    try {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(await readFile(path.join(ROOT, rel)));
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((r) => server.listen(PORT, r));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await mkdir(OUT_DIR, { recursive: true });

  let beforeTotal = 0;
  let afterTotal = 0;
  const rows = [["file", "card", "tile", "saved"]];

  for (const name of sources) {
    const srcPath = path.join(SOURCE_DIR, name);
    const before = (await stat(srcPath)).size;

    const dataUrl = await page.evaluate(
      async ({ url, w, h, quality }) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;
        await img.decode();

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        return canvas.toDataURL("image/jpeg", quality);
      },
      { url: `http://127.0.0.1:${PORT}/${srcPath}`, w: WIDTH, h: HEIGHT, quality: QUALITY }
    );

    const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
    await writeFile(path.join(OUT_DIR, name), bytes);

    beforeTotal += before;
    afterTotal += bytes.length;
    rows.push([
      name,
      `${Math.round(before / 1024)} KB`,
      `${Math.round(bytes.length / 1024)} KB`,
      `${Math.round((1 - bytes.length / before) * 100)}%`,
    ]);
  }

  await browser.close();
  server.close();

  const widths = rows.slice(1).reduce((acc, r) => r.map((c, i) => Math.max(acc[i] || 0, c.length)), []);
  for (const [i, r] of rows.entries()) {
    console.log("  " + r.map((c, j) => c.padEnd(widths[j])).join("  "));
    if (i === 0) console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
  }
  console.log(
    `\n  ${rows.length - 1} tiles at ${WIDTH}x${HEIGHT}, JPEG q${Math.round(QUALITY * 100)}: ` +
      `${(beforeTotal / 1048576).toFixed(1)} MB -> ${(afterTotal / 1024).toFixed(0)} KB ` +
      `(${Math.round((1 - afterTotal / beforeTotal) * 100)}% smaller)\n`
  );
}

await main();
