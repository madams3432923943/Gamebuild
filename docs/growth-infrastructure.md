# Growth and business infrastructure

Onboarding, product analytics, the admin dashboard, account email, sponsorship
inventory and the postgame share card — what each one is, where it lives, and
what it deliberately is not.

Built 2026-09-11. Gameplay was explicitly out of scope: no simulation, drafting,
matchmaking, rating, dataset or result logic was touched, and the engine parity
and simulation-statistics suites pass unchanged.

---

## 1. First-run onboarding

**Files** `js/onboarding.js`, `js/shell.js` (focus management),
`js/profile.js` (`markOnboardingSeen`, `hasSeenOnboarding`), `js/main.js`
(`enterApp`), `css/style.css`, `db/migrations/20260911_01_onboarding_state.sql`

One modal for a brand-new account: what Draft Nova is, the five steps of a
match, the two modes and their difficulties, and a button into a game. Under
twenty seconds to read, and nothing after it.

### How "first time" is detected

`profiles.has_seen_onboarding` — **on the account, not in the browser**.
localStorage would show the welcome again on a phone, again in a private
window, and never after a reinstall; "first time" is a property of the account.

The client shows the modal **only on an explicit `false`**. `normalize()` in
`js/profile.js` reads `row.has_seen_onboarding !== false`, so a missing column
means "already onboarded". That asymmetry is the whole point: the two mistakes
are not equal. Missing it for one new player costs a welcome screen; reading an
absent column as "new" would show *every existing player* a welcome the next
time they opened the app, which is the failure that loses users.

### Existing-user migration

The migration adds the column with `default false` and then runs
`update public.profiles set has_seen_onboarding = true` over every row that
existed at that moment. Rows created afterwards take the default and are
genuinely new. Nothing to backfill again, and no date arithmetic to get wrong.

### It shares the app's one modal

`openModal` in `js/shell.js` already owned the backdrop, Escape, the close
button and the variant class. This sprint added what the markup had been
claiming since it first said `aria-modal="true"` and never delivered: focus
moves into the dialog on open, Tab is trapped at both ends, and the previous
focus is restored on close. Every dialog in the app — the position picker, How
to Play, the rank ladder, the wardrobe, the squads dialogs — got that at once.

Opening the modal is what writes the flag, not completing it: a player who read
it and navigated away has seen it. `onboarding_viewed` is everyone;
`onboarding_completed` is only the ones who pressed the button.

**Tested by** `npm run verify:onboarding` — new account sees it, reload does
not, an onboarded account never does, **a profile with no column never does**,
the CTA and Escape both close it, dismissal still counts as seen but not as
completed, focus enters and Tab stays inside, and it fits a 390px phone with no
horizontal scroll.

---

## 2. Product analytics

**Files** `js/analytics.js`, call sites in `js/main.js`,
`js/screens/squads.js`, `js/onboarding.js`, `js/ads/placements.js`,
`db/migrations/20260911_02_product_analytics.sql`

First-party, inside the Supabase project the app already talks to. No third
party, no tag manager, no page-view event, no device data, nothing that leaves
the origin.

### What is derived from production tables instead

The rule was not to duplicate what the authoritative tables already answer:

| Question | Answered from |
| --- | --- |
| Online and friend games, with sport, mode, participants, timestamps | `matches` + `match_results` |
| Account count and signup dates | `profiles.created_at` |
| Rank, records, ratings | `profiles`, written server-side |

So events cover only what no table records: the pre-match funnel, and
**practice games** — which are simulated in the browser and have no match row
at all, and are the majority of games played. `game_completed` carries `mode`,
and `admin_overview()` unions in only the practice ones, so an online game is
never counted twice. Verified against live data: 50 matches in the table, 50
ranked games in the aggregate, 22 NBA + 28 NFL, exactly reconciling.

### Events

