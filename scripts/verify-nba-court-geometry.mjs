#!/usr/bin/env node
// THE SHAPE OF THE COURT, MEASURED RATHER THAN LOOKED AT.
//
// WHY THIS EXISTS. The three-point line was drawn with the wrong SVG sweep
// flag for the whole life of the previous court. An arc command names its
// endpoints and a radius, not a centre, and the two flags choose between four
// curves that all connect those endpoints - so the line joined the corner
// segments at exactly the right two points, and then bowed the wrong way
// around a centre thirty-six units from the basket. It looked almost like a
// court. Nothing measured it: verify-nba-court.mjs drives a browser and checks
// that markers land where their shots say, which a malformed line does not
// affect, and verify-nba-shot-ledger.mjs checks the ledger, which was correct.
//
// So this reads the emitted SVG back, solves each arc's real centre out of its
// endpoints and flags the way a renderer does, and asserts the geometry that
// makes a basketball court a basketball court: an arc that is 23.75 feet from
// the rim at every point along it, corner segments that meet it rather than
// crossing it, and a right half that is the left half exactly mirrored.
//
// It also checks the SHOT MAPPING - which half a side's shots land on, that a
// mirrored pair of identical shots lands mirrored, and that each zone lands in
// the region it is named after. All of it in plain Node: geometry that needs a
// browser to be checked is geometry that gets checked once.

import {
  courtMarkup, shotToCourt, halfOf,
  VIEW_W, VIEW_H, HALF_X, MID_Y, RIM, RIM_X, RIM_R, ARC_R, ARC_MEET_X,
  CORNER_HALF, PAINT_DEPTH, PAINT_HALF, RESTRICTED_R, BACKBOARD_X, BACKBOARD_HALF,
  FT_CIRCLE_R, CENTER_R, FT,
} from "../js/sports/nba/court-geometry.js";
import { simulateGame, computeDatasetStats } from "../js/sports/nba/engine.js";
import NBA from "../js/sports/nba/index.js";
import { loadDataset } from "../data/load.mjs";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const add = (title, ok, detail) => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

const markup = courtMarkup();

// ---------------------------------------------------------------------------
// Reading the emitted SVG back
// ---------------------------------------------------------------------------

/** Every element of a kind, as attribute maps. Enough of a parser for markup
 * this file's own module emitted - a real XML parser would be a dependency for
 * six attributes. */
function elements(name) {
  const out = [];
  const re = new RegExp(`<${name}\\b([^>]*)/?>`, "g");
  let m;
  while ((m = re.exec(markup))) {
    const attrs = {};
    const are = /([\w:-]+)="([^"]*)"/g;
    let a;
    while ((a = are.exec(m[1]))) attrs[a[1]] = a[2];
    out.push(attrs);
  }
  return out;
}

const has = (attrs, cls) => (attrs.class || "").split(/\s+/).includes(cls);

/**
 * An SVG elliptical arc's real centre, solved from the endpoints and the flags
 * exactly as a renderer solves it. THIS is the check the old arc failed: it
 * connected the right two points and curved around the wrong centre, and only
 * the centre says which of the four possible curves was drawn.
 */
function arcCentre(x1, y1, x2, y2, r, largeArc, sweep) {
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const denom = r * r * dy * dy + r * r * dx * dx;
  const num = r * r * r * r - denom;
  let coef = Math.sqrt(Math.max(0, num / denom));
  if (largeArc === sweep) coef = -coef;
  return {
    x: coef * dy + (x1 + x2) / 2,
    y: -coef * dx + (y1 + y2) / 2,
  };
}

/** Points along that arc, so the curve itself can be measured rather than its
 * endpoints. */
function arcPoints(x1, y1, x2, y2, r, largeArc, sweep, samples = 33) {
  const c = arcCentre(x1, y1, x2, y2, r, largeArc, sweep);
  const a1 = Math.atan2(y1 - c.y, x1 - c.x);
  const a2 = Math.atan2(y2 - c.y, x2 - c.x);
  let delta = a2 - a1;
  if (sweep === 1 && delta < 0) delta += 2 * Math.PI;
  if (sweep === 0 && delta > 0) delta -= 2 * Math.PI;
  const points = [];
  for (let i = 0; i <= samples; i++) {
    const t = a1 + (delta * i) / samples;
    points.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  }
  return { centre: c, points };
}

