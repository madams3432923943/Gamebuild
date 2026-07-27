// Simulation engine: quarter-by-quarter 5v5 positional matchup model.
//
// A "roster" here is: { PG, SG, SF, PF, C, "6TH" } where each value is a
// player record from data.js (see js/data.js for the shape).
//
// Order of operations per game (see simulateGame at the bottom):
//   1. Simulate 4 quarters independently (each an isolated matchup roll,
//      not game-total / 4) -> per-player per-quarter stat lines.
//   2. Roll quarters up into full-game per-player totals.
//   3. Apply turnover-margin point swing (real mechanical effect, not
//      additive noise) to the rolled-up totals.
//   4. Apply usage compression (stacked-roster scoring correction).
//   5. Apply the 1.55 combined scoring ceiling at the full-game level.
//   6. Resolve overtime if tied, then apply the absolute safety clamp.
//   7. Compute MVP via simplified game score on full-game totals.

import {
  STARTER_SLOTS,
  QUARTERS_PER_GAME,
  STARTER_MINUTES,
  SIXTH_MAN_SCALE,
  SCORING_K,
  REBOUND_K,
  ASSIST_K,
  TURNOVER_K,
  FACTOR_MIN,
  FACTOR_MAX,
  VARIANCE_MIN,
  VARIANCE_MAX,
  POSSESSION_VALUE,
  TOV_SWING_K,
  COMPRESSION_KEY,
  COMPRESSION_COEFFICIENT,
  COMPRESSION_FLOOR,
  SCORING_CEILING,
  MAX_TEAM_SCORE,
  MAX_OT_PERIODS,
  OT_LENGTH_SCALE,
} from "./constants.js";
import { tacticMods } from "./tactics.js";

