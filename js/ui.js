// Rendering helpers. Pure-ish functions: given data + a container element
// (and callbacks), they redraw that container's contents.

import { MIN_SEARCH_CHARS } from "./constants.js";
// Slot lists are still basketball's: they are default PARAMETER values, so
// they resolve at module load, before a sport is chosen. Everything else
// here is called at render time and goes through the active sport.
import { SPORTS, sportById, eraRecordKey, DEFAULT_SPORT_ID, activeSport } from "./sports/index.js";
import { eligibleOpenSlots, resolveTypedInput, normalizeName } from "./draft.js";
import {
  mostDraftedPlayer,
  mostTripleDoubles,
  winStreaks,
  historyFor,
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

/** Default roster shape: the ACTIVE SPORT's, never basketball's.
 *
 * These defaults used to be imported straight from js/sports/nba/constants.js,
 * so any caller that forgot to pass its slots silently got basketball's - which
 * is how an NFL draft came to deal PG/SG/SF/PF/C off a Cowboys roster. Evaluated
 * per call, so it follows whichever sport is live rather than whatever was
 * loaded first. */
const defaultSlots = () => activeSport().slots.quickPlay;
const defaultStarters = () => activeSport().slots.starters;

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

/** "2023 Mavericks" - which version of a player is actually on the roster.
 *
 * The year is the point. Two people can both draft Doncic off the Mavs 2020s
 * and end up with different players, so a card reading only "Luka Doncic
 * (Dallas Mavericks 2020s)" hides the half of the pick that was a decision.
 *
 * Nickname rather than the full team name because the season goes in front of
 * it and "2023 Dallas Mavericks" is a mouthful that wraps on a phone. The last
 * word is how every one of these teams is spoken about - Mavericks, Lakers,
 * Blazers, SuperSonics - so it needs no lookup table to stay right.
 *
 * Falls back to the decade for any row with no season, so a dataset that
 * hasn't been rebuilt still renders something true.
 */
function seasonLabel(player) {
  const nickname = String(player.team || "").split(" ").pop();
  return `${player.season || player.decade} ${nickname}`;
}

/**
 * @param eligibleSlotsForPendingPlayer null when no player is pending yet
 *   (all slots shown as plain status, none clickable) - or an array of the
 *   pending player's eligible open slots (those glow and are clickable;
 *   other open slots dim since they don't apply to this player).
 */
export function renderPositionSelector(container, roster, eligibleSlotsForPendingPlayer, onSelect, slots = defaultSlots()) {
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
/**
 * "Patrick Mahomes" -> "P. Mahomes".
 *
 * Only for PEOPLE. A drafted unit's name is a team and a position group
 * ("Carolina Panthers Defensive Line") and initialising that would produce
 * "C. Panthers Defensive Line", which is worse than the problem.
 */
function shortPlayerName(player) {
  if (Array.isArray(player.members) && player.members.length) return player.name;
  const parts = String(player.name || "").trim().split(/\s+/);
  if (parts.length < 2) return player.name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

export function renderRosterPanel(container, roster, label, isTurn, opts = {}) {
  const { pendingSlots = [], revealSlots = [], slots = defaultSlots() } = opts;
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
      // COMPACT, when the sport asks for it. Football's rows carry a full name,
      // a season and a team, and on a phone that wrapped to three lines and
      // became unreadable at a glance - which matters most when you are trying
      // to size up an opponent's roster. The first name becomes an initial and
      // the season drops to its own line, so the eye gets "P. Mahomes" then
      // "2020 Chiefs" instead of one long wrap. Declared per sport, so
      // basketball's rows are untouched.
      if (activeSport().compactRoster) {
        const head = document.createElement("span");
        head.className = "slot-name";
        head.textContent = `${shortPlayerName(player)}${pos}`;
        value.appendChild(head);
        const when = document.createElement("span");
        when.className = "slot-season";
        when.textContent = seasonLabel(player);
        value.appendChild(document.createElement("br"));
        value.appendChild(when);
      } else {
        value.textContent = `${player.name}${pos} — ${seasonLabel(player)}`;
      }
      // A drafted unit says WHO it contains. "Seattle Seahawks Cornerbacks"
      // names a slot; Sherman and Maxwell are what you actually took, and
      // after the pick is made the roster is the only place left to see it.
      const roll = Array.isArray(player.members) ? player.members : [];
      if (roll.length) {
        const who = document.createElement("span");
        who.className = "slot-members";
        who.textContent = roll.slice(0, 4).map((m) => m.name || m).join(", ");
        value.appendChild(document.createElement("br"));
        value.appendChild(who);
      }
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
function renderPlayerCard(container, p, roster, pendingPlayerName, onPick, showStats = false, slots = defaultSlots(), seasons = [p], onPickSeason = null, allPos = null) {
  // Eligibility uses every position this player held across the seasons on
  // offer, without reshaping the player object the draft will validate.
  const positions = allPos || p.pos || [];
  const eligibleSlots = eligibleOpenSlots({ ...p, pos: positions }, roster, slots);
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
  for (const pos of positions) {
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
    // Falls back rather than throwing. A missing hook used to take the whole
    // draft board down with it - one undefined function and the render died
    // mid-list, leaving an empty screen with no error anyone would see.
    const line = activeSport().cardStatLine;
    stats.textContent = typeof line === "function" ? line(p) : "";
    wrap.appendChild(stats);
    card.appendChild(wrap);
  } else {
    card.appendChild(name);
  }

  // A player with more than one draftable season on this squad says so, and
  // clicking opens the year picker rather than drafting immediately. One card
  // per PLAYER, not per season: seven identical "Luka Doncic" cards is not a
  // choice, it's a puzzle about which one the game meant.
  if (seasons.length > 1) {
    const hint = document.createElement("span");
    hint.className = "player-card-seasons";
    hint.textContent = `${seasons.length} seasons`;
    card.appendChild(hint);
  }

  if (eligible) {
    card.addEventListener("click", () => (seasons.length > 1 ? onPickSeason(p, seasons, showStats) : onPick(p)));
  }
  container.appendChild(card);
}

/**
 * Groups a squad's rows into one entry per player.
 *
 * Rows are per season now (see tools/build-nba-data.mjs), so a name resolves
 * to every year that player spent with this team in this era. The draft board
 * shows the player once; which year is a second, separate decision.
 *
 * Order within a group is by season so the picker reads as a career.
 */
export function groupBySeason(rows) {
  const byPlayer = new Map();
  for (const row of rows) {
    if (!byPlayer.has(row.name)) byPlayer.set(row.name, []);
    byPlayer.get(row.name).push(row);
  }
  return [...byPlayer.values()].map((seasons) => {
    // The representative card. The most-played season, so the name on the
    // board carries that player's defining year with this team rather than
    // whichever one happened to sort first.
    const lead = [...seasons].sort((a, b) => (b.games || 0) - (a.games || 0))[0];
    // Positions are the UNION across his seasons, because a player who moved
    // position is eligible wherever ANY of his drafted years could play.
    // Kyshawn George is listed SG in 2024 and SF in 2025: the card led with
    // one of those, so he was rejected at the other slot - while an opponent
    // whose lead season happened to be the other year could take him there.
    // Same player, same board, two different answers.
    // The union goes BESIDE the lead, not over it. Spreading it into a copy
    // broke the draft outright: makePick validates by object identity, so a
    // fresh object is not in squad.players and every click was silently
    // rejected. `lead` stays the row the squad actually holds.
    const pos = [...new Set(seasons.flatMap((r) => r.pos || []))];
    return {
      lead,
      pos,
      seasons: [...seasons].sort((a, b) => (a.season || 0) - (b.season || 0)),
    };
  });
}

function renderNote(container, text, tierClass) {
  const note = document.createElement("div");
  note.className = "empty-note" + (tierClass ? ` ${tierClass}` : "");
  note.textContent = text;
  container.appendChild(note);
}

/** The user-facing half of a pool render failure. Declared before its use
 * rather than after it - reading an identifier that is not bound yet is the
 * exact bug this block exists to report. Exported so the tests assert on the
 * real string instead of a copy that can drift out of step with it. */
export const POOL_RENDER_ERROR_MESSAGE =
  "Something went wrong showing the players for this squad. Your pick timer is paused \u2014 please report this.";

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
 *
 * Returns `{ ok: true }`, or `{ ok: false, error }` if rendering threw - the
 * pool shows POOL_RENDER_ERROR_MESSAGE in that case and the caller is
 * expected to stop the pick timer. Callers must not ignore the result.
 */
export function renderPool(
  container,
  squad,
  filterText,
  roster,
  pendingPlayerName,
  onPick,
  allPlayers,
  ruleset = "strict",
  slots = defaultSlots(),
  onPickSeason = null
) {
  container.innerHTML = "";
  try {
    renderPoolContents(
      container, squad, filterText, roster, pendingPlayerName,
      onPick, allPlayers, ruleset, slots, onPickSeason
    );
    return { ok: true };
  } catch (error) {
    // A throw in here used to be indistinguishable from "nothing matched":
    // the container had already been emptied, so the draft board sat blank
    // with a running pick timer and no console anyone would look at. The
    // error is NOT swallowed - it is logged with the state needed to
    // reproduce it, and returned to the caller, whose job is to stop the
    // timer rather than charge the player for a screen they cannot use.
    console.error("Draft pool render failed:", error, {
      ruleset,
      filterText,
      squad: squad ? `${squad.team} ${squad.decade}` : null,
      squadSize: squad && squad.players ? squad.players.length : 0,
      openSlots: slots,
    });
    container.innerHTML = "";
    // Useful, and says what happens next, without naming a function or
    // leaking a stack to someone who only wanted to draft a player.
    renderNote(container, POOL_RENDER_ERROR_MESSAGE, "pool-error-note");
    return { ok: false, error };
  }
}

function renderPoolContents(
  container,
  squad,
  filterText,
  roster,
  pendingPlayerName,
  onPick,
  allPlayers,
  ruleset,
  slots,
  onPickSeason
) {
  // Easy practice puts the whole squad on screen with stats - it's for
  // learning the pool, not testing recall. The search box still narrows the
  // list, it just isn't the only way to see anyone.
  if (ruleset === "easy") {
    // Through normalizeName, not a bare toLowerCase: the dataset spells names
    // properly, so a raw substring match hides Doncic from anyone typing
    // "doncic" here exactly as it did in the ranked search.
    const q = normalizeName(filterText);
    const players = q ? squad.players.filter((p) => normalizeName(p.name).includes(q)) : squad.players;
    if (players.length === 0) {
      renderNote(container, "No players on this squad match that search.");
      return;
    }
    // Best first. Practice mode is for LEARNING a squad, and alphabetical or
    // dataset order buries the players worth knowing among the ones who took
    // twelve snaps. Sorted by the sport's own rating, so the top of the list is
    // the answer to "who mattered on this team" - which is the thing a player
    // is here to find out.
    //
    // Ranked is deliberately NOT sorted: there is no list there to sort, and
    // handing over a ranked-by-quality board would replace recall with reading.
    const rate = activeSport().rate;
    const grouped = groupBySeason(players);
    if (typeof rate === "function") {
      const best = new Map();
      for (const g of grouped) {
        // A player is worth what his BEST drafted season is worth, not his
        // average - you can pick that season, so it is what he offers.
        best.set(g, Math.max(...g.seasons.map((p) => rate(p) ?? 0)));
      }
      grouped.sort((a, b) => best.get(b) - best.get(a));
    }
    for (const { lead, pos, seasons } of grouped) {
      renderPlayerCard(container, lead, roster, pendingPlayerName, onPick, true, slots, seasons, onPickSeason, pos);
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
    // `pos` is the union of positions across the seasons on offer, and every
    // one of these three has to stay bound - reading one without binding it is
    // a ReferenceError in a module, thrown after the container was emptied,
    // which reaches the player as a blank board rather than as an error.
    for (const { lead, pos, seasons } of groupBySeason(result.candidates)) {
      renderPlayerCard(container, lead, roster, pendingPlayerName, onPick, false, slots, seasons, onPickSeason, pos);
    }
    return;
  }

  if (result.tier === "elsewhere") {
    // Grouped, or a player with six seasons elsewhere would be listed six times.
    const named = groupBySeason(result.candidates)
      .map(({ lead }) => `${lead.name} (${lead.team} ${lead.decade})`)
      .join(", ");
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

/**
 * The team line under a box score: what the roster did ADDED UP, and the
 * shooting percentages that only exist at the team level.
 *
 * A box score of ten individual lines does not answer "how did we shoot",
 * which is the first thing anyone asks about a basketball game. Summed here
 * rather than stored, because a stored team total is a second copy of numbers
 * the rows already carry, and the two drift.
 *
 * Percentages come from the SHOT SPLITS, which are only present once a game is
 * final - live, the splits do not exist yet and the row shows totals alone
 * rather than inventing a percentage from nothing. A sport that declares no
 * splitColumns (football) simply gets the totals.
 */
function boxTotalsRow(roster, box, columns, showMinutes, splits, shotLines, minutesMap) {
  const slots = rosterSlots(roster).filter((slot) => box[slot]);
  const sum = (pick) => slots.reduce((total, slot) => total + (Number(pick(slot)) || 0), 0);

  const cells = columns
    .map(([key, , derive]) => {
      // A derived column is derived PER ROW, so summing the rows is right and
      // re-deriving from team totals would not be - total yards per player is
      // not the same shape of number as a team's.
      const total = sum((slot) => (typeof derive === "function" ? derive(box[slot]) : box[slot][key]));
      return `<td>${r(total)}</td>`;
    })
    .join("");

  const splitCells = splits
    .map(([key]) => {
      if (!shotLines) return "<td>-</td>";
      const makes = sum((slot) => shotLines[slot]?.[`${key}m`]);
      const attempts = sum((slot) => shotLines[slot]?.[`${key}a`]);
      if (!attempts) return "<td>-</td>";
      // Makes/attempts AND the percentage. The split alone makes you do the
      // division; the percentage alone hides how much volume it rests on, and
      // 2/3 is not the same claim as 40/60.
      const pct = Math.round((makes / attempts) * 1000) / 10;
      return `<td>${r(makes)}/${r(attempts)}<span class="box-pct">${pct.toFixed(1)}%</span></td>`;
    })
    .join("");

  return (
    `<tr class="box-totals"><td>TEAM</td><td>${slots.length} players</td>` +
    (showMinutes ? `<td>${minutesMap ? r(sum((slot) => minutesMap[slot])) : "-"}</td>` : "") +
    cells +
    splitCells +
    `</tr>`
  );
}

function boxRow(slotLabel, player, line, shots, minutes, columns, showMinutes = true, splits = [], isMvp = false) {
  // The year, not the decade. This row is claiming 45 points were scored, and
  // the 2017 Isaiah Thomas and the 2010s Celtics average of him are different
  // players - naming the wrong one makes the line unverifiable.
  //
  // Full team name rather than seasonLabel()'s nickname: this table is wide,
  // and the nickname exists only to stop draft cards wrapping on a phone.
  const era = player.season || player.decade || "";
  const meta = player.team ? `<div class="box-meta">${escapeHtml(player.team)} ${escapeHtml(String(era))}</div>` : "";
  // Cells come from the SPORT's column list. A value of 0 shows as 0 and a
  // missing one shows a dash, because "nothing" and "did not do this" are
  // different claims - a cornerback with no passing yards has not thrown for
  // zero, he never dropped back.
  // A column may DERIVE its value rather than read it. Total yards is the
  // clearest case: it is pass + rush + receiving for one man, which is a real
  // thing to rank offensive performances by and emphatically not a stat the
  // ledger stores - storing it would put a second, addable copy of yardage
  // next to the plays that produced it.
  const cells = columns
    .map(([key, , derive]) => {
      const v = typeof derive === "function" ? derive(line) : line[key];
      return `<td>${v === undefined || v === null ? "-" : r(v)}</td>`;
    })
    .join("");
  // The MVP's row is marked with a star as well as a tint. The tint alone
  // would be the only thing saying "this is the best line in the table", and a
  // faint background is exactly what a low-contrast screen, a bright room or a
  // colourblind reader loses first.
  const mvpStar = isMvp ? `<span class="box-mvp-star" title="Most valuable player" aria-label="Most valuable player">\u2605</span> ` : "";
  return (
    `<tr${isMvp ? ' class="box-mvp"' : ""}><td>${slotLabel}</td><td>${mvpStar}${escapeHtml(player.name)}${meta}</td>` +
    (showMinutes ? `<td>${minutes == null ? "-" : r(minutes)}</td>` : "") +
    cells +
    splits
      .map(([key]) => `<td>${shots ? splitCell(shots[`${key}m`], shots[`${key}a`]) : "-"}</td>`)
      .join("") +
    `</tr>`
  );
}

/**
 * One team's box score, split into the groups the sport declares.
 *
 * A football box score is three different tables wearing one hat. A
 * quarterback, a cornerback and a kicker share almost no columns, so a single
 * flat table gives every one of them a row of dashes across the other two
 * thirds - which is how football ended up with a table that was mostly empty
 * no matter how well anyone played. A sport that declares `boxGroups` gets one
 * sub-table per group with only that group's columns; one that does not keeps
 * the single table, which is what basketball wants.
 */
function boxGroupTables(roster, box, teamLabel, final, mvpName = null) {
  const sport = activeSport();
  let html = `<div class="team-heading">${teamLabel}</div>`;
  for (const group of sport.boxGroups) {
    const slots = rosterSlots(roster).filter(
      (slot) => box[slot] && group.slots.includes(sport.basePosition(slot))
    );
    if (!slots.length) continue;
    // Ranked only once the game is OVER. Mid-game the rows have to stay put or
    // the table reorders itself under the reader every few seconds as it fills
    // in; at the final whistle the leading performance belongs at the top.
    const ordered = final && group.rank
      ? [...slots].sort((a, b) => group.rank(box[b]) - group.rank(box[a]))
      : slots;
    html +=
      `<div class="box-group-label">${escapeHtml(group.label)}</div>` +
      `<table class="box-table"><thead><tr><th>Slot</th><th>Player</th>` +
      group.columns.map(([, head]) => `<th>${head}</th>`).join("") +
      `</tr></thead><tbody>`;
    for (const slot of ordered) {
      html += boxRow(slotLabel(slot), roster[slot], box[slot], null, null, group.columns, false, [],
                     !!mvpName && roster[slot]?.name === mvpName);
    }
    html += "</tbody></table>";
  }
  return html;
}

function boxTable(roster, box, teamLabel, shotLines, minutesMap, final, mvpName = null) {
  const sport = activeSport();
  if (Array.isArray(sport.boxGroups) && sport.boxGroups.length) {
    return boxGroupTables(roster, box, teamLabel, final, mvpName);
  }
  const columns = sport.boxColumns;
  // MIN and the shooting splits are basketball's, and only basketball's - a
  // sport with no rotation has no minutes column and no three-point line.
  const showMinutes = (sport.rotationBudget || 0) > 0;
  // Declared, not inferred from whether the sport has a rotation - those are
  // two different facts that happen to coincide for basketball.
  const splits = sport.splitColumns || [];
  let html =
    `<div class="team-heading">${teamLabel}</div><table class="box-table"><thead><tr>` +
    `<th>Slot</th><th>Player</th>` +
    (showMinutes ? `<th>MIN</th>` : "") +
    columns.map(([, head]) => `<th>${head}</th>`).join("") +
    splits.map(([, head]) => `<th>${head}</th>`).join("") +
    `</tr></thead><tbody>`;
  // Mid-game, roster order (starters then bench) is what makes the table
  // readable as it fills in - rows aren't jumping around every tick. At the
  // final buzzer basketball re-sorts, because a finished box score reads top
  // scorer first.
  //
  // Football does not, and `sortBoxBy: null` is how a sport says so. It is
  // read by position - quarterback, backs, receivers - so the ranked sort put
  // the kicker above the quarterback on any night he outscored him. Declared
  // by the sport rather than branched on the sport's id, so the next sport
  // answers the question instead of shared code guessing.
  const slots = rosterSlots(roster).filter((slot) => box[slot]);
  const key = sport.sortBoxBy;
  const ordered = final && key ? [...slots].sort((a, b) => (box[b][key] || 0) - (box[a][key] || 0)) : slots;
  for (const slot of ordered) {
    html += boxRow(slotLabel(slot), roster[slot], box[slot], shotLines && shotLines[slot],
                   minutesMap && minutesMap[slot], columns, showMinutes, splits,
                   !!mvpName && roster[slot]?.name === mvpName);
  }
  html += "</tbody>";
  // In a <tfoot> rather than a last <tr>, so the team line is structurally the
  // summary of the table and not another player in it - which is also what
  // lets it stay put if the table is ever made scrollable vertically.
  html += `<tfoot>${boxTotalsRow(roster, box, columns, showMinutes, splits, shotLines, minutesMap)}</tfoot>`;
  html += "</table>";
  return html;
}

/** @param mvp optional {side:"A"|"B", name} - marks that player's row. Matched
 * by name WITHIN the winning side's roster rather than globally, so the same
 * player drafted by both teams only stars on the side that earned it. */
export function renderFullBoxScore(container, rosterA, boxA, labelA, rosterB, boxB, labelB, shotsA, shotsB, minutesA, minutesB, final = false, mvp = null) {
  const mvpA = mvp && mvp.side === "A" ? mvp.name : null;
  const mvpB = mvp && mvp.side === "B" ? mvp.name : null;
  container.innerHTML =
    boxTable(rosterA, boxA, labelA, shotsA, minutesA, final, mvpA) +
    boxTable(rosterB, boxB, labelB, shotsB, minutesB, final, mvpB);
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
  // Split by side so each score can wear its own team's kit colour. Both
  // digits were one class and therefore one colour, which is why the board
  // carried no team identity at all - the thing the kits were built for.
  // Each name sits directly above ITS OWN score. They used to be laid out
  // name / score / score / name across one row, which put both numbers in the
  // middle and both names at the far edges - so a glance had to travel to the
  // rim of the board to find out whose 80 that was.
  const scoreClass = "scoreboard-score" + (isLive ? " pulse" : "");
  teams.innerHTML = `
    <div class="scoreboard-side scoreboard-side-a">
      <span class="scoreboard-team-name">${labelA}</span>
      <span class="${scoreClass} scoreboard-score-a">${Math.round(totalA)}</span>
    </div>
    <div class="scoreboard-middle"></div>
    <div class="scoreboard-side scoreboard-side-b">
      <span class="scoreboard-team-name">${labelB}</span>
      <span class="${scoreClass} scoreboard-score-b">${Math.round(totalB)}</span>
    </div>
  `;
  container.appendChild(teams);

  // The status belongs BETWEEN the scores, where a real board puts the period
  // and where the eye already is. It used to sit on its own line underneath,
  // which left the middle of the board holding nothing but a dash.
  const period = document.createElement("div");
  period.className = "scoreboard-period" + (isLive ? " live" : "");
  period.textContent = statusLabel;
  teams.querySelector(".scoreboard-middle").appendChild(period);

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

/** Whether each artwork URL loaded. Checked once - renderHomeHeader runs on
 *  every refreshHome(), and re-fetching the same file to ask the same question
 *  would be waste. `null` while in flight, so a slow load cannot queue a
 *  second probe for the same URL. */
const artLoadCache = new Map();

/** Drops the card back to the banner's own two colours when its artwork cannot
 *  be loaded - the same fallback the Rewards tiles use.
 *
 *  Worth having rather than trusting the files: the card paints the art on a
 *  layer over its own background, so without this a missing file leaves an
 *  empty layer covering the fallback, and the card renders as a blank slab. It
 *  earned its keep the day a banner was renamed in the browser and its file
 *  arrived two bytes long.
 *
 *  Whether the file is big enough is NOT checked here. That was the job of an
 *  earlier version, back when the artwork was too small to fill the card and
 *  the layout had a second treatment to fall back on. There is no second
 *  treatment now, and a size problem is better caught before it ships:
 *  scripts/verify-banner-resolution.mjs fails the build for it. */
function applyArtFallback(card, src) {
  if (artLoadCache.has(src)) {
    if (artLoadCache.get(src) === false) card.classList.remove("has-banner-image");
    return;
  }
  artLoadCache.set(src, null);
  const probe = new Image();
  probe.onload = () => artLoadCache.set(src, true);
  probe.onerror = () => {
    artLoadCache.set(src, false);
    // The card may have re-rendered onto a different banner while we waited.
    if (card.style.getPropertyValue("--banner-image").includes(src)) {
      card.classList.remove("has-banner-image");
    }
  };
  probe.src = src;
}

/** Adds or removes one of the card's background layers. Reused rather than
 *  recreated for the same reason as setCardMark: this runs on every
 *  refreshHome(), and appending would stack a new layer per refresh. */
function setCardLayer(card, className, on) {
  let el = card.querySelector(`.${className}`);
  if (!on) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.className = className;
    // Decoration, not content. The card already announces the equipped banner
    // in text, so a screen reader gains nothing from two empty divs.
    el.setAttribute("aria-hidden", "true");
    // First, so the layers paint under the name, badges and stats rather than
    // over them - the card's children are z-index 1.
    card.prepend(el);
  }
  return el;
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
    // Resolved against the DOCUMENT, not left relative. A relative url() inside
    // a custom property resolves against the STYLESHEET that consumes it, so
    // "assets/banners/X.jpg" became "css/assets/banners/X.jpg" and 404'd - the
    // card silently fell back to its gradient. The tiles never hit this because
    // they set an <img src>, which resolves against the document. baseURI
    // rather than a leading slash, since Pages serves this from /Gamebuild/.
    if (franchise.image) {
      const src = new URL(franchise.image, document.baseURI).href;
      refs.card.style.setProperty("--banner-image", `url("${src}")`);
      applyArtFallback(refs.card, src);
    } else {
      refs.card.style.removeProperty("--banner-image");
    }
    // The artwork is the card. It is painted on a layer rather than on the card
    // itself so that a file which fails to load falls back to the card's own
    // background instead of covering it - see applyArtFallback above.
    setCardLayer(refs.card, "pb-banner-wash", !!franchise.image);
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
    setCardLayer(refs.card, "pb-banner-wash", false);
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
  // The name as a HEADING, not only as the value of a text box. The input is
  // still the way to change it - it just lives under "Account settings" now,
  // and a profile whose only statement of who you are is an editable field
  // reads as a form rather than as yours.
  if (refs.displayName) refs.displayName.textContent = profile.username || "Player";
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
              `${label} — ${escapeHtml(best.season ? `${best.season} ${best.playerName}` : best.playerName)}`,
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

  // A TRIPLE-DOUBLE IS BASKETBALL'S. It was rendered unconditionally, so the
  // football tab carried a row for a thing football does not have and can
  // never record - permanently a dash, and a dash that reads as "you have not
  // done this yet" rather than "this does not exist here". The sport says
  // whether it has a signature record; one that does not gets no row.
  if (sport.signatureRecord) {
    const holder = mostTripleDoubles(profile, sport.id);
    refs.mostTripleDoubles.hidden = false;
    refs.mostTripleDoubles.innerHTML = holder
      ? `<div class="performance-row"><span>${escapeHtml(sport.signatureRecord.label)} — ${escapeHtml(holder.name)}</span><span class="performance-line">${holder.count}x</span></div>`
      : `<div class="performance-row"><span>${escapeHtml(sport.signatureRecord.label)}</span><span class="performance-line">—</span></div>`;
  } else {
    refs.mostTripleDoubles.innerHTML = "";
    refs.mostTripleDoubles.hidden = true;
  }

  // Scoped to this sport: a football win did not extend a basketball streak.
  const streaks = winStreaks(profile, sport.id);
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
  const scopedHistory = historyFor(profile, sport.id);
  for (const entry of scopedHistory.games) {
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
  if (!scopedHistory.games.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" class="empty-note">No ${escapeHtml(sport.name)} games played yet.</td>`;
    refs.historyBody.appendChild(tr);
  }
  // Said out loud rather than quietly dropped. These are games from before
  // history recorded which sport it was, and there is no honest way to assign
  // them - so they are counted and named instead of being guessed into one
  // sport's list.
  if (scopedHistory.unattributed > 0) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td colspan="4" class="empty-note">${scopedHistory.unattributed} earlier game` +
      `${scopedHistory.unattributed === 1 ? "" : "s"} predate per-sport history and are not shown under any sport.</td>`;
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
  // The same element serves both pickers, so the grouped layout has to come
  // back off when a single-plan sport renders into it.
  container.classList.remove("strategy-groups");
  for (const tactic of tacticsToShow) {
    container.appendChild(tacticCard(tactic, selectedId, onSelect));
  }
}

/**
 * A sport whose strategy is more than one decision - football picks how it
 * attacks AND how it defends - rendered a section per decision.
 *
 * Shared UI does not know what the groups are. It reads whatever the sport
 * declared (see strategyGroups in js/sports/nfl/tactics.js) and lays each one
 * out with the same card the single-plan picker uses, so both sports keep one
 * visual language rather than football growing a second one.
 *
 * @param selection an object keyed by group, e.g. { offense: id, defense: id }
 * @param onSelect  (groupKey, planId)
 */
export function renderStrategyGroups(container, groups, selection, onSelect) {
  container.innerHTML = "";
  container.classList.add("strategy-groups");
  for (const group of groups || []) {
    const section = document.createElement("section");
    section.className = "strategy-group";

    const heading = document.createElement("h4");
    heading.className = "strategy-group-title";
    heading.textContent = group.label;
    section.appendChild(heading);

    if (group.hint) {
      const hint = document.createElement("p");
      hint.className = "strategy-group-hint";
      hint.textContent = group.hint;
      section.appendChild(hint);
    }

    const grid = document.createElement("div");
    grid.className = "tactic-grid strategy-group-grid";
    for (const plan of group.plans || []) {
      grid.appendChild(tacticCard(plan, selection?.[group.key], (id) => onSelect(group.key, id)));
    }
    section.appendChild(grid);
    container.appendChild(section);
  }
}

/** One plan card. Shared by both pickers so a football gameplan and a
 * basketball gamestyle are the same object on screen. */
function tacticCard(tactic, selectedId, onSelect) {
  {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tactic-card" + (tactic.id === selectedId ? " active" : "");

    const head = document.createElement("span");
    head.className = "tactic-head";
    head.textContent = `${tactic.icon} ${tactic.name}`;
    btn.appendChild(head);

    const blurb = document.createElement("span");
    blurb.className = "tactic-blurb";
    blurb.textContent = tactic.blurb || "";
    btn.appendChild(blurb);

    // What a plan BUYS and what it COSTS, side by side. A tradeoff you cannot
    // see is a guess rather than a decision, and these are the numbers the
    // simulation actually applies.
    //
    // A SIBLING OF THE BLURB, not a child of it. This was a <div> appended
    // inside a <span>, which is not valid nesting - a span is phrasing
    // content - and it inherited the blurb's line box, so every chip ran
    // together into "+2 Rushing+2 Ball Control-2 Explosive Plays". The
    // tradeoff was on screen and unreadable, which is the same as absent.
    if (tactic.up || tactic.down) {
      const trade = document.createElement("span");
      trade.className = "tactic-trade";
      for (const [items, cls] of [[tactic.up, "up"], [tactic.down, "down"]]) {
        for (const item of items || []) {
          const chip = document.createElement("span");
          chip.className = `tactic-trade-item ${cls}`;
          chip.textContent = item;
          trade.appendChild(chip);
        }
      }
      btn.appendChild(trade);
    }

    btn.addEventListener("click", () => onSelect(tactic.id));
    return btn;
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

// ---------------------------------------------------------------------------
// Football field playback
// ---------------------------------------------------------------------------
// The counterpart to basketball's quarter-by-quarter scoreboard reveal, and
// the reason the engine returns `drives` as a first-class value rather than a
// debug log. A quarter box score can say a team scored 14; it cannot say the
// drive stalled at the 40, or that the third receiver broke it open. This can.
//
// Reads only what the engine already returns - startYard, endYard, outcome,
// scorer, text - so there is nothing for the view to recompute and no second
// source of truth to disagree with the scoreboard.

/** Builds the static field: two banner endzones and the turf between them.
 * Called once per game; showDrive() then moves the ball within it. */
/**
 * Draws the football field the game is watched on.
 *
 * Everything here is field FURNITURE - the parts that do not move. What moves
 * (ball, line of scrimmage, first-down marker, the drive trail) is returned as
 * refs and positioned by showFootballEvent() per event, so playback never
 * rebuilds the DOM mid-game.
 *
 * The field is drawn left to right as 0..100 from A's own goal line. B drives
 * the other way, so B's yard numbers are mirrored at render time rather than
 * stored mirrored - the engine reports every drive from the DRIVING team's own
 * goal line, and rewriting that would make the box score and the field
 * disagree about where a drive started.
 */
export function renderFootballField(container, labelA, labelB) {
  container.innerHTML = "";
  container.classList.remove("hidden");

  const status = document.createElement("div");
  status.className = "ff-status";
  status.innerHTML =
    `<span class="ff-quarter"></span>` +
    `<span class="ff-clock"></span>` +
    `<span class="ff-score"></span>` +
    `<span class="ff-downdist"></span>` +
    // Whose ball it is, said in a chip rather than only in prose. The colour
    // and the side it sits on carry it for anyone not reading the words.
    `<span class="ff-possession"></span>`;

  const field = document.createElement("div");
  field.className = "ff-field";

  const left = document.createElement("div");
  left.className = "ff-endzone left";
  left.innerHTML = `<span>${escapeHtml(labelA)}</span>`;
  const right = document.createElement("div");
  right.className = "ff-endzone right";
  right.innerHTML = `<span>${escapeHtml(labelB)}</span>`;

  const turf = document.createElement("div");
  turf.className = "ff-turf";

  // A line every five yards, numbered every ten, counting in from both goal
  // lines the way a real field does - 10,20,30,40,50,40,30,20,10.
  for (let yard = 5; yard < 100; yard += 5) {
    const line = document.createElement("span");
    line.className = "ff-yardline" + (yard % 10 === 0 ? " major" : "") + (yard === 50 ? " midfield" : "");
    line.style.left = `${yard}%`;
    turf.appendChild(line);
    if (yard % 10 === 0) {
      const num = document.createElement("span");
      num.className = "ff-yardnum";
      num.style.left = `${yard}%`;
      num.textContent = String(yard <= 50 ? yard : 100 - yard);
      turf.appendChild(num);
    }
  }

  const trail = document.createElement("div");
  trail.className = "ff-drive";
  const firstDown = document.createElement("div");
  firstDown.className = "ff-firstdown";
  const scrimmage = document.createElement("div");
  scrimmage.className = "ff-scrimmage";
  const ball = document.createElement("div");
  ball.className = "ff-ball";
  ball.style.left = "50%";
  const arrow = document.createElement("div");
  arrow.className = "ff-arrow";

  turf.append(trail, firstDown, scrimmage, ball, arrow);
  field.append(left, turf, right);

  const call = document.createElement("div");
  call.className = "ff-call";

  container.append(status, field, call);
  return {
    container, turf, trail, ball, call, scrimmage, firstDown, arrow,
    quarter: status.querySelector(".ff-quarter"),
    clock: status.querySelector(".ff-clock"),
    score: status.querySelector(".ff-score"),
    downDist: status.querySelector(".ff-downdist"),
    possession: status.querySelector(".ff-possession"),
    labelA, labelB,
  };
}

/** Ordinal for the down. "1st and 10" - never "1th". */
function ordinalDown(down) {
  return ["", "1st", "2nd", "3rd", "4th"][down] || `${down}th`;
}

/**
 * Renders one timeline event onto the field.
 *
 * A pure function of the event: every event carries the whole field state, so
 * this never has to remember what came before. That is what stops the ball and
 * the chains drifting apart if playback is resumed or a frame is missed.
 */
export function showFootballEvent(refs, event, opts = {}) {
  if (!refs || !event) return;

  // WHOSE BALL IT IS, WITHOUT READING ANYTHING.
  //
  // The viewer is always side A, so possession is also the answer to "am I
  // attacking or defending right now" - which is the single most important
  // thing to know while watching and was previously only inferable from the
  // wording of the play description. The state goes on the container so the
  // field, the endzones and the status bar can all respond to one class
  // rather than each being told separately.
  if (refs.container) {
    const hasBall = event.possession === "A" || event.possession === "B";
    refs.container.classList.toggle("ff-user-offense", event.possession === "A");
    refs.container.classList.toggle("ff-user-defense", event.possession === "B");
    refs.container.classList.toggle("ff-no-possession", !hasBall);
  }
  if (refs.possession) {
    refs.possession.textContent = event.possession === "A"
      ? `▶ ${refs.labelA} ball`
      : event.possession === "B"
        ? `${refs.labelB} ball ◀`
        : "";
  }
  // A drives left to right, B right to left. Both are reported from their own
  // goal line, so B's are mirrored to place them on one shared field.
  const toPct = (yard) => (event.possession === "B" ? 100 - yard : yard);
  const onField = (v) => Math.max(0, Math.min(100, v));

  if (event.yard != null && event.possession) {
    const at = onField(toPct(event.yard));
    refs.ball.style.left = `${at}%`;
    refs.scrimmage.style.left = `${at}%`;
    refs.scrimmage.classList.remove("hidden");

    // The chains. Clamped to the goal line: a first-down marker cannot stand
    // in the end zone, and a drive inside the ten is playing for the score
    // rather than for the sticks.
    if (event.distance != null && event.down != null) {
      const dir = event.possession === "B" ? -1 : 1;
      const marker = onField(at + dir * event.distance);
      refs.firstDown.style.left = `${marker}%`;
      refs.firstDown.classList.toggle("hidden", marker <= 0 || marker >= 100);
    } else {
      refs.firstDown.classList.add("hidden");
    }

    if (event.fromYard != null) {
      const from = onField(toPct(event.fromYard));
      refs.trail.className = `ff-drive ${String(event.possession).toLowerCase()}`;
      refs.trail.style.left = `${Math.min(from, at)}%`;
      refs.trail.style.width = `${Math.abs(at - from)}%`;
    }

    refs.arrow.classList.remove("hidden");
    refs.arrow.classList.toggle("right", event.possession === "A");
    refs.arrow.classList.toggle("left", event.possession === "B");
    refs.arrow.style.left = `${at}%`;
  } else {
    // Between possessions there is no line of scrimmage to draw, and drawing
    // the last one would claim the ball is somewhere it is not.
    refs.scrimmage.classList.add("hidden");
    refs.firstDown.classList.add("hidden");
    refs.arrow.classList.add("hidden");
  }

  const periodName = event.quarter > 4 ? `OT${event.quarter - 4}` : `Q${event.quarter || 1}`;
  refs.quarter.textContent = periodName;
  refs.clock.textContent = opts.clock || "";
  refs.score.textContent = `${refs.labelA} ${Math.round(event.scoreA || 0)} — ${Math.round(event.scoreB || 0)} ${refs.labelB}`;
  refs.downDist.textContent =
    event.down && event.distance
      ? `${ordinalDown(event.down)} & ${event.distance}${event.possession ? ` · ${event.possession === "A" ? refs.labelA : refs.labelB}` : ""}`
      : "";

  const scored = (event.scoring || 0) > 0;
  refs.call.className =
    "ff-call" + (scored ? " score" : event.turnover ? " takeaway" : event.firstDown ? " first" : "");
  refs.call.textContent = event.text || "";
}

/** Football's box score columns. Basketball's six are hardcoded elsewhere in
 * this file; these are the ones a football line actually has. */
export const FOOTBALL_BOX_COLUMNS = [
  ["pass_yds", "PASS"], ["rush_yds", "RUSH"], ["rec_yds", "REC"],
  ["td", "TD"], ["ints", "INT"], ["fumbles", "FUM"], ["fgs", "FG"],
];

/**
 * Adds one period's line into a running total, for the stats this sport
 * actually keeps.
 *
 * The keys used to be basketball's six literals, spelled out at the call site.
 * A football game therefore accumulated `reb` and `ast` - which a football
 * period line does not have, so every one of them added `undefined` and turned
 * the running total into NaN - while never once adding a completion or a
 * passing yard, because nothing asked for them. The live table sat at zero
 * under a header promising numbers.
 *
 * `pts` leads the list because it is every sport's, and is what the scoreboard
 * is built on; the rest is whatever the sport declares in lineKeys.
 *
 * Every add is guarded. A period line legitimately omits a stat nobody
 * recorded that quarter, and a missing value must leave the total alone rather
 * than poison it - NaN in a box score is worse than a zero, because it
 * propagates and nothing downstream can tell where it started.
 */
export function accumulatePeriodStats(total, periodLine, keys) {
  if (!total || !periodLine) return total;
  for (const key of keys) {
    const value = Number(periodLine[key]);
    if (Number.isFinite(value)) total[key] = (Number(total[key]) || 0) + value;
  }
  return total;
}

/**
 * The stat keys the live box score accumulates for a sport: points, then
 * whatever that sport keeps. One place, so the seed and the accumulation
 * cannot disagree about which columns exist.
 *
 * DEDUPED, and that is not a detail. Basketball's lineKeys already begin with
 * `pts`, so the obvious ["pts", ...lineKeys] lists it twice and the
 * accumulator adds every point of every quarter to the running total twice -
 * a live NBA box score climbing to double the real score. Football's lineKeys
 * do not include it, which is exactly the kind of asymmetry that makes this
 * worth doing in one function instead of at each call site.
 */
export function liveStatKeys(sport) {
  return [...new Set(["pts", ...(sport.lineKeys || [])])];
}

/** How many statistics the MVP line shows before it stops being readable. */
const MVP_STAT_COUNT = 3;

/**
 * The MVP's line, in the active sport's own statistics.
 *
 * This was three basketball literals - PTS / REB / AST - so football's most
 * valuable player was announced with a rebound and an assist total that do not
 * exist, both reading zero.
 *
 * A sport may declare `mvpStatKeys` to fix which three it always shows;
 * basketball does, because points, rebounds and assists is the line everyone
 * knows and it should not reshuffle itself game to game. A sport that declares
 * none gets its top nonzero statistics instead, which is the right default for
 * football: a quarterback's line and a cornerback's have nothing in common,
 * and forcing both into the same three columns would leave one of them empty.
 */
export function formatMvpStatLine(sport, line) {
  if (!line) return "";
  const columns = sport.boxColumns || [];
  const labelFor = (key) => {
    const declared = sport.statLabels && sport.statLabels[key];
    if (declared) return declared;
    const column = columns.find(([k]) => k === key);
    return column ? column[1] : key.toUpperCase();
  };
  const value = (key) => Math.round(Number(line[key]) || 0);

  // Declared: always these, in this order, whether or not they are the
  // biggest numbers on the line.
  if (Array.isArray(sport.mvpStatKeys) && sport.mvpStatKeys.length) {
    return sport.mvpStatKeys.map((key) => `${value(key)} ${labelFor(key)}`).join(" / ");
  }

  // Otherwise the biggest things he actually did. Ties keep the sport's own
  // column order, so a line is never rearranged by a coin flip between two
  // equal numbers.
  const ranked = columns
    .map(([key], index) => ({ key, index, value: value(key) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, MVP_STAT_COUNT);

  // A player can genuinely do nothing measurable - a kicker who never came on.
  // Saying so beats printing an empty dash.
  if (!ranked.length) return "no recorded statistics";
  return ranked.map((entry) => `${entry.value} ${labelFor(entry.key)}`).join(" / ");
}

/**
 * Basketball's shot chart: an overlay on the court that fills in as the game
 * is revealed.
 *
 * Draws nothing by itself. Markers arrive one at a time from the ledger in
 * js/sports/nba/playback.js, which decomposed them from the simulated result
 * - this layer never decides whether a shot went in, only how a shot that
 * already went in or already missed should look.
 *
 * The two teams attack opposite baskets, which is how the court reads as a
 * court rather than a scatter plot: the ledger works in half-court
 * coordinates (x across, y out from the basket) and each side maps onto its
 * own end. That, rather than colour alone, is what separates the teams.
 */
export function renderShotChart(container) {
  if (!container) return null;
  let layer = container.querySelector(".shot-chart");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "shot-chart";
    // Decorative as a whole: every marker carries its own label, and the box
    // score below is the accessible record of the same events.
    layer.setAttribute("aria-hidden", "true");
    container.appendChild(layer);
  }
  layer.innerHTML = "";
  return { layer, recent: [] };
}

/**
 * One shot, placed and animated.
 *
 * Made and missed differ by SHAPE as well as colour - a filled disc against a
 * hollow ring with a slash - because a red/green pair is the one distinction a
 * red-green colourblind player cannot make, and the chart would otherwise be
 * unreadable to them.
 */
export function plotShot(refs, event, opts = {}) {
  if (!refs || !event || event.zone == null) return;
  const mark = document.createElement("span");
  const side = event.side === "a" ? "a" : "b";
  mark.className =
    `shot-mark shot-${side} ${event.made ? "shot-made" : "shot-miss"}` +
    (event.strong ? " shot-strong" : "") +
    (event.shotType === "three" ? " shot-three" : "");

  // Half-court to full-court. Side A attacks the left basket, so its "out from
  // the basket" axis runs left-to-right across the near half; side B mirrors.
  // Each half is 50% of the floor, so y (0 at the rim, 1 at half-court) scales
  // by 0.5 and is measured in from that side's own baseline.
  const along = Math.max(0, Math.min(1, event.y)) * 0.5;
  const across = Math.max(0, Math.min(1, event.x));
  mark.style.left = `${(side === "a" ? along : 1 - along) * 100}%`;
  mark.style.top = `${across * 100}%`;

  const zoneLabel = opts.zoneLabel || "";
  mark.title = `${event.player} — ${event.made ? "made" : "missed"} ${event.shotType === "three" ? "3PT" : "2PT"}${zoneLabel ? ` ${zoneLabel}` : ""}`;

  refs.layer.appendChild(mark);
  // The newest shots are the ones being watched, so they stay bright while the
  // chart behind them settles back. Without this the floor becomes an even
  // wash of markers and the shot just taken is impossible to pick out.
  //
  // THREE, not six. Six meant a sixth of a quarter's shots were all equally
  // bright at once, which is not a focal point, it is a cluster. Three reads as
  // "this one, and the two before it".
  refs.recent.push(mark);
  requestAnimationFrame(() => mark.classList.add("shot-in"));
  while (refs.recent.length > 3) {
    const old = refs.recent.shift();
    old.classList.add("shot-settled");
  }

  if (opts.callout) calloutAt(refs, mark, event, opts);
}

/**
 * The line a commentator would say, on the floor where it happened.
 *
 * This is the piece that turns a chart filling in into a game being watched.
 * A marker appearing tells you a shot went in somewhere; "JOKIĆ · 3PT" tells
 * you what just happened, and it is the difference between glancing and
 * following.
 *
 * Deliberately terse - a surname and a verdict. Anything longer cannot be read
 * in the time it is on screen, and a callout nobody finishes reading is just
 * motion. Positioned off the marker so the eye is already in the right place.
 */
function calloutAt(refs, mark, event, opts) {
  const chip = document.createElement("span");
  chip.className = `shot-callout shot-callout-${event.side === "a" ? "a" : "b"}`;
  if (event.made) chip.classList.add("shot-callout-made");

  // Surname only. Full names are too wide for a phone's half-court and the
  // first name is never the part that identifies a player to a fan.
  const surname = String(event.player || "").split(" ").slice(-1)[0] || event.player || "";
  const verdict = !event.made
    ? "MISS"
    : event.shotType === "three"
      ? "3PT"
      : event.strong
        ? "AT THE RIM"
        : "2PT";
  chip.textContent = `${surname} · ${verdict}`;

  // A callout is placed on the floor, so it needs a floor with a width. The
  // court is hidden during play now - the board is the stage, and the chart is
  // revealed at the buzzer - which makes clientWidth 0 and every position
  // meaningless. Placing one anyway put chips at negative x, off the left of
  // the viewport. The live equivalent is the play feed, which main.js writes
  // instead; here there is simply nothing to draw on.
  if (!refs.layer.clientWidth) return;

  chip.style.left = mark.style.left;
  chip.style.top = mark.style.top;
  refs.layer.appendChild(chip);

  // A callout is centred on its marker, so one taken from the corner hangs off
  // the side of the floor - on a phone a long surname ran past the viewport
  // edge outright. Clamped after append rather than before, because the width
  // is not knowable until it is laid out: it depends on the name.
  const floorWidth = refs.layer.clientWidth;
  const chipWidth = chip.offsetWidth;
  if (floorWidth > chipWidth && chipWidth > 0) {
    const half = chipWidth / 2;
    const centre = (parseFloat(chip.style.left) / 100) * floorWidth;
    const clamped = Math.min(Math.max(centre, half), floorWidth - half);
    // Nudged only when it would actually overhang. A callout that fits stays
    // exactly on its shot, which is the whole reason it is placed there.
    if (clamped !== centre) chip.style.left = `${(clamped / floorWidth) * 100}%`;
  }
  requestAnimationFrame(() => chip.classList.add("shot-callout-in"));
  // Removed rather than left to accumulate: a hundred spent chips on the floor
  // is a memory leak with a visual symptom.
  setTimeout(() => chip.remove(), opts.calloutMs || 1100);
}

/**
 * The buzzer overlay: how each team shot, by area of the floor.
 *
 * This is what turns the settled chart from something you look at into
 * something you READ. A hundred and forty markers tell you where shots came
 * from; "RIM 7/15 47%" tells you whether they went in, which is the question.
 *
 * Placed on each team's own half at the distance the band describes - rim
 * nearest the basket, threes furthest out - so the number sits over the marks
 * it summarises rather than in a legend somewhere else. Side B mirrors, exactly
 * as its markers do.
 *
 * Makes/attempts lead and the percentage follows: 3/7 and 30/70 are both 43%
 * and are not remotely the same game.
 */
export function renderZoneSummary(refs, summary) {
  if (!refs || !summary) return 0;
  let drawn = 0;
  for (const side of ["a", "b"]) {
    for (const band of summary[side] || []) {
      const el = document.createElement("div");
      el.className = `zone-stat zone-stat-${side}`;
      el.innerHTML =
        `<span class="zone-stat-label">${escapeHtml(band.label)}</span>` +
        `<span class="zone-stat-line">${band.makes}/${band.attempts}</span>` +
        `<span class="zone-stat-pct">${band.pct}%</span>`;
      // Same mapping the markers use: side A works out from the left baseline,
      // side B from the right.
      el.style.left = `${(side === "a" ? band.at.x : 1 - band.at.x) * 100}%`;
      el.style.top = `${band.at.y * 100}%`;
      refs.layer.appendChild(el);
      requestAnimationFrame(() => el.classList.add("zone-stat-in"));
      drawn += 1;
    }
  }
  return drawn;
}

/**
 * A banner for the moments the ledger says are moments - a run, a lead change,
 * the last shot of a quarter. Sits over the court's centre rather than on the
 * shot, because it is about the GAME rather than about one attempt.
 */
export function announceMoment(refs, text, kind = "") {
  if (!refs) return;
  const el = document.createElement("div");
  el.className = `court-moment${kind ? ` court-moment-${kind}` : ""}`;
  el.textContent = text;
  refs.layer.appendChild(el);
  requestAnimationFrame(() => el.classList.add("court-moment-in"));
  setTimeout(() => el.remove(), 1600);
}
