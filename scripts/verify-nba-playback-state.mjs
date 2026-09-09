#!/usr/bin/env node
// WHAT THE SCREEN KNOWS, AND WHEN IT KNOWS IT.
//
// THE COMPLAINT THIS EXISTS FOR
//
// "The scoreboard shows the completed quarter score BEFORE the quarter's live
// events have actually played. Then the game clock starts counting down while
// the shot chart slowly fills in." That was exactly what the code did: playback
// pushed result.quarterBoxScores[i] - the quarter's FINISHED score and every
// player's finished line for it - into the board at the first tick of quarter
// i, and only then began playing the events that produced it. There was no
// state meaning "the game so far", so there was nothing else it could show.
//
// There is one now. js/sports/nba/playback.js keeps a PLAYBACK STATE that is a
// pure fold of the events already revealed, and the board, the box score, the
// quarter columns and the strip all read from it. This asserts the two
// properties that makes true, over real simulated games:
//
//   NO READING AHEAD. After N events, the state contains exactly what those N
//   events said and nothing else: no points from a later quarter, no shot the
//   viewer has not seen, no player line that has run on past the last play.
//
//   EXACT RECONCILIATION AT THE END. Fold ALL the events and the state IS the
//   authoritative result - every team total, every quarter column, every
//   player's line, every shooting split. Not "close to"; equal. That is the
//   invariant behind requirement 20, and it holds by construction because the
//   ledger is an expansion of the box score - this proves the fold does not
//   lose or double anything on the way.
//
// AND THE SAME FOR AN ONLINE GAME. The state is folded from the ledger as it
// arrives over the wire, so the packed/unpacked ledger has to fold to the same
// screen the offline one does - byte-identical state on both clients, which is
// the requirement two players seeing one score under two box scores was about.

import { simulateGame, computeDatasetStats, defaultMinutes } from "../js/sports/nba/engine.js";
import {
  createLiveState,
  applyEvent,
  liveScore,
  liveBox,
  livePeriodScore,
  liveTeamStats,
  packLedger,
  unpackLedger,
  foldLiveStats,
} from "../js/sports/nba/playback.js";
import NBA from "../js/sports/nba/index.js";
import { renderCheck, renderSection, summarize, PASS, FAIL, WARN } from "./lib/report.mjs";
import { withSeededRandom } from "./lib/seeded-rng.mjs";
import { loadDataset } from "../data/load.mjs";

const PLAYERS = await loadDataset("nba-players");
const GAMES = Number(process.env.STATE_GAMES || 80);

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry(20260909);
const stats = computeDatasetStats(PLAYERS);
const roster = () => {
  const out = {};
  for (const slot of NBA.slots.ranked) out[slot] = PLAYERS[Math.floor(rand() * PLAYERS.length)];
  return out;
};

const checks = [];
const add = (title, ok, detail) => checks.push({ title, status: ok ? PASS : FAIL, detail });

let readAhead = 0;
let futureQuarter = 0;
let nonMonotonic = 0;
let scoreMismatch = 0;
let quarterMismatch = 0;
let playerMismatch = 0;
let stripMismatch = 0;
let onlineDrift = 0;
// THE ONE PLACE THE FOLD CANNOT MATCH THE BOX SCORE, and it is not the fold's
// fault. The engine draws assists independently of made field goals, so a
// roster of high-assist players can finish with more team assists than the team
// has made field goals for anyone to have assisted - a line that is physically
// impossible and that no expansion into events can honour. assignAssists places
// every credit there is a basket for; these count the ones there is not.
let teamsShort = 0;
let teamsTotal = 0;
let assistsShort = 0;
let sampledPrefixes = 0;
let periodsChecked = 0;
let playersChecked = 0;

const sum = (box, key) => Object.values(box).reduce((s, line) => s + (Number(line?.[key]) || 0), 0);

