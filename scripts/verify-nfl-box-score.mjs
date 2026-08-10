#!/usr/bin/env node
// Football box-score attribution, over many simulated games.
//
// WHY THIS EXISTS
//
// The box score credited only the man who FINISHED a drive. Two things
// followed. Drives that ended in a punt or a field goal credited nobody, so
// most of a game's yardage existed only in the score. And on a scoring drive
// the lone scorer took every catch and every yard, so second and third
// receivers finished with rows of zeros while one man caught eleven passes -
// eleven on the field, one in the box score.
//
// Both are statistical, so a single game cannot prove either way: one quiet
// receiver is a quiet game, and one busy receiver is a good game. This runs
// many games and asserts on the distribution, plus the reconciliations that
// must hold in EVERY game individually.
//
// Reads as a checklist of what a football box score has to be true about
// itself. It is not the play-level ledger - this model works in drives, and
// pretending otherwise would be inventing data - but everything it does claim
// has to agree with everything else it claims.

import { setActiveSport } from "../js/sports/index.js";
import { NFL } from "../js/sports/nfl/index.js";
import { DraftState } from "../js/draft.js";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const GAMES = Number(process.env.NFL_BOX_GAMES || 400);

// Slots that can catch a pass on a ranked roster.
const CATCHERS = ["RB", "WR1", "WR2", "WR3", "TE"];
const RECEIVERS = ["WR1", "WR2", "WR3", "TE"];

setActiveSport("nfl");
// Football's dataset loads on demand now (see NFL.preload), so a script that
// reads the player pool has to ask for it first.
await NFL.preload();

const rows = NFL.playersInEra(NFL.players(), NFL.defaultEra);
const slots = NFL.slots.ranked;
const ctx = NFL.computeDatasetStats(NFL.players(), NFL.units());

/** Fills both rosters through the real draft, the way verify-playable does. */
function playOneGame() {
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
  const result = NFL.simulate(draft.rosterA, draft.rosterB, ctx, {});
  return [
    { box: result.boxA, roster: draft.rosterA, team: result.teamStatsA, drives: result.drives, side: "A", score: result.teamScoreA },
    { box: result.boxB, roster: draft.rosterB, team: result.teamStatsB, drives: result.drives, side: "B", score: result.teamScoreB },
  ];
}

const fails = {
  compMismatch: 0,
  yardsMismatch: 0,
  passTdMismatch: 0,
  rushTdNoYards: 0,
  recTdNoCatch: 0,
  negative: 0,
  negativeYards: 0,
  playerLines: 0,
  tightEndRushTd: 0,
  teamPassYards: 0,
  teamRushYards: 0,
  teamTotalYards: 0,
  scoreLedger: 0,
  impossibleTeam: 0,
};
// Who actually carried the ball on scoring runs, so the gate can be shown to
// redirect the work rather than simply delete it.
const rushTdBy = { QB: 0, RB: 0, WR: 0, TE: 0 };
let teams = 0;
let silentReceiverGames = 0;
let topShareSum = 0;
let example = null;

