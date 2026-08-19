#!/usr/bin/env node
/**
 * Builds the square home-screen icons from the brand mark.
 *
 * WHY THIS EXISTS
 *
 * assets/brand/draft-nova-icon.png is 258x139 - the right shape for the top bar,
 * where it sits beside the word "Draft Nova" at 1.6em tall. index.html was
 * pointing that same wide file at `apple-touch-icon`, and iOS does not letterbox:
 * it stretches whatever it is given into a square and composites it on black.
 * Android's install prompt and site.webmanifest want 192 and 512 squares too,
 * and there were none.
 *
 * So the mark is composited onto a square of the app's own background rather
 * than padded with transparency. Transparent PNGs become black squares on iOS,
 * which is a different look from the app and reads as a mistake.
 *
 * MASKABLE SAFE ZONE. Android may crop an icon to a circle, a squircle or a
 * rounded square, and only guarantees the middle 80% survives - so the mark is
 * drawn at 60% of the canvas, comfortably inside that, and the ground colour
 * fills the rest. That is why one file can serve both `any` and `maskable`.
 *
 * USAGE
 *
 *     node tools/build-app-icons.mjs
 *
 * Rendering is Chromium's canvas, the same as tools/build-banner-art.mjs.
 */

import { chromium } from "playwright";
import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE = "assets/brand/draft-nova-icon.png";
const OUT_DIR = "assets/brand";
const PORT = Number(process.env.APP_ICON_PORT || 8995);

/** The app's own --bg (css/style.css). An icon that does not match the screen
 *  it opens looks like a placeholder. */
const GROUND = "#0d1117";
/** Fraction of the canvas the mark occupies. Inside Android's 80% safe zone
 *  with room to spare, so a circular mask never clips the logo. */
const MARK_SCALE = 0.6;
const SIZES = [192, 512];

async function main() {
  const server = http.createServer(async (req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    if (!rel) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>icon build</title>");
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

  for (const size of SIZES) {
    const dataUrl = await page.evaluate(
      async ({ url, size, ground, markScale }) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;
        await img.decode();

        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        ctx.fillStyle = ground;
        ctx.fillRect(0, 0, size, size);

        // `contain`, not `cover`: the mark must fit whole. Cover would crop a
        // wide logo to its middle, which is how you lose the ends of a wordmark.
        const box = size * markScale;
        const scale = Math.min(box / img.naturalWidth, box / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);

        return canvas.toDataURL("image/png");
      },
      { url: `http://127.0.0.1:${PORT}/${SOURCE}`, size, ground: GROUND, markScale: MARK_SCALE }
    );

    const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
    const out = path.join(OUT_DIR, `draft-nova-app-icon-${size}.png`);
    await writeFile(out, bytes);
    console.log(`  ${out.padEnd(48)} ${size}x${size}  ${Math.round(bytes.length / 1024)} KB`);
  }

  await browser.close();
  server.close();
  console.log(`\n  ${SIZES.length} square icons on ${GROUND}, mark at ${MARK_SCALE * 100}% of canvas\n`);
}

await main();
