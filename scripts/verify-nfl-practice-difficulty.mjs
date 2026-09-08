#!/usr/bin/env node
// EACH NFL PRACTICE DIFFICULTY IS A DIFFERENT TEAM, NOT A DIFFERENT GRADE.
//
// scripts/verify-mode-rules.mjs already asserts the thing every sport owes:
// the bot drafts better as the difficulty rises, every roster is legal and
// full, and naming a difficulty cannot move the simulation. All three of those
// stayed true while football's difficulties were one axis - Easy a bad team,
// Hard a good one, Medium the average of them - and one axis is not what
// football's practice modes are for:
//
//   EASY    bad on both sides. Beat up on a bad team while learning the pool.
//   MEDIUM  a real offense in front of a soft defense, so a player gets to put
//           up points against an opponent that can answer.
//   HARD    good on both sides, so drafting a great offense and ignoring your
//           own defense loses.
//
// Only the SIDES tell those apart, so sides are what this file measures, over
// a large sample, against the shipped dataset. And it measures the roster, not
// the intention: js/sports/nfl/botdraft.js names a target rating per position
// group, but what a bot actually walks away with is decided by the squads the
// draft happens to roll, so a target and an outcome are different claims.
//
// NOTHING HERE MAY BE ACHIEVED WITH A GAMEPLAY MODIFIER, and the simulation
// half of this file is a REPORT plus one loose ordering check for that reason.
// The point is to show that the roster differences alone produce the intended
// game - not to pin scorelines that would then have to be defended by tuning
// the engine, which is the failure this whole design exists to avoid.

import { DraftState, openSlots } from "../js/draft.js";
import { DIFFICULTY_IDS } from "../js/modes.js";
import { setActiveSport, ensureSportData, activeSport } from "../js/sports/index.js";
import { QUALITY_TIERS } from "../js/sports/nfl/botdraft.js";
import { mulberry32 } from "./lib/seeded-rng.mjs";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

console.log(renderSection("NFL practice difficulty (three teams, not three grades)"));

await ensureSportData("nfl");
setActiveSport("nfl");
const sport = activeSport();
// ONE rating context for the whole run. Rebuilding it per draft is the mistake
// that froze the app on a single click, and this file drafts 450 rosters.
const ctx = sport.computeDatasetStats();
const players = sport.playersInEra(sport.players(), "all");
const slots = sport.slots.ranked;

const OFFENSE = ["QB", "RB", "WR1", "WR2", "WR3", "TE", "OL"];
const DEFENSE = ["DL", "LB", "CB", "S"];
/** The position groups the report is read by. WR is the corps rather than
 * three separate rows - "my receivers" is the unit a player thinks in. */
const GROUPS = {
  QB: ["QB"], RB: ["RB"], WR: ["WR1", "WR2", "WR3"], TE: ["TE"], OL: ["OL"],
  DL: ["DL"], LB: ["LB"], CB: ["CB"], S: ["S"], ST: ["ST"],
};

const DRAFTS = 150;
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const rate = (entry) => (entry ? sport.rate(entry, ctx) : 0);

/** One complete bot roster at one difficulty, drafted the way a real practice
 * game drafts it: roll a squad, take a pick, repeat. The human side is left
 * empty, which is the widest the bot's board ever gets. */
function draftBotRoster(difficulty) {
  const draft = new DraftState(players, [], slots);
  let guard = 0;
  while (openSlots(draft.rosterB, slots).length > 0 && guard++ < 200) {
    if (!draft.rollNextSquad()) break;
    if (!draft.hasValidPick(draft.rosterB)) continue;
    draft.botAutoPick("B", { difficulty });
  }
  return draft.rosterB;
}

// ---------------------------------------------------------------------------
// 1. What each difficulty actually drafts
// ---------------------------------------------------------------------------

