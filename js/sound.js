// The app's sound, in one place.
//
// Audio was four functions in js/celebrate.js, each opening straight onto the
// destination node: no way to turn it off, no shared volume, nothing stopping
// six of them landing on the same 80ms, and no preference that survived a
// reload. This owns all of that so a caller only has to name the moment.
//
// EVERY SOUND IS SYNTHESISED. Nothing is sampled, downloaded or bundled, which
// makes the licensing question disappear rather than get answered: there is no
// recording here to have rights in. It also means the whole sound design costs
// zero bytes of download, which matters on the phone where this is played.
//
// NOTHING HERE IS REQUIRED TO UNDERSTAND THE GAME. Sound is confirmation of
// something the screen already said - a pick landed, a timer is nearly out,
// a shot went in. Muted, with the tab silenced, or on a browser with no
// AudioContext at all, the game is exactly as playable. That is a design
// constraint, not an accident, and it is why every failure path here is silent
// rather than loud.

const STORAGE_KEY = "draftnova.sound";

let audioCtx = null;
let master = null;
let enabled = true;
let unlocked = false;
const lastPlayedAt = new Map();

/** Overlap guard. Two of the same sound inside this window is the second one
 * being dropped - a draft board that fills six slots at once should tick, not
 * buzz. Per sound name, so unrelated sounds never block each other. */
const THROTTLE_MS = 60;

/** One master gain everything passes through, so "quieter" is one number
 * rather than an edit to every call site. Well below 1: these are synthesised
 * square and sawtooth waves, which are far louder per unit gain than the
 * recorded audio a player's volume is set for. */
const MASTER_GAIN = 0.5;

try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) enabled = stored === "on";
} catch {
  // Private mode, disabled storage, a sandboxed iframe. The default stands.
}

export function soundEnabled() {
  return enabled;
}

/** @returns the new state, so a caller can label a toggle without re-reading. */
export function setSoundEnabled(on) {
  enabled = !!on;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Preference is lost on reload; the session still honours it.
  }
  if (!enabled && audioCtx) audioCtx.suspend?.().catch(() => {});
  if (enabled && audioCtx) audioCtx.resume?.().catch(() => {});
  return enabled;
}

/**
 * Mobile browsers refuse to start an AudioContext outside a user gesture, and
 * a context created before one is stuck "suspended" forever - which is a
 * silent game with nothing in the console to explain it.
 *
 * So the context is not created until the first gesture, and this hooks the
 * first one there is. Registered once, removed as soon as it fires: after
 * that, ctx() can resume normally.
 */
export function primeSound() {
  if (unlocked || typeof window === "undefined") return;
  const unlock = () => {
    unlocked = true;
    ctx();
    for (const ev of ["pointerdown", "keydown", "touchstart"]) {
      window.removeEventListener(ev, unlock);
    }
  };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) {
    window.addEventListener(ev, unlock, { once: false, passive: true });
  }
}

function ctx() {
  if (!enabled || typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      audioCtx = new Ctor();
      master = audioCtx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(audioCtx.destination);
    } catch {
      audioCtx = null;
      return null;
    }
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

/** One synthesised tone through the master bus. */
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

  osc.connect(amp).connect(master);
  osc.start(start);
  osc.stop(stop + 0.02);
}

/** Filtered noise - the percussive sounds a pure oscillator cannot make: a
 * whistle's breath, a ball through a net, a body hitting the turf. */
function noise({ durationMs = 160, gain = 0.08, freq = 1200, q = 1, delayMs = 0 }) {
  const audio = ctx();
  if (!audio) return;
  const start = audio.currentTime + delayMs / 1000;
  const frames = Math.max(1, Math.floor((audio.sampleRate * durationMs) / 1000));
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const src = audio.createBufferSource();
  src.buffer = buffer;
  const band = audio.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = freq;
  band.Q.value = q;
  const amp = audio.createGain();
  amp.gain.setValueAtTime(gain, start);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);

  src.connect(band).connect(amp).connect(master);
  src.start(start);
  src.stop(start + durationMs / 1000 + 0.02);
}

/**
 * The catalogue. Named for the MOMENT, not the waveform, so a call site says
 * what happened and this file decides what that sounds like - which is what
 * lets the sound design be retuned without touching the game code.
 */
