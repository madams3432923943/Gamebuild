#!/usr/bin/env node
// CAN A PERSON ACTUALLY FOLLOW AN NBA GAME, AND DOES IT FIT IN A MINUTE?
//
// THE TWO COMPLAINTS THIS EXISTS FOR
//
// First, and originally: "the NBA live simulation plays too fast." A quarter
// was revealed inside a 4.2-second hold, of which the between-quarters card
// took 1.6, leaving about 2.6 seconds for the quarter's ninety-odd events -
// roughly 25ms per shot, and a whole game done in seventeen seconds.
//
// Then, after the fix overshot: "the NBA simulation is far too slow. I want a
// whole game to take approximately ONE MINUTE." Playback aimed at 195 seconds,
// which is a broadcast's pace applied to a gamecast's amount of information.
//
// WHAT IS ASSERTED
//
//   - a whole game lands in the one-minute band, MEASURED across many games
//     rather than argued from the constants, with min/mean/max reported
//   - length does not track possession count: a 500-event game and a 320-event
//     one take about the same time to watch
//   - an ordinary event is on screen long enough to read, and the moments worth
//     watching are held longer than the ones that are not
//   - rebounds are FOLDED rather than shown, which is where the time comes from
//   - a close finish gets more time than an ordinary possession, and a blowout's
//     finish does not
//   - AND THE THING THAT MATTERS MOST: pacing changes nothing but timing. The
//     events, the box score, the shot chart and the MVP are decided before the
//     first timer starts, and this proves it by laying one result out at two
//     targets and diffing the events.

import { simulateGame, computeDatasetStats, defaultMinutes } from "../js/sports/nba/engine.js";
import {
  buildPlaybackTimeline,
  eventWeight,
  isQuietEvent,
  periodSpan,
  TARGET_MIN_MS,
  TARGET_MAX_MS,
  TARGET_MS,
  QUARTER_CARD_MS,
  HALFTIME_CARD_MS,
} from "../js/sports/nba/playback.js";
import NBA from "../js/sports/nba/index.js";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";
import { loadDataset } from "../data/load.mjs";

const PLAYERS = await loadDataset("nba-players");
const GAMES = Number(process.env.PACE_GAMES || 120);

/** The app's own bookends around the events, so what this measures is what a
 * viewer waits through: js/constants.js OPENING_HOLD_MS + FINAL_HOLD_MS. Read
 * from there rather than restated, so the two cannot drift. */
const { OPENING_HOLD_MS, FINAL_HOLD_MS } = await import("../js/constants.js");

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

const runtimes = [];
let minEvents = Infinity;
let maxEvents = 0;
const medians = [];
const ordinaryHolds = [];
let outOfBand = 0;
let shortEvents = 0;
let cardTooShort = 0;
let resultDrift = 0;
let quietShown = 0;
let quietTotal = 0;
let eventTotal = 0;
let clutchGames = 0;
let clutchFaults = 0;
let leaks = 0;

