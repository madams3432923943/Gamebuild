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

import { orderedRosterSlots, isBenchSlot, basePosition, FATIGUE_MINUTES, STARTER_MINUTES } from "./constants.js";
import { gameScore } from "./engine.js";
import { shootingNote } from "./shooting.js";
import { tacticById } from "./tactics.js";

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

// ---------------------------------------------------------------------------
// Post-game analysis: why the game was won or lost, as a list rather than a
// paragraph.
//
// The narrative recap above is the broadcast voice - it's about the game. This
// is the coach's voice, and it's about YOU: the four or five numbers that
// actually decided it, and what your rotation, matchups and gamestyle did
// once the ball went up. A player who can see that Crash the Glass won them
// the rebounding battle will spend the next draft thinking about rebounding,
// which is the entire point.
// ---------------------------------------------------------------------------

/** Bench production for one side. Bench slots are open (see constants.js), so
 * this is derived from the roster's own slot names rather than a fixed list. */
function benchPoints(box, roster) {
  return rosterSlots(roster)
    .filter((slot) => isBenchSlot(slot) || slot === "6TH")
    .reduce((sum, slot) => sum + ((box[slot] && box[slot].pts) || 0), 0);
}

/** Points scored inside the arc.
 *
 * This used to be "points by anyone listed at PF or C", which is a guess about
 * WHO rather than a measurement of WHERE - it counted a stretch four's threes
 * as interior scoring and missed every drive by a guard. The shot splits
 * js/shooting.js already derives for the box score carry the real answer:
 * two-point makes are `fgm - tpm`, so twos are worth exactly that times two.
 *
 * Falls back to the old positional read only when there are no splits at all,
 * which is the 1960s/70s squads whose data predates recorded attempts. */
function twoPointPoints(box, roster, shots) {
  if (shots) {
    let total = 0;
    let sawAny = false;
    for (const slot of rosterSlots(roster)) {
      const line = shots[slot];
      if (!line) continue;
      sawAny = true;
      total += Math.max(0, (line.fgm || 0) - (line.tpm || 0)) * 2;
    }
    if (sawAny) return total;
  }
  return rosterSlots(roster)
    .filter((slot) => {
      const player = roster[slot];
      const pos = basePosition(slot) || (player && player.pos && player.pos[0]);
      return pos === "PF" || pos === "C";
    })
    .reduce((sum, slot) => sum + ((box[slot] && box[slot].pts) || 0), 0);
}

/** Team three-point percentage from the shot splits, or null when the roster
 * predates the line (every 1960s/70s squad) and nobody attempted one. */
function threePointPct(shots) {
  if (!shots) return null;
  let made = 0;
  let attempted = 0;
  for (const slot of Object.keys(shots)) {
    const line = shots[slot];
    if (!line) continue;
    made += line.tpm || 0;
    attempted += line.tpa || 0;
  }
  if (attempted < 8) return null;
  return { pct: made / attempted, made, attempted };
}

/** A player's expected points for the minutes he actually played, which is
 * what "held him to 19" has to be measured against - 19 is a quiet night for
 * a 28-point scorer and a huge one for a backup. */
function expectedPoints(player, slot, minutes) {
  const played = minutes && Number.isFinite(minutes[slot]) ? minutes[slot] : STARTER_MINUTES;
  return player.ppg * (played / STARTER_MINUTES);
}