const STAT_KEYS = ["ppg", "rpg", "apg", "spg", "bpg", "tov"];
const LINE_KEYS = ["pts", "reb", "ast", "stl", "blk", "tov"];
const STAT_TO_LINE = { ppg: "pts", rpg: "reb", apg: "ast", spg: "stl", bpg: "blk", tov: "tov" };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function randRange(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

/** Dataset-wide and per-position averages, used to normalize matchups so a
 * center's raw block numbers aren't compared on the same scale as a guard's. */
export function computeDatasetStats(players) {
  const overall = { ppg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0, tov: 0 };
  const byPos = {};
  for (const pos of STARTER_SLOTS) {
    byPos[pos] = { ppg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0, tov: 0, count: 0 };
  }

  for (const p of players) {
    for (const k of STAT_KEYS) overall[k] += p[k];
    for (const pos of p.pos) {
      if (!byPos[pos]) continue;
      for (const k of STAT_KEYS) byPos[pos][k] += p[k];
      byPos[pos].count += 1;
    }
  }

  const n = players.length || 1;
  for (const k of STAT_KEYS) overall[k] /= n;

  for (const pos of STARTER_SLOTS) {
    const bucket = byPos[pos];
    const count = bucket.count || 1;
    for (const k of STAT_KEYS) bucket[k] = bucket[k] / count || overall[k];
  }

  return { overall, byPos };
}

/** Simplified impact score: a stat-blend used for team-strength comparisons
 * and (optionally) usage compression. Not the same as MVP game score. */
export function impact(player) {
  return (
    player.ppg * 1.0 +
    player.rpg * 0.7 +
    player.apg * 0.7 +
    player.spg * 1.0 +
    player.bpg * 1.0 -
    player.tov * 0.5
  );
}

function rosterPlayers(roster) {
  return [...STARTER_SLOTS.map((s) => roster[s]), roster["6TH"]];
}

function minutesScaleFor(slot) {
  return slot === "6TH" ? SIXTH_MAN_SCALE : 1;
}

function posAvg(datasetStats, pos, key) {
  const bucket = datasetStats.byPos[pos];
  return (bucket && bucket[key]) || datasetStats.overall[key];
}

function ratingVsAvg(value, avg) {
  return avg > 0 ? value / avg : 1;
}

function matchupFactor(offRating, defRating, k) {
  return clamp(1 + k * (offRating - defRating), FACTOR_MIN, FACTOR_MAX);
}

/** Defender's primary position for matchup purposes (first listed position). */
function primaryPos(player) {
  return player.pos[0];
}

/** Simulate one quarter for both rosters. Returns per-slot per-line stat
 * objects for each team, e.g. { PG: {pts,reb,ast,stl,blk,tov}, ... }. */
function simulateQuarter(rosterA, rosterB, datasetStats, modsA, modsB) {
  const linesA = {};
  const linesB = {};

  for (const slot of STARTER_SLOTS) {
    const offA = rosterA[slot];
    const defB = rosterB[slot];
    const offB = rosterB[slot];
    const defA = rosterA[slot];

    linesA[slot] = simulatePlayerQuarter(offA, defB, slot, datasetStats, modsA, modsB);
    linesB[slot] = simulatePlayerQuarter(offB, defA, slot, datasetStats, modsB, modsA);
  }

  // 6th man: additive bonus production, not run through a 1-on-1 positional
  // matchup (true 5v5 covers the starters; the bench spot is a simple
  // fixed-minutes bonus this round - see build spec #7).
  linesA["6TH"] = simulateSixthManQuarter(rosterA["6TH"], modsA);
  linesB["6TH"] = simulateSixthManQuarter(rosterB["6TH"], modsB);

  return { linesA, linesB };
}

/** A player's stats as their tactic has them playing. Tactics have to be
 * folded in HERE, before matchups are computed, not applied to the finished
 * stat line: a defensive tactic has to actually suppress the opponent's
 * scoring, and it only can if the defender's steal/block ratings are already
 * boosted when the scoring matchup is evaluated. Scaling the output line
 * instead would inflate the steal column while the opponent scored exactly as
 * freely as before - defense that shows up in the box score and nowhere else. */
function effectiveStats(player, mods) {
  if (!mods) return player;
  return {
    ppg: player.ppg * mods.pts,
    rpg: player.rpg * mods.reb,
    apg: player.apg * mods.ast,
    spg: player.spg * mods.stl,
    bpg: player.bpg * mods.blk,
    tov: player.tov * mods.tov,
  };
}

function simulatePlayerQuarter(offPlayer, defPlayer, slot, datasetStats, offMods, defMods) {
  const scale = minutesScaleFor(slot) * (1 / QUARTERS_PER_GAME);
  const pos = primaryPos(offPlayer);
  const defPos = primaryPos(defPlayer);
  const off = effectiveStats(offPlayer, offMods);
  const def = effectiveStats(defPlayer, defMods);

  const offScoreRating = ratingVsAvg(off.ppg, posAvg(datasetStats, pos, "ppg"));
  const defScoreRating =
    (ratingVsAvg(def.bpg, posAvg(datasetStats, defPos, "bpg")) +
      ratingVsAvg(def.spg, posAvg(datasetStats, defPos, "spg"))) /
    2;
  const scoringFactor = matchupFactor(offScoreRating, defScoreRating, SCORING_K);

  const offRebRating = ratingVsAvg(off.rpg, posAvg(datasetStats, pos, "rpg"));
  const defRebRating = ratingVsAvg(def.rpg, posAvg(datasetStats, defPos, "rpg"));
  const reboundFactor = matchupFactor(offRebRating, defRebRating, REBOUND_K);

  const offAstRating = ratingVsAvg(off.apg, posAvg(datasetStats, pos, "apg"));
  const defDisruptRating = ratingVsAvg(def.spg, posAvg(datasetStats, defPos, "spg"));
  const assistFactor = matchupFactor(offAstRating, defDisruptRating, ASSIST_K);

  const defStealPressure = ratingVsAvg(def.spg, posAvg(datasetStats, defPos, "spg"));
  const turnoverFactor = matchupFactor(defStealPressure, 1, TURNOVER_K);

  return {
    pts: off.ppg * scale * scoringFactor * randRange(VARIANCE_MIN, VARIANCE_MAX),
    reb: off.rpg * scale * reboundFactor * randRange(VARIANCE_MIN, VARIANCE_MAX),
    ast: off.apg * scale * assistFactor * randRange(VARIANCE_MIN, VARIANCE_MAX),
    stl: off.spg * scale * randRange(VARIANCE_MIN, VARIANCE_MAX),
    blk: off.bpg * scale * randRange(VARIANCE_MIN, VARIANCE_MAX),
    tov: off.tov * scale * turnoverFactor * randRange(VARIANCE_MIN, VARIANCE_MAX),
  };
}

function simulateSixthManQuarter(rawPlayer, mods) {
  const scale = SIXTH_MAN_SCALE * (1 / QUARTERS_PER_GAME);
  const player = effectiveStats(rawPlayer, mods);
  return {
    pts: player.ppg * scale * randRange(VARIANCE_MIN, VARIANCE_MAX),
    reb: player.rpg * scale * randRange(VARIANCE_MIN, VARIANCE_MAX),
    ast: player.apg * scale * randRange(VARIANCE_MIN, VARIANCE_MAX),
    stl: player.spg * scale * randRange(VARIANCE_MIN, VARIANCE_MAX),
    blk: player.bpg * scale * randRange(VARIANCE_MIN, VARIANCE_MAX),
    tov: player.tov * scale * randRange(VARIANCE_MIN, VARIANCE_MAX),
  };
}

function emptyLine() {
  return { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0 };
}

function addLine(dst, src) {
  for (const k of LINE_KEYS) dst[k] += src[k];
  return dst;
}

function scaleLine(line, factor) {
  const out = {};
  for (const k of LINE_KEYS) out[k] = line[k] * factor;
  return out;
}

function rosterCombinedRawPpg(roster) {
  return rosterPlayers(roster).reduce((sum, p) => sum + p.ppg, 0);
}

function rosterCombinedImpact(roster) {
  return rosterPlayers(roster).reduce((sum, p) => sum + impact(p), 0);
}

function rosterBaselinePoints(roster) {
  // What the team would score if every player simply produced their raw
  // per-game PPG with no matchup/team modifiers - the denominator the
  // scoring ceiling multiplier is measured against.
  return STARTER_SLOTS.reduce((sum, slot) => sum + roster[slot].ppg, 0) + roster["6TH"].ppg * SIXTH_MAN_SCALE;
}

/** Runs quarters (or OT periods) and accumulates per-slot totals. lengthScale
 * of 1 = a full quarter; used at < 1 for shorter OT periods. */
function runPeriods(rosterA, rosterB, datasetStats, periods, lengthScale = 1, modsA, modsB) {
  const totalsA = {};
  const totalsB = {};
  for (const slot of [...STARTER_SLOTS, "6TH"]) {
    totalsA[slot] = emptyLine();
    totalsB[slot] = emptyLine();
  }
  const quarterBoxScores = [];

  for (let i = 0; i < periods; i++) {
    const { linesA, linesB } = simulateQuarter(rosterA, rosterB, datasetStats, modsA, modsB);
    const scaledA = {};
    const scaledB = {};
    for (const slot of [...STARTER_SLOTS, "6TH"]) {
      scaledA[slot] = scaleLine(linesA[slot], lengthScale);
      scaledB[slot] = scaleLine(linesB[slot], lengthScale);
      addLine(totalsA[slot], scaledA[slot]);
      addLine(totalsB[slot], scaledB[slot]);
    }
    quarterBoxScores.push({ a: scaledA, b: scaledB });
  }

  return { totalsA, totalsB, quarterBoxScores };
}

function sumTeamLine(totals, key) {
  return [...STARTER_SLOTS, "6TH"].reduce((sum, slot) => sum + totals[slot][key], 0);
}

/** Apply a multiplicative adjustment to every player's points, keeping the
 * box score internally consistent (player totals still sum to team total). */
function applyPointsMultiplier(totals, factor) {
  for (const slot of [...STARTER_SLOTS, "6TH"]) {
    totals[slot].pts *= factor;
  }
}

function roundLine(line) {
  const out = {};
  for (const k of LINE_KEYS) out[k] = Math.max(0, Math.round(line[k]));
  return out;
}

export function gameScore(line) {
  // Simplified Hollinger game score: the standard formula's FG/FTA terms
  // are dropped because this dataset intentionally has no shooting-attempt
  // data (see build spec #9 - shooting percentages are out of scope).
  return line.pts + 0.7 * line.reb + 0.7 * line.ast + line.stl + 0.7 * line.blk - line.tov;
}

/**
 * Simulates a full game between two rosters.
 *
 * @param {object} rosterA - { PG, SG, SF, PF, C, "6TH" }
 * @param {object} rosterB - same shape
 * @param {object} datasetStats - from computeDatasetStats()
 * @param {object} opts - { tacticA, tacticB }: tactic ids chosen before tip-off
 * @returns box score, quarter breakdown, final score, and MVP
 */
export function simulateGame(rosterA, rosterB, datasetStats, opts = {}) {
  const modsA = tacticMods(opts.tacticA);
  const modsB = tacticMods(opts.tacticB);
  let { totalsA, totalsB, quarterBoxScores } = runPeriods(
    rosterA,
    rosterB,
    datasetStats,
    QUARTERS_PER_GAME,
    1,
    modsA,
    modsB
  );

  applyTurnoverSwing(totalsA, totalsB);
  applyUsageCompression(totalsA, rosterA, datasetStats);
  applyUsageCompression(totalsB, rosterB, datasetStats);
  applyScoringCeiling(totalsA, rosterA);
  applyScoringCeiling(totalsB, rosterB);

  let otPeriods = 0;
  while (
    Math.round(sumTeamLine(totalsA, "pts")) === Math.round(sumTeamLine(totalsB, "pts")) &&
    otPeriods < MAX_OT_PERIODS
  ) {
    const ot = runPeriods(rosterA, rosterB, datasetStats, 1, OT_LENGTH_SCALE, modsA, modsB);
    for (const slot of [...STARTER_SLOTS, "6TH"]) {
      addLine(totalsA[slot], ot.totalsA[slot]);
      addLine(totalsB[slot], ot.totalsB[slot]);
    }
    quarterBoxScores.push(...ot.quarterBoxScores.map((q) => ({ ...q, overtime: true })));
    otPeriods += 1;
  }

  applyAbsoluteClamp(totalsA);
  applyAbsoluteClamp(totalsB);

  const boxA = {};
  const boxB = {};
  for (const slot of [...STARTER_SLOTS, "6TH"]) {
    boxA[slot] = roundLine(totalsA[slot]);
    boxB[slot] = roundLine(totalsB[slot]);
  }

  const teamScoreA = [...STARTER_SLOTS, "6TH"].reduce((s, slot) => s + boxA[slot].pts, 0);
  const teamScoreB = [...STARTER_SLOTS, "6TH"].reduce((s, slot) => s + boxB[slot].pts, 0);

  const mvp = pickMvp(rosterA, boxA, rosterB, boxB, teamScoreA > teamScoreB ? "A" : "B");

  return {
    teamScoreA,
    teamScoreB,
    boxA,
    boxB,
    quarterBoxScores,
    overtimePeriods: otPeriods,
    winner: teamScoreA === teamScoreB ? (rosterCombinedImpact(rosterA) >= rosterCombinedImpact(rosterB) ? "A" : "B") : teamScoreA > teamScoreB ? "A" : "B",
    mvp,
  };
}

function applyTurnoverSwing(totalsA, totalsB) {
  const tovA = sumTeamLine(totalsA, "tov");
  const tovB = sumTeamLine(totalsB, "tov");
  const margin = tovB - tovA; // positive => B turned it over more => A benefits
  const swingPoints = margin * POSSESSION_VALUE * TOV_SWING_K;
  const ptsA = sumTeamLine(totalsA, "pts");
  const ptsB = sumTeamLine(totalsB, "pts");

  if (ptsA > 0) applyPointsMultiplier(totalsA, clamp(1 + swingPoints / ptsA, 0.7, 1.3));
  if (ptsB > 0) applyPointsMultiplier(totalsB, clamp(1 - swingPoints / ptsB, 0.7, 1.3));
}

function applyUsageCompression(totals, roster, datasetStats) {
  const combinedRawPpg = rosterCombinedRawPpg(roster);
  const combinedImpact = rosterCombinedImpact(roster);
  const playerCount = STARTER_SLOTS.length + 1;

  const keyValue = COMPRESSION_KEY === "impact" ? combinedImpact : combinedRawPpg;
  const avgBaseline =
    COMPRESSION_KEY === "impact"
      ? playerCount * (datasetStats.overall.ppg * 1.0 + datasetStats.overall.rpg * 0.7 + datasetStats.overall.apg * 0.7 + datasetStats.overall.spg + datasetStats.overall.bpg - datasetStats.overall.tov * 0.5)
      : playerCount * datasetStats.overall.ppg;

  const excess = Math.max(0, keyValue - avgBaseline);
  const factor = clamp(1 - COMPRESSION_COEFFICIENT * excess, COMPRESSION_FLOOR, 1);
  applyPointsMultiplier(totals, factor);
}

function applyScoringCeiling(totals, roster) {
  const baseline = rosterBaselinePoints(roster);
  const actual = sumTeamLine(totals, "pts");
  if (baseline <= 0 || actual <= 0) return;
  const multiplier = actual / baseline;
  if (multiplier > SCORING_CEILING) {
    applyPointsMultiplier(totals, SCORING_CEILING / multiplier);
  }
}

function applyAbsoluteClamp(totals) {
  const actual = sumTeamLine(totals, "pts");
  if (actual > MAX_TEAM_SCORE) {
    applyPointsMultiplier(totals, MAX_TEAM_SCORE / actual);
  }
}

function pickMvp(rosterA, boxA, rosterB, boxB, winnerSide) {
  let best = null;
  for (const [roster, box, side] of [
    [rosterA, boxA, "A"],
    [rosterB, boxB, "B"],
  ]) {
    for (const slot of [...STARTER_SLOTS, "6TH"]) {
      const player = roster[slot];
      const line = box[slot];
      const score = gameScore(line);
      if (!best || score > best.score) {
        best = { player, line, side, slot, score };
      }
    }
  }
  return best;
}
