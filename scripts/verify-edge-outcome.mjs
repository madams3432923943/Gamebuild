#!/usr/bin/env node
// THE TRUSTED SERVER'S PROFILE BOOKKEEPING, ACTUALLY EXECUTED.
//
// WHY THIS EXISTS
//
// Nothing in this repository has ever run supabase/functions/simulate-match/
// index.ts. verify-server-dataset.mjs and verify-result-provenance.mjs read it
// as a STRING and match regexes against it; verify-parity.mjs executes only the
// vendored engine siblings beside it; CI bundles it with esbuild purely to see
// whether it parses. So the one file that decides what every ranked game does
// to both players' permanent records - their wins, their ELO, and now which
// team icons they have earned - was covered by grep.
//
// That is the wrong place to have no coverage. buildMatchOutcome is where the
// FRIENDLY/RANKED boundary lives, and that boundary is the only thing standing
// between the ladder and a friendly match writing to it. The mvp_teams counter
// added for team icons now sits inside the same `if (!friendly)` block, one
// line away from online_wins and sport_ratings.
//
// HOW IT RUNS DENO CODE UNDER NODE
//
// esbuild is already a devDependency and CI already bundles this exact file.
// Two things stop the output from importing straight into node, and both are
// handled below rather than worked around:
//
//   1. `jsr:` specifiers. --external:jsr:* leaves them in the output and node
//      cannot resolve them, so they are substituted at BUNDLE time by a plugin
//      that supplies a stub createClient. Nothing here touches the network or a
//      database; the client is never called on this path.
//
//   2. `Deno`. The module reads Deno.env.get(...) at top level and calls
//      Deno.serve at the bottom, both of which run on import. A stub is
//      installed on globalThis first.
//
// WHAT THIS DOES NOT PROVE. It runs the real compiled function, so the rules
// below are the rules production applies. It does NOT prove the function is
// deployed, that the RPC accepts what it sends, or that a real ranked match
// awards a real icon - those need a live database and two players.

import { build } from "esbuild";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

console.log(renderSection("Edge Function outcome (the trusted server's profile bookkeeping)"));

// ---- compile the real thing -------------------------------------------------
const jsrStub = {
  name: "jsr-stub",
  setup(b) {
    b.onResolve({ filter: /^jsr:/ }, (args) => ({ path: args.path, namespace: "jsr-stub" }));
    b.onLoad({ filter: /.*/, namespace: "jsr-stub" }, () => ({
      // Enough shape to import. If anything on this path ever CALLS the client
      // the test should fail loudly rather than silently talk to nothing.
      contents: `export const createClient = () => { throw new Error("the Supabase client is not available in this test"); };`,
      loader: "js",
    }));
  },
};

const dir = await mkdtemp(path.join(tmpdir(), "bk-edge-"));
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

globalThis.Deno = {
  env: { get: (key) => `stub-${key}` },
  // The module ends in Deno.serve(handler). Capturing it rather than ignoring
  // it keeps the door open for driving the whole request handler later.
  serve: () => {},
};

const { buildMatchOutcome } = await import(pathToFileURL(outfile).href);
check("The Edge Function compiles and its outcome builder is reachable", typeof buildMatchOutcome === "function");

// ---- a call, with everything but the variables under test held still --------
const BOX = { PG: { pts: 30, reb: 5, ast: 5 } };
const LINES = [{ playerName: "A Player", season: 1996, line: BOX.PG }];

// A rating exchange is always supplied, including to the friendly cases. The
// friendly branch is supposed to DISCARD it, and handing it nothing would let
// that branch pass by never having been given anything to leak.
const RATINGS = { nba: { rating: 612, games: 23, wins: 15, losses: 8, peak: 612 } };

/**
 * @param over  { won, friendly, mvpTeam, profile }
 */
function outcome(over = {}) {
  const { won = true, friendly = false, mvpTeam = "Chicago Bulls", profile = {} } = over;
  return buildMatchOutcome(
    profile,
    "Opponent",
    won,
    110,
    100,
    "A Player",
    mvpTeam,
    LINES,
    ["pts", "reb", "ast"],
    friendly,
    "nba",
    "2010s",
    RATINGS,
    null,
    new Date("2026-08-18").toISOString()
  );
}

// ---- the rule, case by case ------------------------------------------------
const won = outcome();
check(
  "A ranked win with your own player as MVP credits that franchise",
  won.mvp_teams && won.mvp_teams["Chicago Bulls"] === 1,
  JSON.stringify(won.mvp_teams)
);

