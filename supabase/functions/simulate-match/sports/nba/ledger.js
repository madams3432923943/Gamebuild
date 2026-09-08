// Basketball's event ledger: the authoritative sequence behind a finished game.
//
// WHY THIS IS IN THE ENGINE'S DIRECTORY AND VENDORED TO THE SERVER
//
// It used to be presentation - the browser ran it after a result arrived,
// decomposing a box score into shots so the court had something to draw. That
// placement is the whole of the online desync: an online match is simulated
// once on the server, but the shooting numbers and every event on the chart
// were rebuilt on EACH client, off a client-local random stream and in that
// client's own "A = me" frame - so the two machines fed their two rosters into
// the draws in opposite orders. One final score, two different box scores.
//
// The simulation produces the ledger now, the Edge Function stores it, and both
// clients render what they are given. Nothing downstream of the server rolls a
// die. tools/vendor-engines.mjs keeps the server's copy of this file honest.
//
// AUTHORITATIVE, from the engine and never altered here: points, rebounds,
// assists, steals, blocks, turnovers, and every shooting count. The ledger's
// shots for a player in a quarter ARE that player's quarter line.
//
// PRESENTATION, and labelled as such: the ORDER events fall in within a
// quarter, WHICH of the three-point zones a three came from, and where in that
// zone the marker sits. The engine models no possession sequence and no clock.
// A three is always placed behind the arc and a two always inside it, so the
// zone can never contradict the shot.
//
// DELIBERATELY ABSENT: dunks and and-ones, because the engine has no concept of
// either; offensive versus defensive rebounds, for the same reason - the engine
// records a rebound, not which end of the floor it happened at, and a caption
// saying "Defensive Rebound" would be a statistic invented to make a line read
// better.

/** Court zones, and the points a make in each is worth.
 *
 * Ordered inside-out. `weight` is how often a shot of that class lands in the
 * zone - a presentation distribution, loosely league-shaped, NOT something the
 * engine produced. `strong` marks the finishes worth a louder animation. */
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
 * THE COORDINATE SYSTEM. Both axes are feet divided by 50, so a distance across
 * this square is a real distance and the arc is a circle rather than an ellipse.
 * The basket is at (0.5, 0.105), 5.25 feet off the baseline. `r` is the distance
 * band in the same units (0.02 is a foot); `spread` is the angle in degrees
 * either side of straight-on, so a zone is an ARC and twenty shots from it are a
 * fan rather than a stack.
 *
 * WHY THIS CANNOT DRAW A THREE INSIDE THE ARC: the zone decides the points
 * before the position is rolled, and each band is the real distance that zone
 * is. scripts/verify-nba-shot-ledger.mjs measures it on every shot of 120 games.
 */
const RIM = { x: 0.5, y: 0.105 };

const ZONE_ANCHORS = {
  rim: { r: [0.02, 0.08], spread: 55 },
  paint: { r: [0.09, 0.19], spread: 42 },
  "short-mid": { r: [0.21, 0.31], spread: 60 },
  // Capped at 62 degrees so a long two never strays out to where a corner
  // three lives - at 22 feet, 90 degrees IS the corner.
  "long-mid": { r: [0.33, 0.43], spread: 62 },
  // THE ANGLE IS WHAT KEEPS THE CORNER THREE BEHIND THE LINE, not the distance.
  // The corner line is straight and 22 feet from the middle of the floor, so
  // what has to clear it is the shot's SIDEWAYS distance - r * sin(angle) - and
  // at 72 degrees a 22-foot shot is only 20.9 feet across. The band below keeps
  // the sideways distance above 22 feet at every point in it: 0.452 * sin(78
  // degrees) is 22.1.
  "corner-three": { r: [0.452, 0.485], spread: [78, 89] },
  "wing-three": { r: [0.49, 0.55], spread: [42, 70] },
  "above-break-three": { r: [0.49, 0.58], spread: [0, 40] },
};

/** A point inside `zone`, rolled from the simulation's own stream. */
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
  // ROUNDED HERE, not on the way to the database, so the stored value and the
  // in-memory one are the same number. Three decimals is a quarter of an inch on
  // a half-court. Rounding only in packLedger would have an offline game draw a
  // shot at 0.4615926 and the same game online at 0.462 - a difference nobody
  // can see and every equality check can.
  const place = (n, hi) => Math.round(clamp(n, hi) * 1000) / 1000;
  return {
    x: place(RIM.x + radius * Math.sin(radians), 0.98),
    // cos, so straight-on is straight out toward half court. A shot is never
    // placed behind the baseline: the angle never reaches 90 degrees, and the
    // rim's own 0.105 of clearance covers what is left.
    y: place(RIM.y + radius * Math.cos(radians), 0.93),
  };
}

/** How long a period is, for the derived clock below. Regulation quarters are
 * twelve minutes and overtime is five - real numbers, used only to scale a
 * presentation clock, because a board that counted down from an invented length
 * would look wrong to anyone who has watched a game. */
const QUARTER_SECONDS = 12 * 60;
const OT_SECONDS = 5 * 60;

