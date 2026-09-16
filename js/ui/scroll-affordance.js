// Telling a reader that a panel scrolls sideways.
//
// A box score is wider than a phone by design: it scrolls inside its own frame
// while the slot and player columns stay frozen. That works, and nothing on
// screen said it was possible. iOS, Android and macOS all paint OVERLAY
// scrollbars - drawn only once a scroll is already underway, then faded - so a
// table that happens to end near the right edge reads as a table that ends
// there. The football box score is 583px wide in a 390px frame, so five of its
// columns live past the edge with nothing on screen suggesting they exist.
//
// Two signals, because each covers the other's failure:
//
//   - A PERMANENT bar under each table. It is the affordance every reader
//     already knows, and the only one that can show HOW MUCH is off-screen.
//     Where the browser's own scrollbar takes layout space it IS that bar,
//     styled in CSS (.scroll-x in style.css) and draggable as usual. Where the
//     browser insists on an overlay scrollbar - every phone, and macOS unless
//     a mouse is plugged in - a rail is drawn instead; see needsRail() below.
//   - A hint pill above the panel, with an arrow pointing the way. It is what
//     gets noticed - but it is a sentence, so it can only say "there is more",
//     never "this much more".
//
// Both are conditional on the panel ACTUALLY overflowing. A hint promising
// more stats beside a table with nothing to its right is worse than no hint:
// the next one is not believed either.
//
// WHY A GROUP AND NOT ONE BIG SCROLLER. The obvious shape - one frame around
// every table - puts a single scrollbar at the bottom of an element three
// screens tall, which is to say nowhere a reader will ever see it. One
// scroller per table puts a bar directly under the table it belongs to, and
// syncing their positions keeps the thing that made one frame attractive:
// the two teams' columns stay lined up with each other, so a box score is
// still read across as well as down.
//
// This lives in its own module rather than beside the box score because it is
// a fact about scroll containers, not about box scores - the play feed and the
// squads table are the same shape. Putting a shared helper next to its first
// caller is exactly what made js/ui.js unsplittable.

/** Live bindings, keyed by the STABLE owner that renders into them. The box
 *  score repaints on an animation frame while a game is live, so the scrollers
 *  themselves are replaced several times a second; a binding keyed on one of
 *  those would accumulate a live ResizeObserver per repaint, and a
 *  ResizeObserver with an active observation is never collected. Keyed on the
 *  owner, each render tears the last one down first. */
const bound = new WeakMap();

/** How far from an edge still counts as being AT it. Fractional scroll
 *  positions are routine - a device pixel ratio of 3, a zoomed page, a
 *  sub-pixel column width - and `scrollLeft + clientWidth === scrollWidth` is
 *  false by half a pixel at the hard right end of most real tables. */
const EDGE_SLACK = 2;

/** Does this panel's own scrollbar take up layout space?
 *
 * MEASURED, not inferred from the user agent. An overlay scrollbar - drawn
 * over the content, invisible until a scroll is underway - occupies no height,
 * so `offsetHeight === clientHeight` on a horizontally scrolling element is an
 * exact test for "the browser is not going to show this reader a bar". Every
 * phone answers yes, macOS answers yes unless a mouse is attached, and Windows
 * answers no; and the answer can change under a running page when a mouse is
 * plugged in, which is why it is asked on every update rather than once.
 *
 * Nothing here overrides the browser's choice. Where a real bar is coming, the
 * drawn rail stays hidden and the reader gets the one they can drag.
 */
function needsRail(panel) {
  return panel.offsetHeight - panel.clientHeight <= 0;
}

/** Draws the rail that stands in for an overlay scrollbar.
 *
 * The rail is an optional `.scroll-rail` element immediately after the panel,
 * holding a `.scroll-rail-thumb`. A caller that does not want one simply does
 * not render it.
 *
 * The thumb is sized and moved in RATIOS of the panel, not in pixels measured
 * from the rail: the rail is exactly as wide as the panel's content box, so
 * `clientWidth / scrollWidth` is already the fraction of the table on screen
 * and `scrollLeft x that fraction` is already the offset in rail pixels. One
 * fewer measurement is one fewer layout read per scroll event.
 */
