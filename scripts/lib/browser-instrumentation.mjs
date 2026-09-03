// Page-side instrumentation, injected before any app code runs.
//
// Everything here is a string evaluated in the browser, not module code that
// Node runs - it is kept separate so the harness itself stays readable and so
// the measurement logic can be reasoned about as one unit.

/**
 * Frame sampler. Runs a rAF loop for the life of the page recording the gap
 * between frames, which is what "janking" actually means to a player: the
 * scoreboard freezing for 200ms is visible, an average frame time of 17ms is
 * not. Averages hide exactly the thing worth catching, so this keeps the
 * distribution (worst frame, and how many frames blew the budget) rather than
 * a mean.
 *
 * Sampling is windowed: the harness marks a window before an animation and
 * reads it afterwards, so idle time waiting on the network isn't counted as
 * smooth rendering and doesn't dilute the result.
 */
export const FRAME_SAMPLER = `
(() => {
  const state = { frames: [], windows: {}, current: null, last: performance.now() };
  window.__bkPerf = state;

  function tick(now) {
    const delta = now - state.last;
    state.last = now;
    if (state.current) state.current.frames.push(delta);
    state.frames.push(delta);
    if (state.frames.length > 20000) state.frames.shift();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.__bkPerfStart = (name) => {
    state.current = { name, frames: [], startedAt: performance.now() };
    state.windows[name] = state.current;
    return name;
  };
  window.__bkPerfStop = (name) => {
    const w = state.windows[name];
    if (!w) return null;
    w.endedAt = performance.now();
    if (state.current === w) state.current = null;
    return window.__bkPerfSummary(name);
  };
  window.__bkPerfSummary = (name) => {
    const w = state.windows[name];
    if (!w) return null;
    // The very first frame of a window straddles whatever happened before it
    // (a navigation, a click handler), so it measures the boundary rather
    // than the animation - dropping it stops one unrelated stall from being
    // reported as the animation's worst frame.
    const frames = w.frames.slice(1);
    if (!frames.length) return { name, frameCount: 0 };
    const sorted = [...frames].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    return {
      name,
      frameCount: frames.length,
      durationMs: (w.endedAt || performance.now()) - w.startedAt,
      meanMs: frames.reduce((s, v) => s + v, 0) / frames.length,
      p50Ms: at(0.5),
      p95Ms: at(0.95),
      worstMs: sorted[sorted.length - 1],
      // A frame over 50ms is a visible hitch; over 100ms reads as a freeze.
      janky50: frames.filter((f) => f > 50).length,
      janky100: frames.filter((f) => f > 100).length,
    };
  };
})();
`;

/** Paint timings straight from the Performance API - real measurements of
 * when the browser actually painted, not a proxy like "load fired". */
export const PAINT_METRICS = `
(() => {
  const paints = {};
  for (const e of performance.getEntriesByType('paint')) paints[e.name] = e.startTime;
  const nav = performance.getEntriesByType('navigation')[0];
  let lcp = null;
  try {
    const entries = performance.getEntriesByType('largest-contentful-paint');
    if (entries.length) lcp = entries[entries.length - 1].startTime;
  } catch (e) {}
  return {
    firstPaint: paints['first-paint'] ?? null,
    firstContentfulPaint: paints['first-contentful-paint'] ?? null,
    largestContentfulPaint: lcp,
    domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
    loadComplete: nav ? nav.loadEventEnd : null,
  };
})();
`;

/**
 * Layout-break detector.
 *
 * Overlap on its own is not a bug - the whole visual design leans on stacked,
 * transformed and absolutely positioned elements, and flagging those would
 * bury a real break under hundreds of intended ones. So this only reports
 * overlap between elements that are BOTH in normal flow and siblings of each
 * other, which is the case that genuinely cannot happen unless layout has
 * broken (two flow siblings cannot legally occupy the same box).
 *
 * Reported separately, because it is the more common real-world symptom:
 * horizontal overflow of the document, and any visible element whose box
 * escapes the viewport's right edge.
 */
