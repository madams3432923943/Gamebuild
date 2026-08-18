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
//
// WHAT IS DELIBERATELY ABSENT
//
// Dunks and and-ones. The engine has no concept of either, so neither appears
// as an event type. A rim finish is a real ZONE - the shot went in from close
// - and gets the stronger visual treatment on that basis, which is a fact
// about placement rather than a dunk this module made up. An and-one would
// require a foul model that does not exist; there is no honest way to emit one
// and it is better to be missing than fabricated.

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
  rim: { points: 2, weight: 0.34, strong: true },
  paint: { points: 2, weight: 0.24 },
  "short-mid": { points: 2, weight: 0.22 },
  "long-mid": { points: 2, weight: 0.2 },
  "corner-three": { points: 3, weight: 0.26 },
  "wing-three": { points: 3, weight: 0.37 },
  "above-break-three": { points: 3, weight: 0.37 },
};

const TWO_ZONES = Object.keys(ZONES).filter((z) => ZONES[z].points === 2);
const THREE_ZONES = Object.keys(ZONES).filter((z) => ZONES[z].points === 3);

/* ZONE_ANCHORS and placeInZone() lived here. They gave each shot an x/y on a
 * half-court drawn as a unit square, so a marker had somewhere to sit. Nothing
 * draws a marker now - the court is gone and the scoreboard is the stage - and
 * no consumer ever read the coordinates for anything else, so they went with
 * it. The ZONE itself stays: it is what decides two points from three and what
 * makes a finish "strong", both of which the play-by-play still uses. */

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
        for (const [stat, type] of [["stl", "steal"], ["blk", "block"], ["tov", "turnover"]]) {
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
    pending.forEach((event, i) => {
      events.push({
        ...event,
        period: period1,
        overtime: !!period.overtime,
        // Evenly spread across the period. The engine models no clock, so a
        // real one cannot be recovered; what this gives is a monotonic order
        // with quarter boundaries in the right places.
        order: events.length + i,
        periodFraction: pending.length > 1 ? i / (pending.length - 1) : 0,
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

export function scoreAfter(events, upTo) {
  const score = { a: 0, b: 0 };
  for (let i = 0; i <= upTo && i < events.length; i++) {
    const e = events[i];
    if (e.type === "shot" && e.made) score[e.side] += e.points;
  }
  return score;
}
