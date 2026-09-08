#!/usr/bin/env node
// The NBA shot ledger, held to the one promise that makes it legitimate.
//
// The ledger decomposes the engine's per-quarter stat lines into the shots
// that produced them. That is only defensible while it reproduces the engine
// EXACTLY. The moment a rounding error lets the chart disagree with the
// scoreboard, it stops being a visualisation of the simulation and becomes a
// second, quieter simulation sitting next to it - which is the failure mode
// the whole design exists to avoid.
//
// So this checks the boring, load-bearing things:
//   - points reconcile per player per quarter, and per team overall
//   - a player who never shot threes never takes one, in any game
//   - assists never exceed what the engine credited, and nobody assists himself
//   - steals, blocks and turnovers appear exactly as often as the engine said
//   - the same seed always produces the same ledger, because two players watch
//     the same online game on two machines
//
// Run against real rosters drawn from the real dataset, over many games, since
// rounding drift is a tail event and one game proves nothing.

import { simulateGame, computeDatasetStats } from "../js/sports/nba/engine.js";
import { buildShotLedger, ZONES, describeEvent, foldLiveStats, foldPlayerShotLines } from "../js/sports/nba/playback.js";
import NBA from "../js/sports/nba/index.js";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";
import { loadDataset } from "../data/load.mjs";

const PLAYERS = await loadDataset("nba-players");

const GAMES = Number(process.env.LEDGER_GAMES || 120);

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A full ranked roster of real players, so shot profiles are the real ones -
 * including the centres whose tpa is 0, which is the case worth protecting. */
function randomRoster(rand) {
  const slots = NBA.slots.ranked;
  const roster = {};
  for (const slot of slots) {
    roster[slot] = PLAYERS[Math.floor(rand() * PLAYERS.length)];
  }
  return roster;
}

const checks = [];
const add = (title, ok, detail) => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

const stats = computeDatasetStats(PLAYERS);
const rand = mulberry(20260816);

let worstPointDrift = 0;
let driftExample = "";
let teamDrift = 0;
let teamExample = "";
let illegalThrees = 0;
let illegalThreeExample = "";
let assistOverflow = 0;
let selfAssists = 0;
let countingMismatch = 0;
let countingExample = "";
let sampledEvents = 0;
let sampledShots = 0;
// THE COURT'S OWN INPUTS. Every one of these is new with the court, and every
// one of them is a way to draw a basketball game wrong that a reader notices
// instantly - a three inside the arc, a corner three at the top of the key, a
// clock that runs backwards.
let unplacedShots = 0;
let offCourt = 0;
let contradictedZone = 0;
let contradictedExample = "";
let clockFaults = 0;
let clockExample = "";
let describeFaults = 0;
let liveStatFaults = 0;
let liveStatExample = "";
// THE BOX SCORE AND THE CHART ARE ONE DERIVATION. They were two: the box score
// rolled its own unseeded split over the whole-game total while the ledger
// rolled a seeded one per quarter, and they disagreed about how the points were
// scored in 37 of 40 games. Anything that can drift again drifts here first.
let playerLineFaults = 0;
let playerLineExample = "";

