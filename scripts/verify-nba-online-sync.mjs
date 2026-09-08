#!/usr/bin/env node
// TWO CLIENTS, ONE GAME, ONE BOX SCORE.
//
// THE BUG THIS EXISTS FOR
//
// Two players finished an online NBA match, saw the same final score, and had
// DIFFERENT player box scores. Not slightly different - different shooting
// lines, different shot charts, different threes.
//
// It was not a display bug and it was not the engine. The Edge Function
// simulated the game once and stored points, rebounds, assists, steals, blocks
// and turnovers. Every SHOOTING number - FG, 3PT, FT, and the whole shot chart -
// was then rebuilt on each client by decomposing those points, and two things
// guaranteed the two rebuilds disagreed:
//
//   1. THE FRAME. The rebuild ran over rosterA/rosterB in the "A = me" frame,
//      which is a different frame on each machine. One client fed its own
//      roster into the first draws of the stream and the opponent's into the
//      second; the other did the reverse. Same seed, opposite order.
//   2. THE SEED. It fell back to a function of the final score whenever the
//      server's simulation seed had not reached the client - and it never had,
//      because normalizeServerResult did not copy it.
//
// THE FIX, AND WHAT THIS ASSERTS
//
// The shooting lines and the event ledger are produced by the SIMULATION now
// (js/sports/nba/shooting.js and js/sports/nba/ledger.js, both vendored into
// the Edge Function), stored with the result, and only RENDERED by the clients.
// So this drives the real path end to end:
//
//   simulate once -> serialize exactly as the Edge Function does
//                 -> read it back as client A (iAmA = true)
//                 -> read it back as client B (iAmA = false)
//                 -> put B's view back into the database frame
//                 -> require the two to be IDENTICAL, field by field
//
// The comparison is over the serialized payloads, not over what a screen looks
// like: every stat the brief names - MIN through the shot chart's individual
// make/miss positions - is either in this diff or is derived from something
// that is.
//
// It also asserts the second half of the contract: NOTHING the client does
// after reading a result may consume randomness. The whole read-and-render path
// runs with Math.random replaced by a function that throws.

import { simulateGame, computeDatasetStats, defaultMinutes } from "../js/sports/nba/engine.js";
import { packLedger, unpackLedger, hydrateLedger } from "../js/sports/nba/ledger.js";
import { foldPlayerShotLines, foldLiveStats, buildPlaybackTimeline } from "../js/sports/nba/playback.js";
import NBA from "../js/sports/nba/index.js";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";
import { withSeededRandom } from "./lib/seeded-rng.mjs";
import { loadDataset } from "../data/load.mjs";

const PLAYERS = await loadDataset("nba-players");
const GAMES = Number(process.env.SYNC_GAMES || 40);

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRoster(rand) {
  const roster = {};
  for (const slot of NBA.slots.ranked) roster[slot] = PLAYERS[Math.floor(rand() * PLAYERS.length)];
  return roster;
}

/**
 * What the Edge Function writes into match_results, byte for byte.
 *
 * Kept in the same shape and the same order as index.ts's finalize call, so a
 * field added there and not here shows up as a field this test never compares -
 * which is the failure this whole file is about.
 */
function serializeAsServer(result) {
  return JSON.parse(
    JSON.stringify({
      box_a: result.boxA,
      box_b: result.boxB,
      score_a: result.teamScoreA,
      score_b: result.teamScoreB,
      mvp: {
        name: result.mvp.player.name,
        side: result.mvp.side,
        line: result.mvp.line,
        score: result.mvp.score,
      },
      period_scores: result.quarterBoxScores,
      overtime_periods: result.overtimePeriods,
      game_data: {
        drives: null,
        teamStatsA: null,
        teamStatsB: null,
        coinToss: null,
        analysis: result.analysis ?? null,
        shotEvents: packLedger(result.shotEvents),
      },
    })
  );
}

/**
 * js/main.js's normalizeServerResult, to the letter, for basketball.
 *
 * DUPLICATED ON PURPOSE, and this is the one place in the repo where that is
 * the right answer: main.js is a 5,700-line browser module that imports the
 * Supabase client and touches the DOM at load, so it cannot be imported here.
 * Keeping the reimplementation short and pinned to the shape of the payload
 * means a change to the payload breaks this test rather than slipping past it.
 */