const SOUNDS = {
  // ---- Draft ----
  squadRoll: () => { tone({ freq: 320, sweepTo: 620, durationMs: 260, type: "triangle", gain: 0.06 }); },
  pickMade: () => { tone({ freq: 660, durationMs: 120, type: "sine", gain: 0.09 });
                    tone({ freq: 880, durationMs: 140, type: "sine", gain: 0.07, delayMs: 70 }); },
  // Lower and flatter than your own pick: the opponent's move should register
  // without competing with yours.
  pickOpponent: () => { tone({ freq: 420, durationMs: 130, type: "triangle", gain: 0.05 }); },
  pickMissed: () => { tone({ freq: 300, sweepTo: 180, durationMs: 360, type: "sawtooth", gain: 0.06 }); },
  rosterComplete: () => { [523.25, 659.25, 783.99].forEach((f, i) =>
                    tone({ freq: f, durationMs: 200, type: "triangle", gain: 0.08, delayMs: i * 90 })); },
  timerWarn: () => { tone({ freq: 880, durationMs: 90, type: "square", gain: 0.06 }); },
  // The last few seconds. Deliberately dry and identical each time - a tick
  // that changes pitch reads as an effect, one that does not reads as a clock.
  timerTick: () => { tone({ freq: 1040, durationMs: 55, type: "square", gain: 0.05 }); },

  // ---- Strategy ----
  cardSelect: () => { tone({ freq: 520, durationMs: 70, type: "sine", gain: 0.05 }); },
  lockIn: () => { tone({ freq: 300, durationMs: 90, type: "square", gain: 0.07 });
                  tone({ freq: 600, durationMs: 160, type: "triangle", gain: 0.07, delayMs: 60 }); },
  phaseChange: () => { tone({ freq: 180, sweepTo: 520, durationMs: 320, type: "sawtooth", gain: 0.05 }); },

  // ---- Basketball ----
  // The net, not the ball: a short burst of high filtered noise is what a
  // swish actually is.
  shotMade: () => { noise({ durationMs: 130, gain: 0.06, freq: 4200, q: 0.7 }); },
  shotMiss: () => { noise({ durationMs: 110, gain: 0.05, freq: 900, q: 3 }); },
  shotThree: () => { noise({ durationMs: 150, gain: 0.07, freq: 4600, q: 0.7 });
                     tone({ freq: 880, durationMs: 180, type: "triangle", gain: 0.05, delayMs: 60 }); },
  rimFinish: () => { noise({ durationMs: 90, gain: 0.09, freq: 320, q: 1.4 });
                     noise({ durationMs: 140, gain: 0.05, freq: 3800, q: 0.8, delayMs: 40 }); },
  steal: () => { tone({ freq: 720, sweepTo: 1200, durationMs: 130, type: "sine", gain: 0.06 }); },
  block: () => { noise({ durationMs: 120, gain: 0.09, freq: 260, q: 1.2 }); },
  turnover: () => { tone({ freq: 400, sweepTo: 250, durationMs: 200, type: "triangle", gain: 0.05 }); },

  // ---- Football ----
  snap: () => { noise({ durationMs: 70, gain: 0.07, freq: 700, q: 1.5 }); },
  firstDown: () => { tone({ freq: 660, durationMs: 110, type: "triangle", gain: 0.07 });
                     tone({ freq: 990, durationMs: 150, type: "triangle", gain: 0.06, delayMs: 90 }); },
  bigGain: () => { tone({ freq: 400, sweepTo: 1100, durationMs: 320, type: "triangle", gain: 0.06 }); },
  sack: () => { noise({ durationMs: 200, gain: 0.1, freq: 190, q: 1 }); },
  touchdown: () => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
                     tone({ freq: f, durationMs: 240, type: "triangle", gain: 0.09, delayMs: i * 95 })); },
  fieldGoal: () => { tone({ freq: 700, durationMs: 200, type: "triangle", gain: 0.07 });
                     tone({ freq: 1050, durationMs: 260, type: "triangle", gain: 0.05, delayMs: 130 }); },

  // ---- Shared game furniture ----
  whistle: () => { noise({ durationMs: 240, gain: 0.06, freq: 2600, q: 12 }); },
  periodEnd: () => { tone({ freq: 220, durationMs: 420, type: "square", gain: 0.07 }); },
  buzzer: () => { tone({ freq: 180, durationMs: 700, type: "square", gain: 0.08 });
                  tone({ freq: 240, durationMs: 700, type: "sawtooth", gain: 0.05 }); },
  fanfare: () => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
                   tone({ freq: f, durationMs: 260, type: "triangle", gain: 0.1, delayMs: i * 110 })); },
  defeat: () => { tone({ freq: 392, durationMs: 260, type: "triangle", gain: 0.07 });
                  tone({ freq: 311.13, durationMs: 420, type: "triangle", gain: 0.07, delayMs: 200 }); },
  whoosh: () => { tone({ freq: 140, sweepTo: 900, durationMs: 480, type: "sawtooth", gain: 0.05 }); },
  tap: () => { tone({ freq: 460, durationMs: 45, type: "sine", gain: 0.04 }); },
};

/** Every name the catalogue answers to. Exported so a test can assert the
 * call sites and the catalogue have not drifted apart. */
export const SOUND_NAMES = Object.keys(SOUNDS);

/**
 * Play a named sound. Unknown names are ignored rather than thrown on: a
 * missing sound is a missing confirmation, and taking a screen down over one
 * would be a far worse bug than silence.
 */
export function playSound(name, opts = {}) {
  if (!enabled) return false;
  const make = SOUNDS[name];
  if (!make) return false;

  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const gap = opts.throttleMs ?? THROTTLE_MS;
  if (now - (lastPlayedAt.get(name) || -Infinity) < gap) return false;
  lastPlayedAt.set(name, now);

  try {
    make();
  } catch {
    // A browser that has an AudioContext but refuses a node. Silence is the
    // correct outcome; the game continues.
    return false;
  }
  return true;
}

/** A pitched tick for a counter running up - step raises it, so a row of
 * stats climbing sounds like it is climbing. Not in the catalogue because it
 * takes an argument. */
export function playPop(step = 0) {
  if (!enabled) return;
  try {
    tone({ freq: 660 + step * 90, durationMs: 110, type: "sine", gain: 0.07 });
  } catch {
    /* silent */
  }
}