for (let g = 0; g < GAMES; g++) {
  const rosterA = randomRoster(rand);
  const rosterB = randomRoster(rand);
  const result = simulateGame(rosterA, rosterB, stats);
  const seed = Math.floor(rand() * 2 ** 31);
  const { events } = buildShotLedger(result.quarterBoxScores, rosterA, rosterB, seed);
  sampledEvents += events.length;
  sampledShots += events.filter((e) => e.type === "shot").length;

  // ---- points reconcile, per player per quarter ---------------------------
  result.quarterBoxScores.forEach((period, i) => {
    for (const side of ["a", "b"]) {
      for (const [slot, line] of Object.entries(period[side] || {})) {
        const engine = Number(line.pts) || 0;
        const ledger = events
          .filter((e) => e.type === "shot" && e.made && e.period === i + 1 && e.side === side && e.slot === slot)
          .reduce((sum, e) => sum + e.points, 0);
        const drift = Math.abs(engine - ledger);
        if (drift > worstPointDrift) {
          worstPointDrift = drift;
          driftExample = `game ${g} Q${i + 1} ${side}/${slot}: engine ${engine}, ledger ${ledger}`;
        }
      }
    }
  });

  // ---- and per team, over the whole game ----------------------------------
  for (const [side, total] of [["a", result.teamScoreA], ["b", result.teamScoreB]]) {
    const ledger = events
      .filter((e) => e.type === "shot" && e.made && e.side === side)
      .reduce((sum, e) => sum + e.points, 0);
    if (ledger !== total) {
      teamDrift += 1;
      if (!teamExample) teamExample = `game ${g} side ${side}: engine ${total}, ledger ${ledger}`;
    }
  }

  // ---- nobody takes a shot they never took --------------------------------
  for (const e of events) {
    if (e.type !== "shot" || e.shotType !== "three") continue;
    const player = (e.side === "a" ? rosterA : rosterB)[e.slot];
    if (player && typeof player.tpa === "number" && player.tpa <= 0) {
      illegalThrees += 1;
      if (!illegalThreeExample) illegalThreeExample = `${player.name} (tpa ${player.tpa}) attempted a three`;
    }
  }

  // ---- assists are bounded by the engine, and never self-credited ---------
  result.quarterBoxScores.forEach((period, i) => {
    for (const side of ["a", "b"]) {
      const credited = {};
      for (const [slot, line] of Object.entries(period[side] || {})) {
        credited[slot] = Number(line.ast) || 0;
      }
      const used = {};
      for (const e of events) {
        if (e.type !== "shot" || e.period !== i + 1 || e.side !== side || !e.assistedBy) continue;
        used[e.assistedBy] = (used[e.assistedBy] || 0) + 1;
        if (e.assistedBy === e.slot) selfAssists += 1;
      }
      for (const [slot, n] of Object.entries(used)) {
        if (n > (credited[slot] || 0)) assistOverflow += 1;
      }
    }
  });

  // ---- every shot has a place on the floor, and it matches the shot --------
  //
  // The zone decides the points, so the coordinate can only ever be checked
  // AGAINST the zone: a three must be outside the arc and a two inside it. This
  // is measured on the unit half-court the ledger emits (see ZONE_ANCHORS),
  // taking the arc as the radius from the rim that separates the two classes.
  // The real numbers, on the ledger's own scale (feet / 50 on both axes): the
  // basket 5.25 feet off the baseline, the arc at 23.75 feet, the corner three
  // at 22 - which is why the corner is checked on how far out to the sideline
  // it is rather than on distance. Written out here independently of
  // ZONE_ANCHORS: a test that imports the placement it is checking only proves
  // the placement agrees with itself.
  const RIM = { x: 0.5, y: 5.25 / 50 };
  const ARC = 23.75 / 50;
  // 22 feet, which is where the corner three line actually is. This read 20
  // for a while, and two feet of slack is exactly the room a corner three needs
  // to be drawn inside the line it is named after.
  const CORNER_X = 22 / 50;
  for (const e of events) {
    if (e.type !== "shot" || e.shotType === "free-throw") continue;
    if (typeof e.x !== "number" || typeof e.y !== "number") {
      unplacedShots += 1;
      continue;
    }
    if (e.x < 0 || e.x > 1 || e.y < 0 || e.y > 1) offCourt += 1;
    const distance = Math.hypot(e.x - RIM.x, e.y - RIM.y);
    const isThree = e.shotType === "three";
    // A corner three is genuinely CLOSER to the rim than a wing three, so one
    // radius cannot separate the classes on its own - the corner is checked on
    // how far out toward the sideline it is instead, which is what makes it a
    // corner. Both are the real geometry rather than a fudge factor.
    // A three is outside the arc, OR far enough out toward a sideline to be a
    // corner three - the shot that is legitimately shorter than the arc.
    const inCorner = Math.abs(e.x - 0.5) > CORNER_X && e.y < 0.32;
    const outside = distance > ARC || inCorner;
    // A two must be inside the arc AND not standing in a corner, or the chart
    // is claiming two points for a shot taken from behind the line.
    const inside = distance < ARC && !inCorner;
    if ((isThree && !outside) || (!isThree && !inside)) {
      contradictedZone += 1;
      if (!contradictedExample) {
        contradictedExample = `${e.zone} ${e.shotType} at (${e.x.toFixed(2)}, ${e.y.toFixed(2)})`;
      }
    }
  }

  // ---- the folded player lines are the same shots the chart draws ---------
  //
  // Checked from BOTH ends: every player's line adds up within itself, and the
  // lines summed across a team equal the team fold the live strip is written
  // from. A box score that agrees with one and not the other is the bug this
  // replaced.
  {
    const perPlayer = foldPlayerShotLines(events);
    const perTeam = foldLiveStats(events, events.length - 1);
    for (const side of ["a", "b"]) {
      const lines = perPlayer[side];
      for (const key of ["fgm", "fga", "tpm", "tpa", "ftm", "fta"]) {
        const summed = Object.values(lines).reduce((sum, line) => sum + line[key], 0);
        if (summed !== perTeam[side][key]) {
          playerLineFaults += 1;
          if (!playerLineExample) {
            playerLineExample =
              `game ${g} side ${side}: players sum to ${summed} ${key}, team fold says ${perTeam[side][key]}`;
          }
        }
      }
      // A three is a field goal too - a line where it is not counted twice is
      // one that will disagree with the FG column it sits beside.
      for (const [slot, line] of Object.entries(lines)) {
        if (line.tpa > line.fga || line.tpm > line.fgm || line.fgm > line.fga || line.ftm > line.fta) {
          playerLineFaults += 1;
          if (!playerLineExample) playerLineExample = `game ${g} ${side}/${slot}: ${JSON.stringify(line)}`;
        }
      }
    }
  }

  // ---- the derived clock counts down, and restarts each period -------------
  let previousPeriod = null;
  let previousClock = Infinity;
  for (const e of events) {
    if (e.period !== previousPeriod) {
      previousPeriod = e.period;
      previousClock = Infinity;
    }
    if (typeof e.clockSeconds !== "number" || e.clockSeconds < 0 || e.clockSeconds > previousClock) {
      clockFaults += 1;
      if (!clockExample) clockExample = `Q${e.period}: ${e.clockSeconds} after ${previousClock}`;
    }
    previousClock = e.clockSeconds;
  }

  // ---- every event can be said out loud ------------------------------------
  for (const e of events) {
    const line = describeEvent(e);
    if (!line || !line.player || !line.detail) describeFaults += 1;
  }

  // ---- the live strip agrees with the ledger it is folded from -------------
  //
  // Folded to the END of the game, where the answer is knowable independently:
  // the made field goals in the strip must equal the made field goals in the
  // ledger, and the rebounds the rebounds. A strip that drifts is worse than no
  // strip, because it sits directly under a scoreboard that is right.
  const live = foldLiveStats(events, events.length - 1);
  for (const side of ["a", "b"]) {
    const madeFg = events.filter(
      (e) => e.type === "shot" && e.side === side && e.made && e.shotType !== "free-throw"
    ).length;
    const rebounds = events.filter((e) => e.type === "rebound" && e.side === side).length;
    if (live[side].fgm !== madeFg || live[side].reb !== rebounds) {
      liveStatFaults += 1;
      if (!liveStatExample) {
        liveStatExample = `${side}: strip ${live[side].fgm}fgm/${live[side].reb}reb vs ledger ${madeFg}/${rebounds}`;
      }
    }
  }

  // ---- rebounds, steals, blocks and turnovers appear exactly as credited ---

  result.quarterBoxScores.forEach((period, i) => {
    for (const side of ["a", "b"]) {
      for (const [stat, type] of [["reb", "rebound"], ["stl", "steal"], ["blk", "block"], ["tov", "turnover"]]) {
        const engine = Object.values(period[side] || {}).reduce((s, l) => s + (Number(l[stat]) || 0), 0);
        const ledger = events.filter((e) => e.type === type && e.period === i + 1 && e.side === side).length;
        if (engine !== ledger) {
          countingMismatch += 1;
          if (!countingExample) countingExample = `game ${g} Q${i + 1} ${side} ${stat}: engine ${engine}, ledger ${ledger}`;
        }
      }
    }
  });
}

