// Post-game recap: a one-line headline explaining why the winner won and
// what the loser was missing.
//
// The box score already says what happened, but not *why*. Reading a table of
// six stat lines to work out that you lost the glass is work; a sentence that
// says "out-rebounded by 14" is the thing that actually teaches you something
// about your draft. That's the whole point of this file - the game is trying
// to make you a better drafter, and a result you can't explain teaches
// nothing.
//
// Everything here is derived from the box scores both modes already produce,
// so it works identically for practice and ranked with no extra data.

import { orderedRosterSlots, isBenchSlot } from "./constants.js";
import { gameScore } from "./engine.js";
import { shootingNote } from "./shooting.js";

/** Per-quarter team point totals for one side, from the period-by-period
 * box scores the engine already produces. This is what lets the recap talk
 * about WHEN a game turned rather than only the final margin. */
function periodPoints(quarterBoxScores, key) {
  return quarterBoxScores.map((q) =>
    Object.values((q && q[key]) || {}).reduce((sum, line) => sum + ((line && line.pts) || 0), 0)
  );
}

/** The slots a roster actually filled, in canonical lineup order - roster
 * shape varies by mode (5, 6, or 10 slots), so nothing here may assume one. */
function rosterSlots(roster) {
  return orderedRosterSlots(roster);
}

/** Readable name for a roster slot in prose ("6th man", "PG1"). */
function slotName(slot) {
  if (slot === "6TH") return "6th man";
  return isBenchSlot(slot) ? "the bench" : slot;
}

const PERIOD_LABELS = ["the 1st", "the 2nd", "the 3rd", "the 4th"];

function periodLabel(i, quarterBoxScores) {
  if (quarterBoxScores[i] && quarterBoxScores[i].overtime) return "overtime";
  return PERIOD_LABELS[i] || `period ${i + 1}`;
}

/** The period the winner won by the most - the stretch that decided it. */
function decisivePeriod(quarterBoxScores, winKey, loseKey) {
  const win = periodPoints(quarterBoxScores, winKey);
  const lose = periodPoints(quarterBoxScores, loseKey);
  let bestIdx = 0;
  let bestSwing = -Infinity;
  for (let i = 0; i < win.length; i++) {
    const swing = win[i] - lose[i];
    if (swing > bestSwing) {
      bestSwing = swing;
      bestIdx = i;
    }
  }
  return { index: bestIdx, swing: bestSwing, winPts: win[bestIdx], losePts: lose[bestIdx] };
}

/** Who carried that stretch, and in what way. Checked in order of how much a
 * fan would actually mention it: a defensive eruption is more notable than
 * routine scoring, so blocks and steals are tested before points. */
function periodStandout(quarterBoxScores, key, roster, index) {
  // returns { weight, text, name } so callers can avoid naming the same
  // player in three consecutive sentences
  const q = quarterBoxScores[index];
  if (!q || !q[key]) return null;
  let best = null;
  for (const slot of rosterSlots(roster)) {
    const line = q[key][slot];
    if (!line) continue;
    const player = roster[slot];
    const candidates = [
      // Per-QUARTER thresholds, set against what the engine actually produces:
      // measured across 40 games, a quarter's points reach ~10.5 at the 95th
      // percentile. Blocks and steals are deliberately NOT here - they peak
      // near 1.0 a quarter, so any countable per-quarter defensive line would
      // be "swatted 1 shot". Defense is narrated from game totals instead,
      // where a rim protector genuinely gets three or four.
      { stat: "pts", value: line.pts, min: 8, phrase: (n, v) => `${n} dropped ${Math.round(v)}` },
      { stat: "ast", value: line.ast, min: 3.5, phrase: (n, v) => `${n} set up ${Math.round(v)} buckets` },
      { stat: "reb", value: line.reb, min: 4.5, phrase: (n, v) => `${n} pulled down ${Math.round(v)} boards` },
    ];
    for (const c of candidates) {
      if (c.value < c.min) continue;
      const weight = c.value / c.min;
      if (!best || weight > best.weight) {
        best = { weight, text: c.phrase(player.name, c.value), name: player.name };
      }
      break;
    }
  }
  return best;
}