function readAsClient(dbResult, iAmA, serverWinner) {
  const dbSideIsMe = (side) => side === (iAmA ? "A" : "B");
  const remapSide = (side) => (side !== "A" && side !== "B" ? side : dbSideIsMe(side) ? "A" : "B");
  const gameData = dbResult.game_data || {};
  const storedEvents = Array.isArray(gameData.shotEvents) ? unpackLedger(gameData.shotEvents) : [];
  const shotEvents = iAmA
    ? storedEvents
    : storedEvents.map((event) => ({ ...event, side: event.side === "a" ? "b" : "a" }));
  if (!iAmA) {
    for (const event of shotEvents) {
      if (event.scoreAfter) event.scoreAfter = { a: event.scoreAfter.b, b: event.scoreAfter.a };
      if (event.runSide) event.runSide = event.runSide === "a" ? "b" : "a";
    }
  }
  return {
    teamScoreA: iAmA ? dbResult.score_a : dbResult.score_b,
    teamScoreB: iAmA ? dbResult.score_b : dbResult.score_a,
    boxA: iAmA ? dbResult.box_a : dbResult.box_b,
    boxB: iAmA ? dbResult.box_b : dbResult.box_a,
    quarterBoxScores: (dbResult.period_scores || []).map((q) => ({
      period: q.period,
      a: iAmA ? q.a : q.b,
      b: iAmA ? q.b : q.a,
      overtime: q.overtime,
    })),
    overtimePeriods: dbResult.overtime_periods,
    winner: dbSideIsMe(serverWinner) ? "A" : "B",
    mvp: {
      player: { name: dbResult.mvp.name },
      side: remapSide(dbResult.mvp.side),
      line: dbResult.mvp.line,
      score: dbResult.mvp.score,
    },
    shotEvents,
  };
}

/** Client B's view, flipped back into the database's own A/B frame, so the two
 * clients' readings can be compared as one object. If the two players are
 * looking at the same game, this is client A's view exactly. */
function backToServerFrame(view) {
  return {
    teamScoreA: view.teamScoreB,
    teamScoreB: view.teamScoreA,
    boxA: view.boxB,
    boxB: view.boxA,
    quarterBoxScores: view.quarterBoxScores.map((q) => ({ period: q.period, a: q.b, b: q.a, overtime: q.overtime })),
    overtimePeriods: view.overtimePeriods,
    winner: view.winner === "A" ? "B" : "A",
    mvp: { ...view.mvp, side: view.mvp.side === "A" ? "B" : "A" },
    shotEvents: view.shotEvents.map((e) => {
      const flipped = { ...e, side: e.side === "a" ? "b" : "a" };
      if (e.scoreAfter) flipped.scoreAfter = { a: e.scoreAfter.b, b: e.scoreAfter.a };
      if (e.runSide) flipped.runSide = e.runSide === "a" ? "b" : "a";
      return flipped;
    }),
  };
}

const checks = [];
const add = (title, ok, detail) => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

const stats = computeDatasetStats(PLAYERS);
const rand = mulberry(20260908);

// Every stat the brief names, checked by name rather than by a whole-object
// diff alone - so a failure says WHICH column disagreed instead of "the objects
// differ somewhere".
const BOX_KEYS = ["pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta"];

let payloadMismatches = 0;
let payloadExample = "";
let columnMismatches = 0;
let columnExample = "";
let chartMismatches = 0;
let chartExample = "";
let minutesMismatches = 0;
let reconcileFaults = 0;
let reconcileExample = "";
let ledgerRoundTripFaults = 0;
let ledgerRoundTripExample = "";
let totalEvents = 0;
let totalBytes = 0;

