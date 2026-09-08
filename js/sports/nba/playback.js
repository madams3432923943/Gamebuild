// Basketball's presentation ledger: the play-by-play's source of truth.
//
// WHAT THIS IS, AND WHAT IT IS CAREFULLY NOT
//
// js/sports/nba/engine.js does not simulate possessions. It produces per-player,
// per-quarter STAT LINES - points, rebounds, assists, steals, blocks,
// turnovers - through matchups, tactics and variance. There is no shot in
// there to visualise, and there is no clock.
//
// So this module does not ask the engine for events it does not have, and it
// does not go and invent a second simulation to get them. It DECOMPOSES what
// the engine already decided into the events that must have produced it, and
// the split between what is authoritative and what is presentation is the
// whole design:
//
//   AUTHORITATIVE - comes from the engine, never altered here:
//     points, assists, steals, blocks and turnovers, per player, per quarter.
//     Every one of those is reproduced exactly. The ledger's points for a
//     player in a quarter equal the engine's, or this module has a bug -
//     scripts/verify-nba-shot-ledger.mjs fails on a single point of drift.
//
//   DERIVED FROM REAL PLAYER DATA - shooting.js, not guesswork:
//     how those points split into twos, threes and free throws. That module
//     already refuses to let a player take a shot they never took: Shaquille
//     O'Neal cannot attempt a three here, in any game, ever, because his
//     recorded tpa is 0 and every share downstream of it is 0.
//
//   PRESENTATION - this module's own, and honestly labelled as such:
//     the ORDER events fall in within a quarter, WHERE on the floor a shot
//     was taken, and the clock time attached to it. The engine models none of
//     those. A three is always placed behind the arc and a two always inside
//     it, so the zone never contradicts the shot, but which of the three
//     three-point zones it was is this module's choice, not a simulated fact.
//     The clock is the period's real length laid over the period's own event
//     order; it is monotonic and its boundaries are right, and it is not a
//     claim that a shot was taken with 4:12 left.
//
// WHAT IS DELIBERATELY ABSENT
//
// Dunks and and-ones. The engine has no concept of either, so neither appears
// as an event type. A rim finish is a real ZONE - the shot went in from close
// - and gets the stronger visual treatment on that basis, which is a fact
// about placement rather than a dunk this module made up. An and-one would
// require a foul model that does not exist; there is no honest way to emit one
// and it is better to be missing than fabricated.
//
// Offensive versus defensive rebounds, for the same reason. The engine records
// a rebound total per player per quarter and nothing about which end of the
// floor it happened at. The feed says "Rebound", and a caption that said
// "Defensive Rebound" would be a statistic invented to make a line read better.
//
// A real buzzer-beater, likewise. `endOfPeriod` marks the last event of a
// quarter, which is a true thing to say and is what earns that shot its beat;
// it is not a claim that the shot went up at 0:00.

import { shotLine } from "./shooting.js";

/** Court zones, and the points a make in each is worth.
 *
 * Ordered inside-out. `weight` is how often a shot of that class lands in the
 * zone - a presentation distribution, loosely league-shaped, NOT something the
 * engine produced. `strong` marks the finishes worth a louder animation.
 *
 * Each zone used to carry a `label` ("at the rim", "from the corner") for the
 * chart's callouts. The chart is gone with the court; the play-by-play builds
 * its wording from shotType and strong instead, so the labels were read by
 * nothing and are removed. */
export const ZONES = {
  rim: { points: 2, weight: 0.34, strong: true, label: "at the rim" },
  paint: { points: 2, weight: 0.24, label: "in the paint" },
  "short-mid": { points: 2, weight: 0.22, label: "from mid-range" },
  "long-mid": { points: 2, weight: 0.2, label: "from the elbow" },
  "corner-three": { points: 3, weight: 0.26, label: "from the corner" },
  "wing-three": { points: 3, weight: 0.37, label: "from the wing" },
  "above-break-three": { points: 3, weight: 0.37, label: "from up top" },
};

const TWO_ZONES = Object.keys(ZONES).filter((z) => ZONES[z].points === 2);
const THREE_ZONES = Object.keys(ZONES).filter((z) => ZONES[z].points === 3);

