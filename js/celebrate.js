import { playSound } from "./sound.js";
// Celebration: confetti, a buzzer, and the couple of sounds that turn a
// number going up into something worth watching.
//
// The brief this answers is "right now improvements are functional - make
// them feel rewarding". Everything here is deliberately cheap:
//
//   - Confetti is DOM elements with CSS animations, not a canvas render
//     loop. A phone can composite 60 transformed divs on the GPU without a
//     single layout; a canvas would need a rAF loop and a live compositor
//     layer for the whole session.
//   - The layer is filled only for the duration of a burst and emptied
//     after, so nothing is mounted while nothing is celebrating.
//   - Sound is synthesised with WebAudio rather than shipped as files. No
//     network fetch, no decode, nothing to 404, and a buzzer is two
//     oscillators anyway.
//
// Both respect prefers-reduced-motion, and audio only ever starts from a real
// user gesture's descendant call - browsers refuse otherwise, which is
// handled by simply not making a noise rather than by throwing.

const LAYER_ID = "celebration-layer";

const COLORS = ["#f4a340", "#ffd166", "#ef476f", "#06d6a0", "#118ab2", "#ffffff"];

function reducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function layer() {
  return document.getElementById(LAYER_ID);
}

/**
 * A burst of confetti from the top of the screen.
 * @param opts.count how many pieces (default 70)
 * @param opts.durationMs how long before the layer is emptied
 */
export function confetti({ count = 70, durationMs = 3200 } = {}) {
  const host = layer();
  if (!host || reducedMotion()) return;

  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = COLORS[Math.floor(Math.random() * COLORS.length)];
    // Staggered starts and durations are what stop it reading as one sheet of
    // paper falling: the eye picks up a uniform grid instantly.
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    piece.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
    piece.style.setProperty("--drift", `${(Math.random() * 2 - 1) * 22}vw`);
    piece.style.setProperty("--spin", `${360 + Math.random() * 720}deg`);
    if (Math.random() < 0.35) piece.style.borderRadius = "50%";
    frag.appendChild(piece);
  }
  host.appendChild(frag);
  window.setTimeout(() => {
    host.innerHTML = "";
  }, durationMs);
}

// One shared context. Created lazily because constructing it before a user
// gesture leaves it suspended on iOS, and a suspended context that never
// resumes is a silent game with no error to notice.
// Audio used to live here: four functions, each opening straight onto the
// destination node, with no mute, no shared volume and no preference that
// survived a reload. It moved to js/sound.js, which owns one context, one
// master gain and one on/off. These four names stay as re-exports because
// they are called from a dozen places and renaming them would be churn with
// no benefit - the sound they make is now the catalogue's business.

export function playBuzzer() { playSound("buzzer"); }
export function playFanfare() { playSound("fanfare"); }
export function playDefeat() { playSound("defeat"); }
export function playWhoosh() { playSound("whoosh"); }
export { playPop } from "./sound.js";

/** Retriggers a CSS animation class on an element. Removing then re-adding a
 * class that's already present is a no-op without a reflow in between, so
 * back-to-back celebrations would otherwise only play the first. */
export function replayAnimation(el, className) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}
