// NFL post-game narrative. EMPTY - not built.
//
// Expected surface, matching what js/main.js asks the active sport for:
//   buildRecap(result, rosterA, rosterB, labelA, labelB, statsA, statsB)
//   buildGameScript(periods, labelA, labelB)
//   buildWhyBreakdown(result, ctx)
//
// The standard to meet is set by js/sports/nba/recap.js, and it is a content
// standard rather than a code one: every line is checked against the finished
// box score before it is printed. A gamestyle only gets credit for the column
// it promised to move. Nothing is asserted that the data cannot support -
// basketball deliberately has no "foul trouble" line because the dataset has
// no fouls, and football will hit its own version of that.
//
// Football's advantage here is that a drive is already a narrative unit
// ("80 yards in twelve plays to go ahead"), so the recap has more to work with
// than a basketball quarter gives it.
