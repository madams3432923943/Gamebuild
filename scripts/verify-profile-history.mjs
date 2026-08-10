#!/usr/bin/env node
// Per-sport profile history: a football game is a football game.
//
// WHY THIS EXISTS
//
// The profile screen had already been made sport-aware almost everywhere -
// personal bests, career totals, era records, MVP counts and both game records
// are all namespaced by sport. `history` was the one that was not, because it
// is a plain list rather than a keyed map and so nothing forced the question.
//
// The result: Recent Games under the NBA tab showed football scores, and a win
// streak counted wins across both sports as though they were one run.
//
// The hard part is not the filtering, it is the ROWS THAT PREDATE IT. Entries
// written before history recorded a sport carry no sport, and there is no
// honest way to assign them - the profile cannot tell whether an unstamped row
// was a basketball game or one of the football games that caused the bug.
// Guessing basketball would be a fabrication dressed as a migration. They are
// excluded from every sport and counted out loud instead, and that behaviour
// is what most of this file pins down.

import { historyFor, winStreaks, HISTORY_LIMIT } from "../js/profile.js";
import { NBA } from "../js/sports/nba/index.js";
import { NFL } from "../js/sports/nfl/index.js";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const game = (sport, won, extra = {}) => ({
  date: new Date().toISOString(),
  mode: "practice",
  ...(sport ? { sport } : {}),
  won,
  opponentLabel: "Bot",
  scoreFor: 24,
  scoreAgainst: 17,
  mvpName: "Somebody",
  ...extra,
});

// Newest first, the way the profile stores it.
const profile = {
  history: [
    game("nfl", true),
    game("nfl", true),
    game("nba", false),
    game("nfl", false),
    game("nba", true),
    game("nba", true),
    game("nba", true),
    // Two rows from before history knew what sport it was.
    game(null, true),
    game(null, true),
  ],
};

const nfl = historyFor(profile, "nfl");
const nba = historyFor(profile, "nba");

// A profile that has only ever played one sport must not report the other's
// games as its own - the case the bug actually presented as.
const footballOnly = { history: [game("nfl", true), game("nfl", true)] };

const checks = [
  {
    title: "Football games appear under football",
    ok: nfl.games.length === 3 && nfl.games.every((g) => g.sport === "nfl"),
    detail: `${nfl.games.length} of 3 football games`,
  },
  {
    title: "Football games never leak into basketball's history",
    ok: nba.games.length === 4 && nba.games.every((g) => g.sport === "nba"),
    detail: `${nba.games.length} of 4 basketball games, none football`,
  },
  {
    title: "A football-only profile shows no basketball games",
    ok: historyFor(footballOnly, "nba").games.length === 0,
    detail: `${historyFor(footballOnly, "nba").games.length} basketball games from a football-only profile`,
  },
  {
    title: "Unattributed rows are assigned to NO sport rather than guessed",
    ok: nfl.games.every((g) => g.sport) && nba.games.every((g) => g.sport),
    detail: "no unstamped row appears under either sport",
  },
  {
    title: "Unattributed rows are counted so the gap can be admitted",
    ok: nfl.unattributed === 2 && nba.unattributed === 2,
    detail: `${nfl.unattributed} reported under football, ${nba.unattributed} under basketball`,
  },
  {
    title: "Win streaks are per sport, not across both",
    // Football: won, won, lost -> longest 2, current 2.
    // Basketball: lost, won, won, won -> longest 3, current 0.
    ok:
      winStreaks(profile, "nfl").longest === 2 &&
      winStreaks(profile, "nfl").current === 2 &&
      winStreaks(profile, "nba").longest === 3 &&
      winStreaks(profile, "nba").current === 0,
    detail:
      `football longest ${winStreaks(profile, "nfl").longest}/current ${winStreaks(profile, "nfl").current}, ` +
      `basketball longest ${winStreaks(profile, "nba").longest}/current ${winStreaks(profile, "nba").current}`,
  },
  {
    title: "An unscoped streak still reads the whole list, for callers that want it",
    ok: winStreaks(profile).longest >= 3,
    detail: `${winStreaks(profile).longest} across every sport`,
  },
  {
    title: "Basketball keeps its signature record and football declares none",
    // A triple-double is basketball's. Rendering the row unconditionally gave
    // football a permanent dash for a thing it can never record.
    ok: !!NBA.signatureRecord && !NFL.signatureRecord,
    detail: `NBA "${NBA.signatureRecord?.label}", NFL ${NFL.signatureRecord ? "declares one" : "declares none"}`,
  },
  {
    title: "Football's tracked categories are football's",
    ok: (() => {
      const keys = Object.keys(NFL.statLabels || {});
      const football = ["pass_yds", "rush_yds", "rec_yds", "fgs", "ints"];
      const basketball = ["pts", "reb", "ast", "stl", "blk"];
      return football.every((k) => keys.includes(k)) && !basketball.some((k) => keys.includes(k));
    })(),
    detail: Object.keys(NFL.statLabels || {}).join(" "),
  },
  {
    title: "The history cap is still shared with the Edge Function",
    ok: HISTORY_LIMIT === 50,
    detail: `${HISTORY_LIMIT} entries`,
  },
];

console.log(renderSection("Per-sport profile history and top performances"));
const report = checks.map((c) => ({ title: c.title, status: c.ok ? PASS : FAIL, detail: c.detail }));
for (const c of report) console.log(renderCheck(c));
const { counts, ok } = summarize(report);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