Twenty, declared in `public.analytics_event_types`. `track_event()` raises on a
name that is not in the table, so a typo fails where it was introduced rather
than creating a metric nobody can find.

```
signup_completed  onboarding_viewed  onboarding_completed
sport_selected  mode_selected  practice_difficulty_selected
draft_started  draft_completed  simulation_started  game_completed
ranked_queue_joined  ranked_match_found  ranked_game_completed
friend_added  friend_challenge_sent  friend_game_completed
sponsor_impression  sponsor_click  share_card_created  share_card_shared
```

### Fired on actions, not renders

This is the duplicate-event problem, and the answer is `trackOnce(event, props,
key)`:

- `mode_selected` fires in the click handler, not in `renderModeCards()` —
  which runs again on every selection and every return to the Play screen.
- `ranked_queue_joined` fires once per **search**, not per `join_queue` poll.
  One search is roughly sixty polls.
- `draft_started` / `draft_completed` for an online match are keyed to the
  match id, because `enterOnlineMatch` is also how a player *reconnects* and a
  dropped connection is not a second draft.
- `game_completed` sits behind the same `finished` guard that stops a result
  being written twice, so an abandoned game settled by `cleanupPlayback`
  counts exactly once.
- A sponsor impression is keyed to campaign **and** placement — see §5.

### Privacy

Payloads are filtered twice against the same twelve-key allowlist: client-side
in `js/analytics.js` so a mistake shows in the console of whoever made it, and
server-side in `sanitize_event_props()` because client-side validation is never
sufficient by itself.

```
sport  mode  difficulty  era  won  margin
placement  campaign  format  source  step  seconds
```

No key could carry an email address, a token, a username or a message. Values
must be scalars (an object under an allowed key would smuggle anything through)
and strings are truncated to 64 characters, so an allowed key cannot become a
free-text field. A user is identified by `auth.uid()` and nothing else.

Verified against the live function: a payload carrying `email`, `password`,
`token` and a long `note` stored **none** of them.

`analytics_events`, `active_days` and `analytics_event_types` all have RLS on
with **no policies** and no grants to `anon` or `authenticated`. A player cannot
read anyone's event trail, including their own. The only reachable functions are
`track_event` and `touch_active_day`.

### DAU / WAU / MAU

From `active_days` — one row per player per calendar day they opened the app,
upserted by `touch_active_day()` on app entry. Three counts over a two-column
table rather than a distinct-user scan over every event ever recorded: at a
million players that is a million rows a *year*, where the events table would be
that per week. The client also guards with a per-day localStorage key, which is
allowed to be wrong because the primary key is what actually deduplicates.

**Tested by** `npm run verify:analytics` — the client's event list, the
migration's allowlist and the dashboard's funnel order are the same set; every
event has a call site; the two prop allowlists are identical; no forbidden key
appears in either; the sanitizer rejects non-scalars and caps strings; the
tables are ungranted; and the recurring events are keyed.

---

## 3. Admin dashboard

**How you open it** `npm run admin`, then <http://127.0.0.1:8790/>.

**Files** `tools/admin/index.html`, `js/admin/main.js`, `js/admin/render.js`,
`css/admin.css`, `scripts/serve-admin.mjs`,
`db/migrations/20260911_03_admin_dashboard.sql`,
`db/migrations/20260911_04_games_per_user_window.sql`

### It is not part of the website

It started as `/admin.html` at the repo root, which made it a top-level page of
draftnovagame.com. Nothing about that was insecure — the data comes from
functions that refuse a non-administrator, so the page held nothing and showed
nothing to anybody else — but a business dashboard is not part of the product,
and a URL that exists is a URL somebody eventually links, bookmarks or
screenshots.

So it is a local tool. `npm run admin` serves the repo on **127.0.0.1** —
loopback explicitly, not `0.0.0.0`, because on a shared network the second one
would put the page on every device in the room. There is no admin page among
the site's own pages, nothing links to one, and no player can stumble into it.

