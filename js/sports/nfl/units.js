// Turning NFL player and unit rows into comparable 0..1 ratings.
//
// Everything is normalized metric-by-metric within position group and SEASON,
// so a scheme choice, a season length, a scoring era or a missing optional
// field cannot turn a legitimate player or defence into an automatic F. Season
// rather than era because the gaps in this dataset sit mid-decade - see
// seasonKey.
//
// A rating is a z-score - how far above his own league a man stood - mapped
// onto 0..1 through a tanh whose span is solved per group so every group's
// best season reaches the same ceiling. overallFromZ turns the same z into the
// 0-99 number the draft board shows.

import { MIN_RATED_GAMES } from "./constants.js";

// isUnit and unitLabel are DEFINED in ./entry.js and re-exported here.
//
// They belong to shared UI rather than to rating - see the header of entry.js
// for why they had to leave a file that is no longer loaded on boot. The
// re-export is what keeps that move invisible to engine.js and draftgrade.js,
// which import them from here and are vendored to the Edge Function.
export { isUnit, unitLabel } from "./entry.js";
import { isUnit } from "./entry.js";

// WHAT A PLAYER IS WORTH, IN THREE PARTS.
//
// This used to be one part: a fantasy-points-per-game composite, percentiled.
// Volume and nothing else. Two consequences, both visible in live games:
//
//   - `ypc` and `ypt` sat in the dataset unused, so a back averaging 3.0 a
//     carry and one averaging 5.5 rated identically if their yardage matched.
//   - A backup rated on his per-game rate as though he were a starter. Mike
//     James 2013 carried 60 times all season - somebody's backup - and the
//     draft board offered him as a starting running back at his small-sample
//     4.92 a carry.
//
// So a rating is now PRODUCTION (what he did), EFFICIENCY (how good he was per
// touch) and ROLE (whether he was actually the starter). The first two are
// percentiled against his position; the third decides how far to trust the
// other two.

/**
 * PRODUCTION, in yards-equivalent. Every coefficient is fantasy-standard
 * scoring converted to yards at that format's own exchange rate - 1 point per
 * 10 rushing or receiving yards, 1 per 25 passing - so nothing here is an
 * invented number:
 *
 *   touchdown        6 pts -> 60 yards   (4 pts -> 100 passing yards)
 *   interception    -2 pts -> -50 passing yards
 *   lost fumble     -2 pts -> -20 yards
 *   reception     half PPR -> 2.5 yards
 *
 * THE TOUCHDOWN WEIGHTS USED TO BE A THIRD OF THIS - 18 yards for a rushing
 * score, 14 for a receiving one - while the fumble weight was already exactly
 * fantasy-correct at -20. That mismatch is what let Tiki Barber's 2006 rate as
 * the best back in the game: scoring five times all year cost him 4.3% of his
 * composite, so 2,127 yards carried him past LaDainian Tomlinson's 31
 * touchdowns in the same season.
 *
 * Efficiency and drive-sustaining work are NOT here. They are rates, they
 * belong in EFFICIENCY below, and folding them in would count the same yards
 * twice - the mistake NON_DEFENSIVE_UNIT_COMPOSITES.OL had to have removed.
 */
const COMPOSITES = {
  QB: (r) => n(r.pass_yds) + 100 * n(r.pass_td) - 50 * n(r.ints) + 0.9 * n(r.rush_yds) + 60 * n(r.rush_td),
  RB: (r) => n(r.rush_yds) + 60 * n(r.rush_td) + 0.7 * n(r.rec_yds) + 47 * n(r.rec_td) - 20 * n(r.fum),
  WR: (r) => n(r.rec_yds) + 60 * n(r.rec_td) + 2.5 * n(r.rec) - 18 * n(r.fum),
  TE: (r) => n(r.rec_yds) + 60 * n(r.rec_td) + 2.5 * n(r.rec) - 18 * n(r.fum),
};

/** One term of the NFL's passer rating, which caps each component at 2.375. */
const passerTerm = (v) => Math.max(0, Math.min(2.375, v));

/**
 * The league's own passer rating, from the fields the build now carries.
 *
 * Chosen over a bespoke formula because it is the number every football fan
 * already reads a quarterback by, and because it weighs the four things that
 * separate passers - accuracy, yards per throw, scoring and giving it away -
 * without another set of invented coefficients. Returns null when a man never
 * threw, so a running back is not rated as a failed quarterback.
 */
export function passerRating(r) {
  const att = n(r.att_pg);
  if (att <= 0) return null;
  return (
    (passerTerm((n(r.comp_pct) - 0.3) * 5) +
      passerTerm((n(r.ypa) - 3) * 0.25) +
      passerTerm((n(r.pass_td) / att) * 20) +
      passerTerm(2.375 - (n(r.ints) / att) * 25)) /
    6
  ) * 100;
}

/**
 * A number the source actually recorded, or null.
 *
 * n() coerces null to 0, which is right for a counting stat - a man who scored
 * no touchdowns scored zero - and catastrophic for a derived rate, where the
 * data build now writes null to mean "the denominator was never recorded"
 * (see tools/build-nfl-data.mjs). Scoring that as 0 is the difference between
 * "we don't know how many yards a target he averaged" and "he averaged none".
 */
