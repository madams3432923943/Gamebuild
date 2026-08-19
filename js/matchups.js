// Reading one roster against the other, slot by slot, by name.
//
// WHY THIS EXISTS
//
// Both sports already knew whether the opponent's roster was a problem, and
// neither could say WHERE. Basketball's counterplay read is a whole-roster
// statement - "they are big and you are small" - which is true and hard to act
// on. Football's was worse than that: js/sports/nfl/index.js accepted an
// opponent roster and threw it away, so its "counterplay read" was the solo
// draft grade printed twice. The output looked plausible, which is why nobody
// noticed.
//
// What a drafter actually wants after the boards are set is the sentence they
// would say out loud: their small forward is going to eat mine. So that is what
// this returns, named on both sides.
//
// SPORT-AGNOSTIC ON PURPOSE. Nothing here knows what a slot means. It takes the
// sport's own rate() and slot labels and compares like for like, which is why
// it works unchanged for a football unit and a basketball guard - and why it
// lives in js/ rather than in either sport's folder. Shared code reaching for
// basketball's constants is the single most expensive mistake in this codebase
// (see CLAUDE.md); the fix is not to be careful, it is to take the sport as an
// argument.

/** How far apart two players have to rate before it is worth a sentence.
 *
 * A share of the better player's rating, not an absolute: football's unit
 * ratings and basketball's impact scores are different scales entirely, and a
 * threshold in points would mean something different in each. 18% is roughly
 * "you would notice during the game" - below it the two are close enough that
 * calling a winner would be reading noise into a rounding difference. */
const EDGE_THRESHOLD = 0.18;

/** A gap this size stops being an edge and becomes the story of the game. */
const SEVERE_THRESHOLD = 0.4;

/**
 * Every slot both rosters filled, worst-for-you first.
 *
 * @param roster      your roster: slot -> player
 * @param oppRoster   theirs, keyed by the same slots
 * @param opts.rate   the sport's rating function, (player) => number
 * @param opts.label  slot -> display name, defaults to the slot id itself
 * @param opts.slots  which slots to read, defaults to the ones you have filled
 *
 * Returns [{ slot, label, mine, theirs, edge, severity }], where `edge` is
 * positive when YOU are ahead. Slots either side left empty are skipped rather
 * than counted as a loss: an unfilled slot is a forfeit, which the draft grade
 * already penalises, and counting it twice would double-charge for it.
 */
export function slotMatchups(roster, oppRoster, { rate, label, slots } = {}) {
  if (!roster || !oppRoster || typeof rate !== "function") return [];

  const keys = slots || Object.keys(roster);
  const reads = [];

  for (const slot of keys) {
    const mine = roster[slot];
    const theirs = oppRoster[slot];
    if (!mine || !theirs) continue;

    const mineRating = Number(rate(mine));
    const theirsRating = Number(rate(theirs));
    if (!Number.isFinite(mineRating) || !Number.isFinite(theirsRating)) continue;

    // Relative to the stronger of the two, so the scale is the same whichever
    // sport asked and whichever side is ahead.
    const scale = Math.max(Math.abs(mineRating), Math.abs(theirsRating));
    if (scale <= 0) continue;

    const edge = (mineRating - theirsRating) / scale;
    reads.push({
      slot,
      label: label ? label(slot) : slot,
      mine,
      theirs,
      edge,
      severity: Math.abs(edge) >= SEVERE_THRESHOLD ? "severe" : "clear",
    });
  }

  // Worst for you first. The mismatch you are losing is the one you can still
  // do something about - with a gameplan, a rotation, or a defensive
  // assignment - and burying it under your own advantages is the wrong order
  // for a screen you read once before kickoff.
  return reads.sort((a, b) => a.edge - b.edge);
}

/** `Their SF LeBron James has an advantageous matchup against your SF Jake
 *  LaRavia.` - and the same sentence the other way round when you are ahead.
 *
 * The slot is named on both sides even though it is the same slot, because
 * that is how the sentence is said out loud, and because a reader scanning
 * three of these needs the position to anchor each one. */
export function matchupSentence(read) {
  const theirName = read.theirs?.name ?? "their player";
  const myName = read.mine?.name ?? "yours";

  if (read.edge < 0) {
    return read.severity === "severe"
      ? `Their ${read.label} ${theirName} badly outmatches your ${read.label} ${myName}.`
      : `Their ${read.label} ${theirName} has an advantageous matchup against your ${read.label} ${myName}.`;
  }
  return read.severity === "severe"
    ? `Your ${read.label} ${myName} badly outmatches their ${read.label} ${theirName}.`
    : `Your ${read.label} ${myName} has an advantageous matchup against their ${read.label} ${theirName}.`;
}

/**
 * The two or three sentences worth printing under a draft grade.
 *
 * Only mismatches past EDGE_THRESHOLD, capped, and always leading with the
 * worst one against you. A list of every slot would be a table, and a table of
 * fifteen near-even matchups says nothing - the whole value here is that the
 * lines which appear are the ones that decided something.
 *
 * An even board returns one sentence saying so, rather than nothing: silence
 * reads as a missing feature, and "no mismatch anywhere" is real information
 * about a draft.
 */
export function matchupReads(roster, oppRoster, { rate, label, slots, limit = 3 } = {}) {
  const reads = slotMatchups(roster, oppRoster, { rate, label, slots });
  if (!reads.length) return [];

  const notable = reads.filter((r) => Math.abs(r.edge) >= EDGE_THRESHOLD);
  if (!notable.length) {
    return ["Nothing is mismatched - this one comes down to gameplan and rotation."];
  }

  // Worst against you, then your best edge, then whatever is next most extreme.
  // Leading with two opposite ends stops a lopsided draft from printing three
  // versions of the same sentence.
  const ordered = [];
  const worst = notable[0];
  ordered.push(worst);
  const best = notable[notable.length - 1];
  if (best !== worst) ordered.push(best);
  for (const read of notable) {
    if (ordered.length >= limit) break;
    if (!ordered.includes(read)) ordered.push(read);
  }

  return ordered.slice(0, limit).map(matchupSentence);
}
