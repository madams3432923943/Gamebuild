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
// THE FLOOR IS A FULL COURT, HORIZONTAL, AND EACH TEAM OWNS ONE END. Geometry
// and the ledger-to-court mapping live in ./court-geometry.js so a plain Node
// test can measure them; this file draws, animates and counts. Team identity is
// WHICH HALF a marker is on. Colour says only whether it went in - green disc
// for a make, red cross for a miss - so the two questions never compete for the
// same channel.

import { escapeHtml } from "../../lib/escape-html.js";
import { describeEvent, formatClock } from "./playback.js";
import { courtMarkup, shotToCourt } from "./court-geometry.js";

/** How many periods before overtime. Basketball's own, because a sport with a
 * different number would answer differently and shared code never asks. */
const REGULATION_PERIODS = 4;

/** Marker sizes, in court units - one unit is half a foot, so a made shot is a
 * two-foot disc on a 94-foot floor. They SHRINK as the chart fills: a quiet
 * first quarter and a two-hundred-shot final chart are the same picture at
 * different densities, and one size cannot serve both. The floor of 0.72 is
 * where a marker stops being a marker. */
const MADE_R = 2;
const MISS_ARM = 1.9;
const MIN_SCALE = 0.72;
const DENSITY_SPAN = 220; // attempts over which a marker shrinks to MIN_SCALE

function densityScale(drawn) {
  return Math.max(MIN_SCALE, 1 - (drawn / DENSITY_SPAN) * (1 - MIN_SCALE));
}

/** One shot, as an SVG element. The ONE place a marker is built, so the live
 * court and the post-game chart cannot draw the same shot two ways - they did,
 * and the live one grew a size rule the final one never got. */
function shotMarker(event, { drawn = 0, final = false } = {}) {
  const at = shotToCourt(event);
  const scale = densityScale(drawn);
  const svg = (name) => document.createElementNS("http://www.w3.org/2000/svg", name);
  let marker;
  if (event.made) {
    marker = svg("circle");
    marker.setAttribute("cx", at.x.toFixed(2));
    marker.setAttribute("cy", at.y.toFixed(2));
    marker.setAttribute("r", (MADE_R * scale).toFixed(2));
  } else {
    // A cross, not a hollow circle. Made and missed have to be separable
    // without colour - a chart where the only difference is hue is a chart
    // eight percent of men cannot read.
    marker = svg("path");
    const s = MISS_ARM * scale;
    marker.setAttribute(
      "d",
      `M ${(at.x - s).toFixed(2)} ${(at.y - s).toFixed(2)} L ${(at.x + s).toFixed(2)} ${(at.y + s).toFixed(2)} ` +
        `M ${(at.x + s).toFixed(2)} ${(at.y - s).toFixed(2)} L ${(at.x - s).toFixed(2)} ${(at.y + s).toFixed(2)}`
    );
  }
  marker.setAttribute(
    "class",
    `bc-shot ${event.made ? "made" : "miss"} side-${event.side}` +
      (final ? " final" : "") +
      (event.strong && event.made ? " strong" : "")
  );
  return { marker, at };
}

/** The two half labels, sitting over their own end of the floor. HTML rather
 * than SVG text: a label sized in viewBox units is eight pixels on a phone, and
 * the 12px floor the mobile audit enforces is not negotiable for the one thing
 * on screen that says whose shots these are. */
function halfLabels(labelA, labelB) {
  return (
    `<div class="bc-halflabels" aria-hidden="true">` +
    `<span class="bc-halflabel side-a">${escapeHtml(labelA)}</span>` +
    `<span class="bc-halflabel side-b">${escapeHtml(labelB)}</span>` +
    `</div>`
  );
}

