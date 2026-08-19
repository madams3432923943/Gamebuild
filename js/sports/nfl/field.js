// Football's stage: the field, and the captions that play across it.
//
// WHY THIS IS NOT IN js/ui.js
//
// It was, next to the rules that drew basketball's court, and the two had
// nothing to do with each other beyond both being "a sport's playing surface".
// A sport's presentation belongs with that sport - the same rule as its engine,
// its constants and its gamestyles - so shared code never has to know football
// exists. js/main.js reaches this through the registry
// (presentation.renderField / presentation.showEvent), not by importing it.
//
// The court is gone entirely; basketball's stage is the scoreboard. That left
// this as the only field art in the app, which made the shared home even harder
// to justify.

import { escapeHtml } from "../../lib/escape-html.js";

/**
 * Draws the football field the game is watched on.
 *
 * Everything here is field FURNITURE - the parts that do not move. What moves
 * (ball, line of scrimmage, first-down marker, the drive trail) is returned as
 * refs and positioned by showEvent() per event, so playback never
 * rebuilds the DOM mid-game.
 *
 * The field is drawn left to right as 0..100 from A's own goal line. B drives
 * the other way, so B's yard numbers are mirrored at render time rather than
 * stored mirrored - the engine reports every drive from the DRIVING team's own
 * goal line, and rewriting that would make the box score and the field
 * disagree about where a drive started.
 */
export function renderField(container, labelA, labelB) {
  container.innerHTML = "";
  container.classList.remove("hidden");

  const status = document.createElement("div");
  status.className = "ff-status";
  // Down & distance and possession only. The quarter, the clock and the score
  // used to sit here too, and all three were already on the scoreboard six
  // inches above - the strip was reprinting the board and burying the clock,
  // the one number that changes every play, at the far left of a row nobody
  // was reading. The clock now lives in the board's centre cell, where a real
  // broadcast puts it; see liveStatusLabel() below. What is left here is what
  // the board genuinely cannot show.
  status.innerHTML =
    `<span class="ff-downdist"></span>` +
    // Whose ball it is, said in a chip rather than only in prose. The colour
    // and the side it sits on carry it for anyone not reading the words.
    `<span class="ff-possession"></span>`;

  const field = document.createElement("div");
  field.className = "ff-field";

  const left = document.createElement("div");
  left.className = "ff-endzone left";
  left.innerHTML = `<span>${escapeHtml(labelA)}</span>`;
  const right = document.createElement("div");
  right.className = "ff-endzone right";
  right.innerHTML = `<span>${escapeHtml(labelB)}</span>`;

  const turf = document.createElement("div");
  turf.className = "ff-turf";

  // A line every five yards, numbered every ten, counting in from both goal
  // lines the way a real field does - 10,20,30,40,50,40,30,20,10.
  for (let yard = 5; yard < 100; yard += 5) {
    const line = document.createElement("span");
    line.className = "ff-yardline" + (yard % 10 === 0 ? " major" : "") + (yard === 50 ? " midfield" : "");
    line.style.left = `${yard}%`;
    turf.appendChild(line);
    if (yard % 10 === 0) {
      const num = document.createElement("span");
      num.className = "ff-yardnum";
      num.style.left = `${yard}%`;
      num.textContent = String(yard <= 50 ? yard : 100 - yard);
      turf.appendChild(num);
    }
  }

  const trail = document.createElement("div");
  trail.className = "ff-drive";
  const firstDown = document.createElement("div");
  firstDown.className = "ff-firstdown";
  const scrimmage = document.createElement("div");
  scrimmage.className = "ff-scrimmage";
  const ball = document.createElement("div");
  ball.className = "ff-ball";
  ball.style.left = "50%";
  const arrow = document.createElement("div");
  arrow.className = "ff-arrow";

  turf.append(trail, firstDown, scrimmage, ball, arrow);
  field.append(left, turf, right);

  const call = document.createElement("div");
  call.className = "ff-call";

  container.append(status, field, call);
  return {
    container, turf, trail, ball, call, scrimmage, firstDown, arrow,
    downDist: status.querySelector(".ff-downdist"),
    possession: status.querySelector(".ff-possession"),
    labelA, labelB,
  };
}

