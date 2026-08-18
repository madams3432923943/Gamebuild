# Profile icons

The mark on a player's identity card — the circle beside their name on the home
screen and on their profile. The third earnable cosmetic, after banners and
badges, and the first one that is a drawing rather than a character.

## Purpose

Before this, `#home-avatar` was the literal character `🏀`, typed into
`index.html` and never touched by any JavaScript. A comment beside it said it
showed "your top sport"; nothing in the repository derived a top sport. So a
football player who had never opened basketball wore a basketball, and the most
obviously personal thing on the identity card was the only part of it that was
not personal at all.

Icons fix that twice: the **default** icon really does follow whichever sport
you rank highest in, and everything else on the shelf is something you earned.

## Architecture

| File | Holds |
| --- | --- |
| `js/emblems.js` | The artwork. 49 original cartoon glyphs as SVG path data, the franchise → glyph mapping, the disc/rim/mark/accent palette resolution, and `emblemSvg()` — the only place in the app that builds SVG. |
| `js/icons.js` | The catalogue: the default icon, the general ladders, one icon per franchise, and progress/unlock rules. Same shape as `js/banners.js`. |
| `js/ui.js` | `renderPlayerIcon()` (home card and profile, one renderer) and `renderIcons()` (the Rewards and Customize grids). |
| `js/profile.js` | `equippedIcon` / `grantedIcons` / `mvpTeams` on the normalized profile, and `setEquippedIcon()`. |

`topSportId()` lives in `js/icons.js` rather than `js/profile.js` deliberately:
`profile.js` imports the icon catalogue for `DEFAULT_ICON_ID`, so the dependency
has to run one way only.

### Naming: the city, never the nickname

A team icon is labelled **"Buffalo"**, not "Buffalo Bills". The nickname is the
registered trademark; the city is a place, and naming the place a team plays in
is not a use of anyone's mark.

Cities are an explicit `city` field on each franchise rather than the team name
with its last word removed — "Portland Trail Blazers" and "Thunder /
SuperSonics" both defeat that trick, and a franchise whose city came out wrong
would be the plausible-looking kind of error nobody notices. `verify-icons`
fails the build if one is missing or if any label is still the full team name.

Three cities have two teams in one sport (both New York football teams, both
Los Angeles ones, both LA basketball ones). Those get the emblem's own
plain-English name appended — "New York · Rocket", "New York · Shield" — which
describes the picture on the tile rather than borrowing a nickname.

**This does not make the app trademark-free and is not meant to read that way.**
The draft board, squad banners and reward banners all still name real teams in
full, because a game about recalling real players cannot avoid naming the teams
they played for. The sign-in screen carries a disclaimer stating that Draft Nova
is unofficial and unaffiliated. The icon shelf is simply the one surface where
the full name bought nothing.

### The artwork is original, and it is not the team's logo

Every real NBA and NFL logo is a registered trademark. None of these are
derived from one — not traced, not redrawn, not "cartoonified". They are
generic mascot silhouettes: a bear is *a* bear, and the only thing tying one to
a franchise is that franchise's own two colours — the disc in the first, the rim
in the second — which is what this app already generates its banner art from.
The emblems carry no lettering: at 34px on the identity card an abbreviation is
unreadable, and the reward tile prints the team's full name underneath anyway.

**A Bulls icon therefore looks like a cartoon bull in Bulls colours. It does not
look like the Bulls logo, and it is not meant to.**

**Every team in a sport wears a different glyph.** Sharing one and leaning on
colour worked until two teams shared a palette too, and it left whole stretches
of the shelf as one silhouette in slightly different colours — five of
football's birds were literally the same bird. Glyphs *are* reused across
sports, since a player only ever sees one sport's shelf at a time: San Antonio
and Dallas both wear the cowboy hat.

Colour still does work on top of that. The disc takes the franchise's first
colour and the **rim** its second, so the second colour is on the icon even when
it is too dark to carry the mark.

`scripts/verify-icons.mjs` enforces both: any two franchises **in the same
sport** sharing a glyph must clear `MIN_ICON_SEPARATION` (25 dE, the same units
and reasoning as `MIN_KIT_SEPARATION` in `js/kits.js`), measured as an
area-weighted RMS over disc and rim, and no two icons in a sport may share a
label. Both fail the build, so a franchise added later cannot quietly land on a
twin.

Two of the glyphs — the gear and the sun — are generated from a `spokes()`
helper rather than hand-drawn, because evenly spaced radial teeth look subtly
wrong when eyeballed, and subtly wrong at 34px reads as a rendering bug.

### Contrast

`emblemPalette()` resolves a franchise's two colours into a disc, a rim, a mark
and an accent. Several real palettes are two dark colours — Utah is navy on forest
green, the Browns are brown on near-black — and drawing the mark in colour two
on a disc of colour one makes those teams a dark smudge. So the second colour
is used only when it clears **3:1** against the first (the WCAG non-text
threshold `js/kits.js` already holds a worn colour to); otherwise the mark falls
back to white or black, whichever the disc can carry.
`scripts/verify-icons.mjs` asserts every franchise clears it.

The **accent** — the tone carrying a glyph's identifying detail, a beak or a
pair of horns — gets the same treatment for the same reason. It used to be set
to the raw second colour whenever that colour was too dark to be the mark, which
is precisely when it is also too dark to be seen: Baltimore is purple and black,
so the raven's beak was black on dark purple and the bird rendered as a
featureless blob. `readableOn()` now pushes it toward the ink until it clears
3:1, mixing rather than replacing so the team's hue survives.

