#!/usr/bin/env node
// THE EDGE FUNCTION'S REQUEST HANDLER, ACTUALLY EXECUTED, END TO END.
//
// WHY THIS EXISTS
//
// On 2026-08-24 a refactor left a reference behind:
//
//   ReferenceError: playerRows is not defined
//       at Object.handler (simulate-match/index.ts:438:53)
//
// `playerRows` is a const inside datasetStatsFor(). The handler read it from a
// different scope, on the line that stamps the dataset version onto a finished
// match - the LAST statement before the result is written. Every online game
// for the next ten days simulated correctly, produced a real box score and a
// real winner, and then threw on the way to saving any of it. Both players
// watched "STILL SIMULATING..." resolve to "couldn't load the result".
//
// AN OUT-OF-SCOPE CONST IS NOT A PARSE ERROR. `playerRows` could have been a
// global, so the file compiles, bundles and imports cleanly; it is only an
// error when the line RUNS. And nothing ran it:
//
//   verify-server-dataset and verify-result-provenance match regexes against
//   this file as a STRING;
//   verify-parity executes only the vendored engine siblings beside it;
//   CI bundles it with esbuild purely to see whether it parses;
//   verify-edge-outcome compiles and imports the real thing, then calls
//   buildMatchOutcome and never enters the handler at all.
//
// So the one file that decides what every ranked game does to both players'
// permanent records had no test that executed its main path. This is that test.
//
// WHAT IT DRIVES. A real Request goes into the real compiled handler and a real
// Response comes out: request parsing, authentication, the match lookup, the
// participant check, the already-finalised short circuit, sport dispatch, the
// dataset load, roster normalisation, the forfeit reconciliation, the seeded
// simulation, the tie and MVP guards, both profile lookups, the rating
// exchange, buildMatchOutcome for both sides, and the finalize RPC payload.
// Both sports, over the repository's real datasets and real bot-drafted
// rosters.
//
// NOTHING IS WEAKENED TO MAKE IT PASS. The only things replaced are the two
// edges the process genuinely does not have: `Deno`, and the Supabase client.
// The client is backed by an in-memory database whose rows are built the same
// way tools/export-nfl-sql.mjs builds the real ones - `payload` carrying the
// exact dataset object - so the server's own normalizers do their real work.
// The RPC records what it was handed instead of writing it, and the assertions
// read that payload.
//
// WHAT IT DOES NOT PROVE. That the function is deployed, that Postgres accepts
// the payload, or that finalize_match_result does what its migration says.
// Those need a live database; verify-edge-outcome covers the profile
// bookkeeping rules and verify-schema-documented covers the RPC's signature.

import { build } from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadDataset } from "../data/load.mjs";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";
import { setActiveSport } from "../js/sports/index.js";
import { NBA } from "../js/sports/nba/index.js";
import { NFL } from "../js/sports/nfl/index.js";
import { DraftState } from "../js/draft.js";

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

console.log(renderSection("Edge Function handler (a real request, through the real handler)"));

// ---------------------------------------------------------------------------
// Compile the real thing
// ---------------------------------------------------------------------------

/**
 * The `jsr:` import, replaced by a client this file can steer.
 *
 * verify-edge-outcome stubs the same specifier with a createClient that
 * THROWS, which is right for a test that must never reach the database. This
 * one has to reach it, so the stub defers to a factory the test installs on
 * globalThis - the module still calls createClient exactly as it does in
 * production, and gets back whatever database this run set up.
 */
const jsrStub = {
  name: "jsr-stub",
  setup(b) {
    b.onResolve({ filter: /^jsr:/ }, (args) => ({ path: args.path, namespace: "jsr-stub" }));
    b.onLoad({ filter: /.*/, namespace: "jsr-stub" }, () => ({
      contents:
        `export const createClient = (...args) => {\n` +
        `  if (!globalThis.__bkCreateClient) throw new Error("no test client installed");\n` +
        `  return globalThis.__bkCreateClient(...args);\n` +
        `};`,
      loader: "js",
    }));
  },
};

