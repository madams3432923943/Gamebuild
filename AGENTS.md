# DraftNova Engineering Rules

These rules apply to every human or AI agent working in this repository.

## Branch and deployment safety

- Never commit directly to `main`.
- Use one branch per workstream and open a pull request.
- Do not merge until required verification commands pass.
- Database changes must exist as versioned SQL migrations in `db/migrations/`.
- Deployed Supabase Edge Functions must match the repository version.
- Never expose the Supabase service-role key in browser code.

## Ownership and concurrent agents

- Before editing, identify which files another agent is changing.
- Two agents must not modify the same feature or migration simultaneously.
- Claude-owned and ChatGPT-owned work should use separate branches.
- Rebase or merge `main` before final verification if another branch lands first.

## Global versus sport-specific changes

A change is global only when its behavior is identical for every sport.

Global examples:
- Authentication
- Profiles and friends
- Navigation shell
- Match lifecycle interfaces
- Generic rank presentation
- Shared data-version metadata

Sport-specific examples:
- Roster slots
- Eligibility rules
- Simulation formulas
- Tactics and strategy validation
- Era definitions
- Player statistics and ratings
- Box scores and recap language

Never add an NBA-shaped field or rule to a shared interface unless every future sport can use it without translation.

## Competitive integrity

- Ranked results must be calculated in a trusted server environment.
- The browser may request actions but may not declare match results, ratings, records, forfeits, or rewards.
- Every ranked result must retain a simulation seed, engine version, dataset version, and rules version.
- Result insertion, match completion, and rating/profile updates must commit atomically and idempotently.
- Strategy payloads must be validated server-side.

## Simulation changes

Any change to simulation behavior requires:

1. Client/server parity verification.
2. Exact seeded replay verification.
3. Side-symmetry testing.
4. Statistical win-rate testing over thousands of games.
5. Forfeit-penalty testing.
6. Strategy-effect testing.
7. A documented reason for every balance constant changed.

Do not tune a constant based on one game or a small anecdotal sample.

## Sports data

- Raw source data is immutable input.
- Every import must produce a manifest containing source URLs, checksums, retrieval time, seasons, and transformation version.
- Validation must run before ratings are generated.
- Generated data must be staged and tested before promotion.
- Never silently overwrite a production dataset.
- Completed ranked matches must continue referencing the data version they used.

## Season conventions

- NBA season key `2025` means the 2025–26 season.
- NFL season key `2025` means the 2025 NFL season.
- Store canonical numeric keys and format display labels at the UI boundary.

## Definition of done

A change is not complete until:

- Code is committed on a branch.
- Tests pass.
- Security implications are reviewed.
- Database changes are represented by migrations.
- Documentation is updated when behavior or architecture changes.
- The pull request explains deployment and rollback steps.
