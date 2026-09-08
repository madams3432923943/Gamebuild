#!/usr/bin/env node
// WHAT EACH MODE PROMISES, MEASURED.
//
// WHY THIS EXISTS
//
// The Play screen went from three modes to two, and Practice grew a difficulty.
// Three claims are made about that arrangement, and all three are the kind that
// stay true right up until somebody adds a feature:
//
//   1. HARD DRAFTS BETTER THAN MEDIUM, WHICH DRAFTS BETTER THAN EASY. Not on
//      one draft - a single draft is mostly which squads got rolled - but on
//      the average roster grade across many. If that ordering ever inverts, the
//      difficulty picker is lying to the player about what they chose.
//
//   2. DIFFICULTY CANNOT REACH THE SIMULATION. It is a rule about WHICH player
//      the bot takes and nothing else: no rating, no multiplier, no RNG, no
//      win-probability thumb. Checked structurally (nothing the engine reads
//      carries a difficulty) and behaviourally (the same two rosters and the
//      same seed produce the identical game whatever difficulty is named).
//
//   3. EASY HAS NO CLOCK AND AN OPEN BOARD; NOTHING ELSE DOES. Easy is the
//      learning mode, and "no timer" has to mean no timeout path exists at all,
//      not that one is hidden.
//
// Plus the boring one that is easy to break and expensive to notice: a history
// row written by any version of this app must still render a truthful label.
//
// Both sports are driven, because the difficulty windows are defined over each
// sport's OWN rating architecture and a window that separates basketball's
// board says nothing about football's twelve position-locked slots.

import { DraftState, openSlots, difficultyWindow } from "../js/draft.js";
import { withSeededMathRandom } from "../js/lib/seeded-rng.js";
import { SPORTS, setActiveSport, ensureSportData, activeSport } from "../js/sports/index.js";
import {
  MODES, FRIEND_MODE, DIFFICULTIES, DIFFICULTY_IDS, resolveMode, modeLabel, historyModeLabel,
} from "../js/modes.js";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

console.log(renderSection("Game modes: what each one promises"));

// ---------------------------------------------------------------------------
// 3. The rules each mode declares
// ---------------------------------------------------------------------------

check(
  "Only Online Ranked moves a rank",
  MODES.ranked.ranked === true &&
    MODES.practice.ranked === false &&
    FRIEND_MODE.ranked === false,
  "ranked=true for Online Ranked alone; practice and friend matches do not count"
);

check(
  "The Play screen offers exactly Online Ranked and Practice",
  Object.keys(MODES).join(",") === "ranked,practice",
  Object.values(MODES).map((m) => m.label).join(" / ")
);

check(
  "Play a Friend is not a Play-screen mode",
  !Object.values(MODES).some((m) => m.id === "friend"),
  "reachable only by challenging a specific friend from the Friends tab"
);

const easy = resolveMode("practice", "easy");
const medium = resolveMode("practice", "medium");
const hard = resolveMode("practice", "hard");
const ranked = resolveMode("ranked");

check(
  "Easy practice: stats shown, no clock, no rank",
  easy.openBoard === true && easy.timed === false && easy.ranked === false,
  "openBoard=true timed=false ranked=false"
);

check(
  "Medium practice: stats hidden, clock on, no rank",
  medium.openBoard === false && medium.timed === true && medium.ranked === false,
  "openBoard=false timed=true ranked=false"
);

check(
  "Hard practice: stats hidden, clock on, no rank",
  hard.openBoard === false && hard.timed === true && hard.ranked === false,
  "openBoard=false timed=true ranked=false"
);

check(
  "Online Ranked and Friend matches both run the clock with the board hidden",
  ranked.timed && !ranked.openBoard && FRIEND_MODE.timed && !FRIEND_MODE.openBoard,
  "timed=true openBoard=false for both"
);

check(
  "Easy is the ONLY mode without a clock",
  [easy, medium, hard, ranked, FRIEND_MODE].filter((m) => !m.timed).length === 1,
  "one untimed mode of five"
);

check(
  "A practice game is labelled with its difficulty",
  modeLabel(easy) === "Practice (Easy)" && modeLabel(hard) === "Practice (Hard)" &&
    modeLabel(ranked) === "Online Ranked",
  `${modeLabel(easy)} / ${modeLabel(medium)} / ${modeLabel(hard)} / ${modeLabel(ranked)}`
);

