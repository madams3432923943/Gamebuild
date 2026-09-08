// Basketball's stage: the court, the shots that land on it, and the strip of
// numbers underneath. Full account in docs/nba-presentation.md.
//
// A sport's presentation lives with that sport - js/sports/nfl/field.js is the
// counterpart - and js/main.js reaches it through the registry rather than by
// importing basketball. That rule is why an NFL draft once dealt PG/SG/SF/PF/C,
// and it is not being relaxed for a court.
//
// EVERYTHING DRAWN HERE COMES FROM THE LEDGER. js/sports/nba/playback.js
// decomposes the engine's per-quarter stat lines into an ordered ledger, and
// every marker, caption, percentage and run is read off it. Nothing here
// simulates or invents: the score is decided before the first marker is drawn,
// and scripts/verify-nba-court.mjs asserts that the two agree.
//
// The SVG is 100 x 94 units - a 50ft x 47ft half-court at two units to the foot
// - and the ledger's normalised x/y map onto it directly. The y axis is the one
// conversion: SVG counts down from the top and the ledger counts out from the
// baseline, so the basket sits at the BOTTOM, where a shot chart puts it.

import { escapeHtml } from "../../lib/escape-html.js";
import { describeEvent, formatClock } from "./playback.js";

/** How many periods before overtime. Basketball's own, because a sport with a
 * different number would answer differently and shared code never asks. */
const REGULATION_PERIODS = 4;

/** Two units to the foot, so every measurement below is the real one. */
const FT = 2;
const COURT_W = 50 * FT; // 100
const COURT_H = 47 * FT; // 94

/** The real court, in feet, measured from the baseline. */
const RIM_Y = 5.25 * FT;
const RIM_R = 0.75 * FT;
const BACKBOARD_Y = 4 * FT;
const BACKBOARD_HALF = 3 * FT;
const PAINT_HALF = 8 * FT;
const PAINT_DEPTH = 19 * FT;
const FT_CIRCLE_R = 6 * FT;
const RESTRICTED_R = 4 * FT;
const ARC_R = 23.75 * FT;
const CORNER_X = 3 * FT;

/** Where the three-point arc meets the straight corner segment. Solved rather
 * than typed in, so the two never come apart if a measurement is corrected. */
const CORNER_Y = RIM_Y + Math.sqrt(ARC_R * ARC_R - (COURT_W / 2 - CORNER_X) ** 2);

/** Ledger space (x 0..1 across the floor, y 0..0.94 out from the baseline) to
 * SVG space (y counting down from the top). One function, so a marker in the
 * live chart and the same marker in the post-game chart cannot land in two
 * different places. */
function toSvg(point) {
  return { x: point.x * COURT_W, y: COURT_H - point.y * COURT_W };
}

/** The court furniture: everything that does not move.
 *
 * Emitted as one SVG string rather than element by element because it is drawn
 * once per game and never touched again - the markers go into their own group,
 * which is the only thing playback ever appends to. */
function courtMarkup() {
  const midY = COURT_H - RIM_Y;
  const arcStartX = CORNER_X;
  const arcEndX = COURT_W - CORNER_X;
  const arcY = COURT_H - CORNER_Y;
  return `
    <svg class="bc-svg" viewBox="0 0 ${COURT_W} ${COURT_H}" preserveAspectRatio="xMidYMid meet"
         role="img" aria-label="Basketball half court">
      <rect class="bc-floor" x="0" y="0" width="${COURT_W}" height="${COURT_H}" rx="2" />
      <rect class="bc-line bc-paint" x="${COURT_W / 2 - PAINT_HALF}" y="${COURT_H - PAINT_DEPTH}"
            width="${PAINT_HALF * 2}" height="${PAINT_DEPTH}" />
      <circle class="bc-line" cx="${COURT_W / 2}" cy="${COURT_H - PAINT_DEPTH}" r="${FT_CIRCLE_R}" />
      <path class="bc-line" d="M ${COURT_W / 2 - RESTRICTED_R} ${midY}
            A ${RESTRICTED_R} ${RESTRICTED_R} 0 0 0 ${COURT_W / 2 + RESTRICTED_R} ${midY}" />
      <path class="bc-line bc-arc"
            d="M ${arcStartX} ${COURT_H} L ${arcStartX} ${arcY}
               A ${ARC_R} ${ARC_R} 0 0 0 ${arcEndX} ${arcY} L ${arcEndX} ${COURT_H}" />
      <line class="bc-line bc-backboard" x1="${COURT_W / 2 - BACKBOARD_HALF}" y1="${COURT_H - BACKBOARD_Y}"
            x2="${COURT_W / 2 + BACKBOARD_HALF}" y2="${COURT_H - BACKBOARD_Y}" />
      <circle class="bc-rim" cx="${COURT_W / 2}" cy="${midY}" r="${RIM_R}" />
      <g class="bc-markers"></g>
      <g class="bc-flash"></g>
    </svg>`;
}

