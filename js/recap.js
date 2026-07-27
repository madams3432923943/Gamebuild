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

import { SLOTS } from "./constants.js";

/** Category totals for one side's box score. */
function teamTotals(box) {
  const totals = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0 };
  for (const slot of SLOTS) {
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

/**
 * Builds the recap for a finished game.
 * @param result the object simulateGame (or the normalized server result)
 *   returns - needs boxA/boxB, teamScoreA/teamScoreB, winner, mvp.
 * @param rosterA/rosterB the drafted rosters, for naming players.
 * @param labelA/labelB display names for each side.
 * @returns {{headline: string, detail: string}}
 */
export function buildRecap(result, rosterA, rosterB, labelA, labelB) {
  const winnerIsA = result.winner === "A";
  const winName = winnerIsA ? labelA : labelB;
  const loseName = winnerIsA ? labelB : labelA;

  const winTotals = teamTotals(winnerIsA ? result.boxA : result.boxB);
  const loseTotals = teamTotals(winnerIsA ? result.boxB : result.boxA);
  const loseRoster = winnerIsA ? rosterB : rosterA;
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

  const mvpName = result.mvp && result.mvp.player ? result.mvp.player.name : null;
  const mvpOnWinner = result.mvp && (result.mvp.side === "A") === winnerIsA;
  if (mvpName && mvpOnWinner) {
    bits.push(`${mvpName} was the difference`);
  }

  // What the loser was missing: the weakest category they lost, named through
  // the slot that produced least there, since that's the pick to revisit.
  const losing = ranked.filter((r) => r.diff > 0);
  let missing = "";
  if (losing.length > 0) {
    const gapKey = losing[losing.length - 1].key === best.key ? best.key : losing[losing.length - 1].key;
    const weakSlot = SLOTS.filter((s) => loseRoster[s] && loseBox[s]).sort(
      (a, b) => (loseBox[a][gapKey] || 0) - (loseBox[b][gapKey] || 0)
    )[0];
    if (weakSlot) {
      missing = `${loseName} got nothing at ${weakSlot === "6TH" ? "6th man" : weakSlot} — ${loseRoster[weakSlot].name} was quiet.`;
    }
  }
  if (!missing) {
    missing = `${loseName} never found an answer.`;
  }

  const detail = (bits.length > 0 ? `${winName}: ${bits.join(", ")}. ` : "") + missing;
  return { headline, detail };
}
