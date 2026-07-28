// Simulation engine: quarter-by-quarter positional matchup model.
//
// A "roster" maps slot -> player record (see js/data.js for the shape). Slot
// sets vary by mode and nothing here may assume one:
//   Quick Play      { PG, SG, SF, PF, C }
//   Ranked          { PG..C, BENCH1..BENCH5 }  - bench spots are open, and
//                   each is assigned to a position by slotsByPosition()
//   legacy / online { PG..C, "6TH" }           - 6th man, no matchup
//
// Everyone assigned to a position shares that position's 48 minutes and its
// matchup against the opponent's players there. A position covered by one
// player has to run him all 48, and fatigueFactor() charges him for it -
// that is what makes bench depth worth drafting.
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
  basePosition,
  isBenchSlot,
  orderedRosterSlots,
  FATIGUE_MINUTES,
  FATIGUE_PER_MINUTE,
  FATIGUE_MAX_PENALTY,
  POSITION_MINUTES,
  QUARTERS_PER_GAME,
  STARTER_MINUTES,
  SIXTH_MAN_SCALE,
  RANKED_STARTER_MINUTES,
  RANKED_BACKUP_MINUTES,
  SCORING_K,
  REBOUND_K,
  ASSIST_K,
  TURNOVER_K,
  FACTOR_MIN,
  FACTOR_MAX,
  VARIANCE_MIN,
  VARIANCE_MAX,
  TEAM_QUARTER_VARIANCE_MIN,
  TEAM_QUARTER_VARIANCE_MAX,
  TALENT_PARITY,
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
import { tacticMods, tacticClutchMods } from "./tactics.js";

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
  return activeSlots(roster).map((s) => roster[s]);
}

/** The slots this roster actually has a player in, in canonical lineup order.
 * Roster shape varies by mode - Quick Play drafts 5, the legacy/online path 6
 * (with a "6TH"), and Ranked 10 (two per position) - so every loop over "the
 * slots in play" derives them from the roster rather than assuming a shape.
 *
 * Sorting matters: a roster's own key order is DRAFT order, so reading it
 * straight off the object would print box scores as SF1, PG2, C1... Sorted by
 * position then depth, every mode reads top-to-bottom like a lineup card,
 * with the 6th man last. */
export function activeSlots(roster) {
  return orderedRosterSlots(roster);
}

/** Groups a roster's slots by the position they play, so everyone at a
 * position shares one matchup against the opponent's players there.
 *
 * Position-locked slots go where their name says. Bench slots have no fixed
 * position, so each is assigned to whichever position it can play that has
 * the fewest bodies so far - which is what makes depth and versatility pay:
 * a player listed at two positions can plug whichever gap exists, while five
 * centers on the bench all pile onto C and leave the other four starters
 * playing the whole game (see the fatigue penalty in applyFatigue).
 *
 * "6TH" is excluded - it has no position and is handled as an unmatched
 * bench bonus in the legacy 6-man roster. */
export function slotsByPosition(roster) {
  const groups = {};
  const bench = [];

  for (const slot of activeSlots(roster)) {
    if (slot === "6TH") continue;
    if (isBenchSlot(slot)) {
      bench.push(slot);
      continue;
    }
    (groups[basePosition(slot)] ||= []).push(slot);
  }

  // Assign the least flexible bench players first: someone who can only play
  // center has no choice, while a guard listed at two spots should be left
  // free to cover whatever is still thin once the specialists are placed.
  const ordered = [...bench].sort((a, b) => roster[a].pos.length - roster[b].pos.length);
  for (const slot of ordered) {
    const canPlay = roster[slot].pos.filter((p) => STARTER_SLOTS.includes(p));
    const options = canPlay.length > 0 ? canPlay : STARTER_SLOTS;
    const target = options.reduce((thinnest, pos) =>
      (groups[pos] || []).length < (groups[thinnest] || []).length ? pos : thinnest
    );
    (groups[target] ||= []).push(slot);
  }

  return groups;
}

