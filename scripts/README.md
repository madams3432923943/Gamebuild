# Build verification harness

    npm install          # once - pulls Playwright
    npm run verify       # engine parity + a real browser match

Exits 0 when everything passed or was skipped, 1 on any failure, and writes
`verify-report.json` for CI to assert on.

| Command | What it does |
| --- | --- |
| `npm run verify` | Both legs. Browser leg runs Ranked Practice vs the bot. |
| `npm run verify:parity` | Engine parity only. No browser, no credentials. |
| `npm run verify:online` | Browser leg as a real online ranked match (needs two accounts). |
| `npm run verify:mobile` | Browser leg on an emulated iPhone 13 (touch, mobile UA). |
| `npm run verify:selftest` | Verifies the harness itself against a local server + stubbed backend. |
| `npm run verify:online-selftest` | Two browsers playing a real online match against a local fake backend. |
| `npm run verify:abandon-selftest` | One player leaves mid-draft; the other must be told and able to leave. |

Useful flags: `--no-browser`, `--no-parity`, `--no-network`, `--headed`,
`--device="Pixel 7"`, `--base-url=…`, `--json=…`.

## The two legs

### 1. Engine parity - is the online game the same game as the offline one?

The offline game is simulated by `js/sports/nba/engine.js` in the browser. The online game
is simulated by the `simulate-match` Edge Function, which carries **its own
copy** of `engine.js`, `constants.js` and `tactics.js`. Two copies of a
simulation drift silently, and nothing in the repo was watching them - the Edge
Function source was not even in the repo. It now is, under
`supabase/functions/simulate-match/`, vendored exactly as deployed.

Parity is checked on five independent axes, because any one of them alone can
be green while the two games differ:

| Check | Catches |
| --- | --- |
| `parity:engine-source` | Engine logic drift (comments normalized out) |
| `parity:constants` | A changed `SCORING_K`, `TALENT_PARITY`, … |
| `parity:tactics` | A gamestyle tuned on one side only |
| `parity:box-scores` | Behavioural divergence, diffed field by field |
| `parity:dataset` | `data/nba-players.js` vs the `players` table |

That last one is not about code at all. The client normalizes every matchup
against `computeDatasetStats(PLAYERS)` from `data/nba-players.js`; the Edge Function
normalizes against the same function over the `players` **table**. Identical
engine code fed two different datasets is still two different games.

### On "same seed, 0.1% tolerance"

The brief asked for the same seed fed to both engines. There is no seed to
feed: `engine.js` calls bare `Math.random()` and nothing threads a generator
through it. Measured over 200 runs on one fixed pair of rosters, the same
engine against **itself** spans 89-128 points - about 36% peak to peak. That is
deliberate (`TEAM_QUARTER_VARIANCE`, `TALENT_PARITY` and the per-player
variance exist to make quarters swing), and it means a 0.1% tolerance against
an unseeded engine fails ~100% of the time on identical code.

So the harness makes the run deterministic instead of tolerating the noise: it
swaps `Math.random` for a seeded `mulberry32` stream while both engines run
(`scripts/lib/seeded-rng.mjs`). Both then draw from one stream in the same
order, and any divergence is real. The 0.1% tolerance is still enforced and
reported - but a correct pair of engines diffs at **0.000%**, not "close
enough". The number of random values each engine consumes is compared too: two
engines that agree on the box score while drawing a different count are not
equivalent, they were lucky.

### 2. Browser - does the thing actually work in a browser?

One or two real Chromium contexts driving the real UI. In `--online` mode both
contexts sign in as different accounts and enter matchmaking together, so they
match **each other** and the deployed Edge Function simulates the result.

Measured, not assumed:

- paint timings from the Performance API (FP/FCP/LCP/DCL/load)
- frame times during the matchup intro and the live scoreboard, reported as
  worst-frame and jank counts rather than a mean - a mean of 17ms hides the
  200ms freeze that is the actual complaint
- console errors, uncaught exceptions, failed requests and 5xx responses, for
  the whole run
- layout at 1280 / 768 / 390 / 360 px: flow siblings overlapping, elements
  escaping the viewport, horizontal document overflow
- Profile, Rewards and Squads at desktop and phone widths - including whether
  the tab rendered the app's own "couldn't load" copy, since a tab that draws
  its error message perfectly is still a broken tab

On failure: full-page screenshot, serialized DOM and video per session, under
`verify-artifacts/`. On success the video is deleted rather than left behind.

#### The layout audit is deliberately narrow

An element wider than the viewport is only a defect if nothing contains it.
This app leans on containment on purpose - the football field's markings sit
outside `.game-stage` and are clipped by its `overflow:hidden`, and the box-score
table is *meant* to be wider than a phone and scroll inside `#full-box-score`'s
`overflow-x:auto`. Flagging those reported 162 "failures" on a phone, every one
of them working as designed. The audit now only reports an element whose entire
ancestor chain is `overflow: visible`. Same reasoning for overlap: only flow
siblings are compared, because absolutely positioned and transformed elements
overlap by design throughout.

### Verifying the verifier

