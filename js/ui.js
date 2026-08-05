// Rendering helpers. Pure-ish functions: given data + a container element
// (and callbacks), they redraw that container's contents.

import { MIN_SEARCH_CHARS } from "./constants.js";
// Slot lists are still basketball's: they are default PARAMETER values, so
// they resolve at module load, before a sport is chosen. Everything else
// here is called at render time and goes through the active sport.
import { SLOTS, STARTER_SLOTS } from "./sports/nba/constants.js";
import { SPORTS, sportById, eraRecordKey, DEFAULT_SPORT_ID, activeSport } from "./sports/index.js";
import { eligibleOpenSlots, resolveTypedInput } from "./draft.js";
import {
  mostDraftedPlayer,
  mostTripleDoubles,
  winStreaks,
  mostMVPs,
  personalBestsFor,
  gameRecordFor,
  FEATURED_BADGE_SLOTS,
  eraRecord,
} from "./profile.js";
import { badgesForSport, badgeProgress, badgeSummary, badgeById } from "./badges.js";
import {
  BANNER_THRESHOLD,
  bannerProgress,
  bannerSummary,
  franchiseById,
  franchisesForSport,
  bannerById,
  FOUNDER_BANNER,
  isFounder,
  FIRST_PLAYER_BANNER,
  isFirstPlayer,
  GENERAL_BANNERS,
  generalBannerProgress,
  DEFAULT_BANNER_ID,
} from "./banners.js";
import { squadTierForRep } from "./squads.js";

/** Display name for a roster slot. Derived rather than looked up in a fixed
 * map, because roster shape varies by mode: Quick Play uses bare positions,
 * the legacy/online path adds a "6TH", and Ranked uses depth-chart slots
 * ("PG1", "PG2") that no fixed 6-key map could cover. */
function slotLabel(slot) {
  if (slot === "6TH") return "6th Man";
  // Bench spots aren't position-locked, so numbering them by position would
  // be a lie. They read as "Bench"; the player's own position is shown next
  // to their name instead.
  if (activeSport().isBenchSlot(slot)) return "Bench";
  return slot;
}

/** The slots a roster actually filled, in canonical lineup order. Mirrors
 * engine.js's activeSlots so the box score, live table, and recap all agree
 * on both which slots exist and what order they read in. */
function rosterSlots(roster) {
  return activeSport().orderedRosterSlots(roster);
}
const LINE_KEYS = ["pts", "reb", "ast", "stl", "blk", "tov"];

/**
 * @param eligibleSlotsForPendingPlayer null when no player is pending yet
 *   (all slots shown as plain status, none clickable) - or an array of the
 *   pending player's eligible open slots (those glow and are clickable;
 *   other open slots dim since they don't apply to this player).
 */