const sampled = {};
for (const difficulty of DIFFICULTY_IDS) {
  const rosters = [];
  for (let i = 0; i < DRAFTS; i++) rosters.push(draftBotRoster(difficulty));

  const groups = {};
  for (const [name, groupSlots] of Object.entries(GROUPS)) {
    groups[name] = mean(rosters.map((r) => mean(groupSlots.map((s) => rate(r[s])))));
  }
  sampled[difficulty] = {
    rosters,
    offense: mean(rosters.map((r) => mean(OFFENSE.map((s) => rate(r[s]))))),
    defense: mean(rosters.map((r) => mean(DEFENSE.map((s) => rate(r[s]))))),
    overall: mean(rosters.map((r) => sport.gradeDraft(r, ctx).score)),
    groups,
    // How often the bot's offense is the stacked superstar lineup Medium is
    // defined by not being: four or more of its seven offensive slots at the
    // top of their position.
    stacked: rosters.filter(
      (r) => OFFENSE.filter((s) => rate(r[s]) >= QUALITY_TIERS.elite.rating).length >= 4
    ).length / rosters.length,
    distinct: new Set(rosters.map((r) => slots.map((s) => r[s]?.name || "-").join("|"))).size,
    unfilled: rosters.reduce((n, r) => n + slots.filter((s) => !r[s]).length, 0),
    illegal: rosters.reduce((n, r) => n + illegalPlacements(r), 0),
  };
}

/** A weak bot must still be a LEGAL bot: everybody eligible for the slot he is
 * in, and nobody on the roster twice. Difficulty is pick quality, and a rule it
 * was allowed to bend would be a different game rather than an easier one. */
function illegalPlacements(roster) {
  const names = new Set();
  let bad = 0;
  for (const slot of slots) {
    const entry = roster[slot];
    if (!entry) continue;
    if (names.has(entry.name)) bad++;
    names.add(entry.name);
    const base = sport.basePosition(slot);
    const eligible =
      String(entry.group || "").toUpperCase() === base || (entry.pos || []).includes(base);
    if (!eligible) bad++;
  }
  return bad;
}

const easy = sampled.easy, medium = sampled.medium, hard = sampled.hard;

check(
  "Every difficulty drafts a full, legal, varied roster",
  DIFFICULTY_IDS.every((d) => sampled[d].unfilled === 0 && sampled[d].illegal === 0 && sampled[d].distinct > DRAFTS * 0.9),
  DIFFICULTY_IDS.map((d) => `${d} ${sampled[d].distinct}/${DRAFTS} distinct`).join(", ") +
    ` - ${DIFFICULTY_IDS.reduce((n, d) => n + sampled[d].unfilled, 0)} empty slots,` +
    ` ${DIFFICULTY_IDS.reduce((n, d) => n + sampled[d].illegal, 0)} illegal placements`
);

// EASY: bad across the board, which is two claims, not one. A bot with a weak
// offense and a competent defense is a low-scoring grind, which is the
// opposite of what a beginner needs.
check(
  "Easy is bad on BOTH sides of the ball",
  easy.offense < 0.35 && easy.defense < 0.35,
  `offense ${easy.offense.toFixed(3)}, defense ${easy.defense.toFixed(3)} (both must be under 0.35)`
);

