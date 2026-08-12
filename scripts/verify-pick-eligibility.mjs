#!/usr/bin/env node
// A CLICK CAN NEVER PRODUCE A PICK WITHOUT A SLOT.
//
// WHY THIS EXISTS
//
// The draft board enables a player card from the UNION of the positions he
// held across every draftable season on offer - a man who was a power forward
// one year and a centre another is offered while either slot is open. That is
// correct: he really is draftable.
//
// The pick handler then evaluates the ONE season you chose. When those two
// disagree - you pick the power-forward year and only centre is open -
// eligibleOpenSlots returns an empty list, and both handlers did this:
//
//     if (slots.length === 1 || slots.every((s) => s.startsWith("BENCH"))) {
//       finalizePick(player, slots[0]);
//
// `[].every(...)` is TRUE. Vacuous truth turned "this player cannot be placed"
// into "place him anywhere", and `slots[0]` is `undefined`. Offline that is a
// lost pick. Online it is submitted as `p_slot: undefined`, which the real RPC
// rejects with "slot is not valid for nba/ranked" - a confusing server error
// for a click the interface had allowed - and against the test double it
// stored a slotless pick that crashed the next render.
//
// Both halves are checked here: the SHORTCUT must never fire on an empty list,
// and the season picker must not offer a year that cannot be placed.

import { eligibleOpenSlots, resolvePickSlot } from "../js/draft.js";
import { SPORTS, setActiveSport, ensureSportData } from "../js/sports/index.js";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

console.log(renderSection("Draft pick eligibility (a click always yields a real slot)"));

// resolvePickSlot is THE rule, imported rather than restated. An earlier draft
// of this file copied the branch out of js/main.js and asserted against the
// copy, which proves only that the copy behaves like itself - the same mistake
// that let the two handlers drift apart in the first place.

// ---- the vacuous-truth case, sport by sport --------------------------------
for (const meta of SPORTS) {
  if (!meta.live) continue;
  await ensureSportData(meta.id);
  setActiveSport(meta.id);
  const sport = (await import(`../js/sports/${meta.id}/index.js`))[meta.id.toUpperCase()];
  const slots = sport.slots.ranked;

  // A roster with every slot filled: nothing can be placed, whoever he is.
  const full = Object.fromEntries(slots.map((s, i) => [s, { name: `filled-${i}` }]));
  const anyone = { name: "Nobody Fits", pos: [sport.basePosition(slots[0])] };
  const none = eligibleOpenSlots(anyone, full, slots);

  check(
    `${meta.name}: a full roster leaves no eligible slot`,
    none.length === 0,
    `${none.length} slots offered against a full roster`
  );

  const resolved = resolvePickSlot(anyone, full, slots);
  check(
    `${meta.name}: an unplaceable player resolves to no slot, not to undefined`,
    resolved.slot === null && resolved.choices.length === 0,
    `slot=${JSON.stringify(resolved.slot)} choices=${resolved.choices.length}`
  );

  // The shortcut must still WORK, or this check would pass by breaking drafting.
  const empty = {};
  const first = { name: "Fits Once", pos: [sport.basePosition(slots[0])] };
  const one = resolvePickSlot(first, empty, [slots[0]]);
  check(
    `${meta.name}: a single eligible slot is still auto-placed`,
    one.slot === slots[0],
    `resolved to ${JSON.stringify(one.slot)} for a one-slot board`
  );
}

// ---- the season/card disagreement that produces the empty list -------------
setActiveSport("nba");
const NBA_SLOTS = ["PG", "SG", "SF", "PF", "C", "BENCH1", "BENCH2", "BENCH3", "BENCH4", "BENCH5"];
const pfYear = { name: "Two Position Guy", team: "X", decade: "2010s", season: 2015, pos: ["PF"] };
const cYear = { ...pfYear, season: 2018, pos: ["C"] };
// What renderPlayerCard evaluates: every position across the seasons on offer.
const unionCard = { ...pfYear, pos: ["PF", "C"] };
// PF and all five bench spots taken; only C is open.
const roster = {
  PF: { name: "a" }, BENCH1: { name: "b" }, BENCH2: { name: "c" },
  BENCH3: { name: "d" }, BENCH4: { name: "e" }, BENCH5: { name: "f" },
};

const cardSlots = eligibleOpenSlots(unionCard, roster, NBA_SLOTS);
const pfSlots = eligibleOpenSlots(pfYear, roster, NBA_SLOTS);
const cSlots = eligibleOpenSlots(cYear, roster, NBA_SLOTS);

check(
  "The card is enabled from the union of a player's seasons",
  cardSlots.length > 0,
  `union offers ${cardSlots.join(", ") || "nothing"}`
);
check(
  "A season that cannot be placed is detectable before it is chosen",
  pfSlots.length === 0 && cSlots.length > 0,
  `2015 (PF) -> ${pfSlots.length} slots, 2018 (C) -> ${cSlots.join(", ")}`
);
const pfResolved = resolvePickSlot(pfYear, roster, NBA_SLOTS);
const cResolved = resolvePickSlot(cYear, roster, NBA_SLOTS);
check(
  "Choosing the unplaceable season yields no slot rather than undefined",
  pfResolved.slot === null && pfResolved.choices.length === 0,
  `2015 (PF) resolved to ${JSON.stringify(pfResolved.slot)}`
);
check(
  "Choosing the placeable season still drafts him",
  cResolved.slot === "C",
  `2018 (C) resolved to ${JSON.stringify(cResolved.slot)}`
);

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
