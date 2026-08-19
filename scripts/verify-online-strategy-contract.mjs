#!/usr/bin/env node
// WHAT THE BROWSER SENDS TO submit_strategy IS WHAT submit_strategy ACCEPTS.
//
// WHY THIS EXISTS
//
// Online Ranked (NBA) could not submit a game plan for ten days. Every
// attempt came back "matchups must assign five unique starters", because
// 20260805_01_ranked_integrity_hardening.sql validated the matchups against
// an assumption - five entries, five distinct targets - and a ranked roster
// is ten players, all of whom get an assignment. The players saw a gameplan
// screen that would not submit; before that they saw the phase restart and
// ask them to set their rotation again.
//
// Nothing caught it. scripts/selftest/supabase-stub.js resolves every rpc()
// call to success without reading its arguments, so the online self-test
// drove the whole rotation -> matchups -> gamestyle sequence and passed while
// the live server rejected the identical payload every single time. A test
// that stands in for a server has to enforce the server's rules, or it is
// testing that the client can talk to something that always says yes.
//
// So this holds the REAL payload - built by the same functions the browser
// builds it with, from real drafted rosters - against the server's rules.
//
// THE RULES BELOW ARE A HAND-KEPT MIRROR of
// db/migrations/20260815_01_matchups_match_the_roster.sql, in the same way
// public.era_decades mirrors ERAS: there is no way to share a plpgsql
// function with Node, so the duplication is deliberate and has to be kept in
// step by hand. If you change submit_strategy, change these and say so in the
// migration.

import { DraftState } from "../js/draft.js";
import { setActiveSport } from "../js/sports/index.js";
import { NBA } from "../js/sports/nba/index.js";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

console.log(renderSection("Online strategy contract (the browser's payload against the RPC's rules)"));

setActiveSport("nba");

// ---- the server's rules, mirrored ------------------------------------------
const SERVER_STARTER_SLOTS = ["PG", "SG", "SF", "PF", "C"];
const SERVER_STARTER_MINUTES = { min: 25, max: 40 };
const SERVER_BENCH_MINUTES = { min: 10, max: 24 };
const SERVER_ROTATION_TOTAL = 240;
const SERVER_TACTICS = [
  "balanced", "run-and-gun", "spread-perimeter", "lockdown-defense",
  "crash-the-glass", "paint-dominance", "ball-movement", "isolation-heavy",
  "small-ball", "defensive-pressure", "zone-defense", "full-court-press",
  "post-up-heavy", "switch-everything", "grind-it-out",
];

/** Every reason submit_strategy would reject this payload, in its own words. */
function serverRejections(rotation, matchups, tactic, roster, oppRoster) {
  const reasons = [];
  const rosterSlots = Object.keys(roster);

  for (const [slot, minutes] of Object.entries(rotation)) {
    if (!Number.isInteger(minutes) || minutes < 0) reasons.push(`rotation values must be integers (${slot}=${minutes})`);
    if (!rosterSlots.includes(slot)) reasons.push(`rotation contains unknown slot ${slot}`);
    else if (SERVER_STARTER_SLOTS.includes(slot)) {
      if (minutes < SERVER_STARTER_MINUTES.min || minutes > SERVER_STARTER_MINUTES.max) reasons.push(`starter minutes out of range (${slot}=${minutes})`);
    } else if (slot.startsWith("BENCH")) {
      if (minutes < SERVER_BENCH_MINUTES.min || minutes > SERVER_BENCH_MINUTES.max) reasons.push(`bench minutes out of range (${slot}=${minutes})`);
    } else {
      reasons.push(`invalid ranked slot ${slot}`);
    }
  }
  if (Object.keys(rotation).length !== rosterSlots.length) reasons.push("rotation must include every roster slot");
  const total = Object.values(rotation).reduce((sum, m) => sum + m, 0);
  if (total !== SERVER_ROTATION_TOTAL) reasons.push(`rotation must total 240 minutes (was ${total})`);

  for (const [slot, target] of Object.entries(matchups)) {
    if (!rosterSlots.includes(slot) || !Object.keys(oppRoster).includes(target)) {
      reasons.push(`matchups name a slot that is not on a roster (${slot} -> ${target})`);
    }
  }
  for (const slot of SERVER_STARTER_SLOTS) {
    if (roster[slot] && !(slot in matchups)) reasons.push(`every starter must be given an assignment (${slot})`);
  }
  const starterTargets = SERVER_STARTER_SLOTS.filter((s) => s in matchups).map((s) => matchups[s]);
  if (new Set(starterTargets).size !== starterTargets.length) reasons.push("two starters cannot be given the same assignment");

  if (!SERVER_TACTICS.includes(tactic)) reasons.push(`invalid tactic (${tactic})`);
  return reasons;
}

// ---- the catalogue the server whitelists must not drift --------------------
const clientTactics = NBA.tactics.map((t) => t.id).sort();
const serverTactics = [...SERVER_TACTICS].sort();
check(
  "Every gamestyle the game can offer is one the server accepts",
  clientTactics.join(",") === serverTactics.join(","),
  clientTactics.join(",") === serverTactics.join(",")
    ? `${clientTactics.length} gamestyles, both sides agree`
    : `client-only: ${clientTactics.filter((t) => !serverTactics.includes(t)).join(", ") || "none"}; ` +
      `server-only: ${serverTactics.filter((t) => !clientTactics.includes(t)).join(", ") || "none"}`
);