// MEDIUM, the whole point of the sprint: a real offense in front of a soft
// defense. Both halves are asserted, because either one alone is a difficulty
// this sprint already had.
check(
  "Medium's offense is materially better than Easy's",
  medium.offense - easy.offense > 0.2,
  `${easy.offense.toFixed(3)} -> ${medium.offense.toFixed(3)} (+${(medium.offense - easy.offense).toFixed(3)}, must be +0.2)`
);
check(
  "Medium's offense is materially better than Medium's own defense",
  medium.offense - medium.defense > 0.15,
  `offense ${medium.offense.toFixed(3)} vs defense ${medium.defense.toFixed(3)}` +
    ` (+${(medium.offense - medium.defense).toFixed(3)}, must be +0.15)`
);
check(
  "Medium's defense stays deliberately soft",
  medium.defense < 0.5 && medium.defense - easy.defense < 0.2,
  `defense ${medium.defense.toFixed(3)} - under 0.5, and within 0.2 of Easy's ${easy.defense.toFixed(3)}`
);
// The failure mode the sprint named by hand: elite QB + elite backs + three
// elite receivers. A rare high-end season is fine; a lineup of them is a
// different difficulty wearing Medium's label.
check(
  "Medium almost never assembles a stacked superstar offense",
  medium.stacked < 0.05,
  `${(100 * medium.stacked).toFixed(1)}% of Medium rosters have 4+ offensive slots at ${QUALITY_TIERS.elite.rating}+` +
    ` (Hard: ${(100 * hard.stacked).toFixed(1)}%)`
);

// HARD: good everywhere, so a complete roster is the only way through.
check(
  "Hard is good on BOTH sides of the ball",
  hard.offense > 0.7 && hard.defense > 0.7,
  `offense ${hard.offense.toFixed(3)}, defense ${hard.defense.toFixed(3)} (both must clear 0.7)`
);
check(
  "Hard is materially stronger than Medium on both sides",
  hard.offense - medium.offense > 0.1 && hard.defense - medium.defense > 0.2,
  `offense +${(hard.offense - medium.offense).toFixed(3)}, defense +${(hard.defense - medium.defense).toFixed(3)}`
);
// Excellent on average, not mathematically perfect - or every Hard roster is
// the same roster and the second game is the first with the names known.
check(
  "Hard still drafts merely-good players sometimes",
  hard.stacked < 0.9 && hard.offense < 0.95,
  `${(100 * hard.stacked).toFixed(1)}% of Hard rosters are 4+ elite on offense, mean offense ${hard.offense.toFixed(3)}`
);

// The orderings the sprint asked for, per side, stated as one check so a
// regression names which side moved.
check(
  "Offense rises with difficulty; defense rises only at Hard",
  hard.offense > medium.offense && medium.offense > easy.offense &&
    hard.defense > medium.defense && medium.defense >= easy.defense,
  `offense ${easy.offense.toFixed(2)} < ${medium.offense.toFixed(2)} < ${hard.offense.toFixed(2)}  |  ` +
    `defense ${easy.defense.toFixed(2)} <= ${medium.defense.toFixed(2)} < ${hard.defense.toFixed(2)}`
);

// A position group nobody gave a target to would quietly draft from the middle
// of the pool at every difficulty (see FALLBACK in js/sports/nfl/botdraft.js) -
// legal, and silently not the difficulty the player chose. Every group the
// ranked roster actually drafts must separate Easy from Hard.
const flatGroups = Object.keys(GROUPS).filter(
  (g) => hard.groups[g] - easy.groups[g] < 0.15
);
check(
  "Every position group, offense and defense, answers to the difficulty",
  flatGroups.length === 0,
  flatGroups.length
    ? `${flatGroups.join(", ")} barely move between Easy and Hard`
    : Object.keys(GROUPS).map((g) => `${g} +${(hard.groups[g] - easy.groups[g]).toFixed(2)}`).join(" ")
);

console.log("\n  Mean bot roster quality over " + DRAFTS + " drafts each (0-1, percentile within position):");
console.log("    " + "".padEnd(8) + ["OVERALL", "OFFENSE", "DEFENSE"].map((h) => h.padStart(8)).join("") +
  "   " + Object.keys(GROUPS).map((g) => g.padStart(5)).join(""));
for (const difficulty of DIFFICULTY_IDS) {
  const s = sampled[difficulty];
  console.log(
    "    " + difficulty.padEnd(8) +
    [s.overall, s.offense, s.defense].map((v) => v.toFixed(3).padStart(8)).join("") +
    "   " + Object.keys(GROUPS).map((g) => s.groups[g].toFixed(2).padStart(5)).join("")
  );
}

