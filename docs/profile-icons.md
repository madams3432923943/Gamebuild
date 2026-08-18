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
| `js/emblems.js` | The artwork. 24 original cartoon glyphs as SVG path data, the franchise → glyph mapping, and `emblemSvg()` — the only place in the app that builds SVG. |
| `js/icons.js` | The catalogue: the default icon, the general ladders, one icon per franchise, and progress/unlock rules. Same shape as `js/banners.js`. |
| `js/ui.js` | `renderPlayerIcon()` (home card and profile, one renderer) and `renderIcons()` (the Rewards and Customize grids). |
| `js/profile.js` | `equippedIcon` / `grantedIcons` / `mvpTeams` on the normalized profile, and `setEquippedIcon()`. |

`topSportId()` lives in `js/icons.js` rather than `js/profile.js` deliberately:
`profile.js` imports the icon catalogue for `DEFAULT_ICON_ID`, so the dependency
has to run one way only.

### The artwork is original, and it is not the team's logo

Every real NBA and NFL logo is a registered trademark. None of these are
derived from one — not traced, not redrawn, not "cartoonified". They are
generic mascot silhouettes: a bear is *a* bear, and the only thing tying one to
a franchise is that franchise's own colours and abbreviation, which this app
already generates its banner art from.

**A Bulls icon therefore looks like a cartoon bull in Bulls colours. It does not
look like the Bulls logo, and it is not meant to.**

24 glyphs cover 62 franchises, so teams share marks (six franchises wear
`bird`). Colour is what separates them.

Two of the glyphs — the gear and the sun — are generated from a `spokes()`
helper rather than hand-drawn, because evenly spaced radial teeth look subtly
wrong when eyeballed, and subtly wrong at 34px reads as a rendering bug.

### Contrast

`emblemPalette()` resolves a franchise's two colours into a disc, a mark and an
accent. Several real palettes are two dark colours — Utah is navy on forest
green, the Browns are brown on near-black — and drawing the mark in colour two
on a disc of colour one makes those teams a dark smudge. So the second colour
is used only when it clears **3:1** against the first (the WCAG non-text
threshold `js/kits.js` already holds a worn colour to); otherwise the mark falls
back to white or black, whichever the disc can carry.
`scripts/verify-icons.mjs` asserts every franchise clears it.

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

- **62 franchises, 24 glyphs.** Teams share marks. Distinguishing two `bird`
  teams relies on their colours, which is fine for Ravens (purple/black) versus
  Cardinals (red/black) and weaker for two teams with similar palettes.
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
