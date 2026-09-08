// Shot profiles: how a simulated point total was actually scored.
//
// THE TWO BUGS THIS FILE WAS REWRITTEN FOR, in one place, because everything
// below is shaped by them and a note at each site would be the same story four
// times.
//
// It used to work backwards from makes: split `points` into three-point,
// free-throw and two-point POINTS, round each share to a whole number of makes,
// then infer attempts from those makes.
//
//     tpm = round(pts3 / 3)
//     tpa = tpm > 0 ? max(tpm, round(tpm / tpp)) : 0
//
//   1. SHOOTERS TOOK NO THREES. The second line says outright that a player who
//      missed every three he took had taken none. The first rounds a per-quarter
//      expectation, and a real 2.9-attempt-per-game shooter at 43% expects about
//      0.3 made threes in a quarter - zero, in every quarter of every game,
//      forever. Measured over 300 games of Chris Mullin's 1992 season before the
//      rewrite: 0.00 3PA. Only players whose three-point SCORING share cleared
//      about 1.5 points a quarter ever produced one, which is why a handful of
//      high-volume shooters looked fine and everyone else shot none.
//
//   2. FREE THROWS COULD NOT MISS. Attempts were inferred from makes there too,
//      and `max(ftm, round(ftm / ftp))` on a quarter's one or two makes returns
//      the makes. Measured: 5.89 FTM on 5.89 FTA. That is the 35-of-35 team line
//      from the screenshots.
//
// THE MODEL NOW: VOLUME FIRST, MAKES SECOND.
//
//   ATTEMPTS come from the player's own recorded volume and the minutes he is
//   playing, nudged by how the night is going. Three-point attempts are a
//   BINOMIAL DRAW over those attempts at his real 3PA/FGA rate, so a shooter
//   shoots whether or not any of them fall.
//
//   MAKES reconcile to the engine's points, which stay authoritative and
//   untouched: the engine decides the score, this only answers where it came
//   from. Free throws are drawn at the player's own percentage rather than
//   back-solved, which is the whole of fix (2).
//
// The rule that predates the rewrite and survives it: a player may only take
// shots he actually took. Shaquille O'Neal's recorded tpa is 0, so his rate is
// 0, so every binomial over it is 0 - he cannot attempt a three, ever.
//
// ERA IS IN THE DATA, NOT IN A MULTIPLIER. A 1985 Chris Mullin took 0.5 threes a
// game and a 2021 Kevin Durant took 5.5, because that is what they did. Era
// therefore falls out of the seasons a roster drafted, and no synthetic era
// coefficient sits on top - one would be a fabricated statistic over a real one.
// See tactics.js for the single deliberate exception, a GAMESTYLE the player
// chose.
//
// Expected data per player (all per-game, percentages as 0-1): fga/fgp,
// tpa/tpp, fta/ftp. Players without a profile fall back to a points-only line,
// so the game keeps working on data that predates these fields.

/** How far a night's volume may run from a player's own average. The band is
 * what turns points into FG%: at the floor he is shooting well above his
 * average, at the ceiling well below. */
const VOLUME_FLOOR = 0.6;
const VOLUME_CEILING = 1.75;

/** Volume wobble, applied before the band clamps so it can never escape it. */
const VOLUME_JITTER = 0.16;

/** A guard on the divide that turns points into attempts. Nothing real is this
 * inefficient; it exists so a corrupt row cannot produce infinite attempts. */
const MIN_POINTS_PER_ATTEMPT = 0.5;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function hasShootingProfile(player) {
  return typeof player?.fga === "number" && typeof player?.fgp === "number" && player.fga > 0;
}

/**
 * Rounds 2.3 to 2 seventy percent of the time and to 3 the rest of it.
 *
 * Unbiased - its expected value is the input - which is what an expectation
 * below 0.5 needs. Ordinary rounding sends those to zero every single time, and
 * that is bug (1) in the header.
 */
