// Tunable constants for the simulation engine. Keeping these in one place
// makes balance passes (the kind of thing that produced the 1.55 ceiling
// and the 0.0035 compression coefficient) auditable without hunting through
// engine logic.

export const SLOTS = ["PG", "SG", "SF", "PF", "C", "6TH"];
export const STARTER_SLOTS = ["PG", "SG", "SF", "PF", "C"];

// Ranked rosters carry two players at every position, who split that
// position's 48 minutes between them on the rotation screen. Neither is a
// "starter" mechanically - that's what makes allocating minutes a real
// decision rather than a formality. The trailing digit is stripped by
// basePosition() in draft.js before any eligibility check, since a player's
// recorded pos[] only ever holds bare codes ("PG", "SG", ...).
export const RANKED_SLOTS = [
  "PG1", "PG2",
  "SG1", "SG2",
  "SF1", "SF2",
  "PF1", "PF2",
  "C1", "C2",
];

// Minutes available at each position across a full game (5 on the floor for
// 48 minutes = 240 total, split per position).
export const POSITION_MINUTES = 48;

// Default split of a position's 48 minutes when the player hasn't set a
// rotation. These must sum to POSITION_MINUTES: the engine falls back to
// them whenever no minutes map is supplied (calibration scripts, online
// play), and without them a 10-man roster would default every slot to full
// starter minutes - ten full-time players, roughly double a real team's
// output.
export const RANKED_STARTER_MINUTES = 28;
export const RANKED_BACKUP_MINUTES = POSITION_MINUTES - RANKED_STARTER_MINUTES;

/** The position a slot belongs to, with any depth-chart digit stripped:
 * "PG1" and "PG2" are both point guard spots, and plain "PG" is itself.
 * Lives here rather than in draft.js because the engine needs it too, and
 * draft.js already imports from engine.js - putting it in either would make
 * that a cycle. constants.js imports nothing, so it can't. */
export function basePosition(slot) {
  return slot.replace(/\d+$/, "");
}

export const QUARTERS_PER_GAME = 4;

// Minutes model: starters assumed at a 36-minute-per-game historical
// baseline (their recorded per-game stats are treated as already reflecting
// that). The 6th man is fixed at reduced minutes this round (not user
// adjustable - see build spec #7).
export const STARTER_MINUTES = 36;
export const SIXTH_MAN_MINUTES = 20;
export const SIXTH_MAN_SCALE = SIXTH_MAN_MINUTES / STARTER_MINUTES;

// Matchup-factor sensitivity per stat category. Higher = defense/offense
// mismatches swing results harder. Factors are clamped to keep any single
// matchup from dominating a game on its own.
export const SCORING_K = 0.5;
export const REBOUND_K = 0.4;
export const ASSIST_K = 0.3;
export const TURNOVER_K = 0.35;
export const FACTOR_MIN = 0.55;
export const FACTOR_MAX = 1.6;

// Per-quarter random variance multiplier range, rolled independently for
// every player and stat. This is what makes each quarter an independent
// simulation instead of game-total / 4.
export const VARIANCE_MIN = 0.82;
export const VARIANCE_MAX = 1.18;

// A SECOND variance term, rolled once per team per quarter and shared by
// every player on that team - the "this team ran hot/cold" factor.
//
// This exists because the per-player range above cannot make quarters
// competitive no matter how wide it gets: independent rolls across a roster
// average out, shrinking team-level swing by roughly the square root of the
// roster size. Measured before this was added, the stronger roster won 93.5%
// of quarters and swept every quarter in 88.8% of games. Correlated noise
// does not average out, so this is the lever that actually moves quarters.
// Range solved by simulation - see tools/calibrate-variance.mjs. Applied
// AFTER talent parity below, which is what makes it bite: rolled before
// compression, the gap and the noise shrink together and quarters never
// change hands.
export const TEAM_QUARTER_VARIANCE_MIN = 0.74;
export const TEAM_QUARTER_VARIANCE_MAX = 1.26;

