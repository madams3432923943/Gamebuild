# Ball Knowledge

NBA draft-battle game. Static site, no build step — the browser loads ES modules
directly. Serve the root over HTTP (`python3 -m http.server 8000`); opening
`index.html` from disk won't work.

## Rules that bite

- **Engine parity.** `js/sports/nba/`'s `engine.js`, `constants.js` and `tactics.js` are
  vendored into `supabase/functions/simulate-match/`. Change one, copy it across,
  or online games diverge from offline ones. `npm run verify:parity` checks this.
- **Balance is solved, not picked.** Gamestyle `pts` mods, `TALENT_PARITY` and the
  quarter-variance range come from `tools/calibrate-*.mjs`. Re-run after any engine
  or gamestyle change, variance first, then gamestyles.
- **`data/` is data, not code — don't read or search it.** `data/nba-players.js` is
  2,542 generated rows (516 KB). Open it only when changing gameplay or the
  simulation and you actually need a player's numbers; never while writing app
  code. It's generated from `tools/seasons/*.csv` (not committed), and
  `db/seed/players.json` is generated from it (also not committed). Never
  hand-edit any of the three — see `tools/README.md`.
- **Roster shapes vary by mode** (5 / 6 / 10 slots). Derive slots from the roster,
  never assume a shape.
- **`db/` is documentation, not a migration runner** — write the file, then apply it
  live. Keep the two in step.

## Verify before pushing

```
npm run verify            # parity + build
npm run verify:selftest   # real Chromium: sign-in → draft → sim, layout at 360px
```

## Deployment

GitHub Pages serves the repo root from `main`. Pushing to `main` updates the live
site immediately. The Edge Function deploys separately
(`supabase functions deploy simulate-match`) and migrations are applied by hand, so
a change touching all three lands in stages — make client code tolerate a server
that hasn't caught up yet.

## Style

Comments explain *why*, not what. Match the density of the surrounding file.