/** The three-point path, taken apart into its two straight segments and its
 * arc. The whole point of the shape is that the three pieces are one line. */
function threePointPath() {
  const path = elements("path").find((p) => has(p, "bc-arc"));
  if (!path) return null;
  const d = path.d.replace(/\s+/g, " ").trim();
  const m = d.match(
    /^M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+) A ([\d.]+) ([\d.]+) 0 ([01]) ([01]) ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)$/
  );
  if (!m) return null;
  const n = m.slice(1).map(Number);
  return {
    corner1: { from: { x: n[0], y: n[1] }, to: { x: n[2], y: n[3] } },
    arc: { r: n[4], largeArc: n[6], sweep: n[7], from: { x: n[2], y: n[3] }, to: { x: n[8], y: n[9] } },
    corner2: { from: { x: n[8], y: n[9] }, to: { x: n[10], y: n[11] } },
  };
}

// ---------------------------------------------------------------------------
// The court
// ---------------------------------------------------------------------------

console.log(renderSection("NBA court geometry (no browser)"));

const svg = elements("svg")[0] || {};
add(
  "The court is a full court, horizontal, on a stable viewBox",
  svg.viewBox === `0 0 ${VIEW_W} ${VIEW_H}` && VIEW_W / VIEW_H > 1.8 && VIEW_W === 94 * FT && VIEW_H === 50 * FT,
  `viewBox "${svg.viewBox}" - ${VIEW_W / FT}ft by ${VIEW_H / FT}ft at ${FT} units to the foot`
);
add(
  "It scales by ratio, not by pixels",
  svg.preserveAspectRatio === "xMidYMid meet" && !("width" in svg) && !("height" in svg),
  `preserveAspectRatio "${svg.preserveAspectRatio}", no pixel width or height on the element`
);

const uses = [...markup.matchAll(/<use\b([^>]*)\/>/g)].map((m) => m[1]);
const defs = markup.match(/<defs><g id="([^"]+)">/);
add(
  "One half-court is defined and used twice - the second is a mirror, not a copy",
  !!defs &&
    uses.length === 2 &&
    uses.every((u) => u.includes(`href="#${defs[1]}"`)) &&
    !uses[0].includes("transform") &&
    uses[1].includes(`transform="translate(${VIEW_W} 0) scale(-1 1)"`),
  `<g id="${defs?.[1]}"> used ${uses.length} times, mirrored about x = ${HALF_X}`
);

// Both baskets. One is drawn, one is the mirror of it - so the assertion is
// that the drawn one is where the left rim should be and the transform puts the
// other where the right rim should be.
const rim = elements("circle").find((c) => has(c, "bc-rim"));
add(
  "Both baskets are on the floor, 5.25 feet off their own baseline",
  !!rim &&
    near(Number(rim.cx), RIM_X) &&
    near(Number(rim.cy), MID_Y) &&
    near(Number(rim.r), RIM_R) &&
    near(RIM.a.x, Number(rim.cx)) &&
    near(RIM.b.x, VIEW_W - Number(rim.cx)),
  `rims at x ${RIM.a.x} and ${RIM.b.x} on the halfway line y ${MID_Y}`
);

const backboard = elements("line").find((l) => has(l, "bc-backboard"));
add(
  "Both backboards are square to the baseline, six feet wide",
  !!backboard &&
    near(Number(backboard.x1), BACKBOARD_X) &&
    near(Number(backboard.x2), BACKBOARD_X) &&
    near(Number(backboard.y2) - Number(backboard.y1), BACKBOARD_HALF * 2) &&
    Number(backboard.x1) < RIM_X,
  `at x ${BACKBOARD_X}, ${(BACKBOARD_HALF * 2) / FT} feet across, behind the rim`
);

