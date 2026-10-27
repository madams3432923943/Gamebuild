// What to call a drafted entry out loud.
//
// Extracted from js/ui.js alongside renderNote and the roster-slot helpers, and
// for the same reason: the draft board, the box score and the rotation picker
// all need these, so leaving them beside any one of those makes the other two
// impossible to move.
//
// Both ask the ACTIVE SPORT rather than sniffing the row's shape. That is not
// tidiness - shortPlayerName used to guess whether a row was a unit by looking
// at its fields, and every football draft board read "G. Bay Packers Offensive
// Line" as a result. isUnit and unitLabel are part of the sport contract now.

import { activeSport } from "../sports/index.js";

export /**
 * A drafted entry's name, for a screen that already says which team it is.
 *
 * Every place this is used prints the team beside it - the squad banner over
 * the draft board, the season line in the roster panel, the box score's own
 * meta row - so a unit's full name ("Baltimore Ravens Offensive Line") says
 * the team twice and pushes the part that distinguishes it off the end of a
 * phone-width row.
 *
 * NOT used for the record books. A personal best is stored as a name and read
 * back on its own, with no team anywhere near it, and "Offensive Line" is not
 * a record holder. Those render the stored string and are untouched by this.
 */
function displayEntryName(player) {
  const sport = activeSport();
  return sport.isUnit(player) ? sport.unitLabel(player) : player?.name ?? "";
}

export function shortPlayerName(player) {
  if (activeSport().isUnit(player)) return displayEntryName(player);
  const parts = String(player.name || "").trim().split(/\s+/);
  if (parts.length < 2) return player.name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

/** "2023 Mavericks" - which version of a player is actually on the roster.
 *
 * The year is the point. Two people can both draft Doncic off the Mavs 2020s
 * and end up with different players, so a card reading only "Luka Doncic
 * (Dallas Mavericks 2020s)" hides the half of the pick that was a decision.
 *
 * Nickname rather than the full team name because the season goes in front of
 * it and "2023 Dallas Mavericks" is a mouthful that wraps on a phone. The last
 * word is how every one of these teams is spoken about - Mavericks, Lakers,
 * Blazers, SuperSonics - so it needs no lookup table to stay right.
 *
 * Moved here from js/ui/draft-board.js once the rotation and matchup screens
 * needed the same line under each name.
 *
 * Falls back to the decade for any row with no season, so a dataset that
 * hasn't been rebuilt still renders something true.
 */
export function seasonLabel(player) {
  const nickname = String(player.team || "").split(" ").pop();
  // Through the SPORT's own hook: basketball's 2012 is the 2012-13 season and
  // has to say so, football's 2019 is already its whole name. The decade
  // fallback is left bare - "2010s" is not a season and has no span to write.
  const season = player.season ? activeSport().seasonLabel(player.season) : player.decade;
  return `${season} ${nickname}`;
}