/** One team's cell in the live stat strip. */
function statColumn(side, label) {
  return (
    `<div class="bc-stat-team bc-stat-${side}">` +
    `<span class="bc-stat-name">${escapeHtml(label)}</span>` +
    ["fg", "tp", "reb", "ast", "tov"]
      .map(
        (key) =>
          `<span class="bc-stat"><b data-stat="${side}-${key}">-</b>` +
          `<i>${{ fg: "FG%", tp: "3P%", reb: "REB", ast: "AST", tov: "TO" }[key]}</i></span>`
      )
      .join("") +
    `</div>`
  );
}

/**
 * Draws the court a basketball game is watched on.
 *
 * Returns refs the way renderField does: playback writes through these rather
 * than re-rendering, so a game never rebuilds the DOM mid-quarter. Not a
 * micro-optimisation - see scripts/verify-live-scroll.mjs for what rebuilding
 * above the viewport did to a reader on a phone.
 */
export function renderCourt(container, labelA, labelB) {
  container.innerHTML = "";
  container.classList.remove("hidden");

  const status = document.createElement("div");
  status.className = "bc-status";
  status.innerHTML =
    // Who has the ball, said in a chip rather than only in prose - the colour
    // and the side it sits on carry it for anyone not reading the words.
    `<span class="bc-possession"></span>` +
    // A run, when there is one. Empty the rest of the time rather than showing
    // "0-0 run", which is not a thing that happens.
    `<span class="bc-run"></span>`;

  const court = document.createElement("div");
  court.className = "bc-court";
  court.innerHTML = courtMarkup();

  // The big-play banner, over the floor. Positioned rather than inserted, so it
  // appearing and going never changes the height of anything.
  const call = document.createElement("div");
  call.className = "bc-call";
  court.appendChild(call);

  const stats = document.createElement("div");
  stats.className = "bc-stats";
  stats.innerHTML = statColumn("a", labelA) + statColumn("b", labelB);

  // The quarter card. Also an overlay, for the same reason as the banner.
  const breakCard = document.createElement("div");
  breakCard.className = "bc-break hidden";
  court.appendChild(breakCard);

  container.append(status, court, stats);

  return {
    container,
    svg: court.querySelector(".bc-svg"),
    markers: court.querySelector(".bc-markers"),
    flash: court.querySelector(".bc-flash"),
    call,
    breakCard,
    stats,
    possession: status.querySelector(".bc-possession"),
    run: status.querySelector(".bc-run"),
    labelA,
    labelB,
  };
}

/**
 * What the scoreboard's centre cell reads - "Q3 · 7:41", or "OT1 · 2:16".
 *
 * Basketball answers this, shared code asks it, exactly as football does. The
 * clock is derived and playback.js is blunt about it: the engine has no clock,
 * so this is the period's real length laid over the period's own event order.
 * It counts down and restarts each quarter; it is not a claim about when a shot
 * went up.
 */
export function liveStatusLabel(event) {
  if (!event || typeof event.clockSeconds !== "number") return null;
  return `${periodLabel(event)} · ${formatClock(event.clockSeconds)}`;
}

/** "Q3", or "OT1" past regulation. `period` is one-based across every period
 * including overtime, so the first overtime is period 5.
 *
 * One function for the live board and the chart's marker titles: the chart had
 * its own and called overtime shots "Q5" while the board said "OT1". */
function periodLabel(event) {
  return event.overtime ? `OT${event.period - REGULATION_PERIODS}` : `Q${event.period}`;
}

