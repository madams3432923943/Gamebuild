# What the mobile baseline found

Hand-written analysis of the run in `report.md`. That file is generated —
don't edit it; re-run `npm run baseline:mobile` instead. This one is the
reading of it, and it is what Phase 1 of the phone-first rework is scoped
against.

## The headline

56 captures. **661 undersized tap targets, 1,089 elements with text under
12px, and zero layout failures.**

That last number is the point. The existing gate in `scripts/verify-browser.mjs`
audits four widths for overlapping siblings, boxes escaping the viewport and
horizontal document overflow, and it reports a clean sheet at every phone size.
It is not wrong. Nothing is broken. The screens are simply not designed for a
phone — they are the desktop layout surviving a narrow viewport, and survival
is not the bar for a game people play sitting on a couch.

A layout audit cannot see a control that is merely small, or text that is
merely unreadable. That is why this run measures those two things directly.

## Ranked by damage

Per-screen at 390px (the iPhone 12/13/14/15 body, the single most common size):

| screen | tap targets < 44px | text < 12px | scroll beyond one screen |
| --- | --- | --- | --- |
| draft board | 8 | **56** | 260px |
| final box score | 7 | **44** | 1,486px |
| live game | 7 | 40 | 1,023px |
| rewards | 13 | 26 | **2,706px** |
| profile | **28** | 12 | 1,253px |
| hub | 13 | 8 | 0 |
| play | 8 | 5 | 0 |
| squads | 12 | 5 | 0 |

## Findings

### 1. The nav bar is most of the problem, and it is one fix

`#nav-play`, `#nav-profile`, `#nav-badges`, `#nav-squads`, `#nav-sound` and
`#nav-signout` are 11.2px text in 40px-tall buttons, and they appear on every
screen. They account for roughly 130 of the 661 undersized targets and 130 of
the 1,089 tiny-text readings on their own — the same six controls counted once
per screen per width.

They also sit at the TOP of the viewport, the hardest place on a phone for a
thumb to reach, and "Sign Out" — the one destructive action — is 40x40 and
wraps onto two lines. One bottom-nav rebuild fixes six controls on nine
screens.

### 2. `.kit-swatch` is 34x34, 44 times over

The single most frequent undersized control in the whole run. Colour swatches
in a grid, each 10px under the floor, presented as a dense field of adjacent
targets — the worst case for mistap, because every neighbour is also a live
control and hitting the wrong one silently changes a setting.

### 3. `#btn-brand` is a 32px-tall full-width button

"Draft Nova" is a real, clickable control spanning the entire header (197px to
403px wide depending on viewport) at 32px tall. Wide enough to hit by accident
while reaching for the nav, short enough to miss on purpose.

### 4. Player stat lines break mid-value

On the NBA draft board every card renders its stats as a `·`-joined string:

    25.7 pts · 5.8 reb · 3.9 ast · 1.3
    stl · 1.1 blk

The value `1.3` ends one line and its label `stl` begins the next. This happens
on every card, in ~12px dim monospace. It is the most-read text in the game and
the least readable thing on the screen — and it is invisible to every check the
suite runs, because a wrapped line overflows nothing.

The fix is structural, not cosmetic: stats want a non-wrapping grid where value
and label are one unit, not a joined string trusted to break politely.

### 5. The box score is a desktop table on a phone

Six columns (SLOT, PLAYER, TOT YDS, COMP, ATT, PASS, PTD) inside 390px. The
player column collapses to about four characters per line, so "San Francisco
49ers Offensive Line" wraps to five lines and its team/season subtitle to three
more. The NFL final box score is 2,330 CSS px tall against an 844px viewport —
nearly three full screens to read one result.

The NBA box score already pins its name column with `position: sticky`, which
the suite verifies. That is the right instinct and it is not enough: a sticky
column in a table too wide to read is still a table too wide to read.

### 6. Rewards scrolls more than four screens

2,706px of vertical scroll past an 844px viewport, at 26 tiny-text elements.
Whatever this screen is for, nobody is reaching the bottom of it on a phone.

### 7. 430px looks better only because things stop wrapping

Small-target counts roughly halve between 390 and 430 (13 to 7 on the hub, 8 to
2 on play). No breakpoint fires — the same elements simply fit. There is no
phone-specific design to credit, and everyone on a standard iPhone gets the
cramped version.

## What this scopes

In priority order, which is roughly damage times traffic:

1. **Bottom nav in the thumb zone**, replacing the top text row. Fixes six
   controls across nine screens, and moves navigation to where a thumb is.
2. **A type scale with a floor.** Nothing below ~13px. This alone clears most
   of the 1,089 readings, and it has to land before the screen rebuilds so
   they are built against the real sizes.
3. **Stat lines as a grid**, on the draft card and everywhere else a `·`-joined
   string is trusted to wrap.
4. **The draft board**, phone-first: the roster's open slots visible while the
   pool scrolls, rather than below it.
5. **The box score**, phone-native rather than a narrowed table.
6. **Tap-target sweep**: `.kit-swatch`, `#btn-brand`, and whatever else the
   next run still names.

## What was NOT captured

- **The auth screen.** `scripts/selftest/supabase-stub.js` always returns a
  session, so `#screen-auth` never renders in the harness and the run skips it.
  Photographing it needs a no-session stub variant.
- **NBA's live game and box score.** The NBA leg's draft ran past its budget
  before reaching them; the NFL leg captured both. The NBA equivalents are
  still unmeasured.
- **Real devices.** This is Chromium with an iPhone 13 device profile. It gets
  touch, the user agent and the pixel ratio right. It does not reproduce iOS
  Safari's address-bar resize, momentum scrolling, or tap latency — which are
  exactly the things that make a phone feel bad.
