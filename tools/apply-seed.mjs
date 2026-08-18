// Loads db/seed/players-seed.sql into the database.
//
// Uses the Supabase Management API rather than psql, because the only
// credential this project has wired up is SUPABASE_ACCESS_TOKEN - the same
// secret the Edge Function deploy uses. A direct database connection would
// need the database password, which is a second secret to store and rotate
// for no benefit.
//
// Runs from CI (.github/workflows/seed-players.yml) so the SQL goes straight
// from the repo to the database. That is the whole point: 9,418 rows is ~1MB,
// and every route that passes it through a person or a chat window is a route
// where a name gets mangled or a batch silently vanishes.
//
// Statements are sent one at a time and the run stops at the first failure, so
// a problem is reported against the statement that caused it instead of
// disappearing into a partial load.
//
// Usage:  SUPABASE_ACCESS_TOKEN=... node tools/apply-seed.mjs [--project-ref X]
//         SUPABASE_ACCESS_TOKEN=... node tools/apply-seed.mjs --seed db/seed/nfl-seed.sql

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));

// Which seed to apply. Defaults to basketball's for backward compatibility -
// the workflow that predates football calls this with no --seed argument.
const seedArg = process.argv.indexOf("--seed");
const SEED =
  seedArg === -1
    ? join(here, "..", "db", "seed", "players-seed.sql")
    : join(here, "..", process.argv[seedArg + 1]);

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN is not set.");
  process.exit(1);
}

const refArg = process.argv.indexOf("--project-ref");
const ref = refArg === -1 ? process.env.SUPABASE_PROJECT_REF || "aauvgiygwrwdbtruhxta" : process.argv[refArg + 1];

if (!existsSync(SEED)) {
  console.error(`Missing ${SEED}. Run the matching exporter: tools/export-players-sql.mjs or tools/export-nfl-sql.mjs`);
  process.exit(1);
}

const sql = readFileSync(SEED, "utf8");

// The generated file wraps everything in begin/commit and chunks the inserts.
// Each statement goes over separately, so the transaction wrapper is dropped -
// the API runs each call on its own connection and a stray `begin` would leave
// an open transaction that never commits.
const statements = sql
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s && !/^--/.test(s) && !/^(begin|commit)$/i.test(s))
  .map((s) => `${s};`);

console.log(`${statements.length} statements to apply against ${ref}`);

async function run(query, label) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    console.error(`\n${label} failed: HTTP ${res.status}`);
    console.error((await res.text()).slice(0, 600));
    process.exit(1);
  }
  return res.json().catch(() => null);
}

for (let i = 0; i < statements.length; i++) {
  await run(statements[i], `statement ${i + 1}/${statements.length}`);
  process.stdout.write(`\r  applied ${i + 1}/${statements.length}`);
}

const check = await run(
  "select count(*) as rows, count(season) as with_season, count(distinct name) as players from public.players",
  "verification"
);
console.log(`\n${JSON.stringify(check)}`);
console.log("done");
