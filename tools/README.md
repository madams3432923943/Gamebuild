# Importing real player data

`js/data.js` is generated, not hand-edited. This directory converts
authoritative per-season CSVs into it.

**The CSVs are not committed.** They are 3.4 MB of build input that nothing
reads at runtime, and carrying them made every repo-wide search slower for no
benefit (see `.gitignore`). Download them into `tools/seasons/` when you
actually need to regenerate the dataset - which is rare, and the instructions
below are the whole job.

## What to download

**Basketball Reference per-season "Per Game" tables.** They already contain
every column this game needs, which is why they're the recommended source.

For each season from `1979-80` onward:

1. Go to `https://www.basketball-reference.com/leagues/NBA_1997_per_game.html`
   (change the year: `NBA_1997` is the 1996-97 season)
2. Scroll to the "Per Game Stats" table
3. Click **Share & Export -> Get table as CSV**
4. Save as `seasons/NBA_1997.csv` in this directory

Start at `NBA_1980` (the 1979-80 season, when the three-point line arrived).
Through 2025 that's ~46 files. Tedious but one-time, and it makes every
number in the game real.

**Faster alternatives**, if you'd rather not click 46 times:
- Kaggle has consolidated "NBA player season stats" datasets covering every
  year in a single CSV. Any of them work as long as the columns below exist.
- The `nba_api` Python package can pull the same data programmatically:
  `LeagueDashPlayerStats(season='1996-97', per_mode_detailed='PerGame')`.

## Columns this script needs

Basketball Reference's default export already has all of these:

`Player, Pos, Tm, G, FG, FGA, FG%, 3P, 3PA, 3P%, FT, FTA, FT%, TRB, AST, STL, BLK, TOV, PTS`

A `Season` column is used if present; otherwise the season is taken from the
filename (`NBA_1997.csv` -> 1996-97 -> the 1990s).

## Running it

    node tools/build-data-from-csv.mjs

Writes `js/data.js`. Run `node tools/verify-data.mjs` afterward.

## Getting a new dataset onto the server

The client reads `js/data.js`; the online simulation reads the server's
`players` table, and `scripts/verify-parity.mjs` checks the two agree. To push
a regenerated dataset to the server:

    node tools/export-players-json.mjs   # writes db/seed/players.json

That file is gitignored (it is a second copy of data.js), but the seeding
migration fetches it over HTTP rather than inlining 2,542 INSERTs - so it has
to be committed and pushed just long enough for the migration to read it, then
removed again. See `db/README.md`.

## What it handles

- **Traded players.** Basketball Reference emits a `TOT` row plus one row per
  team for anyone traded mid-season. `TOT` rows are dropped, so a player's
  stats land with the team they actually played for.
- **Team abbreviations to era-accurate names.** `WSB` becomes "Washington
  Bullets" in the 80s and 90s; `WAS` becomes "Washington Wizards" from 2000.
  Same for Nets, Grizzlies, Hornets/Bobcats, and Sonics/Thunder.
- **Averaging across seasons.** A player's rows for one team within one decade
  are combined into a single record, weighted by games played, so a player who
  spent six years somewhere isn't represented by one outlier season.
- **Missing three-point data.** A blank `3P%` means no attempts, which is
  written as `tpa: 0, tpp: 0` - the guarantee the shot-split model relies on.