function paintRail(panel, scrollable) {
  const rail = panel.nextElementSibling;
  if (!rail || !rail.classList.contains("scroll-rail")) return;
  const show = scrollable && needsRail(panel);
  rail.classList.toggle("is-shown", show);
  if (!show) return;
  const thumb = rail.firstElementChild;
  if (!thumb) return;
  const visible = panel.clientWidth / panel.scrollWidth;
  thumb.style.width = `${(visible * 100).toFixed(2)}%`;
  thumb.style.transform = `translateX(${Math.round(panel.scrollLeft * visible)}px)`;
}

/**
 * Binds a set of horizontal scrollers that scroll as one, and marks `owner`
 * while any of them still has content off to the right.
 *
 * @param owner          the element that OWNS the render - stable across
 *                       repaints, and the element `offscreenClass` lands on.
 * @param scrollers      the elements that scroll. May be one or many.
 * @param offscreenClass class toggled on `owner` while there is more to see.
 * @returns the bound scrollers, as an array.
 */
export function bindScrollAffordance(owner, scrollers, offscreenClass = "has-offscreen-columns") {
  const panels = (Array.isArray(scrollers) ? scrollers : [scrollers]).filter(Boolean);
  if (!owner) return panels;
  releaseScrollAffordance(owner);
  if (!panels.length) return panels;

  // Guards the sync below against its own echo: setting scrollLeft fires
  // `scroll` on the element set, which would set it back on the element that
  // started it, which would fire again. One flag for the whole group, cleared
  // on the next frame, is enough - the loop is same-task, not same-frame.
  let syncing = false;

  const readEdges = (panel) => {
    const max = panel.scrollWidth - panel.clientWidth;
    const scrollable = max > EDGE_SLACK;
    panel.classList.toggle("is-scrollable", scrollable);
    // Both edges, not just the right one: a reader who has run to the end
    // needs the arrow to be able to point back.
    panel.classList.toggle("at-start", !scrollable || panel.scrollLeft <= EDGE_SLACK);
    panel.classList.toggle("at-end", !scrollable || panel.scrollLeft >= max - EDGE_SLACK);
    paintRail(panel, scrollable);
    return scrollable && panel.scrollLeft < max - EDGE_SLACK;
  };

  const update = () => {
    // `some`, not `every`: on football the Defense sub-table is narrow enough
    // to fit while Passing is not, and the reader is still missing columns.
    let offscreen = false;
    for (const panel of panels) offscreen = readEdges(panel) || offscreen;
    owner.classList.toggle(offscreenClass, offscreen);
  };

  const onScroll = (event) => {
    if (!syncing) {
      syncing = true;
      const from = event.currentTarget;
      for (const panel of panels) {
        // Clamped per panel, because they are not all the same width - the
        // Defense table runs out of travel before Passing does, and assigning
        // past its end is a silent no-op that leaves the two disagreeing about
        // whether anyone is at the end.
        if (panel !== from) {
          panel.scrollLeft = Math.min(from.scrollLeft, panel.scrollWidth - panel.clientWidth);
        }
      }
      requestAnimationFrame(() => { syncing = false; });
    }
    update();
  };

  // Why an observer and not one measurement: the tables' widths are not known
  // at render time. Fonts load, a container query flips at a width this module
  // never hears about, the phone rotates - and every one of those changes the
  // answer to "is there more to the right", which is the only thing this asks.
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;

  for (const panel of panels) {
    panel.addEventListener("scroll", onScroll, { passive: true });
    if (observer) {
      observer.observe(panel);
      // The CONTENT as well as the frame. A frame that never changes size can
      // still gain a column as a live box score fills in.
      if (panel.firstElementChild) observer.observe(panel.firstElementChild);
    }
  }

  bound.set(owner, () => {
    for (const panel of panels) panel.removeEventListener("scroll", onScroll);
    if (observer) observer.disconnect();
    owner.classList.remove(offscreenClass);
  });

  update();
  return panels;
}

/** Drops the binding for `owner`, if it has one. Safe on an owner that was
 *  never bound, which is what makes it usable as the first line of a rebind. */
export function releaseScrollAffordance(owner) {
  const release = owner && bound.get(owner);
  if (!release) return;
  release();
  bound.delete(owner);
}
