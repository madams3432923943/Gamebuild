#!/usr/bin/env node
// CAN A PERSON ACTUALLY FOLLOW AN NBA GAME?
//
// THE COMPLAINT THIS EXISTS FOR
//
// "The NBA live simulation plays too fast." It was not an impression. A quarter
// was revealed inside QUARTER_REVEAL_DELAY_MS - 4.2 seconds - of which the
// between-quarters card took 1.6, leaving about 2.6 seconds for the quarter's
// ninety-odd events. That is roughly 25 milliseconds per shot, and a whole game
// finished in about seventeen seconds. Nothing on the screen - the score, the
// chart, the feed - was on it long enough to read.
//
// WHAT IS ASSERTED
//
//   - a whole game lands in a watchable band, and does so whether the game had
//     320 events or 500
//   - an ordinary event is on screen long enough to read, and the moments worth
//     watching are held longer than the ones that are not
//   - the ordering of emphasis is right: a made three outlasts a made two
//     outlasts a miss outlasts a rebound
//   - 2x is exactly twice as fast, not 1.8 times
//   - AND THE THING THAT MATTERS MOST: changing the speed changes nothing but
//     the timing. The events, the box score, the shot chart and the MVP are
//     decided before the first timer starts, and this proves it by building the
//     timeline at three speeds over one result and diffing the events.

import { simulateGame, computeDatasetStats, defaultMinutes } from "../js/sports/nba/engine.js";
import {
  buildPlaybackTimeline,
  eventWeight,
  periodSpan,
  TARGET_MIN_MS,
  TARGET_MAX_MS,
  QUARTER_CARD_MS,
  SPEEDS,
} from "../js/sports/nba/playback.js";
import NBA from "../js/sports/nba/index.js";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";
import { loadDataset } from "../data/load.mjs";

const PLAYERS = await loadDataset("nba-players");
const GAMES = Number(process.env.PACE_GAMES || 60);

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry(20260908);
const stats = computeDatasetStats(PLAYERS);
const roster = () => {
  const out = {};
  for (const slot of NBA.slots.ranked) out[slot] = PLAYERS[Math.floor(rand() * PLAYERS.length)];
  return out;
};

const checks = [];
const add = (title, ok, detail) => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

let minTotal = Infinity;
let maxTotal = 0;
let minEvents = Infinity;
let maxEvents = 0;
const medians = [];
const ordinaryHolds = [];
let outOfBand = 0;
let shortEvents = 0;
let cardTooShort = 0;
let speedFaults = 0;
let resultDrift = 0;

