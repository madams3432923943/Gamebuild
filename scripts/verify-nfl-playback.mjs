#!/usr/bin/env node
// Football's drive playback: the timeline, its pacing, and the field state
// every event carries.
//
// WHY THIS EXISTS
//
// Live testing said the plays revealed far too quickly to follow. They did,
// and not by a tunable amount: football was being played back on basketball's
// cadence. main.js took the quarter's hold, divided it by however many drives
// that quarter happened to have, and fired them. Every drive got the same
// slice whether it was a three-and-out or a game-winner, and the total was
// whatever the basketball reveal took - so a game with many drives flickered
// past and one with few crawled.
//
// The fix is a timeline built as DATA before any timer starts, which is what
// makes it checkable here: total length, relative weighting, and the field
// state at every single event, without waiting on a clock.
//
// The other half is that the timeline must never contradict the game it came
// from. Every yard line, score and possession here is asserted against the
// engine's own drives, because a play feed that disagrees with the scoreboard
// is worse than no play feed at all.

import { setActiveSport } from "../js/sports/index.js";
import { NFL } from "../js/sports/nfl/index.js";
import { DraftState } from "../js/draft.js";
import { buildTimeline, TARGET_MIN_MS, TARGET_MAX_MS, EVENT_WEIGHTS, DEFAULT_SPEED } from "../js/sports/nfl/playback.js";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const GAMES = Number(process.env.NFL_PLAYBACK_GAMES || 120);

setActiveSport("nfl");
// Football's dataset loads on demand now (see NFL.preload), so a script that
// reads the player pool has to ask for it first.
await NFL.preload();
const rows = NFL.playersInEra(NFL.players(), NFL.defaultEra);
const slots = NFL.slots.ranked;
const ctx = NFL.computeDatasetStats(NFL.players(), NFL.units());

function playOneGame() {
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
  return NFL.simulate(draft.rosterA, draft.rosterB, ctx, {});
}

const fail = {
  offField: 0,
  playEndpoint: 0,
  driveEndpoint: 0,
  badDown: 0,
  scoreMismatch: 0,
  outOfBand: 0,
  nonMonotonic: 0,
  missingKickoff: 0,
  badClock: 0,
  clockRose: 0,
  clockAtWhistle: 0,
};
let games = 0;
let minMs = Infinity;
let maxMs = 0;
let events = 0;
let plays = 0;
let drives = 0;
const seen = new Set();

for (let n = 0; n < GAMES; n++) {
  const result = playOneGame();
  if (!result) continue;
  games++;

  // ---- the plays must reconcile to the drive they belong to ---------------
  for (const drive of result.drives) {
    drives++;
    plays += drive.plays.length;
    const first = drive.plays[0];
    const last = drive.plays[drive.plays.length - 1];
    if (!first || first.startYard !== drive.startYard) fail.driveEndpoint++;
    if (!last || last.endYard !== drive.endYard) fail.playEndpoint++;
    for (const p of drive.plays) {
      if (p.down < 1 || p.down > 4 || p.distance < 1) fail.badDown++;
      if (p.startYard < 0 || p.startYard > 100 || p.endYard < 0 || p.endYard > 100) fail.offField++;
    }
  }

  const { totalMs, events: list } = buildTimeline(result.drives);
  events += list.length;
  minMs = Math.min(minMs, totalMs);
  maxMs = Math.max(maxMs, totalMs);
  if (totalMs < TARGET_MIN_MS || totalMs > TARGET_MAX_MS) fail.outOfBand++;

  let prev = -1;
  let sawKickoff = false;
  let lastQ = null;
  let lastClock = Infinity;
  for (const e of list) {
    seen.add(e.type);
    if (e.type === "kickoff") sawKickoff = true;
    // Offsets must only ever move forward, or events land out of order.
    if (e.atMs < prev) fail.nonMonotonic++;
    prev = e.atMs;
    // Never animate the ball beyond either goal line.
    if (e.yard != null && (e.yard < 0 || e.yard > 100)) fail.offField++;
    if (e.down != null && (e.down < 1 || e.down > 4)) fail.badDown++;
    // The clock is m:ss, never negative, and never runs backwards inside a
    // quarter - it resets at the top of each one.
    if (!/^\d+:[0-5]\d$/.test(e.clock || "")) fail.badClock++;
    const secs = clockSeconds(e.clock);
    if (e.quarter === lastQ && secs > lastClock) fail.clockRose++;
    if (e.quarter !== lastQ) lastQ = e.quarter;
    lastClock = secs;
  }
  if (!sawKickoff) fail.missingKickoff++;

  // A period ends at 0:00, by definition. The drives inside one rarely burn a
  // full fifteen minutes, and whatever was left used to be carried straight
  // into the break event - so the final screen read "Q4 5:28" beside the word
  // FINAL, a game simultaneously over and still running.
  for (const e of list) {
    if (e.type !== "gameEnd" && e.type !== "quarterEnd" && e.type !== "halfEnd") continue;
    if (clockSeconds(e.clock) !== 0) fail.clockAtWhistle++;
  }

  // The timeline's running score must arrive at the game's real final score.
  const last = list[list.length - 1];
  if (Math.round(last.scoreA) !== Math.round(result.teamScoreA) ||
      Math.round(last.scoreB) !== Math.round(result.teamScoreB)) {
    fail.scoreMismatch++;
  }
}

