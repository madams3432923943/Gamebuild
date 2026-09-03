// What produced a result: which engine, which dataset, which rules, from which
// seed.
//
// WHY THE OFFLINE SIDE OF THIS EXISTS NOW
//
// match_results has carried four provenance columns since issue #30 -
// engine_version, dataset_version, rules_version, simulation_seed - and
// together they are what makes a finished ONLINE game re-derivable. An offline
// game had none of it, and could not have had: the client engine called bare
// Math.random(), so there was no seed to record and nothing a seed could be
// used for. The same rosters simulated twice differ by about 36% peak-to-peak
// on team score, which is by design (see TEAM_QUARTER_VARIANCE), and it means
// an offline result was a claim nobody could check - including the person who
// produced it.
//
// Now the offline path draws from a seeded stream, so the four strings below
// plus that seed reproduce the game exactly. scripts/verify-replay.mjs does
// that from the command line; the profile stores them alongside the result so
// there is something to replay from months later.
//
// WHY THE VERSION STRINGS ARE LITERALS, AND DUPLICATED
//
// supabase/functions/simulate-match/index.ts computes the same two strings
// from the same literals. That is a duplication, and it is the same one the
// engines themselves live with: the Edge Function cannot import from js/, so
// the alternative is not "share the code", it is "have no client-side
// provenance at all". scripts/verify-result-provenance.mjs asserts the two
// copies still agree, so the duplication is checked rather than trusted -
// which is exactly how the vendored engines are handled.
//
// CHANGING A VERSION IS A DELIBERATE ACT. These strings are compared against
// values the server wrote months ago. Bumping one declares "results before
// this point were produced by a different simulation and are not comparable",
// which is true and useful when an engine really changes, and destroys the
// comparison when done casually. Bump them together with the Edge Function, or
// not at all.

/** Bumped when the simulation itself changes in a way that makes older results
 * non-comparable. Must match index.ts in the Edge Function. */
const ENGINE_STAMP = "engine-2026-08-11.1";

/** Bumped when the RULES around a game change - roster shape, scoring, what a
 * forfeit costs - rather than the engine. Must match index.ts. */
const RULES_STAMP = "rules-2026-08-11.1";

/** `nba-engine-2026-08-11.1`. Per sport, because the two engines are separate
 * programs and a change to one says nothing about the other. */
export const engineVersion = (sportId) => `${sportId}-${ENGINE_STAMP}`;

/** `ranked-rules-2026-08-11.1`. Per mode, because a Quick Play roster and a
 * ranked one are not playing the same game. */
export const rulesVersion = (mode) => `${mode || "ranked"}-${RULES_STAMP}`;

/**
 * A fresh seed for one offline game.
 *
 * Drawn from the real Math.random BEFORE the seeded stream is installed, which
 * is the whole trick: a seed drawn from inside the stream it is about to
 * create would be the same number every time, and every offline game in the
 * app's history would be the identical simulation.
 *
 * 32 bits unsigned because that is what the generator's state is (see
 * js/lib/seeded-rng.js) - a wider seed would be silently truncated, so two
 * results could carry different seeds and be the same game.
 */
export const newSimulationSeed = () => Math.floor(Math.random() * 0x1_0000_0000) >>> 0;

/**
 * The four strings that make a result re-derivable, in the shape the Edge
 * Function returns them so offline and online results are read the same way.
 */
export function provenanceFor({ sportId, mode, seed, datasetVersion }) {
  return {
    engineVersion: engineVersion(sportId),
    rulesVersion: rulesVersion(mode),
    datasetVersion,
    simulationSeed: seed,
  };
}