/** Free throws are marked apart from field goals: they are not shot attempts,
 * so they must not be counted as ones anywhere the ledger is aggregated, and
 * the play-by-play describes them differently. They still exist in the ledger
 * as scoring events so the running score stays exact. */
export const FREE_THROW = "free-throw";

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
 * One player's quarter, expanded into the shots that produced it.
 *
 * `line` is the quarter's AUTHORITATIVE shooting line as the simulation recorded
 * it. This turns counts into placed events and derives nothing, which is the
 * whole difference between this and the module it replaced.
 */
function shotsForQuarter(line, points, rand) {
  const shots = [];
  if (!line || (!line.fga && !line.fta)) {
    // Points with no shooting line behind them - a player whose dataset row
    // predates the shooting columns. Emitted as unplaced scoring rather than
    // dropped, so the scoreboard stays exact, and MARKED as unplaced so nothing
    // that folds the ledger into a shooting line counts it as a shot.
    // `strong` is stated rather than left off. Every shot event carries the
    // same keys, which is what lets a packed ledger be compared field for field
    // against the one the simulation built - see verify-nba-online-sync.
    if (points > 0) shots.push({ made: true, points, shotType: FREE_THROW, zone: null, strong: false, unplaced: true });
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
      // Where the marker goes. Rolled here, once, and carried on the event - the
      // court must not roll its own, or the same shot would land somewhere
      // different in the live chart and in the final one.
      ...placeInZone(zone, rand),
      strong: !!(made && ZONES[zone].strong),
    });
  };

  for (let i = 0; i < threes; i++) addShot(true, 3);
  for (let i = 0; i < twos; i++) addShot(true, 2);
  for (let i = 0; i < threeMisses; i++) addShot(false, 3);
  for (let i = 0; i < twoMisses; i++) addShot(false, 2);
  for (let i = 0; i < line.ftm; i++) {
    shots.push({ made: true, points: 1, shotType: FREE_THROW, zone: null, strong: false });
  }
  for (let i = 0; i < Math.max(0, line.fta - line.ftm); i++) {
    shots.push({ made: false, points: 0, shotType: FREE_THROW, zone: null, strong: false });
  }

  // NO RECONCILIATION LOOP. The old one closed a rounding gap by pushing MADE
  // free throws, which is half of why teams shot 30-for-30. The line now
  // reproduces its own points exactly (see shooting.js), so there is nothing
  // left to settle - and verify-nba-shot-ledger fails on a point of drift.
  return shots;
}

/**
 * The whole game as an ordered ledger of events.
 *
 * @param quarterBoxScores the per-period lines, INCLUDING their shooting splits
 * @param rand             the simulation's own random stream
 */
export function buildShotLedger(quarterBoxScores, rand = Math.random) {
  const events = [];
  const periods = Array.isArray(quarterBoxScores) ? quarterBoxScores : [];

  periods.forEach((period, periodIndex) => {
    // One flat list per period so the two teams interleave, the way a quarter
    // actually looks, rather than one team's whole quarter then the other's.
    const pending = [];

    for (const side of ["a", "b"]) {
      const lines = period[side] || {};
      for (const slot of Object.keys(lines)) {
        const line = lines[slot] || {};
        for (const shot of shotsForQuarter(line, Number(line.pts) || 0, rand)) {
          pending.push({ type: "shot", side, slot, ...shot });
        }
        // Counting stats the engine produced directly. Emitted as their own
        // events so the feed has something real to surface between baskets -
        // these are not derived, they are the engine's numbers.
        for (const [stat, type] of [["reb", "rebound"], ["stl", "steal"], ["blk", "block"], ["tov", "turnover"]]) {
          for (let i = 0; i < (Number(line[stat]) || 0); i++) {
            pending.push({ type, side, slot });
          }
        }
      }
    }

    // Shuffle within the period, then hand out assists. The order is
    // presentation - the engine has no sequence inside a quarter - but it is
    // drawn from the simulation's own seeded stream, so it is the SAME
    // presentation everywhere the result is rendered.
    for (let i = pending.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pending[i], pending[j]] = [pending[j], pending[i]];
    }

    assignAssists(pending, period, rand);

    for (const event of pending) {
      events.push({ ...event, period: periodIndex + 1, overtime: !!period.overtime });
    }
  });

  annotateLedger(events);
  return { events, periods: periods.length };
}

/**
 * Hands the period's assists to made field goals.
 *
 * The COUNT is the engine's and is never exceeded: a player credited with three
 * assists in a quarter is attached to at most three made shots, and a player
 * credited with none is attached to nothing. Which shots they were is
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

/**
 * Everything about an event that is a PURE FUNCTION of the ledger's order:
 * order, running score, runs, lead changes, end-of-period, and the derived
 * clock. No new information and no random draw, which is exactly why it is
 * recomputed on load rather than stored - an online result travels as the events
 * themselves and this rebuilds the rest identically on both clients.
 */
