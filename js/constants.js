// App-wide constants: timings, limits and thresholds that belong to the GAME
// SHELL rather than to any one sport.
//
// The simulation constants that used to sit alongside these are basketball's,
// and now live in js/sports/nba/constants.js. The test for which file a value
// belongs in is simple: if a second sport would want a different number for
// it, it is the sport's; if every sport wants the same one, it is here.
//
// This file imports nothing, so it can never be part of an import cycle.

// How many of the best available (player, slot) combos the bot draws from,
// with equal odds on each - see DraftState.botAutoPick. Five gives every one
// of its top five a 20% shot: good enough that the bot never fields a
// nonsense roster, loose enough that it regularly passes on the best player
// on the board and can be out-drafted. Widen this to make the bot easier,
// narrow it to make it sharper (1 = always optimal).
export const BOT_POOL_SIZE = 5;

// How long the live scoreboard lingers on each quarter before advancing,
// so a game reads as "played out" rather than dumped on screen at once.
// Time a finished period holds on screen before the next tips off. Generous
// on purpose: the score also counts up over QUARTER_TICK_MS inside this
// window, so the gap is filled with motion rather than dead air.
export const QUARTER_REVEAL_DELAY_MS = 4200;

// How long the running score takes to climb to the new period's total.
export const QUARTER_TICK_MS = 1500;

// How long a resolved round's picks stay on screen before the next squad is
// rolled and the board is rebuilt.
//
// This was 700ms, which was shorter than the reveal it was meant to be showing:
// .slot-reveal runs a 1s flip and a 2.4s highlight glow (style.css), so the
// next round wiped the opponent's name off the board while it was still
// mid-flip. On a phone, where both roster panels are below the search box and
// you have to look down to them, the pick was effectively never legible - the
// one moment in the round where you find out what you're up against.
//
// Set past the end of the glow so the reveal finishes, and so there is a beat
// to actually read the name and think about it before the next squad lands.
export const DRAFT_REVEAL_DELAY_MS = 2600;

// How long a player has to make each pick before the game auto-picks the
// worst eligible option for them (or auto-skips if none are eligible).
export const PICK_TIMER_SECONDS = 30;

// How long a player has to commit to a game plan once both rosters are set.
// Longer than a pick timer on purpose: this is one decision made with full
// information about the team you just built, so it deserves a real beat.
export const TACTIC_TIMER_SECONDS = 45;

// How long a player has to set their rotation (minutes per player) in Ranked
// Practice, before the gamestyle pick. Offline value; Online Ranked uses its
// own longer duration (2 minutes) since it also has to wait on an opponent.
export const ROTATION_TIMER_SECONDS = 60;
export const ONLINE_ROTATION_TIMER_SECONDS = 120;

// How long to set defensive matchups. Shorter than the rotation: it's five
// dropdowns against a roster already on screen, not a budget to balance.
export const MATCHUP_TIMER_SECONDS = 45;

// How long a client waits for the server-written match result before telling
// the player it couldn't load. Generous on purpose: a cold-started Edge
// Function boots an isolate, pulls the whole player table and then simulates,
// and reporting a failure for a game that is merely slow is worse than
// waiting - the result is already safe on the server either way.
export const RESULT_WAIT_MS = 25000;

// How long a player waits in the online queue before the search gives up.
//
// An empty lobby is the ordinary case at this player count, and a spinner
// that never stops is indistinguishable from a broken game - "couldn't get
// an online game" is what that looks like from the outside. Ending the
// search says the true thing (nobody is here right now) and hands the
// player back a working screen instead of a dead one.
//
// The queue row is released on the way out, which matters as much as the
// timeout itself: a row left behind would later pair a real player against
// someone who walked away minutes ago, which is worse than not matching.
export const ONLINE_QUEUE_TIMEOUT_SECONDS = 120;

// How often the search re-asks the server for an opponent while waiting.
export const ONLINE_QUEUE_POLL_MS = 2000;

// Minimum characters typed before the draft search reveals any matches -
// with only 10 players per squad, revealing results after 1 character
// would let someone brute-force the roster letter by letter.
export const MIN_SEARCH_CHARS = 3;
