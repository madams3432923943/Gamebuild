#!/usr/bin/env node
// The live box score's accumulator, and the MVP line, per sport.
//
// WHY THIS EXISTS
//
// The live table was accumulated with basketball's six stat keys spelled out
// at the call site. A football period line has no `reb`, so every quarter
// added `undefined` to the running total and turned it into NaN, while a
// completion or a passing yard was never added at all because nothing asked
// for them. The header promised COMP/ATT/PASS and the table sat at zero.
//
// The MVP callout had the same shape of bug in prose: three basketball
// literals, so football's best player was announced with a rebound and an
// assist total that do not exist, both reading zero.
//
// Both now go through js/ui.js, which is what makes them checkable here -
// js/main.js boots the entire app on import (auth, Supabase, the home screen)
// and cannot be loaded in node at all.
//
// The per-quarter lines now come from the SAME ledger as the final box score,
// restricted to one quarter, so summing the quarters cannot disagree with the
// game. That is asserted below rather than assumed - it is the property the
// live table depends on, and it is what was missing when a football box score
// filled in with zeros all game and only agreed with itself at the whistle.

import { setActiveSport } from "../js/sports/index.js";
import { NBA } from "../js/sports/nba/index.js";
import { NFL } from "../js/sports/nfl/index.js";
import { DraftState } from "../js/draft.js";
import { accumulatePeriodStats, liveStatKeys, formatMvpStatLine } from "../js/ui.js";

// Football's dataset loads on demand now (see NFL.preload), so a script that
// reads the player pool has to ask for it first.
await NFL.preload();

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

/** Fills both rosters through the real draft and simulates, the way
 * verify-playable does. */
function playOneGame(sport, slots) {
  const rows = sport.playersInEra(sport.players(), sport.defaultEra);
  const ctx = sport.computeDatasetStats(sport.players(), sport.units?.());
  const draft = new DraftState(rows, [], slots);
  let guard = 0;
  while (!draft.isComplete() && guard++ < slots.length * 8) {
    const squad = draft.rollNextSquad();
    if (!squad) break;
    for (const side of ["A", "B"]) {
      const roster = side === "A" ? draft.rosterA : draft.rosterB;
      for (const player of squad.players) {
        let placed = false;
        for (const slot of slots.filter((s) => !roster[s])) {
          try {
            draft.makePick(side, player, slot);
            placed = true;
            break;
          } catch {
            /* not eligible there */
          }
        }
        if (placed) break;
      }
    }
  }
  if (!draft.isComplete()) return null;
  return { result: sport.simulate(draft.rosterA, draft.rosterB, ctx, {}), roster: draft.rosterA };
}

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, ok: !!ok, detail: String(detail) });

// ---- the accumulator itself ------------------------------------------------

// A missing stat must leave the total alone, not poison it. This is the exact
// shape that produced NaN: a period line that simply does not carry the key.
{
  const total = { pts: 0, pass_yds: 0, comp: 0 };
  accumulatePeriodStats(total, { pts: 7 }, ["pts", "pass_yds", "comp"]);
  accumulatePeriodStats(total, { pts: 3, pass_yds: 88, comp: 9 }, ["pts", "pass_yds", "comp"]);
  const finite = Object.values(total).every((v) => Number.isFinite(v));
  check(
    "a period line missing a stat never produces NaN",
    finite && total.pts === 10 && total.pass_yds === 88 && total.comp === 9,
    JSON.stringify(total)
  );
}

// Non-numeric junk is ignored rather than concatenated or NaN'd.
{
  const total = { pts: 5 };
  accumulatePeriodStats(total, { pts: "not a number" }, ["pts"]);
  accumulatePeriodStats(total, { pts: null }, ["pts"]);
  accumulatePeriodStats(total, null, ["pts"]);
  check("non-numeric and absent values leave the total untouched", total.pts === 5, `pts=${total.pts}`);
}

// ---- per sport -------------------------------------------------------------