**What that does and does not buy, stated plainly.** GitHub Pages serves this
repository's whole tree, so the file is still *fetchable* by anyone who types
the `tools/admin/` path. That is harmless and was never the boundary: the page
has no data of its own. If you want zero public footprint, the remaining step
is keeping `tools/admin/` off `main` — say so and it is one command.

It has **its own sign-in**, and it has to: the page is served from `127.0.0.1`
and the game from `draftnovagame.com`, and `localStorage` does not cross an
origin. An earlier version told the reader to "sign in on the game first",
which was advice that could not work. Signing in buys nothing on its own —
the data still comes from `is_admin()`-guarded functions.

### Authorization

**Enforced in the database, not by where the file lives.** The page is a static
file; anyone who has it can read its source and call what it calls. So the page
has no data of its own — every figure comes from
`admin_overview()` or `admin_funnel()`, both `SECURITY DEFINER` functions that
call `is_admin()` first and `raise ... errcode = '42501'` otherwise.

The allowlist is its own table, `public.admin_users`, **not** a column on
`profiles`: `profiles` is publicly readable by design (the rank ladders depend
on it), and a flag there would publish the list of administrators to every
visitor. `admin_users` has RLS on with no policies and no grants, so only
definer code can see inside it. There is deliberately no client path that grants
admin — add a row with the service role or the SQL editor:

```sql
insert into public.admin_users (user_id, note)
select id, 'why' from auth.users where email = 'someone@example.com';
```

Verified live at all three levels:

| Caller | Result |
| --- | --- |
| The admin account | Data returned |
| An ordinary authenticated player | `42501 Not authorized.` |
| `anon` | Cannot `EXECUTE` any of the three functions |
| Either role | Cannot `SELECT` `analytics_events`, `active_days` or `admin_users` |

`is_admin()` itself is granted to `authenticated` so the page can ask "am I
allowed in" and show a refusal instead of a broken screen. It reveals only the
caller's own status.

### Metrics

Users (total, today, week, month) · DAU/WAU/MAU · games (today, week, month,
all time) · by sport · by mode (ranked / practice / friend) · by practice
difficulty · games per active user · accounts that never finished a game ·
first-game completion rate · Day 1 and Day 7 retention · the twenty-step funnel
as distinct players per step.

### Query architecture

Two RPCs, each returning **one jsonb document** computed in Postgres against
indexes. The page is one round trip and transfers a few hundred bytes no matter
how much data is behind it. No table is downloaded; no metric is computed
client-side.

### Metrics that cannot be calculated are not faked

A `null` renders as an em dash with the reason beside it — never `0` or `0%`.
Retention reports "no cohort has closed yet" until one has, because a 0% Day-1
retention nobody measured is a finding somebody will plan around.

This caught a real defect. The first live read of `admin_overview()` returned
**67.00** games per active user: the numerator counted 30 days of player-games
— two months of real match history — and the denominator counted monthly actives
out of an `active_days` table that was one day old. The arithmetic was right and
the number was nonsense. `20260911_04` measures both halves over the same
window (the later of 30 days ago and the first recorded active day) and reports
how wide that window actually is, so the dashboard says "last 1 day" rather than
implying a month it does not yet cover. It widens to the full 30 days on its own
as history accumulates.

**Tested by** `npm run verify:admin` — the page reads no table directly, both
aggregates guard with `is_admin()`, the allowlist is not on `profiles`, and the
render is driven against both a populated document and today's near-empty one:
nulls become em dashes with reasons, breakdowns carry their own totals, the
funnel reads in the order the steps happen, and there is no horizontal scroll at
1280px or 390px.

---

## 4. Account email

Full audit, readings and outstanding owner steps: **`docs/production-email.md`**.
Templates: **`docs/email/`**.

Three dead ends were fixed, and all three failed silently:

