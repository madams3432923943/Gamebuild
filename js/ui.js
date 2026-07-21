// Rendering helpers. Pure-ish functions: given data + a container element
// (and callbacks), they redraw that container's contents.

import { SLOTS } from "./constants.js";
import { eligibleOpenSlots } from "./draft.js";
import { currentTier, nextTier, mostDraftedPlayer } from "./profile.js";

const SLOT_LABELS = { PG: "PG", SG: "SG", SF: "SF", PF: "PF", C: "C", "6TH": "6th Man" };
const LINE_KEYS = ["pts", "reb", "ast", "stl", "blk", "tov"];

export function renderPositionSelector(container, roster, selectedSlot, onSelect) {
  container.innerHTML = "";
  for (const slot of SLOTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "position-btn" + (slot === selectedSlot ? " selected" : "");
    const filled = !!roster[slot];
    btn.textContent = filled ? `${SLOT_LABELS[slot]} ✓` : SLOT_LABELS[slot];
    btn.disabled = filled;
    if (!filled) btn.addEventListener("click", () => onSelect(slot));
    container.appendChild(btn);
  }
}

/**
 * @param opts.pendingSlots slots filled this round but not yet revealed
 *   (rendered as "locked in" rather than the real player).
 * @param opts.revealSlots slots that should play the flip-reveal animation
 *   on this render pass (the round that just resolved).
 */
export function renderRosterPanel(container, roster, label, isTurn, opts = {}) {
  const { pendingSlots = [], revealSlots = [] } = opts;
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
    if (player && pendingSlots.includes(slot)) {
      value.className = "slot-locked";
      value.textContent = "🔒 Locked in";
    } else if (player) {
      value.className = "slot-filled" + (revealSlots.includes(slot) ? " slot-reveal" : "");
      value.textContent = `${player.name} (${player.team} ${player.decade})`;
    } else {
      value.className = "slot-empty";
      value.textContent = "open";
    }
    row.appendChild(value);
    container.appendChild(row);
  }
}

/**
 * Renders the current squad's player pool - names and positions only, no
 * stats (the whole point is drafting on real basketball knowledge).
 * `onPick(player)` fires when an eligible-for-`selectedSlot` card is clicked.
 */
export function renderPool(container, squad, filterText, roster, selectedSlot, onPick) {
  container.innerHTML = "";
  const filter = filterText.trim().toLowerCase();
  const players = squad.players.filter((p) => p.name.toLowerCase().includes(filter));

  if (players.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "No players match that search.";
    container.appendChild(empty);
    return;
  }

  for (const p of players) {
    const eligible = eligibleOpenSlots(p, roster).includes(selectedSlot);
    const card = document.createElement("div");
    card.className = "player-card" + (eligible ? "" : " disabled");

    const name = document.createElement("span");
    name.className = "player-card-name";
    name.textContent = p.name;
    for (const pos of p.pos) {
      const chip = document.createElement("span");
      chip.className = "pos-chip";
      chip.textContent = pos;
      name.appendChild(chip);
    }
    card.appendChild(name);

    if (eligible) {
      card.addEventListener("click", () => onPick(p));
    }
    container.appendChild(card);
  }
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

/** Live quarter-by-quarter scoreboard - a running score display, not a
 * detailed per-quarter stat table. `periodLabel` e.g. "Q2" or "Final". */
export function renderScoreboard(container, labelA, scoreA, labelB, scoreB, periodLabel, isLive) {
  container.innerHTML = "";
  const teams = document.createElement("div");
  teams.className = "scoreboard-teams";
  teams.innerHTML = `
    <span class="scoreboard-team-name">${labelA}</span>
    <span class="scoreboard-score">${Math.round(scoreA)}</span>
    <span class="scoreboard-dash">–</span>
    <span class="scoreboard-score">${Math.round(scoreB)}</span>
    <span class="scoreboard-team-name">${labelB}</span>
  `;
  container.appendChild(teams);

  const period = document.createElement("div");
  period.className = "scoreboard-period" + (isLive ? " live" : "");
  period.textContent = periodLabel;
  container.appendChild(period);
}

export function renderTierSummary(badgeContainer, captionContainer, onlineWins) {
  const tier = currentTier(onlineWins);
  const next = nextTier(onlineWins);

  badgeContainer.innerHTML = "";
  const badge = document.createElement("span");
  badge.className = "tier-badge";
  badge.textContent = tier.name;
  badgeContainer.appendChild(badge);

  const track = document.createElement("div");
  track.className = "progress-bar-track";
  const fill = document.createElement("div");
  fill.className = "progress-bar-fill";
  const pct = next ? Math.min(100, (100 * (onlineWins - tier.minWins)) / (next.minWins - tier.minWins)) : 100;
  fill.style.width = `${pct}%`;
  track.appendChild(fill);
  badgeContainer.appendChild(track);

  captionContainer.textContent = next
    ? `${onlineWins} online wins — ${next.minWins - onlineWins} more to reach ${next.name}`
    : `${onlineWins} online wins — you've reached the top tier, Legend.`;
}

export function renderProfileScreen(refs, profile) {
  refs.usernameInput.value = profile.username || "";
  renderTierSummary(refs.tierBadge, refs.tierCaption, profile.onlineWins);

  refs.onlineRecord.textContent = `${profile.onlineWins}-${profile.onlineLosses}`;
  refs.offlineRecord.textContent = `${profile.offlineWins}-${profile.offlineLosses}`;

  const top = mostDraftedPlayer(profile);
  refs.mostDrafted.innerHTML = top
    ? `<div class="performance-row"><span>${top.name}</span><span class="performance-line">${top.count}x drafted</span></div>`
    : `<div class="empty-note">Play a draft to start tracking this.</div>`;

  refs.topPerformances.innerHTML = "";
  if (profile.topPerformances.length === 0) {
    refs.topPerformances.innerHTML = `<div class="empty-note">No games played yet.</div>`;
  } else {
    for (const perf of profile.topPerformances.slice(0, 5)) {
      const row = document.createElement("div");
      row.className = "performance-row";
      const line = perf.line || {};
      row.innerHTML = `<span>${perf.playerName}</span><span class="performance-line">${r(line.pts)}/${r(line.reb)}/${r(line.ast)} — vs ${perf.opponentLabel}</span>`;
      refs.topPerformances.appendChild(row);
    }
  }

  refs.historyBody.innerHTML = "";
  for (const entry of profile.history) {
    const tr = document.createElement("tr");
    tr.className = entry.won ? "win-row" : "loss-row";
    const date = new Date(entry.date).toLocaleDateString();
    const modeTag = entry.mode === "online" ? "Online" : "Offline";
    tr.innerHTML = `<td>${date}</td><td>${entry.won ? "Win" : "Loss"} vs ${entry.opponentLabel} (${modeTag})</td><td>${entry.scoreFor}-${entry.scoreAgainst}</td><td>${entry.mvpName}</td>`;
    refs.historyBody.appendChild(tr);
  }
}