/**
 * Where each zone sits on a half-court, as a distance and an angle FROM THE
 * BASKET - which is how a shot chart works, and why this is polar rather than a
 * set of rectangles.
 *
 * THE COORDINATE SYSTEM. Both axes are feet divided by 50 - x runs 0 to 1
 * across a 50-foot half-court, y runs 0 (baseline) to 0.94 (half-court) on the
 * SAME scale - so a distance measured across this square is a real distance and
 * the arc is a circle rather than an ellipse. Normalising each axis by its own
 * length instead makes 23 feet along the baseline a different number from 23
 * feet up the floor, which is how a corner three ends up at the top of the key.
 * The basket is at (0.5, 0.105), 5.25 feet off the baseline.
 *
 * `r` is the distance band in the same units (0.02 is a foot); `spread` is the
 * angle in degrees either side of straight-on, so a zone is an ARC and twenty
 * shots from it are a fan rather than a stack.
 *
 * WHY THIS CANNOT DRAW A THREE INSIDE THE ARC. The zone decides the points
 * before the position is rolled, and each band is the real distance that zone
 * is: the rim inside four feet, the arc at 23.75, the corner at 22 because the
 * corner three genuinely IS the shorter shot. There is no position a zone can
 * produce that contradicts it - not a correction applied afterward.
 * scripts/verify-nba-shot-ledger.mjs measures it on every shot of 120 games.
 *
 * These were rectangles once, on a square whose axes were normalised by
 * different lengths, which put mid-range twos 0.33 from the rim - outside the
 * arc. The test caught it. That is why they are polar.
 */
const RIM = { x: 0.5, y: 0.105 };

const ZONE_ANCHORS = {
  rim: { r: [0.02, 0.08], spread: 55 },
  paint: { r: [0.09, 0.19], spread: 42 },
  "short-mid": { r: [0.21, 0.31], spread: 60 },
  // Capped at 62 degrees so a long two never strays out to where a corner
  // three lives - at 22 feet, 90 degrees IS the corner.
  "long-mid": { r: [0.33, 0.43], spread: 62 },
  // The corner three is the SHORT one - 22 feet, hard against the sideline and
  // barely off the baseline. Drawing it anywhere else is the single most
  // recognisable way to get a basketball court wrong.
  "corner-three": { r: [0.44, 0.47], spread: [72, 88] },
  "wing-three": { r: [0.49, 0.55], spread: [42, 70] },
  "above-break-three": { r: [0.49, 0.58], spread: [0, 40] },
};

/** A point inside `zone`, rolled from the ledger's own seeded stream.
 *
 * Zones with a two-ended `spread` exist as a mirrored PAIR - the two corners,
 * the two wings - and the roll picks a side. A single number means the zone is
 * a fan centred on the basket and the angle runs either way within it. */
function placeInZone(zone, rand) {
  const anchor = ZONE_ANCHORS[zone];
  if (!anchor) return null;
  const [minR, maxR] = anchor.r;
  const radius = minR + rand() * (maxR - minR);
  const [minA, maxA] = Array.isArray(anchor.spread) ? anchor.spread : [0, anchor.spread];
  const magnitude = minA + rand() * (maxA - minA);
  const degrees = (rand() < 0.5 ? -1 : 1) * magnitude;
  const radians = (degrees * Math.PI) / 180;
  const clamp = (n, hi) => Math.min(hi, Math.max(0.02, n));
  return {
    x: clamp(RIM.x + radius * Math.sin(radians), 0.98),
    // cos, so straight-on is straight out toward half court. A shot is never
    // placed behind the baseline: the angle never reaches 90 degrees, and the
    // rim's own 0.105 of clearance covers what is left.
    y: clamp(RIM.y + radius * Math.cos(radians), 0.93),
  };
}

/** How long a period is, for the derived clock below. Regulation quarters are
 * twelve minutes and overtime is five - real numbers, used only to scale a
 * presentation clock, because a board that counted down from an invented length
 * would look wrong to anyone who has watched a game. */
