#!/usr/bin/env node
// The analytics layer agrees with the database, and cannot carry anything
// private.
//
// WHY THIS EXISTS
//
// There are three copies of the same list and they are in three languages:
//
//   the event names in js/analytics.js (JavaScript),
//   the allowlist rows in db/migrations/20260911_02 (SQL),
//   the funnel order in js/admin/render.js (JavaScript again).
//
// Nothing makes them agree. track_event() raises on an event that is not in
// the table, so a name added to the client and not the migration fails at
// runtime in front of a player - and it fails inside a fire-and-forget call,
// so what actually happens is that the metric silently never arrives. A name in
// the table that no client sends is a row on the dashboard that is zero
// forever and looks like a funnel collapse. And an event the dashboard's order
// list has never heard of does not appear on the funnel at all.
//
// The second half is the one that matters more. The prop allowlist is a privacy
// boundary: it is what guarantees an event cannot carry an email address, a
// password, a token or a chat message. It is enforced server-side in
// sanitize_event_props() - which is correct, because client-side validation is
// never sufficient - and mirrored client-side so a mistake is caught in the
// console of whoever wrote it. Two copies of a privacy boundary that disagree
// is a privacy boundary nobody can reason about.
//
// NEEDS NO DATABASE. It reads the migration file, which is the documentation of
// what was applied, so it runs inside `npm run verify`.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = path.join(ROOT, "db/migrations/20260911_02_product_analytics.sql");

const { EVENTS } = await import(path.join(ROOT, "js/analytics.js"));
const sql = await readFile(MIGRATION, "utf8");
const analyticsJs = await readFile(path.join(ROOT, "js/analytics.js"), "utf8");
const renderJs = await readFile(path.join(ROOT, "js/admin/render.js"), "utf8");

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

