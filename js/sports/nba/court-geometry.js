// The court itself: one half-court's geometry, the mirror that makes it a full
// court, and the one function that puts a shot on it.
//
// WHY THIS IS ITS OWN MODULE. court.js draws and animates; this decides where
// things are. Separating them means the geometry can be measured by a plain
// Node test (scripts/verify-nba-court-geometry.mjs) with no browser at all,
// which is what a malformed three-point line needed and did not have: the old
// arc was drawn with the wrong SVG sweep flag, so it curved around a centre
// 36 units from the basket and bulged toward the baseline instead of away from
// it. Nothing measured the shape, so it shipped looking almost like a court.
//
// THE COURT IS HORIZONTAL AND FULL. 94 feet by 50, two units to the foot, so
// every number below is the real measurement and the viewBox is 188 x 100.
// The left half is drawn once; the right half is THE SAME PATHS mirrored by a
// transform, so the two ends cannot drift apart - there is no second copy to
// keep in step.

/** Two units to the foot. Every constant below is therefore the real one. */
export const FT = 2;

export const VIEW_W = 94 * FT; // 188 - baseline to baseline
export const VIEW_H = 50 * FT; // 100 - sideline to sideline
export const MID_Y = VIEW_H / 2; // the long axis of the floor
export const HALF_X = VIEW_W / 2; // the half-court line

/** One half's furniture, measured from ITS baseline (x = 0) outward. */
export const RIM_X = 5.25 * FT;
export const RIM_R = 0.75 * FT;
export const BACKBOARD_X = 4 * FT;
export const BACKBOARD_HALF = 3 * FT;
export const PAINT_HALF = 8 * FT;
export const PAINT_DEPTH = 19 * FT;
export const FT_CIRCLE_R = 6 * FT;
export const RESTRICTED_R = 4 * FT;
export const ARC_R = 23.75 * FT;
export const CENTER_R = 6 * FT;

/** The corner three is a STRAIGHT line 3 feet in from the sideline - 22 feet
 * from the middle of the floor - and the arc is 23.75 feet from the rim. Where
 * they meet is solved, never typed: if a measurement above is ever corrected,
 * the corner and the arc still join at a point rather than crossing. */
export const CORNER_HALF = MID_Y - 3 * FT; // 44 units = 22 feet off centre
export const ARC_MEET_X = RIM_X + Math.sqrt(ARC_R * ARC_R - CORNER_HALF * CORNER_HALF);

/** The two rims, in court coordinates. Side "a" attacks the LEFT basket for
 * the whole game and side "b" the right - fixed, never per possession, so a
 * viewer learns the court once. */
export const RIM = {
  a: { x: RIM_X, y: MID_Y },
  b: { x: VIEW_W - RIM_X, y: MID_Y },
};

/** Ledger space to court space.
 *
 * The ledger is half-court and basket-relative: x runs 0..1 ACROSS a 50-foot
 * floor and y runs 0..0.94 OUT from the baseline the shooter is attacking, both
 * scaled by the same 50 feet (see ZONE_ANCHORS in playback.js). So one ledger
 * unit is 100 court units on either axis, and the only work here is deciding
 * which way is "out" - which is what makes this a full court rather than two
 * teams stacked on one end.
 *
 * Side "a" shoots left to right into the left basket, so its distance from the
 * baseline is measured rightward from x = 0. Side "b" is the same point mirrored
 * about the half-court line. Nothing else differs between the halves: the same
 * corner three is the same shot at both ends.
 */
export function shotToCourt(event) {
  const across = event.x * 100; // 0 (one sideline) .. 100 (the other)
  const out = event.y * 100; // distance from the attacking baseline
  return {
    x: event.side === "b" ? VIEW_W - out : out,
    y: across,
  };
}

/** Which half a point is on. Used by the tests, and by nothing else - the
 * renderer knows the side from the event, not from the pixel. */
export function halfOf(point) {
  return point.x < HALF_X ? "a" : "b";
}

/** One half-court, drawn from ITS OWN baseline. Emitted once into <defs> and
 * used twice; see courtMarkup. */
function halfCourtMarkup() {
  return `
      <rect class="bc-line bc-paint" x="0" y="${MID_Y - PAINT_HALF}"
            width="${PAINT_DEPTH}" height="${PAINT_HALF * 2}" />
      <circle class="bc-line bc-ftcircle" cx="${PAINT_DEPTH}" cy="${MID_Y}" r="${FT_CIRCLE_R}" />
      <path class="bc-line bc-restricted"
            d="M ${RIM_X} ${MID_Y - RESTRICTED_R}
               A ${RESTRICTED_R} ${RESTRICTED_R} 0 0 1 ${RIM_X} ${MID_Y + RESTRICTED_R}" />
      <path class="bc-line bc-arc"
            d="M 0 ${MID_Y - CORNER_HALF}
               L ${ARC_MEET_X.toFixed(3)} ${MID_Y - CORNER_HALF}
               A ${ARC_R} ${ARC_R} 0 0 1 ${ARC_MEET_X.toFixed(3)} ${MID_Y + CORNER_HALF}
               L 0 ${MID_Y + CORNER_HALF}" />
      <line class="bc-line bc-backboard" x1="${BACKBOARD_X}" y1="${MID_Y - BACKBOARD_HALF}"
            x2="${BACKBOARD_X}" y2="${MID_Y + BACKBOARD_HALF}" />
      <circle class="bc-rim" cx="${RIM_X}" cy="${MID_Y}" r="${RIM_R}" />`;
}

/** Every court on the page needs its own <defs> id, or the second one's <use>
 * would reach back into the first one's definition - the live court and the
 * post-game chart are on the same page at the same time. */
let courtSerial = 0;

/**
 * The whole floor: boundary, both halves, and the two empty layers playback
 * appends to.
 *
 * The mirror is a transform on a <use>, not a second set of paths. That is the
 * whole reason the two ends cannot disagree, and it is why "fix the arc" was a
 * one-line change in halfCourtMarkup rather than two.
 */
/** @param label the SVG's accessible name. Written straight into an attribute,
 * so a caller passing user-supplied text - team labels are usernames - escapes
 * it first. */
export function courtMarkup({ label = "Basketball full court" } = {}) {
  const halfId = `bc-half-${++courtSerial}`;
  return `
    <svg class="bc-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid meet"
         role="img" aria-label="${label}">
      <defs><g id="${halfId}">${halfCourtMarkup()}</g></defs>
      <rect class="bc-floor" x="0" y="0" width="${VIEW_W}" height="${VIEW_H}" rx="2" />
      <use href="#${halfId}" />
      <use href="#${halfId}" transform="translate(${VIEW_W} 0) scale(-1 1)" />
      <line class="bc-line bc-midline" x1="${HALF_X}" y1="0" x2="${HALF_X}" y2="${VIEW_H}" />
      <circle class="bc-line bc-center" cx="${HALF_X}" cy="${MID_Y}" r="${CENTER_R}" />
      <g class="bc-markers"></g>
      <g class="bc-flash"></g>
    </svg>`;
}
