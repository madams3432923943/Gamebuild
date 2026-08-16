// Stamps index.html's entry import AND its stylesheet with the current commit,
// so a deploy always serves fresh JS and fresh CSS.
//
// GitHub Pages sets no cache-busting headers and browsers cache ES modules
// aggressively. Every fix in a run of four bug reports was already live and
// already correct - the browser was serving the previous build, and there was
// no way to tell that from the outside. A changing query string ends it.
//
// The stylesheet was left unversioned for a long time, which was survivable
// only while CSS changes were rare and cosmetic. It stopped being survivable
// the moment a feature shipped its own styles: the shot chart's markers are
// invisible without them, so a returning browser holding a cached stylesheet
// would draw a basketball game with nothing on the court and no error to
// explain it. Same commit for both, so one deploy is one version.
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
const stamped = html
  .replace(/(src="js\/main\.js\?v=)[^"]*(")/, `$1${sha}$2`)
  // Tolerates the stylesheet being unversioned the first time, and re-stamps
  // it every time after.
  .replace(/(href="css\/style\.css)(\?v=[^"]*)?(")/, `$1?v=${sha}$3`);

if (stamped === html) {
  console.log(`build stamp already ${sha}`);
} else {
  writeFileSync(file, stamped);
  console.log(`build stamp -> ${sha}`);
}
