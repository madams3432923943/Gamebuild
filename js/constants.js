// Tunable constants for the simulation engine. Keeping these in one place
// makes balance passes (the kind of thing that produced the 1.55 ceiling
// and the 0.0035 compression coefficient) auditable without hunting through
// engine logic.

export const SLOTS = ["PG", "SG", "SF", "PF", "C", "6TH"];
export const STARTER_SLOTS = ["PG", "SG", "SF", "PF", "C"];

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

// Per-quarter random variance multiplier range. This is what makes each
// quarter an independent simulation instead of game-total / 4.
export const VARIANCE_MIN = 0.82;
export const VARIANCE_MAX = 1.18;

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
export const QUARTER_REVEAL_DELAY_MS = 2100;

// How long a fully-resolved draft round holds on the "locked in" state
// before both sides' picks flip-reveal simultaneously.
export const DRAFT_REVEAL_DELAY_MS = 700;

// How long a player has to make each pick before the game auto-picks the
// worst eligible option for them (or auto-skips if none are eligible).
export const PICK_TIMER_SECONDS = 30;

// Minimum characters typed before the draft search reveals any matches -
// with only 10 players per squad, revealing results after 1 character
// would let someone brute-force the roster letter by letter.
export const MIN_SEARCH_CHARS = 3;
