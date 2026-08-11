#!/usr/bin/env node
// Football's live ledger: the game as of the last play SHOWN, and nothing
// after it.
//
// WHY THIS EXISTS
//
// The live box score used to be handed a finished quarter. main.js accumulated
// `result.quarterBoxScores[i]` into the running totals the instant quarter i
// began, then started playing that quarter's events - so at the first snap of
// Q1 the scoreboard already read Q1's final score, and the box score already
// showed every yard still to be gained. The plays that followed were a replay
// of a result the viewer had been shown up front.
//
// The fix is that events carry DELTAS rather than totals, and the live state is
// a pure fold of the events applied so far. That turns "no spoilers" into a
// property that can be asserted instead of a discipline to maintain: stop
// halfway through Q1 and the second half of Q1 must be genuinely absent.
//
// The other half is reconciliation. A ledger that hides the future is useless
// if it arrives somewhere other than the truth, so every check below folds the
// complete event list and asserts it reproduces the ENGINE'S OWN box score -
// every player line, every team total, and the final score - exactly.

import { setActiveSport } from "../js/sports/index.js";
import { NFL } from "../js/sports/nfl/index.js";
import { DraftState } from "../js/draft.js";
import { buildTimeline, createLiveState, applyEvent, liveBox, liveScore } from "../js/sports/nfl/playback.js";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const GAMES = Number(process.env.NFL_LEDGER_GAMES || 40);

/** A seeded PRNG, so a failure here is a failure anyone can reproduce. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

setActiveSport("nfl");
// Football's dataset loads on demand now (see NFL.preload), so a script that
// reads the player pool has to ask for it first.
await NFL.preload();
const rows = NFL.playersInEra(NFL.players(), NFL.defaultEra);
const slots = NFL.slots.ranked;
const ctx = NFL.computeDatasetStats(NFL.players(), NFL.units());

/**
 * One complete game from one seed. The draft reads Math.random directly, so it
 * is stubbed for the duration rather than threaded through - the point is a
 * reproducible ROSTER, and restoring it afterwards keeps the stub from leaking
 * into anything else in this process.
 */
function playOneGame(seed) {
  const rand = mulberry32(seed);
  const realRandom = Math.random;
  Math.random = rand;
  try {
    const draft = new DraftState(rows, [], slots);
    let guard = 0;
    while (!draft.isComplete() && guard++ < slots.length * 8) {
      const squad = draft.rollNextSquad();
      if (!squad) break;
      for (const side of ["A", "B"]) {
        const roster = side === "A" ? draft.rosterA : draft.rosterB;
        for (const player of squad.players) {
          let placed = false;
          for (const slot of slots.filter((s) => !roster[s])) {
            try {
              draft.makePick(side, player, slot);
              placed = true;
              break;
            } catch {
              /* not eligible there */
            }
          }
          if (placed) break;
        }
      }
    }
    if (!draft.isComplete()) return null;
    const result = NFL.simulate(draft.rosterA, draft.rosterB, ctx, { rand });
    return { result, rosterA: draft.rosterA, rosterB: draft.rosterB };
  } finally {
    Math.random = realRandom;
  }
}

/** Every column the ledger writes, so a check cannot silently skip one. The
 * reconciliation against the engine runs over all of them - that is the
 * guarantee this file exists for, and it is exact. */
const LINE_KEYS = [
  "comp", "att", "pass_yds", "pass_tds", "rush_yds", "rush_tds", "carries",
  "targets", "sacked", "rec", "rec_yds", "rec_tds", "ints", "fumbles", "sacks",
  "fgs", "fga", "td", "pts",
];

/**
 * ...but only these COUNT. Two checks below - "nothing runs ahead of the feed"
 * and "nothing goes negative" - were written over the whole list, and both are
 * only true of a counter.
 *
 * YARDAGE IS SIGNED. A sack is negative passing yardage in the NFL's own books
 * and a run for a loss is negative rushing yardage, so a player's yards can go
 * DOWN as a game proceeds and a man who was only ever stuffed finishes below
 * zero. Neither is a spoiler and neither is a bug; the checks simply could not
 * tell the difference between a stat moving backwards and a stat leaking from
 * the future. They passed until drives that lose ground became common enough
 * to trip them, which is the wrong reason for a check to hold.
 *
 * A completion, a carry, a target, a touchdown and a point only ever go up.
 */
