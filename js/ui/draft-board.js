// The draft board: the pool you pick from, the roster you are filling, and the
// clock you are doing it against.
//
// Extracted from js/ui.js - see the note at the top of that file.
//
// One thing was repaired on the way out rather than moved verbatim. The @param
// block describing renderPositionSelector's eligibleSlotsForPendingPlayer sat
// seventy-eight lines above it, orphaned there by an edit that inserted the MVP
// card between a comment and its function. Splitting the file is what made that
// visible; it is back where it belongs.

import { MIN_SEARCH_CHARS } from "../constants.js";
import { activeSport } from "../sports/index.js";
import { eligibleOpenSlots, resolveTypedInput, normalizeName } from "../draft.js";
import { defaultSlots, slotLabel } from "./roster-slots.js";
import { displayEntryName, shortPlayerName, seasonLabel } from "./entry-name.js";
import { renderNote } from "./note.js";

/**
 * @param eligibleSlotsForPendingPlayer null when no player is pending yet
 *   (all slots shown as plain status, none clickable) - or an array of the
 *   pending player's eligible open slots (those glow and are clickable;
 *   other open slots dim since they don't apply to this player).
 */
export function renderPositionSelector(container, roster, eligibleSlotsForPendingPlayer, onSelect, slots = defaultSlots()) {
  container.innerHTML = "";
  for (const slot of slots) {
    const filled = !!roster[slot];
    // IS THIS SLOT A CONTROL, OR A READ-OUT? Only a slot the pending player
    // is eligible for can be clicked; every other chip is telling you
    // something, not offering it.
    //
    // It used to render all of them as <button disabled>, which is wrong in
    // three ways that only became visible on a phone. A disabled button is
    // still a button to a screen reader, so the reader walked ten dead
    // controls before reaching the search box. It is still a button to the
    // 44px tap-target floor, so a strip sized to be read rather than tapped
    // fails a check that exists to catch controls too small to hit - and the
    // honest answer to that check is not to exempt the chips, it is that they
    // are not controls. And it invites a tap that does nothing, which on a
    // touch screen reads as the app being broken rather than as the slot
    // being taken.
    const clickable = !filled && !!eligibleSlotsForPendingPlayer && eligibleSlotsForPendingPlayer.includes(slot);
    const btn = document.createElement(clickable ? "button" : "span");
    if (clickable) btn.type = "button";
    let className = "position-btn";

    if (filled) {
      // TWO DENSITIES, ONE RENDER. Desktop wants "PG ✓" - the slot is taken,
      // and the name is already in the roster panel beside it. A phone wants
      // the NAME, because on a phone the roster panels are below the pool and
      // scroll away the moment you start reading it, so "who have I got" has
      // nowhere else to be answered while you are choosing.
      //
      // Both are emitted and CSS shows one, rather than the render asking how
      // wide the screen is. A render that branches on width is a second
      // component that has to be kept in step with the first, and it reads the
      // width at the wrong moment anyway - once, when the pick happened, not
      // when the phone was turned sideways.
      className += " filled";
      const tag = document.createElement("span");
      tag.className = "position-btn-slot";
      tag.textContent = slotLabel(slot);
      const name = document.createElement("span");
      name.className = "position-btn-name";
      // WHAT IDENTIFIES A DRAFTED THING depends on what it is. For a person it
      // is the name. For a UNIT it is the team and the year: the unit's own
      // label is its position group, and the chip's slot tag right beside it
      // already says that - "OL Offensive Line" is the same word twice, and
      // the strip has one line to spend. "OL 2020 Ravens" is the reading you
      // actually want back while you are choosing the rest of a roster.
      name.textContent = activeSport().isUnit(roster[slot])
        ? seasonLabel(roster[slot])
        : shortPlayerName(roster[slot]);
      const tick = document.createElement("span");
      tick.className = "position-btn-check";
      tick.textContent = "✓";
      btn.append(tag, name, tick);
      // The name is truncated to fit, so the full one has to be reachable
      // some other way - a strip that silently shortens a name is a strip
      // that can show two different players as "Willia…".
      btn.title = `${slotLabel(slot)}: ${roster[slot].name}`;
    } else {
      btn.textContent = slotLabel(slot);
      if (eligibleSlotsForPendingPlayer) {
        className += clickable ? " eligible" : " awaiting-dim";
      }
    }
    btn.className = className;
    if (clickable) btn.addEventListener("click", () => onSelect(slot));
    container.appendChild(btn);
  }
}