/** The night's standout defender on a side, from full-game totals. Blocks and
 * steals only become countable over a whole game in this engine, which is
 * also how a fan would say it: "he had four blocks", not "he had one in the
 * third". */
function defensiveStar(box, roster) {
  let best = null;
  for (const slot of rosterSlots(roster)) {
    const line = box[slot];
    if (!line) continue;
    const player = roster[slot];
    for (const [stat, min, phrase] of [
      ["blk", 2.5, (n, v) => `${n} protected the rim all night with ${Math.round(v)} blocks`],
      ["stl", 2.5, (n, v) => `${n} was everywhere defensively, ${Math.round(v)} steals`],
    ]) {
      if (line[stat] < min) continue;
      const weight = line[stat] / min;
      if (!best || weight > best.weight) best = { weight, text: phrase(player.name, line[stat]), name: player.name };
    }
  }
  return best;
}

/** Category totals for one side's box score. */
function teamTotals(box) {
  const totals = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0 };
  for (const slot of Object.keys(box)) {
    const line = box[slot];
    if (!line) continue;
    for (const key of Object.keys(totals)) totals[key] += line[key] || 0;
  }
  return totals;
}

/** The winner's biggest edge, measured in how lopsided each category was
 * relative to what a normal gap looks like for that stat. Rebounds and points
 * come in much bigger numbers than steals, so raw differences aren't
 * comparable - each is scaled by a typical margin first. */
const CATEGORY_SCALE = { pts: 10, reb: 8, ast: 6, stl: 3, blk: 3 };

// Past tense throughout, deliberately: a side's name might be a username
// ("Bot won") or a plural ("the Lakers won"), and past-tense verbs agree with
// both. Present tense would force a choice that reads wrong half the time.
const CATEGORY_PHRASES = {
  pts: { edge: "shot the lights out", gap: "scoring" },
  reb: { edge: "dominated the glass", gap: "rebounding" },
  ast: { edge: "moved the ball better", gap: "playmaking" },
  stl: { edge: "locked down on defense", gap: "perimeter defense" },
  blk: { edge: "protected the rim", gap: "rim protection" },
};

/** One or two sentences on how the whole game flowed - not why the winner
 * won (that's buildRecap's job), but the shape of the game itself: wire-to-
 * wire, a comeback, back-and-forth, or a tight finish. Derived purely from
 * each period's point deltas, which every mode already produces to drive the
 * live scoreboard, so this needs no extra simulation data.
 * @param periods [{a, b}, ...] point deltas per period, in the order played
 *   (regulation then any OT) - the same shape main.js's live-sim loop
 *   already tracks as it reveals each period.
 */
export function buildGameScript(periods, labelA, labelB) {
  let runningA = 0;
  let runningB = 0;
  let leadSide = null;
  let leadChanges = 0;
  let maxDeficitA = 0;
  let maxDeficitB = 0;
  let ledWireToWireA = true;
  let ledWireToWireB = true;

  for (const p of periods) {
    runningA += p.a;
    runningB += p.b;
    const diff = runningA - runningB;
    if (diff > 0) {
      if (leadSide === "B") leadChanges += 1;
      leadSide = "A";
      ledWireToWireB = false;
      maxDeficitB = Math.max(maxDeficitB, diff);
    } else if (diff < 0) {
      if (leadSide === "A") leadChanges += 1;
      leadSide = "B";
      ledWireToWireA = false;
      maxDeficitA = Math.max(maxDeficitA, -diff);
    }
  }

  const winnerIsA = runningA > runningB;
  const winName = winnerIsA ? labelA : labelB;
  const loseName = winnerIsA ? labelB : labelA;
  const winnerMaxDeficit = winnerIsA ? maxDeficitA : maxDeficitB;
  const winnerLedWireToWire = winnerIsA ? ledWireToWireA : ledWireToWireB;
  const margin = Math.abs(runningA - runningB);

  if (winnerLedWireToWire && leadChanges === 0) {
    return margin >= 20
      ? `${winName} led from start to finish and never let ${loseName} back in it.`
      : `${winName} led wire-to-wire in a game ${loseName} couldn't quite crack.`;
  }
  if (winnerMaxDeficit >= 10) {
    return `${winName} trailed by as many as ${Math.round(winnerMaxDeficit)} before storming back to win it.`;
  }
  if (leadChanges >= 3) {
    return `The lead changed hands ${leadChanges} times before ${winName} finally pulled away.`;
  }
  if (margin <= 4) {
    return `A nail-biter down to the final possessions, with ${winName} coming out on top.`;
  }
  return `${winName} took control and never looked back.`;
}

