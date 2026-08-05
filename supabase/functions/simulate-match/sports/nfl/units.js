// Turning rows into ratings.
//
// The engine needs one comparable number per roster slot: a quarterback's
// passing line and a secondary's interception rate have to land on the same
// scale before OFFENSE_WEIGHTS and DEFENSE_WEIGHTS can combine them. This file
// is that conversion and nothing else - no simulation lives here.
//
// The aggregation this file was originally scoped for now happens upstream, in
// tools/build-nfl-data.mjs: units arrive already rolled up, games-weighted,
// carrying `depth` and their member names. What is left is the harder half -
// deciding how good one is.
//
// WHY PERCENTILE AND NOT A HAND-BUILT FORMULA
//
// The obvious approach is to invent a passer rating: weight yards this much,
// touchdowns that much, subtract for interceptions. Every such formula is a
// balance decision smuggled in as arithmetic, and this project's rule is that
// balance is solved rather than picked.
//
// So a player is rated by WHERE HE FALLS among everyone who played his
// position. A quarterback in the 90th percentile of quarterbacks rates 0.90,
// and what "90th percentile" means is decided by the data rather than by
// someone choosing coefficients. The composites below still weight stats
// within a position, but they only have to ORDER players against each other -
// a far weaker claim than getting an absolute scale right, and one that a
// wrong guess degrades gently instead of breaking.
//
// It also makes eras comparable for free. A 2000 quarterback and a 2023
// quarterback are each ranked against the whole dataset at their position, so
// the passing boom shows up as more high-rated modern passers rather than as a
// thumb on the scale nobody wrote down.

import { MIN_RATED_GAMES } from "./constants.js";

/** Composite score within a position, before the percentile step. These only
 * have to order players correctly against others at the same position. */
const COMPOSITES = {
  // Yards move the ball, touchdowns are the payoff, interceptions are the cost
  // that separates a volume passer from a good one.
  QB: (r) => r.pass_yds + 22 * r.pass_td - 26 * r.ints + 0.9 * r.rush_yds + 14 * r.rush_td,
  // Receiving counts for a back because third down is where backs differ most.
  RB: (r) => r.rush_yds + 18 * r.rush_td + 0.7 * r.rec_yds + 14 * r.rec_td - 20 * r.fum,
  WR: (r) => r.rec_yds + 20 * r.rec_td + 2.5 * r.rec - 18 * r.fum,
  TE: (r) => r.rec_yds + 20 * r.rec_td + 2.5 * r.rec - 18 * r.fum,
};

/** Same idea for units. Defensive groups are rated on what actually ends
 * drives - takeaways and pressure - rather than on tackles, which mostly count
 * how often the unit was on the field while the offence moved. */
