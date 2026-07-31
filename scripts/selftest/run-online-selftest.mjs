#!/usr/bin/env node
// Online end-to-end self-test: `npm run verify:online-selftest`.
//
// Two real browsers, matched with each other through real matchmaking, both
// drafting a full ranked roster, both committing a strategy, both watching the
// same simulated result come back - against a local fake backend
// (scripts/selftest/fake-server.mjs) rather than production.
//
// This is the leg that covers the code with the worst failure modes and the
// least coverage: the git history has already had to fix an online Ranked
// freeze and a result reveal that reached neither player, and until now the
// only way to catch that class of bug was for a person to play a real ranked
// match and notice.
//
// It does NOT replace `npm run verify -- --online`. A fake backend cannot
// catch an RLS policy mistake, a migration that never ran, or a deployed Edge
// Function that has drifted from this repo. It catches client bugs, and those
// are most of them.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderCheck, renderSection, summarize, PASS, FAIL, WARN, SKIP } from "../lib/report.mjs";
import { runBrowserChecks } from "../verify-browser.mjs";
import { createFakeBackend } from "./fake-server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serveStatic(root, port) {
  const server = createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      if (rel === "/" || rel.endsWith("/")) rel += "index.html";
      const file = path.join(root, rel);
      if (!file.startsWith(root)) return res.writeHead(403).end("forbidden");
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function main() {
  const sitePort = Number(process.env.BK_SELFTEST_PORT || 8932);
  const apiPort = sitePort + 1;

  const site = await serveStatic(ROOT, sitePort);
  const backend = createFakeBackend();
  await backend.listen(apiPort);

  const baseUrl = `http://127.0.0.1:${sitePort}/`;
  const apiUrl = `http://127.0.0.1:${apiPort}/`;

  console.log(renderSection("Online self-test (two browsers, local fake backend)"));
  console.log(`  site: ${baseUrl}`);
  console.log(`  api:  ${apiUrl}`);

  const stub = await readFile(path.join(HERE, "online-stub.js"), "utf8");

  // Distinct identities, so matchmaking has two different people to pair.
  const accounts = [
    { username: "SelfTestA", password: "x", userId: "11111111-1111-4111-8111-111111111111" },
    { username: "SelfTestB", password: "x", userId: "22222222-2222-4222-8222-222222222222" },
  ];
  for (const a of accounts) {
    await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "register", userId: a.userId, username: a.username }),
    });
  }

  const checks = await runBrowserChecks({
    baseUrl,
    mode: "online",
    accounts,
    artifactDir: path.join(ROOT, "verify-artifacts", "online-selftest"),
    headless: !process.argv.includes("--headed"),
    budgetMs: 240000,
    // Per-context identity, injected before the app boots so each browser is
    // a different player against the shared backend.
    initScriptFor: (i) =>
      `window.__BK_API = ${JSON.stringify(apiUrl)};` +
      `window.__BK_USER_ID = ${JSON.stringify(accounts[i].userId)};` +
      `window.__BK_USERNAME = ${JSON.stringify(accounts[i].username)};`,
    routes: [{ pattern: "**/esm.sh/**", body: stub, contentType: "text/javascript; charset=utf-8" }],
  });

  for (const c of checks) console.log(renderCheck(c));
  const { counts, ok } = summarize(checks);
  console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}  warnings ${counts[WARN]}  skipped ${counts[SKIP]}\n`);

  site.close();
  backend.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
