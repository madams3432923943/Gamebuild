// Deterministic replay harness: proves the offline (client) engine and the
// online (Edge Function) engine are the same simulation.
//
// WHY THIS IS SHAPED THE WAY IT IS
//
// The brief asked to "feed the same seed + rosters into both engines and diff
// box scores at 0.1% tolerance". There is no seed to feed: engine.js calls
// bare Math.random(), and nothing threads a generator through it. Measured on
// a fixed pair of rosters, the same engine against ITSELF spans ~36%
// peak-to-peak on team score (89-128 over 200 runs). A 0.1% tolerance against
// an unseeded engine is not a test - it fails ~100% of the time on identical
// code, and tells you nothing about drift.
//
// So the harness makes the run deterministic instead, by swapping Math.random
// for a seeded stream (see lib/seeded-rng.mjs) while both engines run. Under
// a shared stream the comparison becomes exact rather than statistical: the
// tolerance is still enforced and reported, but a correct pair of engines
// diffs at 0, not "within 0.1%".
//
// Determinism alone isn't enough, because two engines can consume the same
// stream and still differ. So parity is checked on four independent axes:
//
//   1. constants  - every value engine.js imports, compared by value. A
//                   changed SCORING_K is drift even if the code is identical.
//   2. tactics    - every gamestyle's mods, compared by value.
//   3. source     - the engine's own code, comment-stripped and normalized.
//   4. box scores - both engines run under one seeded stream, diffed
//                   player-by-player and quarter-by-quarter.
//
// And a fifth axis that is NOT about code at all: the two engines are fed
// different DATASETS. The client computes datasetStats from js/data.js; the
// Edge Function computes it from the `players` table. datasetStats feeds
// posAvg(), which normalizes every matchup in the simulation - so identical
// code over a drifted dataset still produces different box scores. That check
// needs the network and degrades to a skip without it.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { PASS, FAIL, WARN, SKIP, check } from "./lib/report.mjs";
import { withSeededRandom, seedFrom } from "./lib/seeded-rng.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const CLIENT_DIR = path.join(ROOT, "js");
const EDGE_DIR = path.join(ROOT, "supabase", "functions", "simulate-match");

// Matches the client's own tolerance language. Box scores are whole numbers,
// so on a ~100-point total a single point is already 1% - meaning any
// non-zero diff on team score breaks this. That is intended: rounding is
// shared by both engines (both call the same roundLine), so there is no
// legitimate source of a sub-point difference to absorb.
const TOLERANCE_PCT = 0.1;

const LINE_KEYS = ["pts", "reb", "ast", "stl", "blk", "tov"];

// ---------------------------------------------------------------------------
// Source normalization
// ---------------------------------------------------------------------------

/** Strips comments and collapses whitespace, so a reworded comment isn't
 * reported as an engine change while a real one-character logic edit still
 * is. Deliberately simple - it is a drift detector, not a parser - and the
 * numeric checks below are what actually prove behaviour. */
function normalizeSource(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

async function readBoth(filename) {
  const [client, edge] = await Promise.all([
    readFile(path.join(CLIENT_DIR, filename), "utf8"),
    readFile(path.join(EDGE_DIR, filename), "utf8"),
  ]);
  return { client, edge };
}

/** First differing stretch of two normalized sources, with a little context,
 * so a failure names the drift instead of just asserting it exists. */
function firstDifference(a, b, window = 90) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return null;
  const from = Math.max(0, i - 30);
  return {
    offset: i,
    client: a.slice(from, from + window),
    edge: b.slice(from, from + window),
  };
}

// ---------------------------------------------------------------------------
// Scenario construction
// ---------------------------------------------------------------------------

/** Deterministic scenarios, built from their own RNG so that constructing
 * them never touches the stream the simulation will draw from. Each covers a
 * roster shape the engine explicitly supports, because the shapes take
 * different paths through it: "6TH" skips the matchup loop entirely, and the
 * 10-slot Ranked roster is the only one that exercises slotsByPosition's
 * bench assignment. Testing only one shape would leave the other paths
 * unverified. */