// ---- determinism -----------------------------------------------------------
const detA = randomRoster(rand);
const detB = randomRoster(rand);
const detResult = simulateGame(detA, detB, stats);
const first = buildShotLedger(detResult.quarterBoxScores, detA, detB, 12345);
const again = buildShotLedger(detResult.quarterBoxScores, detA, detB, 12345);
const differentSeed = buildShotLedger(detResult.quarterBoxScores, detA, detB, 999);

add(
  "Points reconcile exactly, per player per quarter",
  worstPointDrift === 0,
  worstPointDrift === 0
    ? `${GAMES} games, no drift in any player-quarter`
    : `worst drift ${worstPointDrift} — ${driftExample}`
);
add(
  "Team totals match the engine's final score",
  teamDrift === 0,
  teamDrift === 0 ? `${GAMES * 2} team totals agree` : `${teamDrift} disagreed — ${teamExample}`
);
add(
  "A player who never shot threes never takes one",
  illegalThrees === 0,
  illegalThrees === 0 ? `${sampledShots} shots, none from a zero-attempt shooter` : `${illegalThrees} — ${illegalThreeExample}`
);
add(
  "Assists never exceed what the engine credited",
  assistOverflow === 0,
  assistOverflow === 0 ? "every passer within his own count" : `${assistOverflow} player-quarters over budget`
);
add("Nobody assists his own basket", selfAssists === 0, selfAssists === 0 ? "clean" : `${selfAssists} self-assists`);
add(
  "Rebounds, steals, blocks and turnovers appear exactly as credited",
  countingMismatch === 0,
  countingMismatch === 0 ? "counts match in every period" : `${countingMismatch} mismatches — ${countingExample}`
);
add(
  "Every field goal has a place on the floor",
  unplacedShots === 0 && offCourt === 0,
  unplacedShots === 0 && offCourt === 0
    ? `${sampledShots} shots, all inside the unit half-court`
    : `${unplacedShots} unplaced, ${offCourt} off the court`
);
add(
  "No shot is drawn somewhere that contradicts what it was",
  contradictedZone === 0,
  contradictedZone === 0
    ? "every three outside the arc, every two inside it, every corner in a corner"
    : `${contradictedZone} contradictions - ${contradictedExample}`
);
add(
  "The box score's shooting lines are the ledger's own, per player and per team",
  playerLineFaults === 0,
  playerLineFaults === 0
    ? `${sampledShots} shots folded per player over ${GAMES} games, every total reconciling with the team fold`
    : `${playerLineFaults} disagreements, e.g. ${playerLineExample}`
);
add(
  "The derived clock counts down and restarts each period",
  clockFaults === 0,
  clockFaults === 0 ? "monotonic within every period of every game" : `${clockFaults} faults - ${clockExample}`
);
add(
  "Every event can be said out loud in the feed",
  describeFaults === 0,
  describeFaults === 0 ? `${sampledEvents} events, all describable` : `${describeFaults} events with no caption`
);
add(
  "The live stat strip agrees with the ledger under it",
  liveStatFaults === 0,
  liveStatFaults === 0 ? "field goals and rebounds reconcile on both sides" : liveStatExample
);
add(
  "Zones are ordered and labelled, inside out",
  Object.keys(ZONES).every((z) => ZONES[z].label) &&
    Object.values(ZONES).filter((z) => z.points === 3).length === 3,
  `${Object.keys(ZONES).length} zones, 3 of them behind the arc, all labelled`
);
add(
  "The same seed replays the same ledger",
  JSON.stringify(first) === JSON.stringify(again),
  `${first.events.length} events, byte-identical on a second build`
);
add(
  "A different seed produces a different game",
  JSON.stringify(first) !== JSON.stringify(differentSeed),
  "who shoots, from which zone and in what order is seeded, not fixed"
);

console.log(renderSection(`NBA shot ledger vs the engine (${GAMES} games, ${sampledEvents} events)`));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
