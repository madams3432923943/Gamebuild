// The brand images degrade to text when their file is missing.
//
// WHY THIS IS A MODULE AND NOT AN ATTRIBUTE
//
// This was two inline `onerror`/`onload` attributes in index.html, which is the
// obvious way to write it and worked fine - right up until the page grew a
// Content Security Policy. CSP governs inline event handlers as inline script,
// and hashes deliberately do NOT apply to them (only the 'unsafe-hashes'
// keyword lets them through, which re-opens most of what the policy is for).
// So the choice was to weaken the policy for two image fallbacks, or to move
// the two image fallbacks. This is the second one.
//
// THE RACE THIS HAS TO WIN
//
// An attribute handler is attached before the image starts loading. A module
// runs later - late enough that a cached image can be fully decoded before this
// code exists, and its load event fired into the void. Listening alone would
// therefore leave the fallback text sitting under a logo that had loaded
// perfectly. `complete` is what settles it: an image that is already done
// reports it, and naturalWidth separates "done, and it worked" from "done, and
// it 404'd" - a broken image is complete with a natural width of zero.

/** Applies one image's fallback behaviour now if it has already settled, or
 * when it settles. `onOk`/`onFail` are called at most once between them. */
function whenSettled(img, { onOk, onFail }) {
  if (!img) return;
  if (img.complete) {
    // decoded and non-empty === it really arrived
    if (img.naturalWidth > 0) onOk();
    else onFail();
    return;
  }
  img.addEventListener("load", onOk, { once: true });
  img.addEventListener("error", onFail, { once: true });
}

/**
 * Wires both brand images:
 *
 *  - the top-bar mark removes itself if it cannot load, leaving the word
 *    "Draft Nova" alone rather than a broken-image glyph on every screen.
 *  - the auth lockup already carries the name, so the word beside it is a
 *    FALLBACK, not a caption: the word goes when the image arrives, and the
 *    image goes when it doesn't. Exactly one of the two is always showing.
 */
export function initBrandFallbacks(root = document) {
  const mark = root.querySelector(".brand-mark");
  whenSettled(mark, { onOk: () => {}, onFail: () => mark.remove() });

  const lockup = root.querySelector(".auth-brand-mark");
  whenSettled(lockup, {
    onOk: () => lockup.nextElementSibling?.remove(),
    onFail: () => lockup.remove(),
  });
}
