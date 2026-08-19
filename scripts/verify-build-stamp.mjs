#!/usr/bin/env node
// Did the cache-busting stamp move when the code behind it moved?
//
// WHY THIS IS NOT "THE STAMP EQUALS HEAD"
//
// That was the first version of this check and it fails on every merge, for a
// reason worth writing down: tools/stamp-build.mjs stamps `git rev-parse HEAD`,
// and it runs during `npm run verify` - BEFORE the commit that includes its own
// output exists. So the stamp is always one commit behind by construction, and
// on a merge commit it is behind by two. A check demanding equality would go red
// on every single merge and teach everyone to ignore it.
//
// WHAT ACTUALLY MATTERS is narrower and checkable: the stamp exists to stop a
// browser serving cached ES modules after a deploy. GitHub Pages sends no
// cache-busting headers, and four "the fix did not work" reports in a row turned
// out to be a browser holding the previous build. The stamp does not need to
// name the current commit. It needs to CHANGE whenever the files it versions
// change - and never to sit still while js/ or css/ moves underneath it.
//
// So: if this push touched js/ or css/ and the stamp is the same string it was
// before the push, the next deploy will serve new code behind an old URL, and
// this fails. Everything else passes.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

import { renderCheck, renderSection, summarize, PASS, FAIL, WARN } from "./lib/report.mjs";

const checks = [];
const add = (title, status, detail) => checks.push({ title, status, detail: String(detail) });

const git = (cmd) => execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
const gitQuiet = (cmd) => {
  try {
    return git(cmd);
  } catch {
    return null;
  }
};

/** The two versioned URLs in index.html, as they appear at a given revision. */
function stampsAt(rev) {
  const html = rev === null ? readFileSync("index.html", "utf8") : gitQuiet(`show ${rev}:index.html`);
  if (!html) return null;
  const js = html.match(/src="js\/main\.js\?v=([^"]*)"/)?.[1] ?? null;
  const css = html.match(/href="css\/style\.css\?v=([^"]*)"/)?.[1] ?? null;
  return { js, css };
}

const current = stampsAt(null);

add(
  "index.html versions both its entry module and its stylesheet",
  current?.js && current?.css ? PASS : FAIL,
  current?.js && current?.css
    ? `main.js?v=${current.js}, style.css?v=${current.css}`
    : `missing a version query: main.js=${current?.js ?? "none"}, style.css=${current?.css ?? "none"}`
);

add(
  "Both carry the same version, so one deploy is one version",
  current?.js && current.js === current.css ? PASS : FAIL,
  current?.js === current?.css
    ? current.js
    : `js is ${current?.js}, css is ${current?.css} - a browser could hold one and not the other`
);

// A shallow clone (actions/checkout defaults to depth 1) has no parent to
// compare against. Say so rather than passing silently: a check that cannot see
// the previous revision is not evidence of anything.
const parent = gitQuiet("rev-parse HEAD~1");
if (!parent) {
  add(
    "The stamp moved with the code",
    WARN,
    "no parent commit available - this is a shallow clone, so the comparison could not run. " +
      "Set fetch-depth: 2 or greater on actions/checkout."
  );
} else {
  const changed = gitQuiet("diff --name-only HEAD~1 HEAD -- js css") || "";
  const touchedFiles = changed.split("\n").filter(Boolean);
  const previous = stampsAt("HEAD~1");

  if (touchedFiles.length === 0) {
    add(
      "The stamp moved with the code",
      PASS,
      "nothing under js/ or css/ changed in this push, so the stamp did not need to move"
    );
  } else {
    const moved = previous?.js !== current?.js;
    add(
      "The stamp moved with the code",
      moved ? PASS : FAIL,
      moved
        ? `${touchedFiles.length} file(s) under js/ or css/ changed, and the stamp went ` +
          `${previous?.js} -> ${current?.js}`
        : `${touchedFiles.length} file(s) changed (${touchedFiles.slice(0, 3).join(", ")}` +
          `${touchedFiles.length > 3 ? ", …" : ""}) but the stamp is still ${current?.js}. ` +
          `Run 'npm run verify' and commit index.html, or returning browsers keep the old build.`
    );
  }
}

console.log(renderSection("Build stamp"));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}  warnings ${counts[WARN] || 0}\n`);
process.exit(ok ? 0 : 1);