export function renderPositionSelector(container, roster, eligibleSlotsForPendingPlayer, onSelect, slots = SLOTS) {
  container.innerHTML = "";
  for (const slot of slots) {
    const btn = document.createElement("button");
    btn.type = "button";
    const filled = !!roster[slot];
    let className = "position-btn";
    let clickable = false;

    if (filled) {
      btn.textContent = `${slotLabel(slot)} ✓`;
    } else {
      btn.textContent = slotLabel(slot);
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
  const { pendingSlots = [], revealSlots = [], slots = SLOTS } = opts;
  container.innerHTML = "";
  const h3 = document.createElement("h3");
  h3.textContent = label + (isTurn ? " •" : "");
  container.appendChild(h3);

  for (const slot of slots) {
    const row = document.createElement("div");
    row.className = "roster-slot";
    const tag = document.createElement("span");
    tag.className = "slot-tag";
    tag.textContent = slotLabel(slot);
    row.appendChild(tag);

    const value = document.createElement("span");
    const player = roster[slot];
    if (player && pendingSlots.includes(slot)) {
      value.className = "slot-locked";
      value.textContent = "🔒 Locked in";
    } else if (player) {
      value.className = "slot-filled" + (revealSlots.includes(slot) ? " slot-reveal" : "");
      // A bench slot doesn't say what the player is, so his position rides
      // next to his name - that's the information you need to judge depth.
      const pos = activeSport().isBenchSlot(slot) ? ` [${player.pos.join("/")}]` : "";
      value.textContent = `${player.name}${pos} (${player.team} ${player.decade})`;
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
function renderPlayerCard(container, p, roster, pendingPlayerName, onPick, showStats = false, slots = SLOTS) {
  const eligibleSlots = eligibleOpenSlots(p, roster, slots);
  const eligible = eligibleSlots.length > 0;
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
export function renderPool(container, squad, filterText, roster, pendingPlayerName, onPick, allPlayers, ruleset = "strict", slots = SLOTS) {
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
      renderPlayerCard(container, p, roster, pendingPlayerName, onPick, true, slots);
    }
    return;
  }

  const result = resolveTypedInput(filterText, squad, allPlayers);

  if (result.tier === "too-short") {
    // Nothing typed yet says nothing: the ruleset hint directly above the box
    // already explains that you type a name and that it takes three letters,
    // and printing the same instruction twice cost four lines of a phone
    // screen right where the board needs them. Once someone HAS started
    // typing, "keep going" is real feedback and is worth a line.
    if (filterText.trim().length === 0) return;
    renderNote(container, `Keep typing — ${MIN_SEARCH_CHARS}+ letters needed to search.`);
    return;
  }

  if (result.tier === "in-squad") {
    for (const p of result.candidates) {
      renderPlayerCard(container, p, roster, pendingPlayerName, onPick, false, slots);
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

/**
 * Agrees a verb with the subject it follows.
 *
 * Online play labels the local player "You" rather than their username - it
 * reads better on a scoreboard than seeing your own name - but every line
 * that pairs a label with a present-tense verb was written assuming a third
 * person. That shipped "You wins, 138-132" on the final banner and "You takes
 * the lead" in the play feed.
 *
 * Only present-tense verbs need this. The recap is written in the past tense
 * throughout ("led", "trailed", "pulled away"), which is already correct for
 * both, and is left alone.
 */
export function subjectVerb(label, thirdPerson, secondPerson) {
  return label === "You" ? secondPerson : thirdPerson;
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

/** One shooting-split cell, e.g. "6/16" - a dash rather than "0/0" when a
 * player took none, so a center's FT column doesn't read as "missed every
 * free throw" when he simply never shot one. */
function splitCell(makes, attempts) {
  return attempts > 0 ? `${r(makes)}/${r(attempts)}` : "-";
}

function boxRow(slotLabel, player, line, shots, minutes) {
  const meta = player.team ? `<div class="box-meta">${escapeHtml(player.team)} ${escapeHtml(player.decade || "")}</div>` : "";
  return (
    `<tr><td>${slotLabel}</td><td>${escapeHtml(player.name)}${meta}</td>` +
    `<td>${minutes == null ? "-" : r(minutes)}</td>` +
    `<td>${r(line.pts)}</td><td>${r(line.reb)}</td><td>${r(line.ast)}</td>` +
    `<td>${r(line.stl)}</td><td>${r(line.blk)}</td><td>${r(line.tov)}</td>` +
    `<td>${shots ? splitCell(shots.fgm, shots.fga) : "-"}</td>` +
    `<td>${shots ? splitCell(shots.tpm, shots.tpa) : "-"}</td>` +
    `<td>${shots ? splitCell(shots.ftm, shots.fta) : "-"}</td></tr>`
  );
}

function boxTable(roster, box, teamLabel, shotLines, minutesMap, final) {
  let html =
    `<div class="team-heading">${teamLabel}</div><table class="box-table"><thead><tr>` +
    `<th>Slot</th><th>Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TOV</th>` +
    `<th>FG</th><th>3PT</th><th>FT</th></tr></thead><tbody>`;
  // Mid-game, roster order (starters then bench) is what makes the table
  // readable as it fills in - rows aren't jumping around every tick. At the
  // final buzzer the game is a finished box score, and those read top scorer
  // first, so re-sort only once there's nothing left to fill in.
  const slots = rosterSlots(roster).filter((slot) => box[slot]);
  const ordered = final ? [...slots].sort((a, b) => box[b].pts - box[a].pts) : slots;
  for (const slot of ordered) {
    html += boxRow(slotLabel(slot), roster[slot], box[slot], shotLines && shotLines[slot], minutesMap && minutesMap[slot]);
  }
  html += "</tbody></table>";
  return html;
}

export function renderFullBoxScore(container, rosterA, boxA, labelA, rosterB, boxB, labelB, shotsA, shotsB, minutesA, minutesB, final = false) {
  container.innerHTML =
    boxTable(rosterA, boxA, labelA, shotsA, minutesA, final) + boxTable(rosterB, boxB, labelB, shotsB, minutesB, final);
}

/** Shot splits for a finished roster, computed once so the same line is
 * reused everywhere it's shown - calling shotLine twice would reroll the
 * night's variance and contradict itself. */
export function buildShotLines(roster, box) {
  const out = {};
  for (const slot of rosterSlots(roster)) {
    const player = roster[slot];
    if (!box[slot]) continue;
    out[slot] = activeSport().shotLine(player, box[slot].pts);
  }
  return out;
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
  // The pulse glow while live is the scoreboard's own "still playing" tell,
  // the same job .scoreboard-period.live's blink does for the status line -
  // together they read as a broadcast that's actually in progress, not a
  // static final score sitting on screen early.
  const scoreClass = "scoreboard-score" + (isLive ? " pulse" : "");
  teams.innerHTML = `
    <span class="scoreboard-team-name">${labelA}</span>
    <span class="${scoreClass}">${Math.round(totalA)}</span>
    <span class="scoreboard-dash">–</span>
    <span class="${scoreClass}">${Math.round(totalB)}</span>
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

export function renderTierSummary(badgeContainer, captionContainer, rankInfo) {
  badgeContainer.innerHTML = "";
  const badge = document.createElement("span");
  badge.className = "tier-badge";

  if (rankInfo.provisional) {
    badge.textContent = "Provisional";
    badgeContainer.appendChild(badge);
    const g = rankInfo.gamesNeeded;
    captionContainer.textContent = `${g} more online ${g === 1 ? "game" : "games"} to get a rank.`;
    return;
  }

  const { tier, next, percentile, rank, totalQualifying } = rankInfo;
  badge.textContent = tier.name;
  badgeContainer.appendChild(badge);

  const track = document.createElement("div");
  track.className = "progress-bar-track";
  const fill = document.createElement("div");
  fill.className = "progress-bar-fill";
  const pct = next
    ? Math.min(100, (100 * (percentile - tier.minPercentile)) / (next.minPercentile - tier.minPercentile))
    : 100;
  fill.style.width = `${pct}%`;
  track.appendChild(fill);
  badgeContainer.appendChild(track);

  // The rating leads, because it is the thing that actually moved: a player
  // who won and gained 18 points wants to see the 18, and the percentile only
  // changes when someone else's rating does.
  const ratingPart = rankInfo.rating === undefined ? "" : `${rankInfo.rating} rating — `;
  const standing = `${ratingPart}top ${Math.max(1, Math.round(100 - percentile))}% (#${rank} of ${totalQualifying})`;
  // The top rung is named by whichever ladder this is - the sport ladders end
  // in Legend, the all-sports one in GOAT - so it is read off the tier rather
  // than written in here.
  captionContainer.textContent = next
    ? `${standing} — climb into the top ${Math.round(100 - next.minPercentile)}% to reach ${next.name}.`
    : `${standing} — you've reached the top tier, ${tier.name}.`;
}

/** "Est. MM/YYYY" - a join-date plate in the style of a franchise banner's
 * own "Est. 1946", built from the account's creation date. */
function formatJoinTag(createdAt) {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `Est. ${mm}/${d.getFullYear()}`;
}

/** Home-screen header: who you are, plus your online rep/rank and badges.
 * This is the first thing on the page now, so the profile leads the
 * experience instead of being buried behind a tab.
 *
 * Deliberately doesn't show total games played or a per-sport breakdown -
 * those are private, and with only one sport live a per-sport list is just
 * one entry repeated. Total games still lives on the Profile screen itself
 * (your own stats, not something the banner broadcasts). */
/** Creates-or-updates one absolutely-positioned mark on the home banner card,
 * removing it when the equipped banner doesn't call for one. Idempotent
 * because renderHomeHeader re-runs on every profile refresh. */
function setCardMark(card, className, text) {
  let el = card.querySelector(`.${className}`);
  if (!text) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("span");
    el.className = className;
    card.appendChild(el);
  }
  el.textContent = text;
}

export function renderHomeHeader(refs, profile, rankInfo) {
  refs.username.textContent = profile.username || "Player";

  // The equipped banner's own colors and ghosted abbreviation become the
  // whole card's background (see .player-banner.has-banner in style.css) -
  // a real banner behind the player, not a small icon next to their name.
  // Falls back to the plain panel background when nothing is equipped, so
  // the layout never depends on having earned something.
  const franchise = profile.equippedBanner ? bannerById(profile.equippedBanner) : null;
  refs.card.classList.toggle("has-banner", !!franchise);

  // Patterned banners (camo, the crew tiers, Founder) paint the card with the
  // same CSS treatment their tile uses, rather than flattening to a two-color
  // gradient. Equipping a camo and finding a plain fade on your profile is
  // the reward not actually being worn.
  for (const cls of [...refs.card.classList]) {
    if (cls.startsWith("banner-art-")) refs.card.classList.remove(cls);
  }

  if (franchise) {
    refs.card.style.setProperty("--banner-c1", franchise.colors[0]);
    refs.card.style.setProperty("--banner-c2", franchise.colors[1]);
    refs.card.style.setProperty("--art-c1", franchise.colors[0]);
    refs.card.style.setProperty("--art-c2", franchise.colors[1]);
    // Real artwork wins over the generated pattern.
    refs.card.classList.toggle("has-banner-image", !!franchise.image);
    if (franchise.image) refs.card.style.setProperty("--banner-image", `url("${franchise.image}")`);
    else refs.card.style.removeProperty("--banner-image");
    if (franchise.art && !franchise.image) {
      refs.card.classList.add(`banner-art-${franchise.art}`);
      refs.card.dataset.bannerArt = franchise.art;
    } else {
      delete refs.card.dataset.bannerArt;
    }
    if (franchise.hideAbbr) delete refs.card.dataset.bannerAbbr;
    else refs.card.dataset.bannerAbbr = franchise.abbr;
  } else {
    for (const prop of ["--banner-c1", "--banner-c2", "--art-c1", "--art-c2", "--banner-image"]) {
      refs.card.style.removeProperty(prop);
    }
    refs.card.classList.remove("has-banner-image");
    delete refs.card.dataset.bannerAbbr;
    delete refs.card.dataset.bannerArt;
  }

  // Reused rather than recreated: this runs on every refreshHome(), and
  // appending would stack a new star on the card each time.
  setCardMark(refs.card, "pb-banner-emblem", franchise?.emblem);
  setCardMark(refs.card, "pb-banner-label", franchise?.label);
  // Lets the phone layout reserve room for the emblem, but only on the
  // banners that actually have one - every other banner would just get a
  // dead gutter down the right-hand side.
  refs.card.classList.toggle("has-emblem", !!franchise?.emblem);

  const joinTag = formatJoinTag(profile.createdAt);
  refs.joined.textContent = joinTag || "";
  refs.joined.classList.toggle("hidden", !joinTag);

  renderFeaturedBadges(refs.featured, profile);

  // The banner carries the GENERAL rank - the one on js/ranks.js's sport-
  // neutral ladder, off a rating averaged across every sport played. A banner
  // is the thing other players see in the matchup intro, and it should say
  // what kind of player you are rather than what kind of basketball player,
  // now that a second sport exists. Per-sport ranks live on the profile
  // screen, under that sport's own subtab.
  const rankName = rankInfo.provisional ? "Provisional" : rankInfo.tier.name;
  refs.record.innerHTML = "";
  const parts = [
    { label: "Rep", value: `${profile.onlineWins}-${profile.onlineLosses}` },
    { label: "Rank", value: rankName },
  ];
  // The rating itself, only once it means something. Showing "500" to someone
  // with two games would present the starting number as an achievement.
  if (!rankInfo.provisional) parts.push({ label: "Rating", value: String(rankInfo.rating) });
  for (const part of parts) {
    const stat = document.createElement("div");
    stat.className = "pb-stat";
    stat.innerHTML = `<span class="pb-stat-value"></span><span class="pb-stat-label"></span>`;
    stat.querySelector(".pb-stat-value").textContent = part.value;
    stat.querySelector(".pb-stat-label").textContent = part.label;
    refs.record.appendChild(stat);
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

/** The two kinds of thing under the Rewards tab. Both get their own
 * sport-scoped subtabs underneath (see renderBadgeSportTabs/
 * renderBannerSportTabs) now that franchise banners come per-sport too. */
const UNLOCKABLE_KINDS = [
  { id: "badges", label: "Badges" },
  { id: "banners", label: "Banners" },
];

export function renderUnlockableTabs(container, active, onSelect) {
  container.innerHTML = "";
  for (const kind of UNLOCKABLE_KINDS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "subtab" + (kind.id === active ? " active" : "");
    btn.textContent = kind.label;
    btn.addEventListener("click", () => onSelect(kind.id));
    container.appendChild(btn);
  }
}

/** Sport subtabs for the badges screen. Sports with no badges yet still get
 * a tab so the roadmap is visible, but it's marked locked and says so when
 * opened rather than showing a confusing empty grid. */
export function renderBadgeSportTabs(container, activeId, onSelect) {
  container.innerHTML = "";
  for (const sport of SPORTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "subtab" + (sport.id === activeId ? " active" : "") + (sport.live ? "" : " locked");
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

  // Highest tier first, so what you've actually achieved leads the screen and
  // unearned badges settle at the bottom. Ties break on how far into the
  // current tier you are, then name, so the order is stable between renders
  // rather than shuffling every time the screen is opened.
  const ranked = list
    .map((badge) => ({ badge, progress: badgeProgress(badge, profile) }))
    .sort(
      (x, y) =>
        y.progress.tierIndex - x.progress.tierIndex ||
        y.progress.percent - x.progress.percent ||
        x.badge.name.localeCompare(y.badge.name)
    );

  for (const { badge, progress } of ranked) {
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

/** One franchise banner: a vertical field of the team's two colors with the
 * abbreviation ghosted large in the corner, like a number on a retired
 * jersey banner. The look comes entirely from the franchise entry's colors
 * and abbreviation - no commissioned asset, no player likeness anywhere
 * near it, and it reads as a real banner rather than a badge/icon. */
export function bannerArt(franchise) {
  const el = document.createElement("div");
  // `art` (general banners only - see GENERAL_BANNERS in banners.js) swaps the
  // flat two-color gradient for a real pattern. The two colors still drive it
  // via CSS vars, so one class covers every camo instead of a rule per banner.
  el.className =
    "banner-art" + (franchise.image ? " has-image" : franchise.art ? ` banner-art-${franchise.art}` : "");
  el.style.setProperty("--art-c1", franchise.colors[0]);
  el.style.setProperty("--art-c2", franchise.colors[1]);
  // `image` is real artwork and beats everything below it. The colors still go
  // on as a background, so a slow or failed load shows the banner's own two
  // colors rather than an empty hole - the art is an upgrade over the
  // generated look, not a dependency of it.
  el.style.background = `linear-gradient(180deg, ${franchise.colors[0]} 0%, ${franchise.colors[1]} 100%)`;
  if (franchise.image) {
    const img = document.createElement("img");
    img.className = "banner-art-img";
    img.src = franchise.image;
    img.alt = "";
    // Every banner in the Rewards grid draws at once, so decoding them eagerly
    // stalls that screen on a phone for no benefit - most are below the fold.
    img.loading = "lazy";
    img.decoding = "async";
    // A missing file falls back to the gradient already painted underneath,
    // instead of leaving a broken-image glyph on the card.
    img.addEventListener("error", () => img.remove());
    el.appendChild(img);
  } else if (franchise.art) {
    el.className = `banner-art banner-art-${franchise.art}`;
  }
  // The ghosted corner abbreviation is the fallback for banners with no
  // artwork of their own - it gives a flat two-color field something to say.
  // A banner that HAS artwork opts out (`hideAbbr`), because stamping a
  // three-letter code over a camo or a custom design is the label competing
  // with the thing it labels. The tile prints the banner's name underneath
  // either way, so nothing is lost by leaving it off.
  if (!franchise.hideAbbr) el.dataset.abbr = franchise.abbr;

  // A full-opacity mark that sits INSIDE the frame, unlike the abbreviation
  // slot above, which is deliberately bled off the corner.
  if (franchise.emblem) {
    const emblem = document.createElement("span");
    emblem.className = "banner-emblem";
    emblem.textContent = franchise.emblem;
    el.appendChild(emblem);
  }

  if (franchise.label) {
    const label = document.createElement("span");
    label.className = "banner-label";
    label.textContent = franchise.label;
    el.appendChild(label);
  }

  // A placeholder sport marker until franchise banners get real art (city
  // skylines, etc.) - just enough so a banner reads as "this is the NFL one"
  // at a glance once more than one sport has franchises here.
  const sport = SPORTS.find((s) => s.id === franchise.sport);
  if (sport) {
    const badge = document.createElement("span");
    badge.className = "banner-sport-badge";
    badge.textContent = sport.icon;
    el.appendChild(badge);
  }

  return el;
}

/** The equipped banner's name, shown as a small caption under the player's
 * name on the home header - the banner artwork itself is now the whole
 * card's background (see renderHomeHeader), so this is just enough text to
 * say which team it is, not a second copy of the art. */
export function renderEquippedBanner(container, profile) {
  container.innerHTML = "";
  const franchise = profile.equippedBanner ? bannerById(profile.equippedBanner) : null;
  container.hidden = !franchise;
  if (!franchise) return;
  const label = document.createElement("span");
  label.className = "banner-flying";
  label.textContent = `Flying ${franchise.name}`;
  container.appendChild(label);
}

/** One side of the pre-draft matchup intro (see playMatchupIntro in
 * main.js): the player's equipped banner art (or a neutral placeholder if
 * they haven't equipped one), username, and rank label. `refs` is
 * { bannerSlot, username, rank } - the three elements for one side. */
export function renderMatchupSide(refs, { username, tierLabel, bannerId }) {
  refs.bannerSlot.innerHTML = "";
  const banner = bannerId ? bannerById(bannerId) : null;
  if (banner) {
    refs.bannerSlot.appendChild(bannerArt(banner));
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "matchup-banner-placeholder";
    placeholder.textContent = "No banner flown";
    refs.bannerSlot.appendChild(placeholder);
  }
  refs.username.textContent = username;
  refs.rank.textContent = tierLabel;
}

/**
 * The banner collection. Locked banners still show the franchise and how far
 * along you are - a reward you can't see the shape of isn't motivating.
 */
/** A hardcoded, always-unlocked banner tile (Founder, 1st Player) - no
 * progress bar, just the art, name, equip state, and a distinct glow class
 * marking it as different in kind from an earnable team banner. */
function specialBannerTile(banner, glowClass, profile, onEquip) {
  const equipped = profile.equippedBanner === banner.id;
  const tile = document.createElement("div");
  tile.className = `banner-tile ${glowClass}` + (equipped ? " equipped" : "");
  tile.appendChild(bannerArt(banner));

  const name = document.createElement("div");
  name.className = "banner-name";
  name.textContent = banner.name;
  tile.appendChild(name);

  const caption = document.createElement("div");
  caption.className = "banner-progress";
  caption.textContent = equipped ? "Flying now" : "Unlocked";
  tile.appendChild(caption);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-secondary banner-equip";
  btn.textContent = equipped ? "Take down" : "Fly this";
  btn.addEventListener("click", () => onEquip(equipped ? null : banner.id));
  tile.appendChild(btn);

  return tile;
}

/** A general banner tile: like a franchise tile, but its caption comes from
 * the banner's own requirement ("Win 500 online ranked games") rather than a
 * shared draft threshold, since each one is earned a different way. */
function generalBannerTile(banner, progress, profile, onEquip) {
  const equipped = profile.equippedBanner === banner.id;
  const tile = document.createElement("div");
  tile.className = "banner-tile" + (progress.unlocked ? "" : " locked") + (equipped ? " equipped" : "");
  tile.appendChild(bannerArt(banner));

  const name = document.createElement("div");
  name.className = "banner-name";
  name.textContent = banner.name;
  tile.appendChild(name);

  if (!progress.unlocked) {
    const track = document.createElement("div");
    track.className = "progress-bar-track";
    const fill = document.createElement("div");
    fill.className = "progress-bar-fill";
    fill.style.width = `${progress.percent}%`;
    track.appendChild(fill);
    tile.appendChild(track);
  }

  const caption = document.createElement("div");
  caption.className = "banner-progress";
  caption.textContent = progress.unlocked
    ? equipped ? "Flying now" : "Unlocked"
    : `${progress.value} / ${progress.required} — ${banner.blurb}`;
  tile.appendChild(caption);

  // The default banner has no "take down": clearing it just falls back to
  // itself (see normalize() in profile.js), so the button would do nothing.
  if (progress.unlocked && !(equipped && banner.id === DEFAULT_BANNER_ID)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary banner-equip";
    btn.textContent = equipped ? "Take down" : "Fly this";
    btn.addEventListener("click", () => onEquip(equipped ? null : banner.id));
    tile.appendChild(btn);
  }

  return tile;
}

/** Sport subtabs for the banners screen - same pattern as
 * renderBadgeSportTabs, just filtering FRANCHISES instead of BADGES. */
// A pseudo-sport tab, not a real entry in SPORTS (constants.js) - it holds
// banners that aren't earned through any sport's play at all (Founder, 1st
// Player), so they don't belong filed under NBA just because that's where
// they used to live. Prepended to the real sport tabs rather than folded in
// as sport id "general" anywhere else, so nothing outside banner rendering
// needs to know it exists.
const GENERAL_BANNERS_TAB = { id: "general", name: "General", icon: "⭐", live: true };

export function renderBannerSportTabs(container, activeId, onSelect) {
  container.innerHTML = "";
  for (const sport of [GENERAL_BANNERS_TAB, ...SPORTS]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "subtab" + (sport.id === activeId ? " active" : "") + (sport.live ? "" : " locked");
    btn.textContent = `${sport.icon} ${sport.name}`;
    btn.addEventListener("click", () => onSelect(sport.id));
    container.appendChild(btn);
  }
}

/** `onlyUnlocked` filters franchise banners down to ones this profile can
 * actually equip - what Profile > Customize Banner shows, since offering to
 * "customize" with a banner you haven't earned yet is just the Rewards tab
 * with extra steps. Rewards itself always passes false, since showing what's
 * still locked (and how close you are) is the whole point there. */
export function renderBanners(container, summaryEl, profile, onEquip, sport = "nba", onlyUnlocked = false) {
  container.innerHTML = "";

  // Founder and 1st Player: not earned through any sport's play, so they
  // get their own tab rather than being filed under whichever sport
  // happened to be active when they were added.
  if (sport === "general") {
    const hasFounder = isFounder(profile);
    const hasFirstPlayer = isFirstPlayer(profile);
    if (hasFounder) container.appendChild(specialBannerTile(FOUNDER_BANNER, "founder-tile", profile, onEquip));
    if (hasFirstPlayer) container.appendChild(specialBannerTile(FIRST_PLAYER_BANNER, "first-player-tile", profile, onEquip));

    let unlockedCount = 0;
    let shownGeneral = 0;
    for (const banner of GENERAL_BANNERS) {
      const progress = generalBannerProgress(banner, profile);
      if (progress.unlocked) unlockedCount += 1;
      if (onlyUnlocked && !progress.unlocked) continue;
      shownGeneral += 1;
      container.appendChild(generalBannerTile(banner, progress, profile, onEquip));
    }

    summaryEl.textContent = onlyUnlocked
      ? `${unlockedCount} of ${GENERAL_BANNERS.length} general banners unlocked - pick one to fly.`
      : `${unlockedCount} of ${GENERAL_BANNERS.length} unlocked · earned across the whole game, not one franchise.`;
    if (onlyUnlocked && shownGeneral === 0 && !hasFounder && !hasFirstPlayer) {
      renderNote(container, "No general banners unlocked yet.");
    }
    return;
  }

  const list = franchisesForSport(sport);
  const { unlocked, total } = bannerSummary(profile, sport);
  summaryEl.textContent = onlyUnlocked
    ? `${unlocked} of ${total} banners unlocked - pick one to fly on your profile.`
    : `${unlocked} of ${total} banners unlocked · draft ${BANNER_THRESHOLD} players from a franchise across ranked wins` +
      " (practice doesn't count)";

  let shown = 0;
  for (const franchise of list) {
    const progress = bannerProgress(franchise, profile);
    if (onlyUnlocked && !progress.unlocked) continue;
    shown += 1;
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

  if (onlyUnlocked && shown === 0) {
    renderNote(container, "You haven't unlocked any banners here yet - draft players from a franchise in ranked wins to earn one.");
  }
}

/** One row per era bracket, online and offline broken out separately - a
 * rank earned in Modern Ball says nothing about Grandpa's Game, so folding
 * them into one number would hide more than it showed. Lives on the Profile
 * tab only; the home screen's era chips are for picking what to play next,
 * not for re-showing a record.
 *
 * The online side also shows a per-era rank. Today that's always
 * "Provisional" - loadRankInfo() (profile.js) only computes the one
 * cross-era percentile shown at the top of the profile; a real per-era
 * version (same idea, scoped to eraRecord's online_wins/online_losses
 * instead of the profile-wide total) is a follow-up, not built yet. */
function renderEraRecords(container, profile, sport) {
  container.innerHTML = "";
  // The active sport's brackets, and its record keys. Era ids are only unique
  // within a sport (every sport wants an "all"), so the key is namespaced -
  // see eraRecordKey in js/sports/index.js.
  for (const era of sport.eras) {
    const rec = eraRecord(profile, eraRecordKey(sport.id, era.id));
    const row = document.createElement("div");
    row.className = "era-record-row";
    row.innerHTML =
      `<span class="era-record-name"><span aria-hidden="true">${era.emoji}</span> ${era.label}</span>` +
      `<span class="era-record-split"><span class="era-record-label">Online</span> ${rec.online_wins}-${rec.online_losses}` +
      `<span class="era-record-rank">Provisional</span></span>` +
      `<span class="era-record-split"><span class="era-record-label">Offline</span> ${rec.offline_wins}-${rec.offline_losses}</span>`;
    container.appendChild(row);
  }
}

/**
 * One Top Performances row.
 *
 * A row becomes a button when the record carries the box score of the game it
 * was set in, and stays a plain div when it doesn't - which is every record
 * written before snapshots existed, and every empty placeholder. That is the
 * honest split: a row only looks clickable when there is something behind it.
 */
function performanceRow(label, value, game = null, onOpenGame = null) {
  const clickable = !!(game && game.boxA && game.boxB && onOpenGame);
  const row = document.createElement(clickable ? "button" : "div");
  row.className = "performance-row" + (clickable ? " record-link" : "");
  if (clickable) {
    row.type = "button";
    row.addEventListener("click", () => onOpenGame(game));
  }
  row.innerHTML = `<span></span><span class="performance-line"></span>`;
  // innerHTML for the label because callers pass pre-escaped markup for the
  // player-name half; the value is always ours and goes in as text.
  row.firstChild.innerHTML = label;
  row.lastChild.textContent = value;
  return row;
}

/**
 * @param rankInfo the player's GENERAL, all-sports standing - the one on their
 *   banner. It sits at the top of the screen because it is the headline.
 * @param sport which sport's career stats to show. Everything below the subtab
 *   row is scoped to it, including `sportRankInfo` - that sport's own ELO
 *   standing on its own ladder, which is a different number from `rankInfo`
 *   and is the whole point of ratings being per-sport.
 * @param onOpenGame called with a stored game snapshot when a record row is
 *   clicked. Rows without a snapshot are not clickable at all.
 */
export function renderProfileScreen(
  refs,
  profile,
  rankInfo,
  sport = sportById(DEFAULT_SPORT_ID),
  sportRankInfo = null,
  onOpenGame = null
) {
  refs.usernameInput.value = profile.username || "";
  renderTierSummary(refs.tierBadge, refs.tierCaption, rankInfo);

  if (refs.sportRankHeading) refs.sportRankHeading.textContent = `${sport.name} Rank`;
  if (refs.sportRank) {
    refs.sportRank.innerHTML = "";
    if (!sportRankInfo) {
      refs.sportRank.innerHTML = `<div class="empty-note">${sport.name} isn't playable yet, so there's no rank to earn here.</div>`;
    } else if (sportRankInfo.provisional) {
      const g = sportRankInfo.gamesNeeded;
      refs.sportRank.innerHTML =
        `<div class="empty-note">${g} more online ${g === 1 ? "game" : "games"} in ${sport.name} to get a ${sport.name} rank.</div>`;
    } else {
      const badge = document.createElement("span");
      badge.className = "tier-badge";
      badge.textContent = sportRankInfo.tier.name;
      const line = document.createElement("div");
      line.className = "performance-line";
      line.textContent =
        `${sportRankInfo.rating} rating — #${sportRankInfo.rank} of ${sportRankInfo.totalQualifying} in ${sport.name}`;
      refs.sportRank.append(badge, line);
    }
  }

  refs.onlineRecord.textContent = `${profile.onlineWins}-${profile.onlineLosses}`;
  refs.offlineRecord.textContent = `${profile.offlineWins}-${profile.offlineLosses}`;
  // Practice games don't move rank, but they are still games you played, so
  // the total counts every mode.
  refs.totalGames.textContent = String(
    profile.onlineWins + profile.onlineLosses + profile.offlineWins + profile.offlineLosses
  );

  renderEraRecords(refs.eraRecords, profile, sport);

  const top = mostDraftedPlayer(profile, sport.id);
  refs.mostDrafted.innerHTML = top
    ? `<div class="performance-row"><span>${escapeHtml(top.name)}</span><span class="performance-line">${top.count}x drafted</span></div>`
    : `<div class="empty-note">Play a ${sport.name} draft to start tracking this.</div>`;

  // Labels come from the sport, so the NFL tab lists passing yards rather than
  // rebounds. A sport nobody has played yet still draws every row as a dash -
  // showing what WILL be tracked is more useful than an empty card.
  refs.topPerformances.innerHTML = "";
  const statLabels = sport.statLabels || {};
  const bests = personalBestsFor(profile, sport.id);
  const bestKeys = Object.keys(statLabels);
  if (!bestKeys.length) {
    refs.topPerformances.innerHTML = `<div class="empty-note">No stats tracked for ${sport.name} yet.</div>`;
  } else if (!bestKeys.some((k) => bests[k])) {
    refs.topPerformances.innerHTML = `<div class="empty-note">No ${sport.name} games played yet.</div>`;
  } else {
    for (const key of bestKeys) {
      const best = bests[key];
      const label = `Most ${statLabels[key]}`;
      refs.topPerformances.appendChild(
        best
          ? performanceRow(
              `${label} — ${escapeHtml(best.playerName)}`,
              `${r(best.value)} — ${new Date(best.date).toLocaleDateString()}`,
              best.game,
              onOpenGame
            )
          : performanceRow(label, "—")
      );
    }
  }

  // Both game records are keyed by sport now, so the football tab cannot show
  // your best basketball night. gameRecordFor also reads the old flat shape.
  const scoringGame = gameRecordFor(profile.highestScoringGame, sport.id);
  refs.highestScoringGame.replaceWith(
    (refs.highestScoringGame = performanceRow(
      scoringGame ? `Highest Scoring Game — vs ${escapeHtml(scoringGame.opponentLabel)}` : "Highest Scoring Game",
      scoringGame ? `${scoringGame.scoreFor} — ${new Date(scoringGame.date).toLocaleDateString()}` : "—",
      scoringGame,
      onOpenGame
    ))
  );

  const marginGame = gameRecordFor(profile.largestMarginGame, sport.id);
  refs.largestMargin.innerHTML = "";
  refs.largestMargin.appendChild(
    performanceRow(
      marginGame ? `Biggest Win — vs ${escapeHtml(marginGame.opponentLabel)}` : "Biggest Win",
      marginGame
        ? `${marginGame.value}-point win — ${new Date(marginGame.date).toLocaleDateString()}`
        : "—",
      marginGame,
      onOpenGame
    )
  );

  const tripleDoubles = mostTripleDoubles(profile, sport.id);
  refs.mostTripleDoubles.innerHTML = tripleDoubles
    ? `<div class="performance-row"><span>Most Triple-Doubles — ${escapeHtml(tripleDoubles.name)}</span><span class="performance-line">${tripleDoubles.count}x</span></div>`
    : `<div class="performance-row"><span>Most Triple-Doubles</span><span class="performance-line">—</span></div>`;

  const streaks = winStreaks(profile);
  const streakScope = streaks.complete ? "" : ` (last ${streaks.sampled})`;
  const streakLine =
    streaks.longest > 0
      ? `${streaks.longest} game${streaks.longest === 1 ? "" : "s"}` +
        (streaks.current > 1 ? ` — on ${streaks.current} now` : "")
      : "—";
  refs.longestWinStreak.innerHTML =
    `<div class="performance-row"><span>Longest Win Streak${streakScope}</span>` +
    `<span class="performance-line">${streakLine}</span></div>`;

  const mvps = mostMVPs(profile, sport.id);
  refs.mostMvps.innerHTML = mvps
    ? `<div class="performance-row"><span>Most MVPs — ${mvps.name}</span><span class="performance-line">${mvps.count}x</span></div>`
    : `<div class="performance-row"><span>Most MVPs</span><span class="performance-line">—</span></div>`;

  refs.historyBody.innerHTML = "";
  for (const entry of profile.history) {
    const tr = document.createElement("tr");
    tr.className = entry.won ? "win-row" : "loss-row";
    const date = new Date(entry.date).toLocaleDateString();
    // "local" was pass-and-play, which no longer exists - but games played
    // before it was removed are still in saved history and should keep their
    // real label rather than being mislabelled as bot games.
    const modeTag = entry.mode === "online" ? "Online" : entry.mode === "local" ? "Local" : "Practice";
    // Mode is its own element rather than "(Online)" inside the result text:
    // on a phone that parenthetical was what pushed the result cell to three
    // lines, and as a tag it can drop underneath instead of widening the
    // column. Escaped because an opponent's username and an MVP name are
    // both player-supplied.
    tr.innerHTML =
      `<td>${date}</td>` +
      `<td>${entry.won ? "Win" : "Loss"} vs ${escapeHtml(entry.opponentLabel)}` +
      `<span class="history-mode">${modeTag}</span></td>` +
      `<td class="history-score">${entry.scoreFor}-${entry.scoreAgainst}</td>` +
      `<td>${escapeHtml(entry.mvpName)}</td>`;
    refs.historyBody.appendChild(tr);
  }
}

/** Rotation phase, NBA 2K franchise style: one slider per player, with each
 * position's two players coupled to that position's 48 minutes. Dragging a
 * starter to 32 drives his backup to 16 automatically.
 *
 * Coupling is what makes this better than free-form number entry: the
 * 240-minute budget becomes structurally impossible to break, so there is no
 * over-budget state to warn about and no way to confirm an invalid rotation.
 * You are always trading minutes between two players, which is the actual
 * decision - not filling in a form that might not add up.
 *
 * The legacy/online 6-slot roster has no position pairs, so its slots fall
 * back to independent sliders against a running total.
 */
export function renderRotationPicker(container, roster, minutesMap, totalEl, slots, onValidChange) {
  container.innerHTML = "";
  const list = (slots ? slots.filter((slot) => roster[slot]) : rosterSlots(roster));
  const rows = [];

  const sync = () => {
    const spent = list.reduce((sum, slot) => sum + (minutesMap[slot] || 0), 0);
    const remaining = activeSport().rotationBudget - spent;
    list.forEach((slot, i) => {
      const { min, max } = activeSport().minutesRangeFor(slot);
      // A slider may claim its own value plus whatever is still unspent, and
      // no more. That is what makes going over 240 impossible rather than
      // merely discouraged - there is no invalid state to validate against.
      const cap = Math.min(max, minutesMap[slot] + Math.max(0, remaining));
      rows[i].slider.min = String(min);
      rows[i].slider.max = String(cap);
      rows[i].slider.value = String(minutesMap[slot]);
      rows[i].value.textContent = `${minutesMap[slot]} min`;
    });
    renderRotationTotal(totalEl, minutesMap, list);
    if (onValidChange) onValidChange(remaining === 0);
  };

  for (const slot of list) {
    const player = roster[slot];
    const { min, max } = activeSport().minutesRangeFor(slot);
    const bench = activeSport().isBenchSlot(slot) || slot === "6TH";

    const row = document.createElement("div");
    row.className = "rotation-row" + (bench ? " rotation-bench" : " rotation-starter");

    const name = document.createElement("span");
    name.className = "rotation-label";
    name.innerHTML =
      `<span class="rotation-role">${bench ? "Bench" : slotLabel(slot)}</span> ` +
      `${escapeHtml(player.name)} <span class="rotation-pos">${player.pos.join("/")}</span>`;
    row.appendChild(name);

    const value = document.createElement("span");
    value.className = "rotation-value";
    row.appendChild(value);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "rotation-slider";
    slider.step = "1";
    slider.min = String(min);
    slider.max = String(max);
    slider.value = String(minutesMap[slot] ?? min);
    slider.addEventListener("input", () => {
      minutesMap[slot] = Math.min(max, Math.max(min, parseInt(slider.value, 10) || min));
      sync();
    });

    rows.push({ slider, value });
    container.appendChild(row);
    container.appendChild(slider);
  }

  sync();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderRotationTotal(totalEl, minutesMap, list) {
  const spent = list.reduce((sum, slot) => sum + (minutesMap[slot] || 0), 0);
  const remaining = activeSport().rotationBudget - spent;
  if (remaining === 0) {
    totalEl.textContent = `All ${activeSport().rotationBudget} minutes assigned`;
    totalEl.className = "rotation-total";
  } else {
    totalEl.textContent =
      `${spent} of ${activeSport().rotationBudget} assigned \u2014 ${remaining} minute${remaining === 1 ? "" : "s"} still to give out`;
    totalEl.className = "rotation-total rotation-warning";
  }
}

/** Defensive matchup picker: one row per starter, each choosing which
 * opposing starter he guards.
 *
 * Reassigning SWAPS rather than overwrites - if you put your stopper on their
 * star, whoever was on the star inherits the man your stopper left. That
 * keeps the assignment a permutation, so nobody is ever double-teamed or left
 * unguarded, and it means the screen can't be put into an invalid state that
 * would then need validating.
 */
export function renderMatchupPicker(container, myRoster, oppRoster, myStarters, oppStarters, matchups, oppLabel) {
  container.innerHTML = "";

  const draw = () => {
    container.innerHTML = "";
    for (const slot of myStarters) {
      const row = document.createElement("div");
      row.className = "matchup-row";

      const mine = document.createElement("span");
      mine.className = "matchup-mine";
      mine.innerHTML = `<span class="matchup-slot">${slot}</span>${escapeHtml(myRoster[slot].name)}`;
      row.appendChild(mine);

      const arrow = document.createElement("span");
      arrow.className = "matchup-arrow";
      arrow.textContent = "guards";
      row.appendChild(arrow);

      const pick = document.createElement("select");
      pick.className = "matchup-pick";
      for (const target of oppStarters) {
        const opt = document.createElement("option");
        opt.value = target;
        opt.textContent = `${target} · ${oppRoster[target].name}`;
        opt.selected = matchups[slot] === target;
        pick.appendChild(opt);
      }
      pick.addEventListener("change", () => {
        const wanted = pick.value;
        const previous = matchups[slot];
        // Whoever already had this assignment takes the one being vacated,
        // which is what preserves the permutation.
        const displaced = myStarters.find((s) => s !== slot && matchups[s] === wanted);
        matchups[slot] = wanted;
        if (displaced) matchups[displaced] = previous;
        draw();
      });
      row.appendChild(pick);

      container.appendChild(row);
    }
  };

  draw();
}

/** Pre-game tactic picker. Options passed in are whichever ones this game
 * offers - the catalog is larger than what any single game shows. */
export function renderTacticPicker(container, tacticsToShow, selectedId, onSelect) {
  container.innerHTML = "";
  for (const tactic of tacticsToShow) {
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

/** A big-play headline. Cards stack newest-first and fade in, so the game
 * reads as a broadcast rather than a table appearing all at once. Keeps four:
 * each period emits one memo per team, so four holds the quarter just played
 * plus the one before it. */
export function pushPlayHeadline(container, text, tone = "") {
  const card = document.createElement("div");
  card.className = "play-card" + (tone ? ` ${tone}` : "");
  card.textContent = text;
  container.prepend(card);
  while (container.children.length > 4) container.removeChild(container.lastChild);
}

export function clearPlayFeed(container) {
  container.innerHTML = "";
}

// ---- Squads --------------------------------------------------------------

const SQUAD_EMOJI_CHOICES = [
  "🏀", "🔥", "⚡", "🐐", "🦁", "🐺", "🦅", "👑",
  "💎", "⭐", "🎯", "🛡️", "⚔️", "🌊", "🌪️", "☄️",
  "🚀", "🏆", "💀", "👹", "🐉", "🦈", "🍀", "🎮",
];

function smallBtn(text, onClick, extraClass) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-secondary btn-small" + (extraClass ? ` ${extraClass}` : "");
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

/** A row of emoji buttons for picking a squad's crest. Reused by both the
 * create-squad form and the in-place squad settings editor. Self-contained:
 * re-renders its own selection state in place on click rather than pushing
 * the pick up through a full-screen re-render, so it stays smooth to use. */
export function renderSquadEmojiPalette(container, selected, onSelect) {
  container.innerHTML = "";
  for (const emoji of SQUAD_EMOJI_CHOICES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "squad-emoji-choice" + (emoji === selected ? " active" : "");
    btn.textContent = emoji;
    btn.addEventListener("click", () => onSelect(emoji));
    container.appendChild(btn);
  }
}

/** Public squads browsable from the "Find a Squad" screen. Private squads
 * never appear here (see listPublicSquads in squads.js) - joining one needs
 * its invite code instead. */
export function renderSquadBrowseList(container, squads, onJoin) {
  container.innerHTML = "";
  if (!squads.length) {
    renderNote(container, "No public squads yet - be the first to create one!");
    return;
  }
  for (const squad of squads) {
    const card = document.createElement("div");
    card.className = "squad-card";

    const head = document.createElement("div");
    head.className = "squad-card-head";
    head.innerHTML =
      `<span class="squad-card-emoji" aria-hidden="true">${escapeHtml(squad.emoji)}</span>` +
      `<span class="squad-card-name">${escapeHtml(squad.name)} <span class="squad-card-tag">[${escapeHtml(squad.tag)}]</span></span>`;
    card.appendChild(head);

    if (squad.motto) {
      const motto = document.createElement("div");
      motto.className = "squad-card-motto";
      motto.textContent = squad.motto;
      card.appendChild(motto);
    }

    const meta = document.createElement("div");
    meta.className = "squad-card-meta";
    const tierName = squadTierForRep(squad.rep).name;
    meta.textContent = `${squad.memberCount} / ${squad.memberCap} members · ${tierName} · ${squad.rep} Rep`;
    card.appendChild(meta);

    const full = squad.memberCount >= squad.memberCap;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.textContent = full ? "Full" : "Join";
    btn.disabled = full;
    btn.addEventListener("click", () => onJoin(squad.id));
    card.appendChild(btn);

    container.appendChild(card);
  }
}

/** The squad detail header: crest, name/tag, motto, member count, Squad
 * Rep (a persistent trophy-style score - see squadRankInfo in squads.js),
 * and - leader/co-leader only - the invite code and an inline settings
 * editor. `data.editing` toggles the editor; callbacks.onToggleEdit flips it
 * via a full re-render (cheap, and matches how every other tab-like toggle
 * in this app already works), while the editor's own emoji pick is handled
 * in-place so typing a motto doesn't get interrupted by a re-render. */
export function renderSquadHeader(container, data, callbacks) {
  const { squad, myRole, memberCount, rankInfo, inviteCode, editing } = data;
  const canManage = myRole === "leader" || myRole === "co-leader";

  container.innerHTML = "";

  const top = document.createElement("div");
  top.className = "squad-header-top";
  top.innerHTML =
    `<span class="squad-header-emoji" aria-hidden="true">${escapeHtml(squad.emoji)}</span>` +
    `<div class="squad-header-titles">` +
    `<div class="squad-header-name">${escapeHtml(squad.name)} <span class="squad-header-tag">[${escapeHtml(squad.tag)}]</span></div>` +
    `<div class="squad-header-visibility">${squad.visibility === "public" ? "🌐 Public" : "🔒 Private"} · ${memberCount} / ${squad.memberCap} members</div>` +
    `</div>`;
  container.appendChild(top);

  if (squad.motto) {
    const motto = document.createElement("div");
    motto.className = "squad-header-motto";
    motto.textContent = squad.motto;
    container.appendChild(motto);
  }

  const rankWrap = document.createElement("div");
  rankWrap.className = "squad-rank-wrap";
  const badge = document.createElement("span");
  badge.className = "tier-badge";
  badge.textContent = rankInfo.tier.name;
  rankWrap.appendChild(badge);

  const track = document.createElement("div");
  track.className = "progress-bar-track";
  const fill = document.createElement("div");
  fill.className = "progress-bar-fill";
  const pct = rankInfo.next
    ? Math.min(100, (100 * (rankInfo.rep - rankInfo.tier.minRep)) / (rankInfo.next.minRep - rankInfo.tier.minRep))
    : 100;
  fill.style.width = `${pct}%`;
  track.appendChild(fill);
  rankWrap.appendChild(track);

  const caption = document.createElement("div");
  caption.className = "squad-rank-caption";
  // Rep only moves in squad-vs-squad tournaments, which aren't built yet, so
  // every squad is legitimately on 0 - say so rather than showing a dead
  // progress bar that looks like something is broken.
  caption.textContent =
    rankInfo.rep === 0
      ? "0 Rep — Rep is earned in squad tournaments, coming soon."
      : rankInfo.next
        ? `${rankInfo.rep} Rep — ${rankInfo.next.minRep - rankInfo.rep} more to reach ${rankInfo.next.name}`
        : `${rankInfo.rep} Rep — the top tier, Legend.`;
  rankWrap.appendChild(caption);
  container.appendChild(rankWrap);

  if (!canManage) return;

  const manage = document.createElement("div");
  manage.className = "squad-manage";

  const codeRow = document.createElement("div");
  codeRow.className = "squad-invite-row";
  const codeLabel = document.createElement("span");
  codeLabel.className = "squad-invite-label";
  codeLabel.textContent = "Invite code";
  const codeValue = document.createElement("span");
  codeValue.className = "squad-invite-code";
  codeValue.textContent = inviteCode || "—";
  codeRow.appendChild(codeLabel);
  codeRow.appendChild(codeValue);
  codeRow.appendChild(smallBtn("New Code", callbacks.onRegenerateCode));
  manage.appendChild(codeRow);

  const manageBtns = document.createElement("div");
  manageBtns.className = "squad-manage-buttons";
  manageBtns.appendChild(smallBtn(editing ? "Cancel Edit" : "Edit Squad", callbacks.onToggleEdit));
  if (myRole === "leader") {
    manageBtns.appendChild(smallBtn("Disband Squad", callbacks.onDisband, "btn-danger-small"));
  }
  manage.appendChild(manageBtns);

  if (editing) {
    const form = document.createElement("div");
    form.className = "squad-edit-form";

    let chosenEmoji = squad.emoji;
    const emojiPalette = document.createElement("div");
    emojiPalette.className = "squad-emoji-palette";
    form.appendChild(emojiPalette);
    const paintPalette = () => {
      renderSquadEmojiPalette(emojiPalette, chosenEmoji, (emoji) => {
        chosenEmoji = emoji;
        paintPalette();
      });
    };
    paintPalette();

    const mottoField = document.createElement("div");
    mottoField.className = "field-row";
    mottoField.innerHTML = `<label>Motto</label>`;
    const mottoInput = document.createElement("textarea");
    mottoInput.maxLength = 120;
    mottoInput.rows = 2;
    mottoInput.value = squad.motto;
    mottoField.appendChild(mottoInput);
    form.appendChild(mottoField);

    const visField = document.createElement("div");
    visField.className = "field-row";
    visField.innerHTML = `<label>Visibility</label>`;
    const visSelect = document.createElement("select");
    visSelect.innerHTML = `<option value="public">Public - anyone can join</option><option value="private">Private - invite code only</option>`;
    visSelect.value = squad.visibility;
    visField.appendChild(visSelect);
    form.appendChild(visField);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-primary";
    saveBtn.textContent = "Save Changes";
    saveBtn.addEventListener("click", () => {
      callbacks.onSaveSettings({ emoji: chosenEmoji, motto: mottoInput.value, visibility: visSelect.value });
    });
    form.appendChild(saveBtn);

    manage.appendChild(form);
  }

  container.appendChild(manage);
}

const SQUAD_ROLE_LABEL = { leader: "👑 Leader", "co-leader": "⭐ Co-Leader", member: "Member" };

/** Roster rows with role-appropriate actions: the leader can promote/demote/
 * transfer/kick anyone but themself, a co-leader can only kick plain
 * members, and a plain member sees no action buttons at all.
 *
 * `friendIds` is the set of user ids you already have a friendship row with
 * (accepted or pending), so the Add Friend button only appears where it would
 * actually do something. */
export function renderSquadRoster(container, roster, myUserId, myRole, callbacks, friendIds = new Set()) {
  container.innerHTML = "";
  for (const member of roster) {
    const row = document.createElement("div");
    row.className = "squad-roster-row";

    const info = document.createElement("div");
    info.className = "squad-roster-info";
    info.innerHTML =
      `<span class="squad-roster-name">${escapeHtml(member.username)}</span>` +
      `<span class="squad-roster-role">${SQUAD_ROLE_LABEL[member.role]}</span>` +
      `<span class="squad-roster-record">${member.onlineWins}-${member.onlineLosses} online</span>`;
    row.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "squad-roster-actions";
    const isSelf = member.userId === myUserId;

    // Squadmates are the people you're most likely to want as friends, and
    // the only way to add one used to be retyping their name on the Friends
    // tab. Hidden once a friendship or request already exists so the button
    // never invites a duplicate request the server would just reject.
    if (!isSelf && !friendIds.has(member.userId) && callbacks.onAddFriend) {
      actions.appendChild(smallBtn("+ Friend", () => callbacks.onAddFriend(member.username)));
    }

    if (!isSelf && myRole === "leader") {
      if (member.role === "member") {
        actions.appendChild(smallBtn("Promote", () => callbacks.onSetRole(member.userId, "co-leader")));
      }
      if (member.role === "co-leader") {
        actions.appendChild(smallBtn("Demote", () => callbacks.onSetRole(member.userId, "member")));
      }
      actions.appendChild(smallBtn("Make Leader", () => callbacks.onTransfer(member.userId)));
      actions.appendChild(smallBtn("Kick", () => callbacks.onKick(member.userId), "btn-danger-small"));
    } else if (!isSelf && myRole === "co-leader" && member.role === "member") {
      actions.appendChild(smallBtn("Kick", () => callbacks.onKick(member.userId), "btn-danger-small"));
    }
    row.appendChild(actions);

    container.appendChild(row);
  }
}

/** Chat pane. Preserves scroll position unless the reader was already at
 * the bottom, so a poll landing while they've scrolled up to read history
 * doesn't yank the view back down. */
export function renderSquadChat(container, messages, myUserId) {
  const wasAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 20;
  container.innerHTML = "";
  if (!messages.length) {
    renderNote(container, "No messages yet - say hello!");
  } else {
    for (const msg of messages) {
      const row = document.createElement("div");
      row.className = "squad-chat-message" + (msg.user_id === myUserId ? " mine" : "");
      const time = new Date(msg.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      row.innerHTML =
        `<span class="squad-chat-author">${escapeHtml(msg.username)}</span>` +
        `<span class="squad-chat-time">${time}</span>` +
        `<div class="squad-chat-body">${escapeHtml(msg.body)}</div>`;
      container.appendChild(row);
    }
  }
  if (wasAtBottom) container.scrollTop = container.scrollHeight;
}

// ---- Squads top-level subtabs: Friends | Home | Chat | Tournaments ------

const SQUADS_TOP_TABS = [
  { id: "friends", label: "Friends" },
  { id: "home", label: "Home" },
  { id: "chat", label: "Chat" },
  { id: "tournaments", label: "Tournaments" },
];

export function renderSquadsTopTabs(container, active, onSelect) {
  container.innerHTML = "";
  for (const tab of SQUADS_TOP_TABS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "subtab" + (tab.id === active ? " active" : "");
    btn.textContent = tab.label;
    btn.addEventListener("click", () => onSelect(tab.id));
    container.appendChild(btn);
  }
}

// ---- Friends --------------------------------------------------------------

/** Open challenges (created via challengeFriend, not yet entered) where the
 * caller is a participant - "X challenged you" if they didn't start it,
 * "Waiting on X" if they did (opening it just re-enters the same draft). */
export function renderFriendChallenges(container, challenges, onJoin) {
  container.innerHTML = "";
  if (!challenges.length) {
    renderNote(container, "No open challenges.");
    return;
  }
  for (const c of challenges) {
    const row = document.createElement("div");
    row.className = "friend-row";
    const info = document.createElement("span");
    info.textContent = c.iChallenged ? `Waiting on ${c.opponentUsername}` : `${c.opponentUsername} challenged you!`;
    row.appendChild(info);
    row.appendChild(smallBtn(c.iChallenged ? "Open" : "Join", () => onJoin(c.matchId)));
    container.appendChild(row);
  }
}

/** Incoming (accept/decline) and outgoing (cancel) friend requests in one
 * list, distinguished by which action they offer - there's rarely more
 * than one or two of either at a time, so a shared list reads fine. */
export function renderFriendRequests(container, incoming, outgoing, callbacks) {
  container.innerHTML = "";
  if (!incoming.length && !outgoing.length) {
    renderNote(container, "No pending requests.");
    return;
  }
  for (const r of incoming) {
    const row = document.createElement("div");
    row.className = "friend-row";
    const info = document.createElement("span");
    info.textContent = `${r.username} wants to be friends`;
    row.appendChild(info);
    const actions = document.createElement("div");
    actions.className = "friend-row-actions";
    actions.appendChild(smallBtn("Accept", () => callbacks.onAccept(r.requesterId)));
    actions.appendChild(smallBtn("Decline", () => callbacks.onDecline(r.requesterId), "btn-danger-small"));
    row.appendChild(actions);
    container.appendChild(row);
  }
  for (const r of outgoing) {
    const row = document.createElement("div");
    row.className = "friend-row";
    const info = document.createElement("span");
    info.textContent = `Request sent to ${r.username}`;
    row.appendChild(info);
    row.appendChild(smallBtn("Cancel", () => callbacks.onCancel(r.addresseeId), "btn-danger-small"));
    container.appendChild(row);
  }
}

/** Accepted friends ranked among themselves by online win rate (see
 * listFriendsLeaderboard in friends.js) - your own row is included so
 * "where do I stand against my friends" doesn't need a second screen. */
export function renderFriendsLeaderboard(container, entries, callbacks) {
  container.innerHTML = "";
  if (entries.length <= 1) {
    renderNote(container, "Add some friends to build a leaderboard.");
    return;
  }
  entries.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = "friend-row friend-leaderboard-row" + (entry.isMe ? " mine" : "");

    const rank = document.createElement("span");
    rank.className = "friend-rank";
    rank.textContent = `#${i + 1}`;
    row.appendChild(rank);

    // Each player's equipped banner, at thumbnail size - the leaderboard was
    // the one place friends are listed side by side with no sign of what
    // anyone has actually earned, which is the whole point of banners.
    const banner = entry.equippedBanner ? bannerById(entry.equippedBanner) : null;
    if (banner) {
      const art = bannerArt(banner);
      art.classList.add("friend-banner");
      art.title = banner.name;
      row.appendChild(art);
    }

    // Name and record split into their own lines rather than one run-on
    // string ("Name — 3-1 (75%)") - the record reads as a stat, not a
    // continuation of the name, and it no longer visually collides with the
    // rank/action buttons when the row wraps on a narrow screen.
    const identity = document.createElement("div");
    identity.className = "friend-identity";

    const name = document.createElement("span");
    name.className = "friend-name";
    name.textContent = entry.username + (entry.isMe ? " (you)" : "");
    identity.appendChild(name);

    const record = document.createElement("span");
    record.className = "friend-record";
    const pct = entry.gamesPlayed > 0 ? `${Math.round(100 * entry.winRate)}%` : "—";
    record.textContent = `${entry.onlineWins}-${entry.onlineLosses} online · ${pct} win rate`;
    identity.appendChild(record);

    row.appendChild(identity);

    if (!entry.isMe) {
      const actions = document.createElement("div");
      actions.className = "friend-row-actions";
      actions.appendChild(smallBtn("Challenge", () => callbacks.onChallenge(entry.userId)));
      actions.appendChild(smallBtn("Remove", () => callbacks.onRemove(entry.userId), "btn-danger-small"));
      row.appendChild(actions);
    }

    container.appendChild(row);
  });
}
