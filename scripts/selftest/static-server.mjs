// The repo, served over HTTP for a browser test.
//
// The app is a static site with no build step, and the browser loads its ES
// modules directly - which means `file://` will not run it and every browser
// test needs a server. Three of them had grown their own copy of this, and
// the copies had drifted: the online selftest's MIME table was missing
// `.mjs`, so any module imported with that extension would have been served
// as `application/octet-stream` and refused by the browser. Nothing imports
// one today, which is the only reason it never broke.
//
// One copy, so a fix lands everywhere and a fourth caller inherits it.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

/**
 * Serves `root` on `port` until closed. Resolves once it is listening, so a
 * caller can navigate immediately without racing the bind.
 *
 * Path traversal is refused rather than clamped: a test that asks for
 * something outside the repo has a bug worth seeing, not a path worth fixing
 * up silently.
 */
export function serveStatic(root, port) {
  const server = createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
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
  return new Promise((resolve, reject) => {
    // A busy port is the single most common way this fails, and it used to
    // fail as an unhandled 'error' event: ten frames of node internals,
    // "Emitted 'error' event on Server instance", and no mention of the
    // actual cause. It reads like the harness is broken. It means a previous
    // run is still alive - which is easy to do, because a selftest holding a
    // Chromium does not always go down on the first SIGTERM.
    //
    // Rejecting with a sentence instead. The caller decides what to do; what
    // matters is that whoever reads the output is pointed at the right thing.
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `port ${port} is already in use - another selftest or capture run is probably still ` +
              `alive. Find it with \`lsof -i :${port}\` and stop it (it may need SIGKILL), or set ` +
              `a different port via the env var this script reads.`
          )
        );
        return;
      }
      reject(err);
    });
    server.listen(port, () => resolve(server));
  });
}
