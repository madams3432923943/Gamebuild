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

// SPLITTING SQL WITHOUT A PARSER.
//
// Each statement goes over separately, because the API runs every call on its
// own connection - that is why the seed can no longer rely on a begin/commit
// wrapper and stages its rows instead (see
// db/migrations/20260820_01_atomic_dataset_publish.sql). Any `begin` or
// `commit` still found is dropped rather than sent: on a per-call connection it
// would only open a transaction nothing ever closes.
//
// Splitting on `;` alone is not enough any more. The seed now ends with a call
// into a plpgsql function, and a future seed may inline a `do $$ ... $$` block;
// both contain semicolons that belong to the body, not to the statement. So the
// scan tracks dollar-quoted strings ($$ ... $$, $tag$ ... $tag$) and single
// quotes, and only breaks on a semicolon found outside both. Getting this wrong
// does not fail loudly - it sends half a function body as a statement and the
// error names a syntax problem in generated SQL that is perfectly valid.
function splitStatements(text) {
  const out = [];
  let buf = "";
  let i = 0;
  let dollarTag = null;
  let inSingle = false;
  while (i < text.length) {
    const ch = text[i];
    if (dollarTag) {
      if (text.startsWith(dollarTag, i)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
    } else if (inSingle) {
      // '' is an escaped quote inside a literal, not the end of one - and
      // player names are full of apostrophes, so this branch is load-bearing.
      if (ch === "'" && text[i + 1] === "'") {
        buf += "''";
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
    } else {
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i));
      if (tag) {
        dollarTag = tag[0];
        buf += dollarTag;
        i += dollarTag.length;
        continue;
      }
      if (ch === "'") inSingle = true;
      else if (ch === ";") {
        out.push(buf);
        buf = "";
        i += 1;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

const statements = splitStatements(sql)
  // Comment-only chunks are the file's header and the notes between sections.
  .map((s) => s.split("\n").filter((line) => !/^\s*--/.test(line)).join("\n").trim())
  .filter((s) => s && !/^(begin|commit)$/i.test(s))
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

let published = null;
for (let i = 0; i < statements.length; i++) {
  const res = await run(statements[i], `statement ${i + 1}/${statements.length}`);
  // The seed's last statement is the publish call, and it returns the live row
  // count. Reporting it is the difference between "every request returned 200"
  // and "the pool the game reads now holds this many rows" - the staging table
  // could load perfectly and still publish nothing if the function changed
  // underneath us.
  const row = Array.isArray(res) ? res[0] : null;
  const value = row && Object.values(row)[0];
  if (/^select public\.publish_/i.test(statements[i]) && Number.isFinite(Number(value))) {
    published = Number(value);
  }
  process.stdout.write(`\r  applied ${i + 1}/${statements.length}`);
}

if (published === null) {
  console.error(
    "\nThe seed did not end in a publish call, so nothing confirms the live table was replaced. " +
      "Re-generate it with tools/export-players-sql.mjs or tools/export-nfl-sql.mjs."
  );
  process.exit(1);
}

console.log(`\npublished ${published} rows`);
console.log("done");