// Relative weighting: the whole reason for a timeline rather than a divider.
const w = EVENT_WEIGHTS;
const weightingHolds =
  w.touchdown > w.firstDown && w.firstDown > w.play &&
  w.turnover > w.play && w.fieldGoal > w.play && w.quarterEnd > w.play;

// The product spec's bands, as data. [label, actual, min, max]
const BANDS = [
  ["ordinary play", w.play, 700, 1000],
  ["first down", w.firstDown, 1000, 1400],
  ["big gain", w.bigGain, 1000, 1400],
  ["sack", w.sack, 1200, 1600],
  ["red zone", w.redZone, 1200, 1600],
  ["turnover", w.turnover, 1700, 2300],
  ["touchdown", w.touchdown, 1700, 2300],
  ["field goal", w.fieldGoal, 1700, 2300],
  ["quarter end", w.quarterEnd, 1200, 1800],
];

// Scaling the speed has to re-time the whole game proportionally, or a future
// speed control would change the pacing's shape rather than its rate.
const speedSample = playOneGame();
const singleSpeedMs = speedSample ? buildTimeline(speedSample.drives).totalMs : 0;
const doubleSpeedMs = speedSample ? buildTimeline(speedSample.drives, { speed: 2 }).totalMs : 0;
const halfSpeedHalvesIt =
  singleSpeedMs > 0 && Math.abs(doubleSpeedMs - singleSpeedMs / 2) / (singleSpeedMs / 2) < 0.05;

const REQUIRED_EVENTS = ["kickoff", "driveStart", "play", "touchdown", "punt", "quarterEnd", "gameEnd"];
const missingEvents = REQUIRED_EVENTS.filter((t) => !seen.has(t));

function clockSeconds(text) {
  const [m, s] = String(text || "0:00").split(":").map(Number);
  return (m || 0) * 60 + (s || 0);
}

const checks = [
  {
    title: `Playback lasts ${TARGET_MIN_MS / 1000}-${TARGET_MAX_MS / 1000}s`,
    ok: fail.outOfBand === 0,
    detail: `${(minMs / 1000).toFixed(1)}s - ${(maxMs / 1000).toFixed(1)}s over ${games} games`,
  },
  {
    title: "Important moments get more time than ordinary snaps",
    ok: weightingHolds,
    detail: `play ${w.play}ms, firstDown ${w.firstDown}ms, TD ${w.touchdown}ms, turnover ${w.turnover}ms`,
  },
  {
    // Every band the product spec asks for, checked individually rather than
    // as one "feels about right" total. A game can land inside 35-50s while
    // still showing a touchdown at the speed of an incompletion.
    title: "Every event class sits inside its specified duration band",
    ok: BANDS.every(([, value, lo, hi]) => value >= lo && value <= hi),
    detail: BANDS.map(([name, value, lo, hi]) =>
      `${name} ${value}ms${value >= lo && value <= hi ? "" : ` OUT OF ${lo}-${hi}`}`
    ).join(", "),
  },
  {
    title: "A speed control is a value, not a rewrite",
    ok: DEFAULT_SPEED === 1 && halfSpeedHalvesIt,
    detail: `speed 2 gives ${(doubleSpeedMs / 1000).toFixed(1)}s against ${(singleSpeedMs / 1000).toFixed(1)}s`,
  },
  {
    title: "Events are emitted in forward time order",
    ok: fail.nonMonotonic === 0,
    detail: `${fail.nonMonotonic} out-of-order offsets`,
  },
  {
    title: "Every game opens with a kickoff",
    ok: fail.missingKickoff === 0,
    detail: `${fail.missingKickoff} games without one`,
  },
  {
    title: "The event vocabulary covers a football game",
    ok: missingEvents.length === 0,
    detail: missingEvents.length ? `missing: ${missingEvents.join(" ")}` : [...seen].sort().join(" "),
  },
  {
    title: "The ball never goes beyond either goal line",
    ok: fail.offField === 0,
    detail: `${fail.offField} positions off the field`,
  },
  {
    title: "Down is always 1st through 4th, distance always at least 1",
    ok: fail.badDown === 0,
    detail: `${fail.badDown} illegal down/distance`,
  },
  {
    title: "Each drive's plays start and end exactly where the drive did",
    ok: fail.driveEndpoint === 0 && fail.playEndpoint === 0,
    detail: `${fail.driveEndpoint} bad starts, ${fail.playEndpoint} bad ends, over ${drives} drives`,
  },
  {
    title: "Every period ends at 0:00",
    ok: fail.clockAtWhistle === 0,
    detail: `${fail.clockAtWhistle} breaks announced with time still on the clock`,
  },
  {
    title: "The game clock reads m:ss and never runs backwards in a quarter",
    ok: fail.badClock === 0 && fail.clockRose === 0,
    detail: `${fail.badClock} malformed, ${fail.clockRose} moving backwards`,
  },
  {
    title: "The timeline's running score arrives at the real final score",
    ok: fail.scoreMismatch === 0,
    detail: `${fail.scoreMismatch} mismatches in ${games} games`,
  },
];

console.log(renderSection(`NFL drive playback (${games} games, ${drives} drives, ${plays} plays)`));
const report = checks.map((c) => ({ title: c.title, status: c.ok ? PASS : FAIL, detail: c.detail }));
for (const c of report) console.log(renderCheck(c));
const { counts, ok } = summarize(report);
console.log(`\n  ${(events / Math.max(1, games)).toFixed(0)} events per game`);
console.log(`  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