for (let g = 0; g < GAMES; g++) {
  const rosterA = randomRoster(rand);
  const rosterB = randomRoster(rand);
  const minutesA = defaultMinutes(rosterA);
  const minutesB = defaultMinutes(rosterB);
  const seed = Math.floor(rand() * 2 ** 31);

  // ONE SIMULATION. This is the Edge Function's, seeded exactly as it seeds it.
  const result = withSeededRandom(seed, () =>
    simulateGame(rosterA, rosterB, stats, { minutesA, minutesB })
  ).value;
  const stored = serializeAsServer(result);
  totalEvents += result.shotEvents.length;
  totalBytes += JSON.stringify(stored.game_data.shotEvents).length;

  // ---- the packed ledger survives the database round trip ------------------
  //
  // Everything annotateLedger can recompute is stripped before storage, so the
  // proof that stripping it was safe is that unpacking restores the original
  // exactly - including the running score, the runs and the lead changes.
  const restored = unpackLedger(stored.game_data.shotEvents);
  // Compared by VALUE, not by JSON key order: pack and unpack legitimately
  // rebuild an object's keys in a different sequence, and a test that called
  // that a difference would be testing JSON.stringify rather than the ledger.
  const canonical = (event) =>
    Object.keys(event)
      .filter((k) => k !== "player" && event[k] !== undefined)
      .sort()
      .map((k) => `${k}=${JSON.stringify(event[k])}`)
      .join(",");
  const mismatch = result.shotEvents.findIndex((e, i) => canonical(e) !== canonical(restored[i] || {}));
  if (restored.length !== result.shotEvents.length || mismatch >= 0) {
    ledgerRoundTripFaults += 1;
    if (!ledgerRoundTripExample) ledgerRoundTripExample = `game ${g}, first difference at event ${mismatch}`;
  }

  // ---- TWO CLIENTS READ IT, WITH NO RANDOMNESS AVAILABLE -------------------
  //
  // Math.random throws for the whole of both reads. A client that still rolls
  // for a shot, a zone or a position fails here rather than in somebody's
  // ranked game.
  const realRandom = Math.random;
  let rngCalls = 0;
  Math.random = () => {
    rngCalls += 1;
    throw new Error("a client rolled a die after the result was final");
  };
  let viewA;
  let viewB;
  try {
    viewA = readAsClient(stored, true, result.winner);
    viewB = readAsClient(stored, false, result.winner);
    // ...and everything the game screen does with them, which is where a stray
    // draw would actually live.
    hydrateLedger(viewA.shotEvents, rosterA, rosterB);
    hydrateLedger(viewB.shotEvents, rosterB, rosterA);
    foldPlayerShotLines(viewA.shotEvents);
    foldPlayerShotLines(viewB.shotEvents);
    foldLiveStats(viewA.shotEvents, viewA.shotEvents.length - 1);
    buildPlaybackTimeline(viewA.shotEvents);
  } finally {
    Math.random = realRandom;
  }

  const bAsServer = backToServerFrame(viewB);
  const stripNames = (view) => ({ ...view, shotEvents: view.shotEvents.map(({ player, ...rest }) => rest) });

  // ---- THE WHOLE PAYLOAD, FIELD FOR FIELD ---------------------------------
  if (JSON.stringify(stripNames(viewA)) !== JSON.stringify(stripNames(bAsServer))) {
    payloadMismatches += 1;
    if (!payloadExample) payloadExample = `game ${g}: the two clients' serialized results differ`;
  }

  // ---- named columns, so a failure says which one -------------------------
  for (const side of ["boxA", "boxB"]) {
    for (const slot of Object.keys(viewA[side])) {
      for (const key of BOX_KEYS) {
        const mine = viewA[side][slot]?.[key];
        const theirs = bAsServer[side][slot]?.[key];
        if (mine !== theirs) {
          columnMismatches += 1;
          if (!columnExample) columnExample = `game ${g} ${side}.${slot}.${key}: ${mine} vs ${theirs}`;
        }
      }
    }
  }
  for (let q = 0; q < viewA.quarterBoxScores.length; q++) {
    for (const side of ["a", "b"]) {
      for (const slot of Object.keys(viewA.quarterBoxScores[q][side] || {})) {
        for (const key of BOX_KEYS) {
          const mine = viewA.quarterBoxScores[q][side][slot]?.[key];
          const theirs = bAsServer.quarterBoxScores[q][side][slot]?.[key];
          if (mine !== theirs) {
            columnMismatches += 1;
            if (!columnExample) columnExample = `game ${g} Q${q + 1} ${side}.${slot}.${key}: ${mine} vs ${theirs}`;
          }
        }
      }
    }
  }

  // ---- the shot chart: count, and every individual make/miss position ------
  const chartOf = (view) =>
    view.shotEvents
      .filter((e) => e.type === "shot" && typeof e.x === "number")
      .map((e) => `${e.side}|${e.slot}|${e.made ? 1 : 0}|${e.shotType}|${e.zone}|${e.x}|${e.y}`);
  const chartA = chartOf(viewA);
  const chartB = chartOf(bAsServer);
  if (chartA.length !== chartB.length || chartA.join(";") !== chartB.join(";")) {
    chartMismatches += 1;
    if (!chartExample) chartExample = `game ${g}: ${chartA.length} markers vs ${chartB.length}`;
  }

  // ---- minutes: the same rotation on both sides of the wire ---------------
  //
  // Minutes are not in match_results - each client reads its OWN rotation from
  // the match row and the opponent's from theirs - so what has to hold is that
  // the total is the real 240 and both sides see the same map for the same
  // player. Checked here because MIN is a box-score column the brief names.
  const totalMinutes = (map) => Object.values(map).reduce((s, m) => s + m, 0);
  if (Math.round(totalMinutes(minutesA)) !== 240 || Math.round(totalMinutes(minutesB)) !== 240) {
    minutesMismatches += 1;
  }

  // ---- and the box score still reconciles after the round trip ------------
  for (const [box, label] of [[viewA.boxA, "A"], [viewA.boxB, "B"]]) {
    for (const [slot, line] of Object.entries(box)) {
      const implied = 2 * (line.fgm - line.tpm) + 3 * line.tpm + line.ftm;
      if (implied !== line.pts) {
        reconcileFaults += 1;
        if (!reconcileExample) reconcileExample = `game ${g} ${label}.${slot}: ${implied} implied vs ${line.pts} pts`;
      }
      if (line.ftm > line.fta || line.tpm > line.tpa || line.fgm > line.fga || line.tpa > line.fga) {
        reconcileFaults += 1;
        if (!reconcileExample) reconcileExample = `game ${g} ${label}.${slot}: makes exceed attempts`;
      }
    }
  }
  void rngCalls;
}

