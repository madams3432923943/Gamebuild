// Draft mechanics: shared/mirrored category pool, open-position drafting,
// bot auto-pick. See build spec #4.

import { BOT_POOL_SIZE, MIN_SEARCH_CHARS } from "./constants.js";
// Slot lists are default parameter values (see ui.js). The helpers below are
// per-pick calls and go through the active sport.
import { SLOTS, STARTER_SLOTS } from "./sports/nba/constants.js";
import { activeSport } from "./sports/index.js";

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
 * Slots with no fixed position - the 6th man, and every ranked bench spot -
 * accept anyone; the engine works out which position a bench player actually
 * covers once the roster is set. Position-locked slots compare against
 * basePosition, since a player's recorded pos[] holds only bare codes. */
export function isEligible(player, slot) {
  if (slot === "6TH" || activeSport().isBenchSlot(slot)) return true;
  return player.pos.includes(activeSport().basePosition(slot));
}

/** Open slots (not yet filled) for a roster-in-progress, in draft order.
 * `slots` defaults to the full 6-slot list so any caller that doesn't know
 * about smaller rosters (Quick Play's 5-slot draft, no 6th man) keeps
 * today's behavior unchanged. */
export function openSlots(roster, slots = SLOTS) {
  return slots.filter((s) => !roster[s]);
}

/** True if this same real player (by name) already occupies a slot on the
 * roster. Some players appear as separate squad entries across different
 * team/decade combos (e.g. LeBron James in both Cavaliers 2010s and Heat
 * 2010s) - they still can't occupy two roster slots at once. */
function rosterHasPlayerName(roster, name) {
  return Object.values(roster).some((p) => p && p.name === name);
}

/** Slots a given player could legally fill among a roster's open slots. */
export function eligibleOpenSlots(player, roster, slots = SLOTS) {
  if (rosterHasPlayerName(roster, player.name)) return [];
  return openSlots(roster, slots).filter((s) => isEligible(player, s));
}

/** Every legal (player, slot) combo for `roster` in `squad`, each scored by
 * activeSport().rate() - the shared building block behind both the bot's best-pick
 * logic and the pick-timer's worst-pick timeout penalty. */
function eligibleCombos(squad, roster, slots = SLOTS) {
  const combos = [];
  for (const player of squad.players) {
    for (const slot of eligibleOpenSlots(player, roster, slots)) {
      combos.push({ player, slot, score: activeSport().rate(player) });
    }
  }
  return combos;
}

// ---- Typed-name search (the draft board shows no visible list - you type
// a player from memory and get an autocomplete dropdown once you've typed
// enough). See resolveTypedInput() below for the tiered matching this
// enables. ----

/** Lowercases and strips punctuation that trips up naive matching -
 * "O'Neal" / "Amar'e Stoudemire" / "Abdul-Jabbar" should match on the
 * letters a player would actually type. */
