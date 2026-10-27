// The three screens between the draft and the whistle: how many minutes each
// man plays, who guards whom, and what the team is trying to do.
//
// Extracted from js/ui.js - see the note at the top of that file. Grouped
// because they are one phase of the game rather than because they sit next to
// each other: a player passes through all three in a row, and a change to one
// is usually a change to how that phase reads.

import { escapeHtml } from "../lib/escape-html.js";
import { activeSport } from "../sports/index.js";
import { rosterSlots, slotLabel } from "./roster-slots.js";
import { displayEntryName, seasonLabel } from "./entry-name.js";

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
 *
 * STARTERS DOWN ONE COLUMN, BENCH DOWN THE OTHER. The grid used to fill
 * row-wise, so a ten-man rotation read PG, SG / SF, PF / C, Bench / Bench,
 * Bench - the five men who start the game interleaved with the five who do
 * not, which is not how anyone thinks about a rotation. The ordering here and
 * the column flow in .rotation-grid are two halves of one layout; neither
 * works without the other.
 */
export function renderRotationPicker(container, roster, minutesMap, totalEl, slots, onValidChange) {
  container.innerHTML = "";
  // ONE definition of what counts as a reserve, used for both the ordering
  // below and each row's own label. It was computed per row and is now
  // computed once - two copies of this test are two chances to disagree about
  // which half of the screen a man belongs on. Mirrors
  // js/sports/nba/draftgrade.js.
  const isReserve = (slot) => activeSport().isBenchSlot(slot) || slot === "6TH";

  const all = slots ? slots.filter((slot) => roster[slot]) : rosterSlots(roster);
  const starters = all.filter((slot) => !isReserve(slot));
  const reserves = all.filter(isReserve);
  const list = [...starters, ...reserves];

  // COLUMN FLOW NEEDS TO KNOW WHERE TO BREAK. The grid fills down the starters
  // column and then the bench column, so the row count is the taller of the
  // two groups - derived, because roster shape varies by mode: 5+5 in Ranked,
  // 5+1 on the legacy/online path, 5+0 in Quick Play. Hardcoding five would
  // put a sixth starter in the bench column.
  container.style.setProperty(
    "--rotation-rows",
    String(Math.max(starters.length, reserves.length) || 1)
  );

  const rows = [];

  // The most this slot may hold right now: its own minutes plus whatever is
  // still unspent, never past the position's maximum.
  const capFor = (slot) => {
    const spent = list.reduce((sum, s) => sum + (minutesMap[s] || 0), 0);
    const remaining = activeSport().rotationBudget - spent;
    return Math.min(activeSport().minutesRangeFor(slot).max, (minutesMap[slot] || 0) + Math.max(0, remaining));
  };

  const sync = () => {
    const spent = list.reduce((sum, slot) => sum + (minutesMap[slot] || 0), 0);
    const remaining = activeSport().rotationBudget - spent;
    list.forEach((slot, i) => {
      const { min, max } = activeSport().minutesRangeFor(slot);
      // A slider may claim its own value plus whatever is still unspent, and
      // no more. That is what makes going over 240 impossible rather than
      // merely discouraged - there is no invalid state to validate against.
      const cap = Math.min(max, minutesMap[slot] + Math.max(0, remaining));
      // The TRACK keeps the position's full range and the value is clamped on
      // input instead (see capFor). Shrinking the track to the cap put every
      // thumb at its right-hand end once the budget was spent, which read as
      // "every player is maxed out" on a full and perfectly ordinary rotation.
      rows[i].slider.min = String(min);
      rows[i].slider.max = String(max);
      rows[i].slider.value = String(minutesMap[slot]);
      rows[i].value.textContent = `${minutesMap[slot]} min`;
      rows[i].less.disabled = minutesMap[slot] <= min;
      rows[i].more.disabled = minutesMap[slot] >= cap;
    });
    renderRotationTotal(totalEl, minutesMap, list);
    if (onValidChange) onValidChange(remaining === 0);
  };

  for (const slot of list) {
    const player = roster[slot];
    const { min, max } = activeSport().minutesRangeFor(slot);
    const bench = isReserve(slot);

    // ONE ELEMENT PER PLAYER, holding the row and the slider that belongs to
    // it. They used to be two siblings of #rotation-grid, which was fine while
    // the grid was a single column and wrong the moment it became two: a
    // reflowing grid put a player's name in one column and his minutes slider
    // in the other. The pairing is now structural rather than positional.
    const cell = document.createElement("div");
    cell.className = "rotation-cell";

    const row = document.createElement("div");
    row.className = "rotation-row" + (bench ? " rotation-bench" : " rotation-starter");

    const name = document.createElement("span");
    name.className = "rotation-label";
    // Two lines, like the roster panel: who, then position and which season.
    name.innerHTML =
      `<span class="rotation-role">${bench ? "Bench" : slotLabel(slot)}</span> ` +
      `<span class="rotation-name">${escapeHtml(displayEntryName(player))}</span>` +
      `<span class="rotation-meta">${escapeHtml(player.pos.join("/"))} · ${escapeHtml(seasonLabel(player))}</span>`;
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
      minutesMap[slot] = Math.min(capFor(slot), Math.max(min, parseInt(slider.value, 10) || min));
      sync();
    });

    // STEPPERS BESIDE THE SLIDER. A thin range input that has to land on an
    // exact total was the hardest control in the game to use on a phone:
    // testers dragged, overshot and gave up. One tap is one minute, and the
    // slider stays for the big moves.
    const step = (delta) => {
      minutesMap[slot] = Math.min(capFor(slot), Math.max(min, (minutesMap[slot] || 0) + delta));
      sync();
    };
    const less = stepperButton("−", `One minute less for ${player.name}`, () => step(-1));
    const more = stepperButton("+", `One minute more for ${player.name}`, () => step(1));
    const control = document.createElement("div");
    control.className = "rotation-control";
    control.append(less, slider, more);

    rows.push({ slider, value, less, more });
    cell.append(row, control);
    container.appendChild(cell);
  }

  sync();
}

