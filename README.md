# Ball Knowledge

An NBA draft-battle game. Each round rolls a shared team-and-decade squad
(e.g. "Chicago Bulls 1990s"); both sides draft from that same squad into open
roster slots, then the finished rosters play a simulated game.

The point of the game is recall: under ranked rules there is no visible player
list, so you type a name from memory and a fuzzy search resolves it. The
post-game recap explains *why* a result happened rather than only reporting the
score, because a result you can't explain teaches you nothing about your draft.

## Modes

| Mode | Opponent | Roster | Rules |
| --- | --- | --- | --- |
| Quick Play | Bot | 5 (PG/SG/SF/PF/C) | Whole squad and stats shown, no clock |
| Ranked Practice | Bot | 6 (+ 6th man) | Type from memory, no stats, pick clock, then rotation + gamestyle |
| Ranked | Real opponent | 6 (+ 6th man) | Ranked rules, counts toward your record |

Bot games never affect your rank; your profile still counts every game played.

## Running it

A static site with no build step — the browser loads ES modules directly.
Serve the repo root over HTTP (opening `index.html` from disk won't work, since
modules require a real origin):

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

`@supabase/supabase-js` loads from a CDN via the import map in `index.html`, so
`npm install` is only needed for the tooling in `tools/`.

## Layout

```
index.html        markup + import map; loads js/main.js
css/style.css     all styling
js/
  main.js         app controller: wires state, engine, and DOM together
  engine.js       simulation (quarter-by-quarter positional matchups)
  draft.js        draft mechanics, squad rolling, typed-name search, bot picks
  data.js         player dataset (team + decade squads) - generated
  tactics.js      the 10 gamestyles and their stat modifiers
  recap.js        post-game narrative and game-script summary
  shooting.js     derives FG/3PT/FT splits from simulated point totals
  badges.js       tiered achievements
  banners.js      earnable team banners
  profile.js      profile/record persistence
  online.js       Supabase-backed online play
  ui.js           rendering helpers
  constants.js    tunable simulation constants
tools/            data import and balance-calibration scripts (Node)
```

## Balance

Gamestyle multipliers aren't hand-picked. Each style's identity stats are
authored by hand, then its `pts` multiplier is *solved* by simulation so that no
style is simply strongest — otherwise ranked would measure menu choice instead
of basketball knowledge. Re-run after changing any style:

```
node tools/calibrate-gamestyles.mjs
```

Current spread across the full 10x9 field: **48.8%-52.6%**.

## Data

`js/data.js` is generated, not hand-edited. See `tools/README.md` for importing
real per-game statistics from Basketball Reference CSV exports:

```
node tools/build-data-from-csv.mjs   # regenerate js/data.js
node tools/verify-data.mjs           # sanity-check any dataset
```

## Deployment

GitHub Pages serves this repo's root from `main` directly — no build or
workflow step. Pushing to `main` updates the live site.