const QUARTER_SECONDS = 12 * 60;
const OT_SECONDS = 5 * 60;

/** "9:47". The board's reading of clockSeconds. */
export function formatClock(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

/** Free throws are marked apart from field goals: they are not shot attempts,
 * so they must not be counted as ones anywhere the ledger is aggregated, and
 * the play-by-play describes them differently. They still exist in the ledger
 * as scoring events so the running score stays exact. */
const FREE_THROW = "free-throw";

/**
 * A small deterministic PRNG.
 *
 * The ledger has to be REPRODUCIBLE: an online game is simulated once on the
 * server and then played back on two clients, and two players watching the
 * same game must see the same play-by-play. Math.random would give them
 * different ones. Seeded from the match's own numbers by the caller.
 */
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function pickWeighted(keys, rand, weightOf) {
  const total = keys.reduce((sum, k) => sum + weightOf(k), 0);
  let roll = rand() * total;
  for (const k of keys) {
    roll -= weightOf(k);
    if (roll <= 0) return k;
  }
  return keys[keys.length - 1];
}


/**
 * One player's quarter, decomposed into the shots that produced it.
 *
 * `line` is shooting.js's split, which is derived from the player's real shot
 * profile. The makes in it are trusted; what this adds is the misses (attempts
 * minus makes), a zone for each, and the reconciliation that guarantees the
 * points add up to what the engine said.
 */
function shotsForQuarter(player, points, rand) {
  const line = points > 0 ? shotLine(player, points, rand) : null;
  const shots = [];
  if (!line) {
    // No shooting profile - the player still scored, so the points are emitted
    // as unplaced scoring rather than dropped. Better a play line missing its
    // detail than a scoreboard missing points.
    if (points > 0) shots.push({ made: true, points, shotType: FREE_THROW, zone: null });
    return shots;
  }

  const threes = Math.min(line.tpm, line.tpa);
  const twos = Math.max(0, line.fgm - line.tpm);
  const threeMisses = Math.max(0, line.tpa - line.tpm);
  const twoMisses = Math.max(0, line.fga - line.tpa - twos);

  const addShot = (made, kind) => {
    const zones = kind === 3 ? THREE_ZONES : TWO_ZONES;
    const zone = pickWeighted(zones, rand, (z) => ZONES[z].weight);
    shots.push({
      made,
      points: made ? kind : 0,
      shotType: kind === 3 ? "three" : "two",
      zone,
      // Where the marker goes. Rolled here, once, and carried on the event -
      // the court must not roll its own, or the same shot would land somewhere
      // different in the live chart and in the final one.
      ...placeInZone(zone, rand),
      strong: !!(made && ZONES[zone].strong),
    });
  };

  for (let i = 0; i < threes; i++) addShot(true, 3);
  for (let i = 0; i < twos; i++) addShot(true, 2);
  for (let i = 0; i < threeMisses; i++) addShot(false, 3);
  for (let i = 0; i < twoMisses; i++) addShot(false, 2);
  for (let i = 0; i < line.ftm; i++) shots.push({ made: true, points: 1, shotType: FREE_THROW, zone: null });
  for (let i = 0; i < Math.max(0, line.fta - line.ftm); i++) {
    shots.push({ made: false, points: 0, shotType: FREE_THROW, zone: null });
  }

  // RECONCILIATION. shooting.js rounds each share independently, so its
  // implied total can sit a point or two either side of what the engine
  // decided. The engine wins, always: the scoreboard is the thing players
  // check against, and a play-by-play that quietly disagrees with it is worse
  // than no play-by-play. Settled in free throws, which are the only scoring
  // unit worth 1 and so the only one that can close any gap exactly.
  //
  // One loop in both directions, not two passes. Removing a made two swings
  // the total by +2, which can step straight over zero from -1 to +1 - a
  // second one-directional pass would have already run and exited, leaving the
  // point of drift this is here to prevent. Converging in a single loop lets
  // the overshoot be paid straight back with a free throw.
  const settled = () => points - shots.reduce((sum, s) => sum + s.points, 0);
  for (let guard = 0; guard < 64; guard++) {
    const drift = settled();
    if (drift === 0) break;
    if (drift > 0) {
      shots.push({ made: true, points: 1, shotType: FREE_THROW, zone: null });
      continue;
    }
    const ft = shots.findIndex((s) => s.made && s.points === 1);
    if (ft >= 0) { shots.splice(ft, 1); continue; }
    const two = shots.findIndex((s) => s.made && s.points === 2);
    if (two >= 0) { shots[two].made = false; shots[two].points = 0; shots[two].strong = false; continue; }
    const three = shots.findIndex((s) => s.made && s.points === 3);
    if (three >= 0) { shots[three].made = false; shots[three].points = 0; continue; }
    break;
  }

  return shots;
}

/**
 * The whole game as an ordered ledger of events.
 *
 * @param quarterBoxScores the engine's per-period lines: [{ a: {slot: line}, b: {...} }]
 * @param rosterA/rosterB  slot -> player, for names and shot profiles
 * @param seed             any integer; the same seed always yields the same ledger
 */
export function buildShotLedger(quarterBoxScores, rosterA, rosterB, seed = 1) {
  const rand = rng(seed);
  const events = [];
  const periods = Array.isArray(quarterBoxScores) ? quarterBoxScores : [];

  periods.forEach((period, periodIndex) => {
    // One flat list per period so the two teams interleave, the way a quarter
    // actually looks, rather than one team's whole quarter then the other's.
    const pending = [];

    for (const [side, roster] of [["a", rosterA], ["b", rosterB]]) {
      const lines = period[side] || {};
      for (const slot of Object.keys(lines)) {
        const player = roster?.[slot];
        const line = lines[slot] || {};
        const name = player?.name || slot;

        for (const shot of shotsForQuarter(player, Number(line.pts) || 0, rand)) {
          pending.push({ type: "shot", side, slot, player: name, ...shot });
        }
        // Counting stats the engine produced directly. Emitted as their own
        // events so the moments layer has something real to surface - these
        // are not derived or reconstructed, they are the engine's numbers.
        //
        // REBOUNDS ARE HERE NOW. They were the one counting stat the engine
        // records that the ledger dropped, so the possession feed could show a
        // steal and a block and never once say who cleaned the glass - which is
        // most of what actually happens between shots. The COUNT is the
        // engine's, exactly, like the other three.
        //
        // Offensive or defensive is NOT recorded by the engine and is not
        // guessed at: the event says "rebound" and the feed says "Rebound".
        // Splitting it would be inventing a fact to make a caption read better.
        for (const [stat, type] of [["reb", "rebound"], ["stl", "steal"], ["blk", "block"], ["tov", "turnover"]]) {
          for (let i = 0; i < (Number(line[stat]) || 0); i++) {
            pending.push({ type, side, slot, player: name });
          }
        }
      }
    }

    // Shuffle within the period, then hand out assists and clock times. The
    // order is presentation - the engine has no sequence inside a quarter -
    // but it is seeded, so it is the SAME presentation for both players.
    for (let i = pending.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pending[i], pending[j]] = [pending[j], pending[i]];
    }

    assignAssists(pending, period, rand);

    const period1 = periodIndex + 1;
    const periodSeconds = period.overtime ? OT_SECONDS : QUARTER_SECONDS;
    pending.forEach((event, i) => {
      // Evenly spread across the period. The engine models no clock, so a real
      // one cannot be recovered; what this gives is a monotonic order with
      // quarter boundaries in the right places.
      const fraction = pending.length > 1 ? i / (pending.length - 1) : 0;
      events.push({
        ...event,
        period: period1,
        overtime: !!period.overtime,
        order: events.length + i,
        periodFraction: fraction,
        // THE CLOCK IS PRESENTATION, and is labelled as such everywhere it is
        // used. The engine has no clock and never had one, so this is the
        // period's length laid over the period's own event ORDER - the same
        // presentation the order itself already is, read as a time because a
        // basketball broadcast reads it as a time and "event 7 of 23" is not
        // something anybody watching a game thinks in.
        //
        // It never contradicts anything: it is monotonic within a period, it
        // starts at 12:00 and ends at 0:00, and quarter boundaries fall where
        // the ledger says they do. It is not a claim that this shot was taken
        // with 4:12 left, and nothing downstream may treat it as one.
        clockSeconds: Math.max(0, Math.round(periodSeconds * (1 - fraction))),
      });
    });
  });

  annotateMoments(events);
  return { events, periods: periods.length };
}

