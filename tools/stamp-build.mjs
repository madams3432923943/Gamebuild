// Stamps index.html's entry import with the current commit, so a deploy always
// serves fresh JS.
//
// GitHub Pages sets no cache-busting headers and browsers cache ES modules
// aggressively. Every fix in a run of four bug reports was already live and
// already correct - the browser was serving the previous build, and there was
// no way to tell that from the outside. A changing query string ends it.
//
// Run by `npm run verify`, so the stamp cannot drift from what is committed.

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "index.html");

const sha = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
const html = readFileSync(file, "utf8");
const stamped = html.replace(/(src="js\/main\.js\?v=)[^"]*(")/, `$1${sha}$2`);

if (stamped === html) {
  console.log(`build stamp already ${sha}`);
} else {
  writeFileSync(file, stamped);
  console.log(`build stamp -> ${sha}`);
}
