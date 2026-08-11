// Plays a full game of every LIVE sport, start to finish, on every verify.
//
// WHY THIS EXISTS
//
// NBA worked. It was then broken four separate times while building NFL - a
// render hook added to one sport and not the other, shared slot defaults still
// pointing at basketball, a capability probed by calling it with invented
// arguments, and a dataset rebuild. Every one was a change to SHARED code
// checked against only the sport being worked on.
//
// verify:contract catches a missing or wrong-shaped hook. It cannot catch a
// flow that stops halfway, because nothing was actually playing a game. This
// does: roll squads, fill both rosters, simulate, grade, recap. If a sport
// cannot get from an empty roster to a final score, this fails - whichever
// sport it is, and whichever sport the change was aimed at.

import { SPORTS, ensureSportData } from "../js/sports/index.js";

// A sport may load its dataset on demand - football does. Every live sport is
// loaded before it is played here.
for (const meta of SPORTS) {
  if (meta.live) await ensureSportData(meta.id);
}
import { setActiveSport } from "../js/sports/index.js";
import { DraftState, isEligible } from "../js/draft.js";
import { groupBySeason } from "../js/ui.js";

let failures = 0;
const grades = [];

for (const meta of SPORTS) {
  if (!meta.live) continue;
  const label = meta.name.padEnd(5);
  try {
    setActiveSport(meta.id);
    const sport = (await import(`../js/sports/${meta.id}/index.js`))[meta.id.toUpperCase()];
    const ctx = sport.computeDatasetStats(sport.players(), sport.units?.());
    const rows = sport.playersInEra(sport.players(), sport.defaultEra);

    for (const [mode, slots] of [["quickPlay", sport.slots.quickPlay], ["ranked", sport.slots.ranked]]) {
      const draft = new DraftState(rows, [], slots);
      let rounds = 0;
      while (!draft.isComplete() && rounds < slots.length * 4) {
        const squad = draft.rollNextSquad();
        if (!squad) break;
        rounds++;
        // Draft the way the UI does: group the squad, then hand the card's
        // `lead` to makePick exactly as a click would. The old version wrote
        // straight into the roster, which is why it never noticed that
        // makePick was rejecting every pick on object identity - the test was
        // bypassing the very function that was broken.
        const cards = groupBySeason(squad.players);
        for (const side of ["A", "B"]) {
          const roster = side === "A" ? draft.rosterA : draft.rosterB;
          let placed = false;
          for (const { lead, pos } of cards) {
            if (placed) break;
            const taken = new Set(Object.values(roster).filter(Boolean).map((p) => p.name));
            if (taken.has(lead.name)) continue;
            for (const slot of slots) {
              if (roster[slot]) continue;
              if (!isEligible({ ...lead, pos }, slot)) continue;
              draft.makePick(side, lead, slot);
              placed = roster[slot] != null;
              if (placed) break;
            }
          }
        }
      }
      const filledA = slots.filter((s) => draft.rosterA[s]).length;
      if (filledA < slots.length) {
        throw new Error(`${mode}: draft stalled at ${filledA}/${slots.length} slots after ${rounds} rounds`);
      }

      const result = sport.simulate(draft.rosterA, draft.rosterB, ctx, {
        tacticA: sport.tactics[0],
        tacticB: sport.tactics[Math.min(2, sport.tactics.length - 1)],
        minutesA: sport.defaultMinutes(draft.rosterA),
        minutesB: sport.botMinutes(draft.rosterB),
        matchupsA: sport.usesMatchups ? sport.defaultMatchups(draft.rosterA, draft.rosterB) : undefined,
        forfeitsA: [], forfeitsB: [],
      });

      // A finished game has a score, and the periods have to add up to it -
      // that mismatch is exactly how football displayed 0-0 while simulating
      // 34-27, and it passed every check that only looked at the total.
      const periodSum = (side) =>
        result.quarterBoxScores.reduce(
          (sum, q) => sum + Object.values(q[side]).reduce((s, l) => s + (l.pts || 0), 0), 0);
      const a = Math.round(periodSum("a"));
      const b = Math.round(periodSum("b"));
      if (a !== result.teamScoreA || b !== result.teamScoreB) {
        throw new Error(`${mode}: periods sum to ${a}-${b} but the final says ${result.teamScoreA}-${result.teamScoreB}`);
      }
      if (result.teamScoreA + result.teamScoreB === 0) {
        throw new Error(`${mode}: simulated a scoreless game`);
      }

      // Everything the post-game screens call, in the order they call it - and
      // with the ARGUMENTS they call it with. This passed an empty array where
      // js/main.js passes `{ oppRoster, forfeits }`, so football's third
      // parameter (declared as the array) received an object, `.length` was
      // undefined, the penalty was NaN, and every football roster ever drafted
      // graded F. A test that invents its own arguments proves nothing about
      // whether the app can call it.
      const grade = sport.gradeDraft(draft.rosterA, ctx, {
        oppRoster: draft.rosterB,
        forfeits: [],
      });
      if (!grade?.letter || !Array.isArray(grade.reasons)) throw new Error(`${mode}: gradeDraft shape`);
      if (!Number.isFinite(grade.score)) throw new Error(`${mode}: gradeDraft scored ${grade.score}`);
      grades.push(`${label}/${mode}:${grade.letter}`);
      sport.rotationHint(draft.rosterA);
      sport.buildRecap(result, draft.rosterA, draft.rosterB, "A", "B");
      // Called exactly as js/main.js calls it - (periods, labelA, labelB) -
      // because a test that invents its own arguments proves nothing about
      // whether the app can call it.
      const periods = result.quarterBoxScores.map((q) => ({
        a: Object.values(q.a).reduce((s, l) => s + (l.pts || 0), 0),
        b: Object.values(q.b).reduce((s, l) => s + (l.pts || 0), 0),
      }));
      sport.buildGameScript(periods, "A", "B");

      console.log(`  ${label} ${mode.padEnd(9)} ${result.teamScoreA}-${result.teamScoreB} over ${rounds} rounds, grade ${grade.letter}`);
    }
  } catch (e) {
    failures++;
    console.log(`  ${label} FAILED: ${e.message}`);
  }
}

if (failures) {
  console.error(`\n${failures} sport(s) cannot play a full game.`);
  process.exit(1);
}

// A grade that is the SAME LETTER everywhere is the shape of a broken grade,
// not a strict one - football graded every roster F for weeks and each
// individual F looked like a considered verdict. Real drafts across two sports
// and several rulesets have to disagree with each other at least once.
if (new Set(grades.map((g) => g.split(":")[1])).size < 2) {
  console.error(`\nEvery draft graded the same letter: ${grades.join("  ")}`);
  process.exit(1);
}
console.log(`\n  grades: ${grades.join("  ")}`);
console.log("\nEvery live sport plays start to finish.");
