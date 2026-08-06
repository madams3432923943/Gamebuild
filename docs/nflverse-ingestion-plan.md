# NFLverse Ingestion Plan

## Decision

BallKnowledge will consume official nflverse release assets through a controlled import pipeline. It will not copy the full nflverse repository into the frontend and will not treat downloaded source files as production-ready game ratings.

## Preferred upstream sources

Use official nflverse datasets for source facts:

- nflverse players dataset for stable player identity, position, and identifier mapping
- nflverse player summary stats for season and weekly production
- nflverse team summary stats when team/unit context is needed
- nflverse schedules for game and season context
- weekly rosters when team membership by week is required
- play-by-play only when a BallKnowledge rating cannot be responsibly derived from summary data

Prefer Parquet assets where practical because they are compact, typed, and efficient for batch processing. CSV may be retained as a debugging/export format, but should not be the primary production artifact.

## Architecture

```text
Official nflverse release assets
        |
        v
scripts/data/nfl/download
        |
        v
raw manifest + checksums
        |
        v
schema and quality validation
        |
        v
identity and roster normalization
        |
        v
BallKnowledge football feature generation
        |
        v
simulation rating generation
        |
        v
staging tables / versioned staging files
        |
        v
statistical QA and gameplay validation
        |
        v
production data version promotion
```

## Do not ship upstream files directly to browsers

The website should not download complete nflverse datasets. The import process must produce a purpose-built BallKnowledge dataset containing only the fields needed for drafting, display, validation, and simulation.

## Canonical NFL entities

The normalized model should separate:

- player identity
- player-season
- player-team-season membership
- position and position group
- offense, defense, and kicking statistics
- team-season context
- BallKnowledge simulation ratings
- source and data version

Stable IDs should be used internally whenever available. Player names must not be the sole join key.

## Rating rules

Raw NFL statistics are evidence, not final game ratings. Rating generation must:

- account for position-specific responsibilities
- avoid comparing unlike positions with one universal formula
- account for opportunity and playing time
- distinguish regular-season, postseason, weekly, and combined summaries
- document every transformation
- produce bounded and testable ratings
- preserve source features used to generate each rating

## Update cadence

During the NFL season:

- ingest source updates into staging on a controlled cadence
- run quality checks before promotion
- do not silently change ratings used by active or completed ranked matches
- promote a new immutable revision only after validation

During the offseason:

- process player identity, roster, draft, and team changes
- create a new season version without overwriting the prior season

## Validation requirements

An NFL import must fail when it finds:

- duplicate canonical player-season keys
- missing required player IDs beyond an approved threshold
- invalid or unknown positions
- impossible stat ranges
- team codes that cannot be normalized
- conflicting team membership without an explicit multi-team rule
- unexpected schema changes
- a source checksum that differs without a new import revision

## Data-quality report

Every candidate version should report:

- source release information
- row counts by dataset and season
- unique player counts
- missing-ID rates
- duplicate counts
- position distribution
- team distribution
- null rates for required fields
- rating distributions by position
- largest changes from the prior approved version
- validation failures and approved exceptions

## Production promotion

Promotion must be explicit. The approved version should be recorded in a small manifest containing:

- sport
- season
- data version
- source versions
- generated timestamp
- checksums
- rating-model version
- schema version
- approval status

## Immediate repository work

1. Inventory the nflverse files already pulled by Claude.
2. Identify which official release assets they came from.
3. Remove or archive unnecessary copies only after confirming no code depends on them.
4. Add downloader, validator, normalizer, and report scripts.
5. Create a staging schema or versioned staging output.
6. Build position-specific simulation-rating adapters.
7. Add reproducibility and regression tests.
