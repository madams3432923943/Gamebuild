/** Convert an arbitrary seed into an unsigned 32-bit integer.
 *
 * A DECIMAL STRING IS A NUMBER, not a name to hash. Provenance travels through
 * Postgres and back, and a numeric column returns as a JS number or a string
 * depending on the driver - so a seed recorded as 4021156297 and read back as
 * "4021156297" used to hash to something else entirely and replay a different
 * game. The one thing a seed has to do is survive being written down.
 *
 * Anything that is not a plain uint32 decimal - the match UUID this is usually
 * called with, a readable label - still hashes.
 *
 * Kept byte-identical in meaning to js/lib/seeded-rng.js; the two are vendored
 * copies the same way the engines are. */
export function normalizeSeed(seed: string | number): number {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0;
  const text = String(seed);
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

export function createSeededRng(seed: string | number): () => number {
  let state = normalizeSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function withSeededMathRandom<T>(seed: string | number, callback: () => T): T {
  const original = Math.random;
  Math.random = createSeededRng(seed);
  try {
    return callback();
  } finally {
    Math.random = original;
  }
}
