// Tunable constants for the NBA simulation engine. Keeping these in one place
// makes balance passes (the kind of thing that produced the 1.55 ceiling
// and the 0.0035 compression coefficient) auditable without hunting through
// engine logic.
//
// This file is BASKETBALL. It used to live at js/constants.js mixed in with
// the app's UI timers, which meant every screen that wanted a pick-clock
// duration also imported the talent-parity coefficient, and a second sport
// had nowhere to put its own version of any of it. The app-wide half stayed
// behind; everything here moved.

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
export const TEAM_QUARTER_VARIANCE_MIN = 0.66;
export const TEAM_QUARTER_VARIANCE_MAX = 1.34;

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
export const TALENT_PARITY = 0.371;

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

// ---- What the draft itself is worth ---------------------------------------
//
// Everything above this point models TALENT: who you drafted, how many
// minutes they play, who guards whom. None of it models whether the roster
// was *built* well, and that gap is what let a player who forfeited two
// picks to the clock beat someone who made all ten. The three levers below
// close it. All are deterministic functions of the two rosters, so the
// offline client and the Edge Function still simulate the same game.

// A pick nobody made. The clock already auto-drafts the worst eligible
// player, and that was meant to be the penalty on its own - it isn't. The
// worst man in a ten-man squad is still an NBA player, and once
// TALENT_PARITY compresses the talent gap, the difference between "I chose
// him" and "the clock chose him" reached the scoreboard as roughly a point.
//
// So a forfeited pick now costs twice. The player produces at
// FORFEIT_PLAYER_SCALE - a body filling a slot, not part of a plan - and
// the team takes a flat cohesion hit per forfeit on top, capped so a total
// no-show is a heavy loss rather than an automatic 20-point one.
export const FORFEIT_PLAYER_SCALE = 0.78;
export const FORFEIT_TEAM_PENALTY = 0.035;
export const FORFEIT_TEAM_PENALTY_MAX = 0.14;

// How much roster CONSTRUCTION - covering every position, drafting players
// who can cover more than one, and not leaving a category empty - moves the
// scoreboard, as a plus-or-minus swing on team points. Deliberately smaller
// than the talent terms: a well-built roster of weaker players should still
// usually lose to a stacked one. It just shouldn't lose to a stacked one
// that was assembled by a timer.
export const CONSTRUCTION_SWING = 0.06;

// Counterplay: how much drafting AGAINST the opponent's build pays.
//
// Rewarded on difference, not on strength - spacing only pays against a big
// team and size only pays against a small one - so mirroring a good roster
// is never the safe answer and the draft becomes a read on what they're
// building rather than a race for the same players.
export const COUNTER_K = 0.05;
export const COUNTER_SCALE = 4;

// How much the DEFENSIVE ASSIGNMENTS you set are worth, as a suppression of
// the opponent's team points.
//
// The engine has always modelled assignments (resolveDefender feeds the
// chosen defender into the scoring matchup), but almost none of it survived
// to the scoreboard: applyTalentParity re-anchors each team's quarter to a
// league-average total, so five points taken off their star were handed
// straight back to the rest of their roster. Measured over 3,000 games,
// moving your best defender onto their best scorer was worth a 52.7% win
// rate - a coin flip, for the one screen that exists to be a decision.
//
// This is the same idea applied AFTER parity, where it can't be undone. It is
// scored against the DEFAULT assignment rather than in absolute terms, so a
// team of good defenders playing their natural matchups gets nothing extra
// (that is talent, and talent is already modelled) and only the decision to
// deviate - well or badly - moves anything.
export const SCHEME_K = 0.06;
// The raw scheme difference is small by construction - a matchup change is a
// TRADE (your stopper moves onto their star, but somebody else inherits the
// man he left), so the two halves partly cancel and a good swap nets about
// 0.03 on the quality scale. SCHEME_SCALE maps that working range onto the
// full 0-1 the swing is expressed over; without it SCHEME_K would be
// multiplying a number three orders of magnitude too small to see.
export const SCHEME_SCALE = 10;

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
