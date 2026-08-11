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
  kickoff: 1050,
  driveStart: 720,
  // An ordinary snap. Most of a game is these, so this number sets the pace
  // more than any other - and at 650ms it was faster than a person can read
  // the description, the down and the ball's new position before it changed.
  play: 760,
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
  punt: 880,
  downs: 1500,
  // A drive's own epitaph - what it cost and what it produced. Worth more than
  // an ordinary snap because it is the one moment the viewer is being asked to
  // read several numbers at once.
  driveEnd: 1600,
  quarterEnd: 1500,
  halfEnd: 1700,
  gameEnd: 2200,
};

/** The band a whole game's playback has to land in. Below the floor nobody can
 * follow it; above the ceiling it stops being a highlight and becomes a
 * broadcast.
 *
 * Raised from 35-50s first, because at ~42s an ordinary snap held for about
 * 600ms - less time than it takes to read a description, find the ball and
 * check the down. Then trimmed again, see below. */
// TRIMMED TWICE against real browser wall clock: 50-70s measured 64.6s and
// read long; 46-64s measured 58.0s and still read a touch long. Now aiming
// near 53s. Neither reduction is uniform: the
// transition beats - kickoff, drive start, an ordinary snap, a punt - each
// gave back about 10% of their weight, while touchdowns, turnovers, field
// goals and the quarter breaks kept all of theirs. Every event is scaled by
// target/rawTotal, so shrinking the ordinary weights RAISES that scale
// factor - the moments worth watching lose less than the overhead does.
export const TARGET_MIN_MS = 42000;
export const TARGET_MAX_MS = 60000;
const TARGET_MS = 49000;

/**
 * Playback speed, as a divisor on every duration. 1 is the pace above; 2 is
 * twice as fast. Declared here so a speed control is a value to change rather
 * than a rewrite - nothing in this module measures itself against the wall
 * clock, so scaling this re-times the entire game consistently.
 *
 * No user-facing selector yet, deliberately.
 */
export const DEFAULT_SPEED = 1;

/** No event is worth less than this at normal speed - below it a snap is gone
 * before it can be read. Divided by the speed multiplier, not applied under
 * it; see buildTimeline. */
const MIN_EVENT_MS = 90;

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
        // A quarter ends at 0:00 by definition. The drives inside it rarely burn
        // the full fifteen minutes, so whatever was left has to be spent here or
        // the break is announced with time still on the clock.
        clockLeft = 0;
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
    // What the drive cost and what it produced, accumulated as it is walked so
    // the summary is the SAME plays the box score read - not a second pass
    // that could disagree with them.
    let drivePlays = 0;
    let driveSeconds = 0;

    const plays = Array.isArray(drive.plays) ? drive.plays : [];
    for (const play of plays) {
      drivePlays += 1;
      driveSeconds += play.seconds || 0;
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

      // THE DRIVE, IN ONE LINE. A football game is a sequence of drives, and
      // until now the feed only ever mentioned the ones that scored - so a
      // twelve-play march that stalled on the 4 looked exactly like a
      // three-and-out. Carries no deltas: everything it describes has already
      // been applied by the plays above, and adding it again would double the
      // whole drive.
      push("driveEnd", "driveEnd", {
        quarter: drive.quarter,
        possession: drive.team,
        yard: play.endYard,
        down: null,
        distance: null,
        driveSummary: {
          plays: drivePlays,
          yards: Math.round(drive.endYard - drive.startYard),
          seconds: driveSeconds,
          outcome: drive.outcome,
          startYard: drive.startYard,
          endYard: drive.endYard,
        },
        text: describeDrive(drive, drivePlays, driveSeconds),
      });
    }
  }

  // Same reason as the quarter break above: the whistle goes at 0:00. The final
  // screen was showing whatever the last drive left behind - "Q4 5:28" beside
  // the word FINAL, a game simultaneously over and still running.
  clockLeft = 0;
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
    // The floor SCALES with speed, rather than sitting under it. A fixed 90ms
    // is a legibility guarantee at normal pace, and at normal pace nothing
    // comes near it - the shortest event runs about 190ms. At 2x it started
    // clipping the shortest events, so asking for twice as fast returned a
    // game 1.9 times as fast, which quietly makes `speed` a suggestion. If the
    // viewer asks for double, they get double.
    e.durationMs = Math.max(MIN_EVENT_MS / speed, Math.round((e.weight * scale) / speed));
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
 * for the same reason the engine rounds at that boundary. Points are integers
 * now that the conversion after a touchdown is played out rather than folded
 * into it at 6.94, but the boundary is still where printing begins.
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

/** m:ss for a duration rather than a countdown - a drive lasts 3:24, it does
 * not read 3:24 on the clock. */
function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** How a drive is summed up once it is over: what it took, what it gained and
 * how it ended. Written here rather than in the UI because it is the same
 * sentence wherever a drive is shown. */
const DRIVE_OUTCOME_WORDS = {
  touchdown: "Touchdown",
  fieldGoal: "Field goal",
  punt: "Punt",
  turnover: "Turnover",
  downs: "Turnover on downs",
};

function describeDrive(drive, plays, seconds) {
  const yards = Math.round(drive.endYard - drive.startYard);
  const outcome = DRIVE_OUTCOME_WORDS[drive.outcome] || "Drive over";
  const gained = yards >= 0 ? `${yards} yards` : `${Math.abs(yards)} yards lost`;
  return `${outcome} - ${plays} ${plays === 1 ? "play" : "plays"}, ${gained}, ${formatDuration(seconds)}`;
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
