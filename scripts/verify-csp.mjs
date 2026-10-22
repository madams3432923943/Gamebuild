#!/usr/bin/env node
// The Content Security Policy on every page still says what it means to say.
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

// EVERY PAGE IN THE REPOSITORY, not just the game. The admin dashboard is not
// part of the website any more - it is served from localhost by `npm run
// admin` - but it is still a page that loads supabase-js and signs somebody
// in, so it gets the same policy for the same reasons, and it carries its own
// copy of the inline import map, which means its own hash to rot. Adding a
// page to this list is the whole cost of keeping it covered.
const PAGES = ["index.html", "tools/admin/index.html"];

// One list across both pages, so the exit code covers all of it and the
// summary at the bottom counts the whole run rather than the last page.
const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

console.log(renderSection("Content Security Policy"));

// COMMENTS STRIPPED FIRST, the way scripts/verify-banner-resolution.mjs strips
// CSS comments before parsing a selector - and for a reason this file learned
// the hard way. The comment documenting the policy quotes the tag it is
// describing, so a regex looking for that tag matched inside the prose and
// captured everything from there down to the real closing tag. The hash came
// out wrong and this script reported a correct policy as broken; pasting the
// "fix" it suggested would have been what actually broke online play.
//
// A browser reads elements, not prose. So should this.
for (const page of PAGES) {
  const raw = await readFile(path.join(ROOT, page), "utf8");
  const html = raw.replace(/<!--[\s\S]*?-->/g, "");

  // ---- 1. there is a policy at all -------------------------------------------
  const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/s);
  check(`${page} carries a Content-Security-Policy`, !!cspMatch, cspMatch ? "present" : "no CSP meta tag found");

  if (cspMatch) {
    const csp = cspMatch[1].replace(/\s+/g, " ").trim();

    // ---- 2. the escape hatches stay shut -------------------------------------
    // 'unsafe-hashes' is included deliberately: it is the keyword that would let
    // inline event handlers back in, which is exactly what js/brand-fallback.js
    // exists to avoid needing.
    for (const unsafe of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'"]) {
      check(
        `${page}: the policy does not use ${unsafe}`,
        !csp.includes(unsafe),
        csp.includes(unsafe) ? `found ${unsafe} - the policy is no longer a meaningful defence` : "absent"
      );
    }

    // ---- 3. the directives that matter are present ---------------------------
    for (const directive of ["default-src", "script-src", "connect-src", "object-src", "base-uri"]) {
      check(`${page}: the policy sets ${directive}`, csp.includes(directive), csp.includes(directive) ? "set" : "missing");
    }

    // ---- 4. the import-map hash still matches the import map -----------------
    const mapMatch = html.match(/<script type="importmap">(.*?)<\/script>/s);
    if (!mapMatch) {
      check(`${page}: the import map is present`, false, "no <script type=\"importmap\"> found");
    } else {
      const hash = createHash("sha256").update(mapMatch[1]).digest("base64");
      const expected = `'sha256-${hash}'`;
      check(
        `${page}: the CSP hash matches the inline import map`,
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
      check(`${page}: ${directive} allows ${source}`, section.includes(source), section.includes(source) ? why : `missing - ${why}`);
    }
  }

  // ---- 5b. EVERY executable inline script is hashed ------------------------
  // Check 4 covers the import map by name. This covers whatever is added next,
  // which is how a hash usually goes missing: someone adds an inline script,
  // it works on localhost (no policy there? there is - but nobody looks at the
  // console), and the live page silently drops it.
  //
  // Data blocks are skipped because the browser never executes them, so CSP
  // never sees them: application/ld+json and application/json. The import map
  // is NOT a data block as far as CSP is concerned, which is why it needs one.
  if (cspMatch) {
    const csp = cspMatch[1].replace(/\s+/g, " ").trim();
    const DATA_BLOCKS = new Set(["application/ld+json", "application/json"]);
    // The closing tag allows whitespace before its ">" because the HTML parser
    // does: `</script >` ends a script, and a pattern that missed it would
    // skip a script the browser runs.
    for (const m of html.matchAll(/<script\b([^>]*)>(.*?)<\/script\s*>/gis)) {
      const attrs = m[1];
      if (/\ssrc\s*=/.test(attrs)) continue;
      const type = (attrs.match(/\stype\s*=\s*"([^"]*)"/) || [])[1] || "";
      if (DATA_BLOCKS.has(type.toLowerCase())) continue;
      const hash = `'sha256-${createHash("sha256").update(m[2]).digest("base64")}'`;
      check(
        `${page}: inline <script${type ? ` type="${type}"` : ""}> is allowed by its hash`,
        csp.includes(hash),
        csp.includes(hash) ? "hash present" : `hashes to ${hash}, which is not in script-src - it will not run`
      );
    }
  }

  // ---- 5c. structured data parses, and says what the page says --------------
  // A JSON-LD block that does not parse is silently ignored by every search
  // engine, and an FAQPage whose answers differ from the visible FAQ is the
  // thing they penalise. The visible FAQ is the h3/p pairs in .quickplay-faq.
  for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    let data = null;
    try {
      data = JSON.parse(m[1]);
    } catch (e) {
      check(`${page}: JSON-LD parses`, false, e.message);
      continue;
    }
    check(`${page}: JSON-LD parses`, true, "valid JSON");
    const nodes = data["@graph"] || [data];
    const faq = nodes.find((n) => n["@type"] === "FAQPage");
    if (!faq) continue;
    const faqSection = (html.match(/<section class="card quickplay-faq"[\s\S]*?<\/section>/) || [""])[0];
    // Tags are removed until none remain rather than in one pass, so markup
    // that only forms a tag once another is removed cannot survive into the
    // comparison. This text is compared, never rendered - but a check that
    // strips tags should strip all of them.
    const text = (s) => {
      let out = s;
      for (let prev = null; prev !== out; ) {
        prev = out;
        out = out.replace(/<[^<>]*>/g, "");
      }
      return out.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    };
    const visible = [...faqSection.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((q) => [text(q[1]), text(q[2])]);
    const structured = faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]);
    const same = JSON.stringify(visible) === JSON.stringify(structured);
    check(
      `${page}: the FAQPage JSON-LD matches the visible FAQ`,
      same && visible.length > 0,
      same ? `${visible.length} questions, word for word` : "the JSON-LD and the FAQ on the page say different things - change both"
    );
  }

  // ---- 6. no inline event handlers -------------------------------------------
  // CSP hashes do not cover inline handlers, so one of these anywhere in the page
  // is either broken under the policy or a reason someone will add
  // 'unsafe-hashes' and undo it. This is what js/brand-fallback.js replaced.
  const handlers = [...html.matchAll(/\son(?:click|error|load|change|submit|input|focus|blur|mouse\w+|key\w+)\s*=/gi)];
  check(
    `${page} has no inline event handlers`,
    handlers.length === 0,
    handlers.length
      ? `${handlers.length} found (${[...new Set(handlers.map((h) => h[0].trim()))].join(", ")}) - these do not run under the policy; move them into a module the way js/brand-fallback.js did`
      : "none - handlers live in modules"
  );

}

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