function buildScenarios(players, tacticIds) {
  const squads = new Map();
  for (const p of players) {
    const key = `${p.team}|${p.decade}`;
    if (!squads.has(key)) squads.set(key, []);
    squads.get(key).push(p);
  }
  // Only squads deep enough to fill a 10-man Ranked roster, sorted for a
  // stable order regardless of dataset iteration order.
  const usable = [...squads.entries()]
    .filter(([, list]) => list.length >= 10)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const rng = mulberryLocal(seedFrom("scenario-selection-v1"));
  const pickSquad = () => usable[Math.floor(rng() * usable.length)][1];

  const scenarios = [];
  for (const [label, shape] of [
    ["quick-play-5", "quick"],
    ["legacy-online-6", "legacy"],
    ["ranked-10", "ranked"],
    ["ranked-10-lopsided", "ranked"],
  ]) {
    const a = buildRoster(pickSquad(), shape);
    const b = buildRoster(pickSquad(), shape);
    if (!a || !b) continue;
    scenarios.push({
      label,
      seed: seedFrom(`bk-parity-${label}`),
      rosterA: a,
      rosterB: b,
      // Tactics are part of the simulation (they fold into stats BEFORE
      // matchups, per effectiveStats), so leaving them unset would skip a
      // real branch. Chosen deterministically from the same scenario RNG.
      tacticA: tacticIds[Math.floor(rng() * tacticIds.length)],
      tacticB: tacticIds[Math.floor(rng() * tacticIds.length)],
    });
  }
  return scenarios;
}