// What each gamestyle promised, and the box-score column that proves it kept
// the promise. Keyed by the same ids js/tactics.js defines; a style with no
// entry simply produces no line rather than a made-up one.
const TACTIC_PROOF = {
  "crash-the-glass": { stat: "reb", won: "Crash the Glass won you the rebounding battle", lost: "Crash the Glass didn't land - you still lost the glass" },
  "lockdown-defense": { stat: "against", won: "Lockdown Defense held them under their number", lost: "Lockdown Defense gave up too much anyway" },
  "defensive-pressure": { stat: "forced", won: "Defensive Pressure forced them into giveaways", lost: "Defensive Pressure didn't force the turnovers it needed" },
  "ball-movement": { stat: "ast", won: "Ball Movement had the ball humming", lost: "Ball Movement never got going" },
  "run-and-gun": { stat: "pts", won: "Run & Gun created the extra transition looks", lost: "Run & Gun traded defense for points you didn't get" },
  "small-ball": { stat: "stl", won: "Small Ball switched everything and got into passing lanes", lost: "Small Ball cost you the glass without the steals to pay for it" },
  "spread-perimeter": { stat: "pts", won: "Spreading the perimeter opened the floor up", lost: "Spreading the perimeter cost you the offensive glass for nothing" },
  "paint-dominance": { stat: "reb", won: "Paint Dominance owned the interior", lost: "Paint Dominance never established anything inside" },
  "isolation-heavy": { stat: "clutch", won: "Isolation Heavy's clutch scoring showed up in the 4th", lost: "Isolation Heavy went cold when it mattered" },
  balanced: { stat: null, won: "Balanced kept you in it everywhere", lost: "Balanced left you without an edge anywhere" },
  "zone-defense": { stat: "paint", won: "Zone defense reduced their paint scoring", lost: "The zone got picked apart from outside" },
  "full-court-press": { stat: "forced", won: "The full-court press turned them over", lost: "The press got beaten and cost you the glass" },
  "post-up-heavy": { stat: "paint", won: "Posting up owned the interior", lost: "The post-up game never got going" },
  "switch-everything": { stat: "stl", won: "Switching everything smothered the perimeter", lost: "Switching left you mismatched and outrebounded" },
  "grind-it-out": { stat: "care", won: "Grinding it out kept the ball out of their hands", lost: "Grinding it out capped your scoring without stopping theirs" },
};

/** What the coaching decisions actually did. Every line is checked against
 * the finished box score - nothing here says a choice worked unless it did. */
function coachingNotes({ box, oppBox, roster, oppRoster, minutes, oppMinutes, matchups, tacticId, totals, oppTotals, quarterBoxScores, key, skipBench, paintFor, paintAgainst }) {
  const notes = [];

  // 1. Defensive assignments. Only the starters are assignable, and only a
  // clearly suppressed or clearly exploded matchup is worth a sentence.
  if (matchups) {
    const graded = [];
    for (const slot of Object.keys(matchups)) {
      const target = matchups[slot];
      const defender = roster[slot];
      const attacker = oppRoster[target];
      const line = oppBox[target];
      if (!defender || !attacker || !line) continue;
      const expected = expectedPoints(attacker, target, oppMinutes);
      if (expected < 8) continue; // nothing to hold him to
      graded.push({ slot, defender, attacker, pts: line.pts, ratio: line.pts / expected });
    }
    graded.sort((a, b) => a.ratio - b.ratio);
    const best = graded[0];
    const worst = graded[graded.length - 1];
    if (best && best.ratio <= 0.78) {
      notes.push(`Your ${best.slot} held ${best.attacker.name} to ${Math.round(best.pts)} points.`);
    }
    if (worst && worst.ratio >= 1.3 && worst !== best) {
      notes.push(`${worst.attacker.name} went for ${Math.round(worst.pts)} against your ${worst.slot} - wrong man on him.`);
    }
  }

  // 2. Rotation. Fatigue is real in this engine (see fatigueFactor), so a
  // heavy-minutes starter who faded in the 4th is a rotation lesson, and a
  // bench that outscored theirs is the payoff for drafting depth.
  if (minutes) {
    const tired = rosterSlots(roster)
      .filter((slot) => Number.isFinite(minutes[slot]) && minutes[slot] > FATIGUE_MINUTES)
      .sort((a, b) => minutes[b] - minutes[a]);
    if (tired.length > 0 && quarterBoxScores && quarterBoxScores.length >= 4) {
      const slot = tired[0];
      const early = [0, 1, 2].reduce((sum, i) => {
        const q = quarterBoxScores[i];
        return sum + ((q && q[key] && q[key][slot] && q[key][slot].pts) || 0);
      }, 0) / 3;
      const q4 = (quarterBoxScores[3][key] && quarterBoxScores[3][key][slot] && quarterBoxScores[3][key][slot].pts) || 0;
      if (early > 0 && q4 < early * 0.65) {
        notes.push(
          `${roster[slot].name} played ${minutes[slot]} minutes and had nothing left in the 4th - a deeper rotation buys that back.`
        );
      } else {
        notes.push(`${roster[slot].name} carried ${minutes[slot]} minutes and held up.`);
      }
    }
    // The bench margin is one of the headline reasons above whenever it was
    // decisive, and saying it twice on one screen reads as padding.
    const myBench = skipBench ? 0 : benchPoints(box, roster);
    const theirBench = skipBench ? 0 : benchPoints(oppBox, oppRoster);
    if (myBench - theirBench >= 8) {
      notes.push(`Your bench outscored theirs by ${Math.round(myBench - theirBench)} - depth paid.`);
    } else if (theirBench - myBench >= 8) {
      notes.push(`Their bench outscored yours by ${Math.round(theirBench - myBench)} - your second unit gave the game back.`);
    }
  }

  // 3. Gamestyle, checked against the column it promised to move.
  const proof = tacticId ? TACTIC_PROOF[tacticId] : null;
  if (proof) {
    let kept;
    switch (proof.stat) {
      case "reb": kept = totals.reb > oppTotals.reb; break;
      case "ast": kept = totals.ast > oppTotals.ast; break;
      case "stl": kept = totals.stl > oppTotals.stl; break;
      case "pts": kept = totals.pts > oppTotals.pts; break;
      case "against": kept = oppTotals.pts < totals.pts; break;
      case "forced": kept = oppTotals.tov > totals.tov; break;
      // Zone and Post-Up both promise something about the interior, so both
      // are judged on it - the difference is which side's paint they move.
      case "paint": kept = paintFor > paintAgainst; break;
      case "care": kept = totals.tov < oppTotals.tov; break;
      case "clutch": {
        const q4 = quarterBoxScores && quarterBoxScores[3];
        const mine4 = q4 ? Object.values(q4[key] || {}).reduce((s, l) => s + (l.pts || 0), 0) : 0;
        const theirs4 = q4 ? Object.values(q4[key === "a" ? "b" : "a"] || {}).reduce((s, l) => s + (l.pts || 0), 0) : 0;
        kept = mine4 > theirs4;
        break;
      }
      default: kept = totals.pts > oppTotals.pts;
    }
    notes.push(`${kept ? proof.won : proof.lost}.`);
  }

  return notes;
}