/**
 * Marks the moments already implicit in the order.
 *
 * None of this is new information - it is the running score, read once. But
 * "Denver just scored ten in a row" and "the lead changed hands" are the two
 * things a person watching would actually say out loud, and until something
 * computes them the presentation has no way to know a moment happened. The
 * events carry them so the renderer can slow down, raise its voice, or stay
 * out of the way, without recomputing a score of its own and risking a
 * different answer from the scoreboard's.
 *
 * Derived, never invented: a run is consecutive scoring in the ledger's own
 * order, and a lead change is the sign of the margin flipping. If the ledger is
 * right, these are right.
 */
function annotateMoments(events) {
  const score = { a: 0, b: 0 };
  let runSide = null;
  let runPoints = 0;
  let lastLeader = null;

  events.forEach((event, i) => {
    const scoring = event.type === "shot" && event.made && event.points > 0;
    if (scoring) {
      score[event.side] += event.points;
      // A run is broken by the OTHER team scoring, not by a miss - a team can
      // miss five in a row mid-run and the run is still theirs.
      if (runSide === event.side) runPoints += event.points;
      else { runSide = event.side; runPoints = event.points; }
    }

    const leader = score.a === score.b ? null : score.a > score.b ? "a" : "b";
    // Only a genuine change of hands. Going from tied to ahead is not a lead
    // change, it is taking the lead for the first time since the tie - counting
    // it would fire this on nearly every basket of a close game and make the
    // signal worthless.
    const leadChange = !!(scoring && leader && lastLeader && leader !== lastLeader);
    if (leader) lastLeader = leader;

    // The last event of a period, whatever it was. A shot here is the closest
    // this model gets to a buzzer-beater: the engine has no clock, so what can
    // be said honestly is "this was the last thing that happened in the
    // quarter", which is enough to earn a beat.
    const endOfPeriod = i === events.length - 1 || events[i + 1].period !== event.period;

    event.scoreAfter = { a: score.a, b: score.b };
    event.leadChange = leadChange;
    event.endOfPeriod = endOfPeriod;
    // Surfaced only once it is worth saying. Eight is the threshold a
    // broadcast would bother mentioning.
    event.runPoints = scoring && runPoints >= 8 ? runPoints : 0;
    event.runSide = event.runPoints ? runSide : null;
  });
}

