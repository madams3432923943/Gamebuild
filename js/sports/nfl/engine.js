// NFL simulation. EMPTY - not built.
//
// The contract it must satisfy, read off what js/sports/nba/index.js declares
// and what js/main.js actually calls:
//
//   computeDatasetStats(players)          -> whatever the sim needs precomputed
//   simulate(rosterA, rosterB, stats, opts)
//        opts: { tacticA, tacticB, minutesA, minutesB, matchupsA, matchupsB,
//                forfeitsA, forfeitsB }   - football will want its own set;
//                what matters is that forfeited picks still cost something,
//                since that is a rule about the GAME, not about basketball
//        returns: { teamScoreA, teamScoreB, boxA, boxB, quarterBoxScores,
//                   overtimePeriods, winner, analysis }
//   draftAnalysis(roster, oppRoster, stats, forfeits)
//
// The shape of the return value is load-bearing: js/main.js's playOutResult()
// animates quarterBoxScores period by period and renders boxA/boxB as a table,
// so a football engine has to produce something that fits that mould even
// though a drive is not a quarter. Deciding how (drives grouped into quarters
// is the obvious answer) is part of building this.
//
// Why the basketball engine cannot be reused, in one line: it models five
// defenders guarding five attackers over 48 shared minutes. Football is
// unit-on-unit over ~22 drives, scoring in 7s and 3s. See docs/nfl-plan.md.
