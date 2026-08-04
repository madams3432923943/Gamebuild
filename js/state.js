// The state every screen shares, in one place so screens don't have to import
// each other to reach it.
//
// It lives here rather than in main.js because of how ES modules bind: a
// module-level `let` cannot be reassigned by an importer, so any state two
// screens both WRITE has to hang off an object. Making that explicit is worth
// more than it costs - the alternative is a set of setter functions that exist
// only to work around the binding rule, which reads like architecture and is
// really just plumbing.
//
// Nothing here imports anything, so it can never be part of an import cycle.

/** The match in progress: which mode, who is playing, the draft, and the round
 * loop's own bookkeeping. Reset by whichever screen starts a game. */
export const game = {
  mode: "bot",
  nameA: "Player 1",
  nameB: "Bot",
  draft: null,
  round: { needNewSquad: true, resolved: {}, activeSide: "A", pendingPlayer: null, pendingSlots: {} },
  roundNumber: 0,
  ruleset: "easy",
  online: null,
  // Slots the pick CLOCK filled rather than the player, per side. The
  // simulation charges a real cost for these (see FORFEIT_PLAYER_SCALE in
  // constants.js), so a draft nobody turned up for can't beat one somebody
  // actually made - which is exactly what it was doing before.
  forfeits: { A: [], B: [] },
};

/** What the player chose after the draft. Written by the three strategy
 * phases, read by whichever simulation path runs - offline directly, online
 * via submit_strategy - and by the post-game analysis, which explains what
 * these choices actually did. */
export const strategy = {
  tactic: null,
  offeredTactics: [],
  rotationMinutes: null,
  matchups: null,
};

export function resetStrategy() {
  strategy.rotationMinutes = null;
  strategy.matchups = null;
}
