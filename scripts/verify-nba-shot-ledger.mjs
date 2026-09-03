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
import { buildShotLedger } from "../js/sports/nba/playback.js";
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

  // ---- steals, blocks and turnovers appear exactly as credited ------------
  result.quarterBoxScores.forEach((period, i) => {
    for (const side of ["a", "b"]) {
      for (const [stat, type] of [["stl", "steal"], ["blk", "block"], ["tov", "turnover"]]) {
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
  "Steals, blocks and turnovers appear exactly as credited",
  countingMismatch === 0,
  countingMismatch === 0 ? "counts match in every period" : `${countingMismatch} mismatches — ${countingExample}`
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