// The minute bands are declared per sport and enforced again in SQL. Both
// copies have to say the same thing or a rotation the picker calls valid is
// one the server refuses.
const starterRange = NBA.minutesRangeFor("PG");
const benchRange = NBA.minutesRangeFor("BENCH1");
check(
  "The rotation screen's minute bands are the ones the server enforces",
  starterRange.min === SERVER_STARTER_MINUTES.min &&
    starterRange.max === SERVER_STARTER_MINUTES.max &&
    benchRange.min === SERVER_BENCH_MINUTES.min &&
    benchRange.max === SERVER_BENCH_MINUTES.max &&
    NBA.rotationBudget === SERVER_ROTATION_TOTAL,
  `starters ${starterRange.min}-${starterRange.max}, bench ${benchRange.min}-${benchRange.max}, budget ${NBA.rotationBudget}`
);

// ---- real rosters, real payloads -------------------------------------------
// Basketball's dataset loads on demand (js/sports/nba/index.js), so it has to
// be asked for before the pool is read. Awaited at top level rather than inside
// draftPair(), because every check below wants the same loaded pool.
await NBA.preload();

const slots = NBA.slots.ranked;
const players = NBA.players();

/** A full ten-man roster each side, drafted the way a match drafts one. */
function draftPair(seed) {
  const real = Math.random;
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    const draft = new DraftState(players, [], slots);
    let guard = 0;
    while (!draft.isComplete() && guard++ < slots.length * 8) {
      const squad = draft.rollNextSquad();
      if (!squad) break;
      for (const side of ["A", "B"]) {
        const roster = side === "A" ? draft.rosterA : draft.rosterB;
        let placed = false;
        for (const player of squad.players) {
          for (const slot of slots.filter((s) => !roster[s])) {
            try {
              draft.makePick(side, player, slot);
              placed = true;
              break;
            } catch { /* not eligible there */ }
          }
          if (placed) break;
        }
      }
    }
    return draft.isComplete() ? { rosterA: draft.rosterA, rosterB: draft.rosterB } : null;
  } finally {
    Math.random = real;
  }
}

const pairs = [];
for (let seed = 1; pairs.length < 60 && seed <= 400; seed++) {
  const pair = draftPair(seed);
  if (pair) pairs.push(pair);
}

check("Ranked rosters draft to completion", pairs.length > 0, `${pairs.length} full ten-man pairs`);

const rejected = [];
for (const { rosterA, rosterB } of pairs) {
  // Exactly what js/main.js hands to submitStrategy: the untouched defaults
  // both phases open on, which is what a player who lets the clock run sends.
  const rotation = NBA.defaultMinutes(rosterA);
  const matchups = NBA.defaultMatchups(rosterA, rosterB);
  for (const tactic of NBA.tactics) {
    const reasons = serverRejections(rotation, matchups, tactic.id, rosterA, rosterB);
    if (reasons.length) rejected.push(`${reasons[0]} [${Object.keys(matchups).length} assignments]`);
  }
}
check(
  "The default rotation, matchups and every gamestyle are accepted",
  rejected.length === 0,
  rejected.length === 0
    ? `${pairs.length} rosters x ${NBA.tactics.length} gamestyles, none rejected`
    : `${rejected.length} rejected, first: ${rejected[0]}`
);

// The picker swaps assignments rather than duplicating them, so a player who
// reassigns their starters still submits a permutation. Simulated here because
// that guarantee lives in the UI and the server now depends on it.
const swapped = [];
for (const { rosterA, rosterB } of pairs.slice(0, 20)) {
  const rotation = NBA.defaultMinutes(rosterA);
  const matchups = NBA.defaultMatchups(rosterA, rosterB);
  const starters = SERVER_STARTER_SLOTS.filter((s) => rosterA[s]);
  for (let i = 0; i < starters.length; i++) {
    for (let j = i + 1; j < starters.length; j++) {
      const moved = { ...matchups };
      const [x, y] = [starters[i], starters[j]];
      [moved[x], moved[y]] = [moved[y], moved[x]];
      const reasons = serverRejections(rotation, moved, NBA.defaultTactic, rosterA, rosterB);
      if (reasons.length) swapped.push(`${x}<->${y}: ${reasons[0]}`);
    }
  }
}
check(
  "Every swap the matchup picker allows is still a legal submission",
  swapped.length === 0,
  swapped.length === 0 ? "all ten swaps on 20 rosters accepted" : `${swapped.length} rejected, first: ${swapped[0]}`
);

// And the rules still have teeth: the shapes that SHOULD be refused are.
const { rosterA, rosterB } = pairs[0];
const goodRotation = NBA.defaultMinutes(rosterA);
const goodMatchups = NBA.defaultMatchups(rosterA, rosterB);
const mustReject = [
  ["a starter left unassigned", goodRotation, (() => { const m = { ...goodMatchups }; delete m.PG; return m; })(), NBA.defaultTactic],
  ["two starters on one man", goodRotation, { ...goodMatchups, PG: goodMatchups.SG }, NBA.defaultTactic],
  ["a slot nobody has", goodRotation, { ...goodMatchups, BENCH9: "PG" }, NBA.defaultTactic],
  ["a gamestyle that does not exist", goodRotation, goodMatchups, "hack-a-shaq"],
  ["minutes that do not add up", { ...goodRotation, PG: 40, SG: 40 }, goodMatchups, NBA.defaultTactic],
];
const wronglyAccepted = mustReject.filter(([, rot, mu, tac]) => serverRejections(rot, mu, tac, rosterA, rosterB).length === 0);
check(
  "An illegal game plan is still refused",
  wronglyAccepted.length === 0,
  wronglyAccepted.length === 0
    ? mustReject.map(([label]) => label).join("; ")
    : `accepted: ${wronglyAccepted.map(([label]) => label).join(", ")}`
);

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