for (const [sport, slots] of [[NBA, NBA.slots.quickPlay], [NFL, NFL.slots.quickPlay]]) {
  const id = sport.id.toUpperCase();
  setActiveSport(sport.id);

  const keys = liveStatKeys(sport);
  check(
    `${id} live stat keys are points plus the sport's own lineKeys`,
    keys[0] === "pts" && sport.lineKeys.every((k) => keys.includes(k)),
    keys.join(" ")
  );

  // Every column the box score draws must be a key the accumulator carries,
  // or the header promises a number nothing can ever fill.
  const uncovered = sport.boxColumns.map(([k]) => k).filter((k) => !keys.includes(k));
  check(
    `${id} accumulator covers every column the box score draws`,
    uncovered.length === 0,
    uncovered.length ? `no key for: ${uncovered.join(" ")}` : `${sport.boxColumns.length} columns covered`
  );

  const game = playOneGame(sport, slots);
  if (!game) {
    check(`${id} simulation ran`, false, "draft did not complete");
    continue;
  }
  const { result } = game;

  // THE HEADLINE: the simulation produces nonzero values, and every one of
  // them is a stat the accumulator supports.
  const lines = Object.values(result.boxA);
  const nonzero = keys.filter((k) => lines.some((l) => Number(l[k]) > 0));
  check(
    `${id} simulation produces nonzero stats the accumulator supports`,
    nonzero.length >= 3,
    `nonzero: ${nonzero.join(" ") || "NONE"}`
  );

  // Feeding a real simulated line through the accumulator has to reproduce it
  // exactly - this is the round trip the live table depends on.
  {
    const source = lines.find((l) => keys.some((k) => Number(l[k]) > 0)) || lines[0];
    const total = {};
    for (const k of keys) total[k] = 0;
    accumulatePeriodStats(total, source, keys);
    const mismatched = keys.filter((k) => Math.round(total[k]) !== Math.round(Number(source[k]) || 0));
    check(
      `${id} accumulating a simulated line reproduces it exactly`,
      mismatched.length === 0,
      mismatched.length ? `differs on: ${mismatched.join(" ")}` : `${keys.length} keys round-tripped`
    );
  }

  // No NaN can reach the table from a real game's period lines.
  {
    const total = {};
    for (const k of keys) total[k] = 0;
    for (const period of result.quarterBoxScores || []) {
      for (const line of Object.values(period.a || {})) accumulatePeriodStats(total, line, keys);
    }
    check(
      `${id} accumulating every real period line yields no NaN`,
      Object.values(total).every((v) => Number.isFinite(v)),
      Object.entries(total).filter(([, v]) => !Number.isFinite(v)).map(([k]) => k).join(" ") || "all finite"
    );
  }

  // ---- the MVP line ---------------------------------------------------------
  const mvpLine = result.mvp?.line || lines[0];
  const text = formatMvpStatLine(sport, mvpLine);
  check(`${id} MVP line is not empty`, !!text && text.length > 0, text);

  if (sport.id === "nba") {
    // Unchanged, deliberately: the line everyone knows.
    check(
      "NBA MVP line still reads PTS / REB / AST",
      /^\d+ Points \/ \d+ Rebounds \/ \d+ Assists$/.test(text),
      text
    );
  } else {
    // NOT a blocklist of every basketball-looking word. Football scores
    // points too, and NFL declares its own ["pts", "PTS"] column - so listing
    // PTS here failed a completely correct football MVP line whenever points
    // happened to be among his top three. Only the stats football does not
    // keep belong in this list.
    const basketball = ["Rebounds", "Assists", "Steals", "Blocks", "REB", "AST", "STL", "BLK"];
    const leaked = basketball.filter((w) => text.includes(w));
    check("NFL MVP line contains no basketball statistics", leaked.length === 0, leaked.length ? `leaked: ${leaked.join(" ")}` : text);
    check(
      "NFL MVP line uses football stat labels with nonzero values",
      /\d/.test(text) && !/\b0 /.test(text),
      text
    );
  }
}

// ---- period lines must sum to the final box score -------------------------
// The live table is the sum of the quarters. If that sum is not the final box
// score then the table people watch fill in is a different game from the one
// they are shown at the end.
{
  setActiveSport("nfl");
  const game = playOneGame(NFL, NFL.slots.quickPlay);
  if (!game) {
    check("NFL period lines sum to the final box score", false, "draft did not complete");
  } else {
    const { result } = game;
    const keys = liveStatKeys(NFL);
    const summed = {};
    const finalTotals = {};
    for (const k of keys) {
      summed[k] = 0;
      finalTotals[k] = 0;
    }
    for (const period of result.quarterBoxScores) {
      for (const line of Object.values(period.a)) accumulatePeriodStats(summed, line, keys);
    }
    for (const line of Object.values(result.boxA)) accumulatePeriodStats(finalTotals, line, keys);
    const off = keys.filter((k) => Math.round(summed[k]) !== Math.round(finalTotals[k]));
    check(
      "NFL period lines sum exactly to the final box score",
      off.length === 0,
      off.length
        ? off.map((k) => `${k}: ${Math.round(summed[k])} vs ${Math.round(finalTotals[k])}`).join(", ")
        : `${keys.length} stats reconciled`
    );

    // The live table has to be non-empty DURING the game, not only after it.
    const nonzeroLive = keys.filter((k) => summed[k] > 0);
    check(
      "NFL quarters carry real football stats, not just points",
      nonzeroLive.length >= 4 && nonzeroLive.some((k) => k !== "pts"),
      `nonzero across quarters: ${nonzeroLive.join(" ") || "NONE"}`
    );
  }
}

// ---- the play feed says football, and says it in words -------------------
{
  setActiveSport("nfl");
  let undefinedText = 0;
  let placeholderUnit = 0;
  let longDecimals = 0;
  let sampled = 0;
  for (let i = 0; i < 12; i++) {
    const game = playOneGame(NFL, i % 2 ? NFL.slots.ranked : NFL.slots.quickPlay);
    if (!game) continue;
    sampled++;
    for (const drive of game.result.drives) {
      const text = String(drive.text || "");
      if (text.includes("undefined")) undefinedText++;
      // "the unit" is what a missing roster entry used to be called out loud.
      if (/the unit/.test(text)) placeholderUnit++;
      // A touchdown carries 6.94 points; nothing should ever print that raw.
      if (/\d\.\d{3,}/.test(text)) longDecimals++;
    }
  }
  check("no play-feed text contains undefined", undefinedText === 0, `${undefinedText} across ${sampled} games`);
  check("no play-feed text falls back to \"the unit\"", placeholderUnit === 0, `${placeholderUnit} across ${sampled} games`);
  check("no play-feed text prints an unrounded value", longDecimals === 0, `${longDecimals} across ${sampled} games`);

  // The final sentence names both teams. NFL wrapped buildGameScript in a
  // lambda that dropped its second and third arguments, so football's closing
  // line read "undefined and undefined finish level at 15.940000000000001".
  const line = NFL.buildGameScript([{ a: 10, b: 10 }], "Home", "Away");
  check(
    "the closing line names both teams and rounds the score",
    !line.includes("undefined") && line.includes("Home") && line.includes("Away") && !/\d\.\d/.test(line),
    line
  );
}

console.log(renderSection("Live box-score accumulation and MVP line, per sport"));
const report = checks.map((c) => ({ title: c.title, status: c.ok ? PASS : FAIL, detail: c.detail }));
for (const c of report) console.log(renderCheck(c));
const { counts, ok } = summarize(report);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