const dir = await mkdtemp(path.join(tmpdir(), "bk-edge-handler-"));
const outfile = path.join(dir, "simulate-match.mjs");
await build({
  entryPoints: ["supabase/functions/simulate-match/index.ts"],
  bundle: true,
  platform: "neutral",
  format: "esm",
  outfile,
  plugins: [jsrStub],
  logLevel: "silent",
});

// The module ends in Deno.serve(handler). Capturing the handler is the whole
// mechanism: it is the real function object production calls, and everything
// below simply hands it Requests.
let handler = null;
globalThis.Deno = {
  env: { get: (key) => `stub-${key}` },
  serve: (fn) => {
    handler = fn;
  },
};

await import(pathToFileURL(outfile).href);
check("The handler is reachable and installed by Deno.serve", typeof handler === "function");
if (typeof handler !== "function") {
  for (const c of checks) console.log(renderCheck(c));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// A database, in memory, shaped like the real one
// ---------------------------------------------------------------------------

const PLAYER_A = "11111111-1111-4111-8111-111111111111";
const PLAYER_B = "22222222-2222-4222-8222-222222222222";

/**
 * The rows the server reads for a sport, built exactly as the seed builds
 * them. tools/export-nfl-sql.mjs writes `payload` carrying the whole dataset
 * object, and generatedNflEntry reads it back - so building them any other way
 * here would test a shape production never sees.
 */
async function tableRows(sportId) {
  if (sportId === "nba") {
    const players = await loadDataset("nba-players");
    return players;
  }
  const players = await loadDataset("nfl-players");
  const units = await loadDataset("nfl-units");
  return [
    ...players.map((p) => ({
      kind: "player", unit_group: null, name: p.name, team: p.team,
      era: p.era, season: p.season, pos: p.pos, payload: p,
    })),
    ...units.map((u) => ({
      kind: "unit", unit_group: u.group, name: u.name, team: u.team,
      era: u.era, season: u.season, pos: u.pos, payload: u,
    })),
  ];
}

function blankProfile(id, username) {
  return {
    id, username,
    online_wins: 0, online_losses: 0, friendly_wins: 0, friendly_losses: 0,
    history: [], personal_bests: {}, draft_counts: {}, era_records: {},
    sport_ratings: {}, mvp_teams: {}, badges: [],
  };
}

/**
 * A Supabase client good enough for this handler, and no more.
 *
 * Deliberately NOT a general fake. Every method here exists because a line in
 * index.ts calls it, and a call this does not model throws by name rather than
 * returning undefined - a silent `{ data: null }` would let the handler take a
 * branch production never takes and report a pass for it.
 */
function makeClient(db) {
  const result = (data, error = null) => Promise.resolve({ data, error });

  const from = (table) => {
    const state = { table, filters: [], inFilter: null };
    const rowsOf = () => {
      let rows = db.tables[table] ?? [];
      for (const [column, value] of state.filters) rows = rows.filter((r) => r[column] === value);
      if (state.inFilter) {
        const [column, values] = state.inFilter;
        rows = rows.filter((r) => values.includes(r[column]));
      }
      return rows;
    };
    const api = {
      select() { return api; },
      eq(column, value) { state.filters.push([column, value]); return api; },
      in(column, values) { state.inFilter = [column, values]; return api; },
      single() {
        const rows = rowsOf();
        return rows.length === 1
          ? result(rows[0])
          : result(null, { message: `expected one ${table} row, found ${rows.length}` });
      },
      maybeSingle() {
        const rows = rowsOf();
        return result(rows[0] ?? null);
      },
      // loadWholeTable pages with .range(); it stops when a page comes back
      // shorter than the page size, so the slice has to be honest about the end.
      range(fromIndex, toIndex) {
        db.reads.push({ table, fromIndex, toIndex });
        return result(rowsOf().slice(fromIndex, toIndex + 1));
      },
      then(onFulfilled, onRejected) {
        // `await admin.from(...).select(...).eq(...)` with no terminal method -
        // the match_picks read does exactly this and expects an array.
        return result(rowsOf()).then(onFulfilled, onRejected);
      },
    };
    return api;
  };

  return {
    auth: {
      getUser: () =>
        db.authenticatedAs
          ? result({ user: { id: db.authenticatedAs } })
          : result({ user: null }, { message: "no session" }),
    },
    from,
    rpc: (name, args) => {
      if (name !== "finalize_match_result") {
        throw new Error(`the handler called an RPC this test does not model: ${name}`);
      }
      db.rpcCalls.push({ name, args });
      if (db.rpcFails) return result(null, { message: "finalize exploded" });
      return result({ match_id: args.p_match_id, winner: args.p_winner });
    },
  };
}

// ---------------------------------------------------------------------------
// A real match, from a real draft
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Two bot-drafted rosters, the same way every other suite builds them, so the
 * simulation the handler runs is a simulation of a game somebody could play. */
function draftPair(sport, slots, seed) {
  const real = Math.random;
  Math.random = mulberry32(seed);
  try {
    const pool = sport.playersInEra(sport.players(), "all");
    const draft = new DraftState(pool, [], slots);
    while (!draft.isComplete()) {
      if (!draft.rollNextSquad()) break;
      draft.botAutoPick("A", { banTop: 0 });
      draft.botAutoPick("B", { banTop: 0 });
    }
    return [draft.rosterA, draft.rosterB];
  } finally {
    Math.random = real;
  }
}

const MATCH_ID = "33333333-3333-4333-8333-333333333333";

async function freshDb(sportId, rosterA, rosterB, over = {}) {
  return {
    authenticatedAs: PLAYER_A,
    rpcCalls: [],
    reads: [],
    rpcFails: false,
    tables: {
      matches: [
        {
          id: MATCH_ID,
          sport: sportId,
          status: "ready_to_simulate",
          player_a: PLAYER_A,
          player_b: PLAYER_B,
          roster_a: rosterA,
          roster_b: rosterB,
          era: "all",
          game_mode: "ranked",
          is_friendly: false,
          tactic_a: sportId === "nfl"
            ? JSON.stringify({ offense: "balanced-offense", defense: "balanced-defense" })
            : "balanced",
          tactic_b: sportId === "nfl"
            ? JSON.stringify({ offense: "balanced-offense", defense: "balanced-defense" })
            : "balanced",
          rotation_a: null, rotation_b: null,
          matchups_a: null, matchups_b: null,
          winner: null,
          ...over.match,
        },
      ],
      match_results: over.match_results ?? [],
      match_picks: [],
      profiles: [blankProfile(PLAYER_A, "Player A"), blankProfile(PLAYER_B, "Player B")],
      [sportId === "nba" ? "players" : "nfl_players"]: await tableRows(sportId),
    },
  };
}

/**
 * One request through the real handler.
 *
 * IT NEVER THROWS, and that is deliberate. The fault this file exists for is a
 * ReferenceError escaping the handler, so letting it escape HERE would end the
 * run with a stack trace and no report - the checks are printed at the end, so
 * a crash loses every result gathered before it. The throw is captured and
 * returned as `threw`, which makes it a failing check with the stack in its
 * detail rather than a dead run.
 */
async function callHandler(db, body, { auth = "Bearer stub-token" } = {}) {
  globalThis.__bkCreateClient = () => makeClient(db);
  const req = new Request("https://example.test/functions/v1/simulate-match", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify(body),
  });
  let res;
  try {
    res = await handler(req);
  } catch (error) {
    return { status: 0, body: null, raw: "", threw: error };
  }
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* a non-JSON body is itself a finding */ }
  return { status: res.status, body: parsed, raw: text, threw: null };
}

