// Draft mechanics: shared/mirrored category pool, open-position drafting,
// bot auto-pick. See build spec #4.

import { SLOTS, STARTER_SLOTS, BOT_SKILL } from "./constants.js";
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
