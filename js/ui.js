// The shared UI, as a barrel.
//
// This file was 3,182 lines: the draft board, the box score, the scoreboard,
// the profile screen, the cosmetics grids, the strategy pickers and the squad
// screens, all in one place. Nothing in it was wrong. The problem was finding
// anything, and every screen this game has went through here.
//
// It is now an index. Each module below holds exactly the code that used to sit
// here, and everything is re-exported, so every caller's
// `import { ... } from "./ui.js"` still resolves and no call site changed. The
// export surface was checked by importing both versions and diffing the key
// lists: 49 names before, 49 after, identical.
//
// WHY THESE SEVEN AND NOT SOME OTHER SEVEN. The four screen modules are grouped
// by the MOMENT a player sees them - drafting, playing, choosing a gameplan,
// being themselves - because that is what a change to any of them is usually
// about. The three small ones are shared primitives, and each earned its own
// module by being needed in two or more of the screen modules: leaving a helper
// beside one of its callers is precisely what makes a file impossible to split
// later, which is how this one got to 3,182 lines.
//
//   ui/draft-board.js   the pool, the roster panel, the pick clock
//   ui/game.js          scoreboard, box score, play feed, man of the match
//   ui/profile.js       rank, banners, icons, badges, records, history
//   ui/squads.js        squad and friends screens
//   ui/strategy.js      rotation, matchups, gameplans
//   ui/banner-art.js    franchise banner artwork (profile AND squads)
//   ui/entry-name.js    what to call a drafted player or unit
//   ui/roster-slots.js  what a slot is called, and which are filled
//   ui/note.js          the "nothing here" line
//   ui/format.js        roundStat
//
// Anything genuinely shared belongs in one of the last four, not here. This
// file should stay an index.

export * from "./ui/draft-board.js";
export * from "./ui/game.js";
export * from "./ui/profile.js";
export * from "./ui/squads.js";
export * from "./ui/strategy.js";
export * from "./ui/banner-art.js";

// THE PRIMITIVE MODULES ARE DELIBERATELY NOT RE-EXPORTED. slotLabel,
// rosterSlots, displayEntryName, renderNote and roundStat were private to this
// file before the split, and `export *` on their modules would quietly add
// eight names to what the rest of the app can reach for. A refactor that says
// it changed nothing has to actually change nothing: 49 exports before, 49
// after. Anything that needs one of them imports it from its own module, which
// is also the honest way to see who depends on what.

// Re-exported because this file always did, and a dozen screens import it from
// here rather than from js/lib.
export { escapeHtml } from "./lib/escape-html.js";