/**
 * @param opts.pendingSlots slots filled this round but not yet revealed. They
 *   render as OPEN: the slot a hidden pick went into is itself part of the
 *   pick. This used to print "Locked in" on that row, which told you which
 *   position the opponent had just taken before the reveal - and read, to
 *   everyone who saw it, as a tag landing on a random row. Whether a side has
 *   picked is said once, by the caller, in the panel's heading.
 * @param opts.revealSlots slots that should play the flip-reveal animation
 *   on this render pass (the round that just resolved).
 * @param opts.status a short line after the label ("picked") - see above.
 */
/**
 * "Patrick Mahomes" -> "P. Mahomes".
 *
 * Only for PEOPLE. A drafted unit's name is a team and a position group
 * ("Carolina Panthers Defensive Line") and initialising that would produce
 * "C. Panthers Defensive Line", which is worse than the problem.
 *
 * IT ASKS THE SPORT NOW. This used to test for a `members` array, which is a
 * guess about a football row's shape made in shared code, and the guess was
 * wrong on the rows that actually reach here - the roster panel has been
 * showing "G. Bay Packers Offensive Line" and "L. Angeles Rams Offensive
 * Line" on every football draft board. Football already knew the answer
 * (isUnit in js/sports/nfl/units.js keys on `group`); nothing had asked it.
 * `isUnit` is on the sport contract now, so basketball answers "never" and a
 * third sport has to answer at all - see scripts/verify-sport-contract.mjs.
 */


export function renderRosterPanel(container, roster, label, isTurn, opts = {}) {
  const { pendingSlots = [], revealSlots = [], slots = defaultSlots(), status = "", collapsible = false } = opts;
  container.innerHTML = "";
  const h3 = document.createElement("h3");
  h3.textContent = label + (isTurn ? " •" : "");
  if (status) {
    const note = document.createElement("span");
    note.className = "roster-panel-status";
    note.textContent = status;
    h3.appendChild(note);
  }
  container.appendChild(h3);

  // A DRAWER ON A PHONE, A COLUMN ON A DESKTOP. On a phone the opponent's
  // roster was a second half-width column of ten rows beside yours, which
  // halved the width of both and made every name truncate - for a panel that
  // is reference, not the task. There it folds behind one tap. A desktop has a
  // column to spare, so it keeps the heading and never folds.
  //
  // Both are emitted and CSS shows one, the same "two densities, one render"
  // rule as the position strip. The folded state lives on the container, so a
  // re-render (every pick) keeps whatever the player last chose.
  container.classList.toggle("collapsible", collapsible);
  if (collapsible) {
    const filled = slots.filter((slot) => roster[slot] && !pendingSlots.includes(slot)).length;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "roster-panel-toggle";
    const open = !container.classList.contains("collapsed");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = `${label}'s picks (${filled}/${slots.length})${status ? ` · ${status}` : ""}`;
    toggle.addEventListener("click", () => {
      const nowOpen = container.classList.toggle("collapsed") === false;
      toggle.setAttribute("aria-expanded", String(nowOpen));
    });
    container.appendChild(toggle);
  }

  for (const slot of slots) {
    const row = document.createElement("div");
    row.className = "roster-slot";
    const tag = document.createElement("span");
    tag.className = "slot-tag";
    tag.textContent = slotLabel(slot);
    row.appendChild(tag);

    const value = document.createElement("span");
    const player = pendingSlots.includes(slot) ? null : roster[slot];
    if (player) {
      value.className = "slot-filled" + (revealSlots.includes(slot) ? " slot-reveal" : "");
      // A bench slot doesn't say what the player is, so his position rides
      // next to his name - that's the information you need to judge depth.
      const pos = activeSport().isBenchSlot(slot) ? ` [${player.pos.join("/")}]` : "";
      // TWO LINES, EVERY SPORT: who on the first, which team and year under it.
      // One line of "Roy Hibbert — 2012-13 Pacers" truncated to "Roy Hibbert,
      // 20..." on a phone, so the half of the pick that was a decision - the
      // year - was the half that got cut. Football already did this (its rows
      // are longer); basketball now does too. `compactRoster` still decides
      // whether the first name is shortened to an initial.
      const head = document.createElement("span");
      head.className = "slot-name";
      // A unit's own label is its position group, and the slot tag beside it
      // already says that, so "OL / Offensive Line / 2020 Browns" spends two
      // of its three lines saying "OL". A unit is identified by its team and
      // year, and that is the whole of what it needs.
      const unit = activeSport().isUnit(player);
      const who = activeSport().compactRoster ? shortPlayerName(player) : displayEntryName(player);
      head.textContent = unit ? seasonLabel(player) : `${who}${pos}`;
      value.appendChild(head);
      if (!unit) {
        const when = document.createElement("span");
        when.className = "slot-season";
        when.textContent = seasonLabel(player);
        value.appendChild(when);
      }
      // The full name, for the cases the row had to truncate.
      row.title = `${slotLabel(slot)}: ${player.name} (${seasonLabel(player)})`;
      // A drafted unit says WHO it contains. "Seattle Seahawks Cornerbacks"
      // names a slot; Sherman and Maxwell are what you actually took, and
      // after the pick is made the roster is the only place left to see it.
      const roll = Array.isArray(player.members) ? player.members : [];
      if (roll.length) {
        const members = document.createElement("span");
        members.className = "slot-members";
        members.textContent = roll.slice(0, 4).map((m) => m.name || m).join(", ");
        value.appendChild(members);
      }
    } else {
      value.className = "slot-empty";
      value.textContent = "open";
    }
    row.appendChild(value);
    container.appendChild(row);
  }
}


