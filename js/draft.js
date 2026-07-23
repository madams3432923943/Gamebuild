// Draft mechanics: shared/mirrored category pool, open-position drafting,
// bot auto-pick. See build spec #4.

import { SLOTS, STARTER_SLOTS, BOT_SKILL, MIN_SEARCH_CHARS } from "./constants.js";
import { impact } from "./engine.js";

/** Groups the flat PLAYERS array into squads keyed by "Team|Decade". */
export function buildSquads(players) {
  const map = new Map();
  for (const p of players) {
    const key = `${p.team}|${p.decade}`;
    if (!map.has(key)) {
      map.set(key, { id: key, team: p.team, decade: p.decade, players: [] });
    }
    map.get(key).players.push(p);
  }
  return [...map.values()];
}

/** True if `player` can legally fill `slot` given their pos[] array.
 * The 6th-man slot ("6TH") accepts any player. */
export function isEligible(player, slot) {
  if (slot === "6TH") return true;
  return player.pos.includes(slot);
}

/** Open slots (not yet filled) for a roster-in-progress, in draft order. */
export function openSlots(roster) {
  return SLOTS.filter((s) => !roster[s]);
}

/** True if this same real player (by name) already occupies a slot on the
 * roster. Some players appear as separate squad entries across different
 * team/decade combos (e.g. LeBron James in both Cavaliers 2010s and Heat
 * 2010s) - they still can't occupy two roster slots at once. */
function rosterHasPlayerName(roster, name) {
  return Object.values(roster).some((p) => p && p.name === name);
}

/** Slots a given player could legally fill among a roster's open slots. */
export function eligibleOpenSlots(player, roster) {
  if (rosterHasPlayerName(roster, player.name)) return [];
  return openSlots(roster).filter((s) => isEligible(player, s));
}

// ---- Typed-name search (the draft board shows no visible list - you type
// a player from memory and get an autocomplete dropdown once you've typed
// enough). See resolveTypedInput() below for the tiered matching this
// enables. ----

/** Lowercases and strips punctuation that trips up naive matching -
 * "O'Neal" / "Amar'e Stoudemire" / "Abdul-Jabbar" should match on the
 * letters a player would actually type. */
