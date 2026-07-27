// Shot splits: turning a simulated point total into a believable line like
// "8/14 FG, 4/7 3PT, 3/4 FT".
//
// The design constraint that drives everything here: a player must only ever
// take shots they actually took. Shaquille O'Neal cannot attempt a three, in
// any game, ever - not rarely, not once. So the split is never invented from
// position or point total; it is derived from that player's own recorded shot
// profile, and a player with zero three-point attempts mathematically cannot
// produce one.
//
// Points stay the driver. The engine already simulates a point total through
// matchups, tactics and variance, and that total is what decides games. This
// module only answers "where did those points come from", which means the
// split always reconciles with the score and none of the existing balance
// work is disturbed.
//
// Expected data per player (all per-game, percentages as 0-1):
//   fga, fgp   overall field goals
//   tpa, tpp   three-pointers - tpa MUST be 0 for anyone who didn't shoot them,
//              including every player before the line existed in 1979-80
//   fta, ftp   free throws
// Players without a profile fall back to a points-only line, so the game keeps
// working on data that predates these fields.

const VARIANCE = 0.28; // how hot or cold a night can run

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function hasShootingProfile(player) {
  return typeof player.fga === "number" && typeof player.fgp === "number";
}

/**
 * Splits `points` into makes and attempts using the player's shot profile.
 * @returns null when the player has no profile, so callers can fall back.
 */
export function shotLine(player, points) {
  if (!hasShootingProfile(player) || points <= 0) return null;

  const tpa = player.tpa || 0;
  const tpp = player.tpp || 0;
  const fta = player.fta || 0;
  const ftp = player.ftp || 0;

  // What a typical game of theirs is made of.
  const basePts = Math.max(1, player.ppg);
  const threePts = tpa * tpp * 3;
  const ftPts = fta * ftp;
  const twoPts = Math.max(0, basePts - threePts - ftPts);
  const total = threePts + ftPts + twoPts || 1;

  // Shares of scoring, then a per-game wobble so nights differ. A player with
  // tpa === 0 has share3 === 0 and stays there through every step below.
  const jitter = () => 1 + (Math.random() * 2 - 1) * VARIANCE;
  const share3 = (threePts / total) * (tpa > 0 ? jitter() : 0);
  const shareFt = (ftPts / total) * jitter();
  const share2 = Math.max(0, 1 - share3 - shareFt);

  const pts3 = points * share3;
  const ptsFt = points * shareFt;
  const pts2 = points * share2;

  const tpm = tpa > 0 ? Math.max(0, Math.round(pts3 / 3)) : 0;
  const ftm = Math.max(0, Math.round(ptsFt));
  const fg2m = Math.max(0, Math.round(pts2 / 2));

  // Attempts follow from makes and the player's accuracy, with a floor so a
  // make can never come from fewer attempts than makes.
  const tpAtt = tpm > 0 ? Math.max(tpm, Math.round(tpm / clamp(tpp || 0.33, 0.15, 0.6))) : 0;
  const ftAtt = ftm > 0 ? Math.max(ftm, Math.round(ftm / clamp(ftp || 0.72, 0.4, 0.95))) : 0;

  // Two-point accuracy backed out of overall FG% and three-point volume, so a
  // spot-up shooter and a rim-runner don't get the same inside percentage.
  const fgMakes = player.fga * player.fgp;
  const twoPct = clamp((fgMakes - tpa * tpp) / Math.max(0.5, player.fga - tpa), 0.3, 0.72);
  const fg2Att = fg2m > 0 ? Math.max(fg2m, Math.round(fg2m / twoPct)) : 0;

  return {
    fgm: fg2m + tpm,
    fga: fg2Att + tpAtt,
    tpm,
    tpa: tpAtt,
    ftm,
    fta: ftAtt,
    // Points implied by the split. Reconciled against the simulated total by
    // the caller so the box score never contradicts the scoreboard.
    points: fg2m * 2 + tpm * 3 + ftm,
  };
}

/** "8/14 FG · 4/7 3PT · 3/4 FT", omitting sections a player didn't attempt so
 * a center's line never shows an empty three-point split. */
export function formatShotLine(line) {
  if (!line) return "";
  const parts = [`${line.fgm}/${line.fga} FG`];
  if (line.tpa > 0) parts.push(`${line.tpm}/${line.tpa} 3PT`);
  if (line.fta > 0) parts.push(`${line.ftm}/${line.fta} FT`);
  return parts.join(" · ");
}

/** A shooting night worth mentioning: efficient volume, or a cold snap. Used
 * for post-game narrative, so it only fires on real outliers. */
export function shootingNote(playerName, line) {
  if (!line || line.fga < 6) return null;
  const pct = line.fgm / line.fga;
  if (line.tpa >= 5 && line.tpm / line.tpa >= 0.5) {
    return `${playerName} caught fire from deep, ${line.tpm}/${line.tpa} from three`;
  }
  if (pct >= 0.6) return `${playerName} was ruthless, ${line.fgm}/${line.fga} from the field`;
  if (pct <= 0.3) return `${playerName} never found it, ${line.fgm}/${line.fga} shooting`;
  return null;
}
