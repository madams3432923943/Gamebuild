// The football game, as a timed sequence of things to watch.
//
// WHY THIS IS A MODULE AND NOT A HANDFUL OF setTimeouts
//
// Football's playback used to be basketball's: main.js took the quarter's
// hold, divided it by however many drives that quarter had, and fired them on
// a loop. Two things were wrong with that. Every drive got the same slice of
// time whether it was a three-and-out or a game-winning touchdown, so the
// moments worth watching went past at the same speed as the ones that were
// not. And the total was whatever basketball's quarter cadence happened to
// be, so a game with few drives crawled and a game with many flickered.
//
// So the timeline is built ONCE, up front, as data: every event with its own
// duration, weighted by how much it matters, and then the whole thing scaled
// to land inside a target the viewer can actually sit through. Building it as
// data rather than as scheduled callbacks is what makes it testable - you can
// assert that a game lasts 25 to 40 seconds, that a touchdown gets more time
// than an incompletion, and that the ball never leaves the field, without
// waiting for a single timer to fire.
//
// It also leaves room for a speed control: scale one number and the whole
// game re-times, because nothing here measures itself against the clock.

/**
 * How long each kind of moment is worth, in milliseconds, BEFORE the whole
 * timeline is scaled to fit. These are ratios as much as durations - what
 * matters is that a touchdown is worth about three ordinary snaps.
 */
export const EVENT_WEIGHTS = {
  kickoff: 1300,
  driveStart: 900,
  // An ordinary snap. Most of a game is these, so this number sets the pace
  // more than any other - and at 650ms it was faster than a person can read
  // the description, the down and the ball's new position before it changed.
  play: 850,
  // Enough of a gain to move the chains, or to be worth noticing.
  firstDown: 1200,
  bigGain: 1200,
  // A sack is a swing in field position and the crowd noise of a drive
  // stalling; the red zone is the part everybody leans in for.
  sack: 1400,
  redZone: 1400,
  // The things people actually wait for.
  touchdown: 2000,
  fieldGoal: 1900,
  turnover: 2000,
  punt: 1000,
  downs: 1500,
  quarterEnd: 1500,
  halfEnd: 1700,
  gameEnd: 2200,
};

/** The band a whole game's playback has to land in. Below the floor nobody can
 * follow it; above the ceiling it stops being a highlight and becomes a
 * broadcast. */
export const TARGET_MIN_MS = 35000;
export const TARGET_MAX_MS = 50000;
const TARGET_MS = 42000;

/**
 * Playback speed, as a divisor on every duration. 1 is the pace above; 2 is
 * twice as fast. Declared here so a speed control is a value to change rather
 * than a rewrite - nothing in this module measures itself against the wall
 * clock, so scaling this re-times the entire game consistently.
 *
 * No user-facing selector yet, deliberately.
 */
export const DEFAULT_SPEED = 1;

/** Seconds in a quarter. Football's, not this playback's - the game clock the
 * field shows is the one inside the fiction. */
const QUARTER_SECONDS = 15 * 60;

/** m:ss, with the seconds always two digits. */
function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Inside this yard line is the red zone, counted from the driving team's own
 * goal line the way every other yardage in this engine is. */
const RED_ZONE_YARD = 80;

/** A gain big enough to be worth dwelling on even when it does not convert. */
const BIG_GAIN_YARDS = 18;

const SCORING_EVENT = { touchdown: "touchdown", fieldGoal: "fieldGoal" };

const SIDES = ["A", "B"];
const other = (side) => (side === "A" ? "B" : "A");

// ---------------------------------------------------------------------------
// WHAT EACH EVENT DID TO THE GAME
//
// Every event carries the production it EARNED, as a delta, rather than the
// totals as of that moment. That is the whole difference between a live box
// score and a spoiler.
//
// The old live table was handed the finished quarter line the instant the
// quarter began, so a viewer watching the first snap of Q1 could already read
// the quarter's final score and every yard still to be gained. Deltas invert
// it: nothing exists until the play that produced it has been shown.
//
// These functions are a deliberate mirror of `boxFor` in engine.js - the same
// additions in the same order over the same plays. They have to be, because
// the guarantee this rests on is that applying every event reproduces the
// engine's own box score exactly. scripts/verify-nfl-event-ledger.mjs asserts
// it rather than trusting this comment.
// ---------------------------------------------------------------------------

/** A player's line, with every football column the ledger writes. Kept in step
 * with `emptyLine` in engine.js's boxFor. */