function mulberryLocal(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STARTERS = ["PG", "SG", "SF", "PF", "C"];

function buildRoster(squad, shape) {
  const byImpact = [...squad].sort((x, y) => y.ppg - x.ppg);
  const used = new Set();
  const roster = {};

  for (const pos of STARTERS) {
    const found = byImpact.find((p) => !used.has(p) && p.pos.includes(pos)) || byImpact.find((p) => !used.has(p));
    if (!found) return null;
    used.add(found);
    roster[pos] = found;
  }
  if (shape === "quick") return roster;

  if (shape === "legacy") {
    const sixth = byImpact.find((p) => !used.has(p));
    if (!sixth) return null;
    roster["6TH"] = sixth;
    return roster;
  }

  for (let i = 1; i <= 5; i++) {
    const found = byImpact.find((p) => !used.has(p));
    if (!found) return null;
    used.add(found);
    roster[`BENCH${i}`] = found;
  }
  return roster;
}

// ---------------------------------------------------------------------------
// Box-score diffing
// ---------------------------------------------------------------------------

function pctDiff(a, b) {
  if (a === b) return 0;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return 0;
  return (Math.abs(a - b) / scale) * 100;
}

/** Every scalar the harness holds the two engines to. Anything a player or a
 * consumer of the result can actually see should be in here - a parity check
 * that only compared final scores would pass an engine that had silently
 * reassigned every rebound. */
function flattenResult(result) {
  const out = new Map();
  out.set("teamScoreA", result.teamScoreA);
  out.set("teamScoreB", result.teamScoreB);
  out.set("overtimePeriods", result.overtimePeriods);
  for (const [side, box] of [["A", result.boxA], ["B", result.boxB]]) {
    for (const slot of Object.keys(box).sort()) {
      for (const key of LINE_KEYS) out.set(`box${side}.${slot}.${key}`, box[slot][key]);
    }
  }
  result.quarterBoxScores.forEach((q, i) => {
    for (const side of ["a", "b"]) {
      const lines = q[side] || {};
      for (const slot of Object.keys(lines).sort()) {
        for (const key of LINE_KEYS) out.set(`Q${i + 1}.${side}.${slot}.${key}`, lines[slot][key]);
      }
    }
  });
  return out;
}

function diffResults(clientResult, edgeResult) {
  const a = flattenResult(clientResult);
  const b = flattenResult(edgeResult);
  const keys = new Set([...a.keys(), ...b.keys()]);
  const divergences = [];
  for (const key of keys) {
    const av = a.get(key);
    const bv = b.get(key);
    if (av === bv) continue;
    divergences.push({ key, client: av, edge: bv, pct: pctDiff(Number(av) || 0, Number(bv) || 0) });
  }
  divergences.sort((x, y) => y.pct - x.pct);
  return { divergences, fieldsCompared: keys.size };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkConstants() {
  const started = Date.now();
  const [clientMod, edgeMod] = await Promise.all([
    import(pathToUrl(path.join(CLIENT_DIR, "constants.js"))),
    import(pathToUrl(path.join(EDGE_DIR, "constants.js"))),
  ]);

  // Only the constants the ENGINE reads. constants.js also carries UI timers
  // and draft-bot tuning, which legitimately differ between a browser and a
  // server that renders nothing - flagging those as drift would train
  // everyone to ignore this check.
  const engineSrc = await readFile(path.join(CLIENT_DIR, "engine.js"), "utf8");
  const importBlock = engineSrc.match(/import\s*\{([\s\S]*?)\}\s*from\s*"\.\/constants\.js"/);
  if (!importBlock) {
    return check("parity:constants", "Simulation constants match", FAIL, {
      detail: "Could not parse engine.js's constants import - the harness cannot tell what to compare.",
      durationMs: Date.now() - started,
    });
  }
  const names = importBlock[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("//"));

  const rows = [["constant", "client", "edge function"]];
  const mismatches = [];
  for (const name of names) {
    const cv = clientMod[name];
    const ev = edgeMod[name];
    const cs = describe(cv);
    const es = describe(ev);
    if (cs !== es) {
      mismatches.push(name);
      rows.push([name, cs, es]);
    }
  }

  const durationMs = Date.now() - started;
  if (mismatches.length === 0) {
    return check("parity:constants", `Simulation constants match (${names.length} compared)`, PASS, { durationMs });
  }
  return check("parity:constants", "Simulation constants match", FAIL, {
    detail: `${mismatches.length} of ${names.length} engine constants differ between client and Edge Function.`,
    table: rows,
    durationMs,
  });
}

function describe(v) {
  if (typeof v === "function") return `fn:${v.name}`;
  return JSON.stringify(v);
}

async function checkTactics() {
  const started = Date.now();
  const [clientMod, edgeMod] = await Promise.all([
    import(pathToUrl(path.join(CLIENT_DIR, "tactics.js"))),
    import(pathToUrl(path.join(EDGE_DIR, "tactics.js"))),
  ]);
  const ids = (clientMod.TACTICS || []).map((t) => t.id);
  const edgeIds = (edgeMod.TACTICS || []).map((t) => t.id);

  const rows = [["gamestyle", "field", "client", "edge function"]];
  const mismatches = [];

  if (JSON.stringify(ids) !== JSON.stringify(edgeIds)) {
    mismatches.push("roster of gamestyles");
    rows.push(["(list)", "ids", ids.join(","), edgeIds.join(",")]);
  }

  for (const id of ids) {
    for (const [field, fn] of [["mods", "tacticMods"], ["clutchMods", "tacticClutchMods"]]) {
      const cv = describe(clientMod[fn](id));
      const ev = describe(edgeMod[fn](id));
      if (cv !== ev) {
        mismatches.push(`${id}.${field}`);
        rows.push([id, field, cv, ev]);
      }
    }
  }

  const durationMs = Date.now() - started;
  if (!mismatches.length) {
    return check("parity:tactics", `Gamestyle modifiers match (${ids.length} gamestyles)`, PASS, { durationMs });
  }
  return check("parity:tactics", "Gamestyle modifiers match", FAIL, {
    detail: `${mismatches.length} gamestyle field(s) differ.`,
    table: rows,
    durationMs,
  });
}

async function checkEngineSource() {
  const started = Date.now();
  const { client, edge } = await readBoth("engine.js");
  const nc = normalizeSource(client);
  const ne = normalizeSource(edge);
  const durationMs = Date.now() - started;

  if (nc === ne) {
    return check("parity:engine-source", "Engine source identical (comments normalized)", PASS, { durationMs });
  }
  const diff = firstDifference(nc, ne);
  return check("parity:engine-source", "Engine source identical (comments normalized)", FAIL, {
    detail:
      `js/engine.js and the deployed Edge Function's engine.js differ in code, not just comments.\n` +
      `First divergence at normalized offset ${diff.offset}:\n` +
      `  client: …${diff.client}…\n` +
      `  edge:   …${diff.edge}…`,
    durationMs,
  });
}

async function checkBoxScores() {
  const started = Date.now();
  const [clientEngine, edgeEngine, data, tacticsMod] = await Promise.all([
    import(pathToUrl(path.join(CLIENT_DIR, "engine.js"))),
    import(pathToUrl(path.join(EDGE_DIR, "engine.js"))),
    import(pathToUrl(path.join(CLIENT_DIR, "data.js"))),
    import(pathToUrl(path.join(CLIENT_DIR, "tactics.js"))),
  ]);

  const players = data.PLAYERS;
  const tacticIds = (tacticsMod.TACTICS || []).map((t) => t.id);
  const scenarios = buildScenarios(players, tacticIds);

  // Both engines get the SAME datasetStats here on purpose: this check is
  // isolating engine CODE. Whether the two sides actually see the same
  // dataset in production is a separate axis, checked by checkDataset().
  const clientStats = clientEngine.computeDatasetStats(players);
  const edgeStats = edgeEngine.computeDatasetStats(players);

  const statsMatch = JSON.stringify(clientStats) === JSON.stringify(edgeStats);

  const rows = [["scenario", "client A-B", "edge A-B", "winner", "fields", "max Δ%", "verdict"]];
  const failures = [];
  const details = [];

  for (const s of scenarios) {
    const opts = { tacticA: s.tacticA, tacticB: s.tacticB };

    const clientRun = withSeededRandom(s.seed, () =>
      clientEngine.simulateGame(s.rosterA, s.rosterB, clientStats, { ...opts })
    );
    const edgeRun = withSeededRandom(s.seed, () =>
      edgeEngine.simulateGame(s.rosterA, s.rosterB, edgeStats, { ...opts })
    );

    const cr = clientRun.value;
    const er = edgeRun.value;
    const { divergences, fieldsCompared } = diffResults(cr, er);
    const worst = divergences.length ? divergences[0].pct : 0;
    const drawsMatch = clientRun.draws === edgeRun.draws;
    const withinTolerance = divergences.every((d) => d.pct <= TOLERANCE_PCT);
    const ok = divergences.length === 0 && drawsMatch;

    rows.push([
      s.label,
      `${cr.teamScoreA}-${cr.teamScoreB}`,
      `${er.teamScoreA}-${er.teamScoreB}`,
      cr.winner === er.winner ? cr.winner : `${cr.winner}≠${er.winner}`,
      String(fieldsCompared),
      worst.toFixed(3),
      ok ? "exact" : withinTolerance ? `within ${TOLERANCE_PCT}%` : "DIVERGED",
    ]);

    if (!drawsMatch) {
      failures.push(s.label);
      details.push(
        `${s.label}: engines drew a different number of random values ` +
          `(client ${clientRun.draws}, edge ${edgeRun.draws}) - the simulations are not running the same path.`
      );
    }
    if (divergences.length && !withinTolerance) {
      failures.push(s.label);
      const top = divergences.slice(0, 8).map((d) => `    ${d.key}: client=${d.client} edge=${d.edge} (${d.pct.toFixed(2)}%)`);
      details.push(`${s.label}: ${divergences.length} field(s) diverged beyond ${TOLERANCE_PCT}%:\n` + top.join("\n"));
    } else if (divergences.length) {
      details.push(`${s.label}: ${divergences.length} field(s) differ but all within the ${TOLERANCE_PCT}% tolerance.`);
    }
  }

  if (!statsMatch) {
    failures.push("datasetStats");
    details.push("computeDatasetStats() returned different values for the same player list in the two engines.");
  }

  const durationMs = Date.now() - started;
  const title = `Box scores identical under a shared seed (${scenarios.length} scenarios, tolerance ${TOLERANCE_PCT}%)`;
  if (!failures.length) {
    return check("parity:box-scores", title, PASS, { table: rows, durationMs });
  }
  return check("parity:box-scores", title, FAIL, {
    detail: details.join("\n"),
    table: rows,
    durationMs,
  });
}

/**
 * The client normalizes matchups against js/data.js; the Edge Function
 * normalizes them against the `players` table. Identical engine code over
 * two different datasets is still two different games, and nothing in the
 * repo currently keeps those two in step - db/seed/players.json is a
 * separate artifact from js/data.js.
 *
 * Uses the publishable (anon) key already shipped in js/supabaseClient.js -
 * `players` is public, readable data, so no secret is needed or used.
 */
async function checkDataset({ timeoutMs = 30000 } = {}) {
  const started = Date.now();
  const clientSrc = await readFile(path.join(CLIENT_DIR, "supabaseClient.js"), "utf8");
  const url = clientSrc.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
  const key = clientSrc.match(/SUPABASE_PUBLISHABLE_KEY\s*=\s*"([^"]+)"/)?.[1];
  if (!url || !key) {
    return check("parity:dataset", "Client dataset matches the server `players` table", SKIP, {
      detail: "Could not read the Supabase URL/publishable key out of js/supabaseClient.js.",
      durationMs: Date.now() - started,
    });
  }

  let rows;
  try {
    rows = await fetchAllPlayers(url, key, timeoutMs);
  } catch (e) {
    return check("parity:dataset", "Client dataset matches the server `players` table", SKIP, {
      detail:
        `Could not reach Supabase (${e.message}). This check needs network access; ` +
        `the engine-code checks above ran offline and still hold.`,
      durationMs: Date.now() - started,
    });
  }

  const { PLAYERS } = await import(pathToUrl(path.join(CLIENT_DIR, "data.js")));
  const engine = await import(pathToUrl(path.join(CLIENT_DIR, "engine.js")));

  const norm = (p) => ({
    name: p.name,
    team: p.team,
    decade: p.decade,
    pos: [...(p.pos || [])].join("/"),
    ppg: num(p.ppg), rpg: num(p.rpg), apg: num(p.apg),
    spg: num(p.spg), bpg: num(p.bpg), tov: num(p.tov),
    fga: num(p.fga), fgp: num(p.fgp), tpa: num(p.tpa),
    tpp: num(p.tpp), fta: num(p.fta), ftp: num(p.ftp),
  });

  const keyOf = (p) => `${p.name}|${p.team}|${p.decade}`;
  const localMap = new Map(PLAYERS.map((p) => [keyOf(p), norm(p)]));
  const remoteMap = new Map(rows.map((p) => [keyOf(p), norm(p)]));

  const onlyLocal = [...localMap.keys()].filter((k) => !remoteMap.has(k));
  const onlyRemote = [...remoteMap.keys()].filter((k) => !localMap.has(k));
  const valueDiffs = [];
  for (const [k, lv] of localMap) {
    const rv = remoteMap.get(k);
    if (!rv) continue;
    for (const field of Object.keys(lv)) {
      if (JSON.stringify(lv[field]) !== JSON.stringify(rv[field])) {
        valueDiffs.push({ key: k, field, local: lv[field], remote: rv[field] });
      }
    }
  }

  // The number that actually matters: datasetStats is what the engine reads.
  // Two datasets can differ on a handful of rows and still normalize matchups
  // identically, or agree on counts and diverge on averages - so this is
  // reported alongside the row-level diff rather than inferred from it.
  const localStats = engine.computeDatasetStats(PLAYERS);
  const remoteStats = engine.computeDatasetStats(rows.map((p) => ({ ...p, pos: p.pos, ...numericFields(p) })));

  const statRows = [["stat", "js/data.js", "players table", "Δ%"]];
  let worstStat = 0;
  for (const k of ["ppg", "rpg", "apg", "spg", "bpg", "tov", "ts"]) {
    const lv = localStats.overall[k];
    const rv = remoteStats.overall[k];
    const d = pctDiff(Number(lv) || 0, Number(rv) || 0);
    worstStat = Math.max(worstStat, d);
    if (d > 0) statRows.push([`overall.${k}`, fmt(lv), fmt(rv), d.toFixed(4)]);
  }

  const durationMs = Date.now() - started;
  const clean = !onlyLocal.length && !onlyRemote.length && !valueDiffs.length && worstStat <= TOLERANCE_PCT;

  if (clean) {
    return check(
      "parity:dataset",
      `Client dataset matches the server \`players\` table (${PLAYERS.length} players)`,
      PASS,
      { durationMs }
    );
  }

  const detail = [
    `js/data.js has ${PLAYERS.length} players; the \`players\` table has ${rows.length}.`,
    onlyLocal.length ? `${onlyLocal.length} only in js/data.js (e.g. ${onlyLocal.slice(0, 3).join("; ")})` : null,
    onlyRemote.length ? `${onlyRemote.length} only in the table (e.g. ${onlyRemote.slice(0, 3).join("; ")})` : null,
    valueDiffs.length
      ? `${valueDiffs.length} field value(s) differ, e.g. ` +
        valueDiffs.slice(0, 3).map((d) => `${d.key} ${d.field}: ${d.local} vs ${d.remote}`).join("; ")
      : null,
    `Worst dataset-average divergence: ${worstStat.toFixed(4)}% (tolerance ${TOLERANCE_PCT}%).`,
    `datasetStats normalizes every matchup, so a drift here changes online box scores even with identical engine code.`,
  ]
    .filter(Boolean)
    .join("\n");

  return check("parity:dataset", "Client dataset matches the server `players` table", FAIL, {
    detail,
    table: statRows.length > 1 ? statRows : undefined,
    durationMs,
  });
}

function numericFields(p) {
  const n = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    ppg: Number(p.ppg), rpg: Number(p.rpg), apg: Number(p.apg),
    spg: Number(p.spg), bpg: Number(p.bpg), tov: Number(p.tov),
    fga: n(p.fga), fgp: n(p.fgp), tpa: n(p.tpa), tpp: n(p.tpp), fta: n(p.fta), ftp: n(p.ftp),
  };
}