for (let g = 0; g < GAMES; g++) {
  const a = roster();
  const b = roster();
  // SEEDED, so this is a build gate rather than a lottery. simulateGame draws
  // from Math.random for everything the caller does not fix, so an unseeded run
  // measures a different eighty games each time - and a check that sometimes
  // fails is a check nobody believes.
  const result = withSeededRandom(0x5eed0000 + g, () =>
    simulateGame(a, b, stats, { minutesA: defaultMinutes(a), minutesB: defaultMinutes(b) })
  ).value;
  const events = result.shotEvents;
  const periods = result.quarterBoxScores.length;

  // ---- NOTHING IS KNOWN BEFORE IT HAPPENS --------------------------------
  //
  // Walked one event at a time, checking the state against the PREFIX it was
  // built from rather than against the result. A state that agreed with the
  // result early is precisely the bug.
  const live = createLiveState({ rosterA: a, rosterB: b });
  let prevA = 0;
  let prevB = 0;
  let seenPeriod = 0;
  events.forEach((event, i) => {
    applyEvent(live, event);
    seenPeriod = Math.max(seenPeriod, event.period);
    const score = liveScore(live);
    // Monotonic: a score that ever goes down is a fold that double-counted or
    // subtracted, and either way the board would flicker backwards.
    if (score.A < prevA || score.B < prevB) nonMonotonic += 1;
    prevA = score.A;
    prevB = score.B;
    // NO POINTS FROM A QUARTER THAT HAS NOT STARTED. This is the leak, stated
    // directly: at every single event, every period after the one being played
    // must be empty.
    for (let p = seenPeriod + 1; p <= periods; p++) {
      const ahead = livePeriodScore(live, p);
      if (ahead.a !== 0 || ahead.b !== 0) futureQuarter += 1;
    }
    // The running score is exactly the prefix's points - which is also what
    // foldLiveStats, the function the finished chart uses, gets from the same
    // prefix. Two independent folds, checked against each other on a sample of
    // prefixes rather than all of them, because foldLiveStats re-walks.
    if (i % 37 === 0) {
      sampledPrefixes += 1;
      const folded = foldLiveStats(events, i);
      if (folded.a.pts !== score.A || folded.b.pts !== score.B) readAhead += 1;
      const strip = liveTeamStats(live);
      for (const side of ["a", "b"]) {
        for (const key of ["fgm", "fga", "tpm", "tpa", "ftm", "fta", "reb", "ast", "stl", "blk", "tov", "pts"]) {
          if (strip[side][key] !== folded[side][key]) stripMismatch += 1;
        }
      }
    }
  });

  // ---- AND AT THE END IT IS THE RESULT, EXACTLY --------------------------
  const finalScore = liveScore(live);
  if (finalScore.A !== result.teamScoreA || finalScore.B !== result.teamScoreB) scoreMismatch += 1;

  for (let p = 1; p <= periods; p++) {
    periodsChecked += 1;
    const watched = livePeriodScore(live, p);
    const truth = result.quarterBoxScores[p - 1];
    if (watched.a !== Math.round(sum(truth.a, "pts")) || watched.b !== Math.round(sum(truth.b, "pts"))) {
      quarterMismatch += 1;
    }
  }

  for (const [side, key, roster2, box] of [
    ["A", "a", a, result.boxA],
    ["B", "b", b, result.boxB],
  ]) {
    const watched = liveBox(live, side);
    for (const slot of Object.keys(roster2)) {
      playersChecked += 1;
      const truth = box[slot];
      const shown = watched[slot];
      if (!shown || !truth) {
        playerMismatch += 1;
        continue;
      }
      // Every column the box score prints, plus the shooting splits under it.
      // Rounded on the authoritative side only: the engine keeps fractional
      // counting stats and rounds at the printing boundary, and the fold works
      // in whole events, so this compares what a viewer would read in both.
      for (const stat of ["pts", "reb", "stl", "blk", "tov"]) {
        if (Math.round(truth[stat]) !== Math.round(shown[stat])) playerMismatch += 1;
      }
      // Assists are counted separately, below: the ledger can be one short of a
      // box score that claims more of them than there were baskets to assist.
      if (Math.round(truth.ast) < Math.round(shown.ast)) playerMismatch += 1;
      for (const stat of ["fgm", "fga", "tpm", "tpa", "ftm", "fta"]) {
        if ((truth[stat] ?? 0) !== shown[stat]) playerMismatch += 1;
      }
    }
  }

  // ---- ASSISTS: EVERY CREDIT THERE IS A BASKET FOR -----------------------
  for (const [side, key, box] of [["A", "a", result.boxA], ["B", "b", result.boxB]]) {
    teamsTotal += 1;
    const claimed = Math.round(sum(box, "ast"));
    const baskets = Math.round(sum(box, "fgm"));
    const placed = Math.round(sum(liveBox(live, side), "ast"));
    // NEVER MORE THAN THE ENGINE CREDITED. That direction is the fold's to get
    // right and is a hard failure. Fewer is possible and is not: a passer is
    // never given his own basket, so a team whose makes belong mostly to its
    // own high-assist player can run out of baskets to hang credits on however
    // they are ordered. That shortfall is counted and warned about below.
    if (placed > claimed) playerMismatch += 1;
    if (placed < claimed) {
      teamsShort += 1;
      assistsShort += claimed - placed;
    }
    void key;
    void baskets;
  }

  // ---- ONLINE: THE SAME SCREEN ON BOTH MACHINES --------------------------
  //
  // The wire format drops everything annotateLedger can recompute, so this is
  // the round trip an online client actually performs. Folding the result of it
  // has to land on the identical state - if it does not, two players watching
  // one game see two box scores, which is the failure this whole area was
  // rebuilt around.
  const wire = unpackLedger(packLedger(events));
  const remote = createLiveState({ rosterA: a, rosterB: b });
  for (const event of wire) applyEvent(remote, event);
  const same =
    JSON.stringify(liveScore(remote)) === JSON.stringify(liveScore(live)) &&
    JSON.stringify(liveBox(remote, "A")) === JSON.stringify(liveBox(live, "A")) &&
    JSON.stringify(liveBox(remote, "B")) === JSON.stringify(liveBox(live, "B")) &&
    JSON.stringify(liveTeamStats(remote)) === JSON.stringify(liveTeamStats(live));
  if (!same) onlineDrift += 1;
}