/** The rotation a roster gets when nobody set one: each position's 48
 * minutes split across whoever actually covers it. This has to know the
 * position grouping, so it cannot be derived per-slot - with an open bench a
 * position may have one player or three, and guessing per-slot totalled 280
 * minutes against a real team's 240, inflating every stat by a fifth.
 *
 * Shared with the rotation screen (main.js) so an untouched rotation
 * simulates identically to no rotation at all. */
export function defaultMinutes(roster) {
  const minutes = {};
  const groups = slotsByPosition(roster);
  const grouped = new Set();

  for (const group of Object.values(groups)) {
    let left = POSITION_MINUTES;
    group.forEach((slot, i) => {
      const share =
        i === group.length - 1
          ? left
          : group.length === 2
          ? RANKED_STARTER_MINUTES
          : Math.round(POSITION_MINUTES / group.length);
      minutes[slot] = Math.max(0, share);
      left -= minutes[slot];
      grouped.add(slot);
    });
  }

  // Whatever the grouping doesn't cover (the legacy 6th man) keeps its own
  // fixed allocation.
  for (const slot of activeSlots(roster)) {
    if (grouped.has(slot)) continue;
    minutes[slot] = slot === "6TH" ? SIXTH_MAN_SCALE * STARTER_MINUTES : STARTER_MINUTES;
  }
  return minutes;
}

/** Minutes lost to tiring. A position with nobody behind its starter has to
 * run him the full 48, and he gives production back for it - which is the
 * mechanism that makes bench depth worth drafting rather than a formality.
 * Returns a multiplier at or below 1. */
function fatigueFactor(minutes) {
  if (!Number.isFinite(minutes) || minutes <= FATIGUE_MINUTES) return 1;
  const over = minutes - FATIGUE_MINUTES;
  return 1 - Math.min(FATIGUE_MAX_PENALTY, over * FATIGUE_PER_MINUTE);
}

/** The defense a position actually faces, as a minutes-weighted blend of the
 * opponent's players there. Facing a great defender for 12 minutes should not
 * play the same as facing him for 40, and with two players per position there
 * is no longer a single obvious defender to point at. Weights fall back to
 * equal shares when no minutes map is supplied. */
function blendedDefender(roster, slots, minutesMap, mods) {
  const weights = slots.map((slot) => minutesScaleFor(slot, minutesMap));
  const total = weights.reduce((sum, w) => sum + w, 0) || 1;
  const blend = { ppg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0, tov: 0 };
  slots.forEach((slot, i) => {
    const stats = effectiveStats(roster[slot], mods);
    const share = weights[i] / total;
    for (const key of Object.keys(blend)) blend[key] += stats[key] * share;
  });
  // primaryPos is read off the defender for positional normalization; every
  // player in the group shares a position by construction.
  return { ...blend, pos: roster[slots[0]].pos };
}

/** Fraction of a full role a slot plays this quarter. With no minutesMap this
 * is today's fixed split (starters at full scale, 6th man reduced) - so every
 * mode that doesn't expose a rotation picker is unaffected. With a
 * minutesMap (a slot -> minutes share, see simulateGame's opts), the share is
 * read relative to STARTER_MINUTES, since the dataset's per-game stats are
 * already calibrated against that baseline. */
function minutesScaleFor(slot, minutesMap) {
  const minutes = minutesMap && minutesMap[slot];
  if (Number.isFinite(minutes)) return minutes / STARTER_MINUTES;
  return defaultMinutesScaleFor(slot);
}

/** What a slot plays when no rotation was set. A depth-chart slot ("PG1",
 * "PG2") falls back to the default split of its position's 48 minutes -
 * without this a 10-man roster would default every slot to a full starter's
 * load, fielding ten full-time players and roughly doubling a real team's
 * output. Plain slots keep the historical 36-minute baseline their recorded
 * per-game stats already reflect. */
/** A slot's assigned minutes in real minutes, for the fatigue check. Falls
 * back to whatever the default split gives that slot when no rotation was
 * set, so an unset rotation is judged on the same basis as a set one. */
function playerMinutes(slot, minutesMap) {
  const minutes = minutesMap && minutesMap[slot];
  if (Number.isFinite(minutes)) return minutes;
  return defaultMinutesScaleFor(slot) * STARTER_MINUTES;
}

