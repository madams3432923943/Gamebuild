// Turning a raw draft score into a letter, against the dataset it came from.
//
// WHY THIS IS NOT A TABLE OF CUTOFFS
//
// It used to be: score >= 0.90 is an A+, >= 0.82 an A, and so on. Fixed
// numbers are only meaningful against the distribution they were picked from,
// and this dataset has changed repeatedly - per-season rows, a squad trim, the
// trim removed, a contributor filter. Every one of those shifted what an
// average roster scores, and the letters silently drifted with it: forty NBA
// rosters graded out D- to C+, with no A and no F anywhere. Everyone was
// failing, which tells a player nothing.
//
// So the curve is DERIVED from the data. Sample plausible rosters, see what
// they actually score, and grade against that spread. Change the dataset,
// re-run, and the letters keep meaning the same thing - which is the point:
// an A should mean "better than almost anyone could have drafted here", not
// "cleared a number somebody typed in 2024".

const LETTERS = [
  [0.97, "A+"], [0.90, "A"], [0.82, "A-"],
  [0.72, "B+"], [0.62, "B"], [0.52, "B-"],
  [0.42, "C+"], [0.32, "C"], [0.22, "C-"],
  [0.12, "D+"], [0.05, "D"], [0, "F"],
];

/** Builds a sorted list of scores from sampled rosters. Cheap enough to do
 * once per dataset and memoised by the caller, since it only changes when the
 * data does. */
export function buildGradeCurve(sampleScores) {
  return [...sampleScores].sort((a, b) => a - b);
}

/** The letter for a score, by where it falls among those samples. A roster at
 * the 90th percentile of what could have been drafted gets an A. */
export function letterFor(score, curve) {
  // A NaN score is not a bad draft, it is a broken caller - and it grades as F,
  // silently, because every comparison against it is false so the binary search
  // never advances and the percentile comes out 0. Football shipped exactly
  // that: an options object reached a parameter expecting an array, `.length`
  // was undefined, the penalty was NaN, and every roster ever drafted got an F
  // that looked like a considered verdict. Fail loudly instead - the caller
  // hides the grade and logs, which is a missing grade rather than a lie.
  if (!Number.isFinite(score)) {
    throw new TypeError(`letterFor needs a finite score, got ${score}`);
  }
  if (!curve || curve.length === 0) return "C";
  let lo = 0;
  let hi = curve.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (curve[mid] <= score) lo = mid + 1;
    else hi = mid;
  }
  const percentile = lo / curve.length;
  return (LETTERS.find(([floor]) => percentile >= floor) || [0, "F"])[1];
}

/** Samples rosters the way a draft actually produces them - one player per
 * slot, drawn from across the era - and scores each. The spread of those
 * scores IS the curve. */
export function sampleRosterScores(slots, poolFor, scoreRoster, count = 240) {
  // ONE POOL PER SLOT, not one per slot per sample.
  //
  // poolFor filters the whole dataset, and it was being called inside both
  // loops - 240 samples x 11 football slots x 13,874 entries is about 36
  // million eligibility tests for an answer that depends only on the slot. The
  // curve is built lazily on the FIRST graded draft, which is the moment the
  // last roster spot is filled, so the whole cost landed as a dead screen
  // right at the end of the draft: 9.2 seconds for football, 1.4 for
  // basketball. Hoisting it is a pure speed-up - the sampling below indexes
  // into exactly the same arrays in exactly the same order, so the curve, and
  // therefore every letter, is unchanged.
  const pools = new Map(slots.map((slot) => [slot, poolFor(slot)]));
  const scores = [];
  for (let i = 0; i < count; i++) {
    const roster = {};
    for (const [n, slot] of slots.entries()) {
      const pool = pools.get(slot);
      if (!pool.length) continue;
      // Deterministic spread rather than Math.random, so the same dataset
      // always produces the same curve and a grade is reproducible.
      roster[slot] = pool[(i * 37 + n * 101 + 7) % pool.length];
    }
    scores.push(scoreRoster(roster));
  }
  return buildGradeCurve(scores);
}