// mvpTeam is null when the MVP belongs to the other roster - the caller
// resolves that, so null is exactly how "not yours" arrives here.
const opponentMvp = outcome({ mvpTeam: null });
check(
  "The opponent's MVP credits nobody",
  opponentMvp.mvp_teams === undefined,
  `mvp_teams=${JSON.stringify(opponentMvp.mvp_teams)}`
);

const lost = outcome({ won: false });
check(
  "Losing with your own player as MVP credits nobody",
  lost.mvp_teams === undefined,
  `mvp_teams=${JSON.stringify(lost.mvp_teams)}`
);

const friendly = outcome({ friendly: true });
check(
  "A friendly match credits nobody, however it went",
  friendly.mvp_teams === undefined,
  `mvp_teams=${JSON.stringify(friendly.mvp_teams)}`
);

// A counter is not a flag: the second MVP with a franchise has to count, and
// must not disturb what is already there.
const existing = outcome({
  profile: { mvp_teams: { "Chicago Bulls": 2, "LA Lakers": 5 } },
});
check(
  "An MVP increments an existing count without disturbing the others",
  existing.mvp_teams["Chicago Bulls"] === 3 && existing.mvp_teams["LA Lakers"] === 5,
  JSON.stringify(existing.mvp_teams)
);

// The staged-deploy case: this function can be live before the migration is.
// A missing column arrives as undefined, and starting from {} is what lets the
// three stages land in any order.
let preMigration = null;
let threw = null;
try {
  preMigration = outcome({ profile: { mvp_teams: undefined } });
} catch (e) {
  threw = e.message;
}
check(
  "A server whose column has not been migrated yet still records the MVP",
  threw === null && preMigration.mvp_teams["Chicago Bulls"] === 1,
  threw || JSON.stringify(preMigration.mvp_teams)
);

// ---- the boundary the icons now sit inside ---------------------------------
// This is the check that matters most, and it is not about icons. A friendly
// match must not touch the ranked record in ANY way. mvp_teams was added inside
// that block; if the block is ever restructured, this is what notices.
const RANKED_ONLY = ["online_wins", "online_losses", "era_records", "sport_ratings", "mvp_teams"];
const leaked = RANKED_ONLY.filter((key) => key in friendly);
check(
  "A friendly match writes nothing that belongs to the ladder",
  leaked.length === 0,
  leaked.length ? `friendly match wrote: ${leaked.join(", ")}` : `none of ${RANKED_ONLY.join(", ")}`
);

check(
  "A friendly match discards the rating exchange it was handed",
  friendly.sport_ratings === undefined,
  `sport_ratings=${JSON.stringify(friendly.sport_ratings)}`
);

// ...and the mirror of it, so the check above cannot pass by the ranked path
// being broken too.
const rankedKeys = RANKED_ONLY.filter((key) => key in won);
check(
  "A ranked match still writes the ladder columns",
  rankedKeys.length === RANKED_ONLY.length,
  `wrote ${rankedKeys.join(", ")}`
);

// ---- the payload actually reaches the RPC ----------------------------------
// buildMatchOutcome's return value is passed to finalize_match_result as
// p_profile_a / p_profile_b, and the RPC reads p_profile->'mvp_teams'. A key
// renamed on either side is a silent no-op: the coalesce simply keeps the old
// value and every MVP is quietly dropped.
const migration = await readFile("db/migrations/20260818_01_profile_icons_and_mvp_teams.sql", "utf8");
const readsBothSides =
  migration.includes("mvp_teams=coalesce(p_profile_a->'mvp_teams',mvp_teams)") &&
  migration.includes("mvp_teams=coalesce(p_profile_b->'mvp_teams',mvp_teams)");
check(
  "The RPC reads the same key this function writes",
  readsBothSides && "mvp_teams" in won,
  `function writes "mvp_teams"; migration coalesces it for both sides: ${readsBothSides}`
);

// The RPC's argument NAMES are its identity to PostgREST - an added parameter
// publishes a second function and every unreloaded client keeps calling the old
// one, which would silently stop recording MVPs.
const ARGS = ["p_match_id", "p_result", "p_winner", "p_profile_a", "p_profile_b", "p_seed", "p_engine_version", "p_dataset_version", "p_rules_version"];
const signature = migration.slice(migration.indexOf("create or replace function public.finalize_match_result"));
const argsUnchanged = ARGS.every((a) => signature.includes(a)) &&
  signature.slice(0, signature.indexOf(")")).split(",").length === ARGS.length;
check(
  "The RPC signature still takes exactly its nine original arguments",
  argsUnchanged,
  `expected ${ARGS.length} arguments, unchanged in name and count`
);

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