/**
 * The loudest true thing about this event, or null for an ordinary one.
 *
 * WHAT IS NOT HERE: no DUNK and no AND-1. The engine models neither a dunk nor
 * a foul, so a banner claiming one is a fabricated statistic with a font. A rim
 * finish gets the loudest treatment there is, captioned as what it actually is.
 *
 * Ordered by what a commentator would raise their voice for, and only ONE
 * fires - stacking three banners on one event is how a broadcast turns into a
 * slot machine.
 */
function bigPlay(event, labelA, labelB) {
  const team = (side) => (side === "a" ? labelA : labelB);
  if (event.leadChange) return { text: `${team(event.side)} TAKE THE LEAD`, tone: "lead" };
  if (event.type === "block") return { text: "BLOCK", tone: "deny" };
  if (event.type === "steal") return { text: "STEAL", tone: "deny" };
  if (event.type === "shot" && event.made && event.endOfPeriod) {
    return { text: "AT THE BUZZER", tone: "buzzer" };
  }
  if (event.type === "shot" && event.made && event.shotType === "three") {
    return { text: `${event.player.toUpperCase()} FROM DEEP`, tone: "three" };
  }
  if (event.type === "shot" && event.made && event.strong) {
    return { text: `${event.player.toUpperCase()} AT THE RIM`, tone: "rim" };
  }
  if (event.type === "turnover") return { text: "TURNOVER", tone: "loose" };
  return null;
}

/** A percentage, or a dash when nothing has been attempted. 4/9 is a claim and
 * 0/0 is not - printing "0.0%" for a team that has not shot yet is a false one. */
function pct(makes, attempts) {
  return attempts > 0 ? `${Math.round((makes / attempts) * 100)}%` : "-";
}

/**
 * Renders one ledger event onto the court.
 *
 * `stats` is the folded line for both teams up to and including this event,
 * passed in rather than recomputed: folding the whole ledger per event is
 * O(n squared), and this app has frozen a browser once by rebuilding a derived
 * index per row.
 */