export function annotateLedger(events) {
  // Per-period indices first, for the derived clock.
  const perPeriodCount = new Map();
  for (const event of events) perPeriodCount.set(event.period, (perPeriodCount.get(event.period) || 0) + 1);
  const seen = new Map();

  const score = { a: 0, b: 0 };
  let runSide = null;
  let runPoints = 0;
  let lastLeader = null;

  events.forEach((event, i) => {
    const index = seen.get(event.period) || 0;
    seen.set(event.period, index + 1);
    const count = perPeriodCount.get(event.period) || 1;
    const fraction = count > 1 ? index / (count - 1) : 0;
    const periodSeconds = event.overtime ? OT_SECONDS : QUARTER_SECONDS;

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
    // change, and counting it would fire this on nearly every basket of a close
    // game and make the signal worthless.
    const leadChange = !!(scoring && leader && lastLeader && leader !== lastLeader);
    if (leader) lastLeader = leader;

    event.order = i;
    event.periodFraction = fraction;
    // THE CLOCK IS PRESENTATION. The engine has no clock, so this is the
    // period's real length laid over the period's own event ORDER: monotonic,
    // 12:00 down to 0:00, boundaries where the ledger says. It is not a claim
    // that this shot was taken with 4:12 left.
    event.clockSeconds = Math.max(0, Math.round(periodSeconds * (1 - fraction)));
    event.scoreAfter = { a: score.a, b: score.b };
    event.leadChange = leadChange;
    event.endOfPeriod = i === events.length - 1 || events[i + 1].period !== event.period;
    // Surfaced only once it is worth saying. Eight is the threshold a broadcast
    // would bother mentioning.
    event.runPoints = scoring && runPoints >= 8 ? runPoints : 0;
    event.runSide = event.runPoints ? runSide : null;
  });
  return events;
}

/** Attaches player NAMES to a ledger, from the rosters that are being rendered.
 *
 * Names are not stored on the events. A slot plus a side already identifies the
 * player uniquely, the renderer always has both rosters in hand, and leaving the
 * name out is what keeps a stored online ledger small enough to sit inside the
 * result row rather than needing a table of its own. */
export function hydrateLedger(events, rosterA, rosterB) {
  for (const event of events || []) {
    const roster = event.side === "a" ? rosterA : rosterB;
    event.player = roster?.[event.slot]?.name || event.slot;
  }
  return events;
}

// ---------------------------------------------------------------------------
// THE WIRE FORMAT
//
// A game is 350-450 events and all of them travel inside the stored online
// result, so that both clients render the same chart rather than two
// locally-rolled ones. Written out in full that is about 60KB of JSON per match;
// packed it is about a sixth of that, because everything annotateLedger() can
// recompute is left out and the rest is short-keyed.
//
// Deliberately NOT a positional array: a row of bare values is unreadable in a
// database, impossible to extend without a version number, and silently wrong if
// a field is ever inserted in the middle.
// ---------------------------------------------------------------------------

const TYPE_CODES = { shot: 0, rebound: 1, steal: 2, block: 3, turnover: 4 };
const TYPE_NAMES = Object.keys(TYPE_CODES);
const SHOT_CODES = { two: 0, three: 1, [FREE_THROW]: 2 };
const SHOT_NAMES = Object.keys(SHOT_CODES);
const ZONE_NAMES = Object.keys(ZONES);

export function packLedger(events) {
  return (events || []).map((e) => {
    const packed = { t: TYPE_CODES[e.type] ?? 0, s: e.side, l: e.slot, q: e.period };
    if (e.overtime) packed.o = 1;
    if (e.type === "shot") {
      if (e.made) packed.m = 1;
      if (e.points) packed.p = e.points;
      packed.k = SHOT_CODES[e.shotType] ?? 0;
      if (e.zone) packed.z = ZONE_NAMES.indexOf(e.zone);
      // Already rounded at build time - see placeInZone.
      if (typeof e.x === "number") packed.x = e.x;
      if (typeof e.y === "number") packed.y = e.y;
      if (e.assistedBy) packed.a = e.assistedBy;
      if (e.unplaced) packed.u = 1;
    }
    return packed;
  });
}

/** The inverse, plus the annotation pass. Returns a ledger indistinguishable
 * from the one the simulation built - which is the property the whole online
 * fix rests on, and what scripts/verify-nba-online-sync.mjs asserts. */
export function unpackLedger(packed) {
  const events = (packed || []).map((p) => {
    const type = TYPE_NAMES[p.t] ?? "shot";
    const event = { type, side: p.s, slot: p.l, period: p.q, overtime: !!p.o };
    if (type === "shot") {
      event.made = !!p.m;
      event.points = p.p || 0;
      event.shotType = SHOT_NAMES[p.k] ?? "two";
      const zone = p.z === undefined ? null : ZONE_NAMES[p.z] ?? null;
      event.zone = zone;
      if (typeof p.x === "number") event.x = p.x;
      if (typeof p.y === "number") event.y = p.y;
      if (p.a) event.assistedBy = p.a;
      if (p.u) event.unplaced = true;
      event.strong = !!(event.made && zone && ZONES[zone].strong);
    }
    return event;
  });
  annotateLedger(events);
  return events;
}