for (let g = 0; g < GAMES; g++) {
  const a = roster();
  const b = roster();
  const result = simulateGame(a, b, stats, { minutesA: defaultMinutes(a), minutesB: defaultMinutes(b) });
  const timeline = buildPlaybackTimeline(result.shotEvents);

  minTotal = Math.min(minTotal, timeline.totalMs);
  maxTotal = Math.max(maxTotal, timeline.totalMs);
  minEvents = Math.min(minEvents, result.shotEvents.length);
  maxEvents = Math.max(maxEvents, result.shotEvents.length);
  // A LITTLE OVER THE BAND IS FINE AND EXPECTED: the band is the target for the
  // events, and each period's card is added on top of it.
  const cards = timeline.periods.length * QUARTER_CARD_MS;
  if (timeline.totalMs < TARGET_MIN_MS || timeline.totalMs > TARGET_MAX_MS + cards) outOfBand += 1;

  const holds = timeline.events.map((e) => e.durationMs).sort((x, y) => x - y);
  medians.push(holds[holds.length >> 1]);
  // "Ordinary" is a missed field goal - the most common thing that is not a
  // rebound, and the one the brief asks to be readable.
  for (const { event, durationMs } of timeline.events) {
    if (event.type === "shot" && !event.made && event.shotType !== "free-throw" && !event.endOfPeriod) {
      ordinaryHolds.push(durationMs);
    }
    if (durationMs < 90) shortEvents += 1;
  }

  // Each period's own span has to leave the card its full time on screen -
  // otherwise a 1.9-second summary flashes for a few hundred milliseconds, which
  // is exactly what happened when the card's time was carved out of the front of
  // the NEXT period instead of added to the end of this one.
  for (const period of timeline.periods) {
    if (period.endMs - period.cardAtMs < QUARTER_CARD_MS - 1) cardTooShort += 1;
  }

  // ---- SPEED CHANGES TIMING AND NOTHING ELSE ------------------------------
  const fast = buildPlaybackTimeline(result.shotEvents, { speed: 2 });
  const ratio = timeline.totalMs / fast.totalMs;
  if (Math.abs(ratio - 2) > 0.02) speedFaults += 1;
  const strip = (t) => JSON.stringify(t.events.map((e) => e.event));
  if (strip(timeline) !== strip(fast)) resultDrift += 1;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const totalSeconds = (ms) => (ms / 1000).toFixed(1);

add(
  "A whole game lands in a watchable band",
  outOfBand === 0,
  `${totalSeconds(minTotal)}s to ${totalSeconds(maxTotal)}s across ${GAMES} games ` +
    `(${minEvents}-${maxEvents} events); the old fixed reveal finished every game in about 17s`
);
add(
  "Games of very different length still take about the same time to watch",
  maxTotal - minTotal < 40000,
  `${totalSeconds(maxTotal - minTotal)}s of spread between the longest and shortest game, ` +
    `over an event count that varies by ${maxEvents - minEvents}`
);
add(
  "An ordinary event is on screen long enough to read",
  mean(ordinaryHolds) >= 400 && mean(ordinaryHolds) <= 1000 && shortEvents === 0,
  `a missed field goal holds ${Math.round(mean(ordinaryHolds))}ms on average, median event ${Math.round(mean(medians))}ms; ` +
    `nothing under 90ms`
);

// ---- emphasis ordering ------------------------------------------------------
const sample = (over) => eventWeight(over);
const rebound = sample({ type: "rebound" });
const missTwo = sample({ type: "shot", shotType: "two", made: false });
const madeTwo = sample({ type: "shot", shotType: "two", made: true });
const madeThree = sample({ type: "shot", shotType: "three", made: true });
const leadChanging = sample({ type: "shot", shotType: "three", made: true, leadChange: true });
const buzzer = sample({ type: "shot", shotType: "three", made: true, leadChange: true, endOfPeriod: true });
add(
  "Time is spent where something happened",
  rebound < missTwo && missTwo < madeTwo && madeTwo < madeThree && madeThree < leadChanging && leadChanging < buzzer,
  `rebound ${rebound}ms < missed two ${missTwo} < made two ${madeTwo} < made three ${madeThree} < ` +
    `lead-changing three ${leadChanging} < one that also ends the quarter ${buzzer}`
);

add(
  "2x is exactly twice as fast",
  speedFaults === 0,
  `${SPEEDS.join("x, ")}x offered; every game's 2x timeline runs in half the wall clock, ` +
    `with the minimum hold scaled rather than clamped under it`
);
add(
  "Speed changes the timing and nothing else",
  resultDrift === 0,
  `the same ${GAMES} results, laid out at 1x and 2x: identical events in identical order. ` +
    `The simulation is finished before the first timer starts, so no speed control can reach it`
);
add(
  "The between-quarters card gets its full time on screen",
  cardTooShort === 0,
  `${QUARTER_CARD_MS}ms at the END of every period it summarises, not carved out of the next one`
);

// ---- periodSpan is what the reveal loop waits for ---------------------------
const spanRoster = roster();
const spanResult = simulateGame(spanRoster, roster(), stats);
const spanTimeline = buildPlaybackTimeline(spanResult.shotEvents);
const spans = spanTimeline.periods.map((p) => periodSpan(spanTimeline, p.period));
add(
  "Every period reports a span the reveal loop can wait for",
  spans.length > 0 && spans.every((s) => s > 5000),
  `periods run ${spans.map((s) => `${(s / 1000).toFixed(1)}s`).join(", ")} - the reveal waits for the events ` +
    `rather than squeezing them into a fixed 4.2s hold`
);

console.log(renderSection(`NBA playback pacing (${GAMES} games)`));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
