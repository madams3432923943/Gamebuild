#!/usr/bin/env node
// EVERY ERA IN THE BRACKET ACTUALLY SHOWS UP, AND NO ERA STREAKS.
//
// WHY THIS EXISTS
//
// Reported from a live NFL ranked game: seven straight 2000s squads. The
// roller drew an era independently every round, weighted by how many squads it
// had. That is random in the honest sense and still indefensible in a game
// sold as a test across the whole history - football has three eras, so a run
// of seven is rare per round and routine across a session, and nothing in the
// draft ever guaranteed the other two eras appeared at all.
//
// DraftState.rollNextSquad now draws eras in cycles (see pickNextEra): no era
// repeats until every era with an unused squad has had a turn. Two properties
// follow, and both are checked here against real data, for every live sport
// and every era bracket it declares:
//
//   COVERAGE - a draft of N rounds hits min(N, eras) distinct eras. This is
//              the one the report was really about.
//   NO STREAKS - the longest run of one era is at most 2 (the tail of one
//              cycle running into the head of the next).
//
// Also checked: the order is still RANDOM. A rotation that always went
// 2000s -> 2010s -> 2020s would pass both properties above and be a worse
// game than the bug - so the same draft, run many times, must not always open
// on the same era.

import { DraftState } from "../js/draft.js";
import { SPORTS, setActiveSport, ensureSportData, activeSport } from "../js/sports/index.js";

import { renderCheck, renderSection, summarize, PASS, FAIL, WARN } from "./lib/report.mjs";

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });
const warn = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : WARN, detail });

console.log(renderSection("Era rotation (every era gets dealt, no era streaks)"));

// A full ranked draft is 10 rounds a side; rolling 12 covers the longest
// draft any mode runs plus the rounds a skipped pick adds.
const ROUNDS = 12;
const TRIALS = 200;

/** One draft's worth of eras, in the order they were rolled. */
function rollEras(players, slots) {
  const draft = new DraftState(players, [], slots);
  const eras = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    const squad = draft.rollNextSquad();
    if (!squad) break;
    eras.push(squad.decade);
    // rollNextSquad refuses to roll again once every roster slot is filled, so
    // the rosters are left empty on purpose: this measures the roller, not the
    // draft. usedSquadIds still advances, which is the state that matters.
  }
  return eras;
}

function longestRun(values) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const v of values) {
    run = v === prev ? run + 1 : 1;
    prev = v;
    if (run > best) best = run;
  }
  return best;
}

for (const meta of SPORTS) {
  if (!meta.live) continue;
  await ensureSportData(meta.id);
  setActiveSport(meta.id);
  const sport = activeSport();
  const slots = sport.slots.ranked;

  for (const era of sport.eras) {
    const pool = sport.playersInEra(sport.players(), era.id);
    const label = `${meta.name} / ${era.label}`;

    // How many eras this bracket can actually deal - the honest ceiling for
    // the coverage check. An era bracket with one era can never streak-fail.
    const available = new Set(pool.map((p) => p[sport.groupKey]));
    const expected = Math.min(ROUNDS, available.size);

    let worstCoverage = Infinity;
    let worstStreak = 0;
    const openers = new Set();
    const seen = new Set();

    for (let t = 0; t < TRIALS; t += 1) {
      const eras = rollEras(pool, slots);
      const distinct = new Set(eras);
      worstCoverage = Math.min(worstCoverage, distinct.size);
      worstStreak = Math.max(worstStreak, longestRun(eras));
      if (eras.length) openers.add(eras[0]);
      for (const e of distinct) seen.add(e);
    }

    check(
      `${label}: ${ROUNDS} rounds always deal all ${expected} era${expected === 1 ? "" : "s"}`,
      worstCoverage >= expected,
      `worst of ${TRIALS} drafts covered ${worstCoverage}/${expected} (${[...available].sort().join(", ")})`
    );

    check(
      `${label}: never more than 2 rounds of the same era in a row`,
      worstStreak <= 2 || available.size === 1,
      `longest run across ${TRIALS} drafts: ${worstStreak}`
    );

    // Every era in the bracket should be reachable at all - a bracket that
    // silently filters an era out of the pool would pass "covers what it has".
    //
    // A WARNING, not a failure, because the only way to fail it today is a
    // DATASET gap rather than a roller bug: data/nba-players.json currently
    // starts at 1980, so Grandpa's Game (1960s-1980s) can only ever deal
    // 1980s squads no matter how fairly the eras are rotated. The roller
    // cannot invent squads; the fix is more historical seasons through
    // tools/build-nba-data.mjs. Flagged rather than hidden so the gap between
    // what a bracket promises and what it can deal stays visible.
    warn(
      `${label}: the bracket deals every era it declares`,
      !era.decades || era.decades.every((d) => seen.has(d)),
      `declared ${era.decades ? era.decades.join(", ") : "all"}; dealt ${[...seen].sort().join(", ")}`
    );

    if (available.size > 1) {
      check(
        `${label}: which era opens the draft is not fixed`,
        openers.size > 1,
        `${TRIALS} drafts opened on: ${[...openers].sort().join(", ")}`
      );
    }
  }
}

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
