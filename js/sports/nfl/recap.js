// Post-game writing, built from the drive log rather than from the scoreboard.
//
// This is the payoff for making `drives` a first-class engine return. A recap
// written off final scores can only say who won and by how much; one written
// off drives can say the game turned on three straight takeaways in the second
// quarter, and name the unit that got them. The second is worth reading.

import { planById } from "./tactics.js";

const teamDrives = (drives, side) => drives.filter((d) => d.team === side);
const scoring = (drives) => drives.filter((d) => d.points > 0);

/** The line everyone reads first. Built from what actually decided it rather
 * than from the margin, because "won by 10" is a number, not a story. */
export function buildRecap(result, rosterA, rosterB, labelA, labelB) {
  const { drives, teamScoreA, teamScoreB } = result;
  const winner = teamScoreA >= teamScoreB ? labelA : labelB;
  const winSide = teamScoreA >= teamScoreB ? "A" : "B";
  const loseSide = winSide === "A" ? "B" : "A";

  const takeaways = teamDrives(drives, loseSide).filter((d) => d.outcome === "turnover");
  const winScores = scoring(teamDrives(drives, winSide));
  const best = winScores.filter((d) => d.scorer).sort((a, b) => b.points - a.points)[0];

  const lines = [];
  lines.push(`${winner} ${Math.max(teamScoreA, teamScoreB)}-${Math.min(teamScoreA, teamScoreB)}.`);

  if (takeaways.length >= 2) {
    // Credit is per-drive, so the unit that showed up most is the one that
    // actually decided it - not whichever name the drafter liked best.
    const byUnit = {};
    for (const d of takeaways) if (d.credit) byUnit[d.credit] = (byUnit[d.credit] || 0) + 1;
    const [unit, count] = Object.entries(byUnit).sort((a, b) => b[1] - a[1])[0] || [];
    if (unit) lines.push(`The ${unit} forced ${count} takeaway${count === 1 ? "" : "s"}.`);
  }
  if (best?.scorer) lines.push(`${best.scorer} found the end zone.`);

  const stalls = teamDrives(drives, loseSide).filter((d) => d.outcome === "downs").length;
  if (stalls > 0) lines.push(`${stalls} drive${stalls === 1 ? "" : "s"} died in field goal range.`);

  return lines.join(" ");
}

/** The closing line of the play feed. Signature matches what shared code
 * passes - (periods, labelA, labelB) - which is basketball's, and was declared
 * here as (result): the final headline would have thrown in football, and the
 * only reason it had not yet is that nothing reached the end of a game.
 *
 * Football's drive-by-drive lives on the field itself, not in the feed, so
 * this is one sentence rather than a list. */
export function buildGameScript(periods, labelA, labelB) {
  const rows = Array.isArray(periods) ? periods : [];
  const total = (key) => rows.reduce((sum, p) => sum + (Number(p[key]) || 0), 0);
  // Rounded before anything reads them. Kept after the conversion became a
  // real play rather than 6.94 folded into the touchdown: this reads periods
  // supplied by the caller, and it must not print 15.940000000000001 whatever
  // an older stored result carries.
  const a = Math.round(total("a"));
  const b = Math.round(total("b"));
  const winner = a === b ? null : a > b ? labelA : labelB;
  const margin = Math.abs(a - b);
  if (!winner) return `${labelA} and ${labelB} finish level at ${a}.`;
  if (margin <= 3) return `${winner} wins it late, ${Math.max(a, b)}-${Math.min(a, b)}.`;
  if (margin >= 21) return `${winner} runs away with it, ${Math.max(a, b)}-${Math.min(a, b)}.`;
  return `${winner} takes it ${Math.max(a, b)}-${Math.min(a, b)}.`;
}

/** Why you won or lost, in terms of the picks that caused it. Reads the
 * side ratings the engine already computed rather than recomputing them, so
 * the explanation cannot disagree with the simulation it explains. */
/** A plan's display name, so the reveal reads "Ground Control" rather than
 *  "ground-control". Falls back to the id, which is what a stored result from
 *  before a plan was renamed would still carry. */
function planName(id) {
  return planById(id)?.name || id;
}

export function buildPostGameAnalysis(result, side = "A") {
  const a = result.analysis || {};
  const mine = side === "A" ? { off: a.offA, def: a.defA } : { off: a.offB, def: a.defB };
  const theirs = side === "A" ? { off: a.offB, def: a.defB } : { off: a.offA, def: a.defA };
  const notes = [];

  const offGap = (mine.off ?? 0.5) - (theirs.def ?? 0.5);
  const defGap = (mine.def ?? 0.5) - (theirs.off ?? 0.5);

  notes.push(offGap > 0.05
    ? "Your offense outclassed the defense it faced."
    : offGap < -0.05
      ? "Their defense was better than your offense."
      : "The offenses and defenses were evenly matched.");
  notes.push(defGap > 0.05
    ? "Your defense held up better than their offense."
    : defGap < -0.05
      ? "Their offense was too much for your defense."
      : "Neither defense had a clear edge.");

  const mySide = result.drives.filter((d) => d.team === side);
  const stalls = mySide.filter((d) => d.outcome === "downs").length;
  if (stalls >= 2) notes.push(`${stalls} of your drives stalled in kicking range - the ST pick showed.`);

  // THE AFFINITY REVEAL. Which of your players were built for the gameplan you
  // called - the one thing the draft board deliberately does not show, handed
  // over once the game it helped decide is over. That is the whole design: the
  // plan is a read on your lineup, and the way to learn a lineup is to play it.
  const matched = side === "A" ? a.affinityA : a.affinityB;
  if (matched?.length) {
    const named = matched.slice(0, 3).map((m) => `${m.name} (${planName(m.plan)})`).join(", ");
    const more = matched.length > 3 ? `, and ${matched.length - 3} more` : "";
    notes.push(
      matched.length === 1
        ? `${named} was made for that gameplan.`
        : `${named}${more} were made for the gameplans you called.`
    );
  }

  return notes.join(" ");
}

/** What makes a quarter worth a headline, in football's words. Same shape as
 * basketball's so the shared play feed needs no branch - only the sport
 * changes, never the code that reads it. */
export const HIGHLIGHTS = [
  { key: "pass_yds", min: 90, hot: (n, v) => `${n} slinging it — ${v} yards`, mild: (n, v) => `${n} threw for ${v}` },
  { key: "rush_yds", min: 55, hot: (n, v) => `${n} running through them, ${v} yards`, mild: (n, v) => `${n} ground out ${v} yards` },
  { key: "rec_yds", min: 55, hot: (n, v) => `${n} can't be covered — ${v} yards`, mild: (n, v) => `${n} caught ${v} yards' worth` },
  { key: "ints", min: 1, hot: (n) => `${n} taking the ball away`, mild: (n) => `${n} came up with one` },
  { key: "fgs", min: 2, hot: (n, v) => `${n} perfect on ${v} kicks`, mild: (n) => `${n} split the uprights` },
];
