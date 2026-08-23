#!/usr/bin/env node
// Does db/ still describe the database?
//
// WHY THIS EXISTS
//
// CLAUDE.md says db/ is documentation of what was applied, and it had stopped
// being that. On 2026-08-19 the live project had 65 applied migrations and db/
// held 39 files. Two entire features - account deletion, and a content
// moderation system with a populated blocklist and three enforcing triggers -
// existed only in production, in no file, in no doc, and unknown to the client
// that kept surfacing their errors as "Database error saving new user".
//
// The same gap hid something worse. 20260805_01 recreated matches_public `with
// (security_invoker = true)`, closing a P0 from the August audit. 20260811_01
// added a column with a plain `create or replace view`, which silently discards
// reloptions, and the view ran as its owner for eight days. Both migrations had
// files. Neither file was wrong. What was missing was anything that looked at
// the live database and asked whether it still matched.
//
// So this is the check that would have caught both, and it is the reason
// db/applied.tsv exists: the live migration NAME and the repo FILENAME are
// different identifiers and always will be, so the mapping is written down
// instead of guessed.
//
// NEEDS NETWORK AND CREDENTIALS, which is why it is not in `npm run verify`.
// Run it before a release, or whenever migrations have been applied:
//
//     SUPABASE_DB_URL=postgres://... node scripts/verify-schema-documented.mjs
//
// Without a connection string it reports what it can check offline - that every
// file in db/migrations is accounted for, and that every row points at a file
// that exists - and says plainly that it could not reach the database. It
// exits non-zero either way if the offline half fails.

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderCheck, renderSection, summarize, PASS, FAIL, WARN } from "./lib/report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const MANIFEST = path.join(ROOT, "db/applied.tsv");
const MIGRATIONS = path.join(ROOT, "db/migrations");

const PRE_DB = "PRE-DB";
const FOLDED = "FOLDED:";

const checks = [];
const add = (title, status, detail) => checks.push({ title, status, detail: String(detail) });

/** version -> { name, target } from db/applied.tsv, comments and blanks out. */
async function readManifest() {
  const text = await readFile(MANIFEST, "utf8");
  const rows = new Map();
  for (const [i, line] of text.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [version, name, target] = trimmed.split("\t");
    if (!version || !name || !target) {
      throw new Error(`db/applied.tsv line ${i + 1} is not three tab-separated columns: ${line}`);
    }
    rows.set(version, { name, target });
  }
  return rows;
}

/** The file a manifest row points at, or null for PRE-DB. */
function fileFor(target) {
  if (target === PRE_DB) return null;
  return target.startsWith(FOLDED) ? target.slice(FOLDED.length) : target;
}

