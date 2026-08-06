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

    push("driveStart", "driveStart", {
      quarter: drive.quarter,
      possession: drive.team,
      yard: drive.startYard,
      down: 1,
      distance: 10,
      text: `${drive.team === "A" ? "Home" : "Away"} ball, own ${drive.startYard}`,
    });

    const plays = Array.isArray(drive.plays) ? drive.plays : [];
    for (const play of plays) {
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
            text: describePlay(play),
          }
        );
        continue;
      }

      // The play that ended the drive carries the drive's result.
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