// ---- 1. the event names match the database's allowlist ---------------------
// Parsed out of the seeding INSERT rather than hand-listed here, so this file
// never becomes a fourth copy to keep in step.
const insertBlock = sql.slice(sql.indexOf("insert into public.analytics_event_types"));
const sqlEvents = new Set([...insertBlock.matchAll(/^\s*\('([a-z0-9_]+)',/gm)].map((m) => m[1]));
const jsEvents = new Set(Object.values(EVENTS));

const missingInSql = [...jsEvents].filter((e) => !sqlEvents.has(e));
check(
  "Every event the client sends is declared in the database",
  missingInSql.length === 0,
  missingInSql.length === 0
    ? `${jsEvents.size} events`
    : `${missingInSql.join(", ")} - track_event() raises on these, and the call is fire-and-forget, so the metric silently never arrives`
);

const missingInJs = [...sqlEvents].filter((e) => !jsEvents.has(e));
check(
  "Every event the database declares is one the client sends",
  missingInJs.length === 0,
  missingInJs.length === 0
    ? "no orphans"
    : `${missingInJs.join(", ")} - a row that reads zero forever looks like a funnel collapse`
);

// ---- 2. every event is actually fired somewhere ----------------------------
// A declared event nobody calls is a metric that does not exist. Searched
// across the modules that do the firing rather than the whole tree, so a
// mention in a comment or in this file does not count as a call site.
const callSites = await Promise.all(
  ["js/main.js", "js/screens/squads.js", "js/onboarding.js", "js/ads/placements.js"].map((f) =>
    readFile(path.join(ROOT, f), "utf8")
  )
);
const wired = callSites.join("\n");
const constantFor = (name) => Object.keys(EVENTS).find((key) => EVENTS[key] === name);
const unwired = [...jsEvents].filter((name) => !wired.includes(`EVENTS.${constantFor(name)}`));
check(
  "Every event has a call site",
  unwired.length === 0,
  unwired.length === 0 ? `${jsEvents.size} events wired` : `never fired: ${unwired.join(", ")}`
);

// ---- 3. the funnel on the dashboard knows every event ----------------------
const funnelListed = new Set([...renderJs.matchAll(/\["([a-z0-9_]+)",\s*"/g)].map((m) => m[1]));
const notOnFunnel = [...jsEvents].filter((e) => !funnelListed.has(e));
check(
  "The dashboard's funnel lists every event",
  notOnFunnel.length === 0,
  notOnFunnel.length === 0
    ? `${funnelListed.size} rows in FUNNEL_ORDER`
    : `${notOnFunnel.join(", ")} would be recorded and never displayed`
);

// ---- 4. THE PRIVACY BOUNDARY ----------------------------------------------
// The two copies of the prop allowlist have to be the same set. The server's is
// the one that actually enforces; the client's exists so a bad payload is
// caught where it was written.
// Bounded by the closing paren of the `key in (...)` list, not by a character
// count. A fixed window ran past the end of the list and swallowed the
// jsonb_typeof(...) in ('string','number','boolean') on the next line, so the
// server's set came back with three phantom keys and this check reported a
// mismatch that did not exist.
const keyListStart = sql.indexOf("where key in (") + "where key in (".length;
const sqlPropsBlock = sql.slice(keyListStart, sql.indexOf(")", keyListStart));
const sqlProps = new Set([...sqlPropsBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
const jsPropsMatch = analyticsJs.match(/const ALLOWED_PROPS = new Set\(\[([\s\S]*?)\]\)/);
const jsProps = new Set(jsPropsMatch ? [...jsPropsMatch[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : []);

check(
  "The client and server prop allowlists are the same set",
  jsProps.size > 0 &&
    jsProps.size === sqlProps.size &&
    [...jsProps].every((k) => sqlProps.has(k)),
  jsProps.size === 0
    ? "could not parse ALLOWED_PROPS from js/analytics.js"
    : `client ${[...jsProps].sort().join(",")} / server ${[...sqlProps].sort().join(",")}`
);

// Named rather than pattern-matched, because this is the actual list of things
// that must never end up in an analytics payload. A key added to the allowlist
// that means one of these is a privacy regression, and it should be a build
// failure rather than a code-review catch.
const FORBIDDEN = [
  "email", "password", "pass", "token", "access_token", "refresh_token", "jwt",
  "username", "name", "handle", "message", "body", "chat", "ip", "address",
  "session", "secret", "key", "auth",
];
const leaky = [...jsProps, ...sqlProps].filter((k) => FORBIDDEN.includes(k));
check(
  "No allowlisted prop could carry personal or secret data",
  leaky.length === 0,
  leaky.length === 0
    ? `${FORBIDDEN.length} forbidden keys, none present`
    : `${leaky.join(", ")} - analytics must identify a user only by auth.uid()`
);

// The sanitizer must also reject non-scalars, or an allowlisted key could
// carry an arbitrary object with anything inside it.
check(
  "The server sanitizer keeps only scalar values",
  /jsonb_typeof\(value\) in \('string', 'number', 'boolean'\)/.test(sql),
  "jsonb_typeof(value) in ('string','number','boolean') - an object under an allowed key would smuggle anything"
);

check(
  "The server sanitizer caps string length",
  /left\(value #>> '\{\}', \d+\)/.test(sql),
  "strings are truncated, so an allowed key cannot become a free-text field"
);

// ---- 5. the tables are unreadable from a browser --------------------------
// These are the grants that make the raw event trail private. RLS with no
// policies is the intent; the revoke is what makes it true for a table the
// anon/authenticated roles were granted on by default.
for (const table of ["analytics_events", "active_days", "analytics_event_types"]) {
  check(
    `public.${table} has RLS enabled and no client grants`,
    new RegExp(`alter table public\\.${table} enable row level security`).test(sql) &&
      new RegExp(`revoke all on table public\\.${table} from anon, authenticated`).test(sql),
    "RLS on with no policies, and no direct grants - reads go through the admin aggregates only"
  );
}

check(
  "track_event and touch_active_day are the only things a browser may call",
  /grant execute on function public\.track_event\(text, jsonb\) to authenticated/.test(sql) &&
    /grant execute on function public\.touch_active_day\(\) to authenticated/.test(sql) &&
    /revoke all on function public\.sanitize_event_props\(jsonb\) from public, anon, authenticated/.test(sql),
  "the sanitizer itself is not reachable; the two write RPCs are"
);

// ---- 6. events are fired on actions, not on renders ------------------------
// The whole duplicate-event problem in one assertion. A render is not an
// action, and the events that recur for one subject - a match, a sponsor
// placement - have to be keyed or they inflate with every re-render and
// reconnect.
check(
  "trackOnce takes a key, so a recurring event can be deduplicated per subject",
  /export function trackOnce\(event, props = \{\}, key = event\)/.test(analyticsJs),
  "the key is what makes one impression per placement per session possible"
);

const mainJs = callSites[0];
for (const [what, pattern] of [
  ["the online draft start", /draft_started:\$\{matchId\}/],
  ["the online draft completion", /draft_completed:\$\{o\.matchId\}/],
]) {
  check(
    `${what} is keyed to its match`,
    pattern.test(mainJs),
    "a reconnect re-enters this path and must not count as a second draft"
  );
}

check(
  "A sponsor impression is keyed to its campaign and placement",
  /sponsor_impression:\$\{placement\}:\$\{campaign\.id\}/.test(callSites[3]),
  "two rails are two impressions; the same rail twice is one"
);

console.log(renderSection("Product analytics"));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