async function main() {
  const manifest = await readManifest();
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();

  // ---- offline: every row points at a real file ---------------------------
  const dangling = [];
  for (const [version, { target }] of manifest) {
    const file = fileFor(target);
    if (file && !existsSync(path.join(ROOT, file))) dangling.push(`${version} -> ${file}`);
  }
  add(
    "Every documented migration points at a file that exists",
    dangling.length === 0 ? PASS : FAIL,
    dangling.length === 0
      ? `${manifest.size} rows in db/applied.tsv`
      : `no such file: ${dangling.join(", ")}`
  );

  // ---- offline: every file is claimed by a row ----------------------------
  // A file nobody claims was either applied outside the migration system (the
  // SQL editor records no version) or never applied at all. Both are worth
  // knowing and neither is fatal, so this warns rather than fails - the
  // direction that actually bit us is the other one, below.
  const claimed = new Set([...manifest.values()].map((r) => fileFor(r.target)).filter(Boolean));
  const unclaimed = files
    .map((f) => `db/migrations/${f}`)
    .filter((f) => !claimed.has(f));
  add(
    "Every file in db/migrations is accounted for",
    unclaimed.length === 0 ? PASS : WARN,
    unclaimed.length === 0
      ? `${files.length} files, all claimed`
      : `applied out of band, or never applied: ${unclaimed.join(", ")}`
  );

  // ---- online: every applied migration is documented ----------------------
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    add(
      "Every migration applied to the project is documented",
      WARN,
      "SUPABASE_DB_URL is not set - could not read supabase_migrations.schema_migrations. " +
        "This is the half of the check that catches an undocumented migration; it did not run."
    );
  } else {
    const { default: postgres } = await import("postgres");
    const sql = postgres(dbUrl, { ssl: "require", max: 1 });
    try {
      const applied = await sql`
        select version, name from supabase_migrations.schema_migrations order by version
      `;
      const undocumented = applied
        .filter((row) => !manifest.has(row.version))
        .map((row) => `${row.version} ${row.name}`);
      add(
        "Every migration applied to the project is documented",
        undocumented.length === 0 ? PASS : FAIL,
        undocumented.length === 0
          ? `${applied.length} applied, all in db/applied.tsv`
          : `applied but undocumented: ${undocumented.join(", ")} - write the file, then add the row`
      );

      const appliedVersions = new Set(applied.map((r) => r.version));
      const phantom = [...manifest.keys()].filter((v) => !appliedVersions.has(v));
      add(
        "Nothing is documented that was never applied",
        phantom.length === 0 ? PASS : FAIL,
        phantom.length === 0
          ? "no rows without a matching applied version"
          : `in db/applied.tsv but not applied: ${phantom.join(", ")}`
      );

      // ---- online: the regression that started all this -------------------
      // Named rather than generic. matches_public is the only view in the
      // schema and it has now lost security_invoker once; a `create or replace
      // view` anywhere near it loses it again, silently, with the view still
      // returning correct-looking rows.
      const [view] = await sql`
        select coalesce(array_to_string(c.reloptions, ','), '') as opts
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'matches_public'
      `;
      const invoker = (view?.opts || "").includes("security_invoker=true");
      add(
        "matches_public still applies the caller's RLS",
        invoker ? PASS : FAIL,
        invoker
          ? "security_invoker=true"
          : "security_invoker is OFF - a `create or replace view` strips it. Drop and recreate the view."
      );

      // ---- online: and the caller can actually read through it ------------
      // An invoker view checks the CALLER's privileges on the base table, so
      // security_invoker=true is only half of a working read. `authenticated`
      // held no SELECT on public.matches at all, and every online match died on
      // "permission denied for table matches" the moment the view stopped
      // running as its owner. The grant is column-level on purpose - see
      // db/migrations/20260823_01_matches_read_grant.sql - so this compares the
      // view's own column list against the grant rather than hardcoding either.
      const ungranted = await sql`
        select a.attname
          from pg_attribute a
         where a.attrelid = 'public.matches'::regclass
           and a.attnum > 0 and not a.attisdropped
           and a.attname in (
             select column_name from information_schema.columns
              where table_schema = 'public' and table_name = 'matches_public'
           )
           and not has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')
      `;
      add(
        "authenticated can read every column matches_public exposes",
        ungranted.length === 0 ? PASS : FAIL,
        ungranted.length === 0
          ? "column-level SELECT on public.matches covers the whole view"
          : `no SELECT on public.matches(${ungranted.map((r) => r.attname).join(", ")}) - ` +
            "matches_public is security_invoker, so every read through it fails"
      );

      // The other direction: the hidden columns must stay hidden. A blanket
      // `grant select on public.matches` would fix the check above and hand
      // every client the opponent's unrevealed picks through PostgREST.
      const leaked = await sql`
        select a.attname
          from pg_attribute a
         where a.attrelid = 'public.matches'::regclass
           and a.attname in ('roster_a', 'roster_b', 'rotation_a', 'rotation_b',
                             'matchups_a', 'matchups_b', 'tactic_a', 'tactic_b')
           and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')
      `;
      add(
        "The hidden match columns stay hidden from clients",
        leaked.length === 0 ? PASS : FAIL,
        leaked.length === 0
          ? "no SELECT on the roster/strategy columns"
          : `authenticated can read public.matches(${leaked.map((r) => r.attname).join(", ")}) - ` +
            "that is an opponent's unrevealed picks, readable straight off PostgREST"
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  console.log(renderSection("Schema documentation"));
  for (const c of checks) console.log(renderCheck(c));
  const { counts, ok } = summarize(checks);
  console.log(
    `\n  passed ${counts[PASS]}  failed ${counts[FAIL]}  warnings ${counts[WARN] || 0}\n`
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