/** The first few frames of a throw, which is what a person reading a red build
 * needs: the file, the line and the name. */
const whereItBroke = (error) =>
  String(error?.stack || error).split("\n").slice(0, 3).join("\n         ");

// ---------------------------------------------------------------------------
// The run, per sport
// ---------------------------------------------------------------------------

for (const [sportId, sport] of [["nba", NBA], ["nfl", NFL]]) {
  setActiveSport(sportId);
  await sport.preload();
  const [rosterA, rosterB] = draftPair(sport, sport.slots.ranked, 0xed6e_0001);

  const db = await freshDb(sportId, rosterA, rosterB);
  const res = await callHandler(db, { match_id: MATCH_ID, sport: sportId });

  // THE CHECK THE OUTAGE NEEDED. A ReferenceError or TypeError anywhere in the
  // handler surfaces here, whether it escapes as a throw or is caught and
  // turned into a 500 - and it names the line, which is what a person reading
  // a red build actually needs.
  const label = sportId.toUpperCase();
  check(
    `${label}: a full match request runs the handler without throwing`,
    !res.threw,
    res.threw ? whereItBroke(res.threw) : undefined
  );
  if (res.threw) continue;

  check(
    `${label}: the handler answers 200 and reports a complete match`,
    res.status === 200 && res.body?.status === "complete",
    res.status === 200 ? undefined : `HTTP ${res.status} — ${JSON.stringify(res.body)?.slice(0, 200)}`
  );
  if (res.status !== 200) continue;

  // THE FINAL LINES, which is where the outage lived. Everything the handler
  // computes after the simulation is on the far side of the code that broke,
  // so asserting the response carries all of it is what makes this test catch
  // that class rather than only the specific variable.
  const missing = ["winner", "scoreA", "scoreB", "result", "simulationSeed", "engineVersion", "datasetVersion", "rulesVersion"]
    .filter((key) => res.body[key] === undefined || res.body[key] === null);
  check(
    `${label}: the response carries every field computed after the simulation`,
    missing.length === 0,
    missing.length ? `missing: ${missing.join(", ")}` : `datasetVersion "${res.body.datasetVersion}"`
  );

  // The dataset version by name, because it is the exact value the broken line
  // was computing and a blank one would satisfy the presence check above only
  // by being an empty string.
  check(
    `${label}: the dataset version is stamped from the rows the server loaded`,
    typeof res.body.datasetVersion === "string" &&
      res.body.datasetVersion.length > 8 &&
      res.body.datasetVersion.startsWith(sportId === "nba" ? "nba-players-" : "nfl-generated-"),
    `"${res.body.datasetVersion}"`
  );

  const rpc = db.rpcCalls[0];
  check(
    `${label}: the result is handed to finalize_match_result exactly once`,
    db.rpcCalls.length === 1 && rpc?.name === "finalize_match_result",
    `${db.rpcCalls.length} RPC call(s)`
  );

  const payload = rpc?.args?.p_result;
  const scoresLookReal =
    Number.isFinite(payload?.score_a) && Number.isFinite(payload?.score_b) &&
    payload.score_a >= 0 && payload.score_b >= 0 &&
    payload.score_a + payload.score_b > 0;
  check(
    `${label}: the saved result carries a real scoreboard`,
    scoresLookReal,
    `${payload?.score_a}-${payload?.score_b}`
  );

  // The MVP is the field that took the whole post-game screen down once
  // already, by being read off a roster entry that had no name.
  const mvpName = payload?.mvp?.name;
  check(
    `${label}: the saved MVP is a named player with a line`,
    typeof mvpName === "string" && mvpName.length > 0 &&
      !/^(undefined|null|NaN)$/i.test(mvpName) &&
      payload?.mvp?.line && typeof payload.mvp.line === "object",
    `"${mvpName}"`
  );

  const boxSlots = Object.keys(payload?.box_a ?? {});
  check(
    `${label}: both box scores are saved, with a line per roster slot`,
    boxSlots.length > 0 && Object.keys(payload?.box_b ?? {}).length > 0,
    `${boxSlots.length} slots on side A`
  );

  check(
    `${label}: the winner the RPC is told matches the winner the caller is told`,
    rpc?.args?.p_winner === res.body.winner && ["A", "B"].includes(res.body.winner),
    `rpc "${rpc?.args?.p_winner}" vs response "${res.body.winner}"`
  );

  // Both profile updates are built after the simulation, on the same side of
  // the outage, and each one runs buildMatchOutcome over the real box score.
  check(
    `${label}: both players' profile updates were built`,
    !!rpc?.args?.p_profile_a && !!rpc?.args?.p_profile_b,
    Object.keys(rpc?.args?.p_profile_a ?? {}).slice(0, 6).join(", ")
  );

  // The dataset really was read through the paging reader rather than mocked
  // past - if `reads` is empty the handler took a cached or short-circuited
  // path and this run proved much less than it appears to.
  check(
    `${label}: the player table was actually paged in`,
    db.reads.length > 0,
    `${db.reads.length} page read(s) of ${db.reads[0]?.table}`
  );
}