export function stochasticRound(value, rand) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const whole = Math.floor(value);
  return whole + (rand() < value - whole ? 1 : 0);
}

/** n independent trials at probability p. n is a shot count - single digits per
 * quarter, tens per game - so the loop is the honest implementation rather than
 * a normal approximation that would need its own tail handling. */
function binomial(n, p, rand) {
  if (!(n > 0) || !(p > 0)) return 0;
  if (p >= 1) return n;
  let hits = 0;
  for (let i = 0; i < n; i++) if (rand() < p) hits += 1;
  return hits;
}

/**
 * A player's shot profile as RATES rather than per-game counts.
 *
 * Rates survive being scaled to a quarter, a rotation share or a different pace;
 * counts do not. Exported because scripts/verify-nba-shooting.mjs needs the same
 * answer this module uses, and a second derivation of it is a second answer.
 */
export function shotProfile(player) {
  if (!hasShootingProfile(player)) return null;
  const fga = player.fga;
  const tpa = Math.min(Math.max(player.tpa || 0, 0), fga);
  const tpp = clamp(player.tpp || 0, 0, 0.65);
  const fta = Math.max(player.fta || 0, 0);
  const ftp = clamp(player.ftp || 0.72, 0.35, 0.98);

  // Two-point accuracy backed out of overall FG% and three-point volume, so a
  // spot-up shooter and a rim-runner don't get the same inside percentage.
  const twos = Math.max(0.5, fga - tpa);
  const twoPct = clamp((fga * player.fgp - tpa * tpp) / twos, 0.28, 0.74);

  // The divisor that turns a segment's points into a segment's attempts. Points
  // per FIELD GOAL attempt with the free throws folded in, not per shot of any
  // kind - free throws are not attempts.
  const pointsPerFga = Math.max(
    MIN_POINTS_PER_ATTEMPT,
    (2 * twos * twoPct + 3 * tpa * tpp + fta * ftp) / fga
  );

  return {
    fga,
    // The share of his field goal attempts taken from three. THE TENDENCY -
    // this is what makes a shooter shoot, and it is his own recorded number.
    threeRate: fga > 0 ? tpa / fga : 0,
    // Free throw attempts per field goal attempt: how much contact he draws.
    ftRate: fga > 0 ? fta / fga : 0,
    twoPct,
    tpp,
    ftp,
    pointsPerFga,
    // The share of his scoring that comes from each source, used to decide
    // WHICH makes produce a segment's points.
    scoring: {
      three: 3 * tpa * tpp,
      ft: fta * ftp,
      two: 2 * twos * twoPct,
    },
  };
}

/**
 * Splits `points` into a full shooting line.
 *
 * @param points  the ENGINE's points over this segment - authoritative, and
 *                reproduced exactly by the returned line.
 * @param rand    injectable. The server runs the whole simulation inside a
 *                seeded Math.random, which is how two clients watching one
 *                online game see one box score.
 * @param opts.minutesShare  rotation share as a multiple of the 36-minute
 *                           baseline his per-game stats reflect. Drives ATTEMPT
 *                           VOLUME, so a bench line is a bench line.
 * @param opts.periodShare   the fraction of a game this segment is.
 * @param opts.shotMods      gamestyle { three, ft } tendency multipliers.
 * @returns null when the player has no profile, so callers can fall back.
 */
