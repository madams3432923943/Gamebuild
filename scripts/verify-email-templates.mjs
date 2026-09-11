#!/usr/bin/env node
// The account email templates in docs/email/ still say what they mean to say.
//
// WHY THIS IS A BUILD CHECK
//
// These templates are not applied from the repository - they are pasted into
// the Supabase dashboard (see docs/production-email.md) - so nothing in the
// normal development loop ever renders one. A mistake in here is invisible
// until a real player needs a password reset, which is the worst possible
// moment to discover it.
//
// And the mistakes are quiet ones. Supabase substitutes `{{ .ConfirmationURL }}`
// server-side with Go's text/template; an unknown variable renders as EMPTY
// rather than erroring, so `{{ .ConfirmationUrl }}` - one lowercase letter -
// produces a mail with a button that links to nothing at all. The mail sends,
// looks right, and is useless.
//
// The other silent failure is branding. The whole point of these files is that
// a Draft Nova email looks like Draft Nova and tells the reader where to get
// help; a template edited down to bare text still sends perfectly.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "docs/email");

// The variables Supabase Auth actually provides. Anything else renders empty.
// https://supabase.com/docs/guides/auth/auth-email-templates
const SUPPORTED = new Set([
  "ConfirmationURL",
  "Token",
  "TokenHash",
  "SiteURL",
  "Email",
  "NewEmail",
  "RedirectTo",
  "Data",
]);

// Which template must exist, and which variables each one is allowed to depend
// on. A template using a variable the flow does not populate is the same bug as
// a misspelled one: {{ .NewEmail }} is empty in a password reset.
const TEMPLATES = {
  "reset-password.html": { allow: ["ConfirmationURL", "Email", "SiteURL", "Token", "TokenHash"] },
  "confirm-signup.html": { allow: ["ConfirmationURL", "Email", "SiteURL", "Token", "TokenHash"] },
  "change-email.html": { allow: ["ConfirmationURL", "Email", "NewEmail", "SiteURL", "Token", "TokenHash"] },
};

// What makes a Draft Nova email a Draft Nova email, as literal strings a
// reader would see or click.
const REQUIRED_CONTENT = [
  ["Draft Nova", "the product name in text, not only inside a blocked image"],
  ["draftnovagame.com", "where the site is"],
  ["support@draftnovagame.com", "how to get help"],
];

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

const files = (await readdir(DIR)).filter((f) => f.endsWith(".html")).sort();

check(
  "Every expected template is present",
  Object.keys(TEMPLATES).every((f) => files.includes(f)),
  Object.keys(TEMPLATES)
    .filter((f) => !files.includes(f))
    .map((f) => `missing ${f}`)
    .join(", ") || `${files.length} templates in docs/email`
);

// A template file nobody expects is either a new flow with no entry here or a
// leftover; both are worth surfacing, because this list is what
// docs/production-email.md tells the owner to paste.
check(
  "Every template file is accounted for",
  files.every((f) => TEMPLATES[f]),
  files.filter((f) => !TEMPLATES[f]).map((f) => `unexpected ${f}`).join(", ") || "no strays"
);

for (const file of files) {
  const spec = TEMPLATES[file];
  if (!spec) continue;
  const html = await readFile(path.join(DIR, file), "utf8");

  // ---- 1. every variable is one Supabase substitutes ----------------------
  // Tolerant of whitespace, because `{{.Email}}` and `{{ .Email }}` are both
  // valid Go template syntax and both appear in Supabase's own examples.
  const used = [...html.matchAll(/\{\{\s*\.([A-Za-z]+)\s*\}\}/g)].map((m) => m[1]);
  const unknown = [...new Set(used)].filter((name) => !SUPPORTED.has(name));
  check(
    `${file}: every template variable exists`,
    unknown.length === 0,
    unknown.length === 0
      ? `${[...new Set(used)].join(", ") || "none"}`
      : `${unknown.join(", ")} - Supabase renders an unknown variable as EMPTY, so this mails a link to nowhere`
  );

  const notAllowed = [...new Set(used)].filter((name) => SUPPORTED.has(name) && !spec.allow.includes(name));
  check(
    `${file}: every variable is populated by this flow`,
    notAllowed.length === 0,
    notAllowed.length === 0
      ? "no variable this flow does not fill"
      : `${notAllowed.join(", ")} - valid elsewhere, empty here`
  );

  // ---- 2. there is a link at all ------------------------------------------
  // The one thing a transactional mail has to contain.
  const links = (html.match(/\{\{\s*\.ConfirmationURL\s*\}\}/g) || []).length;
  check(
    `${file}: the action link appears as a button and as text`,
    links >= 2,
    links >= 2
      ? `${links} references`
      : `${links} reference(s) - a client that flattens the button leaves no way to follow the link`
  );

  // ---- 3. branding and contact --------------------------------------------
  for (const [needle, why] of REQUIRED_CONTENT) {
    check(`${file}: carries ${needle}`, html.includes(needle), html.includes(needle) ? why : `missing - ${why}`);
  }

  // ---- 4. email-client hygiene --------------------------------------------
  // A <style> block is stripped by several clients, which for a template
  // relying on one means an unstyled mail. Inline styles only.
  check(
    `${file}: has no <style> block`,
    !/<style[\s>]/i.test(html),
    /<style[\s>]/i.test(html) ? "Gmail and Outlook strip these - style attributes only" : "inline styles only"
  );

  // A remote stylesheet or font is worse: it never loads in a mail client.
  check(
    `${file}: loads no external stylesheet or font`,
    !/<link[\s>]/i.test(html),
    /<link[\s>]/i.test(html) ? "mail clients do not fetch stylesheets" : "none"
  );

  // Every image has to be absolute (a mail has no base URL to resolve
  // against) and has to carry alt text, because most clients block images by
  // default and alt text is then the only thing in its place.
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const badSrc = images.filter((tag) => !/src="https:\/\//i.test(tag));
  check(
    `${file}: every image is an absolute https URL`,
    badSrc.length === 0,
    badSrc.length === 0 ? `${images.length} image(s)` : `${badSrc.length} relative or insecure src - a mail has no base URL`
  );
  const noAlt = images.filter((tag) => !/\balt="/i.test(tag));
  check(
    `${file}: every image has alt text`,
    noAlt.length === 0,
    noAlt.length === 0 ? "all captioned" : `${noAlt.length} without alt - most clients block images by default`
  );
}

console.log(renderSection("Account email templates"));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
