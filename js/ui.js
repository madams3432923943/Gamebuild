// Rendering helpers. Pure-ish functions: given data + a container element
// (and callbacks), they redraw that container's contents.

import { MIN_SEARCH_CHARS } from "./constants.js";
// A leaf module rather than a local function: js/sports/nfl/field.js needs it
// too, and a sport importing ui.js closes an import cycle through the sport
// registry. Re-exported because callers already import it from here.
import { escapeHtml } from "./lib/escape-html.js";
export { escapeHtml };
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
  RECENT_GAMES_SHOWN,
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
import {
  GENERAL_ICONS,
  teamIconsForSport,
  iconById,
  iconGlyph,
  iconProgress,
  iconSummary,
  equippedIcon,
  DEFAULT_ICON_ID,
} from "./icons.js";
import { emblemSvg } from "./emblems.js";

// EXTRACTED, AND RE-EXPORTED FROM HERE. js/ui.js had grown to 3,182 lines -
// the draft board, the box score, the profile screen, the strategy pickers and
// the squad screens in one file. Splitting it is not a rewrite: each module
// below holds exactly the code that used to sit here, and this file re-exports
// all of it, so every caller's `import { ... } from "./ui.js"` still resolves.
// The point is that a change to a squad screen no longer means opening the
// file that also draws the draft board.
import { displayEntryName, shortPlayerName } from "./ui/entry-name.js";
import { defaultSlots, defaultStarters, slotLabel, rosterSlots } from "./ui/roster-slots.js";
import { renderNote } from "./ui/note.js";
import { roundStat } from "./ui/format.js";
import { bannerArt } from "./ui/banner-art.js";
export { bannerArt };
export * from "./ui/strategy.js";
export * from "./ui/profile.js";
export * from "./ui/squads.js";
import { squadTierForRep } from "./squads.js";

/** Default roster shape: the ACTIVE SPORT's, never basketball's.
 *
 * These defaults used to be imported straight from js/sports/nba/constants.js,
 * so any caller that forgot to pass its slots silently got basketball's - which
 * is how an NFL draft came to deal PG/SG/SF/PF/C off a Cowboys roster. Evaluated
 * per call, so it follows whichever sport is live rather than whatever was
 * loaded first. */
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
/**
 * The MVP card: who decided the game, and the numbers that say so.
 *
 * The stat line arrives as one string from the sport ("36 Points / 13
 * Rebounds / 27 Assists") because each sport names its own statistics. It is
 * split back into chips here rather than assembled per sport, so a sport that
 * adds a stat gets a chip for it without touching this - the separator is the
 * contract, and formatMvpStatLine is its only writer.
 *
 * A chip is a VALUE and a LABEL, sized differently, because at arm's length
 * across a couch the number is what gets read and the word is what makes it
 * mean something. One string in one weight is a sentence you have to parse.
 */
export function renderMvpCallout(container, { name, team, line, note }) {
  container.innerHTML = "";

  const tag = document.createElement("div");
  tag.className = "mvp-tag";
  tag.textContent = "Most Valuable Player";
  container.appendChild(tag);

  const who = document.createElement("div");
  who.className = "mvp-name";
  who.textContent = name;
  container.appendChild(who);

  if (team) {
    const side = document.createElement("div");
    side.className = "mvp-team";
    side.textContent = team;
    container.appendChild(side);
  }

  // WHY him, when the sport can say. Football's low-scoring games now go to a
  // kicker or a secondary (see pickMvp in js/sports/nfl/engine.js), and a
  // three-field-goal kicker taking the card off a running back reads as a
  // glitch unless the card says what he did. Optional: a sport that offers no
  // reason gets the card it always had rather than an empty line.
  if (note) {
    const why = document.createElement("div");
    why.className = "mvp-note";
    why.textContent = note;
    container.appendChild(why);
  }

  const stats = document.createElement("div");
  stats.className = "mvp-stats";
  for (const part of String(line || "").split("/")) {
    const text = part.trim();
    if (!text) continue;
    const chip = document.createElement("div");
    chip.className = "mvp-stat";
    // "36 Points" -> 36 / Points. A stat whose name is more than one word
    // ("13 Field Goals") keeps the rest as its label; only the leading number
    // is split off, so nothing has to know what the statistics are called.
    const space = text.indexOf(" ");
    if (space > 0) {
      const value = document.createElement("span");
      value.className = "mvp-stat-value";
      value.textContent = text.slice(0, space);
      const label = document.createElement("span");
      label.className = "mvp-stat-label";
      label.textContent = text.slice(space + 1);
      chip.append(value, label);
    } else {
      chip.textContent = text;
    }
    stats.appendChild(chip);
  }
  container.appendChild(stats);
}

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