export function shotLine(player, points, rand = Math.random, opts = {}) {
  const profile = shotProfile(player);
  if (!profile) return null;

  const minutesShare = Number.isFinite(opts.minutesShare) && opts.minutesShare > 0 ? opts.minutesShare : 1;
  const periodShare = Number.isFinite(opts.periodShare) && opts.periodShare > 0 ? opts.periodShare : 1;
  const mods = opts.shotMods || null;

  // A gamestyle changes WHERE the shots come from, never what they are worth:
  // the pts multipliers in tactics.js are solved by
  // tools/calibrate-gamestyles.mjs and nothing here may disturb them.
  const threeRate = clamp(profile.threeRate * (mods?.three ?? 1), 0, 0.92);
  const ftRate = Math.max(0, profile.ftRate * (mods?.ft ?? 1));

  const pts = Math.max(0, Math.round(points));

  // ---- ATTEMPTS COME FIRST ------------------------------------------------
  // What his own volume says this segment is worth, before anything happened in
  // it. Minutes rather than points, which is what makes a 6-point quarter on 9
  // shots different from a 6-point quarter on 4.
  const volumeFga = profile.fga * minutesShare * periodShare;
  // ...and what the points say. Attempts follow them inside a band around the
  // volume, so the PERCENTAGE is what gives - a hot night and a cold one.
  const impliedFga = pts / profile.pointsPerFga;
  const jitter = 1 + (rand() * 2 - 1) * VOLUME_JITTER;
  const targetFga = clamp(impliedFga * jitter, volumeFga * VOLUME_FLOOR, volumeFga * VOLUME_CEILING);

  let fga = stochasticRound(targetFga, rand);
  // Threes are drawn over those attempts, at his rate. A binomial rather than a
  // proportion, so a roster of shooters producing zero in a game is possible and
  // rare rather than routine.
  let tpa = binomial(fga, threeRate, rand);
  // ftRate already carries the gamestyle's free-throw-rate mod (see above).
  let fta = stochasticRound(fga * ftRate, rand);

  // ---- FREE THROWS ARE THEIR OWN COIN ------------------------------------
  // Drawn at his real percentage over the attempts he earned, not back-solved
  // from points. That is the whole of fix (2): makes and attempts are two
  // numbers instead of one, so a 78% shooter misses about 22% of them.
  let ftm = Math.min(fta, binomial(fta, profile.ftp, rand));

  // ---- MAKES CARRY THE POINTS --------------------------------------------
  // The engine's points are authoritative. Free throws are already settled, so
  // what is left has to come out of the field goals, split between twos and
  // threes in the proportion this player actually scores in.
  //
  // ORDER MATTERS, and it is the opposite of what reads naturally: the threes
  // are decided FIRST, from tendency, and the free-throw line absorbs the
  // leftover arithmetic. The other way round produced a 20% three-point
  // percentage for a 41% shooter, because 3 * tpm + 2 * fg2m only reaches totals
  // whose parity matches and "make the threes fit" deletes about half of them.
  const carry = opts.carry || null;
  const owed = () => (carry ? carry.ft || 0 : 0);
  const noteCarry = (delta) => { if (carry) carry.ft = owed() + delta; };
  // Attempts a previous give ADDED, waiting to be unwound by the take that pays
  // it back. Without it the pair balances in makes only, and a 91% shooter read
  // as an 81% one.
  const owedAttempts = () => (carry ? carry.fta || 0 : 0);

  let fgPoints = pts - ftm;
  // A points total the free throws already overshot. Give it back as whole
  // trips to the line - attempt AND make together - so handing points back
  // cannot quietly move his free-throw percentage.
  while (fgPoints < 0 && ftm > 0) { ftm -= 1; fta -= 1; fgPoints += 1; }
  if (fgPoints < 0) fgPoints = 0;

  const weightThree = 3 * tpa * profile.tpp;
  const weightTwo = 2 * Math.max(0, fga - tpa) * profile.twoPct;
  const weightTotal = weightThree + weightTwo;
  const tpmCeiling = () => Math.min(tpa, Math.floor(fgPoints / 3));
  let tpm = 0;
  if (tpmCeiling() > 0 && weightTotal > 0) {
    tpm = clamp(stochasticRound((fgPoints * weightThree) / weightTotal / 3, rand), 0, tpmCeiling());
  }

  // 3 * tpm + 2 * fg2m is a whole number of twos exactly when tpm and fgPoints
  // share a parity. When they do not, ONE point has to move, and the cheapest
  // place to move it is the free-throw line - a made free throw turned into a
  // miss, or a miss into a make, WITHIN THE ATTEMPTS ALREADY DRAWN. That leaves
  // the attempt count (which is the honest, volume-derived number) untouched
  // and moves the percentage by one make.
  //
  // WHICH DIRECTION IS NOT A COIN FLIP. The old reconciliation loop could only
  // ever ADD made free throws, so over four quarters every player was handed
  // about two free points a game at 100% - both why team free-throw lines read
  // 30-for-30 and why field-goal percentages came out several points low, since
  // those points were taken off the field goals. `carry` remembers what this
  // player has already been given or charged this game and pays it back at the
  // next opportunity, so the adjustment nets to roughly zero over a game.
  if (((fgPoints - 3 * tpm) & 1) === 1) {
    // ONE POINT HAS TO MOVE, AND THE CHOICE IS WHERE IT COSTS LEAST: whichever
    // unit has more attempts behind it, because one make in eight moves a
    // percentage far less than one make in two. A jump shooter pays it in
    // threes; a centre who cannot shoot one pays it at the line.
    //
    // EITHER WAY THE DIRECTION ALTERNATES. The old reconciliation loop could
    // only ADD made free throws - two free points a game at 100%, which is both
    // why lines read 30-for-30 and why field-goal percentages came out low.
    // `carry` remembers what this player has been given or charged and pays it
    // back at the next opportunity, in makes AND in attempts.
    const threeChannelOpen = tpmCeiling() >= 1 && tpa > 0;
    const preferThrees = threeChannelOpen && tpa > fta;

    const shiftThrees = () => {
      const owedTp = carry ? carry.tp || 0 : 0;
      const up = tpm + 1 <= tpmCeiling();
      const down = tpm - 1 >= 0;
      let delta;
      if (up && down) delta = owedTp > 0 ? -1 : owedTp < 0 ? 1 : rand() < 0.5 ? 1 : -1;
      else if (up) delta = 1;
      else if (down) delta = -1;
      else return false;
      tpm += delta;
      if (carry) carry.tp = owedTp + delta;
      return true;
    };

    // Giving is a drawn miss turned into a make when there is one to turn, and
    // otherwise a fresh trip to the line whose ATTEMPTS are drawn at his own
    // percentage - never a single guaranteed make, which is what makes a 91%
    // shooter read 100%.
    const missAvailable = fta > ftm;
    const givePoint = () => {
      ftm += 1;
      if (!missAvailable) {
        const added = Math.max(1, stochasticRound(1 / profile.ftp, rand));
        fta += added;
        if (carry) carry.fta = owedAttempts() + added;
      }
      fgPoints -= 1;
      noteCarry(1);
    };
    const takePoint = () => {
      ftm -= 1;
      fgPoints += 1;
      noteCarry(-1);
      // Unwind whatever a previous give bought, never below the makes standing.
      const back = Math.min(owedAttempts(), fta - ftm);
      if (back > 0) {
        fta -= back;
        if (carry) carry.fta = owedAttempts() - back;
      }
    };
    const shiftFreeThrows = () => {
      // Giving lowers the points left for field goals, which could strand the
      // threes above their new ceiling; taking never can.
      const canGive = 3 * tpm <= fgPoints - 1;
      const canTake = ftm > 0;
      if (canGive && canTake) {
        if (owed() > 0) takePoint();
        else if (owed() < 0) givePoint();
        else if (rand() < 0.5) takePoint();
        else givePoint();
      } else if (canTake) takePoint();
      else if (canGive) givePoint();
      else return false;
      return true;
    };

    const settled = preferThrees
      ? shiftThrees() || shiftFreeThrows()
      : shiftFreeThrows() || shiftThrees();
    if (!settled) {
      // Neither channel could take it: no free-throw attempt drawn and no three
      // available. He got to the line for it - one whole trip, which is the only
      // honest way to score one point in basketball.
      ftm += 1;
      fta += 1;
      fgPoints -= 1;
      noteCarry(1);
    }
  }
  if (3 * tpm > fgPoints) tpm = Math.max(0, tpmCeiling());
  let fg2m = Math.max(0, Math.floor((fgPoints - 3 * tpm) / 2));

  // ---- ATTEMPTS MUST COVER THE MAKES -------------------------------------
  // A make with no attempt behind it is the failure this whole file exists to
  // avoid. Raising the attempt rather than dropping the make is what keeps the
  // engine's points exact - the score is never negotiable.
  if (tpm > tpa) tpa = tpm;
  const fgm = fg2m + tpm;
  if (tpa > fga) fga = tpa;
  if (fg2m > fga - tpa) fga = fg2m + tpa;

  return {
    fgm,
    fga,
    tpm,
    tpa,
    ftm,
    fta,
    // Exact, by construction. No caller reconciles this against the engine any
    // more, and scripts/verify-nba-shooting.mjs fails on a single point of
    // drift over a hundred thousand lines.
    points: fg2m * 2 + tpm * 3 + ftm,
  };
}