/**
 * A player's stats as {value, label} pairs, from whichever sport is active.
 *
 * Falls back to an empty list rather than throwing. A missing hook used to
 * take the whole draft board down with it - one undefined function and the
 * render died mid-list, leaving an empty screen with no error anyone would
 * see.
 */
export function statPairs(p) {
  const hook = activeSport().cardStats;
  if (typeof hook !== "function") return [];
  const pairs = hook(p);
  if (!Array.isArray(pairs)) return [];
  // A MISSING STAT IS SHOWN, NOT DROPPED.
  //
  // This filtered out pairs with no value, which turns a dataset hole into a
  // card that is merely one column shorter - believable, and invisible. The
  // string form it replaced printed "undefined reb", which is ugly and is
  // exactly how the football bug this whole hook exists because of got
  // caught. An em-dash is the same signal without the stack-trace look:
  // the label still says which stat is missing.
  return pairs
    .filter((s) => s && typeof s.label === "string")
    .map((s) => (s.value == null || s.value === "" ? { ...s, value: "—" } : s));
}

/**
 * The same pairs as one line of text, for the places that still want a
 * string - the season picker's rows, where each row is one line by design.
 *
 * Derived rather than authored a second time. Every sport used to return a
 * "·"-joined string AND shared code wanted the parts, so the join lived in
 * two sports and the parts lived nowhere.
 */
export function statLine(pairs) {
  return pairs.map((s) => (s.label ? `${s.value} ${s.label}` : `${s.value}`)).join(" · ");
}

/**
 * Pairs as a grid. THE POINT IS THAT A PAIR CANNOT BE SPLIT.
 *
 * These were a "·"-joined string trusted to wrap politely, and at phone
 * width it broke between a value and its label on every card in the pool -
 * "25.7 pts · 5.8 reb · 3.9 ast · 1.3" then "stl · 1.1 blk" on the next
 * line, so a number sat at the end of one line with its unit at the start
 * of the next. It passed every layout check there is, because a wrapped
 * line overflows nothing.
 *
 * A pair with an empty label is a LEAD and gets the full width - football's
 * unit cards open with member names, which are not a statistic and do not
 * belong in a stat column.
 */
