# BallKnowledge Data Versioning and Season Conventions

## Purpose

This document defines how seasons, source data, simulation inputs, and historical match reproducibility must work across every sport in BallKnowledge.

## Canonical season rules

### NBA

- The stored season value is the starting calendar year.
- `2025` means the 2025-2026 NBA season.
- `2024` means the 2024-2025 NBA season.
- User-facing labels should display the full range, for example `2025-26`.
- Database queries, imports, and simulation code must use the canonical integer start year.
- Never mix a display label such as `2025-26` with the stored canonical value `2025`.

### NFL

- The stored season value is the league season year.
- `2025` means the 2025 NFL season, including its postseason even when playoff games occur in calendar year 2026.
- User-facing labels should display `2025` unless a specific screen requires a fuller description.

### Future sports

Every new sport must define its canonical season identifier before production data is imported. The canonical identifier must be stable, sortable, and independent from the display label.

## Data versioning

Every production data release must have a unique immutable `data_version`.

Recommended format:

`<sport>-<season>-<source>-<revision>`

Examples:

- `nba-2025-ballknowledge-r1`
- `nfl-2025-nflverse-r1`
- `nfl-2025-nflverse-r2`

A revision changes whenever source data, cleaning rules, player mappings, ratings, or simulation inputs change.

## Match reproducibility

Every ranked match must record:

- sport
- canonical season
- data version
- simulation engine version
- strategy rules version
- RNG seed or reproducibility token
- roster snapshot
- final validated inputs

Historical matches must remain explainable after a new season or revised dataset is released. A completed match must never silently start referencing newer player ratings.

## Import stages

All sports data must move through these stages:

1. `raw` - untouched source files and source metadata
2. `validated` - schema, required fields, duplicates, ranges, and identifiers checked
3. `normalized` - converted to BallKnowledge canonical fields
4. `rated` - simulation attributes generated
5. `staging` - loaded into a non-production dataset for QA
6. `approved` - data-quality report reviewed
7. `production` - promoted as a versioned immutable release
8. `archived` - prior production versions retained for reproducibility

## Required source metadata

Each import must retain:

- source organization
- source repository or release
- source asset name
- source release/tag/version
- retrieval timestamp
- file checksum
- license and attribution requirements
- transformation code version

## Display and code rules

- Display labels are presentation only.
- Simulation and database code must use canonical season values.
- No sport-specific season assumptions belong in shared utilities without an explicit sport adapter.
- A shared `formatSeasonLabel(sport, season)` function should own display formatting.
- Imports must fail when a season value cannot be interpreted unambiguously.