/**
 * The "why you won / why you lost" panel.
 *
 * @param result simulateGame output (or the normalized server result)
 * @param ctx {rosterA, rosterB, minutesA, minutesB, matchupsA, tacticA,
 *   shotsA, shotsB, analysisA} - everything the client has in BOTH modes.
 *   Anything missing simply produces fewer lines rather than a wrong one.
 * @returns {{won: boolean, title: string, reasons: string[], coaching: string[]}}
 */
export function buildWhyBreakdown(result, ctx = {}) {
  const won = result.winner === "A";
  const mine = teamTotals(result.boxA);
  const theirs = teamTotals(result.boxB);
  const rosterA = ctx.rosterA || {};
  const rosterB = ctx.rosterB || {};

  const reasons = [];
  const push = (text) => reasons.push(text);

  // Rebounding, the single most legible edge in this engine.
  const rebDiff = Math.round(mine.reb - theirs.reb);
  if (won && rebDiff >= 5) push(`+${rebDiff} rebounds`);
  else if (!won && rebDiff <= -5) push(`Lost the glass by ${Math.abs(rebDiff)}`);

  // Bench, which is what the five open bench slots are there to reward.
  const benchDiff = Math.round(benchPoints(result.boxA, rosterA) - benchPoints(result.boxB, rosterB));
  let benchCalledOut = false;
  if (won && benchDiff >= 6) {
    push(`+${benchDiff} bench points`);
    benchCalledOut = true;
  } else if (!won && benchDiff <= -6) {
    push(`Bench gave up a ${Math.abs(benchDiff)}-point swing`);
    benchCalledOut = true;
  }

  // Turnovers - the one column where fewer is better.
  const myTov = Math.round(mine.tov);
  const tovDiff = Math.round(theirs.tov - mine.tov);
  if (won && tovDiff >= 4) push(`Forced ${tovDiff} more turnovers than you gave up`);
  else if (!won && tovDiff <= -4) push(`${myTov} turnovers`);

  // Their shooting night, when the data supports naming one.
  const theirThrees = threePointPct(ctx.shotsB);
  const myThrees = threePointPct(ctx.shotsA);
  if (won && theirThrees && theirThrees.pct <= 0.3) {
    push(`Opponent shot ${Math.round(theirThrees.pct * 100)}% from three`);
  } else if (!won && myThrees && myThrees.pct <= 0.3) {
    push(`You shot ${Math.round(myThrees.pct * 100)}% from three (${myThrees.made}/${myThrees.attempted})`);
  }

  // Scoring inside the arc, from the real shot splits.
  const twosDiff = Math.round(
    twoPointPoints(result.boxA, rosterA, ctx.shotsA) - twoPointPoints(result.boxB, rosterB, ctx.shotsB)
  );
  if (won && twosDiff >= 10) push(`Won points in the paint by ${twosDiff}`);
  else if (!won && twosDiff <= -10) push(`Lost points in the paint by ${Math.abs(twosDiff)}`);

  // Your best player's night, measured against his own average rather than
  // against his team-mates.
  const slots = rosterSlots(rosterA).filter((slot) => result.boxA[slot]);
  if (slots.length > 0) {
    const star = slots.reduce((a, b) => (rosterA[a].ppg >= rosterA[b].ppg ? a : b));
    const expected = expectedPoints(rosterA[star], star, ctx.minutesA);
    const actual = result.boxA[star].pts;
    if (won && expected > 0 && actual >= expected * 1.3) {
      push(`${rosterA[star].name} went off for ${Math.round(actual)}`);
    } else if (!won && expected > 8 && actual <= expected * 0.6) {
      push(`${rosterA[star].name} was shut down (${Math.round(actual)} points)`);
    }
  }

  // The draft itself. These come last because they're the deepest cause -
  // the ones you fix a whole game earlier, at the draft board.
  const analysis = ctx.analysisA;
  if (analysis) {
    if (analysis.forfeits.length > 0) {
      push(
        `${analysis.forfeits.length} forfeited pick${analysis.forfeits.length === 1 ? "" : "s"} - the clock drafted for you`
      );
    }
    if (analysis.counter >= 1.02) push("Your build attacked theirs - they had no answer for it");
    else if (analysis.counter <= 0.98) push("They drafted the counter to your build");
    if (analysis.construction >= 1.03) push("Balanced roster with no hole to attack");
    else if (analysis.construction <= 0.97) push("Roster had a hole they could aim at");
  }

  if (reasons.length === 0) {
    push(won ? "You were simply the better team on the night" : "Nothing went badly wrong - they were just better");
  }

  const coaching = coachingNotes({
    skipBench: benchCalledOut,
    paintFor: twoPointPoints(result.boxA, rosterA, ctx.shotsA),
    paintAgainst: twoPointPoints(result.boxB, rosterB, ctx.shotsB),
    box: result.boxA,
    oppBox: result.boxB,
    roster: rosterA,
    oppRoster: rosterB,
    minutes: ctx.minutesA,
    oppMinutes: ctx.minutesB,
    matchups: ctx.matchupsA,
    tacticId: ctx.tacticA,
    totals: mine,
    oppTotals: theirs,
    quarterBoxScores: result.quarterBoxScores,
    key: "a",
  });

  return {
    won,
    title: won ? "Why You Won" : "Why You Lost",
    reasons: reasons.slice(0, 5),
    coaching: coaching.slice(0, 4),
    tacticName: ctx.tacticA ? tacticById(ctx.tacticA).name : null,
  };
}

/** What makes a quarter worth a headline, in basketball's own words.
 *
 * These lived in js/main.js as a hardcoded list, so the shared play feed
 * narrated football in boards and dimes. Each entry is a stat key, the level
 * that counts as a big period, and how to say it either way. Tuned against
 * real per-quarter output: a starter averages 4-6 points a quarter, so 8+ is a
 * genuinely hot stretch.
 */
export const HIGHLIGHTS = [
  { key: "pts", min: 8, hot: (n, v) => `${n} pours in ${v}`, mild: (n, v) => `${n} led with ${v} points` },
  { key: "reb", min: 4.5, hot: (n, v) => `${n} owns the glass — ${v} boards`, mild: (n, v) => `${n} crashed the boards for ${v} rebounds` },
  { key: "ast", min: 3.5, hot: (n, v) => `${n} carving it up, ${v} dimes`, mild: (n, v) => `${n} ran the offense with ${v} assists` },
  { key: "blk", min: 1.8, hot: (n) => `${n} shutting the rim down`, mild: (n) => `${n} chipped in on D` },
];