/** One shooting-split cell, e.g. "6/16" - a dash rather than "0/0" when a
 * player took none, so a center's FT column doesn't read as "missed every
 * free throw" when he simply never shot one. */
function splitCell(makes, attempts) {
  return attempts > 0 ? `${roundStat(makes)}/${roundStat(attempts)}` : "-";
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
      return `<td>${roundStat(total)}</td>`;
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
      return `<td>${roundStat(makes)}/${roundStat(attempts)}<span class="box-pct">${pct.toFixed(1)}%</span></td>`;
    })
    .join("");

  return (
    `<tr class="box-totals"><td>TEAM</td><td>${slots.length} players</td>` +
    (showMinutes ? `<td>${minutesMap ? roundStat(sum((slot) => minutesMap[slot])) : "-"}</td>` : "") +
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
      return `<td>${v === undefined || v === null ? "-" : roundStat(v)}</td>`;
    })
    .join("");
  // The MVP's row is marked with a star as well as a tint. The tint alone
  // would be the only thing saying "this is the best line in the table", and a
  // faint background is exactly what a low-contrast screen, a bright room or a
  // colourblind reader loses first.
  const mvpStar = isMvp ? `<span class="box-mvp-star" title="Most valuable player" aria-label="Most valuable player">\u2605</span> ` : "";
  return (
    `<tr${isMvp ? ' class="box-mvp"' : ""}><td>${slotLabel}</td><td>${mvpStar}${escapeHtml(displayEntryName(player))}${meta}</td>` +
    (showMinutes ? `<td>${minutes == null ? "-" : roundStat(minutes)}</td>` : "") +
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
      <span class="scoreboard-team-name">${escapeHtml(labelA)}</span>
      <span class="${scoreClass} scoreboard-score-a">${Math.round(totalA)}</span>
    </div>
    <div class="scoreboard-middle"></div>
    <div class="scoreboard-side scoreboard-side-b">
      <span class="scoreboard-team-name">${escapeHtml(labelB)}</span>
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
      <tr><td class="team-col">${escapeHtml(labelA)}</td>${rowCells("a")}<td class="grid-total">${Math.round(totalA)}</td></tr>
      <tr><td class="team-col">${escapeHtml(labelB)}</td>${rowCells("b")}<td class="grid-total">${Math.round(totalB)}</td></tr>
    </tbody>
  `;
  container.appendChild(grid);
}

/**
 * Rewrites just the scoreboard's centre cell, leaving the rest of the board
 * alone.
 *
 * WHY NOT CALL renderScoreboard AGAIN. Football updates this on every play -
 * roughly 130 times a game - and renderScoreboard rebuilds the team rows and
 * the whole period table from scratch. Throwing away and re-parsing a table to
 * change one string is the kind of per-row rebuild that has already frozen this
 * app once. One textContent write costs nothing.
 *
 * Silently does nothing if the board has not been rendered yet, so a caller
 * racing the first paint cannot throw.
 *
 * `ticking` says whether the text being written is a running clock. It has to
 * be a parameter rather than an assumption now that this is the ONLY writer
 * between scores: the centre cell alternates between a clock, which must not
 * blink, and a static label like "End of Q1", which must. When every call went
 * through renderScoreboard first the class was cleared by the rebuild and the
 * question never came up; without the rebuild, a board that had ever shown a
 * clock would keep the ticking class for the rest of the game.
 */
export function setScoreboardStatus(container, text, ticking = true) {
  if (!container || !text) return;
  const period = container.querySelector(".scoreboard-period");
  if (!period) return;
  period.textContent = text;
  // A ticking clock IS the liveness tell, so it must not also blink.
  // .scoreboard-period.live fades to 0.35 opacity twice a second, which was a
  // low-key "this is live" cue under static text and is unreadable under a
  // number that changes every play - the one thing on the board you are
  // actually trying to read would be missing half the time it is on screen.
  period.classList.toggle("ticking", !!ticking);
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
/* Football's field, its play captions and its box-score columns used to live
 * here. They are in js/sports/nfl/field.js now - a sport's presentation belongs
 * with that sport, not in the shared UI module, and shared code reaches it
 * through the registry (presentation.renderField / showEvent) rather than
 * importing football directly.
 *
 * Basketball's court used to be here too, in the rules beside them. It is gone
 * entirely; the scoreboard is its stage. */

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

/* The shot chart, its callouts, its zone summary and its moment banners were
 * all drawn on the basketball court, and went with it. The board is the whole
 * stage now.
 *
 * The ledger that fed them is untouched (js/sports/nba/playback.js): it is what
 * turns a final score into a sequence, and the play-by-play, the sounds and the
 * run/lead lines still run off it. Only the floor they were painted on is gone.
 */

