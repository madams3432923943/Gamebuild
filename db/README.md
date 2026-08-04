# Database changes

SQL applied to the Supabase project, kept here as a record of what changed and
why. Files are named `<date>_<nn>_<name>.sql` and are applied in that order.

**This is documentation, not a migration runner.** It deliberately does *not*
live in `supabase/`: that path makes Supabase's GitHub integration treat the
repo as a full project and try to build preview databases from it, which cannot
work here — this project's schema was applied live from the start, so the files
below are a partial history rather than a complete one. A preview database
built from them alone would come up missing `profiles`, `matches`, `players`
and everything else.

To apply a new change: write the file here, then run it against the project
(Supabase SQL editor, CLI, or MCP). Keep the two in step — a file here that was
never applied, or a change applied without a file, is worse than neither.

If the schema ever needs to become fully reproducible, the way there is to dump
the live database as a baseline migration, move this directory back under
`supabase/`, add `supabase/config.toml`, and rename every file to the
14-digit `YYYYMMDDHHMMSS_name.sql` form the CLI expects.

## Re-seeding the `players` table

`20260730_01_players_sync_real_dataset.sql` replaces every row from
`db/seed/players.json`, fetched over HTTP rather than inlined as 2,542 INSERTs.

That JSON is **generated, not committed** — it is a byte-for-byte second copy of
`data/nba-players.js`, and keeping both in the repo meant 500 KB of duplication and two
things that could disagree. Regenerate it only when re-seeding:

    node tools/verify-data.mjs          # sanity-check the dataset first
    node tools/export-players-json.mjs  # writes db/seed/players.json

Then commit and push it (it is gitignored, so this needs `git add -f`), run a
fetch-and-replace block pointed at **that commit's** raw URL, and delete the
file again.

Note the URL inside the applied migration points at a long-dead working branch.
It is left as the historical record of what was actually run; a re-run needs a
fresh URL against a commit that currently exists. Pin it to a commit SHA rather
than a branch name — a branch URL is a moving target, which is exactly how that
one went stale.
