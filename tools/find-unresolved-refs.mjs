#!/usr/bin/env node
// Identifiers a module CALLS but neither defines nor imports.
//
// Written while splitting js/ui.js, because the first cut of that split left
// renderNote behind and the break surfaced as a browser ReferenceError in a
// screen test rather than as anything the module system could catch. ES modules
// do not resolve free identifiers at parse time, so a file that has lost a
// helper still imports cleanly and still passes every check that only asks
// whether it parses. It fails when the line runs, on whichever screen calls it.
//
// Usage: node tools/find-unresolved-refs.mjs <file.js>
//
// Deliberately syntactic rather than a real binding analysis: it reports
// callback PARAMETERS too (onSelect, onPick), so the output is read rather than
// asserted on. That is the right trade for a tool used while moving code - it
// costs a glance and it cannot miss a lost helper.
//
// TEMPLATE LITERALS KEEP THEIR ${...} EXPRESSIONS, and the first version did
// not. Stripping the whole literal to avoid matching prose also blinded it to
// `${slotLabel(slot)}` - a call, inside a string, in exactly the kind of markup
// this codebase writes everywhere. It reported the extracted strategy module
// clean; the browser reported "slotLabel is not defined". Fixing that
// immediately turned up a second missing import the old version had hidden.

import { readFileSync } from "node:fs";
const file = process.argv[2];
const src = readFileSync(file, "utf8");
const strip = src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\/\/[^\n]*/g, " ")
  // Template literals keep their ${...} expressions - a call inside one is
  // still a call, and dropping them is how slotLabel slipped through.
  .replace(/`((?:[^`\\]|\\.)*)`/g, (m, body) =>
    [...body.matchAll(/\$\{([^{}]*)\}/g)].map((x) => x[1]).join(" ") + " ")
  .replace(/"(?:[^"\\]|\\.)*"/g, " ")
  .replace(/'(?:[^'\\]|\\.)*'/g, " ");
const defined = new Set();
for (const m of strip.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
for (const m of strip.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
for (const m of src.matchAll(/import\s*\{([^}]*)\}/g))
  m[1].split(",").forEach((x) => defined.add(x.split(/\s+as\s+/).pop().trim()));
for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) defined.add(m[1]);
const globals = new Set(["document","window","console","Math","Object","Array","String","Number","Boolean","JSON","Date","Set","Map","Promise","Intl","RegExp","Error","fetch","setTimeout","clearTimeout","setInterval","clearInterval","requestAnimationFrame","navigator","location","localStorage","sessionStorage","URL","Image","MutationObserver","IntersectionObserver","CustomEvent","Event","getComputedStyle","performance","structuredClone","isNaN","parseInt","parseFloat","undefined","null","true","false","this","arguments","globalThis","HTMLElement","Node","AbortController","crypto","btoa","atob","encodeURIComponent","decodeURIComponent","queueMicrotask","alert"]);
// candidate calls / references at statement level
const used = new Set();
// Calls.
for (const m of strip.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) used.add(m[1]);
// SCREAMING_CASE constants, referenced rather than called. Added after a third
// miss: FEATURED_BADGE_SLOTS is read, never invoked, so a call-only scan said
// the extracted profile module was clean and every profile screen threw
// "FEATURED_BADGE_SLOTS is not defined". Module-level constants are the other
// half of what moving code loses, and this shape catches them without the
// false-positive flood that scanning every bare identifier would bring.
for (const m of strip.matchAll(/(?<![.\w$])([A-Z][A-Z0-9_]{2,})\b/g)) used.add(m[1]);
const missing = [...used].filter((n) => !defined.has(n) && !globals.has(n));
console.log(missing.length ? missing.join("\n") : "(none)");