export function renderStatPairs(pairs) {
  const grid = document.createElement("div");
  grid.className = "player-stats";
  for (const s of pairs) {
    const cell = document.createElement("span");
    cell.className = s.label ? "stat-pair" : "stat-pair stat-lead";
    const value = document.createElement("b");
    value.className = "stat-value";
    value.textContent = String(s.value);
    cell.appendChild(value);
    if (s.label) {
      const label = document.createElement("span");
      label.className = "stat-label";
      label.textContent = s.label;
      cell.appendChild(label);
    }
    grid.appendChild(cell);
  }
  return grid;
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
  // A BUTTON when it can be drafted, a div when it cannot.
  //
  // These were divs with a click listener, which made the draft board - the
  // screen where the whole game happens - unusable without a mouse: no focus,
  // no Enter or Space, and nothing announcing the card as something you can
  // press. A button is the element that already does all three, so the fix is
  // to use one rather than to reimplement it with tabindex and a keydown
  // handler.
  //
  // Ineligible players stay divs on purpose. A disabled button is still read
  // out by some screen readers, and a squad's pool runs to dozens of cards
  // where only a few fit the open slot - tabbing through the rest to reach
  // them would be worse than not being able to tab at all.
  const card = document.createElement(eligible ? "button" : "div");
  if (eligible) {
    card.type = "button";
    // Says what pressing it DOES, because the visible text is a name and a
    // stat line. Multi-season players open a picker rather than drafting, and
    // a control that says "Draft" and then asks a question is a small lie.
    card.setAttribute(
      "aria-label",
      seasons.length > 1 ? `${p.name} - choose a season` : `Draft ${p.name}`
    );
  } else {
    card.setAttribute("aria-disabled", "true");
  }
  card.className =
    "player-card" +
    (eligible ? "" : " disabled") +
    (p.name === pendingPlayerName ? " pending" : "") +
    (showStats ? " with-stats" : "");

  const name = document.createElement("span");
  name.className = "player-card-name";
  name.textContent = displayEntryName(p);
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
    wrap.appendChild(renderStatPairs(statPairs(p)));
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
  openBoard = false,
  slots = defaultSlots(),
  onPickSeason = null,
  opts = {}
) {
  container.innerHTML = "";
  try {
    renderPoolContents(
      container, squad, filterText, roster, pendingPlayerName,
      onPick, allPlayers, openBoard, slots, onPickSeason, opts
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
      openBoard,
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
  openBoard,
  slots,
  onPickSeason,
  { settled = true } = {}
) {
  // AN OPEN BOARD puts the whole squad on screen with stats - it's for
  // learning the pool, not testing recall. The search box still narrows the
  // list, it just isn't the only way to see anyone. Easy practice is the only
  // mode that asks for it; every other mode hides the board on purpose, and
  // hidden information is what Ranked and Friend matches are built on.
  //
  // A BOOLEAN, not the old "easy"/"strict" ruleset string. The board only ever
  // asked one question of that string, and passing a whole ruleset to answer it
  // is how the ruleset came to mean four unrelated things at once.
  if (openBoard) {
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
    // Nothing typed yet says nothing: the hint directly above the box
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

  // NOT YET A MISS. While the player is still typing, a name that matches
  // nobody is most often a name half-typed: "Not on this squad" at the third
  // letter of the right answer read as the game telling them they were wrong.
  // The caller re-renders with `settled` once typing pauses (SEARCH_SETTLE_MS).
  if (!settled) return;

  // SHORT, AND ABOUT THIS SQUAD. The long form named every other team in the
  // dataset the player had been on ("Not on this squad. We do have Kevin
  // Willis (Atlanta Hawks 1980s), ...") and ran to four lines on a phone with
  // the clock going. What the player needs is the one fact: wrong squad, try
  // again. The class still says which kind of miss it was.
  const where = squadName(squad);
  if (result.tier === "elsewhere") {
    renderNote(container, `Not on the ${where}. Try again.`, "pool-elsewhere-note");
    return;
  }

  renderNote(container, `No player by that name. Check the spelling and try again.`, "pool-none-note");
}

/** "2000s Grizzlies" - the squad as a player says it. The same nickname rule as
 * seasonLabel: the last word of the team is how every one of them is spoken. */
function squadName(squad) {
  const nickname = String(squad.team || "").split(" ").pop();
  const era = squad[activeSport().groupKey] ?? squad.decade ?? "";
  return `${era} ${nickname}`.trim();
}

/**
 * A few names to start from when the search box is empty.
 *
 * PRACTICE ONLY, and only when asked for - the caller decides both. A first
 * draft on a phone opened on an empty box and a running clock, and testers
 * froze. Ranked and friend matches are recall by design and never show this.
 *
 * Players who can fill one of your open slots, most games for this squad first:
 * the names someone is likeliest to recognise, not the best ones. Ordering by
 * rating would turn a hint into the answer key.
 */
export function renderSuggestions(container, squad, roster, slots, onPick, onPickSeason, count = 5) {
  container.innerHTML = "";
  const fits = groupBySeason(squad.players).filter(({ lead, pos }) =>
    eligibleOpenSlots({ ...lead, pos }, roster, slots).length > 0
  );
  const games = (g) => g.seasons.reduce((sum, p) => sum + (p.games || 0), 0);
  fits.sort((a, b) => games(b) - games(a));
  for (const { lead, seasons } of fits.slice(0, count)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "suggestion-chip";
    chip.textContent = displayEntryName(lead);
    chip.setAttribute(
      "aria-label",
      seasons.length > 1 ? `${lead.name} - choose a season` : `Draft ${lead.name}`
    );
    chip.addEventListener("click", () => (seasons.length > 1 ? onPickSeason(lead, seasons, false) : onPick(lead)));
    container.appendChild(chip);
  }
  return fits.length > 0;
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