function normalizeName(s) {
  return s
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/** Typo tolerance scales with query length: most real names are short
 * enough that a single typo (distance 1) is already generous - allowing 2
 * at that length starts colliding with unrelated short words (e.g. a typo
 * of "Jordan" matching the "John" in "John Paxson"). Longer queries get
 * more room since there's more string for a coincidental match to hide in. */
function maxAllowedDistance(queryLength) {
  return queryLength <= 7 ? 1 : 2;
}

/** Best (lowest) edit-distance of `query` against `fullName` - 0 means an
 * exact substring match against the full name. Otherwise compares against
 * the full name and each individual word within it (first/last/suffix),
 * skipping tokens whose length is wildly different from the query (a short
 * query shouldn't get to "edit" its way into a much longer word). This is
 * what lets a correctly-remembered-but-misspelled name still resolve
 * (testing "do you know this player," not "can you spell Szczerbiak") while
 * not accidentally matching an unrelated word that just happens to be close. */
function fuzzyMatchScore(query, fullName) {
  const q = normalizeName(query);
  const n = normalizeName(fullName);
  if (!q) return Infinity;
  if (n.includes(q)) return 0;

  let best = Infinity;
  for (const token of [n, ...n.split(" ")]) {
    if (Math.abs(token.length - q.length) > 2) continue;
    const d = levenshteinDistance(q, token);
    if (d < best) best = d;
  }
  return best;
}

function rankMatches(query, players) {
  const threshold = maxAllowedDistance(normalizeName(query).length);
  return players
    .map((p) => ({ p, score: fuzzyMatchScore(query, p.name) }))
    .filter((m) => m.score <= threshold)
    .sort((a, b) => a.score - b.score)
    .map((m) => m.p);
}

/**
 * Resolves typed input against the draft's data in tiers:
 *  - "too-short": fewer than MIN_SEARCH_CHARS typed - no search run yet
 *    (anti letter-fishing gate; also blocks brute-force enumeration of a
 *    10-player squad one letter at a time).
 *  - "in-squad": fuzzy match(es) within currentSquad.players - these are
 *    the ACTUAL objects from currentSquad.players (object identity is
 *    preserved), so they can be handed straight to makePick/submitPick.
 *  - "elsewhere": no in-squad match, but the name fuzzy-matches someone in
 *    the full dataset under a different team/decade - lets the UI say
 *    "wrong squad, not a wrong guess" using data we already have.
 *  - "none": no match anywhere in our (curated, non-exhaustive) dataset.
 */
export function resolveTypedInput(query, currentSquad, allPlayers) {
  const raw = query.trim();
  if (raw.length < MIN_SEARCH_CHARS) {
    return { tier: "too-short", candidates: [] };
  }

  const inSquad = rankMatches(raw, currentSquad.players);
  if (inSquad.length > 0) {
    return { tier: "in-squad", candidates: inSquad };
  }

  const elsewhere = rankMatches(raw, allPlayers).slice(0, 5);
  if (elsewhere.length > 0) {
    return { tier: "elsewhere", candidates: elsewhere };
  }

  return { tier: "none", candidates: [] };
}

/** The worst legal (player, slot) combo for the given roster in the
 * current squad - the mirror image of the bot's best-pick logic, used as
 * the pick-timer timeout penalty. Returns null if there's no eligible
 * combo at all (the caller should auto-skip instead, same precondition
 * as the Skip button). */
export function worstEligiblePick(squad, roster) {
  const combos = [];
  for (const player of squad.players) {
    for (const slot of eligibleOpenSlots(player, roster)) {
      combos.push({ player, slot, score: impact(player) });
    }
  }
  if (combos.length === 0) return null;
  return combos.reduce((worst, c) => (c.score < worst.score ? c : worst));
}

export class DraftState {
  constructor(allPlayers) {
    this.squads = buildSquads(allPlayers);
    this.remainingSquads = shuffle([...this.squads]);
    this.rosterA = {}; // human (or player 1)
    this.rosterB = {}; // bot (or player 2)
    this.history = [];
    this.currentSquad = null;
  }

  isComplete() {
    return openSlots(this.rosterA).length === 0 && openSlots(this.rosterB).length === 0;
  }

  /** Roll the next shared category. Both sides draft from this same squad. */
  rollNextSquad() {
    if (this.isComplete()) return null;
    if (this.remainingSquads.length === 0) {
      this.remainingSquads = shuffle(
        this.squads.filter((s) => s.id !== (this.currentSquad && this.currentSquad.id))
      );
    }
    this.currentSquad = this.remainingSquads.pop();
    return this.currentSquad;
  }

  /** True if the given roster has at least one legal (player, slot) pick
   * available in the current rolled squad. */
  hasValidPick(roster) {
    if (!this.currentSquad) return false;
    return this.currentSquad.players.some((p) => eligibleOpenSlots(p, roster).length > 0);
  }

  /** Human/manual pick: assign `player` (from the current squad) to `slot`
   * on `side` ("A" or "B"). Throws if the pick is illegal. */
  makePick(side, player, slot) {
    const roster = side === "A" ? this.rosterA : this.rosterB;
    if (!this.currentSquad || !this.currentSquad.players.includes(player)) {
      throw new Error("Player is not part of the currently rolled squad.");
    }
    if (!isEligible(player, slot) || roster[slot] || rosterHasPlayerName(roster, player.name)) {
      throw new Error(`${player.name} cannot fill slot ${slot}.`);
    }
    roster[slot] = player;
    this.history.push({ side, squad: this.currentSquad, player, slot });
  }

  /** Bot pick: usually a random legal (player, slot) combo, occasionally
   * (BOT_SKILL chance) the objectively best one. A bot that always drafts
   * optimally plays a solved game and isn't fun to face - this keeps it
   * beatable while still capable of the occasional sharp pick. */
  botAutoPick(side = "B") {
    const roster = side === "A" ? this.rosterA : this.rosterB;
    if (!this.hasValidPick(roster)) return null;
    const combos = [];
    for (const player of this.currentSquad.players) {
      for (const slot of eligibleOpenSlots(player, roster)) {
        combos.push({ player, slot, score: impact(player) });
      }
    }
    let choice;
    if (Math.random() < BOT_SKILL) {
      choice = combos.reduce((best, c) => (c.score > best.score ? c : best));
    } else {
      choice = combos[Math.floor(Math.random() * combos.length)];
    }
    this.makePick(side, choice.player, choice.slot);
    return choice;
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
