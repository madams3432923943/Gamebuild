#!/usr/bin/env node
// The Content Security Policy in index.html still says what it means to say.
//
// WHY THIS IS A BUILD CHECK AND NOT A BROWSER ONE
//
// A CSP fails in one of two directions and only one of them is loud. Too
// STRICT and the app breaks immediately, which any browser test catches. Too
// LOOSE - an 'unsafe-inline' added to make one stubborn thing work, a hash
// that no longer matches the block it was computed from - and nothing breaks
// at all. The policy just quietly stops being a defence, and the next person
// to read it believes it is one.
//
// The import-map hash is the specific thing that rots. It is the sha256 of an
// inline <script> block, so ANY edit to that block - adding a dependency,
// changing the pinned version, re-indenting it - invalidates the hash. The
// symptom is not a crash: it is the bare-specifier import failing, which the
// app is deliberately built to survive (see getSupabase in
// js/supabaseClient.js, where a dynamic import confines a CDN failure to
// online mode). So the page would keep working, the sign-in screen would keep
// rendering, and online play alone would be dead.

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const raw = await readFile(path.join(ROOT, "index.html"), "utf8");

// COMMENTS STRIPPED FIRST, the way scripts/verify-banner-resolution.mjs strips
// CSS comments before parsing a selector - and for a reason this file learned
// the hard way. The comment documenting the policy quotes the tag it is
// describing, so a regex looking for that tag matched inside the prose and
// captured everything from there down to the real closing tag. The hash came
// out wrong and this script reported a correct policy as broken; pasting the
// "fix" it suggested would have been what actually broke online play.
//
// A browser reads elements, not prose. So should this.
const html = raw.replace(/<!--[\s\S]*?-->/g, "");

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

console.log(renderSection("Content Security Policy"));

// ---- 1. there is a policy at all -------------------------------------------
const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/s);
check("index.html carries a Content-Security-Policy", !!cspMatch, cspMatch ? "present" : "no CSP meta tag found");

if (cspMatch) {
  const csp = cspMatch[1].replace(/\s+/g, " ").trim();

  // ---- 2. the escape hatches stay shut -------------------------------------
  // 'unsafe-hashes' is included deliberately: it is the keyword that would let
  // inline event handlers back in, which is exactly what js/brand-fallback.js
  // exists to avoid needing.
  for (const unsafe of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'"]) {
    check(
      `The policy does not use ${unsafe}`,
      !csp.includes(unsafe),
      csp.includes(unsafe) ? `found ${unsafe} - the policy is no longer a meaningful defence` : "absent"
    );
  }

  // ---- 3. the directives that matter are present ---------------------------
  for (const directive of ["default-src", "script-src", "connect-src", "object-src", "base-uri"]) {
    check(`The policy sets ${directive}`, csp.includes(directive), csp.includes(directive) ? "set" : "missing");
  }

  // ---- 4. the import-map hash still matches the import map -----------------
  const mapMatch = html.match(/<script type="importmap">(.*?)<\/script>/s);
  if (!mapMatch) {
    check("The import map is present", false, "no <script type=\"importmap\"> found");
  } else {
    const hash = createHash("sha256").update(mapMatch[1]).digest("base64");
    const expected = `'sha256-${hash}'`;
    check(
      "The CSP hash matches the inline import map",
      csp.includes(expected),
      csp.includes(expected)
        ? `sha256-${hash.slice(0, 12)}… matches`
        : `import map hashes to ${expected}, which is not in the policy - the bare-specifier import will be blocked and ONLINE PLAY will fail while the rest of the app keeps working`
    );
  }

  // ---- 5. everything the page actually loads is allowed --------------------
  // A source the page needs and the policy omits is the other silent failure:
  // it only shows up on the screen that uses it.
  const needed = [
    ["https://esm.sh", "script-src", "the supabase-js CDN named in the import map"],
    ["https://*.supabase.co", "connect-src", "the Supabase REST/auth/functions origin"],
  ];
  for (const [source, directive, why] of needed) {
    const section = csp.split(";").find((d) => d.trim().startsWith(directive)) || "";
    check(`${directive} allows ${source}`, section.includes(source), section.includes(source) ? why : `missing - ${why}`);
  }
}

// ---- 6. no inline event handlers -------------------------------------------
// CSP hashes do not cover inline handlers, so one of these anywhere in the page
// is either broken under the policy or a reason someone will add
// 'unsafe-hashes' and undo it. This is what js/brand-fallback.js replaced.
const handlers = [...html.matchAll(/\son(?:click|error|load|change|submit|input|focus|blur|mouse\w+|key\w+)\s*=/gi)];
check(
  "index.html has no inline event handlers",
  handlers.length === 0,
  handlers.length
    ? `${handlers.length} found (${[...new Set(handlers.map((h) => h[0].trim()))].join(", ")}) - these do not run under the policy; move them into a module the way js/brand-fallback.js did`
    : "none - handlers live in modules"
);

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
