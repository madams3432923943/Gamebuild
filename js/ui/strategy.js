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
import { displayEntryName } from "./entry-name.js";

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
      `${escapeHtml(displayEntryName(player))} <span class="rotation-pos">${player.pos.join("/")}</span>`;
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
