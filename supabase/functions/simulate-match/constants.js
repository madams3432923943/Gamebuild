// Tunable constants for the simulation engine. Keeping these in one place
// makes balance passes (the kind of thing that produced the 1.55 ceiling
// and the 0.0035 compression coefficient) auditable without hunting through
// engine logic.

// Every sport the game advertises, whether playable yet or not - the one
// place a sport gets registered, so the home screen tiles, badge/banner
// subtabs, and online play's sport scoping all agree on the same list
// instead of drifting copies. Each live sport is expected to bring its own
// engine and player dataset (see js/engine.js's header comment) rather than
// share NBA's - `live` here just gates whether that engine/dataset/draft
// flow actually exists yet.
export const SPORTS = [
  { id: "nba", name: "NBA", icon: "🏀", live: true },
  { id: "nfl", name: "NFL", icon: "🏈", live: false },
  { id: "nhl", name: "NHL", icon: "🏒", live: false },
  { id: "soccer", name: "Soccer", icon: "⚽", live: false },
];

// Online matchmaking/challenges need a sport to scope to. Hardcoded rather
// than read from a selector because there isn't one yet - NBA is the only
// sport with a real online draft flow. Swap this for real sport selection
// once a second sport goes live.
export const DEFAULT_SPORT = "nba";

export const SLOTS = ["PG", "SG", "SF", "PF", "C", "6TH"];
export const STARTER_SLOTS = ["PG", "SG", "SF", "PF", "C"];

// Ranked rosters: five position-locked starters plus five open bench spots.
//
// The bench is deliberately NOT position-locked. Real benches aren't - you
// draft the best available and work out the rotation afterward - and leaving
// them open is what turns depth into a genuine draft decision instead of a
// checklist. A bench player is assigned to whichever position he can play
// that most needs the help (see assignBenchToPositions in engine.js), so
// somebody listed at two positions is worth more than somebody locked to one.
export const STARTER_ROSTER_SLOTS = ["PG", "SG", "SF", "PF", "C"];
export const BENCH_SLOTS = ["BENCH1", "BENCH2", "BENCH3", "BENCH4", "BENCH5"];
export const RANKED_SLOTS = [...STARTER_ROSTER_SLOTS, ...BENCH_SLOTS];

export function isBenchSlot(slot) {
  return slot.startsWith("BENCH");
}

/** Canonical lineup order for a roster's slots: starters by position, then
 * the bench, then the legacy 6th man. Every mode's roster is a different
 * shape, and a roster object's own key order is DRAFT order - so without
 * this, box scores and roster panels would print as SF, BENCH3, PG...
 *
 * Shared from here because the engine, the box score, and the recap all have
 * to agree on it; three private copies would drift the moment a slot type is
 * added. */
