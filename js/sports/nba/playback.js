// Basketball's playback: how the authoritative ledger is REVEALED.
//
// The ledger itself moved to js/sports/nba/ledger.js and is now built by the
// simulation - see the header there for why. What is left here is presentation
// in the strict sense: how long each event is on screen, how it is worded, and
// how the live strip and the box score fold the events that have already been
// shown. Nothing in this file decides a fact about the game.
//
// WHY THE PACING NEEDED ITS OWN MODEL
//
// A quarter used to be squeezed into QUARTER_REVEAL_DELAY_MS - 4.2 seconds, of
// which 1.6 belonged to the between-quarters card. About ninety events shared
// the remaining 2.6 seconds, so an ordinary shot was on screen for roughly 25
// milliseconds. A whole game finished in seventeen seconds. That is not fast
// pacing, it is a slideshow at the wrong frame rate.
//
// Football already had the right shape for this - a weighted timeline scaled to
// a watchable target (js/sports/nfl/playback.js) - and this is the same idea in
// basketball's units. Every event gets a duration in proportion to how much
// there is to take in, and the whole game is scaled to land in a known band.
//
// PACING CHANGES NOTHING BUT TIMING. The events, the box score, the shot chart
// and the MVP are all decided by the simulation before this module is called.
// Skipping to the end cannot alter any of them.
//
// AND THE LIVE STATE IS A FOLD OF WHAT HAS BEEN SHOWN. See THE LIVE LEDGER at
// the bottom of this file: the board, the box score and the strip are all
// derived from the events already revealed, so there is no path by which a
// quarter's total can appear before the quarter has been watched.

import {
  ZONES,
  FREE_THROW,
  annotateLedger,
  buildShotLedger,
  hydrateLedger,
  packLedger,
  unpackLedger,
} from "./ledger.js";

export { ZONES, FREE_THROW, annotateLedger, buildShotLedger, hydrateLedger, packLedger, unpackLedger };

/** How long a period is, for the board's derived clock. */
const QUARTER_SECONDS = 12 * 60;
const OT_SECONDS = 5 * 60;