const paint = elements("rect").find((r) => has(r, "bc-paint"));
const ftCircle = elements("circle").find((c) => has(c, "bc-ftcircle"));
add(
  "Both keys are 16 by 19 feet, with the free-throw circle on the line",
  !!paint &&
    near(Number(paint.width), PAINT_DEPTH) &&
    near(Number(paint.height), PAINT_HALF * 2) &&
    near(Number(paint.y), MID_Y - PAINT_HALF) &&
    !!ftCircle &&
    near(Number(ftCircle.cx), PAINT_DEPTH) &&
    near(Number(ftCircle.r), FT_CIRCLE_R),
  `key ${PAINT_DEPTH / FT}ft deep by ${(PAINT_HALF * 2) / FT}ft, circle r ${FT_CIRCLE_R / FT}ft at the line`
);

const midline = elements("line").find((l) => has(l, "bc-midline"));
const centre = elements("circle").find((c) => has(c, "bc-center"));
add(
  "There is a half-court line and a centre circle, and they are in the middle",
  !!midline &&
    near(Number(midline.x1), HALF_X) &&
    near(Number(midline.x2), HALF_X) &&
    Number(midline.y1) === 0 &&
    near(Number(midline.y2), VIEW_H) &&
    !!centre &&
    near(Number(centre.cx), HALF_X) &&
    near(Number(centre.cy), MID_Y) &&
    near(Number(centre.r), CENTER_R),
  `line at x ${HALF_X}, circle r ${CENTER_R / FT}ft`
);

// ---- THE THREE-POINT LINE -------------------------------------------------
const three = threePointPath();
add(
  "The three-point line is one path: corner, arc, corner",
  !!three,
  three ? "straight segment into an arc into a straight segment" : "the path did not parse as corner-arc-corner"
);

if (three) {
  const sampled = arcPoints(
    three.arc.from.x, three.arc.from.y, three.arc.to.x, three.arc.to.y,
    three.arc.r, three.arc.largeArc, three.arc.sweep
  );
  const radii = sampled.points.map((p) => Math.hypot(p.x - RIM.a.x, p.y - RIM.a.y));
  const worst = Math.max(...radii.map((r) => Math.abs(r - ARC_R)));
  add(
    "The arc is 23.75 feet from the basket at every point along it",
    near(sampled.centre.x, RIM.a.x, 0.01) && near(sampled.centre.y, RIM.a.y, 0.01) && worst < 0.01,
    `solved centre (${sampled.centre.x.toFixed(2)}, ${sampled.centre.y.toFixed(2)}) against the rim ` +
      `(${RIM.a.x}, ${RIM.a.y}); worst radius error ${(worst / FT).toFixed(4)} feet`
  );
  add(
    "The arc bows away from the baseline, not toward it",
    sampled.points.every((p) => p.x >= three.arc.from.x - 0.01) &&
      Math.max(...sampled.points.map((p) => p.x)) > ARC_MEET_X + ARC_R / 2,
    `apex ${(Math.max(...sampled.points.map((p) => p.x)) / FT).toFixed(1)} feet from the baseline, ` +
      `corners at ${(ARC_MEET_X / FT).toFixed(1)} feet - the sweep flag that drew this backwards is the bug this checks`
  );
  add(
    "The corner threes are straight, 22 feet off centre, and run off the baseline",
    near(three.corner1.from.x, 0) &&
      near(three.corner2.to.x, 0) &&
      near(three.corner1.from.y, MID_Y - CORNER_HALF) &&
      near(three.corner1.to.y, MID_Y - CORNER_HALF) &&
      near(three.corner2.from.y, MID_Y + CORNER_HALF) &&
      near(three.corner2.to.y, MID_Y + CORNER_HALF) &&
      near(CORNER_HALF / FT, 22),
    `corner lines at y ${MID_Y - CORNER_HALF} and ${MID_Y + CORNER_HALF}, ${CORNER_HALF / FT} feet off centre`
  );
  add(
    "The corner lines meet the arc rather than crossing it",
    near(three.corner1.to.x, three.arc.from.x) &&
      near(three.corner2.from.x, three.arc.to.x) &&
      near(Math.hypot(three.arc.from.x - RIM.a.x, three.arc.from.y - RIM.a.y), ARC_R, 0.01) &&
      near(Math.hypot(three.arc.to.x - RIM.a.x, three.arc.to.y - RIM.a.y), ARC_R, 0.01),
    `they join at x ${ARC_MEET_X.toFixed(2)}, which is exactly ${ARC_R / FT} feet from the rim - solved, not typed in`
  );
  add(
    "The line is symmetric about the middle of the floor",
    near(MID_Y - three.corner1.from.y, three.corner2.from.y - MID_Y) &&
      near(three.arc.from.x, three.arc.to.x),
    "both corners are the same distance off centre and meet the arc at the same depth"
  );
}