function known(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** A rate whose denominator may be zero or unrecorded. */
function per(numerator, denominator) {
  const top = known(numerator);
  const bottom = known(denominator);
  if (top === null || bottom === null || bottom <= 0) return null;
  return top / bottom;
}

/**
 * HOW GOOD HE WAS PER TOUCH, as several independent readings rather than one
 * number, because any single one of them can be missing.
 *
 * Each term returns null when the source cannot answer it, and ratePlayer
 * averages whichever terms survive. That is the whole reason this is a list:
 * nflverse's target column is unusable from 2003 to 2008, and the previous
 * single-expression version multiplied straight through it, so a third of the
 * dataset was rated on a denominator that did not exist.
 *
 * EPA, first-down rate and explosive-play rate were added precisely because
 * they are complete for every season this game covers - verified against the
 * raw files, in the worst target year, not assumed - so a receiver in 2006 is
 * still measured on something real.
 */
const EFFICIENCY = {
  QB: {
    // The league's own passer rating: the number every fan already reads a
    // quarterback by, and four judgements (accuracy, yards per throw, scoring,
    // giving it away) for the price of one.
    passer: (r) => passerRating(r),
    // Expected points added per dropback - already adjusted for down, distance
    // and field position, which passer rating is not.
    epa: (r) => per(r.epa_pg, n(r.att_pg) + n(r.sacked_pg)),
    // Sacks taken, as a share of dropbacks. Negated because taking them is the
    // bad outcome. This column was summed by the build for years and never
    // emitted, so a quarterback who got rid of it and one who ate eight a game
    // scored identically.
    sacks: (r) => {
      const rate = per(r.sacked_pg, n(r.att_pg) + n(r.sacked_pg));
      return rate === null ? null : -rate;
    },
  },
  RB: {
    ypc: (r) => known(r.ypc),
    ypt: (r) => known(r.ypt),
    epa: (r) => per(r.epa_pg, rbTouches(r)),
    // Moving the chains, which yardage alone hides: four yards on 3rd-and-3 is
    // a different play from four on 3rd-and-8.
    firstDowns: (r) => per(r.fd_pg, rbTouches(r)),
    explosive: (r) => per(r.explosive_pg, rbTouches(r)),
  },
  WR: receiverEfficiency(),
  TE: receiverEfficiency(),
};

/** Carries plus catches - what a back actually touched the ball on.
 *
 * Named for the position rather than just `touches` because roleConfidence
 * below declares a local of that name, and a module-level function quietly
 * shadowed inside one function is a trap for whoever edits it next. */
function rbTouches(r) {
  return n(r.car_pg) + n(r.rec);
}

/** Receivers and tight ends are measured identically; the pools they are
 * measured AGAINST are what separate them. */
function receiverEfficiency() {
  return {
    // Yards per reception needs no target data, so unlike ypt it survives every
    // season. It cannot tell a possession receiver from a decoy on its own,
    // which is what the other four terms are for.
    ypr: (r) => per(r.rec_yds, r.rec),
    ypt: (r) => known(r.ypt),
    catchRate: (r) => {
      const rate = per(r.rec, r.tgt_pg);
      return rate === null ? null : Math.min(1.5, rate);
    },
    epa: (r) => per(r.epa_pg, r.rec),
    firstDowns: (r) => per(r.fd_pg, r.rec),
    explosive: (r) => per(r.explosive_pg, r.rec),
  };
}

/**
 * A starter's workload, per game, per position.
 *
 * Not a cutoff - a divisor. A back at 14 carries a game is trusted at his own
 * rate; one at 7 is trusted half way and regresses the rest toward his
 * position's middle, because half a season of carries is not evidence that he
 * could do it as the every-down back this game makes him. Nobody is pushed
 * DOWN by this: an unproven man moves toward average from whichever side he
 * started on.
 */
const STARTER_TOUCHES = { QB: 26, RB: 16, WR: 6, TE: 4 };

/**
 * The same workload measured in CATCHES, for the seasons with no target data.
 *
 * Roughly a starter's share at the catch rates those positions actually run,
 * so the two scales describe the same player. Without this, every receiver
 * from 2003 to 2008 fell through to the "unknown, so trust him fully" branch
 * below - which is right for a genuinely missing column and wrong here, because
 * receptions ARE recorded in those years. It would have handed a man with one
 * catch a game the same trust as a number one.
 */
const STARTER_CATCHES = { WR: 4, TE: 2.8 };

export function roleConfidence(r, pos) {
  let touches;
  let full = STARTER_TOUCHES[pos] || 1;

  if (pos === "QB") {
    touches = n(r.att_pg);
  } else if (pos === "RB") {
    // Carries carry this on their own; targets only refine it, so a null one
    // costs nothing.
    touches = n(r.car_pg) + 0.5 * (known(r.tgt_pg) ?? 0);
  } else {
    const targets = known(r.tgt_pg);
    if (targets === null && STARTER_CATCHES[pos]) {
      touches = n(r.rec);
      full = STARTER_CATCHES[pos];
    } else {
      touches = targets ?? 0;
    }
  }

  // Older rows predate car_pg/tgt_pg/att_pg entirely. Absent role data must not
  // silently mean "backup" - it means "unknown", and unknown is full trust,
  // exactly as it behaved before this existed.
  if (!touches) return 1;
  return Math.max(0, Math.min(1, touches / full));
}

const NON_DEFENSIVE_UNIT_COMPOSITES = {
  // `rating` IS the line, already whole. tools/build-nfl-data.mjs builds it as
  // 50 * (protection + runBlock), both within-season percentiles, so it already
  // carries pass protection and run blocking in equal measure and is already
  // era-safe. The two terms this replaces re-read the same two inputs a second
  // time - `- 6 * sacks_allowed` the protection half, `+ 8 * ypc` the run half -
  // which double-counted the line against itself.
  //
  // That went unnoticed while sacks_allowed was silently 0 (see buildOlUnit),
  // because only one of the two duplicates was doing anything: yards per carry
  // was counted twice and protection not at all. Fixing the data without also
  // removing these would have swapped one distortion for another rather than
  // ending it, so the two changes belong together.
  OL: (r) => n(r.rating),
  ST: (r) => 100 * n(r.fg_pct) + 30 * n(r.pat_pct) + 3 * n(r.fg_att),
};

const DEFENSIVE_GROUPS = new Set(["DL", "LB", "CB", "S"]);

/**
 * WHAT A DEFENSIVE UNIT'S NUMBERS ARE MEASURED AGAINST, AND WHY IT IS NOT
 * "PER GAME".
 *
 * Every metric here used to be a per-game COUNT - tackles, tfl, pd, ints,
 * sacks - percentiled inside the unit's position group and era. That reads as
 * obviously correct and is the single most expensive mistake in this file,
 * because a count is quality multiplied by two things that are not quality:
 *
 *   HOW MANY SNAPS THE UNIT FACED. A defence that gets off the field makes
 *   fewer tackles. Tackle volume is, if anything, an INVERSE quality signal:
 *   you accumulate it by being on the field while the offence moves. The
 *   dataset builder already says this in its own comment ("Disruption, not
 *   volume. A bad defence racks up tackles by being on the field") - and then
 *   `tackles` was used as a positive in four of the eleven responsibility
 *   slots below, and was the single highest-correlated input to the LB and S
 *   ratings.
 *
 *   HOW MANY MEN THE TEAM ROTATED THROUGH. The sums are the whole group's, so
 *   a nine-man rotation banks more of everything than a four-man one. Measured
 *   over the shipped dataset, mean rating rose monotonically with `depth`:
 *   safeties 0.273 at one deep against 0.667 at five, defensive lines 0.266 at
 *   five against 0.713 at eleven. That is a roster-construction fact being
 *   reported as a quality verdict, and it is why units with stable, famous
 *   starters rated below units that churned.
 *
 * The consequence reached the scoreboard. A player who drafts the defenders he
 * can name gets a defence the engine scores as ordinary, so the talent gap the
 * simulation actually sees collapses toward zero and the game becomes a coin
 * flip - which is exactly the complaint that sent anyone looking here.
 *
 * So a unit is rated on DISRUPTION RATE: how much of its own workload was
 * destructive, rather than how much workload it had. `tackles` becomes the
 * DENOMINATOR - the best proxy this dataset carries for snaps faced - and
 * stops being a numerator anywhere. Both confounds cancel in the ratio,
 * because exposure and rotation size scale the top and the bottom together.
 *
 * Measured across the shipped dataset, correlation between a unit's rating and
 * its depth:
 *
 *              before   after
 *   DL          0.530    0.180
 *   LB          0.454    0.223
 *   CB          0.294   -0.233
 *   S           0.512   -0.060
 *
 * ...while the spread of ratings is essentially unchanged (p10/p50/p90 move by
 * at most 0.02 in any group), so this sharpens what the number MEANS without
 * flattening or inflating the scale the rest of the game is calibrated on.
 * scripts/verify-nfl-talent-response.mjs holds both properties.
 */
const DEFENSIVE_EXPOSURE = "tackles";

/**
 * The numerator of each rate: the destructive events themselves. Named
 * separately from the responsibilities below so one event can serve two
 * responsibilities without the responsibility list having to repeat its
 * definition.
 */
const DEFENSIVE_EVENTS = {
  sackRate: (row) => n(row.sacks),
  pressureRate: (row) => n(row.qbh),
  stuffRate: (row) => n(row.tfl),
  breakupRate: (row) => n(row.pd),
  takeawayRate: (row) => n(row.ints) + n(row.ff) + n(row.fr),
  interceptionRate: (row) => n(row.ints),
};

/**
 * How much league-average rate a thin sample is worth, in tackles.
 *
 * A ratio is unstable when its denominator is small, and dividing by a unit's
 * own tackles hands the biggest ratios to the units with the fewest - the
 * exact opposite of what the change above is for. So every rate is shrunk
 * toward its group's pooled rate by twelve tackles' worth of prior, which is
 * about one game's work for a position group. A full season's unit is barely
 * moved; a unit with almost no measured workload is reported as ordinary
 * rather than as elite, which is the honest reading of a sample that thin.
 */
const DEFENSIVE_RATE_PRIOR = 12;

/**
 * Responsibilities are equally weighted, and metrics inside a responsibility
 * are also equally weighted. The data decides the ordering rather than another
 * hidden set of balance coefficients.
 *
 * WHAT CHANGED FROM THE VOLUME VERSION, beyond the units:
 *
 *   LB lost `tackling: ["tackles"]` outright. It was a whole responsibility -
 *   a quarter of a linebacker unit's rating - whose entire content was "this
 *   group made tackles", which every linebacker group does. There is no rate
 *   form of it worth keeping; the disruptive part of a linebacker's run
 *   defence is already `stuffRate`.
 *
 *   S lost `explosivePlayPrevention: ["tfl", "tackles"]`. A safety making a
 *   lot of tackles is a front that is leaking, not a secondary that is good,
 *   so the metric was not merely noisy but pointed the wrong way. What a
 *   safety is actually for - taking the ball away and breaking up what gets
 *   thrown deep - is what remains.
 *
 *   LB and DL both carry `passRush` now. A 3-4 outside linebacker rushes the
 *   passer; splitting sacks so that only linemen were credited for them made
 *   every 3-4 front read as a poor one.
 *
 * The AXIS each responsibility answers to is declared alongside it, because
 * the engine matches offence against defence one axis at a time and needs to
 * know which of these feeds which - see DEFENSIVE_AXES below.
 */
const DEFENSIVE_RESPONSIBILITIES = {
  DL: {
    passRush: ["sackRate", "pressureRate"],
    runStop: ["stuffRate"],
  },
  LB: {
    runStop: ["stuffRate"],
    coverage: ["breakupRate"],
    takeaways: ["takeawayRate"],
    passRush: ["sackRate"],
  },
  CB: {
    coverage: ["breakupRate"],
    takeaways: ["interceptionRate"],
    runStop: ["stuffRate"],
  },
  S: {
    coverage: ["breakupRate"],
    takeaways: ["interceptionRate"],
    runStop: ["stuffRate"],
  },
};

function n(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function canonicalGroup(row) {
  const direct = String(row?.group || "").trim().toUpperCase();
  if (direct) return direct;
  const positions = Array.isArray(row?.pos) ? row.pos : [row?.pos];
  for (const pos of positions) {
    const key = String(pos || "").trim().toUpperCase();
    if (DEFENSIVE_GROUPS.has(key) || NON_DEFENSIVE_UNIT_COMPOSITES[key]) return key;
  }
  return "";
}


/**
 * How much of a unit's measured quality to believe, from how many men were
 * actually in it. A two-man linebacker corps really is thinner than a five-man
 * one, and the sample behind its numbers is thinner too.
 *
 * A DEPTH OF ZERO IS THE THINNEST UNIT THERE IS, NOT AN AVERAGE ONE. It used
 * to return 0.85, which sits ABOVE the factor for a one-deep (0.776) and a
 * two-deep (0.832) unit - so a unit nobody could even name outranked a stable
 * one. Zero never means "no players": a unit with no members is one where
 * every man passed through too fast to clear the games threshold, which is
 * maximum churn. It is treated as one-deep, the thinnest real unit, rather
 * than as a missing value handed a plausible-looking default - the exact
 * failure CLAUDE.md names.
 *
 * Two rows in the shipped data reach it: the 2002 Jaguars special teams and
 * one safeties unit. The safeties row was already there and already scored
 * this way, which is why nothing had noticed.
 */
function depthFactor(depth) {
  const value = Number(depth);
  if (!Number.isFinite(value) || value <= 1) return Math.min(1, 0.72 + 0.056);
  return Math.min(1, 0.72 + 0.056 * value);
}

/**
 * SEASON, not era, is what a player is measured against.
 *
 * Era buckets are plain decades, and the holes in this dataset do not respect
 * them: nflverse's target column fails from 2003 to 2008, which is six of the
 * ten seasons in the 2000s bucket. Normalising per era would leave that bucket
 * 57% blind and 43% sighted, and the few corrupt rows that survived would
 * percentile ABOVE the genuinely elite ones - measured, before this was
 * written: a broken 46.5 yards per target scored .984 against the era while a
 * real 11.0 scored .976. Per season, a season the source could not measure
 * simply has every player tied, which is what "no information" should look
 * like.
 */
function seasonKey(row) {
  const season = Number(row?.season);
  return Number.isFinite(season) ? String(season) : "all";
}

/**
 * How far above his own season a player stood, in standard deviations.
 *
 * A z-score rather than a percentile because DOMINANCE HAS A SIZE. Percentile
 * only ranks: with about 110 backs in a season the best one scores .9955 and
 * the fourth best .9950, so twenty-six seasons produce twenty-six
 * indistinguishable leaders and the draft board's top five is decided by float
 * noise. A z-score says LaDainian Tomlinson's 2006 was +3.6 and a merely good
 * season was +1.5, which is the difference the draft is actually about.
 */
function zScore(stats, value) {
  if (!stats || !(stats.sd > 0) || !Number.isFinite(value)) return 0;
  return (value - stats.mean) / stats.sd;
}

/** Mean and standard deviation of one pool, in the shape zScore wants. */
function distribution(values) {
  const usable = (values || []).filter((v) => Number.isFinite(v));
  if (!usable.length) return { mean: 0, sd: 0, count: 0 };
  const mean = usable.reduce((sum, v) => sum + v, 0) / usable.length;
  const variance = usable.reduce((sum, v) => sum + (v - mean) ** 2, 0) / usable.length;
  return { mean, sd: Math.sqrt(variance), count: usable.length };
}

/**
 * The 0.94 the per-group spans are solved against, and where 0.97 comes from.
 *
 * tanh never reaches 1, so a ceiling has to be chosen rather than hit. 0.94 of
 * the way puts every group's best season at 0.97 - high enough to read as
 * perfect, short enough that the map stays strictly monotonic there and two
 * great seasons never tie.
 */
const CEILING_TANH = 0.94;
const CEILING_Z = Math.atanh(CEILING_TANH);

/**
 * A z-score on the 0..1 scale the rest of the game speaks.
 *
 * THIS REPLACES A HARD CLAMP that compressed everything above the 92nd
 * percentile into 0.92-0.97. That clamp put 476 entries into five rating
 * points and tied four different offensive lines at exactly 0.9674 - not
 * because they were equal, but because the scale had run out of room where the
 * draft is actually decided.
 *
 * tanh gives that back: smooth, so no two seasons tie; strictly monotonic, so
 * nothing clips; bounded, so the result is always a legal rating. Above all it
 * is CENTRED ON 0.5, which is not decoration - engine.js's swing() is
 * `1 + amount * (rating - 0.5)` and constants.js says of it "CENTRED ON 1 IS
 * THE WHOLE DESIGN". A rating whose mean drifted off 0.5 would move every
 * calibrated number in the simulation.
 */
function ratingFromZ(z, span) {
  if (!(span > 0)) return 0.5;
  return 0.5 + 0.5 * Math.tanh(z / span);
}

/**
 * The floor, and the only clamping left.
 *
 * ratingFromZ cannot leave 0..1 on its own, but the trust and role discounts
 * applied after it are plain arithmetic and can. The floor is a football
 * statement rather than a numerical one: the worst man in this dataset still
 * played in the NFL, and a rating of 0 would multiply him out of the
 * simulation entirely.
 */
function bounded(v) {
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0.06, Math.min(1, v));
}

/**
 * MADDEN-STYLE OVERALL, for display only.
 *
 * The engine needs 0.5-centred; a player reading "0.83" needs a translation.
 * Anchored so an average season is 70 and each group's best is 99, which is
 * the scale every football player already has in their head. Nothing in the
 * simulation reads this - it exists so the draft board can say 99 without the
 * engine having to.
 */
export function overallFromZ(z, span) {
  if (!(span > 0)) return 70;
  const scaled = Math.tanh(z / span) / CEILING_TANH;
  return Math.max(40, Math.min(99, Math.round(70 + 29 * scaled)));
}

function metricNames(group) {
  const responsibilities = DEFENSIVE_RESPONSIBILITIES[group] || {};
  return [...new Set(Object.values(responsibilities).flat())];
}


/** How many snaps this unit was on the field for, as far as the dataset can
 * say. Tackles are the proxy - see DEFENSIVE_EXPOSURE. Floored at one so a row
 * with no measured workload divides rather than throwing; the prior below is
 * what actually decides such a row. */
function defensiveExposure(row) {
  return Math.max(1, n(row?.[DEFENSIVE_EXPOSURE]));
}

/**
 * One unit's disruption rate for one event, shrunk toward its group's pooled
 * rate by DEFENSIVE_RATE_PRIOR tackles' worth of prior.
 *
 * The pooled rate is computed over the whole group rather than per era,
 * because it is a stabiliser rather than a verdict - the era comparison
 * happens afterwards, when the rate is percentiled against its own decade.
 */
function defensiveRate(row, metric, ctx) {
  const event = DEFENSIVE_EVENTS[metric];
  if (!event) return 0;
  const pooled = ctx?.defensiveRatePriors?.[canonicalGroup(row)]?.[metric];
  const base = pooled && pooled.exposure > 0 ? pooled.events / pooled.exposure : 0;
  return (
    (event(row) + DEFENSIVE_RATE_PRIOR * base) /
    (defensiveExposure(row) + DEFENSIVE_RATE_PRIOR)
  );
}

/** A season's pool for one group, created on demand. */
function seasonBucket(ctx, group, season) {
  const byGroup = (ctx.seasons[group] ||= {});
  return (byGroup[season] ||= { production: [], efficiency: {}, metrics: {}, pointsAllowed: [] });
}

/** Collapse a bucket's raw value arrays into mean/sd, in place. */
function summariseBucket(bucket) {
  const out = { production: distribution(bucket.production), efficiency: {}, metrics: {}, pointsAllowed: distribution(bucket.pointsAllowed) };
  for (const [term, values] of Object.entries(bucket.efficiency)) out.efficiency[term] = distribution(values);
  for (const [metric, values] of Object.entries(bucket.metrics)) out.metrics[metric] = distribution(values);
  return out;
}

export function buildRatingContext(players, units) {
  const ctx = {
    // Per GROUP, per SEASON: the mean and standard deviation of everything a
    // rating is built from. Replaces the flat all-time pools that made a 2006
    // back compete against 2024 - see seasonKey above for why season rather
    // than era.
    seasons: {},
    // Per group, the tanh span that puts that group's best season at the
    // ceiling. Solved below, not authored.
    spans: {},
    // The pooled event-per-tackle rate of each group, which every unit's own
    // rate is shrunk toward. Built in its own pass BEFORE any rate is taken,
    // because a shrinkage target computed from a subset of the rows it is used
    // on would make a unit's rating depend on iteration order.
    defensiveRatePriors: {},
  };

  for (const row of units || []) {
    const group = canonicalGroup(row);
    if (!DEFENSIVE_GROUPS.has(group) || n(row.games) < MIN_RATED_GAMES) continue;
    const priors = (ctx.defensiveRatePriors[group] ||= {});
    for (const metric of metricNames(group)) {
      const acc = (priors[metric] ||= { events: 0, exposure: 0 });
      acc.events += DEFENSIVE_EVENTS[metric]?.(row) || 0;
      acc.exposure += defensiveExposure(row);
    }
  }

  for (const row of players || []) {
    for (const pos of row.pos || []) {
      const composite = COMPOSITES[pos];
      if (!composite || n(row.games) < MIN_RATED_GAMES) continue;
      const bucket = seasonBucket(ctx, pos, seasonKey(row));
      bucket.production.push(composite(row));
      for (const [term, read] of Object.entries(EFFICIENCY[pos] || {})) {
        const value = read(row);
        // A term the source could not answer contributes NOTHING to the pool it
        // would otherwise be measured against. Pushing a 0 here would drag the
        // mean down and then score the very rows that are missing it as though
        // they were merely bad at it.
        if (value !== null && Number.isFinite(value)) (bucket.efficiency[term] ||= []).push(value);
      }
    }
  }

  for (const row of units || []) {
    const group = canonicalGroup(row);
    if (n(row.games) < MIN_RATED_GAMES) continue;
    const bucket = seasonBucket(ctx, group, seasonKey(row));

    if (DEFENSIVE_GROUPS.has(group)) {
      for (const metric of metricNames(group)) {
        (bucket.metrics[metric] ||= []).push(defensiveRate(row, metric, ctx));
      }
      // Negated so that, like every other metric here, MORE IS BETTER. A
      // defence that gave up fewer points should come out above one that gave
      // up more, and leaving the sign alone would invert exactly that.
      const pa = known(row.pa_pg);
      if (pa !== null) bucket.pointsAllowed.push(-pa);
      continue;
    }

    const composite = NON_DEFENSIVE_UNIT_COMPOSITES[group];
    if (composite) bucket.production.push(composite(row));
  }

  for (const [group, bySeason] of Object.entries(ctx.seasons)) {
    for (const season of Object.keys(bySeason)) bySeason[season] = summariseBucket(bySeason[season]);
    ctx.seasons[group] = bySeason;
  }

  // SOLVE the per-group spans, second pass, now that every distribution exists.
  //
  // One shared span cannot work: the groups have very different tail lengths.
  // Tight ends reach +4.3 standard deviations and offensive lines only +2.0,
  // so a span that put Tony Gonzalez at the ceiling left the best line in the
  // game rated 86 - which is not a statement about offensive line play, it is
  // the tail length leaking into the rating.
  const peak = {};
  for (const row of [...(players || []), ...(units || [])]) {
    const group = ratingGroup(row);
    if (!group || n(row.games) < MIN_RATED_GAMES) continue;
    const z = rawZ(row, ctx, group);
    if (!Number.isFinite(z)) continue;
    if (!(group in peak) || z > peak[group]) peak[group] = z;
  }
  for (const [group, best] of Object.entries(peak)) {
    // A group whose best season is not above its own mean has no spread worth
    // stretching; 1 leaves the map as a plain tanh rather than dividing by ~0.
    ctx.spans[group] = best > 0 ? Math.max(best, 0.5) / CEILING_Z : 1;
  }
  return ctx;
}

/** Which pool an entry is rated inside - his position, or his unit's group. */
function ratingGroup(row) {
  const group = canonicalGroup(row);
  if (group) return group;
  return (row?.pos || []).find((pos) => COMPOSITES[pos]) || "";
}

/**
 * How far above his own season an entry stood, BEFORE any trust or role
 * discount - the quantity the spans are solved against and the ratings are
 * built from.
 */
function rawZ(row, ctx, group = ratingGroup(row)) {
  const stats = ctx?.seasons?.[group]?.[seasonKey(row)];
  if (!stats) return 0;
  if (DEFENSIVE_GROUPS.has(group)) return defensiveZ(row, ctx, group, stats);

  const composite = COMPOSITES[group];
  if (composite) {
    const production = zScore(stats.production, composite(row));
    const efficiency = efficiencyZ(row, group, stats);
    const weight = EFFICIENCY_WEIGHT[group] ?? 0;
    // No efficiency term survived, so production carries the whole rating
    // rather than being averaged against a fabricated average. This is the
    // "unknown is not zero" rule at the level of the whole half.
    if (efficiency === null) return production;
    return production * (1 - weight) + efficiency * weight;
  }

  const unitComposite = NON_DEFENSIVE_UNIT_COMPOSITES[group];
  return unitComposite ? zScore(stats.production, unitComposite(row)) : 0;
}

/** The mean of whichever efficiency terms this row can actually answer, in
 * standard deviations. null when it can answer none. */
function efficiencyZ(row, pos, stats) {
  let total = 0;
  let count = 0;
  for (const [term, read] of Object.entries(EFFICIENCY[pos] || {})) {
    const value = read(row);
    if (value === null || !Number.isFinite(value)) continue;
    const dist = stats.efficiency?.[term];
    if (!dist || !(dist.sd > 0)) continue;
    total += zScore(dist, value);
    count += 1;
  }
  return count ? total / count : null;
}

/** How much of a rating is efficiency rather than raw production.
 *
 * Quarterback leans hardest on it because passer rating already contains his
 * volume-independent quality and because his position decides more games than
 * any other. Receivers lean least: a man who is targeted twice a game at 14
 * yards a target is a decoy, not a number one. */
const EFFICIENCY_WEIGHT = { QB: 0.40, RB: 0.45, WR: 0.35, TE: 0.35 };

/** What a man nobody trusted with a starter's workload is worth. Not zero - he
 *  is an NFL player - but below the median of men who did start. */
const REPLACEMENT_LEVEL = 0.3;

export function ratePlayer(row, ctx) {
  const pos = (row.pos || []).find((p) => COMPOSITES[p]);
  if (!pos) return 0.5;

  const raw = ratingFromZ(rawZ(row, ctx, pos), ctx?.spans?.[pos]);

  // Two separate reasons to distrust a line, and they pull toward DIFFERENT
  // places, which is why they are applied separately.
  //
  // Too few GAMES is ignorance: we do not know what he was, so he regresses to
  // the middle of his position.
  //
  // Too few TOUCHES is information. A back who played seven games and carried
  // 8.6 times in them was not hurt, he was BACKUP - his own team, watching him
  // every day, chose someone else. That is evidence about his quality, not an
  // absence of it, so it regresses toward REPLACEMENT rather than toward
  // average. Regressing it to the middle is what left an 8.6-carry backup
  // rating within three points of a 19-carry starter.
  const gamesTrust = Math.min(1, Math.max(0, n(row.games)) / MIN_RATED_GAMES);
  const sampled = 0.5 + (raw - 0.5) * gamesTrust;
  const role = roleConfidence(row, pos);
  return bounded(REPLACEMENT_LEVEL + (sampled - REPLACEMENT_LEVEL) * role);
}

/**
 * How much of a defensive unit's rating is points allowed.
 *
 * THE SCOREBOARD DOES NOT SAY WHICH UNIT GAVE IT UP, so this same number goes
 * to a team's line, linebackers, corners and safeties alike. That is honest -
 * they did all play - but it is also why the weight is minority rather than
 * dominant. The engine matches offence against defence one axis at a time so
 * that a front that gets home and a secondary that covers do different things
 * to the opponent (see DEFENSIVE_RESPONSIBILITIES); a heavy shared term would
 * pull all four groups on a team toward one number and rebuild exactly the
 * single generic defensive rating that model exists to replace.
 *
 * It is also the noisiest signal here: points allowed is contaminated by the
 * offence's turnovers and by special teams, and the clean version - points
 * allowed adjusted for where drives started - needs play-by-play data this
 * pipeline does not load. A minority weight is the honest home for a number
 * that is both indispensable and impure.
 */
const POINTS_ALLOWED_WEIGHT = 0.27;

/** One metric in standard deviations against the same group in the same
 * season. */
function defensiveMetricZ(row, group, metric, ctx, stats) {
  const dist = stats?.metrics?.[metric];
  if (!dist || !(dist.sd > 0)) return 0;
  return zScore(dist, defensiveRate(row, metric, ctx));
}

/**
 * The axis spans, fixed rather than solved.
 *
 * The per-group spans stretch each group's BEST season to the ceiling, which
 * is what the draft board wants and what an axis must not have: the engine
 * multiplies by `1 + AXIS_SWING * (axis - 0.5)`, so stretching an axis would
 * silently change how hard matchups swing. 1.5 keeps the spread of these
 * values close to the percentiles they replace (a standard normal through
 * tanh(z/1.5) has a standard deviation near 0.30, against 0.289 for the
 * uniform percentiles) - so AXIS_SWING keeps meaning what it was solved to
 * mean.
 */
const AXIS_SPAN = 1.5;

/** A defensive unit's overall standing, in standard deviations: what it did on
 * its own responsibilities, blended with what its whole defence conceded. */
function defensiveZ(row, ctx, group, stats) {
  const responsibilities = DEFENSIVE_RESPONSIBILITIES[group];
  if (!responsibilities) return 0;

  const axes = [];
  for (const metrics of Object.values(responsibilities)) {
    const values = metrics.map((metric) => defensiveMetricZ(row, group, metric, ctx, stats));
    if (values.length) axes.push(values.reduce((sum, value) => sum + value, 0) / values.length);
  }
  const own = axes.length ? axes.reduce((sum, value) => sum + value, 0) / axes.length : 0;

  const pa = known(row.pa_pg);
  const paStats = stats?.pointsAllowed;
  // A season with no score data rates on its own play alone rather than being
  // blended against an assumed-average defence.
  if (pa === null || !paStats || !(paStats.sd > 0)) return own;
  return own * (1 - POINTS_ALLOWED_WEIGHT) + zScore(paStats, -pa) * POINTS_ALLOWED_WEIGHT;
}

/** Component scores used by both simulation grading and the visible draft
 * explanation. Exported so tests/UI can audit exactly why a group rated where
 * it did without reimplementing the formula. */
export function defensiveUnitComponents(row, ctx) {
  const group = canonicalGroup(row);
  const responsibilities = DEFENSIVE_RESPONSIBILITIES[group];
  if (!responsibilities) return null;

  const stats = ctx?.seasons?.[group]?.[seasonKey(row)];
  const components = {};
  for (const [name, metrics] of Object.entries(responsibilities)) {
    const values = metrics.map((metric) => defensiveMetricZ(row, group, metric, ctx, stats));
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    // Back onto 0..1 for the engine and the draft explanation, on the FIXED
    // axis span rather than the group's stretched one - see AXIS_SPAN.
    components[name] = ratingFromZ(mean, AXIS_SPAN);
  }
  return { group, components };
}

function rateDefensiveUnit(row, ctx) {
  const group = canonicalGroup(row);
  const stats = ctx?.seasons?.[group]?.[seasonKey(row)];
  if (!DEFENSIVE_RESPONSIBILITIES[group] || !stats) return 0.5;

  const rated = ratingFromZ(defensiveZ(row, ctx, group, stats), ctx?.spans?.[group]);
  const trust = n(row.games) >= MIN_RATED_GAMES ? 1 : Math.max(0, n(row.games)) / MIN_RATED_GAMES;
  const withSample = 0.5 + (rated - 0.5) * trust;
  return bounded(0.5 + (withSample - 0.5) * depthFactor(row.depth));
}

/**
 * Groups whose DEPTH SAYS NOTHING ABOUT THEIR QUALITY.
 *
 * depthFactor exists because a two-man linebacker corps really is thinner than
 * a five-man one - more men means more of the job covered, and more games
 * behind the average. Neither is true of a kicking unit. A team has ONE
 * kicker; that is a complete special teams, not a thin one, and his field-goal
 * percentage over a season is a perfectly good sample from one man.
 *
 * This was hidden until the punter was taken out of the unit. `P` was in the
 * membership filter, so 656 of 830 kicking units came out exactly two deep -
 * a kicker and a punter - and the punter was quietly paying the depth
 * penalty's rent. Remove him and every kicking unit correctly becomes one
 * deep, at which point the penalty it should never have been paying is
 * suddenly visible as a 6% cut to every kicker in the game.
 *
 * OL is here for a reason this file already accepted: there are no named
 * linemen in the source at all, so its depth is hardcoded to 5 in the build.
 * Naming the exemption is better than encoding it as a magic number in the
 * data, and it is why ST could not simply be pinned to 1 the same way - that
 * would state a fact about the roster in the one place a reader looks for
 * facts about the season.
 */
const DEPTH_IS_NOT_QUALITY = new Set(["ST", "OL"]);

export function rateUnit(row, ctx) {
  const group = canonicalGroup(row);
  if (DEFENSIVE_GROUPS.has(group)) return rateDefensiveUnit(row, ctx);
  const composite = NON_DEFENSIVE_UNIT_COMPOSITES[group];
  if (!composite) return 0.5;
  const rated = ratingFromZ(rawZ(row, ctx, group), ctx?.spans?.[group]);
  const trust = n(row.games) >= MIN_RATED_GAMES ? 1 : Math.max(0, n(row.games)) / MIN_RATED_GAMES;
  const withSample = 0.5 + (rated - 0.5) * trust;
  const depth = DEPTH_IS_NOT_QUALITY.has(group) ? 1 : depthFactor(row.depth);
  return bounded(0.5 + (withSample - 0.5) * depth);
}

/**
 * THE FOUR THINGS A DEFENCE DOES, and the slots that answer for each.
 *
 * A defence used to reach the simulation as ONE number: the flat mean of the
 * four drafted unit ratings (see sideRating in engine.js). That is enough to
 * say a defence is good and not enough to say what it is good AT, so every
 * matchup in the game was the same matchup. A drafted pass rush and a drafted
 * secondary were interchangeable: swapping an elite front for an elite
 * secondary changed nothing about how the opponent's offence played, only how
 * much of it happened.
 *
 * The engine now matches offence against defence one axis at a time, so the
 * pick you spent is felt where you spent it - a front that gets home shows up
 * as sacks and stalled drives, a secondary that covers shows up as fewer
 * explosive plays and more takeaways.
 *
 * WEIGHTS ARE AUTHORED, and say so. There is no measurement in this dataset
 * that can settle how much of a team's pass rush is its linebackers, so these
 * are a football reading rather than a solved result - the same status as
 * OFFENSE_WEIGHTS in constants.js. What they must not be is FLAT: a flat set
 * would rebuild the single generic rating this exists to replace. Each axis
 * sums to 1 so an all-average defence rates 0.5 on every axis, which is what
 * keeps EDGE_BASELINE meaningful.
 */
export const DEFENSIVE_AXES = ["passRush", "coverage", "runStop", "takeaways"];

export const DEFENSIVE_AXIS_WEIGHTS = {
  // Linemen rush the passer; a 3-4 outside linebacker does too, which is why
  // LB carries a real share rather than a token one.
  passRush: { DL: 0.58, LB: 0.27, S: 0.08, CB: 0.07 },
  // Corners first, safeties close behind, linebackers for what is thrown
  // underneath. The line's share is not zero because pressure IS coverage help.
  coverage: { CB: 0.40, S: 0.33, LB: 0.20, DL: 0.07 },
  // The front seven, with the secondary as the last line.
  runStop: { DL: 0.40, LB: 0.38, S: 0.15, CB: 0.07 },
  // Takeaways are the most evenly shared of the four: anyone can strip a ball,
  // and interceptions come from coverage and pressure together.
  takeaways: { CB: 0.32, S: 0.30, LB: 0.23, DL: 0.15 },
};

/**
 * One unit's strength on one axis, on the same 0..1 scale as its overall
 * rating - same sample trust, same depth factor, same clamp - so an axis and a
 * rating can be compared and averaged without one of them being on a different
 * scale.
 *
 * A unit with no responsibility on this axis falls back to its OVERALL rating
 * rather than to 0.5. A defensive line has no coverage responsibility in the
 * table above, but a great line is not an average coverage unit: it makes the
 * throw harder, and the fallback is the honest way to say that with the data
 * available. Falling back to 0.5 would have made half of every axis a constant.
 */
export function defensiveUnitAxis(entry, axis, ctx) {
  if (!entry) return 0;
  if (!isUnit(entry)) return ratePlayer(entry, ctx);
  const detail = defensiveUnitComponents(entry, ctx);
  const raw = detail?.components?.[axis];
  if (raw == null) return rateUnit(entry, ctx);
  const trust = n(entry.games) >= MIN_RATED_GAMES ? 1 : Math.max(0, n(entry.games)) / MIN_RATED_GAMES;
  const withSample = 0.5 + (raw - 0.5) * trust;
  return bounded(0.5 + (withSample - 0.5) * depthFactor(entry.depth));
}

/**
 * A whole roster's strength on one axis.
 *
 * Quick Play drafts ONE `DEF` unit standing in for all four slots, exactly as
 * sideRating resolves it, so the same pick answers every axis there. That is
 * the roster shape being honest about itself rather than a special case: one
 * pick really is the whole defence in that mode.
 *
 * An unfilled slot rates REPLACEMENT_LEVEL rather than 0.5. An average
 * stand-in for a pick nobody made is the silent-failure pattern CLAUDE.md
 * names: it makes skipping a defensive pick free.
 *
 * Forfeits are NOT charged here. They used to be, on top of the same charge in
 * sideRating, which is what made a forfeited defensive slot cost about 1.75x
 * what a forfeited offensive one did - 13 to 15 win points against 5. The
 * whole charge is now one flat team-level deduction; see FORFEIT_RATING_COST.
 */
export function defensiveAxisStrength(roster, axis, ctx) {
  const weights = DEFENSIVE_AXIS_WEIGHTS[axis];
  if (!weights) return 0.5;
  let total = 0;
  for (const [slot, weight] of Object.entries(weights)) {
    const entry = roster?.[slot] ?? roster?.DEF;
    const rated = entry ? defensiveUnitAxis(entry, axis, ctx) : REPLACEMENT_LEVEL;
    total += weight * rated;
  }
  return total;
}

export function rateEntry(entry, ctx) {
  if (!entry) return 0;
  return isUnit(entry) ? rateUnit(entry, ctx) : ratePlayer(entry, ctx);
}

/**
 * The 0-99 Overall the draft board shows.
 *
 * DISPLAY ONLY - nothing in the simulation reads this. The engine needs a
 * 0.5-centred 0..1 rating (see ratingFromZ) and a player needs a number he
 * already knows how to read, and those are different jobs. Deriving both from
 * the same z-score is what keeps them from disagreeing: a man who rates higher
 * always shows higher.
 *
 * Trust and role are applied here as they are to the rating, so a backup with
 * one glorious afternoon does not read 99. They are applied in Z SPACE - the
 * discount is on how far above his league he stood - because applying them to
 * the 0-99 number instead would drag a below-average player UP toward 70.
 */
export function overallFor(entry, ctx) {
  if (!entry) return 40;
  const group = ratingGroup(entry);
  if (!group) return 70;

  let z = rawZ(entry, ctx, group);
  const games = Math.max(0, n(entry.games));
  z *= Math.min(1, games / MIN_RATED_GAMES);

  if (isUnit(entry)) {
    if (!DEPTH_IS_NOT_QUALITY.has(group)) z *= depthFactor(entry.depth);
  } else {
    z *= roleConfidence(entry, group);
  }
  return overallFromZ(z, ctx?.spans?.[group]);
}
