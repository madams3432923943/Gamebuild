// Rendering helpers. Pure-ish functions: given data + a container element
// (and callbacks), they redraw that container's contents.

import { SLOTS, MIN_SEARCH_CHARS } from "./constants.js";
import { eligibleOpenSlots, resolveTypedInput } from "./draft.js";
import { currentTier, nextTier, mostDraftedPlayer, STAT_LABELS, FEATURED_BADGE_SLOTS } from "./profile.js";
import { badgesForSport, badgeProgress, badgeSummary, badgeById } from "./badges.js";
import { FRANCHISES, BANNER_THRESHOLD, bannerProgress, bannerSummary, franchiseById } from "./banners.js";
import { TACTICS } from "./tactics.js";

const SLOT_LABELS = { PG: "PG", SG: "SG", SF: "SF", PF: "PF", C: "C", "6TH": "6th Man" };
const LINE_KEYS = ["pts", "reb", "ast", "stl", "blk", "tov"];

/**
 * @param eligibleSlotsForPendingPlayer null when no player is pending yet
 *   (all slots shown as plain status, none clickable) - or an array of the
 *   pending player's eligible open slots (those glow and are clickable;
 *   other open slots dim since they don't apply to this player).
 */
export function renderPositionSelector(container, roster, eligibleSlotsForPendingPlayer, onSelect) {
  container.innerHTML = "";
  for (const slot of SLOTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    const filled = !!roster[slot];
    let className = "position-btn";
    let clickable = false;

    if (filled) {
      btn.textContent = `${SLOT_LABELS[slot]} ✓`;
    } else {
      btn.textContent = SLOT_LABELS[slot];
      if (eligibleSlotsForPendingPlayer) {
        if (eligibleSlotsForPendingPlayer.includes(slot)) {
          className += " eligible";
          clickable = true;
        } else {
          className += " awaiting-dim";
        }
      }
    }
    btn.className = className;
    btn.disabled = !clickable;
    if (clickable) btn.addEventListener("click", () => onSelect(slot));
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

/** Renders one clickable (or disabled) player card - unchanged visuals from
 * the old always-visible pool, just factored out so both the "in-squad"
 * match tier and any future reuse can share it. */
function renderPlayerCard(container, p, roster, pendingPlayerName, onPick, showStats = false) {
  const slots = eligibleOpenSlots(p, roster);
  const eligible = slots.length > 0;
  const card = document.createElement("div");
  card.className =
    "player-card" +
    (eligible ? "" : " disabled") +
    (p.name === pendingPlayerName ? " pending" : "") +
    (showStats ? " with-stats" : "");

  const name = document.createElement("span");
  name.className = "player-card-name";
  name.textContent = p.name;
  for (const pos of p.pos) {
    const chip = document.createElement("span");
    chip.className = "pos-chip";
    chip.textContent = pos;
    name.appendChild(chip);
  }

  if (showStats) {
    // Practice mode is for learning the pool, so the numbers that drive the
    // simulation are on the table rather than hidden.
    const wrap = document.createElement("div");
    wrap.appendChild(name);
    const stats = document.createElement("div");
    stats.className = "player-stats";
    stats.textContent = `${p.ppg} pts · ${p.rpg} reb · ${p.apg} ast · ${p.spg} stl · ${p.bpg} blk`;
    wrap.appendChild(stats);
    card.appendChild(wrap);
  } else {
    card.appendChild(name);
  }

  if (eligible) {
    card.addEventListener("click", () => onPick(p));
  }
  container.appendChild(card);
}

function renderNote(container, text, tierClass) {
  const note = document.createElement("div");
  note.className = "empty-note" + (tierClass ? ` ${tierClass}` : "");
  note.textContent = text;
  container.appendChild(note);
}

/**
 * Renders the current squad's search results - no default visible list.
 * You type a player from memory; nothing appears until MIN_SEARCH_CHARS
 * letters are typed, and then the tiered result from resolveTypedInput()
 * decides what shows:
 *  - in-squad match(es): real clickable player cards, same as before.
 *  - elsewhere match: an honest "wrong squad" note naming where that real
 *    player IS in our data, instead of a flat (and misleading) "no match."
 *  - no match anywhere: an honest "not in our database" note.
 * `onPick(player)` fires on click of an eligible in-squad card, same
 * contract as before. `allPlayers` is the full dataset, used only for the
 * "elsewhere" lookup.
 */
export function renderPool(container, squad, filterText, roster, pendingPlayerName, onPick, allPlayers, ruleset = "strict") {
  container.innerHTML = "";

  // Easy practice puts the whole squad on screen with stats - it's for
  // learning the pool, not testing recall. The search box still narrows the
  // list, it just isn't the only way to see anyone.
  if (ruleset === "easy") {
    const q = filterText.trim().toLowerCase();
    const players = q ? squad.players.filter((p) => p.name.toLowerCase().includes(q)) : squad.players;
    if (players.length === 0) {
      renderNote(container, "No players on this squad match that search.");
      return;
    }
    for (const p of players) {
      renderPlayerCard(container, p, roster, pendingPlayerName, onPick, true);
    }
    return;
  }

  const result = resolveTypedInput(filterText, squad, allPlayers);

  if (result.tier === "too-short") {
    const text =
      filterText.trim().length === 0
        ? `Type a player's name from memory (${MIN_SEARCH_CHARS}+ letters) to search this squad.`
        : `Keep typing — ${MIN_SEARCH_CHARS}+ letters needed to search.`;
    renderNote(container, text);
    return;
  }

  if (result.tier === "in-squad") {
    for (const p of result.candidates) {
      renderPlayerCard(container, p, roster, pendingPlayerName, onPick);
    }
    return;
  }

  if (result.tier === "elsewhere") {
    const named = result.candidates.map((p) => `${p.name} (${p.team} ${p.decade})`).join(", ");
    renderNote(
      container,
      `Not on this squad. We do have ${named} — wrong team/decade for this pick, not a wrong guess.`,
      "pool-elsewhere-note"
    );
    return;
  }

  renderNote(container, "No player by that name in our database. Try another name or spelling.", "pool-none-note");
}

/** Countdown display for the per-pick timer. Switches to a "buzzer" warning
 * style in the final stretch so the pressure is visible, not just numeric. */
export function renderPickTimer(container, secondsRemaining) {
  container.textContent = `⏱ ${secondsRemaining}s`;
  container.classList.toggle("timer-warning", secondsRemaining <= 5);
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

/**
 * NBA broadcast-style scoreboard: a big score up top, and a quarter-by-
 * quarter grid underneath that fills in as periods complete.
 * @param periods array of {label, a, b} for periods played so far
 * @param periodsRemaining count of regulation periods not yet played (shown
 *   as "-" placeholder columns, e.g. 4 at tip-off, 0 once Q4 is in)
 */
export function renderScoreboard(container, labelA, labelB, periods, periodsRemaining, totalA, totalB, statusLabel, isLive) {
  container.innerHTML = "";

  const teams = document.createElement("div");
  teams.className = "scoreboard-teams";
  teams.innerHTML = `
    <span class="scoreboard-team-name">${labelA}</span>
    <span class="scoreboard-score">${Math.round(totalA)}</span>
    <span class="scoreboard-dash">–</span>
    <span class="scoreboard-score">${Math.round(totalB)}</span>
    <span class="scoreboard-team-name">${labelB}</span>
  `;
  container.appendChild(teams);

  const period = document.createElement("div");
  period.className = "scoreboard-period" + (isLive ? " live" : "");
  period.textContent = statusLabel;
  container.appendChild(period);

  const headerCells = periods.map((p, i) => `<th${i === periods.length - 1 && isLive ? ' class="period-current"' : ""}>${p.label}</th>`).join("");
  const pendingCells = Array.from({ length: periodsRemaining }, () => `<th>–</th>`).join("");

  const rowCells = (key) =>
    periods.map((p) => `<td>${Math.round(p[key])}</td>`).join("") +
    Array.from({ length: periodsRemaining }, () => `<td class="period-pending">–</td>`).join("");

  const grid = document.createElement("table");
  grid.className = "scoreboard-grid";
  grid.innerHTML = `
    <thead><tr><th class="team-col"></th>${headerCells}${pendingCells}<th>T</th></tr></thead>
    <tbody>
      <tr><td class="team-col">${labelA}</td>${rowCells("a")}<td class="grid-total">${Math.round(totalA)}</td></tr>
      <tr><td class="team-col">${labelB}</td>${rowCells("b")}<td class="grid-total">${Math.round(totalB)}</td></tr>
    </tbody>
  `;
  container.appendChild(grid);
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

/** Sports the home screen advertises. Only NBA is playable; the rest show
 * their locked state so the roadmap is visible rather than hidden. */
const SPORTS = [
  { id: "nba", name: "NBA", icon: "🏀", live: true },
  { id: "nfl", name: "NFL", icon: "🏈", live: false },
  { id: "nhl", name: "NHL", icon: "🏒", live: false },
  { id: "soccer", name: "Soccer", icon: "⚽", live: false },
];

/** Home-screen header: who you are, plus your rank in each sport. This is the
 * first thing on the page now, so the profile leads the experience instead of
 * being buried behind a tab. */
export function renderHomeHeader(refs, profile) {
  refs.username.textContent = profile.username || "Player";

  // The banner's own colours wash the card behind the name. Falls back to the
  // brand accent when nothing is equipped, so the layout never depends on
  // having earned something.
  const franchise = profile.equippedBanner ? franchiseById(profile.equippedBanner) : null;
  const [c1, c2] = franchise ? franchise.colors : ["#2f6fe0", "#0d1117"];
  refs.card.style.background = `linear-gradient(135deg, ${c1}55 0%, ${c2}33 45%, transparent 100%), var(--panel)`;
  refs.card.style.borderColor = franchise ? `${c1}aa` : "";

  const rankName = currentTier(profile.onlineWins).name;
  refs.record.innerHTML = "";
  const parts = [
    { label: "Ranked", value: `${profile.onlineWins}-${profile.onlineLosses}` },
    { label: "Rank", value: rankName },
    {
      label: "Games",
      value: String(profile.onlineWins + profile.onlineLosses + profile.offlineWins + profile.offlineLosses),
    },
  ];
  for (const part of parts) {
    const stat = document.createElement("div");
    stat.className = "pb-stat";
    stat.innerHTML = `<span class="pb-stat-value"></span><span class="pb-stat-label"></span>`;
    stat.querySelector(".pb-stat-value").textContent = part.value;
    stat.querySelector(".pb-stat-label").textContent = part.label;
    refs.record.appendChild(stat);
  }

  renderFeaturedBadges(refs.featured, profile);

  refs.rankStrip.innerHTML = "";
  for (const sport of SPORTS) {
    const chip = document.createElement("div");
    chip.className = "rank-chip" + (sport.live ? "" : " locked");

    const icon = document.createElement("span");
    icon.className = "rank-chip-icon";
    icon.textContent = sport.icon;
    chip.appendChild(icon);

    const label = document.createElement("span");
    label.className = "rank-chip-sport";
    label.textContent = sport.name;
    chip.appendChild(label);

    const rank = document.createElement("span");
    rank.className = "rank-chip-rank";
    // Rank tracks online wins only - see the TIERS comment in profile.js for
    // why practice games don't move it.
    rank.textContent = sport.live ? currentTier(profile.onlineWins).name : "Coming soon";
    chip.appendChild(rank);

    refs.rankStrip.appendChild(chip);
  }
}

/**
 * Badge collection. Each badge ranks up through tiers rather than flipping
 * from locked to unlocked once, so an unearned badge still shows what it
 * tracks and how far along you are.
 */
/** The up-to-three badges a player chose to show off on their banner. Empty
 * slots are drawn as outlines so the feature reads as "you can fill these"
 * rather than looking broken. */
function renderFeaturedBadges(container, profile) {
  container.innerHTML = "";
  const ids = (profile.featuredBadges || []).slice(0, FEATURED_BADGE_SLOTS);

  for (let i = 0; i < FEATURED_BADGE_SLOTS; i++) {
    const id = ids[i];
    const badge = id ? badgeById(id) : null;
    const slot = document.createElement("div");
    slot.className = "pb-badge" + (badge ? "" : " empty");

    if (badge) {
      const progress = badgeProgress(badge, profile);
      slot.title = `${badge.name}${progress.tier ? ` — ${progress.tier.name}` : ""}`;
      const icon = document.createElement("span");
      icon.className = "pb-badge-icon";
      icon.textContent = badge.icon;
      slot.appendChild(icon);
      const tier = document.createElement("span");
      tier.className = "pb-badge-tier";
      tier.textContent = progress.tier ? progress.tier.icon : "";
      slot.appendChild(tier);
    } else {
      slot.textContent = "+";
      slot.title = "Feature a badge from the Badges tab";
    }
    container.appendChild(slot);
  }
}

/** Sport subtabs for the badges screen. Sports with no badges yet still get
 * a tab so the roadmap is visible, but it's marked locked and says so when
 * opened rather than showing a confusing empty grid. */
export function renderBadgeSportTabs(container, activeSport, onSelect) {
  container.innerHTML = "";
  for (const sport of SPORTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "subtab" + (sport.id === activeSport ? " active" : "") + (sport.live ? "" : " locked");
    btn.textContent = `${sport.icon} ${sport.name}`;
    btn.addEventListener("click", () => onSelect(sport.id));
    container.appendChild(btn);
  }
}

export function renderBadgeCollection(container, summaryEl, profile, sport = "nba", onToggleFeature) {
  const list = badgesForSport(sport);
  container.innerHTML = "";

  if (list.length === 0) {
    const name = (SPORTS.find((s) => s.id === sport) || {}).name || sport;
    summaryEl.textContent = `${name} badges arrive with ${name} drafts.`;
    renderNote(container, `No ${name} badges yet — this sport isn't playable at the moment.`);
    return;
  }

  const { earned, maxed, total } = badgeSummary(profile, sport);
  summaryEl.textContent = `${earned} of ${total} badges earned${maxed > 0 ? ` · ${maxed} at Hall of Fame` : ""}`;

  for (const badge of list) {
    const progress = badgeProgress(badge, profile);
    const earnedIt = progress.tierIndex >= 0;

    const tile = document.createElement("div");
    tile.className = "badge-tile" + (earnedIt ? "" : " locked");

    const head = document.createElement("div");
    head.className = "badge-head";

    const icon = document.createElement("span");
    icon.className = "badge-icon";
    icon.textContent = badge.icon;
    head.appendChild(icon);

    const titles = document.createElement("div");
    const name = document.createElement("div");
    name.className = "badge-name";
    name.textContent = badge.name;
    titles.appendChild(name);

    const tier = document.createElement("div");
    tier.className = "badge-tier";
    tier.textContent = earnedIt ? `${progress.tier.icon} ${progress.tier.name}` : "Not earned yet";
    titles.appendChild(tier);
    head.appendChild(titles);
    tile.appendChild(head);

    const blurb = document.createElement("div");
    blurb.className = "badge-blurb";
    blurb.textContent = badge.blurb;
    tile.appendChild(blurb);

    const track = document.createElement("div");
    track.className = "progress-bar-track";
    const fill = document.createElement("div");
    fill.className = "progress-bar-fill";
    fill.style.width = `${progress.percent}%`;
    track.appendChild(fill);
    tile.appendChild(track);

    const caption = document.createElement("div");
    caption.className = "badge-progress";
    caption.textContent = progress.next
      ? `${r(progress.value)} / ${progress.next.threshold} ${badge.unit} to ${progress.next.tier.name}`
      : `${r(progress.value)} ${badge.unit} — maxed out`;
    tile.appendChild(caption);

    // Only earned badges can be shown off - featuring one you haven't earned
    // would say nothing about you.
    if (earnedIt && onToggleFeature) {
      const featured = (profile.featuredBadges || []).includes(badge.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-secondary badge-feature" + (featured ? " is-featured" : "");
      btn.textContent = featured ? "On your banner" : "Feature";
      btn.addEventListener("click", () => onToggleFeature(badge.id));
      tile.appendChild(btn);
    }

    container.appendChild(tile);
  }
}

/** One franchise banner: a two-tone flag with the team's abbreviation. The
 * look comes entirely from the franchise entry's colors, so every team gets
 * artwork without a single commissioned asset - and with no player likeness
 * anywhere near it. */
function bannerArt(franchise, opts = {}) {
  const el = document.createElement("div");
  el.className = "banner-art" + (opts.small ? " small" : "");
  el.style.background = `linear-gradient(135deg, ${franchise.colors[0]} 0%, ${franchise.colors[0]} 55%, ${franchise.colors[1]} 55%, ${franchise.colors[1]} 100%)`;
  const abbr = document.createElement("span");
  abbr.className = "banner-abbr";
  abbr.textContent = franchise.abbr;
  el.appendChild(abbr);
  return el;
}

/** The equipped banner shown on the home header. Returns null when nothing
 * is equipped so the caller can leave the slot empty. */
export function renderEquippedBanner(container, profile) {
  container.innerHTML = "";
  const franchise = profile.equippedBanner ? franchiseById(profile.equippedBanner) : null;
  container.hidden = !franchise;
  if (!franchise) return;
  container.appendChild(bannerArt(franchise, { small: true }));
  const label = document.createElement("span");
  label.className = "banner-flying";
  label.textContent = franchise.name;
  container.appendChild(label);
}

/**
 * The banner collection. Locked banners still show the franchise and how far
 * along you are - a reward you can't see the shape of isn't motivating.
 */
export function renderBanners(container, summaryEl, profile, onEquip) {
  const { unlocked, total } = bannerSummary(profile);
  summaryEl.textContent =
    `${unlocked} of ${total} banners unlocked · draft ${BANNER_THRESHOLD} players from a franchise across ranked wins` +
    " (practice doesn't count)";

  container.innerHTML = "";
  for (const franchise of FRANCHISES) {
    const progress = bannerProgress(franchise, profile);
    const equipped = profile.equippedBanner === franchise.id;

    const tile = document.createElement("div");
    tile.className = "banner-tile" + (progress.unlocked ? "" : " locked") + (equipped ? " equipped" : "");
    tile.appendChild(bannerArt(franchise));

    const name = document.createElement("div");
    name.className = "banner-name";
    name.textContent = franchise.name;
    tile.appendChild(name);

    const track = document.createElement("div");
    track.className = "progress-bar-track";
    const fill = document.createElement("div");
    fill.className = "progress-bar-fill";
    fill.style.width = `${progress.percent}%`;
    track.appendChild(fill);
    tile.appendChild(track);

    const caption = document.createElement("div");
    caption.className = "banner-progress";
    caption.textContent = progress.unlocked
      ? equipped
        ? "Flying now"
        : "Unlocked"
      : `${progress.drafted} / ${progress.required} in ranked wins`;
    tile.appendChild(caption);

    if (progress.unlocked) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-secondary banner-equip";
      btn.textContent = equipped ? "Take down" : "Fly this";
      btn.addEventListener("click", () => onEquip(equipped ? null : franchise.id));
      tile.appendChild(btn);
    }

    container.appendChild(tile);
  }
}

export function renderProfileScreen(refs, profile) {
  refs.usernameInput.value = profile.username || "";
  renderTierSummary(refs.tierBadge, refs.tierCaption, profile.onlineWins);

  refs.onlineRecord.textContent = `${profile.onlineWins}-${profile.onlineLosses}`;
  refs.offlineRecord.textContent = `${profile.offlineWins}-${profile.offlineLosses}`;
  // Practice games don't move rank, but they are still games you played, so
  // the total counts every mode.
  refs.totalGames.textContent = String(
    profile.onlineWins + profile.onlineLosses + profile.offlineWins + profile.offlineLosses
  );

  const top = mostDraftedPlayer(profile);
  refs.mostDrafted.innerHTML = top
    ? `<div class="performance-row"><span>${top.name}</span><span class="performance-line">${top.count}x drafted</span></div>`
    : `<div class="empty-note">Play a draft to start tracking this.</div>`;

  refs.topPerformances.innerHTML = "";
  const bestKeys = Object.keys(STAT_LABELS);
  const anyBests = bestKeys.some((k) => profile.personalBests[k]);
  if (!anyBests) {
    refs.topPerformances.innerHTML = `<div class="empty-note">No games played yet.</div>`;
  } else {
    for (const key of bestKeys) {
      const best = profile.personalBests[key];
      const row = document.createElement("div");
      row.className = "performance-row";
      if (best) {
        const date = new Date(best.date).toLocaleDateString();
        row.innerHTML = `<span>Most ${STAT_LABELS[key]} — ${best.playerName}</span><span class="performance-line">${r(best.value)} — ${date}</span>`;
      } else {
        row.innerHTML = `<span>Most ${STAT_LABELS[key]}</span><span class="performance-line">—</span>`;
      }
      refs.topPerformances.appendChild(row);
    }
  }

  refs.historyBody.innerHTML = "";
  for (const entry of profile.history) {
    const tr = document.createElement("tr");
    tr.className = entry.won ? "win-row" : "loss-row";
    const date = new Date(entry.date).toLocaleDateString();
    // "local" was pass-and-play, which no longer exists - but games played
    // before it was removed are still in saved history and should keep their
    // real label rather than being mislabelled as bot games.
    const modeTag = entry.mode === "online" ? "Online" : entry.mode === "local" ? "Local" : "Practice";
    tr.innerHTML = `<td>${date}</td><td>${entry.won ? "Win" : "Loss"} vs ${entry.opponentLabel} (${modeTag})</td><td>${entry.scoreFor}-${entry.scoreAgainst}</td><td>${entry.mvpName}</td>`;
    refs.historyBody.appendChild(tr);
  }
}

/** Pre-game tactic picker. Five permanent options, one selected at a time. */
export function renderTacticPicker(container, selectedId, onSelect) {
  container.innerHTML = "";
  for (const tactic of TACTICS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tactic-card" + (tactic.id === selectedId ? " active" : "");

    const head = document.createElement("span");
    head.className = "tactic-head";
    head.textContent = `${tactic.icon} ${tactic.name}`;
    btn.appendChild(head);

    const blurb = document.createElement("span");
    blurb.className = "tactic-blurb";
    blurb.textContent = tactic.blurb;
    btn.appendChild(blurb);

    btn.addEventListener("click", () => onSelect(tactic.id));
    container.appendChild(btn);
  }
}

/** Live box score that fills in as the game plays out. Shows cumulative
 * totals through the periods revealed so far, so you can watch a player's
 * night build rather than only seeing the finished table. */
export function renderLiveBox(container, rosterA, rosterB, labelA, labelB, totals) {
  const side = (roster, label, key) => {
    let html = `<div class="live-box-team"><div class="team-heading">${label}</div><table class="box-table"><tbody>`;
    for (const slot of SLOTS) {
      const player = roster[slot];
      if (!player) continue;
      const line = totals[key][slot] || { pts: 0, reb: 0, ast: 0 };
      html += `<tr><td class="live-slot">${SLOT_LABELS[slot]}</td><td>${player.name}</td>` +
        `<td class="live-stat">${r(line.pts)}</td><td class="live-stat">${r(line.reb)}</td>` +
        `<td class="live-stat">${r(line.ast)}</td></tr>`;
    }
    return html + "</tbody></table></div>";
  };
  container.innerHTML =
    `<div class="live-box-head"><span>PTS</span><span>REB</span><span>AST</span></div>` +
    side(rosterA, labelA, "a") +
    side(rosterB, labelB, "b");
}

/** A big-play headline. Cards stack newest-first and fade in, so the game
 * reads as a broadcast rather than a table appearing all at once. */
export function pushPlayHeadline(container, text, tone = "") {
  const card = document.createElement("div");
  card.className = "play-card" + (tone ? ` ${tone}` : "");
  card.textContent = text;
  container.prepend(card);
  while (container.children.length > 3) container.removeChild(container.lastChild);
}

export function clearPlayFeed(container) {
  container.innerHTML = "";
}