// ---- the restricted area --------------------------------------------------
const restricted = elements("path").find((p) => has(p, "bc-restricted"));
if (restricted) {
  const m = restricted.d.replace(/\s+/g, " ").trim().match(
    /^M ([\d.]+) ([\d.]+) A ([\d.]+) [\d.]+ 0 ([01]) ([01]) ([\d.]+) ([\d.]+)$/
  );
  const n = m ? m.slice(1).map(Number) : null;
  const arc = n ? arcPoints(n[0], n[1], n[5], n[6], n[2], n[3], n[4]) : null;
  add(
    "The restricted area is a four-foot arc under the rim, bowing out from the baseline",
    !!arc &&
      near(arc.centre.x, RIM.a.x, 0.01) &&
      near(arc.centre.y, RIM.a.y, 0.01) &&
      near(n[2], RESTRICTED_R) &&
      Math.max(...arc.points.map((p) => p.x)) > RIM.a.x + RESTRICTED_R - 0.01,
    arc
      ? `centre (${arc.centre.x.toFixed(2)}, ${arc.centre.y.toFixed(2)}), radius ${(n[2] / FT).toFixed(2)} feet`
      : "the restricted arc did not parse"
  );
} else {
  add("The restricted area is a four-foot arc under the rim", false, "no restricted arc was drawn");
}

// ---------------------------------------------------------------------------
// The shot mapping
// ---------------------------------------------------------------------------

// One ledger coordinate, placed for each side. The SAME shot, so the only thing
// that can differ is the end of the floor it lands on.
const sample = { x: 0.5, y: 0.4 };
const asA = shotToCourt({ ...sample, side: "a" });
const asB = shotToCourt({ ...sample, side: "b" });
add(
  "A shot lands on its own team's half, and the same shot mirrors onto the other",
  halfOf(asA) === "a" &&
    halfOf(asB) === "b" &&
    near(asA.x + asB.x, VIEW_W) &&
    near(asA.y, asB.y),
  `(${sample.x}, ${sample.y}) becomes (${asA.x}, ${asA.y}) for you and (${asB.x}, ${asB.y}) for the opponent`
);

const corners = [
  { x: 0.97, y: 0.08, name: "your right corner" },
  { x: 0.03, y: 0.08, name: "your left corner" },
];
add(
  "A corner three is in a corner - beside the basket being attacked, not the other one",
  corners.every((c) => {
    const a = shotToCourt({ ...c, side: "a" });
    const b = shotToCourt({ ...c, side: "b" });
    return (
      Math.abs(a.y - MID_Y) > CORNER_HALF &&
      Math.abs(b.y - MID_Y) > CORNER_HALF &&
      Math.hypot(a.x - RIM.a.x, a.y - RIM.a.y) < HALF_X &&
      Math.hypot(b.x - RIM.b.x, b.y - RIM.b.y) < HALF_X
    );
  }),
  "both corners map beside the rim they were shot at, on both halves"
);

// ---- zones land in the regions they are named after ------------------------
//
// Measured on a real ledger from a real simulation rather than on made-up
// coordinates: the placement is seeded, and what has to hold is that every
// shot a GAME produces is in the right region, not that one hand-picked one is.
const PLAYERS = await loadDataset("nba-players");
const datasetStats = computeDatasetStats(PLAYERS);
let seed = 424242;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const roster = () => Object.fromEntries(NBA.slots.ranked.map((s) => [s, PLAYERS[Math.floor(rand() * PLAYERS.length)]]));

