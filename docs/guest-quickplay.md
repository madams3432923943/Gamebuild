# Guest Quickplay

The homepage for anyone without an account. Play first, sign up after.

## Purpose

Before this change, a visitor's first screen was a sign-in form. Quickplay
turns it around:

- **NBA and NFL cards.** One tap starts a Practice draft at the default
  difficulty, through the same draft, strategy and simulation screens a
  signed-in player uses.
- **The account offer comes after the game.** It appears on the results
  screen, once there is a game worth keeping.
- **The landing is static HTML.** Search engines and visitors without
  JavaScript see the H1, how-to-play, FAQ and JSON-LD.

## How it fits together

| Piece | Where |
|---|---|
| Landing markup (H1, sport cards, friends CTA, how-to, FAQ) | `#screen-quickplay` in `index.html`, the only screen not `hidden` in the markup |
| Structured data (VideoGame and FAQPage) | `<script type="application/ld+json">` in `<head>` |
| First-paint guard for returning players | `js/boot-session-hint.js` plus the `:root[data-session-hint]` rule in `css/style.css` |
| Guest state, local copy, server calls, carry-over | `js/guest.js` |
| Wiring (`enterGuestMode`, `startGuestGame`, `goHome`, the results card) | `js/main.js` |
| Server table and RPCs | `db/migrations/20261022_01_guest_games.sql` |
| Admin numbers | `admin_guest_overview()`, rendered last on the admin dashboard (`js/admin/render.js`) |
| End-to-end test | `npm run verify:guest-selftest` (`scripts/selftest/run-guest-selftest.mjs`) |

### Boot

The boot calls `getSession()`. With a session it goes to `enterApp()`,
unchanged. With no session, or when the check itself fails, it goes to
`enterGuestMode()`, which:

- sets `isGuest()`;
- marks `<html data-guest>`;
- hides the nav tabs;
- shows the header's **Sign in** button;
- shows the landing.

The landing is visible in the HTML before any script runs. So that a
returning player doesn't see it flash before their home screen,
`js/boot-session-hint.js` runs synchronously in `<head>`. If supabase-js has
a stored session, it sets `data-session-hint` and CSS keeps the landing out of
the first paint. If that session turns out to be dead, `enterGuestMode()`
removes the hint.

### A guest game

Practice runs entirely in the browser, so the game itself needed no change.
What differs is decided by `isGuest()`:

- **Where the result goes.** `runLocalSimulation()` builds one
  `practiceResult` object. For a player it goes to `recordPracticeResult()`.
  For a guest it goes to `recordGuestGame()`, which:
  - keeps it in localStorage (`dn_guest_games`, at most 5); and
  - sends a summary to `record_guest_game()`: sport, difficulty, era, score,
    won.
- **What the results screen shows.** `captureProgressBaseline()` and the
  celebration are skipped, because there's no profile to compare against. The
  sign-up card is shown. View Profile and Return to Home carry
  `.signed-in-only`, which `:root[data-guest]` hides.
- **Where "home" is.** Every exit goes through `goHome()`, which sends a
  guest to the landing. Play Again does too, since a guest's setup screen is
  the landing.

### Guests are in no user metric

- `track()` and `markActiveToday()` already do nothing without a session.
- A guest never writes to `profiles`, `analytics_events` or `active_days`.
- `guest_games` is read only by `admin_guest_overview()`.

The guest self-test asserts all of this against the stub's own record of
every RPC and every write.

### Carry-over at sign-up or sign-in

`enterApp()` awaits `carryOverGuestGames()` before the home screen reads the
profile:

1. Each stored game is replayed through `recordPracticeResult()` and
   `recordDraftPicks()` with its original `date`. It lands in history, records
   and badges as if the player had been signed in.
2. Each game is removed from localStorage as it lands, so a failure part-way
   retries the rest on the next entry without writing any game twice.
3. `claim_guest_games(token)` then stamps `converted_to` on this browser's
   rows in `guest_games`, and the claim token is deleted.

## Database changes

Migration `20261022_01_guest_games.sql`. **Written, not yet applied.**

| Object | Access | What it does |
|---|---|---|
| `guest_games` | RLS on, no policies, no grants | One row per guest game. Stores `claim_hash` (SHA-256 of the browser's token, never the token) and `source_hash` (SHA-256 of the first `X-Forwarded-For` hop, for rate limiting). |
| `record_guest_game(...)` | `anon` only | Validates every field and inserts one row. Rate-limited to 20/hour per browser, 40/hour per source address and 2000/hour overall. Refuses a signed-in caller. |
| `claim_guest_games(token)` | `authenticated` | Claims this browser's unclaimed rows from the last 30 days. Rate-limited through `enforce_rate_limit`. |
| `admin_guest_overview()` | `is_admin()`-gated | Games today, this week, this month and all time; split by sport and difficulty; browsers; converted browsers and accounts; conversion rate. |

### Why not a shared "GUEST" profile

That was the first proposal, and the migration's header explains in full why
this design replaced it. In short:

- `profiles` is publicly readable, and every reader of it would have needed a
  new filter.
- One shared JSON row would lose games to concurrent writes.
- A profile row implies an auth user someone could try to sign in as.

### Why not Supabase anonymous auth

It creates `auth.users` rows, and `on_auth_user_created` turns each one into a
`profiles` row named "Player", which counts as a real user everywhere.

## Extension points

- **A third sport.** Its card is built from the registry, so it appears on the
  landing once it is `live`. The **static** no-JS cards in `index.html` and the
  FAQ copy still name NBA and NFL and need a hand edit.
- **A guest funnel event** (landing viewed, sport tapped) would go in
  `guest_games` or a sibling table, not in `analytics_events`, which requires
  a user.

## Known limitations

- **Guests are counted by browser, not by person.** Two devices count as two,
  and a cleared browser counts as a new one.
- **The guest game summary is self-reported**, the same trust level as any
  practice result today. Nothing competitive reads it.
- **Carry-over follows the browser, not the person.** If someone else signs in
  on the same browser within the window, the pending guest games become
  theirs.
- **Email confirmation.** If the project requires it, sign-up returns no
  session. The guest games stay in localStorage and carry over at the first
  sign-in on that browser.
- **The guest's own label.** A game carried over keeps the label "You" in its
  stored box-score snapshot, not the new username.