for (let n = 0; n < GAMES; n++) {
  const sides = playOneGame();
  if (!sides) continue;
  for (const { box, team, drives, side, score } of sides) {
    teams++;
    const rec = (slot) => box[slot] || {};
    const sumRec = CATCHERS.reduce((s, k) => s + (rec(k).rec || 0), 0);
    const sumYds = CATCHERS.reduce((s, k) => s + (rec(k).rec_yds || 0), 0);
    const sumRecTds = CATCHERS.reduce((s, k) => s + (rec(k).rec_tds || 0), 0);

    // Per-game reconciliations. These are not statistical - a single
    // violation is a bug.
    if (box.QB.comp !== sumRec) fails.compMismatch++;
    if (box.QB.pass_yds !== sumYds) fails.yardsMismatch++;
    if (box.QB.pass_tds !== sumRecTds) fails.passTdMismatch++;

    for (const slot of CATCHERS) {
      const line = rec(slot);
      // A scoring line that contradicts itself: a touchdown with no yardage
      // on the play type that produced it.
      if ((line.rush_tds || 0) > 0 && (line.rush_yds || 0) === 0) {
        fails.rushTdNoYards++;
        example = example || `${slot} ${line.rush_tds} rush TD on ${line.rush_yds} yards`;
      }
      if ((line.rec_tds || 0) > 0 && (line.rec || 0) === 0) fails.recTdNoCatch++;
      // A tight end does not take handoffs in a model that has no plays to
      // call. See RUSH_CARRIER_WEIGHTS in js/sports/nfl/constants.js.
      if (slot === "TE" && (line.rush_tds || 0) > 0) fails.tightEndRushTd += line.rush_tds;
      // A COUNTING stat can never be negative - nobody catches minus one pass.
      // YARDAGE is signed, and a back stuffed twice for losses genuinely
      // finishes a game below zero, so that is counted separately and held to
      // a rate rather than forbidden outright. Lumping the two together made
      // an honest football outcome look like a corrupt box score.
      if ((line.rec || 0) < 0 || (line.carries || 0) < 0 || (line.comp || 0) < 0 ||
          (line.att || 0) < 0 || (line.targets || 0) < 0) fails.negative++;
      if ((line.rec_yds || 0) < 0 || (line.rush_yds || 0) < 0) fails.negativeYards++;
      fails.playerLines++;
    }

    // Counted over every ball carrier, QB included - CATCHERS above does not
    // list him, and reading the split off that loop reported a league where no
    // quarterback ever ran it in.
    for (const slot of ["QB", ...CATCHERS]) {
      const carrier = slot.replace(/\d+$/, "");
      if (carrier in rushTdBy) rushTdBy[carrier] += rec(slot).rush_tds || 0;
    }
    // ---- team totals are the sum of the lines, never a parallel tally ----
    const slotKeys = Object.keys(box);
    const linePass = slotKeys.reduce((s2, k) => s2 + (box[k].rec_yds || 0), 0);
    const lineRush = slotKeys.reduce((s2, k) => s2 + (box[k].rush_yds || 0), 0);
    if (team.passYards !== linePass) fails.teamPassYards++;
    if (team.rushYards !== lineRush) fails.teamRushYards++;
    if (team.totalYards !== team.passYards + team.rushYards) fails.teamTotalYards++;

    // Every point on the scoreboard is a point some play in the ledger put
    // there. This is the assertion that makes the box score trustworthy: the
    // score cannot be something the plays did not produce.
    const ledgerPoints = drives
      .filter((d) => d.team === side)
      .reduce((s2, d) => s2 + d.points, 0);
    if (Math.round(ledgerPoints) !== Math.round(score)) fails.scoreLedger++;

    // Nothing a football team cannot do.
    if (team.thirdDownConversions > team.thirdDownAttempts) fails.impossibleTeam++;
    if (team.redZoneTouchdowns > team.redZoneTrips) fails.impossibleTeam++;
    if (team.possessionSeconds < 0 || team.drives <= 0) fails.impossibleTeam++;
    if (team.averageStart < 0 || team.averageStart > 100) fails.impossibleTeam++;

    for (const slot of RECEIVERS) if ((rec(slot).rec || 0) === 0) silentReceiverGames++;
    topShareSum += sumRec > 0 ? Math.max(...CATCHERS.map((k) => rec(k).rec || 0)) / sumRec : 0;
  }
}

const silentPct = (100 * silentReceiverGames) / (teams * RECEIVERS.length);
const topShare = (100 * topShareSum) / teams;