// ---------------------------------------------------------------------------
// The guard rails, which are also handler code nothing executed
// ---------------------------------------------------------------------------

setActiveSport("nfl");
const [gRosterA, gRosterB] = draftPair(NFL, NFL.slots.ranked, 0xed6e_0002);

{
  const db = await freshDb("nfl", gRosterA, gRosterB);
  db.authenticatedAs = null;
  const res = await callHandler(db, { match_id: MATCH_ID });
  check("An unauthenticated caller is refused with 401", res.status === 401,
        res.threw ? whereItBroke(res.threw) : `HTTP ${res.status}`);
}

{
  const db = await freshDb("nfl", gRosterA, gRosterB);
  db.authenticatedAs = "99999999-9999-4999-8999-999999999999";
  const res = await callHandler(db, { match_id: MATCH_ID });
  check("A caller who is not in the match is refused with 403", res.status === 403,
        res.threw ? whereItBroke(res.threw) : `HTTP ${res.status}`);
}

{
  const db = await freshDb("nfl", gRosterA, gRosterB, { match: { status: "drafting" } });
  const res = await callHandler(db, { match_id: MATCH_ID });
  check(
    "A match that is not ready to simulate is refused with 409",
    res.status === 409,
    res.threw ? whereItBroke(res.threw) : `HTTP ${res.status}`
  );
}

