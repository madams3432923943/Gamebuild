// Solves the `pts` multiplier that brings each of the 10 gamestyles to a
// near-50% win rate against the field, holding each style's identity stats
// (reb/ast/stl/blk/tov, and Isolation Heavy's fixed clutchMods.pts bonus)
// constant. Same methodology as the original 5-tactic calibration: points are
// the only stat this engine converts directly into wins, so it's the right
// knob to solve for while the other stats give a style its character.
//
// Run: node tools/calibrate-gamestyles.mjs
// Paste the FINAL MODS block into js/sports/nba/tactics.js when the spread looks good.
import { PLAYERS } from "../data/nba-players.js";
import { computeDatasetStats, simulateGame } from "../js/sports/nba/engine.js";
import { DraftState } from "../js/draft.js";
import { RANKED_SLOTS } from "../js/sports/nba/constants.js";

const stats = computeDatasetStats(PLAYERS);

// Identity stats fixed (as authored in js/sports/nba/tactics.js); pts is solved for.
// Isolation Heavy's clutchMods.pts is part of its identity (a real, fixed
// 4th-quarter/OT bonus) and is NOT solved - only base pts is, same lever as
// every other style, so two knobs never fight each other for the same
// target win rate.
const base = {
  balanced: { mods: { pts: 1, reb: 1, ast: 1, stl: 1, blk: 1, tov: 1 } },
  "run-and-gun": { mods: { pts: 1, reb: 0.92, ast: 1.08, stl: 0.82, blk: 0.82, tov: 1.3 } },
  "spread-perimeter": { mods: { pts: 1, reb: 0.8, ast: 1.02, stl: 1, blk: 0.95, tov: 1 } },
  "lockdown-defense": { mods: { pts: 1, reb: 0.97, ast: 0.9, stl: 1.35, blk: 1.35, tov: 0.85 } },
  "crash-the-glass": { mods: { pts: 1, reb: 1.4, ast: 0.85, stl: 0.88, blk: 1.05, tov: 0.95 } },
  "paint-dominance": { mods: { pts: 1, reb: 1.15, ast: 0.85, stl: 0.9, blk: 1.05, tov: 0.92 } },
  "ball-movement": { mods: { pts: 1, reb: 0.9, ast: 1.35, stl: 0.95, blk: 0.9, tov: 0.85 } },
  "isolation-heavy": {
    mods: { pts: 1, reb: 0.9, ast: 0.7, stl: 0.92, blk: 0.9, tov: 1.05 },
    clutchMods: { pts: 1.15 },
  },
  "small-ball": { mods: { pts: 1, reb: 0.7, ast: 1.05, stl: 1.05, blk: 0.65, tov: 1 } },
  "defensive-pressure": { mods: { pts: 1, reb: 0.9, ast: 0.92, stl: 1.4, blk: 1, tov: 0.8 } },

  // The second wave. Zone Defense also carries `opponentPaint`, which is a
  // real engine effect (it suppresses the OTHER side's front-court scoring -
  // see applyZoneDefense in engine.js) and is part of its identity, so like
  // Isolation Heavy's clutch bonus it is held fixed while pts is solved.
  // Leaving it out here would solve pts against a zone that doesn't zone.
  "zone-defense": {
    mods: { pts: 1, reb: 1.08, ast: 0.95, stl: 0.82, blk: 1.3, tov: 0.95 },
    opponentPaint: 0.88,
  },
  "full-court-press": { mods: { pts: 1, reb: 0.85, ast: 1.02, stl: 1.45, blk: 0.9, tov: 1.25 } },
  "post-up-heavy": { mods: { pts: 1, reb: 1.28, ast: 0.72, stl: 0.9, blk: 1.05, tov: 0.95 } },
  "switch-everything": { mods: { pts: 1, reb: 0.78, ast: 1.02, stl: 1.28, blk: 0.85, tov: 0.95 } },
  "grind-it-out": { mods: { pts: 1, reb: 1.05, ast: 0.88, stl: 1.05, blk: 1.05, tov: 0.6 } },
};
const ids = Object.keys(base);

function rosterPair() {
  const g = new DraftState(PLAYERS, [], RANKED_SLOTS);
  while (!g.isComplete()) {
    if (!g.rollNextSquad()) break;
    // banTop: 0 keeps the bot at FULL STRENGTH here. The bot is deliberately
    // barred from the top of the board in a real game (see BOT_TOP_PICK_BAN),
    // but this harness drafts BOTH sides with it to produce evenly matched
    // rosters for solving balance constants against. Letting the difficulty
    // nerf in would re-solve TALENT_PARITY and the variance range against
    // rosters no online game is ever played with.
    g.botAutoPick("A", { banTop: 0 });
    g.botAutoPick("B", { banTop: 0 });
  }
  return g;
}

// Patch tactics module resolution the same way the original script did:
// simulateGame looks tactics up by id through the shared TACTICS array, so
// we mutate that array's entries in place rather than re-importing.
const tacticsMod = await import("../js/sports/nba/tactics.js");
function setMods(current) {
  for (const t of tacticsMod.TACTICS) {
    t.mods = current[t.id].mods;
    t.clutchMods = current[t.id].clutchMods || null;
    // Held fixed, not solved - see the note on the base table above.
    t.opponentPaint = current[t.id].opponentPaint;
  }
}

function winRates(current, n) {
  setMods(current);
  const wins = {},
    games = {};
  for (const id of ids) {
    wins[id] = 0;
    games[id] = 0;
  }
  for (const a of ids)
    for (const b of ids) {
      if (a === b) continue;
      for (let i = 0; i < n; i++) {
        const g = rosterPair();
        const r = simulateGame(g.rosterA, g.rosterB, stats, { tacticA: a, tacticB: b });
        games[a]++;
        games[b]++;
        if (r.winner === "A") wins[a]++;
        else wins[b]++;
      }
    }
  return Object.fromEntries(ids.map((id) => [id, (100 * wins[id]) / games[id]]));
}

const current = JSON.parse(JSON.stringify(base));
for (let iter = 0; iter < 10; iter++) {
  const rates = winRates(current, 40);
  const spread = Math.max(...Object.values(rates)) - Math.min(...Object.values(rates));
  console.log(
    `iter ${iter}  spread ${spread.toFixed(1)}  ` +
      ids.map((id) => `${id.slice(0, 6)}:${rates[id].toFixed(0)}%/${current[id].mods.pts.toFixed(3)}`).join(" ")
  );
  if (spread < 6) break;
  // Nudge pts toward parity: 1 point of win rate ~ 0.0022 of pts multiplier
  // (same coefficient as the original 5-tactic solve).
  for (const id of ids) {
    if (id === "balanced") continue;
    current[id].mods.pts = +(current[id].mods.pts - (rates[id] - 50) * 0.0022).toFixed(4);
  }
}

console.log("\nFINAL MODS:");
for (const id of ids) {
  console.log("  " + id.padEnd(20), JSON.stringify(current[id].mods));
  if (current[id].clutchMods) console.log("  " + " ".repeat(20) + "clutchMods:", JSON.stringify(current[id].clutchMods));
}
console.log("\nverification run (n=150 per pair):");
const final = winRates(current, 150);
for (const id of ids) console.log("  " + id.padEnd(20) + final[id].toFixed(1) + "%");
console.log(
  "  spread:",
  (Math.max(...Object.values(final)) - Math.min(...Object.values(final))).toFixed(1)
);