1. **Mailed links pointed at whatever host asked.** `siteUrl()` built the
   redirect from `location.origin + location.pathname`, correct for exactly one
   spelling of the site. A player arriving at `www.`, at the `github.io`
   address, or at `…/index.html` got a link back to *that* spelling — and
   Supabase refuses to mail a link that is not on the redirect allow-list, so no
   mail arrives. Now pinned to `https://draftnovagame.com/` for any non-local
   host; `localhost` still mails itself so recovery stays testable.
2. **Resetting by username mailed an address nobody can read**, then said
   "Reset link sent. Check your inbox." Now refused, with the remedy on screen.
3. **An expired recovery link explained nothing.** It redirects back with
   `#error=...&error_code=otp_expired` and no session — indistinguishable from a
   cold visit — so the player's only move was to click the dead link again,
   which can never work. Now captured at module load (supabase-js clears the
   fragment as soon as it initialises, so reading it after an `await` is a race
   this would lose intermittently) and reported with the remedy.

**Still requires the owner** — nothing below has been done, and no credentials
were invented: the redirect allow-list, pasting the three templates, custom SMTP
on the business domain, SPF/DKIM/DMARC records, and the decision on whether to
switch email confirmation on (it is currently **off**). Each is listed with its
exact values in `docs/production-email.md`.

There is also **no "your password was changed" notification, and Supabase does
not provide one** — its auth service has no such template. Building it means an
auth hook or a trigger plus an Edge Function; it is listed as future work rather
than reported as preserved.

---

## 5. Sponsorship inventory

Full detail: **`docs/sponsorship.md`**. Creative rules:
**`assets/sponsor/README.md`**.

**Files** `js/ads/campaigns.js`, `js/ads/placements.js`, `index.html`,
`css/style.css`

Inventory, not advertising: no ad network, no third-party script, no cookie. A
campaign is a row in `CAMPAIGNS`; a placement is a slot that draws whichever
campaign is running.

Four placements — `home-rail-left`, `home-rail-right`, `postgame`, `event`. The
first two carry a house slot today; `postgame` and `event` render nothing,
because an empty ad box makes a product look abandoned.

**The rails cost the game nothing.** `position: fixed` outside `#app-root`, so
the draft board, the court and the box score are byte-for-byte the width they
have always been. They appear only at ≥1500px wide (1100px of content plus two
160px rails and their gutters — arithmetic, not taste) and ≥560px tall, and only
while the home screen is up, gated in CSS with
`body:has(#screen-home:not(.hidden))` so a rail over the draft board is
structurally impossible. Below that: `display: none`. No mobile side banner; the
mobile placement is `postgame`, in the flow, below everything.

**An impression is a view, not a render.** `IntersectionObserver` at 50%, held
one second, at most once per campaign per placement per page session. The home
screen redraws every time you return to it and the rails rebuild with it, so
counting renders would measure how often the app called a function — a number
that looks billable and is not. A browser without `IntersectionObserver` records
nothing rather than falling back to the render count. Clicks are counted every
time.

**Tested by** `npm run verify:sponsors` — the date window against fixed dates,
every campaign's placements exist and are rendered, ids are unique (an id is the
analytics key, so reusing one merges two campaigns' reporting forever),
destinations are https/mailto, creative is under `assets/sponsor/`, and the rails
cannot cost the game any width.

---

## 6. Postgame share card

**Files** `js/sharecard.js`, `js/main.js` (`buildShareCard`,
`openShareDialog`), `index.html`, `css/style.css`

**Dimensions** 1080×1920 (Story) and 1080×1080 (square, for X and Discord where
9:16 shows as a sliver).

**Content** Draft Nova · sport · mode · both usernames · final score · winner ·
overtime · MVP and his stat line · rating change if ranked · the player's own
roster with the seasons drafted · DraftNovaGame.com. The square carries no
roster — measured, not judged: at 1080×1080 the blocks above it already reach
y=788 and the footer starts at 1007.