{
  // The short circuit that stops a second caller re-simulating a finished
  // match - which is the normal case for the SECOND player in every online
  // game, and therefore runs about as often as the main path does.
  const db = await freshDb("nfl", gRosterA, gRosterB, {
    match_results: [{ match_id: MATCH_ID, score_a: 24, score_b: 17 }],
  });
  const res = await callHandler(db, { match_id: MATCH_ID });
  check(
    "An already-finalised match is returned rather than simulated again",
    res.status === 200 && res.body?.status === "complete" && db.rpcCalls.length === 0,
    res.threw ? whereItBroke(res.threw) : `HTTP ${res.status}, ${db.rpcCalls.length} RPC call(s)`
  );
}

{
  const db = await freshDb("nfl", gRosterA, gRosterB, { match: { sport: "cricket" } });
  const res = await callHandler(db, { match_id: MATCH_ID });
  check(
    "A sport with no server engine is refused rather than simulated as basketball",
    res.status === 501,
    res.threw ? whereItBroke(res.threw) : `HTTP ${res.status}`
  );
}

{
  // A failing RPC must surface as a 500 with its message, not as a silent
  // "complete" - the client believes this response and stops polling.
  const db = await freshDb("nfl", gRosterA, gRosterB);
  db.rpcFails = true;
  const res = await callHandler(db, { match_id: MATCH_ID });
  check(
    "A failed finalize is reported as an error, not as a finished game",
    res.status === 500 && /failed to finalize/i.test(res.body?.error ?? ""),
    res.threw ? whereItBroke(res.threw) : `HTTP ${res.status} — ${res.body?.error}`
  );
}

{
  const db = await freshDb("nfl", gRosterA, gRosterB);
  const res = await callHandler(db, { warm: true, sport: "nfl" });
  check(
    "The warm-up path boots and loads a dataset without touching a match",
    res.status === 200 && res.body?.status === "warm" && res.body?.dataset === "ready" &&
      db.rpcCalls.length === 0,
    res.threw ? whereItBroke(res.threw) : JSON.stringify(res.body)
  );
}

{
  const db = await freshDb("nfl", gRosterA, gRosterB);
  const res = await callHandler(db, {});
  check("A request with no match_id is refused with 400", res.status === 400,
        res.threw ? whereItBroke(res.threw) : `HTTP ${res.status}`);
}

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
