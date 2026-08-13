// Stamps index.html's entry import with the current commit, so a deploy always
// serves fresh JS.
//
// GitHub Pages sets no cache-busting headers and browsers cache ES modules
// aggressively. Every fix in a run of four bug reports was already live and
// already correct - the browser was serving the previous build, and there was
// no way to tell that from the outside. A changing query string ends it.
//
// Run by `npm run verify`, so the stamp cannot drift from what is committed.

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// index.html's entry module, plus the legal pages' shared chrome. The legal
// pages hold their text in their own markup, so a stale chrome.js only costs
// the header and footer rather than the whole page - but the same cache that
// pinned main.js for four bug reports pins this one too.
const files = [
  join(root, "index.html"),
  ...readdirSync(join(root, "legal"))
    .filter((name) => name.endsWith(".html"))
    .map((name) => join(root, "legal", name)),
];

const sha = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
const pattern = /(src="[^"]*js\/(?:main|legal\/chrome)\.js\?v=)[^"]*(")/g;

let changed = 0;
for (const file of files) {
  const html = readFileSync(file, "utf8");
  const stamped = html.replace(pattern, `$1${sha}$2`);
  if (stamped !== html) {
    writeFileSync(file, stamped);
    changed += 1;
  }
}

console.log(changed ? `build stamp -> ${sha} (${changed} file(s))` : `build stamp already ${sha}`);