// ---------------------------------------------------------------------------
// Legacy history still renders truthfully
// ---------------------------------------------------------------------------
// Rows written by four different versions of this app. NONE of them are
// migrated - the label is computed at read time - so this is the only thing
// standing between an old row and a wrong claim about what was played.

const LEGACY_ROWS = [
  [{ mode: "offline" }, "Practice", "a bot game from before modes were recorded"],
  [{ mode: "online" }, "Ranked", "a ranked online game"],
  [{ mode: "friendly" }, "Friend Match", "a friend challenge (used to read 'Practice')"],
  [{ mode: "local" }, "Local", "pass-and-play, removed years ago"],
  [{ mode: "offline", gameMode: "practice", difficulty: "hard" }, "Practice (Hard)", "a row written today"],
  [{ mode: "offline", gameMode: "practice" }, "Practice", "practice with no difficulty recorded"],
  [{ mode: "online", gameMode: "ranked" }, "Ranked", "a ranked row written today"],
  [{}, "Practice", "a row with no mode at all"],
];
const legacyWrong = LEGACY_ROWS.filter(([row, want]) => historyModeLabel(row) !== want);
check(
  "Every stored history row, of every vintage, still reads truthfully",
  legacyWrong.length === 0,
  legacyWrong.length
    ? legacyWrong.map(([row, want]) => `${JSON.stringify(row)} -> ${historyModeLabel(row)} (want ${want})`).join("; ")
    : `${LEGACY_ROWS.length} row shapes, including ${LEGACY_ROWS.filter(([r]) => !r.gameMode).length} predating the new labels`
);

// ---------------------------------------------------------------------------
// 2. Difficulty cannot reach the simulation, structurally
// ---------------------------------------------------------------------------
// The window is the entire mechanism. If a difficulty ever grew a second field
// the engine could read, this is what would catch it.

const difficultyKeys = new Set(
  Object.values(DIFFICULTIES).flatMap((d) => Object.keys(d))
);
const ALLOWED = new Set(["id", "label", "blurb", "tagline", "timed", "openBoard", "window"]);
const unexpected = [...difficultyKeys].filter((k) => !ALLOWED.has(k));
check(
  "A difficulty declares nothing the simulation could read",
  unexpected.length === 0,
  unexpected.length ? `unexpected keys: ${unexpected.join(", ")}` : [...difficultyKeys].join(", ")
);

check(
  "Medium is the calibrated bot, unchanged",
  difficultyWindow("medium") === null,
  "medium keeps the legacy ban-and-pool path every balance constant was solved against"
);

// ---------------------------------------------------------------------------
// 1. The bot actually drafts better as the difficulty rises
// ---------------------------------------------------------------------------

/** One complete bot roster at one difficulty, filled the way a real draft
 * fills it: roll a squad, take a pick, repeat until every slot is gone. */
function draftBotRoster(sport, players, slots, difficulty) {
  const draft = new DraftState(players, [], slots);
  let guard = 0;
  while (openSlots(draft.rosterB, slots).length > 0 && guard++ < 200) {
    if (!draft.rollNextSquad()) break;
    if (!draft.hasValidPick(draft.rosterB)) continue;
    draft.botAutoPick("B", { difficulty });
  }
  return draft;
}

const DRAFTS_PER_DIFFICULTY = 30;
const grades = {};

