// A seedable PRNG, used to make the simulation replayable.
//
// engine.js calls bare Math.random() (via randRange), so a game is not
// reproducible: the same rosters simulated twice differ by ~36% peak-to-peak
// on team score, which is by design - TEAM_QUARTER_VARIANCE and TALENT_PARITY
// exist precisely to make quarters swing. That variance is a feature of the
// game and a problem for verification, because "did these two engines produce
// the same box score" is unanswerable while both are rolling their own dice.
//
// Rather than thread an rng parameter through every engine function (which
// would mean editing both the client engine and the deployed Edge Function
// copy, and would leave the two able to drift again), the harness swaps
// Math.random itself for the duration of a run. Both engines then draw from
// the same stream in the same order, so any divergence in the resulting box
// score is a real difference in logic - which is exactly what we want to
// detect.
//
// mulberry32: 32-bit state, uniform output, and short enough to be obviously
// correct. Cryptographic quality is irrelevant here; reproducibility is the
// entire requirement.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turns a string into a 32-bit seed, so runs can be labelled by a readable
 * name ("bulls-vs-jazz") instead of a magic number. */
export function seedFrom(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Runs `fn` with Math.random replaced by a fresh stream from `seed`, then
 * restores the real Math.random - including if `fn` throws, so one failed
 * check can't leave every later check running on a stubbed RNG.
 *
 * Also reports how many numbers were drawn. Two engines that produce
 * identical box scores while consuming a different COUNT of random values
 * are not actually equivalent - they just happened to land in the same
 * place - so the draw count is part of what gets compared.
 */
export function withSeededRandom(seed, fn) {
  const real = Math.random;
  const rng = mulberry32(seed);
  let draws = 0;
  Math.random = () => {
    draws += 1;
    return rng();
  };
  try {
    const value = fn();
    return { value, draws };
  } finally {
    Math.random = real;
  }
}
