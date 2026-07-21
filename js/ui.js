// Rendering helpers. Pure-ish functions: given data + a container element
// (and callbacks), they redraw that container's contents.

import { SLOTS } from "./constants.js";
import { eligibleOpenSlots } from "./draft.js";
import { currentTier, nextTier } from "./progression.js";

const SLOT_LABELS = { PG: "PG", SG: "SG", SF: "SF", PF: "PF", C: "C", "6TH": "6th Man" };
const LINE_LABELS = { pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK", tov: "TOV" };

export function renderRosterPanel(container, roster, label, isTurn) {
  container.innerHTML = "";
  const h3 = document.createElement("h3");
  h3.textContent = label + (isTurn ? " •" : "");
  container.appendChild(h3);

  for (const slot of SLOTS) {
    const row = document.createElement("div");
    row.className = "roster-slot";
    const tag = document.createElement("span");
    tag.className = "slot-tag";
    tag.textContent = SLOT_LABELS[slot];
    row.appendChild(tag);

    const value = document.createElement("span");
    const player = roster[slot];
    if (player) {
      value.className = "slot-filled";
      value.textContent = `${player.name} (${player.team} ${player.decade})`;
    } else {
      value.className = "slot-empty";
      value.textContent = "open";
    }
    row.appendChild(value);
    container.appendChild(row);
  }
}

function statLine(p) {
  return `${p.ppg.toFixed(1)} PPG · ${p.rpg.toFixed(1)} RPG · ${p.apg.toFixed(1)} APG · ${p.spg.toFixed(1)} SPG · ${p.bpg.toFixed(1)} BPG · ${p.tov.toFixed(1)} TOV`;
}

/**
 * Renders the current squad's player pool. `onPick(player)` fires when a
 * player card is clicked; the caller decides (via slot count) whether to
 * apply the pick directly or show the slot-picker chip UI.
 */
export function renderPool(container, squad, filterText, roster, onPick) {
  container.innerHTML = "";
  const filter = filterText.trim().toLowerCase();
  const players = squad.players.filter((p) => p.name.toLowerCase().includes(filter));

  if (players.length === 0) {
    const empty = document.createElement("div");
    empty.className = "player-stats";
    empty.textContent = "No players match that search.";
    container.appendChild(empty);
    return;
  }

  for (const p of players) {
    const slots = eligibleOpenSlots(p, roster);
    const card = document.createElement("div");
    card.className = "player-card" + (slots.length === 0 ? " disabled" : "");

    const top = document.createElement("div");
    top.className = "player-card-top";
    const name = document.createElement("span");
    name.textContent = p.name;
    for (const pos of p.pos) {
      const chip = document.createElement("span");
      chip.className = "pos-chip";
      chip.textContent = pos;
      name.appendChild(chip);
    }
    top.appendChild(name);
    card.appendChild(top);

    const stats = document.createElement("div");
    stats.className = "player-stats";
    stats.textContent = statLine(p);
    card.appendChild(stats);

    if (slots.length > 0) {
      card.addEventListener("click", () => onPick(p));
    }
    container.appendChild(card);
  }
}

/** Renders the slot-choice chip UI for a multi-eligible player. */
export function renderSlotPicker(container, player, slots, onChooseSlot) {
  container.innerHTML = "";
  container.classList.remove("hidden");

  const title = document.createElement("div");
  title.className = "slot-picker-title";
  title.textContent = `${player.name} is eligible for multiple open slots — choose one:`;
  container.appendChild(title);

  const row = document.createElement("div");
  row.className = "chip-row";
  for (const slot of slots) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = SLOT_LABELS[slot];
    chip.addEventListener("click", () => onChooseSlot(slot));
    row.appendChild(chip);
  }
  container.appendChild(row);
}

export function hideSlotPicker(container) {
  container.classList.add("hidden");
  container.innerHTML = "";
}

function r(n) {
  return Math.max(0, Math.round(n));
}

function boxRow(slotLabel, player, line) {
  return `<tr><td>${slotLabel}</td><td>${player.name}</td><td>${r(line.pts)}</td><td>${r(line.reb)}</td><td>${r(line.ast)}</td><td>${r(line.stl)}</td><td>${r(line.blk)}</td><td>${r(line.tov)}</td></tr>`;
}

function boxTable(roster, box, teamLabel) {
  let html = `<div class="team-heading">${teamLabel}</div><table class="box-table"><thead><tr><th>Slot</th><th>Player</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TOV</th></tr></thead><tbody>`;
  for (const slot of SLOTS) {
    html += boxRow(SLOT_LABELS[slot], roster[slot], box[slot]);
  }
  html += "</tbody></table>";
  return html;
}

export function renderFullBoxScore(container, rosterA, boxA, labelA, rosterB, boxB, labelB) {
  container.innerHTML = boxTable(rosterA, boxA, labelA) + boxTable(rosterB, boxB, labelB);
}

export function renderQuarterTabs(container, quarterBoxScores, onSelect, activeIndex) {
  container.innerHTML = "";
  quarterBoxScores.forEach((q, i) => {
    const tab = document.createElement("div");
    tab.className = "quarter-tab" + (i === activeIndex ? " active" : "");
    tab.textContent = q.overtime ? `OT${i - 3}` : `Q${i + 1}`;
    tab.addEventListener("click", () => onSelect(i));
    container.appendChild(tab);
  });
}

export function renderQuarterPanel(container, quarterEntry, rosterA, labelA, rosterB, labelB) {
  container.innerHTML =
    boxTable(rosterA, quarterEntry.a, labelA) + boxTable(rosterB, quarterEntry.b, labelB);
}

export function renderTierSummary(container, wins) {
  const tier = currentTier(wins);
  const next = nextTier(wins);
  container.innerHTML = "";

  const badge = document.createElement("div");
  badge.className = "tier-badge";
  badge.textContent = tier.name;
  container.appendChild(badge);

  const track = document.createElement("div");
  track.className = "progress-bar-track";
  const fill = document.createElement("div");
  fill.className = "progress-bar-fill";
  const pct = next ? Math.min(100, (100 * (wins - tier.minWins)) / (next.minWins - tier.minWins)) : 100;
  fill.style.width = `${pct}%`;
  track.appendChild(fill);
  container.appendChild(track);

  const caption = document.createElement("div");
  caption.className = "player-stats";
  caption.textContent = next
    ? `${wins} wins — ${next.minWins - wins} more to reach ${next.name}`
    : `${wins} wins — you've reached the top tier, Legend.`;
  container.appendChild(caption);
}

export function renderLeaderboard(tierContainer, bodyContainer, state) {
  renderTierSummary(tierContainer, state.wins);

  bodyContainer.innerHTML = "";
  for (const entry of state.history) {
    const tr = document.createElement("tr");
    tr.className = entry.won ? "win-row" : "loss-row";
    const date = new Date(entry.date).toLocaleDateString();
    tr.innerHTML = `<td>${date}</td><td>${entry.won ? "Win" : "Loss"} vs ${entry.opponentLabel}</td><td>${entry.scoreFor}-${entry.scoreAgainst}</td><td>${entry.mvpName}</td><td>${entry.tier}</td>`;
    bodyContainer.appendChild(tr);
  }
}