const COUNTING_KEYS = LINE_KEYS.filter(
  (key) => !["pass_yds", "rush_yds", "rec_yds"].includes(key)
);

/** How far below zero one man's yardage can plausibly finish a whole game.
 * Deep enough that ordinary losses pass, shallow enough that a sign error in
 * the ledger would not. */
const YARDAGE_FLOOR = -40;
const TEAM_KEYS = [
  "passYards", "rushYards", "totalYards", "firstDowns", "turnovers",
  "thirdDownAttempts", "thirdDownConversions", "redZoneTrips",
  "redZoneTouchdowns", "sacksAllowed", "possessionSeconds", "drives",
  "startYardTotal", "plays", "averageStart",
];

const fail = {
  score: 0,
  playerLine: 0,
  teamTotal: 0,
  spoiledScore: 0,
  spoiledPlayer: 0,
  spoiledQuarter: 0,
  quarterSum: 0,
  negative: 0,
};
const examples = [];
let games = 0;
let comparedLines = 0;
let midGamesChecked = 0;

for (let seed = 1; seed <= GAMES; seed++) {
  const game = playOneGame(seed);
  if (!game) continue;
  const { result, rosterA, rosterB } = game;
  const { events } = buildTimeline(result.drives);
  if (!events.length) continue;
  games++;

  // ---- the spoiler check ------------------------------------------------
  // Stop in the middle of Q1 and assert the rest of Q1 is genuinely not
  // visible yet - not merely unrendered, but absent from the state.
  const q1 = events.filter((e) => e.quarter === 1);
  if (q1.length >= 4) {
    midGamesChecked++;
    const midpoint = Math.floor(q1.length / 2);
    const partial = createLiveState({ rosterA, rosterB });
    for (const event of q1.slice(0, midpoint)) applyEvent(partial, event);

    // Points scored later in Q1 must not already be on the board.
    const shownScore = liveScore(partial);
    const laterPoints = { A: 0, B: 0 };
    for (const event of q1.slice(midpoint)) {
      if (!event.scoreDelta) continue;
      laterPoints.A += event.scoreDelta.A || 0;
      laterPoints.B += event.scoreDelta.B || 0;
    }
    const fullQ1 = createLiveState({ rosterA, rosterB });
    for (const event of q1) applyEvent(fullQ1, event);
    const endOfQ1 = liveScore(fullQ1);
    if (laterPoints.A + laterPoints.B > 0) {
      if (shownScore.A + shownScore.B >= endOfQ1.A + endOfQ1.B) {
        fail.spoiledScore++;
        examples.push(`seed ${seed}: mid-Q1 showed ${shownScore.A}-${shownScore.B}, Q1 ended ${endOfQ1.A}-${endOfQ1.B}`);
      }
    }

    // Production still to come must not be in any player's line yet. Counters
    // only - see COUNTING_KEYS.
    for (const side of ["A", "B"]) {
      const partialBox = liveBox(partial, side);
      const laterBox = liveBox(fullQ1, side);
      for (const slot of Object.keys(laterBox)) {
        for (const key of COUNTING_KEYS) {
          if ((partialBox[slot]?.[key] || 0) > (laterBox[slot]?.[key] || 0)) {
            fail.spoiledPlayer++;
            examples.push(`seed ${seed}: ${side} ${slot} ${key} ran ahead of the quarter`);
          }
        }
      }
    }

    // And no quarter summary exists for a quarter that has not ended. The
    // quarter-ending event is what publishes it; before that the key must
    // simply not be there.
    const endedEarly = q1.slice(0, midpoint).some((e) => e.type === "quarterEnd" || e.type === "halfEnd" || e.type === "gameEnd");
    if (!endedEarly && partial.quarterScores[2] != null) {
      fail.spoiledQuarter++;
      examples.push(`seed ${seed}: Q2 summary existed during Q1`);
    }
  }

  // ---- reconciliation ---------------------------------------------------
  const state = createLiveState({ rosterA, rosterB });
  for (const event of events) applyEvent(state, event);

  const finalScore = liveScore(state);
  if (finalScore.A !== Math.round(result.teamScoreA) || finalScore.B !== Math.round(result.teamScoreB)) {
    fail.score++;
    examples.push(`seed ${seed}: ledger ${finalScore.A}-${finalScore.B} vs engine ${Math.round(result.teamScoreA)}-${Math.round(result.teamScoreB)}`);
  }

  // Per-quarter points must sum to the game. Two tallies for one truth is how
  // a scoreboard and a play-by-play end up disagreeing.
  const quarterSum = { A: 0, B: 0 };
  for (const q of Object.values(state.quarterScores)) {
    quarterSum.A += q.A;
    quarterSum.B += q.B;
  }
  if (Math.round(quarterSum.A) !== finalScore.A || Math.round(quarterSum.B) !== finalScore.B) {
    fail.quarterSum++;
    examples.push(`seed ${seed}: quarters summed to ${Math.round(quarterSum.A)}-${Math.round(quarterSum.B)}`);
  }

  for (const [side, engineBox, engineTeam] of [
    ["A", result.boxA, result.teamStatsA],
    ["B", result.boxB, result.teamStatsB],
  ]) {
    const box = liveBox(state, side);
    for (const slot of Object.keys(engineBox)) {
      comparedLines++;
      for (const key of LINE_KEYS) {
        const mine = box[slot]?.[key] || 0;
        const theirs = engineBox[slot]?.[key] || 0;
        if (Math.round(mine) !== Math.round(theirs)) {
          fail.playerLine++;
          examples.push(`seed ${seed}: ${side} ${slot} ${key} ledger ${Math.round(mine)} vs engine ${Math.round(theirs)}`);
        }
        if (COUNTING_KEYS.includes(key) ? mine < 0 : mine < YARDAGE_FLOOR) fail.negative++;
      }
    }
    for (const key of TEAM_KEYS) {
      const mine = Math.round(state.team[side][key] || 0);
      const theirs = Math.round(engineTeam[key] || 0);
      if (mine !== theirs) {
        fail.teamTotal++;
        examples.push(`seed ${seed}: ${side} team ${key} ledger ${mine} vs engine ${theirs}`);
      }
    }
  }
}

