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
// pacing, it is a slideshow at the wrong frame rate: the score, the chart and
// the feed all moved faster than anyone could read a single line of them.
//
// Football already had the right shape for this - a weighted timeline scaled to
// a watchable target (js/sports/nfl/playback.js) - and this is the same idea in
// basketball's units. Every event gets a duration in proportion to how much
// there is to take in, the whole game is scaled to land in a known band, and a
// single `speed` divisor re-times all of it consistently.
//
// PACING CHANGES NOTHING BUT TIMING. The events, the box score, the shot chart
// and the MVP are all decided by the simulation before this module is called.
// Watching at 2x, or skipping to the end, cannot alter any of them.

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
 * What each kind of event is worth, in milliseconds at normal speed.
 *
 * These are RATIOS as much as durations: the whole game is scaled to fit the
 * target band below, so what survives scaling is how much longer a made three
 * is than a rebound. They are ordered the way a broadcast spends its attention.
 *
 * A rebound is the beat between two things happening and gets the shortest hold
 * of anything - it is also the most common event in the ledger, so it is where
 * most of the time saved comes from, which is what keeps a full game inside
 * four minutes without any of the moments feeling clipped.
 */
export const EVENT_MS = {
  rebound: 300,
  freeThrow: 420,
  missedTwo: 620,
  missedThree: 700,
  turnover: 800,
  madeTwo: 900,
  // A finish at the rim reads as one motion and is worth a beat more than a
  // jumper - it is the zone, which is a real fact about the shot, not a dunk
  // this module invented.
  madeRimTwo: 1050,
  steal: 1050,
  block: 1050,
  madeThree: 1300,
  // Unplaced scoring: a player whose dataset row has no shooting columns. It is
  // still points on the board and gets an ordinary make's hold.
  unplaced: 900,
};

/** Added on top of an event's own hold when the ledger says something larger
 * happened on it. Cumulative on purpose: the three that ends a quarter AND
 * flips the lead is the longest single beat in the game, which is right. */
export const EMPHASIS_MS = {
  run: 450,
  leadChange: 700,
  endOfPeriod: 900,
};

/**
 * The band a whole game's playback has to land in, and where it aims.
 *
 * A basketball game is 350-450 events against football's ~150, so the same
 * wall-clock target would give each of them a third of the time. Aiming near
 * 3 minutes 15 puts an ordinary miss at about half a second, a made basket at
 * three quarters, and a three that changes the lead past two - which is the
 * "fast gamecast" pace rather than either a highlight reel or a broadcast.
 *
 * The band matters more than the target: a blowout with 500 events and a
 * grinder with 320 should still take about the same time to watch, and scaling
 * every event by target/rawTotal is what makes that true while keeping the
 * ratios above intact.
 */
export const TARGET_MIN_MS = 150000;
export const TARGET_MAX_MS = 260000;
export const TARGET_MS = 195000;

/** Nothing is on screen for less than this at 1x. Divided by the speed rather
 * than applied under it, so asking for 2x gives 2x rather than 1.8x - see the
 * same note in football's timeline. */
const MIN_EVENT_MS = 110;

/** The speeds the viewer can choose. `skip` is not a speed - it is a separate
 * action that finishes the game immediately - and lives with the buttons rather
 * than here. */
export const SPEEDS = [1, 2];
export const DEFAULT_SPEED = 1;

/** How long the between-quarters card is on screen. Matches the .bc-break
 * animation in style.css. Longer than it used to be because there is now
 * something to read on it and time to read it in. */
export const QUARTER_CARD_MS = 1900;

/** What one event is worth before scaling. Every term is a fact the ledger
 * already carries, so the pacing follows the game rather than a script laid
 * over it. */
export function eventWeight(event) {
  let base;
  switch (event.type) {
    case "rebound": base = EVENT_MS.rebound; break;
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
    default: base = EVENT_MS.rebound;
  }
  if (event.runPoints) base += EMPHASIS_MS.run;
  if (event.leadChange) base += EMPHASIS_MS.leadChange;
  if (event.endOfPeriod) base += EMPHASIS_MS.endOfPeriod;
  return base;
}

/**
 * Lays the whole game out on a clock.
 *
 * Returns the events untouched plus, for each, `atMs` (when it appears, from
 * the opening tip) and `durationMs` (how long it holds). The quarter card's
 * time is added at the end of each period, so a period's span already includes
 * the pause the viewer gets to read it.
 *
 * @param opts.speed     divisor on every duration; 2 is twice as fast
 * @param opts.targetMs  override the aim, clamped to the band above. Used by
 *                       scripts/verify-nba-playback-pace.mjs, not by the app.
 */
export function buildPlaybackTimeline(events, opts = {}) {
  const list = events || [];
  if (!list.length) return { events: [], totalMs: 0, periods: [] };

  const speed = opts.speed > 0 ? opts.speed : DEFAULT_SPEED;
  const target = Math.max(TARGET_MIN_MS, Math.min(TARGET_MAX_MS, opts.targetMs || TARGET_MS));
  const cardMs = opts.quarterCardMs ?? QUARTER_CARD_MS;

  const weights = list.map(eventWeight);
  const rawTotal = weights.reduce((sum, w) => sum + w, 0);
  // ONE scale factor across every event, so the ratios in EVENT_MS survive: a
  // made three stays worth four rebounds whether the game had 320 events or 500.
  const scale = rawTotal > 0 ? target / rawTotal : 1;

  const timed = [];
  const periods = [];
  let atMs = 0;
  let periodStart = 0;
  let periodNumber = list[0].period;

  list.forEach((event, i) => {
    const durationMs = Math.max(MIN_EVENT_MS / speed, Math.round((weights[i] * scale) / speed));
    timed.push({ event, atMs, durationMs });
    atMs += durationMs;
    const last = i === list.length - 1;
    if (last || list[i + 1].period !== event.period) {
      // The between-quarters card sits at the END of the period it summarises,
      // after the last event of that period has had its own hold. It used to be
      // carved out of the FRONT of the next period's budget, which is why a
      // 1.4-second card was on screen for four hundred milliseconds.
      const cardAt = atMs;
      atMs += cardMs / speed;
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

/** The span one period occupies on the timeline, including its card. Shared
 * code asks for this to decide how long to hold a period before revealing the
 * next one - the same question football's timelineSpanFor answers. */
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