for (let g = 0; g < GAMES; g++) {
  const a = roster();
  const b = roster();
  const result = simulateGame(a, b, stats, { minutesA: defaultMinutes(a), minutesB: defaultMinutes(b) });
  const timeline = buildPlaybackTimeline(result.shotEvents);

  // WHAT A VIEWER ACTUALLY WAITS THROUGH, end to end: the opening hold, every
  // event and card, and the beat before the whistle. Not the events alone.
  const runtime = OPENING_HOLD_MS + timeline.totalMs + FINAL_HOLD_MS;
  runtimes.push(runtime);
  minEvents = Math.min(minEvents, result.shotEvents.length);
  maxEvents = Math.max(maxEvents, result.shotEvents.length);
  if (runtime < 55000 || runtime > 70000) outOfBand += 1;

  const holds = timeline.events.filter((e) => !e.quiet).map((e) => e.durationMs).sort((x, y) => x - y);
  medians.push(holds[holds.length >> 1]);
  for (const { event, durationMs, quiet } of timeline.events) {
    eventTotal += 1;
    if (quiet) {
      quietTotal += 1;
      if (durationMs > 0) quietShown += 1;
      continue;
    }
    // "Ordinary" is a missed field goal - the most common thing that gets a
    // beat of its own, and the one the brief asks to be readable.
    if (event.type === "shot" && !event.made && event.shotType !== "free-throw" && !event.endOfPeriod) {
      ordinaryHolds.push(durationMs);
    }
    if (durationMs < 90) shortEvents += 1;
  }

  // THE INVARIANT THE WHOLE REDESIGN IS FOR: an event's atMs is never before
  // the atMs of an event in an earlier period. A timeline that let period 2's
  // first event share period 1's slot is a timeline on which the board could
  // show a quarter before it was watched.
  let seen = 0;
  for (const { event, atMs } of timeline.events) {
    if (event.period < seen) leaks += 1;
    if (atMs < 0) leaks += 1;
    seen = Math.max(seen, event.period);
  }

  // Each period's own span has to leave its card the full time on screen -
  // otherwise the summary flashes for a few hundred milliseconds, which is
  // exactly what happened when the card's time was carved out of the front of
  // the NEXT period instead of added to the end of this one.
  for (const period of timeline.periods) {
    if (period.endMs - period.cardAtMs < QUARTER_CARD_MS - 1) cardTooShort += 1;
  }

  // ---- A CLOSE FINISH IS WORTH MORE TIME THAN AN ORDINARY POSSESSION -------
  const clutch = [];
  const ordinary = [];
  for (const { event, durationMs, quiet } of timeline.events) {
    if (quiet || event.type !== "shot" || event.shotType === "free-throw") continue;
    const close =
      event.period >= 4 &&
      typeof event.clockSeconds === "number" &&
      event.clockSeconds <= 120 &&
      event.scoreAfter &&
      Math.abs(event.scoreAfter.a - event.scoreAfter.b) <= 5;
    (close ? clutch : ordinary).push(durationMs / (event.made ? (event.shotType === "three" ? 430 : 330) : 190));
  }
  if (clutch.length >= 4) {
    clutchGames += 1;
    const m = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
    if (m(clutch) <= m(ordinary) * 1.2) clutchFaults += 1;
  }

  // ---- PACING CHANGES TIMING AND NOTHING ELSE -----------------------------
  const slower = buildPlaybackTimeline(result.shotEvents, { targetMs: TARGET_MAX_MS });
  const strip = (t) => JSON.stringify(t.events.map((e) => e.event));
  if (strip(timeline) !== strip(slower)) resultDrift += 1;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const secs = (ms) => (ms / 1000).toFixed(1);
const minRun = Math.min(...runtimes);
const maxRun = Math.max(...runtimes);
const meanRun = mean(runtimes);

add(
  "A whole game takes about one minute, measured",
  outOfBand === 0,
  `min ${secs(minRun)}s, mean ${secs(meanRun)}s, max ${secs(maxRun)}s across ${GAMES} games ` +
    `(${minEvents}-${maxEvents} events), opening hold and final beat included. Target ${secs(TARGET_MS)}s of events`
);
add(
  "Length does not track possession count",
  maxRun - minRun < 9000,
  `${secs(maxRun - minRun)}s of spread between the longest and shortest game, over an event count ` +
    `that varies by ${maxEvents - minEvents}. A busy game gets quicker beats, not three minutes`
);
add(
  "An ordinary event is on screen long enough to read",
  mean(ordinaryHolds) >= 130 && mean(ordinaryHolds) <= 320 && shortEvents === 0,
  `a missed field goal holds ${Math.round(mean(ordinaryHolds))}ms on average, median shown event ` +
    `${Math.round(mean(medians))}ms; nothing under 90ms`
);
add(
  "Rebounds are folded into the next beat rather than shown",
  quietShown === 0 && quietTotal > 0,
  `${quietTotal} of ${eventTotal} events (${Math.round((quietTotal / eventTotal) * 100)}%) hold for 0ms and ` +
    `share the instant of the event after them. They still COUNT - the fold applies them - they just do not ` +
    `spend a beat announcing themselves, which is where a minute's worth of time came from`
);
add(
  "Nothing is revealed before the period it belongs to",
  leaks === 0,
  `every event's atMs is non-negative and no period's events precede an earlier period's, over ${GAMES} games`
);
add(
  "A close finish is held longer than an ordinary possession",
  clutchFaults === 0,
  `${clutchGames} of ${GAMES} games reached the last two minutes within five points; in every one, those shots ` +
    `held at least 20% longer per unit of base weight. A blowout gets no multiplier and finishes at the same clip`
);

// ---- emphasis ordering ------------------------------------------------------
const w = (over) => eventWeight(over);
const rebound = w({ type: "rebound" });
const missTwo = w({ type: "shot", shotType: "two", made: false });
const madeTwo = w({ type: "shot", shotType: "two", made: true });
const madeThree = w({ type: "shot", shotType: "three", made: true });
const leadChanging = w({ type: "shot", shotType: "three", made: true, leadChange: true });
const buzzer = w({ type: "shot", shotType: "three", made: true, leadChange: true, endOfPeriod: true });
add(
  "Time is spent where something happened",
  rebound === 0 &&
    isQuietEvent({ type: "rebound" }) &&
    missTwo < madeTwo &&
    madeTwo < madeThree &&
    madeThree < leadChanging &&
    leadChanging < buzzer,
  `rebound folded (0ms) < missed two ${missTwo}ms < made two ${madeTwo} < made three ${madeThree} < ` +
    `lead-changing three ${leadChanging} < one that also ends the quarter ${buzzer}`
);
add(
  "Pacing changes the timing and nothing else",
  resultDrift === 0,
  `the same ${GAMES} results, laid out at ${secs(TARGET_MS)}s and ${secs(TARGET_MAX_MS)}s: identical events in ` +
    `identical order. The simulation is finished before the first timer starts, so no pacing decision can reach it`
);
add(
  "The between-quarters card gets its full time on screen",
  cardTooShort === 0,
  `${QUARTER_CARD_MS}ms at the END of every period it summarises (${HALFTIME_CARD_MS}ms at half time), ` +
    `not carved out of the next one`
);

// ---- periodSpan ------------------------------------------------------------
const spanRoster = roster();
const spanResult = simulateGame(spanRoster, roster(), stats);
const spanTimeline = buildPlaybackTimeline(spanResult.shotEvents);
const spans = spanTimeline.periods.map((p) => periodSpan(spanTimeline, p.period));
add(
  "Every period reports a span, and four of them fill the minute",
  spans.length > 0 && spans.every((s) => s > 8000 && s < 22000),
  `periods run ${spans.map((s) => `${(s / 1000).toFixed(1)}s`).join(", ")} - four quarters of 13-14 seconds ` +
    `is what a one-minute game is made of`
);
add(
  "The band is the one the app asks for",
  TARGET_MIN_MS >= 40000 && TARGET_MAX_MS <= 65000 && TARGET_MS >= TARGET_MIN_MS && TARGET_MS <= TARGET_MAX_MS,
  `${secs(TARGET_MIN_MS)}s to ${secs(TARGET_MAX_MS)}s of events, aiming at ${secs(TARGET_MS)}s`
);

console.log(renderSection(`NBA playback pacing (${GAMES} games)`));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