/** "9:47". The board's reading of clockSeconds. */
export function formatClock(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// PACING
// ---------------------------------------------------------------------------

/**
 * What each kind of event is worth, in milliseconds.
 *
 * These are RATIOS as much as durations: the whole game is scaled to fit the
 * target band below, so what survives scaling is how much longer a made three
 * is than a missed jumper. They are ordered the way a broadcast spends its
 * attention.
 *
 * A REBOUND HAS NO ENTRY, and that is the single biggest reason a game now
 * fits in a minute. A ledger is 350-450 events and roughly a quarter of them
 * are rebounds - the beat BETWEEN two things happening, with no shot to place
 * and nothing to read. Giving each one its own hold spent a fifth of the game's
 * running time on the one event nobody is waiting for. They are folded into the
 * next beat instead (see `quiet` in buildPlaybackTimeline): the rebound still
 * happened, still counts, and still reaches the live strip - it just does not
 * get a turn on screen of its own.
 */
export const EVENT_MS = {
  freeThrow: 200,
  missedTwo: 190,
  missedThree: 220,
  turnover: 250,
  madeTwo: 330,
  // A finish at the rim reads as one motion and is worth a beat more than a
  // jumper - it is the zone, which is a real fact about the shot, not a dunk
  // this module invented.
  madeRimTwo: 380,
  steal: 330,
  block: 330,
  madeThree: 430,
  // Unplaced scoring: a player whose dataset row has no shooting columns. It is
  // still points on the board and gets an ordinary make's hold.
  unplaced: 330,
};

/** What a folded event is worth: nothing. It shares the beat of whichever
 * event comes after it, so its stats land at the same instant its successor is
 * revealed and the two are one thing to watch rather than two. */
export const QUIET_MS = 0;

/** Added on top of an event's own hold when the ledger says something larger
 * happened on it. Cumulative on purpose: the three that ends a quarter AND
 * flips the lead is the longest single beat in the game, which is right. */
export const EMPHASIS_MS = {
  run: 120,
  leadChange: 200,
  endOfPeriod: 260,
};

/**
 * THE LAST TWO MINUTES OF A CLOSE FOURTH QUARTER, and only then.
 *
 * A one-possession finish is the part of a game people actually lean in for,
 * and at an even pace it goes past at exactly the speed of the third-quarter
 * possession that decided nothing. This stretches those beats and nothing else:
 * a blowout's last two minutes are not close, get no multiplier, and finish at
 * the same clip as the rest of the game - which is what "blowouts finish
 * quickly" means here.
 *
 * It is applied BEFORE the single scale factor below, so it borrows the time
 * from the rest of the game rather than adding to the total: the game still
 * lands in the band, with more of it spent on the ending.
 */
const CLUTCH_SECONDS = 120;
const CLUTCH_MARGIN = 5;
const CLUTCH_MULTIPLIER = 1.7;

/**
 * The band a whole game's playback has to land in, and where it aims.
 *
 * ONE MINUTE, MEASURED. Playback used to aim at 195 seconds, which is a
 * broadcast's pace applied to a gamecast's amount of information: the score,
 * the chart and the box score all sat still for most of it. The target is now
 * the number a viewer actually asked for, and scripts/verify-nba-playback-pace.mjs
 * measures the min, mean and max over a few hundred simulated games rather than
 * trusting the arithmetic here.
 *
 * The band matters more than the target: a blowout with 500 events and a
 * grinder with 320 should still take about the same time to watch, and scaling
 * every event by target/rawTotal is what makes that true while keeping the
 * ratios above intact. THIS IS WHY THE LENGTH IS NOT A FUNCTION OF POSSESSION
 * COUNT - a busy game gets faster beats, not three minutes.
 */
export const TARGET_MIN_MS = 46000;
export const TARGET_MAX_MS = 62000;
export const TARGET_MS = 52000;

/** Nothing that gets a beat of its own is on screen for less than this. Folded
 * events are exempt: they are not on screen at all. */
const MIN_EVENT_MS = 90;

/** How long the between-quarters card is on screen, and how long the one at
 * half time is. Both are a beat rather than a screen - the card is there to
 * mark the seam, and a viewer who wants the quarter's numbers has the board
 * and the box score under it for the rest of the game. */
export const QUARTER_CARD_MS = 800;
export const HALFTIME_CARD_MS = 1400;

/** Which events get a beat of their own. Everything else is folded into the
 * next one that does - see EVENT_MS. Exported because the pace test asserts on
 * the compression directly rather than inferring it from a total. */
export function isQuietEvent(event) {
  // NEVER THE LAST EVENT OF A PERIOD, whatever it is. The quarter's column is
  // published by whichever event carries endOfPeriod, and a quiet event has no
  // turn on screen for that to happen in - so a quarter that happened to end on
  // a rebound would never post its line at all, and the board would carry a
  // live column into the next quarter.
  return event?.type === "rebound" && !event.endOfPeriod;
}

/** What one event is worth before scaling. Every term is a fact the ledger
 * already carries, so the pacing follows the game rather than a script laid
 * over it. */
export function eventWeight(event) {
  if (isQuietEvent(event)) return QUIET_MS;
  let base;
  switch (event.type) {
    case "steal": base = EVENT_MS.steal; break;
    case "block": base = EVENT_MS.block; break;
    case "turnover": base = EVENT_MS.turnover; break;
    case "shot":
      if (event.unplaced) base = EVENT_MS.unplaced;
      else if (event.shotType === FREE_THROW) base = EVENT_MS.freeThrow;
      else if (event.shotType === "three") base = event.made ? EVENT_MS.madeThree : EVENT_MS.missedThree;
      else if (!event.made) base = EVENT_MS.missedTwo;
      else base = event.strong ? EVENT_MS.madeRimTwo : EVENT_MS.madeTwo;
      break;
    default: base = EVENT_MS.turnover;
  }
  if (event.runPoints) base += EMPHASIS_MS.run;
  if (event.leadChange) base += EMPHASIS_MS.leadChange;
  if (event.endOfPeriod) base += EMPHASIS_MS.endOfPeriod;
  if (isClutch(event)) base *= CLUTCH_MULTIPLIER;
  return base;
}

/** A one-possession game inside the last two minutes of the fourth, or of any
 * overtime - both are endings, and an overtime is nothing but ending. Read off
 * the ledger's own clock and running score, so it cannot disagree with the
 * board beside it. */
function isClutch(event) {
  if (!event || typeof event.clockSeconds !== "number") return false;
  if (event.period < REGULATION_PERIODS) return false;
  if (event.clockSeconds > CLUTCH_SECONDS) return false;
  const score = event.scoreAfter;
  if (!score) return false;
  return Math.abs(score.a - score.b) <= CLUTCH_MARGIN;
}

/** Periods in regulation. Basketball's four, named here so isClutch does not
 * have to import shared constants into a per-sport module. */
const REGULATION_PERIODS = 4;

/**
 * Lays the whole game out on a clock.
 *
 * Returns one entry per event with `atMs` (when it appears, from the opening
 * tip), `durationMs` (how long it holds) and `quiet` (whether it gets a turn on
 * screen at all). A quiet entry sits at the SAME atMs as the beat that follows
 * it, which is what makes "the rebound and the shot that came off it are one
 * thing to watch" true of the timeline rather than a rule the player has to
 * remember.
 *
 * The quarter card's time is added at the end of each period, so a period's
 * span already includes the pause the viewer gets to read it.
 *
 * @param opts.targetMs  override the aim, clamped to the band above. Used by
 *                       scripts/verify-nba-playback-pace.mjs, not by the app.
 */
export function buildPlaybackTimeline(events, opts = {}) {
  const list = events || [];
  if (!list.length) return { events: [], totalMs: 0, periods: [] };

  const target = Math.max(TARGET_MIN_MS, Math.min(TARGET_MAX_MS, opts.targetMs || TARGET_MS));
  const cardMs = opts.quarterCardMs ?? QUARTER_CARD_MS;
  const halfMs = opts.halftimeCardMs ?? HALFTIME_CARD_MS;

  const weights = list.map(eventWeight);
  const rawTotal = weights.reduce((sum, w) => sum + w, 0);
  // ONE scale factor across every event, so the ratios in EVENT_MS survive: a
  // made three stays worth two missed jumpers whether the game had 320 events
  // or 500, and a busy game is watched at a quicker clip rather than for longer.
  const scale = rawTotal > 0 ? target / rawTotal : 1;

  const timed = [];
  const periods = [];
  let atMs = 0;
  let periodStart = 0;
  let periodNumber = list[0].period;

  list.forEach((event, i) => {
    const quiet = isQuietEvent(event);
    // A folded event holds for nothing and therefore shares the instant of
    // whatever comes next. It is still IN the timeline: the driver applies its
    // stats, it just does not spend a beat announcing them.
    const durationMs = quiet ? 0 : Math.max(MIN_EVENT_MS, Math.round(weights[i] * scale));
    timed.push({ event, atMs, durationMs, quiet });
    atMs += durationMs;
    const last = i === list.length - 1;
    if (last || list[i + 1].period !== event.period) {
      // The between-quarters card sits at the END of the period it summarises,
      // after the last event of that period has had its own hold. It used to be
      // carved out of the FRONT of the next period's budget, which is why a
      // 1.4-second card was on screen for four hundred milliseconds.
      const cardAt = atMs;
      // Half time is the one seam in a basketball game that is genuinely longer
      // than the others, and the card is the only thing on screen that can say
      // so. Not on the last period: there is no next quarter to introduce, and
      // the final buzzer is the beat there.
      atMs += last ? cardMs : event.period === 2 ? halfMs : cardMs;
      periods.push({
        period: periodNumber,
        overtime: !!event.overtime,
        startMs: periodStart,
        cardAtMs: cardAt,
        endMs: atMs,
        spanMs: atMs - periodStart,
      });
      periodStart = atMs;
      if (!last) periodNumber = list[i + 1].period;
    }
  });

  return { events: timed, totalMs: atMs, periods };
}

/** The span one period occupies on the timeline, including its card. */
export function periodSpan(timeline, period) {
  const found = (timeline?.periods || []).find((p) => p.period === period);
  return found ? found.spanMs : 0;
}

// ---------------------------------------------------------------------------
// WORDING AND FOLDS
// ---------------------------------------------------------------------------

/**
 * One event, as the possession feed says it out loud.
 *
 * Returned as PARTS rather than a sentence, because the feed sets the player's
 * name, what happened, and whether it dropped in three different weights.
 *
 * Every word is derived from the event and nothing is embellished. A rim finish
 * reads "at the rim", not "DUNK": the engine has no dunks and no fouls, so
 * there is no honest way to emit either.
 */
export function describeEvent(event) {
  if (!event) return null;
  const zone = event.zone ? ZONES[event.zone] : null;
  switch (event.type) {
    case "shot": {
      if (event.shotType === FREE_THROW) {
        // An unplaced bucket is worth what the engine said, which may be two or
        // three - calling that a free throw is the same fabrication as counting
        // it as one.
        return {
          player: event.player,
          detail: event.unplaced ? "Scored" : "Free throw",
          verdict: event.made ? "MADE" : "MISS",
          made: event.made,
        };
      }
      // "Finish" only when it actually finished. The zone's `strong` flag is a
      // property of the RIM - it is true whether the shot fell or not - so a
      // missed layup read "Finish at the rim - MISS", a sentence that argues
      // with itself.
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
 * READ OFF THE SAME EVENTS THE SCOREBOARD IS. A quarter line is only true once
 * the quarter is over; the strip under the court has to be true right now, and
 * the only thing that knows "right now" is how far into the ledger the playback
 * has got.
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
      if (e.unplaced) {
        if (e.made) team.pts += e.points;
        continue;
      }
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
      // An assist is credited to the PASSER's team, which is the shooter's team
      // - a passer is never given his own basket (see assignAssists), so
      // counting it on the shot is the same total by a shorter route.
      if (e.made && e.assistedBy) team.ast += 1;
    } else if (e.type === "rebound") team.reb += 1;
    else if (e.type === "steal") team.stl += 1;
    else if (e.type === "block") team.blk += 1;
    else if (e.type === "turnover") team.tov += 1;
  }
  return totals;
}

/**
 * Every player's shooting line, folded from the ledger.
 *
 * The ledger is an expansion of the box score's own shooting columns, so this
 * necessarily agrees with them - which is what it is for. It exists so the LIVE
 * table can show a partial line mid-game without asking the box score for a
 * total that has not happened yet.
 *
 * Keyed by side, then by roster slot, matching what the box score asks for.
 */
export function foldPlayerShotLines(events) {
  const lines = { a: {}, b: {} };
  for (const event of events || []) {
    if (event.type !== "shot" || event.unplaced) continue;
    const side = lines[event.side];
    if (!side) continue;
    const line = (side[event.slot] ||= { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, points: 0 });
    if (event.shotType === FREE_THROW) {
      line.fta += 1;
      if (event.made) line.ftm += 1;
    } else {
      line.fga += 1;
      if (event.shotType === "three") line.tpa += 1;
      if (event.made) {
        line.fgm += 1;
        if (event.shotType === "three") line.tpm += 1;
      }
    }
    if (event.made) line.points += event.points;
  }
  return lines;
}

export function scoreAfter(events, upTo) {
  const score = { a: 0, b: 0 };
  for (let i = 0; i <= upTo && i < events.length; i++) {
    const e = events[i];
    if (e.type === "shot" && e.made) score[e.side] += e.points;
  }
  return score;
}

export { QUARTER_SECONDS, OT_SECONDS };

// ---------------------------------------------------------------------------
// THE LIVE LEDGER
//
// A game being watched, as of the last event revealed. Nothing here reads
// ahead: the state is a pure fold of the events applied so far, which is what
// makes "stop in the middle of Q1 and the second half of Q1 is genuinely not
// visible" a property of the design rather than a rule to remember.
//
// THIS IS THE FIX FOR THE SCOREBOARD SHOWING A QUARTER BEFORE IT WAS PLAYED.
// The board used to be driven from result.quarterBoxScores: at the first tick
// of Q1 it published Q1's finished total and every player's Q1 line, and only
// then began playing the events that produced them. There was no state that
// meant "the game so far", so there was nothing else it could have shown.
//
// The AUTHORITATIVE RESULT is untouched by any of this. The ledger is an exact
// expansion of the box score (scripts/verify-nba-shot-ledger.mjs asserts that
// points, rebounds, steals, blocks and turnovers reconcile per player per
// quarter), so folding all of it necessarily arrives at the result the
// simulation recorded - which is what makes the final frame of playback and the
// final result the same numbers by construction rather than by agreement.
// ---------------------------------------------------------------------------

/**
 * What the possession feed says about this event, or null for one it does not
 * mention.
 *
 * NOT EVERY EVENT. A line for all four hundred is a wall nobody follows, and
 * the court already showed the ordinary ones. What reaches the feed is what a
 * commentator would say out loud: a make worth naming, and every takeaway.
 *
 * RUNS ARE SAID ONCE. `runPoints` is set on every scoring event while a run is
 * alive, so a 12-0 run used to push "ON A 8-0 RUN", "ON A 10-0 RUN" and "ON A
 * 12-0 RUN" as three separate cards - the feed filling up with one thing
 * happening. `lastRun` remembers which side's run has already been announced
 * and stays quiet until the run is broken and a new one starts.
 *
 * Stateful on purpose, and the state lives in a closure rather than on the
 * events: whether a run has been MENTIONED is a fact about this viewing, not
 * about the game, and writing it onto the ledger would put a presentation
 * decision inside the authoritative record.
 */
export function createFeedVoice() {
  let lastRun = null;
  return function feedLine(event, { labelA, labelB } = {}) {
    const team = (side) => (side === "a" ? labelA : labelB);
    if (event.leadChange) {
      lastRun = null;
      return { text: `${team(event.side)} TAKE THE LEAD`, kind: "lead-change" };
    }
    if (event.runPoints) {
      // A run belongs to a side; it is the same run until the other team
      // scores, which is exactly when annotateMoments stops setting runPoints.
      if (lastRun !== event.runSide) {
        lastRun = event.runSide;
        return { text: `${team(event.runSide)} ON A ${event.runPoints}-0 RUN`, kind: "run" };
      }
    } else if (event.type === "shot" && event.made) {
      lastRun = null;
    }
    const said = describeEvent(event);
    if (!said) return null;
    const worthSaying =
      (event.type === "shot" && event.made && (event.shotType === "three" || event.strong || event.endOfPeriod)) ||
      event.type === "steal" ||
      event.type === "block";
    if (!worthSaying) return null;
    return { text: `${said.player} — ${said.detail}${said.verdict ? ` — ${said.verdict}` : ""}`, kind: "" };
  };
}

/** The sound this event makes, or null. The sound names the KIND of shot, and
 * the throttle in sound.js keeps a busy quarter from turning into a buzz. A
 * miss is quieter than a make on purpose - the court already shows every
 * attempt, and the sound marks the ones that changed the score. */
export function eventSound(event) {
  if (event.type === "shot") {
    if (!event.made) return "shotMiss";
    if (event.strong) return "rimFinish";
    return event.shotType === "three" ? "shotThree" : "shotMade";
  }
  if (event.type === "steal" || event.type === "block") return "steal";
  if (event.leadChange) return "steal";
  return null;
}

/** Every basketball event moves somebody's line, so the box score is always
 * stale after one. The driver coalesces the repaints onto a frame; this only
 * answers whether there is anything to repaint. */
export function eventChangesBox() {
  return true;
}

/** An empty player line, in basketball's own box-score columns plus the
 * shooting splits the strip reads. */
const emptyPlayerLine = () => ({
  pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0,
  fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
});

/**
 * An empty game, ready to have events folded into it.
 *
 * Seeded from the rosters: a quiet bench player had a quiet game, he did not
 * fail to exist, and a missing row is the one thing a box score must never say.
 * It also fixes what a slot IS, so an event naming a slot this roster does not
 * have is dropped rather than inventing a row.
 */
export function createLiveState({ rosterA, rosterB } = {}) {
  const state = {
    score: { A: 0, B: 0 },
    /** Points per period, so a quarter column is a READ of what was watched
     * rather than a separate tally that could disagree with the running score. */
    quarterScores: {},
    players: { A: {}, B: {} },
    team: { A: emptyTeamStats(), B: emptyTeamStats() },
    /** How many events have been folded in - the cheap way for a renderer to
     * tell whether anything changed. */
    applied: 0,
  };
  for (const [side, roster] of [["A", rosterA], ["B", rosterB]]) {
    for (const slot of Object.keys(roster || {})) state.players[side][slot] = emptyPlayerLine();
  }
  return state;
}

/** The ledger speaks in "a"/"b"; the box score and the scoreboard in "A"/"B". */
const SIDE_KEY = { a: "A", b: "B" };

/**
 * Folds one event into the live state.
 *
 * Strictly ordered between events and complete within one: the state after N
 * events is the game as of event N and nothing more. Every branch mirrors
 * foldLiveStats above - the difference is that this accumulates once per event
 * instead of re-walking the ledger, which is what lets the driver call it four
 * hundred times a game without the O(n squared) that froze this app once.
 */
export function applyEvent(state, event) {
  if (!state || !event) return state;
  const side = SIDE_KEY[event.side];
  if (!side) return state;

  const period = event.period;
  if (period != null && !state.quarterScores[period]) state.quarterScores[period] = { A: 0, B: 0 };

  const team = state.team[side];
  const line = state.players[side][event.slot] || null;
  const points = event.type === "shot" && event.made ? event.points || 0 : 0;

  if (event.type === "shot") {
    if (!event.unplaced) {
      if (event.shotType === FREE_THROW) {
        team.fta += 1;
        if (line) line.fta += 1;
        if (event.made) {
          team.ftm += 1;
          if (line) line.ftm += 1;
        }
      } else {
        team.fga += 1;
        if (line) line.fga += 1;
        if (event.shotType === "three") {
          team.tpa += 1;
          if (line) line.tpa += 1;
        }
        if (event.made) {
          team.fgm += 1;
          if (line) line.fgm += 1;
          if (event.shotType === "three") {
            team.tpm += 1;
            if (line) line.tpm += 1;
          }
        }
      }
    }
    if (points) {
      team.pts += points;
      if (line) line.pts += points;
      state.score[side] += points;
      if (period != null) state.quarterScores[period][side] += points;
      // The assist belongs to the PASSER, who is on the shooter's team (a
      // passer is never given his own basket - see assignAssists), so crediting
      // it on the make is the same total by a shorter route.
      if (event.assistedBy) {
        team.ast += 1;
        const passer = state.players[side][event.assistedBy];
        if (passer) passer.ast += 1;
      }
    }
  } else if (event.type === "rebound") {
    team.reb += 1;
    if (line) line.reb += 1;
  } else if (event.type === "steal") {
    team.stl += 1;
    if (line) line.stl += 1;
  } else if (event.type === "block") {
    team.blk += 1;
    if (line) line.blk += 1;
  } else if (event.type === "turnover") {
    team.tov += 1;
    if (line) line.tov += 1;
  }

  state.applied += 1;
  return state;
}

/** The live state as a box score, in the shape the renderers already expect. */
export function liveBox(state, side) {
  const source = state?.players?.[side] || {};
  const box = {};
  for (const slot of Object.keys(source)) box[slot] = { ...source[slot] };
  return box;
}

/** The running score, as the scoreboard shows it. */
export function liveScore(state) {
  return { A: state?.score?.A || 0, B: state?.score?.B || 0 };
}

/** The strip under the court, in the shape court.js's paintStats reads - the
 * same shape foldLiveStats returns, so the two are interchangeable and the
 * finished game and the live one are described by one function. */
export function liveTeamStats(state) {
  return { a: state?.team?.A || emptyTeamStats(), b: state?.team?.B || emptyTeamStats() };
}

/** Points scored in one period, as watched. Used for the quarter column and
 * the between-quarters card, neither of which may read ahead of the events. */
export function livePeriodScore(state, period) {
  const found = state?.quarterScores?.[period];
  return { a: found?.A || 0, b: found?.B || 0 };
}
