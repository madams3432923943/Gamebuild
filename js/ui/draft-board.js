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
import { displayEntryName, shortPlayerName } from "./entry-name.js";
import { renderNote } from "./note.js";

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
        // Same rule as the roster strip: a unit's own label is its position
        // group, and the slot tag beside it already says that, so "OL /
        // Offensive Line / 2020 Browns" spends two of its three lines saying
        // "OL". A unit is identified by its team and year, and that is the
        // whole of what it needs.
        const unit = activeSport().isUnit(player);
        head.textContent = unit ? seasonLabel(player) : `${shortPlayerName(player)}${pos}`;
        value.appendChild(head);
        if (!unit) {
          const when = document.createElement("span");
          when.className = "slot-season";
          when.textContent = seasonLabel(player);
          value.appendChild(document.createElement("br"));
          value.appendChild(when);
        }
      } else {
        value.textContent = `${displayEntryName(player)}${pos} — ${seasonLabel(player)}`;
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