/**
 * One player's whole game, quarter by quarter.
 *
 * THE GAME LINE IS DERIVED FIRST, AND THEN DEALT OUT, for a reason that is
 * arithmetic rather than taste. A ten-man rotation splits 240 minutes and about
 * 90 points, so the average player-quarter in a Ranked game is 2.2 points -
 * measured over 120 games, and seventy per cent of them are one or two. A made
 * three is worth three, so a model deriving a quarter's makes from that
 * quarter's points can never place one in the seventy per cent: floor(2/3) is
 * zero. That produced a 15% three-point percentage for rosters whose real one is
 * 38 - plenty of attempts, almost no makes.
 *
 * So the split is computed once over the whole game, where a starter has fifteen
 * to thirty points and every percentage comes out right, and then allocated
 * across the periods under the one constraint the play-by-play depends on:
 * EVERY PERIOD'S SHOTS ADD UP TO THAT PERIOD'S POINTS.
 *
 * @returns { periods, total }, where `total` is literally the sum of `periods` -
 *          the box score and the periods under it must not be two derivations.
 */
export function buildQuarterShotLines(player, quarterPoints, rand = Math.random, opts = {}) {
  if (!hasShootingProfile(player)) return null;
  const points = quarterPoints.map((p) => Math.max(0, Math.round(Number(p) || 0)));
  const shares = opts.periodShares || null;
  const evenShare = opts.periodShare || 1 / Math.max(1, points.length);
  const gameShare = shares ? shares.reduce((sum, v) => sum + v, 0) : evenShare * points.length;

  const total = points.reduce((sum, p) => sum + p, 0);
  const line = shotLine(player, total, rand, { ...opts, periodShare: gameShare });
  if (!line) return null;

  const makes = { three: line.tpm, two: line.fgm - line.tpm, ft: line.ftm };
  const perPeriodMakes = allocateMakes(makes, points, rand);

  // A QUARTER THAT COULD ONLY HAVE BEEN A FREE THROW GETS ITS ATTEMPTS TOO.
  // A one-point quarter has one explanation, so the allocation produces a made
  // free throw even when the game line had none left. That is right - but a make
  // with no attempt behind it is a make at 100%, and enough of them is 35 for
  // 35. Each forced make is charged one attempt over his own percentage.
  const profile = shotProfile(player);
  const placedFt = perPeriodMakes.reduce((sum, made) => sum + made.ft, 0);
  const forcedFt = Math.max(0, placedFt - line.ftm);
  const forcedAttempts = forcedFt > 0 ? stochasticRound(forcedFt * (1 / profile.ftp - 1), rand) : 0;

  const perPeriodMisses = allocateMisses(
    {
      three: Math.max(0, line.tpa - line.tpm),
      two: Math.max(0, line.fga - line.tpa - (line.fgm - line.tpm)),
      ft: Math.max(0, line.fta - line.ftm) + forcedAttempts,
    },
    points,
    shares,
    rand
  );

  const periods = points.map((p, i) => {
    const made = perPeriodMakes[i];
    const missed = perPeriodMisses[i];
    const tpm = made.three;
    const tpa = tpm + missed.three;
    const fgm = made.three + made.two;
    const fga = fgm + missed.three + missed.two;
    return { fgm, fga, tpm, tpa, ftm: made.ft, fta: made.ft + missed.ft, points: p };
  });

  // THE TOTAL IS THE SUM OF THE PERIODS, always - never the line computed above.
  // The allocation can legitimately fail to place a three (four one-point
  // quarters cannot hold one), and when it does, the periods are the truth and
  // the game line follows them. A box score whose columns did not equal the sum
  // of its own quarters would be two answers to one question.
  const summed = emptyShotLine();
  for (const period of periods) addShotLine(summed, period);
  return { periods, total: summed };
}

