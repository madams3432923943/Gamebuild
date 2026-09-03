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
// IT RETURNS NOTES, NOT SENTENCES, and the reason is measured. The prose this
// used to build ran 82-117 characters a line against a card body about 27
// characters wide on a 360px phone, and three of those lines said the same
// thing about three different slots without ever saying what to do. matchupNotes
// splits it: the numbers become rows that cannot wrap, and the ONE clause worth
// words says who beats whom. See js/gradenotes.js.
//
// SPORT-AGNOSTIC ON PURPOSE. Nothing here knows what a slot means. It takes the
// sport's own rate() and slot labels and compares like for like, which is why
// it works unchanged for a football unit and a basketball guard - and why it
// lives in js/ rather than in either sport's folder. Shared code reaching for
// basketball's constants is the single most expensive mistake in this codebase
// (see CLAUDE.md); the fix is not to be careful, it is to take the sport as an
// argument.

import { statNote, adviceNote } from "./gradenotes.js";

/** How far apart two players have to rate before it is worth a row.
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
    // sport asked and whichever side is ahead - which is also what makes
    // `edge` the only quantity matchupNotes can honestly print, the two
    // sports' own ratings being on different scales entirely.
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

/** The surname a fan would use, or a unit's own short label.
 *
 * `Their Atlanta Falcons Offensive Line has an advantageous matchup against
 * your Atlanta Falcons Defensive Line` is 109 characters describing one fact,
 * and the two teams in it are not even the point. A card has room for the
 * half that identifies somebody: "Jefferson", "Falcons OL".
 *
 * A UNIT IS NOT A PERSON and has no surname - `unitLabel` is the sport's job,
 * so a unit arrives here already carrying whatever short name it has. The
 * fallback keeps the last two words, which turns "Atlanta Falcons Offensive
 * Line" into "Offensive Line" rather than into "Line". */
function shortName(entry, shorten) {
  const full = String(entry?.name ?? "").trim();
  if (!full) return "";
  if (typeof shorten === "function") {
    const given = String(shorten(entry) ?? "").trim();
    if (given) return given;
  }
  if (entry?.group) {
    const words = full.split(/\s+/);
    return words.slice(Math.max(0, words.length - 2)).join(" ");
  }
  // A person: the last word, plus a suffix when the name carries one, so
  // "Odell Beckham Jr." does not become "Jr.".
  const words = full.split(/\s+/);
  const last = words[words.length - 1];
  if (/^(jr\.?|sr\.?|i{1,3}|iv|v)$/i.test(last) && words.length >= 2) {
    return `${words[words.length - 2]} ${last}`;
  }
  return last;
}

/**
 * The same reads as notes rather than as sentences.
 *
 * ONE FACT ROW PER NOTABLE MISMATCH, plus ONE piece of advice naming the man
 * behind the worst of them. That division is the point: the numbers are what a
 * row is good at, and the one thing worth a clause is what the drafter should
 * do about the mismatch they are losing.
 *
 * It replaces matchupReads, which returned up to three prose sentences of
 * 82-117 characters each. Three of those said the same thing three times about
 * three different slots and none of them said what to do.
 *
 * @param opts.shorten  (entry) => string, the sport's own short name for an
 *                      entry. Optional; see shortName for the fallback.
 * @param opts.rows     how many fact rows to return, default 2.
 */
