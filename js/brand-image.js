// The brand mark's "missing file degrades to text" behaviour.
//
// This used to be an inline onerror="this.remove()" attribute in the markup,
// in two places, and the same attribute again inside a string in
// js/legal/chrome.js. Content-Security-Policy blocks inline event handlers, so
// it had to move into a module - and once it was a module, having three copies
// of it was worse than having one.
//
// The subtlety that makes this more than a one-liner: an inline handler is
// attached before the browser starts fetching the image, but a module runs
// after. By the time this code sees the element the load may already have
// finished or already have failed, and no event is coming. `complete` plus
// `naturalWidth` is the only way to tell those apart after the fact, so both
// the already-settled and the still-loading cases have to be handled.
//
// Markup opts in with data-brand-fallback:
//   "hide"         remove the image if it fails to load
//   "replaces-text"  ...and if it succeeds, remove the text beside it, which
//                    was only there to stand in for the image

function settle(img, ok) {
  if (!ok) {
    img.remove();
    return;
  }
  if (img.dataset.brandFallback === "replaces-text") {
    img.nextElementSibling?.remove();
  }
}

/** @param root where to look for [data-brand-fallback] images. */
export function initBrandImages(root = document) {
  for (const img of root.querySelectorAll("[data-brand-fallback]")) {
    if (img.complete) {
      // Already settled before this ran: a decoded image has a real width, a
      // broken one reports zero.
      settle(img, img.naturalWidth > 0);
      continue;
    }
    img.addEventListener("load", () => settle(img, true), { once: true });
    img.addEventListener("error", () => settle(img, false), { once: true });
  }
}