/** One team's cell in the live stat strip. Column order matches the halves -
 * A under the left end, B under the right - so the numbers sit beneath the
 * shots they came from. */
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
 * above the viewport did to a reader on a phone. Nothing here scrolls, focuses
 * or replaces a container once the floor is up; a shot appends one node.
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
  // ESCAPED BEFORE IT REACHES THE ATTRIBUTE. The labels are usernames, and the
  // aria-label is written into markup - the one thing every user-supplied
  // string in this app has to pass through on its way to innerHTML.
  court.innerHTML =
    courtMarkup({ label: `Full court, ${escapeHtml(labelA)} shots left, ${escapeHtml(labelB)} shots right` }) +
    halfLabels(labelA, labelB);

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
    drawn: 0,
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
    const { marker, at } = shotMarker(event, { drawn: refs.drawn });
    refs.drawn += 1;
    // APPENDED, so the newest shot is on top of the ones under it. That is the
    // whole clutter strategy at the rim: the fresh marker is the readable one
    // and the pile beneath it is the chart it is becoming.
    refs.markers.appendChild(marker);
    // THE FADE IS CSS, NOT A TIMER. A setTimeout per shot is two hundred timers
    // a game, every one of which has to be cancelled if the viewer leaves; an
    // animation that ends on the faint accumulated state needs none and cannot
    // outlive the element. See cleanupPlayback in js/main.js for what the
    // timer version costs.
    marker.classList.add("fresh");

    if (event.made) {
      // The expanding ring, on the newest make only. Its own element in the
      // flash layer rather than a second animation on the marker, because the
      // marker has to survive it - the ring is a beat, the disc is the record.
      const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      ring.setAttribute("cx", at.x.toFixed(2));
      ring.setAttribute("cy", at.y.toFixed(2));
      ring.setAttribute("r", "2");
      ring.setAttribute("class", "bc-ring");
      refs.flash.appendChild(ring);
      ring.addEventListener("animationend", () => ring.remove(), { once: true });

      const pop = document.createElementNS("http://www.w3.org/2000/svg", "text");
      pop.setAttribute("x", at.x.toFixed(2));
      // Clamped off the sideline: a marker two units from the edge would put
      // its own "+3" outside the floor.
      pop.setAttribute("y", Math.max(6, at.y - 4).toFixed(2));
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
 * the bug this whole screen was rebuilt around.
 *
 * THE NUMBERS ARE THE SIMULATION'S, folded forward from the ledger by
 * foldLiveStats. Nothing here counts markers: the chart is a picture of the
 * game, not the source of it, and a percentage derived from what happens to be
 * on screen would drift from the box score the moment one differed. */
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
 * The finished game's shot chart - THE SAME COURT and THE SAME PLACEMENT as the
 * live one. Both call shotToCourt on the same ledger coordinates through the
 * same shotMarker, so a shot the viewer watched drop in the third quarter is in
 * exactly that spot here. A chart that re-rolled its positions would be a
 * different game's wearing this game's score.
 *
 * `side` filters: "a", "b", or null for both. Filtering never moves anything -
 * a team's shots are on that team's half whether the other half is drawn or
 * not - so the two views are the same picture with one end blank. A per-player
 * filter is a change to this predicate and nothing else; every marker carries
 * its player.
 */
export function renderShotChart(container, events, { labelA, labelB, side = null } = {}) {
  container.innerHTML =
    courtMarkup({ label: `Shot chart, ${escapeHtml(labelA)} left, ${escapeHtml(labelB)} right` }) +
    halfLabels(labelA, labelB);
  container.classList.toggle("bc-only-a", side === "a");
  container.classList.toggle("bc-only-b", side === "b");
  const markers = container.querySelector(".bc-markers");
  const shots = (events || []).filter(
    (e) => e.type === "shot" && typeof e.x === "number" && (!side || e.side === side)
  );

  shots.forEach((event, index) => {
    const { marker } = shotMarker(event, { drawn: index, final: true });
    // The whole line, for anyone hovering or reading with a screen reader. The
    // chart is a picture of the ledger; this is the ledger saying it in words.
    const said = describeEvent(event);
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent =
      `${event.player} — ${said.detail} — ${event.made ? "made" : "missed"} ` +
      `(${event.side === "a" ? labelA : labelB}, ${periodLabel(event)})`;
    marker.appendChild(title);
    markers.appendChild(marker);
  });

  return {
    shots: shots.length,
    made: shots.filter((s) => s.made).length,
  };
}