const checks = [
  {
    title: "QB completions equal the receptions credited to his receivers",
    ok: fails.compMismatch === 0,
    detail: `${fails.compMismatch} mismatches in ${teams} team-games`,
  },
  {
    title: "QB passing yards equal the receiving yards credited",
    ok: fails.yardsMismatch === 0,
    detail: `${fails.yardsMismatch} mismatches in ${teams} team-games`,
  },
  {
    title: "Passing touchdowns equal receiving touchdowns",
    ok: fails.passTdMismatch === 0,
    detail: `${fails.passTdMismatch} mismatches in ${teams} team-games`,
  },
  {
    title: "No rushing touchdown without rushing yards",
    ok: fails.rushTdNoYards === 0,
    detail: fails.rushTdNoYards ? `${fails.rushTdNoYards} contradictory lines, e.g. ${example}` : "none",
  },
  {
    title: "Tight ends are never credited a rushing touchdown",
    ok: fails.tightEndRushTd === 0,
    detail: `${fails.tightEndRushTd} TE rushing TDs in ${teams} team-games`,
  },
  {
    // The gate has to REDIRECT the carries, not delete them - a league where
    // nobody runs it in would be a different bug wearing the same fix.
    title: "Rushing touchdowns go to backs and quarterbacks",
    ok: rushTdBy.RB + rushTdBy.QB > 0 && rushTdBy.RB > rushTdBy.WR,
    detail: `QB ${rushTdBy.QB}  RB ${rushTdBy.RB}  WR ${rushTdBy.WR}  TE ${rushTdBy.TE}`,
  },
  {
    title: "No receiving touchdown without a reception",
    ok: fails.recTdNoCatch === 0,
    detail: `${fails.recTdNoCatch} contradictory lines`,
  },
  {
    title: "Team passing yards equal the sum of receiving yards",
    ok: fails.teamPassYards === 0,
    detail: `${fails.teamPassYards} mismatches in ${teams} team-games`,
  },
  {
    title: "Team rushing yards equal the sum of individual rushing yards",
    ok: fails.teamRushYards === 0,
    detail: `${fails.teamRushYards} mismatches in ${teams} team-games`,
  },
  {
    title: "Team total yards equal passing plus rushing",
    ok: fails.teamTotalYards === 0,
    detail: `${fails.teamTotalYards} mismatches in ${teams} team-games`,
  },
  {
    title: "Every point on the scoreboard came from a drive in the ledger",
    ok: fails.scoreLedger === 0,
    detail: `${fails.scoreLedger} mismatches in ${teams} team-games`,
  },
  {
    title: "Team stats are physically possible",
    ok: fails.impossibleTeam === 0,
    detail: `${fails.impossibleTeam} impossible values (3rd down, red zone, possession, field position)`,
  },
  {
    title: "No negative counting stats",
    ok: fails.negative === 0,
    detail: `${fails.negative} negative counts over ${fails.playerLines} player lines`,
  },
  {
    // Real, but rare. A game full of players finishing below zero would mean
    // drives were losing ground far too often.
    title: "Negative yardage games are rare (under 2%)",
    ok: fails.playerLines === 0 || fails.negativeYards / fails.playerLines < 0.02,
    detail: `${fails.negativeYards} of ${fails.playerLines} player lines (${((fails.negativeYards / Math.max(1, fails.playerLines)) * 100).toFixed(2)}%)`,
  },
  {
    // The headline behaviour: everyone on the field touches the ball.
    //
    // The budget was 2% when receptions were a SHARE of each drive - under
    // that model a receiver could not reach zero, because he always got a
    // fraction. Catches are discrete events now, drawn per play, so a fourth
    // option genuinely can be held without one. Real football does that to
    // somebody most weeks, and forcing a guaranteed catch would be inventing
    // one. 10% is the honest ceiling; the bug this exists to catch ran at
    // 71.9%, so there is no risk of it hiding inside this budget.
    title: "Receivers are not shut out of the box score",
    ok: silentPct < 10,
    detail: `${silentPct.toFixed(1)}% of receiver-games had zero catches (budget < 10%)`,
  },
  {
    // The other half: work spread, not concentrated on one man. A team's
    // leading receiver taking more than about half its catches is the old
    // single-scorer behaviour returning by another route.
    title: "Work is spread across pass-catchers, not concentrated on one",
    ok: topShare < 50,
    detail: `leading receiver takes ${topShare.toFixed(1)}% of team catches (budget < 50%)`,
  },
];

// Ordering is a contract too, and it is what a reader notices first.
setActiveSport("nfl");
const sample = playOneGame();
const order = sample ? NFL.orderedRosterSlots(sample[0].roster) : [];
const offence = order.filter((s) => ["QB", "RB", "WR1", "WR2", "WR3", "TE"].includes(s));
checks.push({
  title: "Box score reads QB, RB, receivers, tight end - in that order",
  ok: JSON.stringify(offence) === JSON.stringify(["QB", "RB", "WR1", "WR2", "WR3", "TE"]),
  detail: order.join(" "),
});
checks.push({
  title: "NFL declares no final-buzzer re-sort",
  ok: NFL.sortBoxBy == null,
  detail: `sortBoxBy=${JSON.stringify(NFL.sortBoxBy)}`,
});

console.log(renderSection(`NFL box-score attribution (${teams} team-games)`));
const report = checks.map((c) => ({ title: c.title, status: c.ok ? PASS : FAIL, detail: c.detail }));
for (const c of report) console.log(renderCheck(c));
const { counts, ok } = summarize(report);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