export function emptyPlayerLine() {
  return {
    comp: 0, att: 0, pass_yds: 0, pass_tds: 0, rush_yds: 0, rush_tds: 0,
    carries: 0, targets: 0, sacked: 0,
    rec: 0, rec_yds: 0, rec_tds: 0, ints: 0, fumbles: 0, fgs: 0, fga: 0,
    td: 0, pts: 0,
  };
}

/** One side's team totals. Same keys as boxFor's `team`. */
export function emptyTeamTotals() {
  return {
    passYards: 0, rushYards: 0, totalYards: 0, firstDowns: 0, turnovers: 0,
    thirdDownAttempts: 0, thirdDownConversions: 0,
    redZoneTrips: 0, redZoneTouchdowns: 0,
    sacksAllowed: 0, possessionSeconds: 0, drives: 0, startYardTotal: 0,
    plays: 0, averageStart: 0,
  };
}

function bump(target, side, slot, key, amount) {
  if (!slot || !amount) return;
  const bySlot = target[side];
  const line = bySlot[slot] || (bySlot[slot] = {});
  line[key] = (line[key] || 0) + amount;
}

function bumpTeam(target, side, key, amount) {
  if (!amount) return;
  target[side][key] = (target[side][key] || 0) + amount;
}

/**
 * The production one snap earned, written into the delta pair.
 *
 * @returns true when this play was the drive's first trip inside the twenty,
 *   which the caller tracks - a red-zone TRIP is counted once per drive
 *   however many snaps are taken there.
 */
function accumulatePlay(playerDeltas, teamDeltas, side, play, enteredRedZone) {
  bumpTeam(teamDeltas, side, "plays", 1);
  bumpTeam(teamDeltas, side, "possessionSeconds", play.seconds || 0);
  if (play.firstDown) bumpTeam(teamDeltas, side, "firstDowns", 1);
  if (play.down === 3) {
    bumpTeam(teamDeltas, side, "thirdDownAttempts", 1);
    if (play.firstDown) bumpTeam(teamDeltas, side, "thirdDownConversions", 1);
  }
  let crossed = false;
  if (!enteredRedZone && play.endYard >= RED_ZONE_YARD) {
    crossed = true;
    bumpTeam(teamDeltas, side, "redZoneTrips", 1);
  }

  switch (play.type) {
    case "run":
      bump(playerDeltas, side, play.carrier, "carries", 1);
      bump(playerDeltas, side, play.carrier, "rush_yds", play.gain);
      bumpTeam(teamDeltas, side, "rushYards", play.gain);
      bumpTeam(teamDeltas, side, "totalYards", play.gain);
      break;
    case "sack":
      // A sack costs the quarterback yardage in real books, but the engine's
      // final totals read passing yards as the SUM OF RECEIVING YARDS, which
      // no sack contributes to. Charging the loss here would make the live
      // table drift below the final one by exactly the sack yardage.
      bump(playerDeltas, side, "QB", "sacked", 1);
      bumpTeam(teamDeltas, side, "sacksAllowed", 1);
      break;
    case "incompletion":
      bump(playerDeltas, side, "QB", "att", 1);
      break;
    default: {
      // A completion is one event with two halves, written together so the
      // passer's line and the receiver's can never disagree.
      bump(playerDeltas, side, "QB", "att", 1);
      bump(playerDeltas, side, "QB", "comp", 1);
      bump(playerDeltas, side, "QB", "pass_yds", play.gain);
      bump(playerDeltas, side, play.receiver, "targets", 1);
      bump(playerDeltas, side, play.receiver, "rec", 1);
      bump(playerDeltas, side, play.receiver, "rec_yds", play.gain);
      bumpTeam(teamDeltas, side, "passYards", play.gain);
      bumpTeam(teamDeltas, side, "totalYards", play.gain);
      break;
    }
  }
  return crossed;
}

/**
 * What the drive's RESULT credited, over and above the snap that ended it.
 *
 * Points nobody on the roster can be credited with still have to land
 * somewhere or the box score stops adding up to the scoreboard, so they go to
 * TEAM - not a roster slot, never rendered as a row, but it keeps every sum
 * honest. Quick Play drafts no kicker, which is exactly when this happens.
 */