function defaultMinutesScaleFor(slot) {
  if (slot === "6TH") return SIXTH_MAN_SCALE;
  // A bench spot defaults to a backup's load; a named starter to a starter's.
  if (isBenchSlot(slot)) return RANKED_BACKUP_MINUTES / STARTER_MINUTES;
  if (/\d$/.test(slot)) {
    const minutes = slot.endsWith("1") ? RANKED_STARTER_MINUTES : RANKED_BACKUP_MINUTES;
    return minutes / STARTER_MINUTES;
  }
  return 1;
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
function simulateQuarter(rosterA, rosterB, datasetStats, modsA, modsB, minutesA, minutesB) {
  const linesA = {};
  const linesB = {};

  const groupsA = slotsByPosition(rosterA);
  const groupsB = slotsByPosition(rosterB);

  for (const pos of Object.keys(groupsA)) {
    const slotsA = groupsA[pos];
    const slotsB = groupsB[pos] || slotsA;

    // Each side faces a minutes-weighted blend of whoever the opponent plays
    // at this position, rather than one nominated defender.
    const defenderForA = blendedDefender(rosterB, slotsB, minutesB, modsB);
    const defenderForB = blendedDefender(rosterA, slotsA, minutesA, modsA);

    for (const slot of slotsA) {
      linesA[slot] = simulatePlayerQuarter(rosterA[slot], defenderForA, slot, datasetStats, modsA, minutesA);
    }
    for (const slot of slotsB) {
      linesB[slot] = simulatePlayerQuarter(rosterB[slot], defenderForB, slot, datasetStats, modsB, minutesB);
    }
  }

  // 6th man: additive bonus production, not run through a positional matchup
  // (the starters cover true 5-on-5; the bench spot is a simple fixed-minutes
  // bonus). Only the legacy/online 6-slot roster has one - Quick Play's 5 and
  // Ranked's 10 both omit it, so this is skipped rather than simulated
  // against an undefined player.
  if (rosterA["6TH"]) linesA["6TH"] = simulateSixthManQuarter(rosterA["6TH"], modsA, minutesA);
  if (rosterB["6TH"]) linesB["6TH"] = simulateSixthManQuarter(rosterB["6TH"], modsB, minutesB);

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

/** @param def already-blended, already-tactic-adjusted defender stats from
 *   blendedDefender - not a raw player record.
 */
function simulatePlayerQuarter(offPlayer, def, slot, datasetStats, offMods, minutesMap) {
  const scale =
    minutesScaleFor(slot, minutesMap) *
    fatigueFactor(playerMinutes(slot, minutesMap)) *
    (1 / QUARTERS_PER_GAME);
  const pos = primaryPos(offPlayer);
  const defPos = def.pos[0];
  const off = effectiveStats(offPlayer, offMods);

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

function simulateSixthManQuarter(rawPlayer, mods, minutesMap) {
  const scale = minutesScaleFor("6TH", minutesMap) * (1 / QUARTERS_PER_GAME);
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

function rosterBaselinePoints(roster, minutesMap) {
  // What the team would score if every player simply produced their raw
  // per-game PPG with no matchup/team modifiers - the denominator the
  // scoring ceiling multiplier is measured against. Weighted by the same
  // minutes shares the game actually used, so reallocating minutes to a
  // star isn't mistaken for a stacked-roster scoring exploit.
  return activeSlots(roster).reduce(
    (sum, slot) => sum + roster[slot].ppg * minutesScaleFor(slot, minutesMap),
    0
  );
}

/** Runs quarters (or OT periods) and accumulates per-slot totals. lengthScale
 * of 1 = a full quarter; used at < 1 for shorter OT periods. Slots are
 * derived from rosterA (both sides always share the same roster shape in
 * every mode today), so a 5-slot Quick Play roster never gets a "6TH" key
 * anywhere downstream. */
function runPeriods(rosterA, rosterB, datasetStats, periods, lengthScale = 1, modsA, modsB, minutesA, minutesB, teamVariance, parity) {
  const slots = activeSlots(rosterA);
  const vMin = (teamVariance && teamVariance.min) ?? TEAM_QUARTER_VARIANCE_MIN;
  const vMax = (teamVariance && teamVariance.max) ?? TEAM_QUARTER_VARIANCE_MAX;
  const totalsA = {};
  const totalsB = {};
  for (const slot of slots) {
    totalsA[slot] = emptyLine();
    totalsB[slot] = emptyLine();
  }
  const quarterBoxScores = [];

  for (let i = 0; i < periods; i++) {
    const { linesA, linesB } = simulateQuarter(rosterA, rosterB, datasetStats, modsA, modsB, minutesA, minutesB);

    // Pull each side's quarter toward what a league-average roster would
    // score in the same minutes. Anchoring to a FIXED league baseline rather
    // than to the opponent is what makes this work: compressing the two teams
    // toward each other would shrink margins without ever changing who wins,
    // whereas shrinking each side's distance from average reduces the
    // systematic talent edge while leaving the random component untouched -
    // so noise gets proportionally more say and quarters become genuinely
    // contested instead of merely wilder.
    applyTalentParity(linesA, rosterA, minutesA, datasetStats, parity);
    applyTalentParity(linesB, rosterB, minutesB, datasetStats, parity);

    // The correlated hot/cold roll lands AFTER parity, and the order is the
    // whole point. Rolling first meant compression scaled the talent gap and
    // the noise by the same factor, leaving their ratio - and therefore who
    // won the quarter - untouched: margins fell to 4 points while the better
    // roster still took 90% of quarters. Applied after, the noise keeps its
    // full size against an already-shrunken gap, so quarters actually change
    // hands. Points and assists only; a center keeps rebounding and blocking
    // through a cold shooting night.
    applyTeamRoll(linesA, randRange(vMin, vMax));
    applyTeamRoll(linesB, randRange(vMin, vMax));

    const scaledA = {};
    const scaledB = {};
    for (const slot of slots) {
      scaledA[slot] = scaleLine(linesA[slot], lengthScale);
      scaledB[slot] = scaleLine(linesB[slot], lengthScale);
      addLine(totalsA[slot], scaledA[slot]);
      addLine(totalsB[slot], scaledB[slot]);
    }
    quarterBoxScores.push({ a: scaledA, b: scaledB });
  }

  return { totalsA, totalsB, quarterBoxScores };
}

/** One shared multiplier for every player on a team this quarter - the
 * "this team ran hot/cold" factor. Independent per-player noise averages out
 * across a roster (team-level swing shrinks by roughly the square root of the
 * roster size), which is why widening the per-player range can never make
 * quarters competitive. A correlated factor survives that averaging. */
function applyTeamRoll(lines, roll) {
  for (const slot of Object.keys(lines)) {
    lines[slot].pts *= roll;
    lines[slot].ast *= roll;
  }
}

/** Scales one team's quarter lines toward a league-average roster's output in
 * the same minutes. Applied to points only - rebounds and blocks are already
 * matchup-driven and don't carry the runaway talent gap that scoring does. */
function applyTalentParity(lines, roster, minutesMap, datasetStats, parity) {
  if (parity >= 1) return;
  const actual = Object.keys(lines).reduce((sum, slot) => sum + lines[slot].pts, 0);
  if (actual <= 0) return;

  const minutesTotal = activeSlots(roster).reduce((sum, slot) => sum + minutesScaleFor(slot, minutesMap), 0);
  const anchor = (datasetStats.overall.ppg * minutesTotal) / QUARTERS_PER_GAME;
  const target = anchor + (actual - anchor) * parity;

  const factor = target / actual;
  for (const slot of Object.keys(lines)) lines[slot].pts *= factor;
}

function sumTeamLine(totals, key) {
  return Object.keys(totals).reduce((sum, slot) => sum + totals[slot][key], 0);
}

/** Apply a multiplicative adjustment to every player's points, keeping the
 * box score internally consistent (player totals still sum to team total). */
function applyPointsMultiplier(totals, factor) {
  for (const slot of Object.keys(totals)) {
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

/** A tactic's mods with its clutchMods (if any) folded in on top - used only
 * for the 4th quarter and overtime, where a style like Isolation Heavy's
 * "+2 Clutch Scoring" is meant to actually kick in. Returns the base mods
 * unchanged when the style has no clutchMods, so this is a no-op for every
 * style but the ones that define one. */
function clutchModsFor(mods, clutchMods) {
  if (!clutchMods) return mods;
  const out = { ...mods };
  for (const key of Object.keys(clutchMods)) {
    out[key] = (out[key] ?? 1) * clutchMods[key];
  }
  return out;
}

/**
 * Simulates a full game between two rosters.
 *
 * @param {object} rosterA - { PG, SG, SF, PF, C, "6TH" }
 * @param {object} rosterB - same shape
 * @param {object} datasetStats - from computeDatasetStats()
 * @param {object} opts - { tacticA, tacticB, minutesA, minutesB }: tactic ids
 *   chosen before tip-off, and optional slot -> minutes maps from the
 *   rotation phase (a mode that doesn't expose rotation choice omits these
 *   and gets today's fixed starter/6th-man split).
 * @returns box score, quarter breakdown, final score, and MVP
 */
export function simulateGame(rosterA, rosterB, datasetStats, opts = {}) {
  const modsA = tacticMods(opts.tacticA);
  const modsB = tacticMods(opts.tacticB);
  const clutchA = clutchModsFor(modsA, tacticClutchMods(opts.tacticA));
  const clutchB = clutchModsFor(modsB, tacticClutchMods(opts.tacticB));
  // No rotation supplied means "play the default", which must still respect
  // the 240-minute budget - so the default is computed from the roster's
  // position grouping rather than guessed slot by slot.
  const minutesA = opts.minutesA || defaultMinutes(rosterA);
  const minutesB = opts.minutesB || defaultMinutes(rosterB);
  // Optional override, used by tools/calibrate-variance.mjs to solve the
  // range without rewriting constants.js between runs.
  const teamVariance = opts.teamVariance || null;
  const parity = Number.isFinite(opts.parity) ? opts.parity : TALENT_PARITY;

  // Regulation quarters 1-3 at base mods; quarter 4 gets the clutch mods, so
  // a clutch-scoring style only pays off in exactly the moment it promises.
  let { totalsA, totalsB, quarterBoxScores } = runPeriods(
    rosterA,
    rosterB,
    datasetStats,
    QUARTERS_PER_GAME - 1,
    1,
    modsA,
    modsB,
    minutesA,
    minutesB,
    teamVariance,
    parity
  );
  const q4 = runPeriods(rosterA, rosterB, datasetStats, 1, 1, clutchA, clutchB, minutesA, minutesB, teamVariance, parity);
  for (const slot of Object.keys(totalsA)) {
    addLine(totalsA[slot], q4.totalsA[slot]);
    addLine(totalsB[slot], q4.totalsB[slot]);
  }
  quarterBoxScores.push(...q4.quarterBoxScores);

  applyTurnoverSwing(totalsA, totalsB);
  applyUsageCompression(totalsA, rosterA, datasetStats);
  applyUsageCompression(totalsB, rosterB, datasetStats);
  applyScoringCeiling(totalsA, rosterA, minutesA);
  applyScoringCeiling(totalsB, rosterB, minutesB);

  let otPeriods = 0;
  while (
    Math.round(sumTeamLine(totalsA, "pts")) === Math.round(sumTeamLine(totalsB, "pts")) &&
    otPeriods < MAX_OT_PERIODS
  ) {
    // OT is already crunch time - it plays out under the same clutch mods as
    // the 4th quarter, not the base ones.
    const ot = runPeriods(rosterA, rosterB, datasetStats, 1, OT_LENGTH_SCALE, clutchA, clutchB, minutesA, minutesB, teamVariance, parity);
    for (const slot of Object.keys(totalsA)) {
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
  for (const slot of Object.keys(totalsA)) {
    boxA[slot] = roundLine(totalsA[slot]);
    boxB[slot] = roundLine(totalsB[slot]);
  }

  // The per-period lines were captured before the game-level adjustments
  // above, which only ever touched the totals - so until now the periods and
  // the final box disagreed. Re-apportion them onto the finished box score so
  // there is exactly one set of numbers in the result.
  reconcilePeriods(quarterBoxScores, "a", boxA);
  reconcilePeriods(quarterBoxScores, "b", boxB);

  const teamScoreA = Object.keys(boxA).reduce((s, slot) => s + boxA[slot].pts, 0);
  const teamScoreB = Object.keys(boxB).reduce((s, slot) => s + boxB[slot].pts, 0);

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
  // Read the real roster size rather than assuming 5 starters + a 6th man:
  // compression measures a roster against an average one of the SAME size,
  // so hardcoding 6 would read a legitimate 10-man roster as a stacked
  // 6-man one and crush its scoring.
  const playerCount = activeSlots(roster).length;

  const keyValue = COMPRESSION_KEY === "impact" ? combinedImpact : combinedRawPpg;
  const avgBaseline =
    COMPRESSION_KEY === "impact"
      ? playerCount * (datasetStats.overall.ppg * 1.0 + datasetStats.overall.rpg * 0.7 + datasetStats.overall.apg * 0.7 + datasetStats.overall.spg + datasetStats.overall.bpg - datasetStats.overall.tov * 0.5)
      : playerCount * datasetStats.overall.ppg;

  const excess = Math.max(0, keyValue - avgBaseline);
  const factor = clamp(1 - COMPRESSION_COEFFICIENT * excess, COMPRESSION_FLOOR, 1);
  applyPointsMultiplier(totals, factor);
}

function applyScoringCeiling(totals, roster, minutesMap) {
  const baseline = rosterBaselinePoints(roster, minutesMap);
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

/**
 * Rewrites one side's per-period lines so every stat sums exactly to that
 * player's finished box-score line.
 *
 * This is needed because the four game-level corrections - turnover swing,
 * usage compression, the scoring ceiling and the absolute clamp - are
 * measured against a roster's FULL-GAME production. They can't be applied
 * per period without changing what they mean, so they run on the totals and
 * the periods are left behind. Before this, a game's quarters summed to 161.8
 * while the final score read 126, and whichever number you saw depended on
 * which one you happened to be looking at: the live box climbed to a player's
 * pre-correction total and then snapped down at the buzzer, and the recap
 * quoted a period score the scoreboard disagreed with.
 *
 * Apportionment is largest-remainder: floor each period's proportional share,
 * then hand the leftover units to the largest fractional parts. That keeps
 * whole numbers - the recap should narrate the figures the box score shows -
 * while guaranteeing the column adds up.
 */
function reconcilePeriods(quarterBoxScores, key, box) {
  for (const slot of Object.keys(box)) {
    for (const stat of LINE_KEYS) {
      const target = box[slot][stat];
      const raw = quarterBoxScores.map((q) => (q[key] && q[key][slot] ? q[key][slot][stat] : 0));
      const shares = apportion(raw, target);
      quarterBoxScores.forEach((q, i) => {
        if (q[key] && q[key][slot]) q[key][slot][stat] = shares[i];
      });
    }
  }
}

/** Splits `target` (a whole number) across buckets in proportion to `raw`,
 * returning whole numbers that sum to exactly `target`. */
function apportion(raw, target) {
  const out = new Array(raw.length).fill(0);
  if (raw.length === 0 || target <= 0) return out;

  const total = raw.reduce((sum, v) => sum + v, 0);
  if (total <= 0) {
    // Nothing to weight by - a player who produced nothing all game can still
    // carry a rounded-up total, so it goes somewhere rather than vanishing.
    out[out.length - 1] = target;
    return out;
  }

  const exact = raw.map((v) => (target * v) / total);
  exact.forEach((v, i) => (out[i] = Math.floor(v)));

  let remaining = target - out.reduce((sum, v) => sum + v, 0);
  const byFraction = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let n = 0; n < remaining; n++) out[byFraction[n % byFraction.length].i] += 1;

  return out;
}

function pickMvp(rosterA, boxA, rosterB, boxB, winnerSide) {
  let best = null;
  for (const [roster, box, side] of [
    [rosterA, boxA, "A"],
    [rosterB, boxB, "B"],
  ]) {
    for (const slot of Object.keys(box)) {
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