// TWO CORRECTIONS ARE BAKED IN HERE, both from failed eye tests.
//
// SACKS ARE A SCHEME CHOICE, NOT A QUALITY (the 2006 Bears problem)
//
// Urlacher and Briggs recorded 0.06 sacks a game between them and rated 484th
// of 798 linebacker corps. They were not bad; they were a Tampa-2 unit, which
// drops linebackers into coverage and asks the line for pressure. Weighting
// sacks heavily for linebackers measures which SCHEME a team ran, then reports
// it as talent. So the sack term is small for linebackers and secondaries, who
// blitz only when a coordinator decides they should, and stays large for the
// defensive line, whose whole job it is.
//
// COUNTING STATS REWARD BEING ON THE FIELD (the 0-16 Lions problem)
//
// Detroit's 2008 line rated 0.744 because opponents ran far more plays against
// them - a bad defence is on the field constantly, and every snap is another
// chance to accumulate. Rating per GAME therefore pays teams for losing.
//
// TWO BETTER IDEAS WERE TRIED AND FAILED, recorded so nobody re-runs them:
//
//   POINTS ALLOWED is the right measure and is not available. nflverse ships
//   player rows with no schedule, so points allowed needs opponent pairing the
//   files do not carry.
//
//   TACKLES FOR LOSS and QUARTERBACK HITS are exactly the disruption stats
//   this wants - earned by beating a block, not by being on the field while
//   losing - but nflverse only records them reliably from about 2008. They are
//   0 for 2003 and 2006, and mean LB qb_hits runs 0.00 in 2004 against 1.82 in
//   2023. Weighting them measures WHAT YEAR IT IS and craters every pre-2009
//   unit, which is a worse bias than the one being fixed. The build now emits
//   them (tfl, qbh, fr) so a later era-aware normalisation can use them; they
//   are deliberately unused until then.
//
// So the fix stays per-play, and the proxy is already in the data: a team's
// total defensive tackles across all four units is very nearly its plays
// faced. Dividing by that turns every counting stat into a rate, so Detroit is
// measured on what it did per opportunity rather than on how many
// opportunities its offence handed over.
const UNIT_COMPOSITES = {
  // The line is the one group whose job really is to get to the quarterback,
  // so sacks stay dominant here and only here.
  DL: (r) => 20 * r.sacks + 9 * r.ff + 6 * r.ints + 3 * r.pd + 0.5 * r.tackles,
  // Coverage and run support, which is what a linebacker corps is for. Passes
  // defended carry real weight because for a linebacker they are the only
  // visible coverage evidence the dataset has.
  LB: (r) => 3 * r.sacks + 9 * r.ff + 11 * r.ints + 7 * r.pd + 0.9 * r.tackles,
  CB: (r) => 14 * r.ints + 5 * r.pd + 4 * r.ff + 0.3 * r.tackles,
  S: (r) => 13 * r.ints + 4 * r.pd + 5 * r.ff + 0.4 * r.tackles,
  // The line has no counting stats, so the import derived a rating for it.
  // Sacks allowed is the pass-protection half, yards per carry the run half.
  OL: (r) => r.rating - 6 * r.sacks_allowed + 8 * r.ypc,
  // A kicker is his accuracy. Volume barely counts: a perfect kicker on a good
  // offence attempts fewer, and docking him for that would be backwards.
  ST: (r) => 100 * r.fg_pct + 30 * r.pat_pct + 3 * r.fg_att,
};

/** Depth is a real term, not decoration. A three-man secondary that played a
 * whole season is thinner than a five-man one, and thin units break down late,
 * so shallow ones get pulled toward the middle rather than rating on their
 * best players alone. Full credit at five and above. */
function depthFactor(depth) {
  if (!Number.isFinite(depth) || depth <= 0) return 0.85;
  return Math.min(1, 0.72 + 0.056 * depth);
}

/** Sorted composite scores per position and per unit group - all a percentile
 * lookup needs. Built once per dataset and handed to the raters.
 *
 * Short seasons are excluded from the DISTRIBUTION but still ratable against
 * it: a player who appeared in four games should not help define what a median
 * season looks like, though he still deserves a number. */
/** Groups whose counting stats scale with how many plays the defence faced,
 * and so have to be normalised. OL and ST are excluded: an offensive line's
 * rating is already derived and a kicker's accuracy is a rate to begin with. */
const LOAD_NORMALISED = new Set(["DL", "LB", "CB", "S"]);

/** A team-season's total defensive tackles, which is very nearly the number of
 * plays its defence was on the field for. The proxy the per-play fix needs,
 * and it is already in the data - no snaps column required. */
function buildLoadIndex(units) {
  const load = new Map();
  for (const row of units) {
    if (!LOAD_NORMALISED.has(row.group)) continue;
    const key = `${row.team}|${row.season}`;
    load.set(key, (load.get(key) || 0) + (row.tackles || 0));
  }
  const values = [...load.values()].sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)] || 1;
  return { load, median };
}

/** Scales a unit's counting stats to what they would have been at a league
 * median workload. A defence that faced 15% more plays than average has its
 * production divided by 1.15, so volume earned by losing stops counting as
 * quality. Clamped because the extremes are usually short or odd seasons. */
function loadFactor(row, index) {
  if (!index || !LOAD_NORMALISED.has(row.group)) return 1;
  const total = index.load.get(`${row.team}|${row.season}`);
  if (!total || !index.median) return 1;
  return Math.max(0.8, Math.min(1.25, total / index.median));
}

