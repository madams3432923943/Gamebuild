// NFL draft grade. EMPTY - not built.
//
// Expected surface:
//   gradeDraft(roster, datasetStats, opts) -> { letter, score, headline,
//                                               reasons[], metrics, forfeits }
//   rotationHint(roster) -> string | null
//
// The property that makes basketball's grade worth trusting is that it is
// computed from the same metrics the engine is about to charge you for - if
// the grade says your bench is thin, the simulation then charges you for a
// thin bench. Football's must do the same or it is decoration.
//
// The categories change even though the idea doesn't: instead of scoring /
// rebounding / playmaking / defense, it is pass offense, run offense, pass
// defense, run defense, and the trenches. A roster with an elite quarterback
// and no offensive line should grade badly, and then lose the way the grade
// said it would.
