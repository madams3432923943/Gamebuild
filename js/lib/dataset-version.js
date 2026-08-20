// One string that says which dataset a game was played on.
//
// WHY THIS EXISTS
//
// The pool lives in two places and always will. Offline play has to work with
// no network, so the browser needs data/*.js on disk; the Edge Function cannot
// read repo files, so it needs the same rows in Postgres. Two physical copies
// are structural. What is NOT structural is that they were allowed to DIFFER
// with nothing saying so.
//
// Every rating in both engines is a percentile against the pool it was computed
// from. Add rows to one copy and not the other and the same roster rates
// differently on each side - the draft grade the client shows and the score the
// server returns are then ranked against two distributions. Nothing throws. The
// box score adds up. That is the failure mode: a plausible wrong answer.
//
// supabase/functions/simulate-match/index.ts already stamps this string onto
// every finished match (match_results.dataset_version), and it is what exposed
// the truncated-pool bug - real results carried `nfl-generated-1000-2024`, where
// 1000 was a row count that should have been five figures. Nothing computed the
// client's side of it, so nothing could compare. This is that side.
//
// WHAT IT DOES AND DOES NOT CATCH
//
// Row count and newest season. That catches the drift that actually happens -
// a dataset rebuilt with more rows, a seed that never ran, a pool truncated by
// a page limit - and it is cheap enough to compute on every result and to ask
// a live table for over one HTTP request. It does NOT catch an edit that
// changes a value while leaving the shape alone. That is deliberate, not an
// oversight: catching it needs a content hash agreeing byte for byte across
// Postgres numerics and JS numbers, and the field-by-field comparison in
// scripts/verify-parity.mjs already does that job where it can afford to.
//
// THE FORMAT IS A WIRE FORMAT. It is stored against finished matches and
// compared against strings the server produced months ago. Changing the shape
// here without changing sports/index.ts in the Edge Function makes every past
// result look like drift; scripts/verify-dataset-published.mjs asserts the two
// still agree.

/** Newest season in a pool. Mirrors maxSeason() in the Edge Function's
 * sports/index.ts, including its "legacy" fallback for rows that predate the
 * per-season datasets and carry no season at all. */
export function maxSeason(rows) {
  let max = 0;
  for (const row of rows || []) {
    // NFL rows reach the server wrapped - the generated object sits in
    // `payload` and the column beside it is a denormalised copy. Either shape
    // answers here, so one helper serves the client's plain rows and the
    // server's table rows alike.
    const season = Number(row?.payload?.season ?? row?.season ?? 0);
    if (season > max) max = season;
  }
  return max || "legacy";
}

/** `nba-players-10290-2025`. The prefix is the sport's, so a basketball
 * fingerprint can never compare equal to a football one. */
export function datasetVersion(prefix, rows) {
  return `${prefix}-${(rows || []).length}-${maxSeason(rows)}`;
}