export function orderSlots(slots) {
  return [...slots].sort((a, b) => {
    const rank = (s) => (s === "6TH" ? 2 : isBenchSlot(s) ? 1 : 0);
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    if (rank(a) === 0) {
      const posDiff = STARTER_SLOTS.indexOf(basePosition(a)) - STARTER_SLOTS.indexOf(basePosition(b));
      if (posDiff !== 0) return posDiff;
    }
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

/** Canonical-ordered slots a roster actually filled. */
export function orderedRosterSlots(roster) {
  return orderSlots(Object.keys(roster).filter((slot) => roster[slot]));
}

// Minutes available at each position across a full game (5 on the floor for
// 48 minutes = 240 total, split per position).
export const POSITION_MINUTES = 48;

// A team's whole minutes budget for a game: five players on the floor for
// 48 minutes. Minutes are allocated per PLAYER against this single pool
// rather than per position, so a rotation is one set of trade-offs across
// the whole roster instead of five separate little ones.
export const ROTATION_BUDGET = 240;

// Nobody rides the bench all night and nobody plays the whole game.
export const MIN_PLAYER_MINUTES = 10;
export const MAX_PLAYER_MINUTES = 40;

// Starters have to outplay the bench. Enforced by splitting the range rather
// than by clamping sliders against each other: with disjoint ranges every
// legal combination satisfies the rule automatically, so the sliders never
// fight you mid-drag or silently rewrite a value you just set.
//
// The split still leaves 240 comfortably reachable - the achievable total
// spans 5x25+5x10 = 175 up to 5x40+5x24 = 320.
export const STARTER_MIN_MINUTES = 25;
export const STARTER_MAX_MINUTES = MAX_PLAYER_MINUTES;
export const BENCH_MIN_MINUTES = MIN_PLAYER_MINUTES;
export const BENCH_MAX_MINUTES = 24;

// Opening allocation: 5x32 + 5x16 = exactly 240, so the rotation screen is
// valid the moment it appears rather than asking you to make it valid.
export const DEFAULT_STARTER_MINUTES = 32;
export const DEFAULT_BENCH_MINUTES = 16;

/** The legal minutes range for a slot, which is what makes "starters play
 * more than the bench" structural rather than policed. */
export function minutesRangeFor(slot) {
  return isBenchSlot(slot) || slot === "6TH"
    ? { min: BENCH_MIN_MINUTES, max: BENCH_MAX_MINUTES }
    : { min: STARTER_MIN_MINUTES, max: STARTER_MAX_MINUTES };
}

// Above this many minutes a player tires and gives back production.
//
// Set below the 40-minute cap on purpose. Sitting it AT the cap would make it
// unreachable and the penalty dead code - which is what happened when the cap
// came in, since it had been tuned for a model where an uncovered position ran
// its starter the full 48. Below the cap it does real work again: pushing a
// star to 40 costs something, so loading up your best five is a trade rather
// than a free win.
export const FATIGUE_MINUTES = 34;
// Production lost per minute beyond the threshold, capped so fatigue is a
// real cost without erasing a star.
export const FATIGUE_PER_MINUTE = 0.012;
export const FATIGUE_MAX_PENALTY = 0.18;

/** The position a slot belongs to, with any depth-chart digit stripped.
 * Bench slots have no fixed position - the engine assigns them one from the
 * player's own pos[] - so they return null and callers must handle that.
 * Lives here rather than in draft.js because the engine needs it too, and
 * draft.js already imports from engine.js - putting it in either would make
 * that a cycle. constants.js imports nothing, so it can't. */
export function basePosition(slot) {
  if (isBenchSlot(slot)) return null;
  return slot.replace(/\d+$/, "");
}

// Era brackets. Every mode can be played over the whole history or narrowed
// to one stretch of it, which turns the same draft into a different knowledge
// test: knowing the 2010s well is a different skill from knowing the 1970s.
//
// Each bracket is its own ranked ladder - a rank earned in Modern Ball says
// nothing about whether you can name the 1978 Sonics - so `id` is the key
// records are stored under and must stay stable even if a label changes.
//
// Decade coverage is uneven by nature (there were fewer teams in 1965 and
// their rosters are less documented), so the brackets are sized by what the
// data can actually support rather than by equal spans of time.
export const ERAS = [
  {
    id: "all",
    label: "All Years",
    emoji: "🏀",
    decades: null, // null = no filter
    blurb: "Every squad from the 1960s to today. The full test.",
  },
  {
    id: "grandpas",
    label: "Grandpa's Game",
    emoji: "📻",
    decades: ["1960s", "1970s", "1980s"],
    blurb: "1960s-1980s. Territorial centres, short shorts, no three-point line worth speaking of.",
  },
  {
    id: "unc",
    label: "Unc Status",
    emoji: "📼",
    decades: ["1990s", "2000s"],
    blurb: "1990s-2000s. Hand-checking, hard fouls, and the last great centre era.",
  },
  {
    id: "modern",
    label: "Modern Ball",
    emoji: "📱",
    decades: ["2010s", "2020s"],
    blurb: "2010s-today. Pace, space, and switching everything.",
  },
];

export const DEFAULT_ERA = "all";

export function eraById(id) {
  return ERAS.find((e) => e.id === id) || ERAS[0];
}

/** The players an era bracket draws from. Returns the same array for "all"
 * rather than a copy, since nothing downstream mutates it. */
export function playersInEra(players, eraId) {
  const era = eraById(eraId);
  if (!era.decades) return players;
  const wanted = new Set(era.decades);
  return players.filter((p) => wanted.has(p.decade));
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

// How sharply a defender's rating is damped before it reaches the scoring
// matchup. Applied as rating ** DEFENDER_RATING_EXPONENT.
//
// Blocks are rare and heavily skewed, so a rim protector rates five or six
// times the positional average. That was harmless while a defender was an
// average of everyone at a position, but once he can be ASSIGNED to a
// specific opponent the extreme becomes reachable on purpose: undamped,
// moving one elite defender onto a star took 12.5 points off the opposing
// team, which would make the matchup screen matter more than the draft.
//
// A flat ceiling can't fix it - ordinary defenders already rate above any
// ceiling low enough to bind, so capping erases the difference between a
// good defender and a great one instead of narrowing it. An exponent damps
// the extremes while preserving order everywhere, which is the same
// diminishing-returns treatment decadeWeight() uses on squad counts.
export const DEFENDER_RATING_EXPONENT = 0.7;
export const FACTOR_MAX = 1.6;

// How strongly a player's real shooting efficiency (true shooting % vs the
// position average, from fga/fgp/tpa/tpp/fta/ftp) scales their scoring
// beyond raw ppg. Same shape as the matchup factors above - a rating-vs-1
// comparison run through matchupFactor and clamped the same way - but with
// no opposing side to compare against, since defense already suppresses
// scoring through blocks/steals in SCORING_K; this is a player's own
// finishing quality on top of that. Neutral (1, no effect) for anyone
// without a shooting profile - every 1960s/70s placeholder - so legacy data
// behaves exactly as it did before this existed.
export const EFFICIENCY_K = 0.5;

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
// Re-solved after the squad pool grew to 154 team-decades: every matchup is
// normalised against positional averages drawn from the pool, so more than
// doubling it moves the baseline every game is measured against - and the
// flat 240-minute rotation changed how those minutes are spread on top of
// that.
//
// Re-solved again after real per-game stats replaced the 1980s-2020s
// placeholder data and scoringEfficiencyFactor (engine.js) started letting
// real shooting efficiency affect scoring: real numbers plus an efficiency
// factor genuinely differentiate rosters more than the old model-recalled
// data did on its own, so parity needed to come down to hold the same win
// rate. Verified over 2,000 games with a clear talent gap:
//   stronger roster wins the game    75.6%  (target 75%)
//   stronger roster wins a quarter   65.9%
//   stronger roster sweeps every qtr 24.9%  (target ~27%)
//   mean quarter margin               6.6   (target ~7)
//
// The margin is the honest cost of the win-rate target: winning three games
// in four requires a real talent edge, and a real edge shows up on the
// scoreboard. Tuning parity down trades win rate for a closer scoreline; the
// knob is here if that trade is ever worth revisiting.
export const TALENT_PARITY = 0.84;

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
// while a knowledgeable drafter still wins ~90% of the time - too generous
// to a knowledgeable player, which is what "the bot loses every time" was
// actually describing. Bumped to 0.6 to cut into that without turning the
// draft into a solved game the bot can't lose - paired with botMinutes()
// (engine.js) so the bot also stops wasting its better draft with a flat,
// unweighted rotation.
export const BOT_SKILL = 0.6;

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

// How long to set defensive matchups. Shorter than the rotation: it's five
// dropdowns against a roster already on screen, not a budget to balance.
export const MATCHUP_TIMER_SECONDS = 45;

// The real-basketball baseline a rotation's minutes are measured against: 5
// players on court at all times over a 48-minute game.
export const ROTATION_MINUTES_BUDGET = 240;

// Minimum characters typed before the draft search reveals any matches -
// with only 10 players per squad, revealing results after 1 character
// would let someone brute-force the roster letter by letter.
export const MIN_SEARCH_CHARS = 3;
