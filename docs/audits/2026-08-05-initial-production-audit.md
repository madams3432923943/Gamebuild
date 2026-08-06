# BallKnowledge Initial Production Audit

Date: 2026-08-05
Scope: GitHub `main` and live Supabase project, read-only review
Status: Findings only; no production database or live-site changes applied

## Executive summary

BallKnowledge has a stronger foundation than a typical prototype: ranked results are simulated in a JWT-protected Supabase Edge Function, key draft actions validate the authenticated participant, RLS is enabled on exposed tables, sport-specific client modules exist, and the repository contains verification and calibration scripts.

The main launch risks are not that the whole app is client-trusted. They are narrower and fixable:

1. Ranked result finalization is not atomic.
2. Simulation randomness is not seeded or reproducible.
3. The public `matches_public` view bypasses the intended participant-only match policy.
4. Strategy payloads are stored without server-side structural validation.
5. Dataset, engine, and rules versions are not stored with completed matches.
6. NFL is client-live while the server sport registry supports NBA only.
7. NFL source ingestion lacks an immutable manifest and checksums.
8. Profile ownership policies still allow users to edit several achievement and history fields directly.

## P0 findings

### P0-1: Match finalization is not atomic

The `simulate-match` Edge Function performs these operations as separate network/database writes:

1. Insert `match_results`.
2. Mark `matches` complete and set the winner.
3. Read both profiles.
4. Update player A's profile.
5. Update player B's profile.

A crash or failed write after step 1 can leave a stored result with incomplete match/profile state. A retry returns the existing result immediately and does not repair skipped profile or rating updates.

Two simultaneous callers can also both pass the initial `match_results` existence check and simulate independently. The primary key prevents two result rows, but the losing caller receives a storage error rather than the canonical result.

Required remediation:

- Move finalization into one database transaction exposed through a tightly scoped server-only function.
- Lock the match row before claiming simulation ownership.
- Introduce an explicit processing/finalization state or compare-and-set claim.
- Make retries reconcile all derived state, not merely return the result row.
- Record a unique outcome event and make profile/rating updates idempotent against that event.

### P0-2: Ranked simulations cannot be reproduced

The NBA engine calls `Math.random()` directly for player variance, team quarter variance, overtime, and other random selections. Completed results do not store a seed.

Required remediation:

- Inject a deterministic PRNG into every random engine path.
- Generate the seed server-side after both strategies are locked.
- Store the seed, engine version, rules version, and dataset version with the result.
- Add a replay verifier that regenerates the result from the stored inputs and seed.

### P0-3: `matches_public` bypasses participant-only match access

The underlying `matches` table has a participant-only SELECT policy. `matches_public` is owned by `postgres`, is not configured as `security_invoker`, and is selectable by both `anon` and `authenticated`.

The view exposes every match's IDs, both user IDs, status, round, current team/decade, used squads, winner, timestamps, friendly flag, sport, and era.

Required remediation:

- Decide whether a genuinely public match directory is required.
- If not required, revoke access and remove the view.
- If required, recreate it with `security_invoker = true` and a deliberate RLS-compatible policy, or expose a narrower safe function/view containing only approved public fields.

### P0-4: Strategy payloads lack authoritative validation

`submit_strategy` verifies the caller's side and match status, but directly stores rotation, matchups, and tactic values. The Edge Function then trusts those stored values and passes them to the engine.

Required validation includes:

- Tactic is one of the sport's offered/allowed tactics for that match.
- Rotation contains exactly the roster's valid slots.
- Every minute value is an integer/finite number within slot limits.
- Total NBA minutes equal 240.
- Matchup keys and targets belong to the correct rosters.
- Matchups obey the intended one-to-one/permutation rules.
- Payload size and nesting are bounded.
- Validation dispatches through the selected sport contract.

## P1 security and integrity findings

### P1-1: Anonymous RPC execution is unnecessarily broad

Many authenticated gameplay and social `SECURITY DEFINER` functions are executable by `anon`. Most audited functions correctly reject a missing `auth.uid()`, so this is not equivalent to unauthenticated control. It is still unnecessary exposure and increases audit surface.

Required remediation:

- Revoke EXECUTE from `PUBLIC` and `anon` for authenticated actions.
- Grant only the exact signatures required to `authenticated`.
- Keep trigger/internal helper functions non-executable by client roles.
- Add explicit `search_path` settings to privileged functions.

### P1-2: Broad table grants rely entirely on RLS

`anon` and `authenticated` have broad table-level privileges on several tables, including profiles, matches, match picks, match results, and invite codes. Current RLS blocks many direct operations, but least-privilege grants should match actual usage.

Required remediation:

- Revoke unused INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES privileges.
- Grant only SELECT where direct client reads are intentional.
- Route competitive writes through validated RPCs or trusted server code.