export function showEvent(refs, event, stats) {
  if (!refs || !event) return;

  // WHOSE BALL IT IS. The viewer is always side A, so this is also the answer
  // to "am I attacking or defending" - the state goes on the container so the
  // floor, the chip and the strip can all respond to one class.
  //
  // WHO ENDS THE EVENT WITH THE BALL, which is not the same as whose event it
  // is, and the two go opposite ways depending on the stat:
  //
  //   shot     the shooter's team had it
  //   rebound  the rebounder's team has it now
  //   steal    credited to the STEALER, so his team has it now
  //   turnover credited to the player who LOST it, so the other team has it
  //   block    the shot belonged to the other team, so it was theirs
  //
  // Read off the event's own type rather than tracked across events, so a
  // missed frame cannot leave the arrow pointing the wrong way for a whole
  // quarter. This had steals and turnovers the wrong way round, which is the
  // most visible half of it: a steal is the one moment in a basketball game
  // where everybody in the building knows who has the ball.
  const lostIt = event.type === "turnover" || event.type === "block";
  const withBall = lostIt ? (event.side === "a" ? "b" : "a") : event.side;
  refs.container.classList.toggle("bc-user-offense", withBall === "a");
  refs.container.classList.toggle("bc-user-defense", withBall === "b");
  refs.possession.textContent =
    withBall === "a" ? `▶ ${refs.labelA} ball` : `${refs.labelB} ball ◀`;

  // A run, when the ledger says there is one. runPoints is only set past the
  // threshold a broadcast would bother mentioning, and it is read off the
  // running score - so it can never disagree with the scoreboard beside it.
  //
  // IT STAYS UP UNTIL THE RUN IS OVER, not until the next event. runPoints is
  // set on the SCORING event alone and the ledger interleaves rebounds and
  // takeaways between baskets, so clearing on anything without it put "8-0 RUN"
  // on screen for about thirty milliseconds. A run is broken by the OTHER team
  // scoring, exactly as annotateMoments defines it.
  if (event.runPoints) {
    refs.runSide = event.runSide;
    refs.run.textContent = `${event.runPoints}-0 RUN — ${event.runSide === "a" ? refs.labelA : refs.labelB}`;
    refs.run.className = `bc-run live ${event.runSide === "a" ? "side-a" : "side-b"}`;
  } else if (
    refs.runSide &&
    event.type === "shot" &&
    event.made &&
    event.points > 0 &&
    event.side !== refs.runSide
  ) {
    refs.runSide = null;
    refs.run.textContent = "";
    refs.run.className = "bc-run";
  }

  // A shot leaves a mark. Everything else is a caption and a flash: there is no
  // coordinate for a rebound or a steal, and putting one somewhere plausible
  // would be inventing a position the ledger does not have.
  if (event.type === "shot" && typeof event.x === "number") {
    const at = toSvg(event);
    const marker = document.createElementNS("http://www.w3.org/2000/svg", event.made ? "circle" : "path");
    if (event.made) {
      marker.setAttribute("cx", at.x.toFixed(2));
      marker.setAttribute("cy", at.y.toFixed(2));
      marker.setAttribute("r", event.shotType === "three" ? "2.2" : "2");
    } else {
      // A cross, not a hollow circle. Made and missed have to be separable
      // without colour - a chart where the only difference is hue is a chart
      // eight percent of men cannot read.
      const s = 1.8;
      marker.setAttribute(
        "d",
        `M ${(at.x - s).toFixed(2)} ${(at.y - s).toFixed(2)} L ${(at.x + s).toFixed(2)} ${(at.y + s).toFixed(2)} ` +
          `M ${(at.x + s).toFixed(2)} ${(at.y - s).toFixed(2)} L ${(at.x - s).toFixed(2)} ${(at.y + s).toFixed(2)}`
      );
    }
    marker.setAttribute(
      "class",
      `bc-shot ${event.made ? "made" : "miss"} side-${event.side}` + (event.strong && event.made ? " strong" : "")
    );
    refs.markers.appendChild(marker);
    // THE FADE IS CSS, NOT A TIMER. A setTimeout per shot is two hundred timers
    // a game, every one of which has to be cancelled if the viewer leaves; an
    // animation that ends on the faint accumulated state needs none and cannot
    // outlive the element. See cleanupPlayback in js/main.js for what the
    // timer version costs.
    marker.classList.add("fresh");

    if (event.made) {
      const pop = document.createElementNS("http://www.w3.org/2000/svg", "text");
      pop.setAttribute("x", at.x.toFixed(2));
      pop.setAttribute("y", (at.y - 4).toFixed(2));
      pop.setAttribute("class", `bc-pop side-${event.side}`);
      pop.textContent = `+${event.points}`;
      refs.flash.appendChild(pop);
      // Removed when its own animation ends, so the layer does not accumulate
      // two hundred invisible text nodes over a game.
      pop.addEventListener("animationend", () => pop.remove(), { once: true });
      // AND CAPPED, because animationend is not guaranteed to fire. Under
      // prefers-reduced-motion the pop has no animation at all (see the
      // reduced-motion block in style.css), so nothing would ever remove one
      // and a game would end with two hundred invisible text nodes stacked on
      // the floor. A hard cap needs no event and no timer.
      while (refs.flash.childNodes.length > 8) refs.flash.firstChild.remove();
    }
  }

  const play = bigPlay(event, refs.labelA, refs.labelB);
  if (play) {
    refs.call.textContent = play.text;
    // Retriggered by reflow: re-adding a class that is already there is a no-op
    // without one, so two big plays in a row would only play the first.
    refs.call.className = "bc-call";
    void refs.call.offsetWidth;
    refs.call.className = `bc-call show ${play.tone}`;
  }

  if (stats) paintStats(refs, stats);
}

/** The strip under the floor, written cell by cell into elements that already
 * exist. It sits above the box score on a phone, so rebuilding it would move
 * the box score under a reader's finger every time somebody scored - which is
 * the bug this whole screen was rebuilt around. */
function paintStats(refs, stats) {
  for (const side of ["a", "b"]) {
    const line = stats[side];
    if (!line) continue;
    const write = (key, value) => {
      const el = refs.stats.querySelector(`[data-stat="${side}-${key}"]`);
      if (el && el.textContent !== value) el.textContent = value;
    };
    write("fg", pct(line.fgm, line.fga));
    write("tp", pct(line.tpm, line.tpa));
    write("reb", String(line.reb));
    write("ast", String(line.ast));
    write("tov", String(line.tov));
  }
}

