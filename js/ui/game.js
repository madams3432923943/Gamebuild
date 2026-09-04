// What a game looks like while it is being played and once it is over: the
// scoreboard, the box score, the play feed and the man of the match.
//
// Extracted from js/ui.js - see the note at the top of that file. Grouped by
// the moment a player sees them rather than by shape: all of this appears
// between the whistle and the final banner, and a change to one is usually a
// change to how that moment reads.

import { escapeHtml } from "../lib/escape-html.js";
import { activeSport } from "../sports/index.js";
import { defaultStarters, slotLabel, rosterSlots } from "./roster-slots.js";
import { displayEntryName, shortPlayerName } from "./entry-name.js";
import { roundStat } from "./format.js";

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

