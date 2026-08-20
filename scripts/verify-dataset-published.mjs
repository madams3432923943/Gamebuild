#!/usr/bin/env node
// IS THE POOL THE SERVER PLAYS ON THE POOL IN THIS REPO?
//
// The dataset lives in two places by necessity - data/*.js for offline play,
// Postgres for the Edge Function - and until this check existed, nothing made
// the second follow the first. It followed when somebody remembered to run the
// seed workflow. When they did not, offline games used the new dataset and
// online games used the old one, and the only trace was the dataset_version
// stamped on finished matches, which nobody reads.
//
// That is not hypothetical. Adding SAF to tools/build-nfl-data.mjs's unit map
// took the football pool from 14,388 rows to 14,431 - 43 safety units that 48
// team-seasons had been missing entirely. Offline drafts got them the moment
// the commit landed. Ranked drafts would not have, indefinitely, and every
// safety's rating differs between the two pools because ratings are percentiles
// against whatever pool computed them.
//
// WHAT IT COMPARES
//
// The fingerprint from js/lib/dataset-version.js: row count and newest season,
// the same string the Edge Function stamps on a finished match. Read the file
// for what that does and does not catch. Two rows are also asserted here that
// the fingerprint alone cannot express:
//
//   - the client's formula and the Edge Function's still agree. They are
//     separate copies (one JS, one TS behind a Deno import) and a change to
//     either alone makes every stored dataset_version look like drift.
//   - the count came back as an exact count, not a page. PostgREST caps a
//     response at 1000 rows, and counting a page instead of a table is the
//     exact bug this whole area exists because of.
//
// WHERE IT RUNS
//
// At the end of both seed workflows, where it proves the publish actually
// landed rather than merely returning 200 - and on main, where it proves the
// publish happened at all. It is skipped on main only when that push itself
// touched data/, because the seed workflow triggered by the same push is what
// resolves the difference and the two race by design.
//
// Needs network. Unlike the parity dataset check this cannot degrade to a skip
// on its own: a gate that passes when it cannot see the thing it gates is not a
// gate. Pass --allow-offline where a skip is genuinely acceptable.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderCheck, renderSection, summarize, PASS, FAIL, WARN } from "./lib/report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ALLOW_OFFLINE = process.argv.includes("--allow-offline");

const checks = [];
const add = (title, status, detail = "") => checks.push({ title, status, detail: String(detail) });

const { SPORTS, ensureSportData } = await import(pathToUrl(path.join(ROOT, "js", "sports", "index.js")));
const { datasetVersion } = await import(pathToUrl(path.join(ROOT, "js", "lib", "dataset-version.js")));

// ---- the two formulas have not drifted from each other ---------------------
//
// The Edge Function's copy is TypeScript importing from jsr:, so it cannot be
// imported here. Its behaviour is asserted against the same rows instead, by
// reading the format strings out of the source - which is what would actually
// change if someone edited one side.
const edgeSrc = await readFile(
  path.join(ROOT, "supabase", "functions", "simulate-match", "sports", "index.ts"),
  "utf8"
);
const edgeFormats = [...edgeSrc.matchAll(/datasetVersion:\s*\(rows\)\s*=>\s*`([^`]+)`/g)].map((m) => m[1]);
const EXPECTED_EDGE = ["nba-players-${rows.length}-${maxSeason(rows)}", "nfl-generated-${rows.length}-${maxSeason(rows)}"];
add(
  "The Edge Function still builds the fingerprint the client expects",
  edgeFormats.length === EXPECTED_EDGE.length && EXPECTED_EDGE.every((f) => edgeFormats.includes(f))
    ? PASS
    : FAIL,
  edgeFormats.length
    ? `found ${edgeFormats.join(", ")}`
    : "no datasetVersion format found in the Edge Function's sport registry"
);

// ---- credentials -----------------------------------------------------------
const clientSrc = await readFile(path.join(ROOT, "js", "supabaseClient.js"), "utf8");
const url = clientSrc.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
const key = clientSrc.match(/SUPABASE_PUBLISHABLE_KEY\s*=\s*"([^"]+)"/)?.[1];

if (!url || !key) {
  add(
    "The live pools match this repo's datasets",
    FAIL,
    "Could not read the Supabase URL/publishable key out of js/supabaseClient.js."
  );
  report();
}

/**
 * Row count and newest season for a table, in two requests and no rows.
 *
 * `Prefer: count=exact` puts the real total in the Content-Range header, so
 * this never pages and never sees a row - which is the point. The pools are
 * public readable data, so the publishable key is all it takes and no secret
 * is involved.
 */
async function tableFingerprint(prefix, table, timeoutMs = 30000) {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async (query, extra = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
        headers: { ...headers, ...extra },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`.trim());
      return res;
    } finally {
      clearTimeout(timer);
    }
  };

  const counted = await get("select=id&limit=1", { Prefer: "count=exact" });
  const range = counted.headers.get("content-range") || "";
  const total = Number(range.split("/")[1]);
  if (!Number.isFinite(total)) {
    throw new Error(`no exact count in Content-Range (${range || "header absent"})`);
  }

  const newest = await get("select=season&order=season.desc.nullslast&limit=1");
  const rows = await newest.json();
  const season = Number(rows?.[0]?.season);

  return {
    total,
    version: `${prefix}-${total}-${Number.isFinite(season) && season > 0 ? season : "legacy"}`,
  };
}

/** The prefix each sport stamps. Read off the sport rather than repeated here,
 * so a new sport cannot be added to the registry and forgotten by this check. */
function prefixFor(sport) {
  const version = sport.datasetVersion();
  // `nba-players-10290-2025` -> `nba-players`. Everything up to the count.
  return version.replace(/-\d+-(\d+|legacy)$/, "");
}

for (const meta of SPORTS) {
  if (!meta.live) continue;
  await ensureSportData(meta.id);
  const sport = SPORTS.find((s) => s.id === meta.id);
  const local = sport.datasetVersion();
  const prefix = prefixFor(sport);

  let remote;
  try {
    remote = await tableFingerprint(prefix, sport.table);
  } catch (e) {
    add(
      `${meta.name}: the live \`${sport.table}\` table matches data/`,
      ALLOW_OFFLINE ? WARN : FAIL,
      `Could not read the live table (${e.message}). ` +
        (ALLOW_OFFLINE
          ? "Running with --allow-offline, so this is a warning."
          : "This check needs network access and does not degrade to a pass - " +
            "pass --allow-offline if a skip is genuinely acceptable here.")
    );
    continue;
  }

  add(
    `${meta.name}: the live \`${sport.table}\` table matches data/`,
    local === remote.version ? PASS : FAIL,
    local === remote.version
      ? local
      : `repo is ${local}, live table is ${remote.version}. ` +
        `Offline games use the repo dataset and online games use the table, so ranked results ` +
        `are being ranked against a different pool than the draft grade. Run the sport's seed ` +
        `workflow (Seed Players / Seed NFL) to publish.`
  );
}

report();

function report() {
  console.log(renderSection("Published dataset (the live pool is this repo's pool)"));
  for (const c of checks) console.log(renderCheck(c));
  const { counts, ok } = summarize(checks);
  console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}  warnings ${counts[WARN] || 0}\n`);
  process.exit(ok ? 0 : 1);
}

function pathToUrl(p) {
  return new URL(`file://${p}`).href;
}