export const LAYOUT_AUDIT = `
(() => {
  const vw = document.documentElement.clientWidth;
  const isFlow = (el) => {
    const cs = getComputedStyle(el);
    if (cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'sticky') return false;
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    if (cs.transform && cs.transform !== 'none') return false;
    return true;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  const overlaps = [];
  const seen = new Set();
  const containers = document.querySelectorAll('.screen:not(.hidden), .screen:not(.hidden) *');
  for (const parent of containers) {
    const kids = [...parent.children].filter((el) => isFlow(el) && visible(el));
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect();
        const b = kids[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2) {
          // Tolerate a hairline: sub-pixel rounding on adjacent boxes is not
          // a layout break, and a 1-2px sliver would otherwise dominate.
          const area = ox * oy;
          const smaller = Math.min(a.width * a.height, b.width * b.height);
          if (smaller > 0 && area / smaller < 0.02) continue;
          const key = kids[i].className + '|' + kids[j].className;
          if (seen.has(key)) continue;
          seen.add(key);
          overlaps.push({
            a: (kids[i].id ? '#' + kids[i].id : kids[i].tagName.toLowerCase() + '.' + String(kids[i].className).split(' ')[0]),
            b: (kids[j].id ? '#' + kids[j].id : kids[j].tagName.toLowerCase() + '.' + String(kids[j].className).split(' ')[0]),
            overlapPx: Math.round(ox) + 'x' + Math.round(oy),
          });
        }
      }
    }
  }

  // An element wider than the viewport is only a defect if nothing contains
  // it. The design deliberately relies on both kinds of containment - the
  // court arcs are positioned outside .game-stage and clipped by its
  // overflow:hidden, and the box-score table is meant to be wider than a
  // phone and scroll inside #full-box-score's overflow-x:auto. Reporting
  // those flags ~160 elements on a phone, all of them working as designed,
  // which would bury a real break. So an element counts as escaping only if
  // every ancestor up to the document is overflow:visible.
  // Not all containment is equal, and treating it as such is how a real bug
  // slipped through: the How to Play pill and the online counter hung 6px off
  // the left edge of a phone screen and were being clipped, but an ancestor
  // had overflow:hidden so the audit called them "contained" and stayed quiet.
  //
  //   overflow: auto/scroll  -> the content is reachable by scrolling. Fine.
  //   overflow: hidden/clip  -> the content is gone. Only fine if it was
  //                             meant to go, which decoration is and a
  //                             control never is.
  //
  // So a clipped element is still reported when it is interactive or carries
  // text, and ignored when it is a bare decorative shape - which is what the
  // clipped court arcs are, and why they no longer drown out real findings.
  const isMeaningful = (el) =>
    /^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL)$/.test(el.tagName) ||
    (el.textContent || '').trim().length > 0;

  const safelyContained = (el) => {
    const r = el.getBoundingClientRect();
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const scrollable = /^(auto|scroll)$/.test(cs.overflowX) || /^(auto|scroll)$/.test(cs.overflowY);
      const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
      if (!clips) continue;
      if (scrollable) return true;
      // A THIRD kind of containment, between "reachable by scrolling" and
      // "gone": text deliberately truncated with an ellipsis. The ellipsis is
      // the author saying the overflow is intended and signposting it to the
      // reader, which a bare overflow:hidden does not. Football's roster rows
      // rely on it - a wrapped unit name doubles the row height and the column
      // stops scanning as a lineup - so treating it as a break reported three
      // findings per round for a layout working exactly as designed.
      //
      // Deliberately narrow: it takes all three of ellipsis, nowrap and a
      // clipping overflow, which is the whole truncation idiom and not
      // something a broken layout arrives at by accident.
      if (
        cs.textOverflow === 'ellipsis' &&
        /nowrap|pre$/.test(cs.whiteSpace) &&
        /^(hidden|clip)$/.test(cs.overflowX)
      ) return true;
      const pr = p.getBoundingClientRect();
      const escapes = r.left < pr.left - 2 || r.right > pr.right + 2;
      if (escapes && isMeaningful(el)) return false;
      return true;
    }
    return false;
  };
  const contained = safelyContained;

  const escaping = [];
  for (const el of document.querySelectorAll('.screen:not(.hidden) *')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (contained(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 2 || r.left < -2) {
      escaping.push({
        el: el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0],
        left: Math.round(r.left),
        right: Math.round(r.right),
        viewport: vw,
      });
    }
  }

  return {
    overlaps: overlaps.slice(0, 25),
    overlapCount: overlaps.length,
    escaping: escaping.slice(0, 25),
    escapingCount: escaping.length,
    documentOverflowPx: Math.max(0, document.documentElement.scrollWidth - vw),
  };
})();
`;

