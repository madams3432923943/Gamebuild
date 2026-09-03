#!/usr/bin/env node
// Can a finished game be regenerated from what was recorded about it?
//
// WHY THIS EXISTS
//
// Four provenance fields are stored against every finished match -
// engine_version, dataset_version, rules_version and simulation_seed - and
// scripts/verify-result-provenance.mjs already checks that they are WRITTEN.
// Nothing checked that they were sufficient. A seed that is recorded but does
// not reproduce the game is worse than no seed: it is a promise the data makes
// and cannot keep, and it fails the day someone tries to settle an argument
// with it.
//
// This is the other half. It runs the engine from a seed, twice, and against
// the versions the result was stamped with, and asserts the second run is the
// first one exactly - every player line, every quarter, every drive.
//
// WHAT A REPLAY ACTUALLY NEEDS, which is more than the seed
//
// The seed reproduces the DICE. It reproduces the game only if everything the
// dice are rolled against is also the same, and that is what the other three
// fields are for:
//
//   engine_version   the simulation's own code. A changed engine consumes the
//                    stream differently and diverges from the first draw.
//   dataset_version  every rating is a percentile against the pool it was
//                    computed from, so a pool with more rows in it rates the
//                    same roster differently and the same seed plays a
//                    different game.
//   rules_version    roster shape, scoring, what a forfeit costs.
//
// A replay that matches on the seed alone is luck. A replay is only meaningful
// when all four agree, and the check below fails loudly when they do not
// rather than reporting a mismatch as engine drift.
//
// WHAT IT DOES NOT DO
//
// It does not reach the database. Replaying a STORED ranked result needs the
// rosters, the gameplans and the rotations that produced it, and those live in
// `matches` behind auth - so this drives the same code paths over rosters it
// drafts itself, seeded, which is the part that can run offline and in CI. The
// property being checked is the engine's: given the recorded inputs, does it
// return the recorded game.

import { SPORTS, setActiveSport, ensureSportData } from "../js/sports/index.js";
import { DraftState } from "../js/draft.js";
import { withSeededMathRandom, normalizeSeed, createSeededRng } from "../js/lib/seeded-rng.js";
import { engineVersion, rulesVersion, newSimulationSeed } from "../js/lib/provenance.js";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

console.log(renderSection("Replay (a recorded game can be regenerated from its seed)"));

/** Every number in a result, flattened, so a comparison cannot miss a field by
 * not knowing it exists. Walking the object rather than listing keys is the
 * point: a field added to the engine tomorrow is compared tomorrow, without
 * anyone remembering to add it here. */
function flatten(value, prefix = "", into = new Map()) {
  if (value === null || value === undefined) {
    into.set(prefix, String(value));
  } else if (Array.isArray(value)) {
    into.set(`${prefix}.length`, value.length);
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, into));
  } else if (typeof value === "object") {
    for (const key of Object.keys(value).sort()) flatten(value[key], `${prefix}.${key}`, into);
  } else if (typeof value === "function") {
    // Nothing in a result should be one; if something is, say so rather than
    // silently comparing two functions as equal.
    into.set(prefix, "[function]");
  } else {
    into.set(prefix, value);
  }
  return into;
}

function firstDifference(a, b) {
  const left = flatten(a);
  const right = flatten(b);
  for (const [key, value] of left) {
    if (!right.has(key)) return `${key}: present in the first run, missing in the replay`;
    if (right.get(key) !== value) return `${key}: ${value} -> ${right.get(key)}`;
  }
  for (const key of right.keys()) {
    if (!left.has(key)) return `${key}: appeared only in the replay`;
  }
  return null;
}

/**
 * One game, played entirely inside a seeded stream - the draft included.
 *
 * The draft is in the block on purpose. A replay has to reproduce the INPUTS
 * as well as the simulation, and the rosters are the largest input there is;
 * seeding only the simulation would prove the engine is deterministic while
 * saying nothing about whether a recorded game can be rebuilt. It also mirrors
 * what the app does, where the rosters are already fixed by the time the seed
 * is drawn.
 */
function playSeeded(sport, seed) {
  return withSeededMathRandom(seed, () => {
    const pool = sport.playersInEra(sport.players(), "all");
    const draft = new DraftState(pool, [], sport.slots.ranked);
    while (!draft.isComplete()) {
      if (!draft.rollNextSquad()) break;
      draft.botAutoPick("A", { banTop: 0 });
      draft.botAutoPick("B", { banTop: 0 });
    }
    if (!draft.isComplete()) return null;
    const tacticIds = sport.tactics.map((t) => t.id);
    const opts = {
      tacticA: tacticIds[Math.floor(Math.random() * tacticIds.length)],
      tacticB: tacticIds[Math.floor(Math.random() * tacticIds.length)],
      strategyA: sport.randomStrategy ? sport.randomStrategy() : undefined,
      strategyB: sport.randomStrategy ? sport.randomStrategy() : undefined,
      minutesA: sport.defaultMinutes(draft.rosterA),
      minutesB: sport.botMinutes(draft.rosterB),
    };
    return {
      result: sport.simulate(draft.rosterA, draft.rosterB, sport.computeDatasetStats(), opts),
      rosterNames: sport.slots.ranked.map((slot) => draft.rosterA[slot]?.name ?? null),
    };
  });
}