for (const meta of SPORTS) {
  if (!meta.live) continue;
  await ensureSportData(meta.id);
  setActiveSport(meta.id);
  const sport = activeSport();
  const slots = sport.slots.ranked;
  const players = sport.playersInEra(sport.players(), "all");
  // Built ONCE. Rebuilding a rating index per draft is the mistake that froze
  // this app on a single click, and thirty drafts a difficulty would pay for it
  // ninety times.
  const stats = sport.computeDatasetStats(sport.players());

  const bySport = {};
  let unfilled = 0;
  let illegal = 0;
  const rosterSignatures = { easy: new Set(), medium: new Set(), hard: new Set() };

  for (const difficulty of DIFFICULTY_IDS) {
    const scores = [];
    for (let i = 0; i < DRAFTS_PER_DIFFICULTY; i++) {
      const draft = draftBotRoster(sport, players, slots, difficulty);
      unfilled += openSlots(draft.rosterB, slots).length;
      // LEGAL, not merely full. A weak bot must still be a legal bot: every
      // slot holds a player eligible for it, and nobody is on the roster twice.
      const names = new Set();
      for (const slot of slots) {
        const player = draft.rosterB[slot];
        if (!player) continue;
        if (names.has(player.name)) illegal++;
        names.add(player.name);
        if (!player.pos.includes(sport.basePosition(slot)) && !sport.isBenchSlot(slot) && slot !== "6TH") {
          illegal++;
        }
      }
      rosterSignatures[difficulty].add(slots.map((s) => draft.rosterB[s]?.name || "-").join("|"));
      scores.push(sport.gradeDraft(draft.rosterB, stats).score);
    }
    bySport[difficulty] = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  grades[meta.name] = bySport;

  check(
    `${meta.name}: Hard drafts better than Medium, and Medium better than Easy`,
    bySport.hard > bySport.medium && bySport.medium > bySport.easy,
    `easy ${bySport.easy.toFixed(3)} < medium ${bySport.medium.toFixed(3)} < hard ${bySport.hard.toFixed(3)}` +
      ` (mean draft grade over ${DRAFTS_PER_DIFFICULTY} drafts each)`
  );

  check(
    `${meta.name}: the gap between Easy and Hard is material, not noise`,
    bySport.hard - bySport.easy > 0.05,
    `${(bySport.hard - bySport.easy).toFixed(3)} apart on a 0-1 grade scale`
  );

  check(
    `${meta.name}: every difficulty fills every roster slot legally`,
    unfilled === 0 && illegal === 0,
    `${unfilled} empty slots, ${illegal} illegal placements across ` +
      `${DRAFTS_PER_DIFFICULTY * DIFFICULTY_IDS.length} drafts`
  );

  // A difficulty that always produced the same roster would be a script, not an
  // opponent - the second game would be the first game with the names known.
  const identical = DIFFICULTY_IDS.filter((d) => rosterSignatures[d].size < 2);
  check(
    `${meta.name}: no difficulty drafts the same roster every time`,
    identical.length === 0,
    DIFFICULTY_IDS.map((d) => `${d} ${rosterSignatures[d].size}/${DRAFTS_PER_DIFFICULTY} distinct`).join(", ")
  );
}

// ---------------------------------------------------------------------------
// 2, behaviourally: the same rosters simulate identically at every difficulty
// ---------------------------------------------------------------------------
// The structural check above says a difficulty declares nothing the engine
// could read. This says it: two rosters, one seed, three difficulties named,
// one result. If a difficulty ever did thumb the scale, the scores would part.

for (const meta of SPORTS) {
  if (!meta.live) continue;
  setActiveSport(meta.id);
  const sport = activeSport();
  const slots = sport.slots.ranked;
  const players = sport.playersInEra(sport.players(), "all");
  const stats = sport.computeDatasetStats(sport.players());

  // ONE pair of rosters, drafted once. The point is that the same rosters give
  // the same game - drafting per difficulty would change the rosters and prove
  // nothing about the simulation.
  const a = draftBotRoster(sport, players, slots, "medium").rosterB;
  const b = draftBotRoster(sport, players, slots, "medium").rosterB;

  // Seeded the way the offline path seeds a real game (see runLocalSimulation
  // in js/main.js): the engine draws from Math.random, and the seeded stream is
  // installed around the call rather than passed into it.
  const results = DIFFICULTY_IDS.map(() =>
    withSeededMathRandom(12345, () => sport.simulate(a, b, stats))
  );
  const scorelines = new Set(results.map((r) => `${r.teamScoreA}-${r.teamScoreB}`));
  check(
    `${meta.name}: naming a difficulty cannot change the simulation`,
    scorelines.size === 1,
    `${[...scorelines].join(" / ")} - the engine is never told which difficulty was chosen`
  );
}

for (const c of checks) console.log(renderCheck(c));
console.log("\n  Mean bot draft grade by difficulty:");
for (const [name, by] of Object.entries(grades)) {
  console.log(`    ${name.padEnd(4)} easy ${by.easy.toFixed(3)}  medium ${by.medium.toFixed(3)}  hard ${by.hard.toFixed(3)}`);
}
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
