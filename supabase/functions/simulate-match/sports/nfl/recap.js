// Post-game writing, built from the drive log rather than from the scoreboard.
//
// This is the payoff for making `drives` a first-class engine return. A recap
// written off final scores can only say who won and by how much; one written
// off drives can say the game turned on three straight takeaways in the second
// quarter, and name the unit that got them. The second is worth reading.

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

/** Drive-by-drive, which IS the game script in football - the thing the UI
 * scrolls through while the ball moves up and down the field. */
export function buildGameScript(result) {
  return result.drives.map((d) => ({
    period: d.quarter,
    side: d.team,
    text: d.text,
    startYard: d.startYard,
    endYard: d.endYard,
    points: d.points,
  }));
}

/** Why you won or lost, in terms of the picks that caused it. Reads the
 * side ratings the engine already computed rather than recomputing them, so
 * the explanation cannot disagree with the simulation it explains. */
export function buildPostGameAnalysis(result, side = "A") {
  const a = result.analysis || {};
  const mine = side === "A" ? { off: a.offA, def: a.defA } : { off: a.offB, def: a.defB };
  const theirs = side === "A" ? { off: a.offB, def: a.defB } : { off: a.offA, def: a.defA };
  const notes = [];

  const offGap = (mine.off ?? 0.5) - (theirs.def ?? 0.5);
  const defGap = (mine.def ?? 0.5) - (theirs.off ?? 0.5);

  notes.push(offGap > 0.05
    ? "Your offence outclassed the defence it faced."
    : offGap < -0.05
      ? "Their defence was better than your offence."
      : "The offences and defences were evenly matched.");
  notes.push(defGap > 0.05
    ? "Your defence held up better than their offence."
    : defGap < -0.05
      ? "Their offence was too much for your defence."
      : "Neither defence had a clear edge.");

  const mySide = result.drives.filter((d) => d.team === side);
  const stalls = mySide.filter((d) => d.outcome === "downs").length;
  if (stalls >= 2) notes.push(`${stalls} of your drives stalled in kicking range - the ST pick showed.`);

  return notes.join(" ");
}