function accumulateResult(playerDeltas, teamDeltas, drive, enteredRedZone) {
  const side = drive.team;
  const scorer = drive.scorerSlot || (drive.points > 0 ? "TEAM" : null);

  if (drive.outcome === "fieldGoal" && scorer) {
    bump(playerDeltas, side, scorer, "fgs", 1);
    bump(playerDeltas, side, scorer, "fga", 1);
    bump(playerDeltas, side, scorer, "pts", drive.points);
  } else if (drive.outcome === "downs" && drive.text && /missed/i.test(drive.text)) {
    // A miss is still an attempt. It belongs to the kicker whether or not the
    // drive it ended produced anything else.
    bump(playerDeltas, side, "ST", "fga", 1);
  } else if (drive.outcome === "touchdown" && scorer) {
    if (drive.kind === "rush") {
      bump(playerDeltas, side, scorer, "rush_tds", 1);
    } else {
      bump(playerDeltas, side, scorer, "rec_tds", 1);
      // A quarterback who scores it himself did not also throw it.
      if (drive.scorerSlot !== "QB") bump(playerDeltas, side, "QB", "pass_tds", 1);
    }
    bump(playerDeltas, side, scorer, "td", 1);
    bump(playerDeltas, side, scorer, "pts", drive.points);
    if (enteredRedZone) bumpTeam(teamDeltas, side, "redZoneTouchdowns", 1);
  } else if (drive.outcome === "turnover") {
    bumpTeam(teamDeltas, side, "turnovers", 1);
    // The takeaway is the OTHER side's statistic, which is why deltas are
    // keyed by side rather than being a single bag belonging to whoever has
    // the ball. A drafted ball-hawking secondary earns its interceptions in
    // the live box score, not just in the recap.
    if (drive.credit) {
      bump(playerDeltas, other(side), drive.credit, drive.takeaway === "fumble" ? "fumbles" : "ints", 1);
    }
  }
}

/**
 * Turns the engine's drives into a flat, ordered, timed event list.
 *
 * Every event carries the full field state at that moment, so the renderer is
 * a pure function of one event and never has to remember what came before -
 * which is what stops the ball and the down marker from drifting apart when a
 * frame is dropped or playback is resumed.
 *
 * @param drives the engine's `drives` array
 * @param opts.targetMs total playback length to aim for; clamped to the band
 * @param opts.speed multiplier for a future speed control (2 = twice as fast)
 */
