// Aggregating players into position-group units. EMPTY - not built.
//
// Football drafts differently from basketball: defensive position groups go as
// UNITS (a team's linebackers, its secondary, its defensive line) while
// offensive skill positions go individually. This file is what turns rows of
// individual players into the unit entries a draft board offers.
//
// Two constraints worth writing down before anyone starts:
//
//   Units are DERIVED, never hand-authored - the same rule that makes
//   data/nba-players.js generated. A unit's rating is a function of the
//   players in it, so that fixing a player's stats fixes the unit for free.
//
//   Aggregation has to be snap-weighted (or games-weighted), or a backup's
//   rate stats distort the unit he barely played for. nfl_players does not
//   carry a snaps column yet; adding one is part of the import work.