## Unlocking

| Icon | Requirement |
| --- | --- |
| Your Sport (default) | Always. It is what an unset card wears. |
| Spark / Comet / Crown / Gem | 5 / 25 / 100 / 250 online ranked wins |
| Handshake | 3 friends |
| Trophy / Dynasty | 1 / 25 ranked MVPs |
| Team icons (62) | **1 ranked MVP** with a player from that franchise, in a game you won |

**Ranked only.** Practice runs entirely on the client, so an offline MVP is
self-reportable, and an award you can hand yourself is not an award — the same
rule banners already follow.

`profiles.mvp_counts` already existed and is explicitly the *offline* tally
keyed by player. Team icons deliberately do **not** read it.
`scripts/verify-icons.mjs` asserts that a profile with 50 offline MVPs unlocks
nothing.

## Database

`db/migrations/20260818_01_profile_icons_and_mvp_teams.sql`:

| Column | Notes |
| --- | --- |
| `equipped_icon text` | Nullable. Null means "not chosen", which the client reads as the computed default — pinning a literal default would freeze a football player's card to a basketball on the day they signed up. |
| `granted_icons jsonb` | Owner override, matching `granted_banners` / `granted_badges`. See `docs/granting-unlocks.md`. |
| `mvp_teams jsonb` | Ranked MVPs per **raw team name**, e.g. `{"Chicago Bulls": 2}`. |

Keyed by raw team name rather than franchise id for the same reason
`team_banners` is: the server would otherwise need its own copy of the
rename/relocation alias table, which is a second source of truth that silently
drifts. The client folds Bullets into Wizards at read time via `teamNamesFor()`
in `js/banners.js` — one alias fold, shared by banners and icons.

`mvp_teams` is written by `finalize_match_result` and by nothing else. A
`protect_mvp_teams` trigger rejects any write from a logged-in client, because
the row-level policy that lets a player set their own `equipped_icon` would
otherwise also let them hand themselves all 62 team icons in one `PATCH`.

The RPC's **signature is unchanged** — PostgREST resolves an RPC by its exact
argument names, so adding a parameter would publish a second function and every
client that had not reloaded would quietly stop recording MVPs. The new value
travels inside the existing `p_profile_a` / `p_profile_b` jsonb payloads.

### Live schema audit

`db/` is documentation of what was applied, not a migration runner, and this
repository has real precedent for the two drifting: `award_banner_progress` and
`profiles.team_banners` exist in the database and appear nowhere in `db/`. So
the applied state was checked directly rather than assumed. On 2026-08-18:

| Checked | Result |
| --- | --- |
| `finalize_match_result` overloads | **1** — no second function was published |
| Signature | `(uuid, jsonb, text, jsonb, jsonb, bigint, text, text, text)` — unchanged |
| `mvp_teams` coalesce, both sides | present for `p_profile_a` and `p_profile_b` |
| `protect_mvp_teams` trigger on `profiles` | attached |
| `equipped_icon` / `granted_icons` / `mvp_teams` columns | all three present |

CI cannot repeat this — the only database secret available to a workflow is a
Management API token, not a connection — so it is a manual step, and it belongs
in the release checklist for any change that touches this RPC.

## Staged deploys

Client, Edge Function and migration land separately, so both orders are safe:

- Migration first, function not yet deployed → the key is absent, `coalesce`
  keeps the column as it was.
- Function first, migration not yet applied → the extra key rides along in a
  jsonb payload the old RPC ignores.
- Client first → `mvp_teams` normalizes to `{}` and team icons stay locked.

No client code assumes the column exists.

## Where it is reached

- **Home → Customize** (top right, above the identity card) — the wardrobe.
  Banners, badges and icons, showing **only what you have unlocked**.
- **Profile → Customize Profile** — the same modal. The button kept its
  `btn-customize-banner` id: the screen is wired by id and renaming it to match
  the new label would be a gratuitous break.
- **Rewards → Icons** — the ladder. Everything, including locked, with progress.

Rewards is what there is to earn; Customize is what you can wear. Both use the
same tile renderers, passed `onlyUnlocked`.

## Known limitations

- **The icon is a colour scheme plus a generic animal.** It is not, and cannot
  be, that team's mark. Someone who does not already know the team will not
  identify it from the emblem alone; the city label is what names it.
- **Glyphs repeat across sports.** San Antonio and Dallas both wear the cowboy
  hat, Chicago and Memphis both a bear. Only within one sport is uniqueness
  enforced, because only one sport's shelf is ever on screen.
- **No icon for a sport that is not live.** NHL and Soccer have no franchises
  yet, so their tabs are empty by construction.
- **The ranked-MVP unlock has not been watched end to end.** It needs two live
  players in one ranked match. It is verified by inspection of the RPC and the
  Edge Function, plus a direct check that the columns and trigger exist — not by
  seeing a real match award an icon.

## Future extension points

- A franchise added to `FRANCHISES` needs one line in `FRANCHISE_EMBLEMS`;
  `verify:icons` fails the build until it gets one.
- New glyphs drop into `EMBLEMS` and are usable immediately. Every glyph must be
  worn by at least one franchise — unused art is a failed check, not a warning,
  because it usually means a mapping was meant to change and did not.
- A general ladder needs an entry in `GENERAL_ICONS` with a `progress()` over
  the normalized profile. Anything it counts must already be trusted.