function stepperButton(text, label, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "rotation-step";
  btn.textContent = text;
  btn.setAttribute("aria-label", label);
  btn.addEventListener("click", onClick);
  return btn;
}

function renderRotationTotal(totalEl, minutesMap, list) {
  const spent = list.reduce((sum, slot) => sum + (minutesMap[slot] || 0), 0);
  const remaining = activeSport().rotationBudget - spent;
  if (remaining === 0) {
    totalEl.textContent = `All ${activeSport().rotationBudget} minutes assigned`;
    totalEl.className = "rotation-total";
  } else {
    // The number left LEADS, because it is the one the player is working to.
    totalEl.textContent =
      `${remaining} minute${remaining === 1 ? "" : "s"} left to give out (${spent} of ${activeSport().rotationBudget})`;
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
      mine.innerHTML =
        `<span class="matchup-slot">${escapeHtml(slot)}</span>` +
        `<span class="matchup-name">${escapeHtml(myRoster[slot].name)}</span>` +
        `<span class="matchup-meta">${escapeHtml(seasonLabel(myRoster[slot]))}</span>`;
      row.appendChild(mine);

      // "GUARDS" in capitals between a name and a dropdown read as a heading,
      // and testers did not see that the dropdown was the choice. It is a
      // sentence now - "Kobe Bryant defends" then the man he is on - with the
      // dropdown labelled for a screen reader the same way.
      const arrow = document.createElement("span");
      arrow.className = "matchup-arrow";
      arrow.textContent = "defends";
      row.appendChild(arrow);

      const pick = document.createElement("select");
      pick.className = "matchup-pick";
      pick.setAttribute("aria-label", `Who ${myRoster[slot].name} defends`);
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
    //
    // IN WORDS, NOT RATINGS. "+2 3PT Shooting, +2 Switching Defense" read as
    // jargon to every tester. The direction is what a player decides on, so the
    // card says "Better at" and "Worse at"; the sizes are the sport's own data
    // and stay on the chip's tooltip for anyone who wants them.
    if (tactic.up?.length || tactic.down?.length) {
      const trade = document.createElement("span");
      trade.className = "tactic-trade";
      for (const [items, cls, lead] of [[tactic.up, "up", "Better at"], [tactic.down, "down", "Worse at"]]) {
        if (!items?.length) continue;
        const line = document.createElement("span");
        line.className = `tactic-trade-item ${cls}`;
        line.textContent = `${lead}: ${items.map(plainTrade).join(", ")}`;
        line.title = items.join(", ");
        trade.appendChild(line);
      }
      btn.appendChild(trade);
    }

    btn.setAttribute("aria-pressed", String(tactic.id === selectedId));
    btn.addEventListener("click", () => onSelect(tactic.id));
    return btn;
  }
}

/** "+2 3PT Shooting" -> "3PT shooting". The sign is said by the line it sits on. */
function plainTrade(item) {
  const text = String(item).replace(/^[+\-\u2212]\s*\d+(\.\d+)?\s*/, "");
  return text.charAt(0) + text.slice(1).toLowerCase();
}