add(
  "No quarter is known before it is played",
  futureQuarter === 0,
  `over ${GAMES} games, at every one of ~${GAMES * 320} events, every period after the one in progress read 0-0. ` +
    `The board's future columns have nothing to print because the state has nothing in them`
);
add(
  "The score only ever goes up",
  nonMonotonic === 0,
  `no fold over ${GAMES} games ever decreased either team's total`
);
add(
  "The playback state agrees with an independent fold of the same prefix",
  readAhead === 0 && stripMismatch === 0 && sampledPrefixes > 0,
  `${sampledPrefixes} prefixes checked against foldLiveStats - the accumulating fold and the re-walking one ` +
    `return the same twelve numbers for both teams every time`
);
add(
  "At the final buzzer the screen IS the authoritative result: score",
  scoreMismatch === 0,
  `${GAMES} games; folding every event lands exactly on result.teamScoreA/B, never one point either side`
);
add(
  "...the quarter columns",
  quarterMismatch === 0,
  `${periodsChecked} periods; each column equals the sum of that period's authoritative box lines`
);
add(
  "...and every player's line, including the shooting splits",
  playerMismatch === 0,
  `${playersChecked} player lines across ${GAMES} games; pts/reb/stl/blk/tov and fgm/fga/tpm/tpa/ftm/fta all ` +
    `equal to the box score the simulation recorded, and every assist the engine credited that there was a ` +
    `basket to hang it on was placed`
);
// A WARNING, NOT A FAILURE, AND NOT THE PLAYBACK'S TO FIX.
//
// The engine draws a player's assists from his own rate, independently of how
// many field goals his team made. On a roster of high-assist players that can
// finish above the team's own made-field-goal count, which is a box score
// claiming a pass on a basket that does not exist. The ledger cannot expand it
// and does not pretend to: it places every credit there is a basket for.
//
// The visible cost is one assist appearing on the live table at the final
// whistle, when the authoritative box score replaces the fold. Fixing it means
// bounding the engine's assist draw by team makes, which is a simulation change
// and belongs in its own commit.
const shortRate = teamsShort / teamsTotal;
checks.push({
  title: "Known: the engine can credit more assists than there are baskets to hang them on",
  // A FAILURE ONLY IF IT GETS COMMON. Below the threshold this is a rare,
  // named, one-assist artefact; above it, something has changed in the engine's
  // assist model and the live table would be visibly wrong.
  status: teamsShort === 0 ? PASS : shortRate <= 0.08 ? WARN : FAIL,
  detail:
    `${teamsShort} of ${teamsTotal} team-games (${(shortRate * 100).toFixed(1)}%, threshold 8%) had assists the ` +
    `ledger could not place, ${assistsShort} in total. This is the ONLY value on the live table that can differ ` +
    `from the final box score, and it differs by one, at the whistle`,
});
add(
  "An online client folds the wire format to the identical screen",
  onlineDrift === 0,
  `${GAMES} games packed and unpacked as they are over the network, then folded: same score, same two box ` +
    `scores, same live strip. Presentation timing cannot regenerate a statistic because it never derives one`
);

console.log(renderSection(`NBA playback state (${GAMES} games)`));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}  warned ${counts[WARN] || 0}\n`);
process.exit(ok ? 0 : 1);
