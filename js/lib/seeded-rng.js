// Deterministic pseudo-random number generation for reproducible simulations.
// Mulberry32 is small, fast, and stable across browsers and Deno because it
// uses only 32-bit integer operations defined by JavaScript.

/** Convert an arbitrary seed into an unsigned 32-bit integer.
 *
 * A DECIMAL STRING IS A NUMBER, not a name to hash. Provenance travels through
 * Postgres and back, and a numeric column returns as a JS number or a string
 * depending on the driver - so a seed recorded as 4021156297 and read back as
 * "4021156297" used to hash to something else entirely and replay a different
 * game. The one thing a seed has to do is survive being written down.
 *
 * Anything that is not a plain uint32 decimal - a match UUID, a readable label
 * - still hashes, which is what the Edge Function relies on when it seeds from
 * a match id. */
export function normalizeSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0;
  const text = String(seed ?? "");
  // A canonical uint32 decimal round-trips as itself.
  if (/^\d{1,10}$/.test(text)) {
    const asNumber = Number(text);
    if (Number.isSafeInteger(asNumber) && asNumber >= 0 && asNumber <= 0xffffffff) return asNumber >>> 0;
  }
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Return a deterministic Math.random-compatible function. */
export function createSeededRng(seed) {
  let state = normalizeSeed(seed);
  return function seededRandom() {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Run synchronous simulation code with a deterministic Math.random source.
 * JavaScript cannot interleave another request during this synchronous block,
 * so the original function is restored before the event loop can resume.
 */
export function withSeededMathRandom(seed, callback) {
  const original = Math.random;
  Math.random = createSeededRng(seed);
  try {
    return callback();
  } finally {
    Math.random = original;
  }
}
