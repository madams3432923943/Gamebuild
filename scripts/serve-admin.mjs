#!/usr/bin/env node
// `npm run admin` - the private dashboard, on this machine only.
//
// WHY THE DASHBOARD IS NOT A PAGE ON THE SITE
//
// It used to be /admin.html, a top-level page of draftnovagame.com. Nothing was
// insecure about that - the data comes from SECURITY DEFINER functions that
// refuse a non-administrator, so the page holds nothing and shows nothing to
// anybody else - but a business dashboard is not part of the product, and a URL
// that exists is a URL somebody eventually links, bookmarks or screenshots.
//
// So it is a local tool. This binds 127.0.0.1 explicitly rather than 0.0.0.0:
// on a coffee-shop network the second one would put the page on every device
// in the room. Again, not a data leak - but the point of moving it was to stop
// it being reachable, and half-doing that would be worse than not doing it.
//
// It serves the whole repository rather than just tools/admin, because the page
// imports js/admin/*, js/supabaseClient.js and css/admin.css by absolute path -
// the same files the game uses, so there is one copy of each.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.ADMIN_PORT || 8790);
const HOST = "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}`);
    let rel = decodeURIComponent(url.pathname);
    // Bare "/" opens the dashboard, not the game: this server exists for one
    // page and typing a path to reach it would be friction for no reason.
    if (rel === "/") rel = "/tools/admin/index.html";
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(ROOT, rel);
    // Path traversal, on a server bound to localhost and serving a git
    // checkout. Cheap to close and there is no argument for leaving it open.
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    // Read before writing headers: the other order sends a 200, then throws,
    // then tries to send a 404 on top of it.
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      // No caching. The whole point of running this locally is to see a change
      // you just made, and ES modules are held hard by browsers - the reason
      // the deployed game needs a build stamp at all.
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Draft Nova admin dashboard\n`);
  console.log(`  http://${HOST}:${PORT}/\n`);
  console.log(`  Sign in with a Draft Nova account that is on the admin allowlist.`);
  console.log(`  Adding one is a row in public.admin_users - see docs/growth-infrastructure.md.\n`);
  console.log(`  Ctrl-C to stop.\n`);
});