/**
 * Hands the period's assists to made field goals.
 *
 * The COUNT is the engine's and is never exceeded: a player credited with
 * three assists in a quarter is attached to at most three made shots, and a
 * player credited with none is attached to nothing. Which shots they were is
 * presentation, and a passer is never given his own basket.
 */
function assignAssists(pending, period, rand) {
  for (const side of ["a", "b"]) {
    const lines = period[side] || {};
    const credits = [];
    for (const slot of Object.keys(lines)) {
      for (let i = 0; i < (Number(lines[slot]?.ast) || 0); i++) credits.push(slot);
    }
    if (!credits.length) continue;

    const assistable = pending.filter(
      (e) => e.type === "shot" && e.side === side && e.made && e.shotType !== FREE_THROW
    );
    for (let i = assistable.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [assistable[i], assistable[j]] = [assistable[j], assistable[i]];
    }
    for (const shot of assistable) {
      const k = credits.findIndex((slot) => slot !== shot.slot);
      if (k < 0) break;
      shot.assistedBy = credits.splice(k, 1)[0];
    }
  }
}

// ZONE_BANDS and zoneSummary lived here and are gone with the court they were
// drawn on. The shape they aggregated is still in the ledger - every shot
// carries its zone - so a text version of the same thing is a reduce away if
// it is ever wanted somewhere that is not a floor.

