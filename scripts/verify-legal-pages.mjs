#!/usr/bin/env node
// Loads every page under legal/ in a real browser: `npm run verify:legal`.
//
// These pages are not driven by the game harness - nothing in a draft or a
// simulation ever touches them - so without this they would be the one part of
// the site that ships unopened. That is a bad part to ship unopened: a privacy
// policy that 404s is worse than no privacy policy, because it is a promise
// that visibly is not kept.
//
// What it proves, per page: it renders, the shared chrome injects, the
// document switcher is complete, no console errors, no horizontal scroll at
// 360px, and - with JavaScript switched off - the document text is still all
// there. That last one is the point of keeping the text in the markup rather
// than building it from config, so it is worth asserting rather than assuming.
//
// What it does NOT prove: that anything in the documents is legally correct.

import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { check, renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";
import { LEGAL_DOCUMENTS } from "../js/legal/config.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// Short enough that a page rendering only its chrome - the failure mode when
// the markup is empty and the text was expected to come from somewhere else -
// cannot pass. The shortest real document runs to several hundred words.
const MIN_WORDS = 120;

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
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function inspect(context, url, { js }) {
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console error: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e}`));

  await page.goto(url, { waitUntil: "networkidle" });
  const info = await page.evaluate(() => ({
    words: document.body.innerText.trim().split(/\s+/).filter(Boolean).length,
    hasHeader: !!document.querySelector("header.top-nav"),
    hasFooter: !!document.querySelector("footer.app-footer"),
    navLinks: document.querySelectorAll(".legal-doc-link").length,
    updated: (document.querySelector("[data-legal-updated]") || {}).textContent || "",
    unfilledFields: [...document.querySelectorAll("[data-legal-field]")]
      .filter((el) => !el.textContent.trim()).length,
    overflowBy: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  await page.close();

  if (info.words < MIN_WORDS) problems.push(`only ${info.words} words rendered`);
  if (info.overflowBy > 1) problems.push(`page scrolls sideways by ${info.overflowBy}px`);
  if (info.unfilledFields) problems.push(`${info.unfilledFields} empty [data-legal-field]`);
  if (js) {
    if (!info.hasHeader) problems.push("shared header did not inject");
    if (!info.hasFooter) problems.push("shared footer did not inject");
    if (info.navLinks !== LEGAL_DOCUMENTS.length) {
      problems.push(`document switcher has ${info.navLinks} of ${LEGAL_DOCUMENTS.length} links`);
    }
    if (!/last updated/i.test(info.updated)) problems.push("no last-updated stamp");
  }
  return { info, problems };
}

async function main() {
  const port = Number(process.env.BK_LEGAL_PORT || 8934);
  const server = await serve(ROOT, port);
  const base = `http://127.0.0.1:${port}`;
  console.log(renderSection("Legal pages (real browser)"));

  const pages = (await readdir(path.join(ROOT, "legal")))
    .filter((f) => f.endsWith(".html"))
    .sort();

  // Every document declared in config must exist as a file, or a footer link
  // and a switcher entry point at a 404.
  const missing = LEGAL_DOCUMENTS.filter((d) => !pages.includes(d.path));
  const checks = [
    check(
      "legal-documents-present",
      `Every document in js/legal/config.js has a page (${LEGAL_DOCUMENTS.length})`,
      missing.length ? FAIL : PASS,
      missing.length ? { detail: `missing: ${missing.map((d) => d.path).join(", ")}` } : {}
    ),
  ];

  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  try {
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const phone = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });

    for (const file of pages) {
      const url = `${base}/legal/${file}`;
      const started = Date.now();
      const wide = await inspect(desktop, url, { js: true });
      const narrow = await inspect(phone, url, { js: true });
      const bare = await inspect(noJs, url, { js: false });

      const problems = [
        ...wide.problems.map((p) => `desktop: ${p}`),
        ...narrow.problems.map((p) => `360px: ${p}`),
        ...bare.problems.map((p) => `no-js: ${p}`),
      ];
      checks.push(
        check(`legal-page-${file.replace(/\.html$/, "")}`, `legal/${file}`, problems.length ? FAIL : PASS, {
          durationMs: Date.now() - started,
          detail: problems.length ? problems.join("\n") : `${wide.info.words} words, renders with JS off`,
        })
      );
    }
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