/**
 * What the scoreboard's centre cell should read during football playback -
 * "Q3 · 12:29", or "OT1 · 4:02" past regulation.
 *
 * FOOTBALL ANSWERS THIS, SHARED CODE ASKS IT. js/ui.js renders one scoreboard
 * for every sport, so it cannot know that football has a play clock and
 * basketball does not. It calls activeSport().presentation.liveStatusLabel and
 * uses whatever comes back; a sport that returns null keeps the plain
 * "Q3 in progress" the board has always shown. A football branch inside ui.js
 * would be the same mistake that once dealt PG/SG/SF/PF/C in an NFL draft.
 *
 * Returns null rather than a partial label when the event carries no clock -
 * half a status line is worse than the static one it replaced.
 */
export function liveStatusLabel(event) {
  if (!event || !event.clock) return null;
  const period = event.quarter > 4 ? `OT${event.quarter - 4}` : `Q${event.quarter || 1}`;
  return `${period} · ${event.clock}`;
}

/** Ordinal for the down. "1st and 10" - never "1th". */
function ordinalDown(down) {
  return ["", "1st", "2nd", "3rd", "4th"][down] || `${down}th`;
}

/**
 * Renders one timeline event onto the field.
 *
 * A pure function of the event: every event carries the whole field state, so
 * this never has to remember what came before. That is what stops the ball and
 * the chains drifting apart if playback is resumed or a frame is missed.
 */
export function showEvent(refs, event) {
  if (!refs || !event) return;

  // WHOSE BALL IT IS, WITHOUT READING ANYTHING.
  //
  // The viewer is always side A, so possession is also the answer to "am I
  // attacking or defending right now" - which is the single most important
  // thing to know while watching and was previously only inferable from the
  // wording of the play description. The state goes on the container so the
  // field, the endzones and the status bar can all respond to one class
  // rather than each being told separately.
  if (refs.container) {
    const hasBall = event.possession === "A" || event.possession === "B";
    refs.container.classList.toggle("ff-user-offense", event.possession === "A");
    refs.container.classList.toggle("ff-user-defense", event.possession === "B");
    refs.container.classList.toggle("ff-no-possession", !hasBall);
  }
  if (refs.possession) {
    refs.possession.textContent = event.possession === "A"
      ? `▶ ${refs.labelA} ball`
      : event.possession === "B"
        ? `${refs.labelB} ball ◀`
        : "";
  }
  // A drives left to right, B right to left. Both are reported from their own
  // goal line, so B's are mirrored to place them on one shared field.
  const toPct = (yard) => (event.possession === "B" ? 100 - yard : yard);
  const onField = (v) => Math.max(0, Math.min(100, v));

  if (event.yard != null && event.possession) {
    const at = onField(toPct(event.yard));
    refs.ball.style.left = `${at}%`;
    refs.scrimmage.style.left = `${at}%`;
    refs.scrimmage.classList.remove("hidden");

    // The chains. Clamped to the goal line: a first-down marker cannot stand
    // in the end zone, and a drive inside the ten is playing for the score
    // rather than for the sticks.
    if (event.distance != null && event.down != null) {
      const dir = event.possession === "B" ? -1 : 1;
      const marker = onField(at + dir * event.distance);
      refs.firstDown.style.left = `${marker}%`;
      refs.firstDown.classList.toggle("hidden", marker <= 0 || marker >= 100);
    } else {
      refs.firstDown.classList.add("hidden");
    }

    if (event.fromYard != null) {
      const from = onField(toPct(event.fromYard));
      refs.trail.className = `ff-drive ${String(event.possession).toLowerCase()}`;
      refs.trail.style.left = `${Math.min(from, at)}%`;
      refs.trail.style.width = `${Math.abs(at - from)}%`;
    }

    refs.arrow.classList.remove("hidden");
    refs.arrow.classList.toggle("right", event.possession === "A");
    refs.arrow.classList.toggle("left", event.possession === "B");
    refs.arrow.style.left = `${at}%`;
  } else {
    // Between possessions there is no line of scrimmage to draw, and drawing
    // the last one would claim the ball is somewhere it is not.
    refs.scrimmage.classList.add("hidden");
    refs.firstDown.classList.add("hidden");
    refs.arrow.classList.add("hidden");
  }

  refs.downDist.textContent =
    event.down && event.distance
      ? `${ordinalDown(event.down)} & ${event.distance}${event.possession ? ` · ${event.possession === "A" ? refs.labelA : refs.labelB}` : ""}`
      : "";

  const scored = (event.scoring || 0) > 0;
  refs.call.className =
    "ff-call" + (scored ? " score" : event.turnover ? " takeaway" : event.firstDown ? " first" : "");
  refs.call.textContent = event.text || "";
}
