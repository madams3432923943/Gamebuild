#!/usr/bin/env node
/**
 * Builds the shipped banner artwork from the full-resolution originals.
 *
 * WHY THIS EXISTS
 *
 * The banners arrived as 2000-2200px PNGs, 1.1-3.4 MB each, 48 MB for the set.
 * The Rewards grid renders all twenty at once, so shipping them as uploaded
 * makes that screen a download rather than a page.
 *
 * Resizing alone does not help. These are photographic textures and PNG is
 * lossless, so a 2120x720 PNG still measures ~3.6 MB - bigger than several of
 * the originals. Measured, not assumed:
 *
 *     PNG 3885 KB | JPEG q90 639 KB | JPEG q82 477 KB | WebP q85 465 KB
 *
 * So the output is JPEG. q90 because the artwork is the product - at 90 the
 * difference is invisible on texture while the file is 6x smaller, and the
 * remaining ~25% WebP would save is not worth the compatibility question for a
 * format that every browser has read for thirty years. None of the banners has
 * transparency, so nothing is lost by leaving PNG behind.
 *
 * SOURCE FILES ARE NOT COMMITTED, deliberately - the same arrangement as
 * tools/seasons/*.csv (see tools/README.md). Keeping 48 MB of originals in the
 * repo would cost every clone forever to save a re-export. They live in
 * tools/banner-source/ locally, and the set as uploaded is recoverable from git
 * history at commit daa7589.
 *
 * USAGE
 *
 *     node tools/build-banner-art.mjs [source-dir]
 *
 * Rendering is done by Chromium's canvas, which is already a dev dependency for
 * the browser checks - this repo has no image library and does not need one for
 * a resize and a re-encode.
 */

import { chromium } from "playwright";
import http from "node:http";
import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_DIR = process.argv[2] || "tools/banner-source";
const OUT_DIR = "assets/banners";
const PORT = Number(process.env.BANNER_BUILD_PORT || 8993);

/** The identity card's proportions. `cover` crops anything else, so building to
 *  this size means the committed file is what the player actually sees. */
const WIDTH = 2120;
const HEIGHT = 720;
/** 2x the ~1060px the card reaches on desktop, so it stays sharp on retina. */
const QUALITY = 0.9;

async function main() {
  let sources;
  try {
    sources = (await readdir(SOURCE_DIR)).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
  } catch {
    console.error(
      `No source directory at ${SOURCE_DIR}.\n` +
        `The full-resolution originals are not committed - see the header of this file.\n` +
        `Put them there, or pass a path: node tools/build-banner-art.mjs <dir>`
    );
    process.exit(1);
  }
  if (!sources.length) {
    console.error(`No images in ${SOURCE_DIR}.`);
    process.exit(1);
  }

  // Served over HTTP rather than read as data: URIs - a 3 MB file becomes a
  // 4 MB string, and twenty of them is not worth doing to avoid a local server.
  const server = http.createServer(async (req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    // A blank page at the root so the renderer can be navigated somewhere on
    // this origin. Without it the page sits on about:blank, whose opaque origin
    // cannot load these images at all - the failure reads as a decode error
    // rather than anything about origins, which is worth the two lines.
    if (!rel) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>banner build</title>");
      return;
    }
    try {
      res.writeHead(200, { "content-type": "image/png" });
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
  const rows = [["file", "source", "output", "saved"]];

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
        // `cover`: fill the box entirely and centre-crop the overflow, matching
        // what CSS does at render time so the file IS the visible image.
        const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        return canvas.toDataURL("image/jpeg", quality);
      },
      { url: `http://127.0.0.1:${PORT}/${srcPath}`, w: WIDTH, h: HEIGHT, quality: QUALITY }
    );

    const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
    const outName = `${name.replace(/\.(png|jpe?g)$/i, "")}.jpg`;
    await writeFile(path.join(OUT_DIR, outName), bytes);

    beforeTotal += before;
    afterTotal += bytes.length;
    rows.push([
      outName,
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
    `\n  ${rows.length - 1} banners at ${WIDTH}x${HEIGHT}, JPEG q${QUALITY * 100}: ` +
      `${(beforeTotal / 1048576).toFixed(1)} MB -> ${(afterTotal / 1048576).toFixed(1)} MB ` +
      `(${Math.round((1 - afterTotal / beforeTotal) * 100)}% smaller)\n`
  );
}

await main();