export function buildRatingContext(players, units) {
  const ctx = { players: {}, units: {}, load: buildLoadIndex(units) };

  for (const row of players) {
    for (const pos of row.pos || []) {
      const composite = COMPOSITES[pos];
      if (!composite || row.games < MIN_RATED_GAMES) continue;
      (ctx.players[pos] ||= []).push(composite(row));
    }
  }
  for (const row of units) {
    const composite = UNIT_COMPOSITES[row.group];
    if (!composite || row.games < MIN_RATED_GAMES) continue;
    (ctx.units[row.group] ||= []).push(composite(row) / loadFactor(row, ctx.load));
  }

  for (const bucket of [ctx.players, ctx.units]) {
    for (const key of Object.keys(bucket)) bucket[key].sort((a, b) => a - b);
  }
  return ctx;
}

/** Share of the distribution at or below `value`, as 0..1. Binary search
 * because these arrays run to thousands of entries and this is called once per
 * roster slot per simulated game - which during calibration is millions. */
function percentile(sorted, value) {
  if (!sorted || sorted.length === 0) return 0.5;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

/** Clamped away from the ends: 0 would mean an offence that can never move the
 * ball and 1 an unstoppable one, and both make the drive model degenerate. The
 * best real offences still punt a third of the time.
 *
 * The clamp is for the SIMULATION, and it used to flatten the top of the board
 * as a side effect: every elite player pinned at exactly 0.97, so Quick Play's
 * best-first list put Peyton Manning fifth on his own Colts behind four
 * team-mates tied with him. Compressing into the last sliver instead of
 * truncating keeps the drive model's ceiling while preserving the ORDER, which
 * is the whole point of a list you are reading to learn who mattered. */
const clamp = (v) => {
  if (v <= 0.06) return 0.06;
  if (v < 0.92) return v;
  // 0.92..1 maps onto 0.92..0.97, so ranking survives at the top.
  return 0.92 + (v - 0.92) * (0.05 / 0.08);
};

/** Rate one drafted player, 0..1 among others at his position.
 *
 * A short season is regressed toward the middle rather than trusted outright
 * or thrown away. Four brilliant games are evidence, just weaker evidence than
 * sixteen, and someone who drafted an injured star should still get most of
 * what he paid for. */
export function ratePlayer(row, ctx) {
  const pos = (row.pos || []).find((p) => COMPOSITES[p]);
  if (!pos) return 0.5;
  const raw = percentile(ctx.players[pos], COMPOSITES[pos](row));
  if (row.games >= MIN_RATED_GAMES) return clamp(raw);
  const trust = Math.max(0, row.games) / MIN_RATED_GAMES;
  return clamp(0.5 + (raw - 0.5) * trust);
}

/** Rate one drafted unit, 0..1 among others of its group, then pulled toward
 * the middle if it was thin. */
export function rateUnit(row, ctx) {
  const composite = UNIT_COMPOSITES[row.group];
  if (!composite) return 0.5;
  const raw = percentile(ctx.units[row.group], composite(row) / loadFactor(row, ctx.load));
  const trust = row.games >= MIN_RATED_GAMES ? 1 : Math.max(0, row.games) / MIN_RATED_GAMES;
  const withSample = 0.5 + (raw - 0.5) * trust;
  return clamp(0.5 + (withSample - 0.5) * depthFactor(row.depth));
}

/** Whether a roster entry is a unit or an individual. Both shapes travel
 * through the same draft and the same roster jsonb, so the engine has to ask
 * rather than assume - `group` is the field only units carry. */
export const isUnit = (entry) => typeof entry?.group === "string";

/** Rate any roster entry, whichever kind it is. This is what the engine calls;
 * it should never need to know which shape it was handed. */
export function rateEntry(entry, ctx) {
  if (!entry) return 0;
  return isUnit(entry) ? rateUnit(entry, ctx) : ratePlayer(entry, ctx);
}
