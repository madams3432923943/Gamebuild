#!/usr/bin/env node
// THE BOT MAY NOT DRAFT FROM THE TOP OF THE BOARD.
//
// WHY THIS EXISTS
//
// The bot used to draw uniformly from the five best (player, slot) combos on
// the board, every round, which meant it walked off with an elite player in
// every single round of every single game. BOT_POOL_SIZE was the only
// difficulty knob and widening it did not help: however wide, the pool was
// still measured from the top, so the bot's roster stayed elite and a human
// who knew the players could at best draw level with it.
//
// So the rule changed shape: the top BOT_TOP_PICK_BAN players are now off
// limits to the bot entirely, and it builds from what is underneath them.
//
// Two ways that rule can be got wrong, and both are checked here:
//
//   1. It can fail to bite. The dataset is one row PER SEASON and a player
//      eligible at two open slots yields a combo each, so "the top 15 combos"
//      can be four people wearing fifteen hats. The ban is by DISTINCT PLAYER
//      for exactly that reason, and this file measures it the same way -
//      independently, from eligibleOpenSlots and the sport's own rate(),
//      rather than by importing the ranking the bot itself used. Asserting
//      against the implementation's own ranking would only prove it agrees
//      with itself.
//
//   2. It can bite too hard. The ban is measured against ONE PICK'S eligible
//      players, not the whole dataset. The thinnest basketball squad holds 12
//      distinct players, and a late pick with a single position-locked slot
//      open can be down to a handful of legal names. Ban fifteen there and the
//      bot has nothing legal left - that is a forfeited slot and a broken
//      roster, not an easier opponent. A thin board must NARROW the ban, so
//      the bot still finishes every roster it starts.
//
// Both sports run the same bot code, so both are driven here: the only
// sport-specific part is rate(), and a scoring function that returned
// something unorderable would defeat the ban silently.

import { DraftState, eligibleOpenSlots, openSlots } from "../js/draft.js";
import { BOT_TOP_PICK_BAN, BOT_MIN_CHOICES, BOT_POOL_SIZE } from "../js/constants.js";
import { SPORTS, setActiveSport, ensureSportData, activeSport } from "../js/sports/index.js";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

console.log(renderSection("Bot difficulty (the top of the board is the human's)"));

/** The distinct players the bot could legally take right now, best first.
 *
 * Derived here from the PUBLIC rules - which slots a player is eligible for,
 * and what the sport says he is worth - rather than from the bot's own
 * internals. A player is worth his best season, since that is the one you
 * would draft. */
function rankedEligible(squad, roster, slots) {
  const rate = activeSport().rate;
  const best = new Map();
  for (const player of squad.players) {
    if (eligibleOpenSlots(player, roster, slots).length === 0) continue;
    const score = rate(player);
    const current = best.get(player.name);
    if (current === undefined || score > current) best.set(player.name, score);
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

const GAMES = 40;

for (const meta of SPORTS) {
  if (!meta.live) continue;
  await ensureSportData(meta.id);
  setActiveSport(meta.id);
  const sport = (await import(`../js/sports/${meta.id}/index.js`))[meta.id.toUpperCase()];
  const slots = sport.slots.ranked;
  const players = sport.playersInEra(sport.players(), "all");

  let picks = 0;
  let violations = 0;
  let worstRank = Infinity; // best (lowest) rank the bot ever managed to take
  let thinBoards = 0;
  let unfilledSlots = 0;

  for (let game = 0; game < GAMES; game++) {
    const draft = new DraftState(players, [], slots);
    // Only the bot's roster is being filled, so the bot's own open slots are
    // the loop condition - isComplete() also waits on the untouched human side.
    while (openSlots(draft.rosterB, slots).length > 0) {
      if (!draft.rollNextSquad()) break;
      // Only the bot's side is exercised. The human roster is left empty on
      // purpose: an empty roster has every slot open, which is the WIDEST the
      // eligible pool ever gets and therefore the case where the ban has the
      // most room to be wrong.
      if (!draft.hasValidPick(draft.rosterB)) continue;

      const ranked = rankedEligible(draft.currentSquad, draft.rosterB, slots);
      const choice = draft.botAutoPick("B");
      if (!choice) continue;
      picks++;

      const rank = ranked.indexOf(choice.player.name); // 0 = best on the board
      // How many names the ban could take while still leaving the bot the
      // floor - the same arithmetic the bot is held to, and the reason a thin
      // board is not a violation.
      const banned = Math.min(BOT_TOP_PICK_BAN, Math.max(0, ranked.length - BOT_MIN_CHOICES));
      if (banned < BOT_TOP_PICK_BAN) thinBoards++;
      if (rank < banned) violations++;
      if (banned === BOT_TOP_PICK_BAN) worstRank = Math.min(worstRank, rank);
    }
    unfilledSlots += openSlots(draft.rosterB, slots).length;
  }

  check(
    `${meta.name}: the bot never took a banned top-${BOT_TOP_PICK_BAN} player`,
    violations === 0,
    `${violations} violations across ${picks} picks in ${GAMES} drafts`
  );

  check(
    `${meta.name}: on a full board the best it ever got was rank ${worstRank + 1}`,
    worstRank >= BOT_TOP_PICK_BAN,
    `best rank taken: ${worstRank === Infinity ? "n/a" : worstRank + 1} (must be > ${BOT_TOP_PICK_BAN})`
  );

  // The ban must not cost the bot a roster. Every slot filled, every game.
  check(
    `${meta.name}: the bot still fills every roster slot`,
    unfilledSlots === 0,
    `${unfilledSlots} slots left empty across ${GAMES} drafts` +
      ` (${thinBoards} picks came off a board too thin for the full ban)`
  );

  // The nerf has to be genuinely defeatable, or it is just a different bot.
  // The human drafting optimally must be able to take players the bot cannot.
  check(
    `${meta.name}: the ban is wider than the pool the bot draws from`,
    BOT_TOP_PICK_BAN > BOT_POOL_SIZE,
    `ban ${BOT_TOP_PICK_BAN} vs pool ${BOT_POOL_SIZE}`
  );

  // The calibration harnesses draft both sides at full strength through this
  // override; if it stopped working, the balance constants would quietly be
  // re-solved against nerfed rosters.
  const full = new DraftState(players, [], slots);
  full.rollNextSquad();
  const rankedFull = rankedEligible(full.currentSquad, full.rosterB, slots);
  const fullChoices = new Set();
  for (let i = 0; i < 200; i++) {
    const probe = new DraftState(players, [], slots);
    probe.squads = full.squads;
    probe.currentSquad = full.currentSquad;
    const pick = probe.botAutoPick("B", { banTop: 0 });
    if (pick) fullChoices.add(rankedFull.indexOf(pick.player.name));
  }
  const topRank = Math.min(...fullChoices);
  check(
    `${meta.name}: banTop 0 restores full-strength drafting for the calibrators`,
    topRank === 0,
    `best rank reachable with banTop 0: ${topRank + 1} (must be 1)`
  );
}

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
