// NFL simulation tunables. EMPTY - nothing is decided yet.
//
// This is football's counterpart to js/sports/nba/constants.js, and the same
// rule governs it: a value belongs here if a second sport would want a
// different number for it. Anything every sport shares (pick clocks, queue
// timeouts, the search minimum) stays in js/constants.js.
//
// What will end up here, once the engine exists:
//   - the roster slot lists and their helpers
//   - era brackets (football's follow rule changes, not decades - see
//     docs/nfl-plan.md and the note in db/migrations/20260731_04_nfl_players.sql)
//   - drive-model tunables: drives per game, field-position effects, the
//     outcome distribution's shape
//   - the balance levers, whatever they turn out to be. Basketball's are
//     SOLVED by tools/calibrate-*.mjs rather than picked, and football's must
//     be too - see the note at the top of js/sports/nba/tactics.js for why.
//
// Deliberately not pre-filled with the roster shape and era brackets from
// docs/nfl-plan.md: those are proposals until something runs on them, and a
// constant that looks authored is harder to argue with than a plan that
// admits it is one.