const placed = [];
for (let g = 0; g < 12; g++) {
  const a = roster();
  const b = roster();
  const result = simulateGame(a, b, datasetStats);
  // Straight off the result: the ledger is produced by the simulation now, not
  // rebuilt by whoever is drawing it. See js/sports/nba/ledger.js.
  for (const e of result.shotEvents) if (e.type === "shot" && typeof e.x === "number") placed.push(e);
}

/** Everything the court can say about where a marker ended up. */
function describePlacement(event) {
  const at = shotToCourt(event);
  const own = RIM[event.side];
  return {
    at,
    half: halfOf(at),
    fromRim: Math.hypot(at.x - own.x, at.y - own.y),
    fromBaseline: event.side === "b" ? VIEW_W - at.x : at.x,
    offCentre: Math.abs(at.y - MID_Y),
  };
}

const regionFaults = [];
const region = {
  // A rim finish - the loudest thing the ledger can honestly call a shot - is
  // inside the restricted arc's four feet.
  rim: (p) => p.fromRim <= RESTRICTED_R + 0.5,
  // A paint shot is in the key: inside its 16-foot width and its 19-foot depth.
  paint: (p) => p.offCentre <= PAINT_HALF && p.fromBaseline <= PAINT_DEPTH,
  // Mid-range is outside the restricted area and inside the arc, and never out
  // in a corner where a shot that distance would be a three.
  "short-mid": (p) => p.fromRim > RESTRICTED_R && p.fromRim < ARC_R && p.offCentre < CORNER_HALF,
  "long-mid": (p) => p.fromRim > RESTRICTED_R && p.fromRim < ARC_R && p.offCentre < CORNER_HALF,
  // The corner three is the one three that is INSIDE 23.75 feet, so it is
  // checked on the line it actually has to clear: 22 feet off centre, short of
  // where the corner line meets the arc.
  "corner-three": (p) => p.offCentre > CORNER_HALF && p.fromBaseline < ARC_MEET_X,
  "wing-three": (p) => p.fromRim > ARC_R,
  "above-break-three": (p) => p.fromRim > ARC_R,
};
for (const event of placed) {
  const p = describePlacement(event);
  if (p.half !== event.side) {
    regionFaults.push(`${event.side} shot landed on half ${p.half}`);
    continue;
  }
  if (p.at.x < 0 || p.at.x > VIEW_W || p.at.y < 0 || p.at.y > VIEW_H) {
    regionFaults.push(`${event.zone} landed off the floor at (${p.at.x.toFixed(1)}, ${p.at.y.toFixed(1)})`);
    continue;
  }
  const test = region[event.zone];
  if (test && !test(p)) {
    regionFaults.push(
      `${event.zone} at ${(p.fromRim / FT).toFixed(1)}ft from the rim, ` +
        `${(p.offCentre / FT).toFixed(1)}ft off centre, ${(p.fromBaseline / FT).toFixed(1)}ft out`
    );
  }
}
add(
  "Every shot of twelve games lands on its own half, on the floor, in its own region",
  placed.length > 1000 && regionFaults.length === 0,
  regionFaults.length
    ? `${regionFaults.length} of ${placed.length}: ${regionFaults.slice(0, 3).join(" | ")}`
    : `${placed.length} shots: rim finishes under 4 feet, mid-range inside the arc, ` +
      `corner threes behind the corner line, everything else outside the arc`
);

// The two halves have to be USED, or a full court is a half court with an empty
// end - which is the presentation this replaced.
const bySide = { a: placed.filter((e) => e.side === "a").length, b: placed.length - placed.filter((e) => e.side === "a").length };
add(
  "Both halves are shot at",
  bySide.a > 100 && bySide.b > 100,
  `${bySide.a} shots on your end, ${bySide.b} on the opponent's`
);

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