// ---------------------------------------------------------------------------
// What a layout audit cannot see
//
// LAYOUT_AUDIT above catches things that are BROKEN - boxes on top of each
// other, content off the side of the screen. A control that is merely too
// small to hit and text that is merely too small to read pass every one of
// those checks, and on a phone they are most of what makes a screen bad.
//
// Written once here because two callers need the same numbers to mean the
// same thing: scripts/selftest/run-mobile-baseline.mjs reports them for a
// person to look at, and scripts/verify-browser.mjs asserts against them.
// ---------------------------------------------------------------------------

/** Below this a control is hard to hit with a thumb; both platform guidelines
 * say 44 CSS px. Not a style preference - a miss rate. */
export const TAP_TARGET_MIN = 44;

/** Below this, body copy is not readable at arm's length on a couch. */
export const MIN_FONT_PX = 12;

/**
 * Everything a screen can tell us that a picture cannot, read in one pass.
 *
 * Runs in the page, so it is a string rather than a function - same reason
 * and same shape as LAYOUT_AUDIT above.
 */
export const TOUCH_AUDIT = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
    // Inside a hidden screen: present in the DOM, not on screen.
    return !el.closest(".hidden, [hidden]");
  };

  const describe = (el) => {
    const id = el.id ? "#" + el.id : "";
    const cls = el.className && typeof el.className === "string"
      ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".")
      : "";
    const text = (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 24);
    return (el.tagName.toLowerCase() + id + cls + (text ? ' "' + text + '"' : "")).slice(0, 90);
  };

  const interactive = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])')]
    .filter(visible);

  const small = [];
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    // Half a pixel of tolerance. A control set to exactly 2.75rem measures
    // 43.99 on a 3x device pixel ratio, and reporting that as a miss sends
    // someone to look at a rule that is already correct.
    if (r.width < ${TAP_TARGET_MIN} - 0.5 || r.height < ${TAP_TARGET_MIN} - 0.5) {
      small.push({ el: describe(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }

  // Text nodes, not elements: an element's font-size says nothing if it has no
  // text of its own, and a wrapper inheriting a big size can contain a tiny
  // child.
  const tiny = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = (n.textContent || "").trim();
    // Whitespace-only nodes are skipped; a single CHARACTER is not. The old
    // "length < 2" was meant to drop the former, and quietly exempted an 8px
    // close cross, or a one-digit box-score cell, from the floor entirely.
    if (!s) continue;
    const el = n.parentElement;
    if (!el || !visible(el)) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px && px < ${MIN_FONT_PX}) {
      const key = describe(el);
      if (!tiny.has(key)) tiny.set(key, { el: key, px: Math.round(px * 10) / 10, sample: s.slice(0, 30) });
    }
  }

  return {
    interactiveCount: interactive.length,
    smallTargets: small.slice(0, 12),
    smallTargetCount: small.length,
    tinyText: [...tiny.values()].slice(0, 12),
    tinyTextCount: tiny.size,
    // What the app got to paint into, vs what the window claims. The gap is
    // the browser's own chrome, and it is why a 100vh panel is taller than
    // the screen on a phone.
    innerHeight: window.innerHeight,
    documentHeight: Math.round(document.documentElement.scrollHeight),
    verticalScroll: Math.round(document.documentElement.scrollHeight - window.innerHeight),
  };
})()`;

// ---------------------------------------------------------------------------
// What a screen reader gets
//
// LAYOUT_AUDIT catches boxes on top of each other and TOUCH_AUDIT catches
// controls too small to hit. Both are about eyes and thumbs. This one is about
// the reading a screen reader is handed, which no amount of looking at the
// page will tell you - and which nothing in this repo measured: index.html
// carries 23 aria- attributes across 724 lines, and whether that is enough was
// never a question anything could answer.
//
// FOUR PROPERTIES, chosen because each is objectively checkable and each has a
// failure a sighted test cannot see:
//
//   NAME     A control with no accessible name is announced as "button". The
//            page has plenty of text buttons, which are fine; it is the
//            icon-only ones that go silent, and they are exactly the ones a
//            visual check passes.
//   LABEL    An input with no label is announced as "edit text, blank".
//   ALT      An <img> with no alt attribute has its FILENAME read out. An
//            empty alt is correct for decoration and is not a failure - the
//            missing attribute is.
//   CURRENT  A navigation whose active item is marked only by colour tells a
//            screen reader nothing about where you are.
// ---------------------------------------------------------------------------

export const A11Y_AUDIT = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
    return !el.closest(".hidden, [hidden]");
  };
  const describe = (el) => {
    const id = el.id ? "#" + el.id : "";
    const cls = el.className && typeof el.className === "string"
      ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".")
      : "";
    return (el.tagName.toLowerCase() + id + cls).slice(0, 80);
  };

  /** What a screen reader would announce this control AS, near enough: its own
   *  text, or an aria-label, or the text of whatever aria-labelledby points at,
   *  or a title. Deliberately generous - the check is for controls with NO name
   *  at all, not for badly worded ones, which is a judgement no script makes. */
  const accessibleName = (el) => {
    const aria = (el.getAttribute("aria-label") || "").trim();
    if (aria) return aria;
    const ref = el.getAttribute("aria-labelledby");
    if (ref) {
      const text = ref.split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || "").join(" ").trim();
      if (text) return text;
    }
    const own = (el.textContent || "").replace(/\\s+/g, " ").trim();
    if (own) return own;
    const title = (el.getAttribute("title") || "").trim();
    if (title) return title;
    const alt = [...el.querySelectorAll("img[alt]")].map((i) => i.alt).join(" ").trim();
    return alt;
  };

  const controls = [...document.querySelectorAll('button, a[href], [role="button"]')].filter(visible);
  const unnamed = controls.filter((el) => !accessibleName(el)).map(describe);

  const fields = [...document.querySelectorAll("input, select, textarea")].filter(visible);
  const unlabelled = fields.filter((el) => {
    if (el.type === "hidden") return false;
    if ((el.getAttribute("aria-label") || "").trim()) return false;
    if (el.getAttribute("aria-labelledby")) return false;
    if (el.labels && el.labels.length) return false;
    // A placeholder is NOT a label - it disappears the moment you type, and a
    // screen reader may or may not read it. Counted as unlabelled on purpose.
    return true;
  }).map(describe);

  const images = [...document.querySelectorAll("img")].filter(visible);
  const altless = images.filter((el) => !el.hasAttribute("alt")).map(describe);

  // Where "current" is claimed by a class, it should also be claimed to the
  // accessibility tree. Only asked of navigation, which is where it means
  // something.
  const navActive = [...document.querySelectorAll("nav .active, nav [class*='active']")].filter(visible);
  const uncurrent = navActive
    .filter((el) => !el.hasAttribute("aria-current") && el.getAttribute("aria-selected") !== "true")
    .map(describe);

  return {
    controls: controls.length,
    unnamed: unnamed.slice(0, 10),
    unnamedCount: unnamed.length,
    fields: fields.length,
    unlabelled: unlabelled.slice(0, 10),
    unlabelledCount: unlabelled.length,
    images: images.length,
    altless: altless.slice(0, 10),
    altlessCount: altless.length,
    uncurrent: uncurrent.slice(0, 10),
    uncurrentCount: uncurrent.length,
  };
})();
`;