**Export** Share hands a `File` to `navigator.share` where the browser supports
files, falling back to a download; Save downloads directly. A dismissed share
sheet (`AbortError`) is a person changing their mind, not a failure, and does
not then download a file nobody asked for. The preview is a `data:` URL and the
download a `blob:` one, because the CSP allows `data:` in `img-src` and not
`blob:`.

### It cannot disagree with the screen behind it

Every number is passed in from the same authoritative `result` the scoreboard,
recap and box score were drawn from — server-computed for an online game.
`js/sharecard.js` has no access to an engine, a dataset or the rating formula, so
there is nothing in it that *could* recompute a score or re-pick an MVP. The
rating line is the one asynchronous part (the new rating is written server-side
and has to be read back); it fills in behind the scenes and the card draws
without it if it has not landed. Null means no rating row, never `+0`.

**Tested by** `npm run verify:share-card` — real Chromium under a copy of
`index.html`'s CSP, across NBA/NFL × ranked/practice/friend × win/loss plus
20-character usernames and a 31-character unit name. It writes every variant to
`verify-artifacts/share-card/` so a person can look at what is about to go out
in the product's name, which is how two of the four layout bugs were actually
found.

---

## Verification

Everything above is in `npm run verify`:

| Script | Covers |
| --- | --- |
| `verify:analytics` | Event/prop contracts between client, database and dashboard; the privacy boundary |
| `verify:email` | Template variables, branding, email-client hygiene |
| `verify:sponsors` | Campaign shape, date windows, placement wiring, rail geometry |
| `verify:onboarding` | Browser: every profile state, keyboard, focus, phone layout |
| `verify:admin` | Browser: authorization model and the render, populated and empty |
| `verify:share-card` | Browser: every card variant, under the real CSP |
| `verify:csp` | Now covers `admin.html` as well as `index.html` |

`npm run verify:schema` (needs `SUPABASE_DB_URL`) checks that the four
migrations applied in this sprint are documented in `db/applied.tsv`.

## Known limitations

- **Retention and DAU/WAU/MAU start from 2026-09-11.** `active_days` has no
  history before the migration, so every rate depending on it is short by
  definition until it accumulates. The dashboard says so rather than implying
  otherwise.
- **Practice games are counted from a client event.** They are simulated in the
  browser and have no server-side record, so a player with JavaScript errors, a
  blocked request or an offline session finishes a game that is never counted.
  Online games are unaffected — those come from the match tables.
- **The dashboard's page file is still fetchable on the live site** at the
  `tools/admin/` path, because GitHub Pages serves the whole repository. It
  contains no data and refuses every non-administrator; see above for the step
  that removes even that.
- **Sponsor creative must be committed to the repo.** The CSP is
  `img-src 'self' data:`; a remotely hosted image does not load, silently.
  Deliberate, and documented in `docs/sponsorship.md`.
- **Account email is not finished.** The templates are written and the redirect
  is fixed, but they do not send until the owner completes the four dashboard
  and DNS steps in `docs/production-email.md`.
- **No frequency capping, pacing or rotation** on sponsor placements, and no
  campaign admin screen. `activeCampaigns()` returns a list and the renderer
  takes the first, so rotation is a change to one function.

## Future extension points

- `PLACEMENTS.EVENT` exists for the first sponsored tournament: a container and
  a campaign row, not a new system.
- `activeCampaigns()` is the one function that would learn to fetch if campaigns
  ever move into a table. The object in `CAMPAIGNS` is already the shape of the
  row.
- `FORMATS` in `js/sharecard.js` takes a third size with two numbers; every
  block measures its own content, so a new aspect ratio reflows rather than
  needing a second layout.
- `admin_funnel(p_days)` already takes a window; a date picker on the dashboard
  is a control, not a query.
- Adding an analytics event is one row in `analytics_event_types`, one line in
  `EVENTS`, one call site and one row in `FUNNEL_ORDER` — and
  `verify:analytics` fails if any of the four is missing.
