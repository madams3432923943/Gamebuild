#!/usr/bin/env node
// The sound layer's contract, which is mostly about NOT making sound.
//
// The waveforms are taste and this does not test them. What it tests is every
// promise the rest of the app relies on:
//
//   - muted means muted, for every sound in the catalogue, with no exceptions
//     that crept in via a direct call
//   - the preference survives a reload
//   - a browser with no AudioContext plays nothing and THROWS NOTHING - a
//     silent game is fine, a game that dies on a locked-down browser is not
//   - the same sound twice in a millisecond is one sound, so a draft board
//     filling six slots ticks instead of buzzing
//   - an unknown name is ignored rather than thrown on, because a missing
//     confirmation should never take a screen down
//
// Run under a stub DOM: js/sound.js only touches window, localStorage and
// AudioContext, so standing those up is cheaper and more honest than a
// browser, and it lets the no-AudioContext case actually be tested.

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const add = (title, ok, detail) => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

/** Counts every node that would reach the speakers. */
function makeStubAudio(counter) {
  const node = () => ({
    connect(next) { return next; },
    gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    type: "",
    Q: { value: 0 },
    start() { counter.started += 1; },
    stop() {},
    buffer: null,
  });
  return class StubAudioContext {
    constructor() {
      this.state = "running";
      this.sampleRate = 44100;
      this.currentTime = 0;
      this.destination = node();
      counter.contexts += 1;
    }
    createGain() { return node(); }
    createOscillator() { return node(); }
    createBiquadFilter() { return node(); }
    createBufferSource() { return node(); }
    createBuffer(_ch, frames) { return { getChannelData: () => new Float32Array(frames) }; }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
  };
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const counter = { started: 0, contexts: 0 };
globalThis.window = {
  AudioContext: makeStubAudio(counter),
  addEventListener() {},
  removeEventListener() {},
};

const sound = await import("../js/sound.js");
const { playSound, setSoundEnabled, soundEnabled, SOUND_NAMES } = sound;

// ---- every catalogue entry actually produces audio --------------------------
let silentNames = [];
for (const name of SOUND_NAMES) {
  const before = counter.started;
  // Each name gets its own throttle bucket, but repeat runs of this loop would
  // collide - the generous window is disabled explicitly.
  playSound(name, { throttleMs: 0 });
  if (counter.started === before) silentNames.push(name);
}
add(
  "Every sound in the catalogue makes a sound",
  silentNames.length === 0,
  silentNames.length === 0 ? `${SOUND_NAMES.length} sounds, all audible` : `silent: ${silentNames.join(", ")}`
);

// ---- muted means muted ------------------------------------------------------
setSoundEnabled(false);
const mutedFrom = counter.started;
for (const name of SOUND_NAMES) playSound(name, { throttleMs: 0 });
sound.playPop(3);
add(
  "Muted plays nothing at all",
  counter.started === mutedFrom,
  counter.started === mutedFrom ? `${SOUND_NAMES.length} sounds + playPop, all silent` : `${counter.started - mutedFrom} leaked through`
);
add("Muting is remembered", store.get("draftnova.sound") === "off", `stored "${store.get("draftnova.sound")}"`);

setSoundEnabled(true);
add("Unmuting is remembered too", store.get("draftnova.sound") === "on" && soundEnabled(), `stored "${store.get("draftnova.sound")}"`);

// ---- the throttle -----------------------------------------------------------
// The catalogue sweep above stamped every name's throttle bucket, so this has
// to start from outside that window or it measures the sweep rather than the
// throttle. `throttleMs: 0` bypasses the WAIT, it does not stop the timestamp
// being recorded - which is correct, and is exactly what caught this.
await new Promise((r) => setTimeout(r, 90));
const throttleFrom = counter.started;
playSound("pickMade");
const firstLanded = counter.started > throttleFrom;
const afterFirst = counter.started;
playSound("pickMade");
playSound("pickMade");
add(
  "The same sound twice in a moment is one sound",
  firstLanded && counter.started === afterFirst,
  firstLanded ? "repeat suppressed inside the window" : "the first one never played"
);
// A different sound is never blocked by an unrelated one's throttle.
const otherFrom = counter.started;
playSound("cardSelect");
add("A different sound is not blocked by it", counter.started > otherFrom, "independent throttle per name");

// ---- unknown names ----------------------------------------------------------
let threw = null;
try {
  const played = playSound("no-such-sound");
  add("An unknown sound is ignored, not thrown on", played === false, `returned ${played}`);
} catch (e) {
  threw = e;
  add("An unknown sound is ignored, not thrown on", false, `threw ${e.message}`);
}

// ---- no AudioContext at all -------------------------------------------------
// The case that matters most: a locked-down or ancient browser should get a
// silent game, not a broken one.
const noAudioStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (noAudioStore.has(k) ? noAudioStore.get(k) : null),
  setItem: (k, v) => noAudioStore.set(k, String(v)),
  removeItem: (k) => noAudioStore.delete(k),
};
globalThis.window = { addEventListener() {}, removeEventListener() {} }; // no AudioContext
const bare = await import(`../js/sound.js?nocontext=${Date.now()}`);
let bareThrew = null;
try {
  for (const name of bare.SOUND_NAMES) bare.playSound(name, { throttleMs: 0 });
  bare.playPop(1);
  bare.primeSound();
} catch (e) {
  bareThrew = e;
}
add(
  "A browser with no AudioContext plays nothing and breaks nothing",
  !bareThrew,
  bareThrew ? `threw ${bareThrew.message}` : `${bare.SOUND_NAMES.length} sounds attempted, no throw`
);

console.log(renderSection("Sound: the mute contract, the throttle, and the browsers that cannot"));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