export function buildTimeline(drives, opts = {}) {
  const events = [];
  const list = Array.isArray(drives) ? drives : [];
  if (!list.length) return { events, totalMs: 0 };

  const score = { A: 0, B: 0 };
  let lastQuarter = null;
  let lastPossession = null;
  // The game clock, counted DOWN from the top of each quarter using the
  // seconds each play actually burns. Derived here rather than stored on the
  // drive because it is a presentation fact: the engine models drives, not a
  // running clock, and inventing one in the engine would put a second source
  // of truth next to the score.
  let clockLeft = QUARTER_SECONDS;

  const push = (type, weightKey, fields) => {
    events.push({
      type,
      weight: EVENT_WEIGHTS[weightKey] ?? EVENT_WEIGHTS.play,
      scoreA: score.A,
      scoreB: score.B,
      clock: formatClock(clockLeft),
      // The same clock as a number. `clock` is for reading; this is for
      // arithmetic - a drive's elapsed time is a subtraction, and parsing
      // "12:04" back into seconds to get it would make the string the source
      // of truth for something it was only ever meant to display.
      clockSeconds: Math.max(0, Math.round(clockLeft)),
      ...fields,
    });
  };

  for (const drive of list) {
    if (drive.quarter !== lastQuarter) {
      if (lastQuarter !== null) {
        // Half-time is a bigger beat than a quarter break, because the ball
        // changes hands and the field flips.
        const half = lastQuarter === 2;
        push(half ? "halfEnd" : "quarterEnd", half ? "halfEnd" : "quarterEnd", {
          quarter: lastQuarter,
          possession: null,
          text: half ? "End of the half" : `End of Q${lastQuarter}`,
        });
      }
      lastQuarter = drive.quarter;
      clockLeft = QUARTER_SECONDS;
    }

    // A kickoff, not a drive that materialises at the 25. Shown when
    // possession genuinely changes hands to open a series, which is what the
    // viewer needs to see to know the field is about to flip.
    if (drive.team !== lastPossession) {
      push("kickoff", "kickoff", {
        quarter: drive.quarter,
        possession: drive.team,
        yard: drive.startYard,
        down: null,
        distance: null,
        text: "Kickoff",
      });
    }
    lastPossession = drive.team;

    // A drive begins: the possession itself is a team statistic, and its
    // starting field position is half of what average start means.
    const startDeltas = { A: {}, B: {} };
    bumpTeam(startDeltas, drive.team, "drives", 1);
    bumpTeam(startDeltas, drive.team, "startYardTotal", drive.startYard);
    push("driveStart", "driveStart", {
      quarter: drive.quarter,
      possession: drive.team,
      yard: drive.startYard,
      down: 1,
      distance: 10,
      teamDeltas: startDeltas,
      text: `${drive.team === "A" ? "Home" : "Away"} ball, own ${drive.startYard}`,
    });

    // Counted once per drive however many snaps are taken inside the twenty.
    let enteredRedZone = false;

    const plays = Array.isArray(drive.plays) ? drive.plays : [];
    for (const play of plays) {
      const playerDeltas = { A: {}, B: {} };
      const teamDeltas = { A: {}, B: {} };
      if (accumulatePlay(playerDeltas, teamDeltas, drive.team, play, enteredRedZone)) {
        enteredRedZone = true;
      }
      // Never past 0:00 - a quarter that ran long is the model's drives not
      // fitting a real clock, and showing a negative one would be worse than
      // holding at zero.
      clockLeft = Math.max(0, clockLeft - (play.seconds || 35));
      const terminal = !!play.result;
      if (!terminal) {
        const big = play.gain >= BIG_GAIN_YARDS;
        // A snap inside the opponent's twenty is a red-zone snap, and a sack
        // is its own kind of moment. Both were being shown at an ordinary
        // play's pace, which is what made the parts worth watching go past
        // at the speed of the parts that were not.
        const inRedZone = play.endYard >= RED_ZONE_YARD;
        const weightKey = play.type === "sack"
          ? "sack"
          : play.firstDown
            ? "firstDown"
            : inRedZone
              ? "redZone"
              : big
                ? "bigGain"
                : "play";
        push(
          "play",
          weightKey,
          {
            quarter: drive.quarter,
            possession: drive.team,
            yard: play.endYard,
            fromYard: play.startYard,
            down: play.down,
            distance: play.distance,
            gain: play.gain,
            firstDown: play.firstDown,
            playType: play.type,
            playerDeltas,
            teamDeltas,
            text: describePlay(play),
          }
        );
        continue;
      }

      // The play that ended the drive carries the drive's result - both the
      // production of the snap itself (already accumulated above) and whatever
      // the outcome credited on top of it.
      accumulateResult(playerDeltas, teamDeltas, drive, enteredRedZone);
      const scoreDelta = { A: 0, B: 0 };
      if (drive.points > 0) scoreDelta[drive.team] = drive.points;
      if (drive.points > 0) score[drive.team] += drive.points;
      const key = SCORING_EVENT[drive.outcome] || (drive.outcome === "turnover" ? "turnover" : drive.outcome);
      push(key, EVENT_WEIGHTS[key] ? key : "play", {
        quarter: drive.quarter,
        possession: drive.team,
        yard: play.endYard,
        fromYard: play.startYard,
        down: play.down,
        distance: play.distance,
        gain: play.gain,
        scoring: drive.points > 0 ? drive.points : 0,
        turnover: drive.outcome === "turnover",
        playType: play.type,
        playerDeltas,
        teamDeltas,
        scoreDelta,
        text: drive.text,
      });
      // Points already banked above, so the event that follows shows the new
      // score rather than the old one.
      events[events.length - 1].scoreA = score.A;
      events[events.length - 1].scoreB = score.B;
    }
  }

  push("gameEnd", "gameEnd", {
    quarter: lastQuarter,
    possession: null,
    yard: null,
    down: null,
    distance: null,
    text: "Final",
  });

  // ---- fit the whole thing into a watchable window ------------------------
  const rawTotal = events.reduce((s, e) => s + e.weight, 0);
  const target = clamp(opts.targetMs || TARGET_MS, TARGET_MIN_MS, TARGET_MAX_MS);
  const speed = opts.speed && opts.speed > 0 ? opts.speed : DEFAULT_SPEED;
  // One scale factor across every event, so the RATIOS above survive: a
  // touchdown stays worth three snaps whether the game had 40 plays or 90.
  const scale = rawTotal > 0 ? target / rawTotal : 1;
  let totalMs = 0;
  for (const e of events) {
    e.durationMs = Math.max(90, Math.round((e.weight * scale) / speed));
    e.atMs = totalMs;
    totalMs += e.durationMs;
  }

  return { events, totalMs };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// THE LIVE LEDGER
//
// A game being watched, as of the last event shown. Nothing here reads ahead:
// the state is a pure fold of the events applied so far, which is what makes
// "pause at the middle of Q1 and the second half of Q1 is genuinely not
// visible" a property of the design rather than a thing to remember to do.
// ---------------------------------------------------------------------------

/**
 * An empty game, ready to have events applied to it.
 *
 * Seeding from the rosters matters: a quiet receiver had a quiet game, he did
 * not fail to exist, and an absent row is the one thing a box score must never
 * say. It also fixes what a slot IS - an event naming a slot this roster does
 * not have is dropped rather than inventing a row, which mirrors the engine's
 * own ledger exactly.
 */
export function createLiveState({ rosterA, rosterB } = {}) {
  const state = {
    score: { A: 0, B: 0 },
    /** Points per quarter, so a quarter summary is a read rather than a
     * separate tally that could disagree with the running score. */
    quarterScores: {},
    players: { A: {}, B: {} },
    team: { A: emptyTeamTotals(), B: emptyTeamTotals() },
    /** How many events have been folded in - the cheap way for a renderer to
     * tell whether anything changed. */
    applied: 0,
  };
  const rosters = { A: rosterA, B: rosterB };
  for (const side of SIDES) {
    for (const slot of Object.keys(rosters[side] || {})) {
      state.players[side][slot] = emptyPlayerLine();
    }
  }
  return state;
}

/**
 * Folds one event into the live state.
 *
 * Order-independent within an event and strictly ordered between them: the
 * state after N events is the game as of event N and nothing more.
 */
export function applyEvent(state, event) {
  if (!state || !event) return state;

  const quarter = event.quarter;
  if (quarter != null && !state.quarterScores[quarter]) {
    state.quarterScores[quarter] = { A: 0, B: 0 };
  }

  if (event.scoreDelta) {
    for (const side of SIDES) {
      const points = event.scoreDelta[side] || 0;
      if (!points) continue;
      state.score[side] += points;
      if (quarter != null) state.quarterScores[quarter][side] += points;
    }
  }

  if (event.playerDeltas) {
    for (const side of SIDES) {
      const bySlot = event.playerDeltas[side];
      if (!bySlot) continue;
      const lines = state.players[side];
      for (const slot of Object.keys(bySlot)) {
        let line = lines[slot];
        if (!line) {
          // TEAM is not a roster slot and is created on demand; anything else
          // this roster does not have simply did not happen, which is what the
          // engine's ledger says too.
          if (slot !== "TEAM") continue;
          line = lines.TEAM = emptyPlayerLine();
        }
        const delta = bySlot[slot];
        for (const key of Object.keys(delta)) line[key] = (line[key] || 0) + delta[key];
      }
    }
  }

  if (event.teamDeltas) {
    for (const side of SIDES) {
      const delta = event.teamDeltas[side];
      if (!delta) continue;
      const totals = state.team[side];
      for (const key of Object.keys(delta)) totals[key] = (totals[key] || 0) + delta[key];
    }
  }

  // Average start is DERIVED, never accumulated - it is a ratio, and adding
  // ratios is how an average drifts away from the drives behind it.
  for (const side of SIDES) {
    const totals = state.team[side];
    totals.averageStart = totals.drives ? Math.round(totals.startYardTotal / totals.drives) : 0;
  }

  state.applied += 1;
  return state;
}

/**
 * The live state as a box score, in the shape the renderers already expect.
 *
 * Rounding happens HERE, at the boundary between accumulating and printing,
 * for the same reason the engine rounds at that boundary: a touchdown is
 * worth 6.94 points internally - the extra point folded in at its real rate -
 * which is right for simulating and wrong for reading. Nobody scored 20.82.
 */
export function liveBox(state, side) {
  const source = state?.players?.[side] || {};
  const box = {};
  for (const slot of Object.keys(source)) {
    const line = { ...source[slot] };
    line.pts = Math.round(line.pts || 0);
    box[slot] = line;
  }
  return box;
}

/** The running score, as a scoreboard shows it. */
export function liveScore(state) {
  return { A: Math.round(state?.score?.A || 0), B: Math.round(state?.score?.B || 0) };
}

/** One line of plain football for the feed. The engine writes the drive's own
 * sentence; this covers the snaps in between, which it does not. */
function describePlay(play) {
  const y = Math.abs(play.gain);
  switch (play.type) {
    case "sack":
      return `Sacked for ${y}`;
    case "incompletion":
      return "Pass incomplete";
    case "run":
      return play.gain > 0 ? `Run for ${y}` : `Run stuffed for no gain`;
    case "deepPass":
      return `Deep completion for ${y}`;
    default:
      return play.gain > 0 ? `Pass complete for ${y}` : "Pass complete, no gain";
  }
}
