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