const checks = [
  {
    title: "Folding every event reproduces the engine's final score",
    ok: fail.score === 0,
    detail: `${fail.score} mismatches over ${games} games`,
  },
  {
    title: "Every player line reconciles with the engine's box score",
    ok: fail.playerLine === 0,
    detail: `${fail.playerLine} disagreements over ${comparedLines} lines`,
  },
  {
    title: "Every team total reconciles with the engine's team stats",
    ok: fail.teamTotal === 0,
    detail: `${fail.teamTotal} disagreements over ${TEAM_KEYS.length} totals a side`,
  },
  {
    title: "Per-quarter points sum to the final score",
    ok: fail.quarterSum === 0,
    detail: `${fail.quarterSum} games where the quarters did not add up`,
  },
  {
    title: "Mid-quarter, points still to be scored are not on the board",
    ok: fail.spoiledScore === 0,
    detail: `${fail.spoiledScore} spoiled scores over ${midGamesChecked} paused games`,
  },
  {
    title: "Mid-quarter, production still to come is absent from every line",
    ok: fail.spoiledPlayer === 0,
    detail: `${fail.spoiledPlayer} lines running ahead of the play feed`,
  },
  {
    title: "A quarter's summary does not exist until the quarter ends",
    ok: fail.spoiledQuarter === 0,
    detail: `${fail.spoiledQuarter} summaries published early`,
  },
  {
    title: "No counter goes negative, and no yardage runs off the bottom",
    ok: fail.negative === 0,
    detail: `${fail.negative} negative values`,
  },
];

console.log(renderSection(`NFL live event ledger (${games} games, ${comparedLines} player lines)`));
const report = checks.map((c) => ({ title: c.title, status: c.ok ? PASS : FAIL, detail: c.detail }));
for (const c of report) console.log(renderCheck(c));
const { counts, ok } = summarize(report);
if (examples.length) {
  console.log("\n  first disagreements:");
  for (const line of examples.slice(0, 8)) console.log(`    ${line}`);
}
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