// How much of a roster's talent advantage actually reaches the scoreboard.
//
// Without this, points scale nearly linearly with roster quality, so a good
// draft carried a systematic ~10-point-per-quarter edge - and the only way to
// make quarters competitive was noise so violent that mean quarter margins
// rose to 15.8 (real NBA ≈ 6-7). That produced upsets by making games
// chaotic, not close.
//
// Real teams take roughly the same number of possessions; quality shows up in
// efficiency, where the best-to-worst spread is only about 10-12%. So each
// team's quarter is pulled toward what a league-average roster would score in
// the same minutes, which shrinks the systematic gap while leaving the random
// component at full size. Upsets then come from a genuinely close game rather
// than from a scoring collapse. 1 = today's raw talent gap, 0 = pure coin
// flip. Solved by simulation alongside the variance range.
//
// Measured over 4,000 games with a clear talent gap, before -> after:
//   stronger roster wins the game    90.9% -> 80.0%   (target 80%)
//   stronger roster sweeps every qtr 88.8% -> 51.8%
//   mean quarter margin               10.5 ->  8.6    (real NBA ≈ 6-7)
export const TALENT_PARITY = 0.72;

// Turnover margin -> point swing. Each net extra possession (opponent
// turnover margin in our favor) is worth roughly one NBA possession's
// expected points, scaled down since this acts on top of already-simulated
// scoring rather than replacing it.
export const POSSESSION_VALUE = 1.15;
export const TOV_SWING_K = 0.02;

// Usage compression: stacked "dream" rosters with unrealistically high
// combined PPG get scoring pulled down to represent shared touches/shots.
// Keyed off combined RAW drafted PPG by default (validated numerically at
// build time) rather than off impact() - see engine.js comment for why
// this is flagged as a decision point rather than a silent choice.
export const COMPRESSION_KEY = "rawPpg"; // "rawPpg" | "impact"
export const COMPRESSION_COEFFICIENT = 0.0035;
export const COMPRESSION_FLOOR = 0.75;

// Combined team-factor x matchup-factor scoring ceiling. This is the fix
// for the 195-point blowout bug - a hard multiplier ceiling relative to a
// team's own unmodified per-game-average baseline.
export const SCORING_CEILING = 1.55;

// Absolute safety clamp applied after everything else (including any
// overtime periods), so no single game can produce an unrealistic score
// no matter how factors compound.
export const MAX_TEAM_SCORE = 190;
export const MAX_OT_PERIODS = 4;
// Overtime periods are shorter than a full quarter (5 real minutes vs 12).
export const OT_LENGTH_SCALE = 5 / 12;

// Bot draft skill: chance the bot takes the objectively best (player, slot)
// combo available each round rather than a random legal one. Kept well
// under 1 so the bot drafts unevenly like a real (beatable) opponent
// instead of playing a solved game. Calibrated via simulation: at 0.45 an
// average/random drafter's win rate drops to ~14% (from ~21% at 0.35)
// while a knowledgeable drafter still wins ~90% of the time - harder to
// beat carelessly, but the skill test stays intact.
export const BOT_SKILL = 0.45;

// How long the live scoreboard lingers on each quarter before advancing,
// so a game reads as "played out" rather than dumped on screen at once.
// Time a finished period holds on screen before the next tips off. Generous
// on purpose: the score also counts up over QUARTER_TICK_MS inside this
// window, so the gap is filled with motion rather than dead air.
export const QUARTER_REVEAL_DELAY_MS = 4200;

// How long the running score takes to climb to the new period's total.
export const QUARTER_TICK_MS = 1500;

// How long a fully-resolved draft round holds on the "locked in" state
// before both sides' picks flip-reveal simultaneously.
export const DRAFT_REVEAL_DELAY_MS = 700;

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

// The real-basketball baseline a rotation's minutes are measured against: 5
// players on court at all times over a 48-minute game.
export const ROTATION_MINUTES_BUDGET = 240;

// Minimum characters typed before the draft search reveals any matches -
// with only 10 players per squad, revealing results after 1 character
// would let someone brute-force the roster letter by letter.
export const MIN_SEARCH_CHARS = 3;