/**
 * Builds the recap for a finished game.
 * @param result the object simulateGame (or the normalized server result)
 *   returns - needs boxA/boxB, teamScoreA/teamScoreB, winner, mvp.
 * @param rosterA/rosterB the drafted rosters, for naming players.
 * @param labelA/labelB display names for each side.
 * @returns {{headline: string, detail: string}}
 */
export function buildRecap(result, rosterA, rosterB, labelA, labelB, shotsA, shotsB) {
  const winnerIsA = result.winner === "A";
  const winName = winnerIsA ? labelA : labelB;
  const loseName = winnerIsA ? labelB : labelA;

  const winTotals = teamTotals(winnerIsA ? result.boxA : result.boxB);
  const loseTotals = teamTotals(winnerIsA ? result.boxB : result.boxA);
  const loseRoster = winnerIsA ? rosterB : rosterA;
  const winRosterRef = winnerIsA ? rosterA : rosterB;
  const loseBox = winnerIsA ? result.boxB : result.boxA;

  // Rank categories by how far the winner was ahead, scaled so a 3-steal edge
  // can legitimately outrank a 4-point one.
  const ranked = Object.keys(CATEGORY_SCALE)
    .map((key) => ({
      key,
      diff: winTotals[key] - loseTotals[key],
      weighted: (winTotals[key] - loseTotals[key]) / CATEGORY_SCALE[key],
    }))
    .sort((a, b) => b.weighted - a.weighted);

  const best = ranked[0];
  const margin = Math.abs(result.teamScoreA - result.teamScoreB);

  // Headline: how it was won.
  let headline;
  if (margin <= 3) {
    headline = `${winName} survived a ${margin}-point thriller`;
  } else if (margin >= 25) {
    headline = `${winName} ran ${loseName} off the floor`;
  } else if (best && best.diff > 0) {
    headline = `${winName} ${CATEGORY_PHRASES[best.key].edge}`;
  } else {
    headline = `${winName} took it late`;
  }

  // Detail: the concrete edge, plus what the loser lacked.
  const bits = [];
  if (best && best.diff > 0 && best.key !== "pts") {
    bits.push(`${CATEGORY_PHRASES[best.key].gap} edge of ${Math.round(best.diff)}`);
  }

  // Turnovers are the one category where fewer is better, so it's checked
  // separately rather than folded into the ranking above.
  const tovEdge = loseTotals.tov - winTotals.tov;
  if (tovEdge >= 4) bits.push(`${Math.round(tovEdge)} fewer giveaways`);

  // The MVP line reads as its own sentence. Folded into the "finished with"
  // list it produced "finished with LeBron James was the difference", which
  // is the kind of thing that makes generated text obviously generated.
  const mvpName = result.mvp && result.mvp.player ? result.mvp.player.name : null;
  const mvpOnWinner = result.mvp && (result.mvp.side === "A") === winnerIsA;
  const mvpSentence = mvpName && mvpOnWinner ? `${mvpName} was the difference.` : "";

  // What the loser was missing, named through the player who underperformed
  // by the most - the pick to revisit.
  //
  // This is judged against each player's OWN season averages, not against
  // their teammates and not on a single stat. Ranking by one cherry-picked
  // category is what once called Oscar Robertson "quiet" through a triple-
  // double: the deciding category was blocks, and the fewest blocks on any
  // roster belongs to a guard no matter how well he played. Comparing a line
  // to what that player normally produces is both the real meaning of a quiet
  // night and self-normalizing for minutes, which matters now that a ranked
  // roster's backups play far fewer of them than its starters.
  const underperformers = rosterSlots(loseRoster)
    .filter((slot) => loseBox[slot])
    .map((slot) => {
      const player = loseRoster[slot];
      const expected = gameScore({
        pts: player.ppg, reb: player.rpg, ast: player.apg,
        stl: player.spg, blk: player.bpg, tov: player.tov,
      });
      return { slot, ratio: expected > 0 ? gameScore(loseBox[slot]) / expected : 1 };
    })
    .sort((a, b) => a.ratio - b.ratio);

  let missing = "";
  if (underperformers.length > 0) {
    const worst = underperformers[0];
    const median = underperformers[Math.floor(underperformers.length / 2)].ratio;
    // Only call someone quiet if they were quiet *for them*, and clearly
    // quieter than the rest of the roster - otherwise the whole team simply
    // got beaten, which is a different sentence.
    if (worst.ratio < 0.6 * median) {
      missing =
        `${loseName} got nothing at ${slotName(worst.slot)} — ` +
        `${loseRoster[worst.slot].name} was quiet.`;
    }
  }
  if (!missing) {
    missing = `${loseName} never found an answer.`;
  }

  // A standout shooting night, when the data supports one. Checked across
  // both rosters so a cold night from the loser is as tellable as a hot one
  // from the winner.
  let shooting = "";
  const winShots = winnerIsA ? shotsA : shotsB;
  const loseShots = winnerIsA ? shotsB : shotsA;
  for (const [roster, shots] of [
    [winRosterRef, winShots],
    [loseRoster, loseShots],
  ]) {
    if (shooting || !shots) continue;
    for (const slot of rosterSlots(roster)) {
      if (!shots[slot]) continue;
      const note = shootingNote(roster[slot].name, shots[slot]);
      if (note) {
        shooting = note + ".";
        break;
      }
    }
  }

  // The stretch that decided it, and who drove it. This is the sentence that
  // makes a result feel like a game rather than a total.
  const winKey = winnerIsA ? "a" : "b";
  const loseKey = winnerIsA ? "b" : "a";
  let turningPoint = "";
  let namedSoFar = null;
  if (result.quarterBoxScores && result.quarterBoxScores.length > 0) {
    const decisive = decisivePeriod(result.quarterBoxScores, winKey, loseKey);
    if (decisive.swing >= 5) {
      const who = periodStandout(result.quarterBoxScores, winKey, winRosterRef, decisive.index);
      const run = `${Math.round(decisive.winPts)}-${Math.round(decisive.losePts)}`;
      const when = periodLabel(decisive.index, result.quarterBoxScores);
      if (who) namedSoFar = who.name;
      if (who && who.defensive) {
        // A defensive stretch is only interesting alongside what it did to the
        // other team, so it gets phrased as cause and effect rather than as a
        // stat line sitting on its own.
        turningPoint =
          `${who.text} in ${when} and ${loseName} went cold, ` +
          `managing ${Math.round(decisive.losePts)} in the period as ${winName} pulled away ${run}.`;
      } else if (who) {
        turningPoint = `${who.text} in ${when} as ${winName} took the period ${run}.`;
      } else {
        turningPoint = `${winName} broke it open in ${when}, taking the period ${run}.`;
      }
    }
  }

  // A defensive night worth naming, paired with what it did to the other
  // side - defense only means something described through its effect.
  let defenseLine = "";
  const winBox = winnerIsA ? result.boxA : result.boxB;
  const star = defensiveStar(winBox, winRosterRef);
  if (star && star.name !== namedSoFar) {
    const coldSide =
      loseTotals.pts < winTotals.pts ? ` and ${loseName} never found a clean look` : "";
    defenseLine = `${star.text}${coldSide}.`;
  }

  const sentences = [];
  if (turningPoint) sentences.push(turningPoint);
  if (defenseLine) sentences.push(defenseLine);
  if (bits.length > 0) sentences.push(`${winName} finished with ${bits.join(" and ")}.`);
  // Don't name the same player three sentences running - the recap should
  // read like a report, not a chant.
  if (mvpSentence && mvpName !== namedSoFar && (!star || mvpName !== star.name)) {
    sentences.push(mvpSentence);
  }
  sentences.push(missing);
  if (shooting) sentences.push(shooting);

  return { headline, detail: sentences.join(" ") };
}