// ---------------------------------------------------------------------------
// 2. What those rosters do on a Sunday
// ---------------------------------------------------------------------------
// The same human-strength roster plays all three, so the ONLY thing that
// changes between the columns below is who it is playing. No difficulty is
// passed to simulate() - it has no parameter for one, which is the structural
// half of this argument and is asserted in scripts/verify-mode-rules.mjs.

const GAMES = 120;
/** The stand-in human: the app's default bot, drafted with no difficulty named
 * at all, which is the ban-and-pool opponent this game has always shipped. It
 * is a reasonable drafter rather than an optimal one, so the win rates below
 * read as "a competent player's", which is the number worth reporting. */
function draftReferenceRoster() {
  const draft = new DraftState(players, [], slots);
  let guard = 0;
  while (openSlots(draft.rosterB, slots).length > 0 && guard++ < 200) {
    if (!draft.rollNextSquad()) break;
    if (!draft.hasValidPick(draft.rosterB)) continue;
    draft.botAutoPick("B");
  }
  return draft.rosterB;
}

const played = {};
for (const difficulty of DIFFICULTY_IDS) {
  let userPoints = 0, botPoints = 0, wins = 0, ties = 0;
  for (let i = 0; i < GAMES; i++) {
    const user = draftReferenceRoster();
    const bot = sampled[difficulty].rosters[i % sampled[difficulty].rosters.length];
    // Seeded per game and identically across difficulties, so the columns
    // differ by roster and not by which random numbers each column drew.
    const result = sport.simulate(user, bot, ctx, { rand: mulberry32(i * 7919 + 13) });
    userPoints += result.teamScoreA;
    botPoints += result.teamScoreB;
    if (result.teamScoreA > result.teamScoreB) wins++;
    else if (result.teamScoreA === result.teamScoreB) ties++;
  }
  played[difficulty] = {
    user: userPoints / GAMES, bot: botPoints / GAMES, winRate: wins / GAMES, ties,
  };
}

// The ONE emergent claim worth failing the build over: a harder opponent must
// actually be harder to beat, and it must be harder because IT scores more,
// not because the human was quietly penalised. Deliberately loose - these are
// simulated football games, and pinning them tighter would mean defending a
// scoreline by tuning the engine, which is exactly what this design forbids.
check(
  "A harder bot is harder to beat, and scores more doing it",
  played.easy.winRate > played.medium.winRate && played.medium.winRate > played.hard.winRate &&
    played.hard.bot > played.medium.bot && played.medium.bot > played.easy.bot,
  DIFFICULTY_IDS.map((d) => `${d} ${(100 * played[d].winRate).toFixed(0)}% win, bot ${played[d].bot.toFixed(1)} pts`).join("  |  ")
);

// Medium's identity, measured on the scoreboard rather than on the roster: its
// weak defense is supposed to let a player score MORE than Hard's does, and
// its decent offense is supposed to answer back harder than Easy's.
check(
  "Medium is the high-scoring one: more user points than Hard, more bot points than Easy",
  played.medium.user > played.hard.user && played.medium.bot > played.easy.bot,
  `user ${played.medium.user.toFixed(1)} vs Hard's ${played.hard.user.toFixed(1)};` +
    ` bot ${played.medium.bot.toFixed(1)} vs Easy's ${played.easy.bot.toFixed(1)}`
);

console.log(`\n  ${GAMES} simulated games per difficulty, same reference roster on the human side:`);
console.log("    " + "".padEnd(8) + ["USER PTS", "BOT PTS", "USER WIN%"].map((h) => h.padStart(10)).join(""));
for (const difficulty of DIFFICULTY_IDS) {
  const p = played[difficulty];
  console.log("    " + difficulty.padEnd(8) +
    [p.user.toFixed(1), p.bot.toFixed(1), (100 * p.winRate).toFixed(1)].map((v) => v.padStart(10)).join(""));
}

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