/**
 * Deals a game's MAKES out to its periods so each period's points come out exact.
 *
 * Threes first (they need three points of room), then free throws (the only
 * one-point unit, and so the only thing that can close an odd remainder), then
 * twos. Anything that cannot be placed is not placed - the periods are the truth
 * and the caller's game line follows them.
 */
function allocateMakes(makes, points, rand) {
  const out = points.map(() => ({ three: 0, two: 0, ft: 0 }));
  // Biggest quarters first. A three needs three points of room and the big
  // quarters are the only ones that reliably have it, so they get first refusal;
  // going in period order instead would spend the threes on whichever quarter
  // happened to come first.
  const order = points.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);

  let threesLeft = makes.three;
  let twosLeft = makes.two;
  let ftLeft = makes.ft;

  // ---- phase one: the threes ----------------------------------------------
  let roomLeft = order.reduce((sum, { p }) => sum + Math.floor(p / 3), 0);
  for (const { p, i } of order) {
    const room = Math.floor(p / 3);
    roomLeft -= room;
    if (threesLeft <= 0 || room <= 0) continue;
    // Proportional to the room this quarter has, so a 12-point quarter takes
    // more of them than a 4-point one.
    const want = roomLeft + room > 0 ? (threesLeft * room) / (roomLeft + room) : 0;
    let give = Math.min(room, threesLeft, stochasticRound(want, rand));
    // PARITY IS PART OF THE CHOICE. What is left after the threes is odd exactly
    // when `give` and `p` disagree in parity, and an odd remainder can only be
    // closed by an odd number of free throws - so a wrong-parity three count
    // spends a free throw on arithmetic rather than basketball. Nudging by one,
    // inside the room and the pool the quarter already has, spends a three the
    // player was taking anyway on the same job.
    // ONLY UPWARD. Nudging DOWN also fixes the parity, and costs a three -
    // which is a shooter's whole identity. It is also the more common branch,
    // because an even quarter with room for exactly one three (four points: a
    // three and a free throw, which is an ordinary way to score four) wants an
    // even count and would therefore always take zero. Left alone, the odd
    // point goes to the free-throw line instead, which is both cheaper and true.
    if ((give & 1) !== (p & 1) && give + 1 <= Math.min(room, threesLeft)) give += 1;
    out[i].three = give;
    threesLeft -= give;
  }
  // Anything the proportional pass could not place goes wherever there is still
  // room. A three that cannot be placed at all - four one-point quarters cannot
  // hold one - is dropped, and the caller's game line follows the periods rather
  // than the other way round.
  for (const { p, i } of order) {
    while (threesLeft > 0 && 3 * (out[i].three + 1) <= p) {
      out[i].three += 1;
      threesLeft -= 1;
    }
  }

  // ---- phase two: free throws, then twos ----------------------------------
  //
  // EVERY QUARTER CLOSES EXACTLY. An odd remainder needs an odd number of free
  // throws, and since the remainder is at least one, one is always available -
  // which is what makes this loop unable to leave a quarter short, whatever the
  // pools have left.
  // SMALLEST QUARTERS FIRST, the reverse of the three-point pass, and not an
  // accident: a one-point quarter has exactly one way to exist and must draw
  // from the pool before the quarters that have a choice spend it. Biggest-first
  // let a twelve-point quarter take free throws it could have scored with twos,
  // and the one-point quarters then invented theirs at a hundred per cent.
  const byNeed = [...order].reverse();
  let pointsLeft = points.reduce((sum, p) => sum + p, 0);
  for (const { p, i } of byNeed) {
    const rem = p - 3 * out[i].three;
    pointsLeft -= p;
    if (rem <= 0) continue;
    const want = pointsLeft + p > 0 ? (ftLeft * p) / (pointsLeft + p) : 0;
    // PARITY IS A CONSTRAINT ON THE DRAW, NOT A CORRECTION AFTER IT. The draw is
    // over the legal values directly - 1, 3, 5... or 0, 2, 4... - because
    // rounding freely and nudging by one has to pick a direction, and preferring
    // "up" turned a drawn 1 in an even quarter into 2, spending a free throw an
    // odd quarter later then had to invent. Measured: +1.16 made free throws per
    // player per game, all of them makes.
    const parity = rem & 1;
    const steps = Math.max(0, stochasticRound(Math.max(0, want - parity) / 2, rand));
    let ft = parity + 2 * steps;
    // Back down to what the quarter and the pool can actually carry, in steps of
    // two so the parity survives.
    const ceiling = Math.min(rem, Math.max(parity, ftLeft));
    while (ft > ceiling) ft -= 2;
    if (ft < 0) ft = parity;
    out[i].ft = ft;
    out[i].two = (rem - ft) / 2;
    // A dry pool still has to close the quarter; the shortfall shows up as a
    // game line one make different from the one derived.
    ftLeft = Math.max(0, ftLeft - ft);
    twosLeft = Math.max(0, twosLeft - out[i].two);
  }
  void twosLeft;

  return out;
}