// ---- the generator itself --------------------------------------------------
//
// Before anything about a game, the stream has to be reproducible on its own.
// Everything below rests on this, and it is one line to check.
const streamA = createSeededRng(12345);
const streamB = createSeededRng(12345);
const streamDraws = Array.from({ length: 500 }, () => streamA() === streamB());
check(
  "The same seed produces the same stream",
  streamDraws.every(Boolean),
  `${streamDraws.filter(Boolean).length} of 500 draws matched`
);

// Provenance travels as a database column and comes back as a string or a
// number depending on the driver, and a seed that normalises differently in
// the two shapes replays a different game.
//
// THE FIRST VERSION OF THIS CHECK COULD NOT FAIL. It was `A || B` where B was
// `normalizeSeed(4021156297) === 4021156297` - true for every uint32 by
// definition - so the whole assertion was a tautology guarding a property that
// was actually broken: normalizeSeed hashed the string form. Two seeds are
// compared directly now, which is the claim being made.
{
  const sample = [0, 1, 7919, 2147483647, 4021156297, 4294967295];
  const mismatched = sample.filter((n) => normalizeSeed(n) !== normalizeSeed(String(n)));
  check(
    "A seed survives being written down and read back",
    mismatched.length === 0,
    mismatched.length === 0
      ? `${sample.length} seeds normalise identically as number and as string`
      : `differ: ${mismatched.map((n) => `${n} -> ${normalizeSeed(String(n))}`).join(", ")}`
  );

  // ...and the fallback still has to hash, or a match id would collapse.
  const uuid = "9f8a1c2e-0000-4000-8000-000000000000";
  check(
    "A non-numeric seed still hashes",
    normalizeSeed(uuid) !== 0 && normalizeSeed(uuid) !== normalizeSeed("other-label"),
    `${uuid} -> ${normalizeSeed(uuid)}`
  );
}

check(
  "Seeds are 32-bit, so a recorded one is the one that ran",
  Array.from({ length: 200 }, () => newSimulationSeed()).every(
    (s) => Number.isInteger(s) && s >= 0 && s <= 0xffffffff && normalizeSeed(s) === s
  ),
  "200 minted seeds all normalise to themselves"
);

// ---- the games -------------------------------------------------------------
const REPLAYS_PER_SPORT = Number(process.env.REPLAY_GAMES || 6);

for (const meta of SPORTS) {
  if (!meta.live) continue;
  await ensureSportData(meta.id);
  setActiveSport(meta.id);
  const sport = (await import(`../js/sports/${meta.id}/index.js`))[meta.id.toUpperCase()];

  const seeds = Array.from({ length: REPLAYS_PER_SPORT }, (_, i) => 0x9e37_0000 + i * 7919);
  let identical = 0;
  let firstDiff = null;
  const scores = new Set();

  for (const seed of seeds) {
    const first = playSeeded(sport, seed);
    const again = playSeeded(sport, seed);
    if (!first || !again) continue;
    scores.add(`${first.result.teamScoreA}-${first.result.teamScoreB}`);
    const diff = firstDifference(first, again);
    if (diff) firstDiff ??= `seed ${seed}: ${diff}`;
    else identical += 1;
  }

  check(
    `${meta.name}: a game replays exactly from its seed`,
    identical === seeds.length,
    identical === seeds.length
      ? `${identical} of ${seeds.length} games identical, field for field, rosters included`
      : `${identical} of ${seeds.length} identical - first difference: ${firstDiff}`
  );

  // A replay harness that returned the same game for EVERY seed would pass the
  // check above while proving nothing at all, which is the failure mode a
  // determinism test is most likely to have.
  check(
    `${meta.name}: different seeds produce different games`,
    scores.size > 1,
    `${scores.size} distinct scorelines across ${seeds.length} seeds`
  );

  // The provenance a replay is only meaningful against. These are the strings
  // the offline path stamps and the Edge Function writes; a replay compared
  // across two different values of either is not a replay.
  check(
    `${meta.name}: the engine and dataset a replay needs are both stamped`,
    engineVersion(meta.id).startsWith(`${meta.id}-`) &&
      /^[a-z-]+-\d+-(\d{4}|legacy)$/.test(sport.datasetVersion()),
    `${engineVersion(meta.id)} / ${sport.datasetVersion()} / ${rulesVersion("practice-easy")}`
  );
}

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