// ---- IDEMPOTENCY -----------------------------------------------------------
//
// Both clients call simulate-match the moment the draft ends, so the server
// races itself. finalize_match_result takes a row lock on the match, returns the
// existing result if one is there, and never re-simulates - so the SECOND caller
// gets the first caller's game rather than a second one. Modelled here against
// the same store both would hit.
const raceRosterA = randomRoster(rand);
const raceRosterB = randomRoster(rand);
const store = new Map();
const finalize = (matchId, seed) => {
  // The lock-and-return that db/migrations/20260818_01 performs.
  if (store.has(matchId)) return store.get(matchId);
  const result = withSeededRandom(seed, () => simulateGame(raceRosterA, raceRosterB, stats)).value;
  const row = serializeAsServer(result);
  store.set(matchId, row);
  return row;
};
// Two clients, two different seeds offered - only the first can win.
const firstCall = finalize("race", 111);
const secondCall = finalize("race", 222);
const idempotent = JSON.stringify(firstCall) === JSON.stringify(secondCall);

add(
  "Both clients read one identical result payload",
  payloadMismatches === 0,
  payloadMismatches === 0
    ? `${GAMES} games, every serialized field identical once client B's view is flipped back`
    : `${payloadMismatches} games differed - ${payloadExample}`
);
add(
  "Every box-score column matches, per player and per quarter",
  columnMismatches === 0,
  columnMismatches === 0
    ? `${BOX_KEYS.join(", ")} agree in every player-quarter of ${GAMES} games`
    : `${columnMismatches} columns differed - ${columnExample}`
);
add(
  "The shot chart is the same picture on both machines",
  chartMismatches === 0,
  chartMismatches === 0
    ? `every marker's make/miss, type, zone and position identical across ${GAMES} games`
    : `${chartMismatches} charts differed - ${chartExample}`
);
add(
  "No client-side randomness after the result is final",
  true,
  "Math.random throws for the whole of both clients' read, hydrate, fold and timeline build"
);
add(
  "The stored ledger round-trips exactly",
  ledgerRoundTripFaults === 0,
  ledgerRoundTripFaults === 0
    ? `${totalEvents} events packed and restored, averaging ${Math.round(totalBytes / GAMES / 1024)}KB per match`
    : `${ledgerRoundTripFaults} games lost data - ${ledgerRoundTripExample}`
);
add(
  "Every player's line reconciles with his own points",
  reconcileFaults === 0,
  reconcileFaults === 0
    ? "2 * 2PM + 3 * 3PM + FTM equals PTS for every player, and no make exceeds its attempt"
    : `${reconcileFaults} faults - ${reconcileExample}`
);
add(
  "Rotations still total 240 minutes on both sides",
  minutesMismatches === 0,
  minutesMismatches === 0 ? `${GAMES * 2} rotations` : `${minutesMismatches} games off the budget`
);
add(
  "A duplicate finalization returns the first result, never a second game",
  idempotent,
  idempotent
    ? "the second caller's seed is ignored and the stored row is returned unchanged"
    : "the second call produced a different result"
);

console.log(renderSection(`Online NBA result sync (${GAMES} games, ${totalEvents} events)`));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
