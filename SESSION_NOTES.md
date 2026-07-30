# Ball Knowledge — notes for next session

Repo: madams3432923943/gamebuild. Dev branch `claude/gambuild-file-purposes-7rxz2h`,
mirrored straight to `main` every round (GitHub Pages deploys from `main`).
Supabase project: aauvgiygwrwdbtruhxta. Working tree is clean as of commit
`21a671b` — nothing uncommitted, nothing half-finished.

## Just shipped (this session, verify live before trusting it blind)

- Fixed the online-match freeze on game start: `watchMatch()` had a race
  where its first poll always re-ran the state handler concurrently with
  the caller's own initial handling — could double-run the live sim.
- Online Ranked now mirrors offline Ranked Practice exactly (position-picker
  popup, bench auto-fill, opponent-pick reveal highlight) — this was a
  standing complaint ("I keep telling you the same things") so if anything
  online/offline still diverges, that's the bar to hold it to.
- Matchup intro: fixed VS/countdown overlapping, added bounce/impact-flash/
  bigger "GO!" payoff.
- Reveal-highlight animation duration doubled (flip 0.5s→1s, glow
  1.2s→2.4s).
- Live game reveal (shared by online+offline via one `playOutResult` in
  main.js) got a real presentation pass: live scoreboard pulse, period-end
  and lead-change flashes, glowing "hot" play cards, ambient court glow,
  final buzzer flash, MVP/recap pop-in.
- Banner rework: badges 2x size on their own row, "Est. MM/YYYY" join tag,
  removed Games-played + per-sport rank strip (privacy/redundancy), added
  opt-in "top sport & era" tag (new `profiles.show_top_era` column,
  client-writable like `equipped_banner`).

**None of this has been through a real browser click-through** — sandbox
network policy blocks the CDN a live Playwright/browser session needs, so
everything was verified via `node --check`, a DOM-mock render harness
(`/tmp/.../scratchpad/dom-mock.mjs` + `test-banner.mjs`, reusable), and
direct Supabase SQL/RPC checks. **First thing next session: if a real
browser is reachable, actually play an online match end-to-end and eyeball
the new animations** — this is the single biggest gap in verification
across the whole session, not just this round.

## Standing advisory backlog (from the earlier "pre-work" plan, still open)

Tier 1 (worth doing before anything bigger):
- Item 3, the live playtest pass above — now doubly relevant since two
  more animation-heavy rounds have shipped since it was first flagged.
- Item 4: "squad" still means two things (draft-pool team+decade pull vs.
  the player-run clan feature). Not urgent, but cheap to fix now, expensive
  once NFL adds its own draft-pool concept.

Tier 2 (informs NFL, do alongside it):
- Item 2: no `sport` column on `matches`/`matchmaking_queue`/`profiles`
  yet. This session's "top sport" banner tag is a placeholder for exactly
  this reason — it only ever shows NBA right now because there's no
  per-sport data to pick a real winner from. Needs solving before NFL
  launches or rank/rep/history will blend both sports nonsensically.
- Item 5: NFL needs its own engine + roster model, not a generalized
  version of `js/engine.js` (confirmed structurally basketball-specific
  via an earlier Explore pass — quarter-by-quarter positional matchups,
  6-stat vector, 5-on-5 SLOTS).
- Item 6: badges/banners/eras already generalize cleanly to a second sport
  (badges.js has a `sport` field, banners.js's franchise-list pattern is
  sport-agnostic) — don't rebuild these, just extend the catalogs.
- Item 7: no real account-recovery path (synthetic
  `username@ballknowledge.app` emails, so Supabase's password-reset email
  has nowhere real to go). Fine at current scale, gets worse as the player
  base grows.

Tier 3 (polish, no urgency): accessibility/mobile QA pass on everything
built this session (Squads, Friends, redesigned banners); revisit tuned
constants (`BOT_SKILL`, Squad Rep weights/tiers) once there's real usage
data; decide whether Founder/1st Player are the only prestige banners or
there's a pattern coming for more.

## Open threads specific to what shipped tonight

- The "top sport" banner tag is honest-but-thin: it always resolves to
  the one live sport (`SPORTS.find(s => s.live)`), not a real per-sport
  comparison — flagged in a code comment in `js/ui.js`. Revisit once the
  sport-scoping (tier-2 item 2 above) lands.
- `profiles.show_top_era` migration was applied directly via the Supabase
  MCP and also saved to `db/migrations/20260731_02_banner_show_top_era.sql`
  — if a future session re-provisions the DB from migration files, confirm
  it's still in the applied order (it's dated after `20260731_01`, so it
  should be, but worth a glance since date-based migration filenames were
  already slightly out of true chronological order earlier in the repo's
  history — e.g. two files both dated `20260730_03_*`).
- Didn't touch the `simulate-match` Edge Function this round. It was
  synced with the client engine earlier in the session (task #4, marked
  done) — if the live game feels inconsistent between online and offline
  results (not presentation, actual box scores), that sync is the first
  place to check for drift.
