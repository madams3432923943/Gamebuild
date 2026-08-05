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
//                   overtimePeriods, winner, analysis, drives }
//   draftAnalysis(roster, oppRoster, stats, forfeits)
//
// Why the basketball engine cannot be reused, in one line: it models five
// defenders guarding five attackers over 48 shared minutes. Football is
// unit-on-unit over ~22 drives, scoring in 7s and 3s. See docs/nfl-plan.md.
//
// ---------------------------------------------------------------------------
// THE PART THAT SHAPES EVERYTHING: `drives`
// ---------------------------------------------------------------------------
//
// The game is watched, not read. Basketball's presentation works because a
// quarter box score IS the drama - points accumulate smoothly and a table
// filling in tells the story. Football's drama is field position swinging and
// somebody's NAME on the score. A quarter box score throws away both: it can
// say a team scored 14, but not that the drive stalled at the 40, or that it
// was your third receiver who broke it open.
//
// So `drives` is a first-class return value, not a debug log, and the engine
// has to be built to produce it rather than have it reconstructed afterward.
// Reconstruction is impossible anyway - once you have only "14 points in Q2"
// the scorer is gone.
//
//   drives: [{
//     team: "A" | "B",
//     quarter: 1..4 (or 5+ for overtime),
//     startYard: number,      // from the drive team's own goal line
//     endYard: number,        // where it finished - the arrow's destination
//     outcome: "touchdown" | "fieldGoal" | "punt" | "turnover" | "downs",
//     points: number,
//     scorer: string | null,  // "Zay Flowers", "Adam Vinatieri" - null if no score
//     scorerSlot: string | null,   // "WR3", "ST" - lets the UI show the pick
//     credit: string | null,  // the defensive UNIT that ended it, for stops:
//                             // "S" when the secondary picked it off
//     text: string,           // ready-to-show: "Zay Flowers 24 yd TD reception"
//   }]
//
// ATTRIBUTION IS A MODELLING JOB, NOT A COSMETIC ONE
//
// "Zay Flowers touchdown" requires the engine to decide WHICH receiver scored,
// and that decision has to be honest or the popup becomes a lie the box score
// then repeats. Weight each pass-catcher by his real share of the roster's
// rec_td, each rusher by rush_td share, and let the quarterback take rushing
// scores at his own rate. A drafted 2013 Josh Gordon should show up in the
// highlights about as often as he really did, because his share of the team's
// touchdowns is what put him there.
//
// The same rule makes the ST pick visible: a field goal is attributed to the
// kicker by name, and whether it goes through comes off HIS fg_pct at that
// distance. That is the whole reason ST is a draft slot rather than a constant.
//
// Defensive credit matters just as much and is easier to forget. A drive that
// ends in an interception should name the unit that caused it - the drafter
// picked the 2013 Seahawks secondary specifically so it would take the ball
// away, and a sim that says only "turnover" hides the payoff for the pick.
//
// FIELD POSITION HAS TO BE CONTINUOUS
//
// startYard/endYard exist so the UI can animate the ball up and down the field
// rather than cutting between scores. That means a punt is not "nothing
// happened" - it moves the opponent's next startYard, and a drive that reaches
// the 45 and stalls has to hand over better position than one that went three
// and out. Field position compounding across drives is most of what makes a
// football game feel like it has momentum, and dropping it would leave the
// arrow teleporting between scoring plays.
//
// quarterBoxScores stays in the return for the existing screens, but it is a
// SUMMARY OF `drives`, derived from it, never tracked in parallel. Two writers
// for one truth is how a scoreboard and a play-by-play end up disagreeing.
