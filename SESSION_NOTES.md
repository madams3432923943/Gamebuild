# Ball Knowledge — session notes

Repo: madams3432923943/gamebuild. Dev branch `claude/gambuild-file-purposes-7rxz2h`,
mirrored to `main` every round (GitHub Pages deploys from `main`).
Supabase project: aauvgiygwrwdbtruhxta.

## THE BIG CAVEAT — read this first

**This sandbox cannot reach Supabase or any CDN** (the agent proxy 403s both
`supabase.co` and `esm.sh`; only the Supabase MCP tools get through). So no
online match has ever been played end-to-end from here. Everything online is
verified by static analysis, live SQL against the real database, and Node
unit tests against the real data shapes — never by actually playing a match
in a browser. **A real two-device playtest is the single highest-value thing
a human can do**, and it is the only way to confirm the P1 fix below.

## P1: online reveal never reaching player screens

Symptom: match completes server-side (profile W-L updates) but neither
player ever sees the game screen.

What was PROVEN from the live DB / edge-function logs:
- The server chain is fully correct. `submit_strategy` flips status to
  `ready_to_simulate` once both tactics land; the edge function writes
  `match_results` and sets `matches.status='complete'` + `matches.winner`.
  Both real matches show `status=complete` with a result row and 20 picks.
- Edge logs show TWO POST 200s per match, ~0.2s apart, with two separate
  OPTIONS preflights ~1.2s apart — i.e. both clients reached
  `runOnlineSimulationFlow` (the only caller of `simulateMatch`). The
  20:28 match ran the current code, after the earlier race fix.
- RLS is fine: participants can read `match_results` and `matches_public`.
- Data shapes all check out (`period_scores` = array of 4 `{a,b}` keyed by
  slot; `box_a/box_b` flat slot-keyed; `mvp` = `{name,side,line,score}`).

Three real defects were found and fixed, all of which failed *silently*:
1. The reveal had a single trigger — the long-lived match watcher. Anything
   stopping it early (tab switch, failed-poll streak, an earlier handler
   throwing) took the reveal with it. A second independent poll now starts
   when a game plan is submitted.
2. Reaching the reveal twice would run two `runOnlineSimulationFlow()`s over
   the same scoreboard intervals/DOM — indistinguishable from a freeze. Now
   guarded by `game.online.simulationStarted`, which is what makes the
   redundant trigger above safe.
3. Nothing between `showScreen("game")` and the animation could report a
   failure (the draft banner is hidden by then), so any throw left
   "Simulating…" on screen forever with the reason in an unhandled
   rejection. That path now writes to the final banner.

**Not yet root-caused with certainty.** The three above are genuine bugs and
together should make the freeze impossible or at minimum self-explaining,
but no reproduction was ever observed from here. If it still fails, the
error banner should now name the reason — get that text.

Separately fixed: `normalizeServerResult` read `dbResult.winner`, but
`match_results` **has no winner column** (it's on `matches`). That was always
`undefined` → normalized to `"B"` every time, so BOTH players were told their
opponent won regardless of score. Now taken from the match row with a
score-comparison fallback. Covered by a unit test.

## Also shipped this session

Bot easier (top-5 pool, 20% each, `BOT_POOL_SIZE`); general banner framework
(default brown Rookie for everyone, friend-count 5/15/30, camo ladder
Woodland/Desert/Tiger/Gold/Diamond gated on ranked wins with Diamond at 500);
badges auto-sorted by tier; phone layout pass; pool-list scroll fixes; Squad
Rep reset to 0 and reserved for tournaments (trigger dropped); Add Friend on
squadmates; banners on the friends leaderboard; Return to Home button after
games; "Quick Play - Learn Stats"; Unlockables → Rewards.

## Open / next

- **Squad tournaments don't exist.** Rep is now permanently 0 until they're
  built. This is intended, but it means the whole Rep ladder is dead UI.
- No `sport` column on `matches`/`matchmaking_queue`/`profiles` — needed
  before NFL, or rank/rep/history blend sports together.
- NFL needs its own engine + roster model; `js/engine.js` is structurally
  basketball-specific (quarter-by-quarter positional matchups, 6-stat
  vector, 5-on-5 slots). Badges/banners/eras generalize cleanly — extend
  those catalogs rather than rebuilding.
- No account recovery (synthetic `username@ballknowledge.app` emails).
- The `simulate-match` edge function is not in this repo — it's edited live
  via the Supabase MCP tools. Its first-caller response omits the box score
  (only the idempotent second-caller path returns the full row); harmless
  today because the client re-reads `match_results`, but worth knowing.
- Minutes (MIN column) are blank for online box scores: rotations live on
  `matches.rotation_a/rotation_b` and aren't exposed through
  `matches_public`, deliberately, so they can't leak mid-strategy.