### P1-3: Profile fields remain directly user-editable

The profile UPDATE policy allows a user to update their own row. Triggers protect `online_wins`, `online_losses`, and `sport_ratings`, but fields such as personal bests, draft counts, history, career totals, banners, badges, era records, and record-game JSON remain in the same user-owned update surface.

Some fields intentionally support offline/practice progress, but ranked-derived and cosmetic unlock state should not be client-authoritative.

Required remediation:

- Separate user-editable profile preferences from server-derived progression.
- Move ranked/career events to normalized append-only tables.
- Derive aggregates or update them through trusted functions.
- At minimum, add column-specific protections and distinguish offline from online records.

### P1-4: Profile update errors are ignored

`applyMatchOutcome` awaits a profile update but does not inspect or throw on the returned Supabase error. A failed update can therefore be treated as success and the function can return a completed response.

Required remediation:

- Check every database response.
- Fail or reconcile atomically rather than silently accepting partial state.

## P2 simulation-validation findings

The NBA engine contains thoughtful calibration comments and existing calibration scripts. However, direct `Math.random()` usage prevents stable tests and production replay.

Required harness:

- Seeded deterministic RNG.
- Side-swap symmetry tests using identical seeds.
- Forfeit 0/1/2+ pick win-rate deltas.
- Tactic pair matrix with acceptable win-rate bands.
- Rotation sensitivity and invalid-rotation rejection.
- Defensive matchup benefit bounds.
- Era-specific distribution checks.
- Strong-vs-weak roster expected win-rate ranges.
- Score, overtime, quarter-margin, and stat distribution checks.
- Regression snapshots keyed by engine and dataset versions.

## NFL findings

### NFL-1: Client/server availability mismatch

The client NFL module sets `live: true`, while the deployed server `engineFor()` registry contains only NBA and intentionally returns no engine for NFL. Any online NFL match reaching `simulate-match` returns HTTP 501.

Required remediation:

- Keep NFL offline/practice-only until the server engine is vendored and parity-tested, or set it non-live for online matchmaking.
- Add a capability contract distinguishing UI preview, offline playable, online casual, and ranked-ready.
- Make matchmaking reject unsupported sports server-side before creating a match.

### NFL-2: Source ingestion is not reproducible

`fetch-nfl-seasons.mjs` downloads release assets from the nflverse `player_stats` release and writes raw CSV files locally. It does not record checksums, response metadata, download timestamps, exact source URLs per artifact, or a build manifest. It also treats 404s as missing and continues.

Required remediation:

- Emit a source manifest containing every URL, season, file type, byte size, checksum, retrieval time, and upstream release identifier.
- Fail a production build when a required artifact is missing.
- Allow missing files only in an explicitly marked partial/development mode.
- Archive raw immutable inputs outside the frontend bundle.

### NFL-3: Generated data is bundled into the frontend

The generated NFL player and unit JavaScript files total several megabytes and are imported by the client module. This increases download, parse, memory, and seasonal-update costs.

Required remediation:

- Store normalized/versioned NFL rows in sport-specific database tables or immutable per-sport assets.
- Load only the selected sport, era, team, and season pools needed for a session.
- Cache immutable versions.

### NFL-4: Derived ratings contain documented judgment calls

The builder explicitly derives offensive-line value from sacks allowed and rushing efficiency, defines special teams primarily from kicking data, maps positions into units, and sets participation floors. These can be reasonable design choices, but they are BallKnowledge ratings—not raw nflverse facts.

Required remediation:

- Version every transformation and rating formula.
- Produce a data-quality report by season/team/unit.
- Separate raw statistics from simulation ratings.
- Calibrate derived unit ratings against historical team outcomes before ranked launch.

## Season convention

For NBA, stored season `2025` means the 2025-26 NBA season. UI labels must display `2025-26`, while machine keys may retain the start year `2025`.

For NFL, stored season `2025` means the 2025 NFL season because the league season is conventionally identified by one calendar year.

These conventions must be centralized and tested rather than reimplemented in each screen/importer.

## Recommended implementation order

1. Disable or block unsupported online NFL matchmaking.
2. Replace/restrict `matches_public`.
3. Add strict strategy validation.
4. Introduce result seed/version columns and deterministic RNG.
5. Implement transactional, idempotent match finalization.
6. Tighten RPC and table grants.
7. Separate server-derived profile progression from user-editable preferences.
8. Add the seeded statistical harness.
9. Add NFL source manifests, validation reports, and versioned staging.
10. Only then enable NFL ranked play.

## Change-safety rule

All fixes should be delivered as small migrations and focused pull requests. No broad permission migration should be applied until its exact client call sites and rollback path are documented and tested.