function normalizeName(s) {
  return (
    s
      .toLowerCase()
      // Fold accents before anything else. The dataset spells names properly -
      // Dončić, Jokić, Porziņģis, Schröder - and nobody types them that way,
      // so without this 59 players are unreachable no matter how well you
      // remember them. NFD splits a letter from its diacritic and the range
      // strips the diacritic, leaving the plain letter behind.
      //
      // It is deliberately one-way: only the comparison is folded, never the
      // stored name, so the card still reads "Luka Dončić".
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[.']/g, "")
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
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
function fuzzyMatchScore(normalizedQuery, fullName) {
  const n = normalizeName(fullName);
  if (!normalizedQuery) return Infinity;
  if (n.includes(normalizedQuery)) return 0;

  let best = Infinity;
  for (const token of [n, ...n.split(" ")]) {
    if (Math.abs(token.length - normalizedQuery.length) > 2) continue;
    const d = levenshteinDistance(normalizedQuery, token);
    if (d < best) best = d;
  }
  return best;
}

function rankMatches(query, players) {
  const normalizedQuery = normalizeName(query);
  const threshold = maxAllowedDistance(normalizedQuery.length);
  return players
    .map((p) => ({ p, score: fuzzyMatchScore(normalizedQuery, p.name) }))
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
export function worstEligiblePick(squad, roster, slots = SLOTS) {
  const combos = eligibleCombos(squad, roster, slots);
  if (combos.length === 0) return null;
  return combos.reduce((worst, c) => (c.score < worst.score ? c : worst));
}

/** Softens how much a decade's raw squad count drives how often it comes up.
 * The dataset is lopsided - the 2020s have 30 squads while the 1970s have 3 -
 * so picking a squad uniformly at random made almost half of all rounds a
 * 2020s team and the eras blurred together. Weighting each decade by the
 * square root of its size pulls the 2020s down from ~46% of rounds to ~30%
 * and lifts the 1970s from ~5% to ~9%, without swinging so far that the three
 * 1970s squads start repeating constantly (which flat per-decade weighting
 * would do). The real cure is more historical squads; this makes the pool we
 * have feel varied in the meantime. */
function decadeWeight(squadCount) {
  return Math.sqrt(squadCount);
}

function pickWeighted(entries, weightOf) {
  const total = entries.reduce((sum, e) => sum + weightOf(e), 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= weightOf(entry);
    if (roll <= 0) return entry;
  }
  return entries[entries.length - 1];
}

export class DraftState {
  /**
   * @param recentSquadIds squads seen in the last game or two. They're kept
   *   out of this draft when there's anything else to roll, so consecutive
   *   games don't keep serving the same handful of teams.
   * @param slots the roster shape this draft fills - defaults to the full
   *   6-slot list (5 starters + 6th man). Quick Play passes STARTER_SLOTS
   *   (no bench spot); a future 10-man Ranked roster passes its own list.
   *   Kept as one class rather than a per-size variant since every mode
   *   shares the exact same draft mechanics regardless of roster size.
   */
  constructor(allPlayers, recentSquadIds = [], slots = SLOTS) {
    this.squads = buildSquads(allPlayers);
    this.recentSquadIds = new Set(recentSquadIds);
    this.usedSquadIds = new Set();
    this.slots = slots;
    this.rosterA = {}; // human
    this.rosterB = {}; // bot
    this.history = [];
    this.currentSquad = null;
  }

  isComplete() {
    return openSlots(this.rosterA, this.slots).length === 0 && openSlots(this.rosterB, this.slots).length === 0;
  }

  /** Roll the next shared category. Both sides draft from this same squad.
   * Never repeats a squad within a game, prefers squads the player hasn't
   * just seen, and balances eras via decadeWeight above. */
  rollNextSquad() {
    if (this.isComplete()) return null;

    const unused = this.squads.filter((s) => !this.usedSquadIds.has(s.id));
    if (unused.length === 0) return null;

    // Skip recently-seen squads unless that would leave nothing to pick.
    const fresh = unused.filter((s) => !this.recentSquadIds.has(s.id));
    const candidates = fresh.length > 0 ? fresh : unused;

    const byDecade = new Map();
    for (const squad of candidates) {
      if (!byDecade.has(squad.decade)) byDecade.set(squad.decade, []);
      byDecade.get(squad.decade).push(squad);
    }

    const decades = [...byDecade.values()];
    const chosenDecade = pickWeighted(decades, (group) => decadeWeight(group.length));
    const chosen = chosenDecade[Math.floor(Math.random() * chosenDecade.length)];

    this.usedSquadIds.add(chosen.id);
    this.currentSquad = chosen;
    return this.currentSquad;
  }

  /** True if the given roster has at least one legal (player, slot) pick
   * available in the current rolled squad. */
  hasValidPick(roster) {
    if (!this.currentSquad) return false;
    return this.currentSquad.players.some((p) => eligibleOpenSlots(p, roster, this.slots).length > 0);
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

  /** Bot pick: one of the BOT_POOL_SIZE best legal (player, slot) combos,
   * chosen uniformly - so each has an equal (1-in-5, by default) shot.
   *
   * This used to take the single best combo most of the time and a fully
   * random one otherwise, which made the bot swing between perfect and
   * careless. Always drafting from the top of the board keeps it credible,
   * while never insisting on the very best pick leaves a knowledgeable
   * drafter room to win the draft outright - the difficulty comes from the
   * width of the pool, which is one number to tune.
   *
   * Fewer than BOT_POOL_SIZE legal combos left (late rounds, thin squads)
   * just means a narrower pool, not a crash. */
  botAutoPick(side = "B") {
    const roster = side === "A" ? this.rosterA : this.rosterB;
    if (!this.hasValidPick(roster)) return null;
    const combos = eligibleCombos(this.currentSquad, roster, this.slots);
    const pool = [...combos].sort((a, b) => b.score - a.score).slice(0, BOT_POOL_SIZE);
    const choice = pool[Math.floor(Math.random() * pool.length)];
    this.makePick(side, choice.player, choice.slot);
    return choice;
  }
}