/**
 * The card between quarters. Every number on it is read off the ledger and the
 * engine's own box score, so it cannot disagree with the scoreboard it covers.
 * Brief on purpose: a beat between quarters, not a screen.
 */
export function showQuarterBreak(refs, { label, scoreA, scoreB, leader, stats }) {
  if (!refs || !refs.breakCard) return;
  const teamShooting = (side, name) =>
    `<div class="bc-break-row"><span>${escapeHtml(name)}</span>` +
    `<b>${pct(stats?.[side]?.fgm, stats?.[side]?.fga)}</b></div>`;

  refs.breakCard.innerHTML =
    `<div class="bc-break-title">End of ${escapeHtml(label)}</div>` +
    `<div class="bc-break-score">` +
    `<span class="bc-break-side"><i>${escapeHtml(refs.labelA)}</i><b>${scoreA}</b></span>` +
    `<span class="bc-break-side"><i>${escapeHtml(refs.labelB)}</i><b>${scoreB}</b></span>` +
    `</div>` +
    (leader
      ? `<div class="bc-break-leader">Leading scorer<br><b>${escapeHtml(leader.name)}</b> — ${leader.points} PTS</div>`
      : "") +
    `<div class="bc-break-shooting"><span class="bc-break-label">Field goals</span>` +
    teamShooting("a", refs.labelA) +
    teamShooting("b", refs.labelB) +
    `</div>`;

  refs.breakCard.classList.remove("hidden");
  refs.breakCard.classList.remove("show");
  void refs.breakCard.offsetWidth;
  refs.breakCard.classList.add("show");
}

/** Takes the quarter card back down. Called when the next period starts rather
 * than on a timer of its own, so the card is never up over live play and never
 * needs cancelling when a viewer leaves. */
export function hideQuarterBreak(refs) {
  if (!refs || !refs.breakCard) return;
  refs.breakCard.classList.remove("show");
  refs.breakCard.classList.add("hidden");
}

/**
 * The finished game's shot chart, from THE SAME PLACEMENT as the live one -
 * both call toSvg on the same ledger coordinates, so a shot the viewer watched
 * drop in the third quarter is in exactly that spot here. A chart that re-rolled
 * its positions would be a different game's wearing this game's score.
 *
 * `side` filters: "a", "b", or null for both. A per-player filter is a change
 * to this predicate and nothing else - every marker carries its player.
 */
export function renderShotChart(container, events, { labelA, labelB, side = null } = {}) {
  container.innerHTML = courtMarkup();
  const markers = container.querySelector(".bc-markers");
  const shots = (events || []).filter(
    (e) => e.type === "shot" && typeof e.x === "number" && (!side || e.side === side)
  );

  for (const event of shots) {
    const at = toSvg(event);
    const marker = document.createElementNS("http://www.w3.org/2000/svg", event.made ? "circle" : "path");
    if (event.made) {
      marker.setAttribute("cx", at.x.toFixed(2));
      marker.setAttribute("cy", at.y.toFixed(2));
      marker.setAttribute("r", "2");
    } else {
      const s = 1.8;
      marker.setAttribute(
        "d",
        `M ${(at.x - s).toFixed(2)} ${(at.y - s).toFixed(2)} L ${(at.x + s).toFixed(2)} ${(at.y + s).toFixed(2)} ` +
          `M ${(at.x + s).toFixed(2)} ${(at.y - s).toFixed(2)} L ${(at.x - s).toFixed(2)} ${(at.y + s).toFixed(2)}`
      );
    }
    marker.setAttribute("class", `bc-shot final ${event.made ? "made" : "miss"} side-${event.side}`);
    // The whole line, for anyone hovering or reading with a screen reader. The
    // chart is a picture of the ledger; this is the ledger saying it in words.
    const said = describeEvent(event);
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent =
      `${event.player} — ${said.detail} — ${event.made ? "made" : "missed"} ` +
      `(${event.side === "a" ? labelA : labelB}, ${periodLabel(event)})`;
    marker.appendChild(title);
    markers.appendChild(marker);
  }

  return {
    shots: shots.length,
    made: shots.filter((s) => s.made).length,
  };
}
