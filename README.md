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
| Quick Play - Learn Stats | Bot | 5 (PG/SG/SF/PF/C) | Whole squad and stats shown, no clock |
| Ranked Practice | Bot | 10 (5 starters + 5 bench) | Type from memory, no stats, pick clock, then rotation + gamestyle |
| Ranked | Real opponent | 10 (5 starters + 5 bench) | Ranked rules, counts toward your record |

Bot games never affect your rank; your profile still counts every game played.

### Rosters and depth

The five starters are position-locked. The five bench spots are not — draft
whoever you want, and each bench player is assigned to whichever position he
can play that most needs the help, least flexible players placed first. That
makes a player listed at two positions genuinely more valuable than a
specialist, because he plugs whichever gap you actually have.

Depth is not cosmetic. Each position carries 48 minutes, split between
whoever covers it. Leave a position with only its starter and he has to play
the whole game — past 40 minutes he tires and gives production back. With
identical starters, a bench covering all five positions beats a bench of five
centers about 79% of the time.

After the draft you set the rotation (sliders, coupled so each position
always totals its 48) and pick one of three randomly offered gamestyles.

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

Two further levers are solved the same way, by
`tools/calibrate-variance.mjs`: how much of a roster's talent advantage
reaches the scoreboard, and how much a team's output swings quarter to
quarter. Together they set how often the better roster actually wins — about
77% of games against a clearly weaker one. Re-run it after any engine change,
then re-run the gamestyle calibration, since gamestyles are balanced against
whatever those two produce.

Current spread across the full 10x9 field: **47.3%-52.4%**.

## Era brackets

Every mode can be played over all of history or narrowed to one stretch of it,
which turns the same draft into a different knowledge test:

| Bracket | Decades | Squads |
| --- | --- | --- |
| All Years | 1960s-2020s | 154 |
| Grandpa's Game | 1960s-1980s | 36 |
| Unc Status | 1990s-2000s | 58 |
| Modern Ball | 2010s-2020s | 60 |

Brackets are defined once in `js/constants.js` (`ERAS`) and applied by
filtering the pool handed to `DraftState`, so nothing downstream needs to know
an era exists. Each bracket keeps its own record in `profiles.era_records`,
since knowing the 2010s is a different skill from knowing the 1970s.

## Who's online

The header ticker counts browsers that have sent a heartbeat in the last 75
seconds (`js/presence.js` + `heartbeat_presence()`). It is a table and one
SECURITY DEFINER function rather than a Realtime presence channel, so the
count survives reconnects and no client needs a websocket to render a number.
Signed-out visitors count too, so the key is a per-browser id, not a user id.

## Data

`js/data.js` is generated, not hand-edited. See `tools/README.md` for importing
real per-game statistics from Basketball Reference CSV exports:

```
node tools/build-data-from-csv.mjs   # regenerate js/data.js
node tools/verify-data.mjs           # sanity-check any dataset
```

## Verifying a build

```
npm install
npm run verify
```

Two legs: engine parity (does the online Edge Function simulate the same game
as the offline client?) and a real Chromium driving a real match end to end,
measuring paint and frame timings and watching the console. Exits 0/1 and
writes `verify-report.json` for CI. See `scripts/README.md` for what each check
covers, how to run a real online match, and the current results.

The `simulate-match` Edge Function carries its own copies of `engine.js`,
`constants.js` and `tactics.js`. They now live in this repo under
`supabase/functions/simulate-match/`, vendored exactly as deployed, so the
parity check has something to diff against. **Re-vendor them whenever the
function is redeployed**, or the check is comparing against a stale copy.

## Deployment

GitHub Pages serves this repo's root from `main` directly — no build or
workflow step. Pushing to `main` updates the live site.