/**
 * Deals a game's MISSES out to its periods. Nothing constrains these - a miss is
 * worth no points, so a scoreless quarter can and should still contain shots.
 * Spread by each period's share of the game, leaning toward the periods he
 * scored in.
 */
function allocateMisses(misses, points, shares, rand) {
  const n = points.length;
  const weights = points.map((p, i) => {
    const share = shares ? shares[i] ?? 1 / n : 1 / n;
    // The +1 is what stops a scoreless quarter being a quarter he did not shoot
    // in. A 0-for-4 stretch is a real thing that happens.
    return share * (p + 1);
  });
  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;
  const out = points.map(() => ({ three: 0, two: 0, ft: 0 }));
  for (const kind of ["three", "two", "ft"]) {
    let left = misses[kind];
    let weightLeft = totalWeight;
    for (let i = 0; i < n && left > 0; i++) {
      const give = i === n - 1 ? left : Math.min(left, stochasticRound((left * weights[i]) / weightLeft, rand));
      out[i][kind] = give;
      left -= give;
      weightLeft -= weights[i];
    }
  }
  return out;
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

/** An empty shooting line, so callers that must show a row for a player who
 * did not shoot have one shape to use rather than inventing zeros inline. */
export function emptyShotLine() {
  return { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, points: 0 };
}

/** Adds `src` into `dst` in place. The per-quarter lines are summed into a
 * game line in exactly one place - here - so a box score total and the sum of
 * its periods cannot disagree. */
export function addShotLine(dst, src) {
  if (!src) return dst;
  for (const key of ["fgm", "fga", "tpm", "tpa", "ftm", "fta", "points"]) {
    dst[key] = (dst[key] || 0) + (src[key] || 0);
  }
  return dst;
}