`npm run verify:selftest` serves the repo on localhost, swaps the Supabase CDN
module for `scripts/selftest/supabase-stub.js`, and runs the same browser leg.
It exists because a broken selector or a mistimed wait would make `npm run
verify` report a green build it never actually drove. It proves the automation
drives a full ranked draft, all three strategy phases and the animated
simulation to a final score. It proves nothing about the live site, matchmaking
or the Edge Function - only `--online` does that.

## Results

Recorded 2026-07-31 on branch `claude/browser-verification-harness-h7ci3t`.

### Engine parity - PASS

| Check | Result |
| --- | --- |
| Engine source identical | **PASS** - only a duplicated comment block differs |
| Simulation constants (36 compared) | **PASS** - every value identical |
| Gamestyle modifiers (10 gamestyles) | **PASS** |
| Box scores under a shared seed | **PASS** - 0.000% divergence |
| Dataset (`data/nba-players.js` vs `players`) | **PASS** - verified out of band, see below |

Box scores, 4 scenarios covering every roster shape the engine supports:

| Scenario | Client | Edge Function | Fields compared | Max Δ | Verdict |
| --- | --- | --- | --- | --- | --- |
| quick-play-5 | 128-127 | 128-127 | 303 | 0.000% | exact |
| legacy-online-6 | 100-115 | 100-115 | 363 | 0.000% | exact |
| ranked-10 | 115-112 | 115-112 | 603 | 0.000% | exact |
| ranked-10-lopsided | 112-112 | 112-112 | 723 | 0.000% | exact |

1,992 individual values compared - team scores, every player's PTS/REB/AST/
STL/BLK/TOV, every quarter's split, overtime periods and the winner. Zero
divergence, and both engines drew the same number of random values.

**The two engines are the same simulation today.** The drift this check exists
to catch has not happened yet - which is the point of adding it before it does.

The constants files do differ, but only outside the simulation: the Edge
Function copy still has the older `BOT_SKILL = 0.6` where the client now has
`BOT_POOL_SIZE = 5`, plus two unused constants and a missing UI timer. None are
read by `engine.js`, so none affect a result. The check compares exactly the 36
constants `engine.js` imports, so this real-but-harmless difference does not
train anyone to ignore a red build.

### Dataset parity - PASS (verified out of band)

The scripted check could not run from the environment this was built in:
outbound HTTPS to `aauvgiygwrwdbtruhxta.supabase.co` is refused by an egress
policy (`403 Host not in allowlist`), so it reports SKIP rather than a false
pass. It will run normally anywhere with network.

Verified directly against the database instead:

| | `data/nba-players.js` | `players` table |
| --- | --- | --- |
| rows | 2542 | 2542 |
| squads | 163 | 163 |
| mean ppg / rpg / apg | 14.422305 / 5.498820 / 3.275334 | identical to 6 dp |
| mean spg / bpg / tov | 0.997561 / 0.594138 / 1.989339 | identical to 6 dp |
| order-independent hash | 5348046729239 | 5348046729239 |

The two datasets are identical. (An order-*dependent* checksum disagrees - that
is Postgres collation ordering differing from JavaScript string comparison, not
a data difference.)

### Browser - PASS against a local server; NOT YET RUN against the live site

The live site is unreachable from this environment under the same egress policy
(`https://madams3432923943.github.io/gamebuild/` → connection refused), so the
live leg reports SKIP. **Nothing here should be read as a verification of
production.** Run it yourself:

    BK_USER_A=… BK_PASS_A=… npm run verify
    BK_USER_A=… BK_PASS_A=… BK_USER_B=… BK_PASS_B=… npm run verify:online

What *was* verified, via `verify:selftest` against a local server with a
stubbed backend - 12/12 checks, desktop and emulated iPhone 13:

| Check | Desktop | iPhone 13 |
| --- | --- | --- |
| Homepage loads and paints | PASS (FCP 164ms) | PASS (FCP 84ms) |
| Sign-in | PASS | PASS |
| Profile / Rewards / Squads load | PASS | PASS |
| Match starts | PASS | PASS |
| Matchup intro animation | PASS (worst 83ms) | PASS (worst 33ms) |
| Both rosters auto-draft (10 rounds) | PASS | PASS |
| Rotation / matchups / gamestyle | PASS | PASS |
| Simulates to a final score | PASS | PASS |
| Live scoreboard animation | PASS (1076 frames, worst 67ms) | PASS (1264 frames, worst 67ms) |
| Full box score renders | PASS | PASS |
| Layout (1280/768/390/360) | PASS | PASS |
| No JS errors or failed requests | PASS | PASS |

No frame exceeded 100ms in any run. **The animation work does not jank** under
these conditions - on a fast machine, against a local server. Real-device
performance over a real network is still unmeasured.

## Sign-in is required for every mode

The app gates all three modes behind auth - `getSession()` runs at boot and a
missing session goes to the sign-in screen, so there is no anonymous path to a
draft even against the bot. The browser leg therefore needs credentials for
*any* mode, and skips loudly without them rather than passing quietly.

**An `--online` run against production creates a real ranked match between the
two accounts and the Edge Function writes a real result - the loser takes a real
ranked loss.** Use throwaway accounts.

## Budget

The 5-minute budget is enforced in `verify-build.js`: parity finishes in ~0.3s,
and the browser leg is capped at 4 minutes with the remaining time passed to
it as a deadline. A full self-test match runs in ~40s.
