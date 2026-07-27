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

/** Every legal (player, slot) combo for `roster` in `squad`, each scored by
 * impact() - the shared building block behind both the bot's best-pick
 * logic and the pick-timer's worst-pick timeout penalty. */
function eligibleCombos(squad, roster) {
  const combos = [];
  for (const player of squad.players) {
    for (const slot of eligibleOpenSlots(player, roster)) {
      combos.push({ player, slot, score: impact(player) });
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
export function worstEligiblePick(squad, roster) {
  const combos = eligibleCombos(squad, roster);
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
   */
  constructor(allPlayers, recentSquadIds = []) {
    this.squads = buildSquads(allPlayers);
    this.recentSquadIds = new Set(recentSquadIds);
    this.usedSquadIds = new Set();
    this.rosterA = {}; // human
    this.rosterB = {}; // bot
    this.history = [];
    this.currentSquad = null;
  }

  isComplete() {
    return openSlots(this.rosterA).length === 0 && openSlots(this.rosterB).length === 0;
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
    const combos = eligibleCombos(this.currentSquad, roster);
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