function num(v) {
  return v === null || v === undefined ? null : Number(v);
}

function fmt(v) {
  return v == null ? "null" : Number(v).toFixed(4);
}

/** PostgREST caps a response at 1000 rows, and the dataset is ~2500 - an
 * unpaginated fetch would silently compare against a truncated table and
 * report a false mismatch. */
async function fetchAllPlayers(url, key, timeoutMs) {
  const pageSize = 1000;
  const all = [];
  for (let offset = 0; ; offset += pageSize) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(`${url}/rest/v1/players?select=*&order=name.asc&limit=${pageSize}&offset=${offset}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
    const page = await res.json();
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

function pathToUrl(p) {
  return new URL(`file://${p}`).href;
}

// ---------------------------------------------------------------------------

export async function runParityChecks({ network = true } = {}) {
  const checks = [];
  checks.push(await checkEngineSource());
  checks.push(await checkConstants());
  checks.push(await checkTactics());
  checks.push(await checkBoxScores());
  if (network) {
    checks.push(await checkDataset());
  } else {
    checks.push(
      check("parity:dataset", "Client dataset matches the server `players` table", SKIP, {
        detail: "Skipped: --no-network.",
      })
    );
  }
  return checks;
}

// Runnable on its own (`node scripts/verify-parity.mjs`) as well as through
// the orchestrator, since this is the check most likely to be re-run alone
// while changing the engine.
if (import.meta.url === pathToUrl(path.resolve(process.argv[1] || ""))) {
  const { renderCheck, renderSection, summarize } = await import("./lib/report.mjs");
  const checks = await runParityChecks({ network: !process.argv.includes("--no-network") });
  console.log(renderSection("Engine parity (offline client vs online Edge Function)"));
  for (const c of checks) console.log(renderCheck(c));
  const { ok } = summarize(checks);
  process.exit(ok ? 0 : 1);
}