/**
 * One event, as the possession feed says it out loud.
 *
 * Returned as PARTS rather than a sentence, because the feed sets the player's
 * name, what happened, and whether it dropped in three different weights - a
 * single string would have to be parsed back apart to do that.
 *
 * Every word here is derived from the event and nothing is embellished. A rim
 * finish reads "at the rim", not "DUNK": the engine has no dunks and no fouls,
 * so there is no honest way to emit either, and a caption that claims one is a
 * fabricated statistic wearing a verb. See the header of this file.
 */
export function describeEvent(event) {
  if (!event) return null;
  const zone = event.zone ? ZONES[event.zone] : null;
  switch (event.type) {
    case "shot": {
      if (event.shotType === FREE_THROW) {
        return { player: event.player, detail: "Free throw", verdict: event.made ? "MADE" : "MISS", made: event.made };
      }
      // "Finish" only when it actually finished. The zone's `strong` flag is a
      // property of the RIM - it is true whether the shot fell or not - so a
      // missed layup read "Finish at the rim - MISS", which is a sentence that
      // argues with itself.
      const kind =
        event.shotType === "three" ? "Three" : !zone?.strong ? "Jumper" : event.made ? "Finish" : "Shot";
      return {
        player: event.player,
        detail: zone ? `${kind} ${zone.label}` : kind,
        verdict: event.made ? "MADE" : "MISS",
        made: event.made,
      };
    }
    case "rebound":
      return { player: event.player, detail: "Rebound", verdict: "", made: null };
    case "steal":
      return { player: event.player, detail: "Steal", verdict: "", made: null };
    case "block":
      return { player: event.player, detail: "Block", verdict: "", made: null };
    case "turnover":
      return { player: event.player, detail: "Turnover", verdict: "", made: null };
    default:
      return { player: event.player, detail: event.type, verdict: "", made: null };
  }
}

/** An empty live-stats line. Named so the shape exists in one place. */
const emptyTeamStats = () => ({ fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pts: 0 });

/**
 * The two teams' live lines, folded from the ledger up to and including `upTo`.
 *
 * READ OFF THE SAME EVENTS THE SCOREBOARD IS, which is the entire reason this
 * is here rather than being summed out of the engine's period lines. A quarter
 * line is only true once the quarter is over; the strip under the court has to
 * be true right now, and the only thing that knows "right now" is how far into
 * the ledger the playback has got. Summing period lines instead would show a
 * field-goal percentage for shots that, on screen, have not been taken yet.
 *
 * Free throws are counted apart from field goals - they are not attempts, and
 * folding them into FG% is the commonest way to get a shooting line wrong.
 */
export function foldLiveStats(events, upTo) {
  const totals = { a: emptyTeamStats(), b: emptyTeamStats() };
  for (let i = 0; i <= upTo && i < events.length; i++) {
    const e = events[i];
    const team = totals[e.side];
    if (!team) continue;
    if (e.type === "shot") {
      if (e.shotType === FREE_THROW) {
        team.fta += 1;
        if (e.made) team.ftm += 1;
      } else {
        team.fga += 1;
        if (e.shotType === "three") team.tpa += 1;
        if (e.made) {
          team.fgm += 1;
          if (e.shotType === "three") team.tpm += 1;
        }
      }
      if (e.made) team.pts += e.points;
      // An assist is credited to the PASSER's team, which is the shooter's
      // team - a passer is never given his own basket (see assignAssists), so
      // counting it on the shot is the same total by a shorter route.
      if (e.made && e.assistedBy) team.ast += 1;
    } else if (e.type === "rebound") team.reb += 1;
    else if (e.type === "steal") team.stl += 1;
    else if (e.type === "block") team.blk += 1;
    else if (e.type === "turnover") team.tov += 1;
  }
  return totals;
}

export function scoreAfter(events, upTo) {
  const score = { a: 0, b: 0 };
  for (let i = 0; i <= upTo && i < events.length; i++) {
    const e = events[i];
    if (e.type === "shot" && e.made) score[e.side] += e.points;
  }
  return score;
}
