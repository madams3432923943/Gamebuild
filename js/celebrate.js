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
let audioCtx = null;
let muted = false;

function ctx() {
  if (muted) return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

/** Turns every sound off for the session. Nothing calls this yet - it exists
 * so a mute control has something to call when one lands. */
export function setMuted(value) {
  muted = !!value;
}

/** One synthesised tone. `type` picks the timbre, and the envelope is a
 * plain attack/decay because anything more elaborate is inaudible under a
 * 200ms blip. */
function tone({ freq, durationMs = 180, type = "sine", gain = 0.12, delayMs = 0, sweepTo = null }) {
  const audio = ctx();
  if (!audio) return;
  const start = audio.currentTime + delayMs / 1000;
  const stop = start + durationMs / 1000;

  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, stop);

  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, stop);

  osc.connect(amp).connect(audio.destination);
  osc.start(start);
  osc.stop(stop + 0.02);
}

/** The end-of-game horn. */
export function playBuzzer() {
  tone({ freq: 180, durationMs: 700, type: "square", gain: 0.08 });
  tone({ freq: 240, durationMs: 700, type: "sawtooth", gain: 0.05 });
}

/** A short rising fanfare - a win, a rank-up, an unlock. */
export function playFanfare() {
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => tone({ freq, durationMs: 260, type: "triangle", gain: 0.1, delayMs: i * 110 }));
}

/** A flat two-note fall, for a loss. Quieter than the fanfare on purpose:
 * losing shouldn't be louder than winning. */
export function playDefeat() {
  tone({ freq: 392, durationMs: 260, type: "triangle", gain: 0.07 });
  tone({ freq: 311.13, durationMs: 420, type: "triangle", gain: 0.07, delayMs: 200 });
}

/** A single bright tick, for a stat counting up or a badge landing. */
export function playPop(step = 0) {
  tone({ freq: 660 + step * 90, durationMs: 110, type: "sine", gain: 0.07 });
}

/** A rising whoosh, for the matchmaking banners flying in. */
export function playWhoosh() {
  tone({ freq: 140, sweepTo: 900, durationMs: 480, type: "sawtooth", gain: 0.05 });
}

/**
 * Animates a number up to its final value, calling `render` with each step.
 * The point is that a rating RISING is legible in a way a rating that has
 * already risen is not - the movement is the reward.
 */
export function countUp(from, to, { durationMs = 900, render, onDone, sound = false } = {}) {
  if (typeof render !== "function") return;
  if (reducedMotion() || from === to) {
    render(to);
    if (onDone) onDone();
    return;
  }
  const started = performance.now();
  let lastShown = from;
  function frame(now) {
    const t = Math.min(1, (now - started) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = Math.round(from + (to - from) * eased);
    if (value !== lastShown) {
      lastShown = value;
      render(value);
      if (sound && Math.random() < 0.25) playPop();
    }
    if (t < 1) requestAnimationFrame(frame);
    else {
      render(to);
      if (onDone) onDone();
    }
  }
  requestAnimationFrame(frame);
}

/** Retriggers a CSS animation class on an element. Removing then re-adding a
 * class that's already present is a no-op without a reflow in between, so
 * back-to-back celebrations would otherwise only play the first. */
export function replayAnimation(el, className) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}
