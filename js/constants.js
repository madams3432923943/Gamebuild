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

// How many of the best players on the board the bot is FORBIDDEN to take,
// counted per pick and by distinct player rather than by (player, slot) combo
// - see DraftState.botAutoPick.
//
// BOT_POOL_SIZE alone could not make the bot beatable. Whatever its width, the
// pool was always measured from the top of the board, so the bot walked away
// with an elite player every single round and a human could at best match it.
// Banning the top of the board instead changes what the bot is ALLOWED to
// know: the best fifteen players in front of it are yours to take if you know
// who they are, and its roster is built from the sixteenth onward.
//
// A SHARE OF THE BOARD, NOT A COUNT, and that is the correction. It was 15 -
// "deliberately large relative to a squad", on the reasoning that squads hold
// a median of 31 distinct players in basketball and 51 in football, so fifteen
// hands the human "the top third to half of the board".
//
// It does in basketball. It does not in football, and the same sentence
// contains the reason: a fixed fifteen is half of 31 and under a third of 51.
// Measured over 40 bot drafts per sport, counting the ban actually applied to
// each pick, basketball's bot was locked out of 48.5% of the players eligible
// to it and football's out of 25.3%. Football's bot was drafting from roughly
// twice as good a board, every round, for no reason anyone chose - the
// difficulty of the opponent depended on which tile you tapped.
//
// It was worse than the averages suggest at the sharp end. Football's MEDIAN
// pick has 15 eligible players; BOT_MIN_CHOICES then clamps the ban to 10,
// leaving exactly 5, and BOT_POOL_SIZE is 5 - so on a typical football pick
// the bot was choosing uniformly from the entire remaining board rather than
// from the best of it. The knob had run out of room without saying so.
//
// A share equalises the two by construction and needs no per-sport table,
// which matters more for the sport that does not exist yet than for either of
// these: sport three inherits a difficulty that means the same thing without
// anyone having to notice it should.
//
// 0.5 is basketball's measured share, so basketball is unchanged and football
// moves to meet it. BOT_MIN_CHOICES still floors it - see below - so a thin
// board narrows the ban rather than emptying it.
//
// IT DOES NOT FULLY EQUALISE THEM, and the residue is structural. Football
// drafts twelve position-locked slots, so a late pick with only the safety
// slot open can offer six eligible players and the floor below clamps the ban
// to one; 220 of 480 football picks come off a board too thin for the full
// share, against 40 of basketball's. Measured after this change, basketball's
// bot is locked out of 48.3% of its board and football's out of 29.1% - a real
// improvement on 25.3%, and not parity. Lowering the floor closes some of the
// rest and never all of it, and past a point leaves the bot no choice to make
// at all, which is a forced opponent rather than a harder one.
// scripts/verify-bot-difficulty.mjs asserts the floor every sport must clear
// and reports the spread rather than pretending it is gone.
export const BOT_TOP_PICK_BAN_SHARE = 0.5;

// The floor under that ban: however wide the share works out to, the bot always
// keeps at least this many distinct players to choose between.
//
// It has to exist because the ban is measured against ONE PICK'S eligible
// players, not the whole dataset. The thinnest basketball squad has 12
// distinct players in it, and a late pick with a single position-locked slot
// still open can be down to a handful of legal names - ban half of them there and
// the bot has nothing legal left, which is a forfeited slot and a broken
// roster rather than an easier opponent. So a thin board narrows the ban
// instead of emptying it, the same way a thin board already narrows the pool.
export const BOT_MIN_CHOICES = 5;

// How long the live scoreboard lingers on each quarter before advancing,
// so a game reads as "played out" rather than dumped on screen at once.
// Time a finished period holds on screen before the next tips off. Generous
// on purpose: the score also counts up over QUARTER_TICK_MS inside this
// window, so the gap is filled with motion rather than dead air.
export const QUARTER_REVEAL_DELAY_MS = 4200;

// How long the running score takes to climb to the new period's total.
export const QUARTER_TICK_MS = 1500;

/** Overtime plays back slower. A regulation quarter is one of four and the
 * viewer knows roughly where the game stands; overtime is the whole result
 * arriving in one period, often decided by a single score, and running it at
 * regulation pace throws away the moment people actually came for. The tick
 * is stretched too, so the score counts up rather than snapping. */
export const OT_REVEAL_DELAY_MS = 6800;
export const OT_TICK_MS = 2600;

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

// How long a player who has committed their gameplan keeps checking whether
// the opponent has committed theirs before saying so out loud. Five minutes:
// long enough to cover somebody reading every gamestyle card, short enough
// that a player whose opponent has quietly closed their tab is told rather
// than left watching a banner that never changes.
export const SIMULATION_WAIT_MS = 300000;

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