export function matchupNotes(roster, oppRoster, { rate, label, slots, pairings, shorten, rows = 2 } = {}) {
  const reads = pairings
    ? crossMatchups(roster, oppRoster, { rate, pairings })
    : slotMatchups(roster, oppRoster, { rate, label, slots });

  const notable = reads.filter((r) => Math.abs(r.edge) >= EDGE_THRESHOLD);
  if (!notable.length) {
    // Silence reads as a missing feature, and "nothing is mismatched" is real
    // information about a draft - it says the game is yours to lose on
    // gameplan rather than on the board.
    return [adviceNote("Nothing is mismatched - this one is down to gameplan.")];
  }

  const notes = [];
  // Worst against you first, then your best edge. Two opposite ends rather
  // than the two worst, so a lopsided draft does not print the same complaint
  // twice and a player who drafted well is told what they got right.
  const ordered = [notable[0]];
  const best = notable[notable.length - 1];
  if (best !== notable[0]) ordered.push(best);

  for (const read of ordered.slice(0, rows)) {
    // THE EDGE, NOT THE TWO RATINGS. Printing both was the obvious thing and
    // it was wrong: this module is sport-agnostic on purpose and the two
    // sports' ratings are on different scales entirely. Football's rateEntry
    // returns 0-1, so 100x it reads as a percentile; basketball's impact runs
    // to the tens, so the same arithmetic printed "C 3641-2275" on the card -
    // two numbers that mean nothing to a reader and cannot be compared to the
    // row above them.
    //
    // `edge` is already a share of the stronger of the two, which is scale-free
    // by construction, so it is the one quantity this module can honestly
    // format. A sport that wants to print its own ratings does it in its own
    // module, where it knows what they mean - see "Worst pick: CB 70-94" in
    // js/sports/nfl/draftgrade.js.
    const share = Math.round(100 * read.edge);
    // `label` is this side's slot and `against` what it faces, so a football
    // row reads "OL v rush" and a basketball one just "SF". Naming both sides
    // of a cross matchup is what stops "OL -24%" from looking like a typo.
    const rowLabel = read.against && read.against !== read.label
      ? `${read.label} v ${read.against}`
      : read.label;
    notes.push(statNote(rowLabel, `${share > 0 ? "+" : ""}${share}%`, read.edge < 0 ? "bad" : "good"));
  }

  // The one clause, about the mismatch that is actually a problem. Named,
  // because "your secondary is behind" is a fact and "Andrews will beat your
  // safeties" is a thing you can go and fix at the board.
  const worst = notable[0];
  if (worst.edge < 0) {
    const them = shortName(worst.theirs, shorten);
    // WHOSE UNIT IS LOSING IS MINE, so the clause names `label` - this side's
    // slot - and not `against`, which describes THEIRS. Getting that backwards
    // printed "Offensive Line has the edge on your offensive line", the exact
    // shape of nonsense the MATCHUPS table in js/sports/nfl/draftgrade.js was
    // written to avoid: nobody's offensive line blocks the other one.
    const target = worst.label;
    notes.push(adviceNote(
      worst.severity === "severe"
        // "on their own", not "on his own": half of what this names is a UNIT -
        // "Falcons OL will beat your pass rush on his own" is what the card
        // actually printed - and the singular they reads correctly for a person
        // too, so one clause covers both rather than the sport having to say
        // which it handed over.
        ? `${them} will beat your ${target} on their own.`
        : `${them} has the edge on your ${target}.`
    ));
  } else {
    // BOTH SIDES ARE NAMED HERE TOO, and not only because it reads better. A
    // roster ahead at every slot produced "play through Towns", which names
    // nobody on the other team - and scripts/verify-sport-contract.mjs exists
    // to catch a grade that was handed an opponent and never mentions one. The
    // old prose named both ("Your C Towns badly outmatches their C Grant") and
    // dropping that quietly turned the check red. Whoever the mismatch is
    // against is half of what a mismatch IS.
    const me = shortName(worst.mine, shorten);
    const them = shortName(worst.theirs, shorten);
    notes.push(adviceNote(`Play through ${me} on ${them}.`));
  }
  return notes;
}

/**
 * The same read, but for a sport where the two sides do not line up slot for
 * slot.
 *
 * WHY THIS IS SEPARATE FROM slotMatchups. Basketball has direct positional
 * matchups - your small forward really does guard theirs - so comparing like
 * slot to like slot is the game. Football has none. Nobody's tight end covers
 * the other tight end, and nobody's offensive line blocks the other offensive
 * line; football is offence against DEFENCE. Reading it slot-for-slot produced
 * lines like "your TE badly outmatches their TE", which is true of the ratings
 * and describes nothing that happens on a field.
 *
 * So the caller supplies the pairings, because only the sport knows them.
 *
 * @param pairings  [{ mine, theirs, label, against }] - `mine` and `theirs` are
 *                  slot keys on the respective rosters, `label` names the unit
 *                  the sentence is about, and `against` names what it faces.
 * @returns the same shape slotMatchups returns, so matchupReads can rank and
 *          phrase both without caring which sport it is looking at.
 */
export function crossMatchups(roster, oppRoster, { rate, pairings } = {}) {
  if (!roster || !oppRoster || typeof rate !== "function" || !pairings?.length) return [];

  const reads = [];
  for (const pair of pairings) {
    const mine = roster[pair.mine];
    const theirs = oppRoster[pair.theirs];
    // A slot either side left empty is a forfeit, which the draft grade already
    // charges for. Counting it here would charge for it twice.
    if (!mine || !theirs) continue;

    const mineRating = rate(mine);
    const theirRating = rate(theirs);
    const best = Math.max(mineRating, theirRating);
    if (!(best > 0)) continue;

    const edge = (mineRating - theirRating) / best;
    if (Math.abs(edge) < EDGE_THRESHOLD) continue;
    reads.push({
      slot: pair.mine,
      label: pair.label ?? pair.mine,
      against: pair.against ?? pair.theirs,
      mine,
      theirs,
      edge,
      severity: Math.abs(edge) >= SEVERE_THRESHOLD ? "severe" : "edge",
    });
  }
  return reads.sort((a, b) => a.edge - b.edge);
}
