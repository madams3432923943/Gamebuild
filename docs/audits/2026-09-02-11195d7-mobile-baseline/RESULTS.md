# Phone-first pass: what changed, measured

Compares `../2026-09-02-ad5fe74-mobile-baseline-BEFORE/rows.json` (the state
this work started from) against `rows.json` here. Same 56 captures, same four
sizes, same two sports.

## Totals

| phone | tap targets < 44px | text < 12px |
| --- | --- | --- |
| android-360 | 178 -> 8 (95% fewer) | 308 -> 0 |
| iphone-390 | 178 -> 0 (100%) | 308 -> 0 |
| iphone-max-430 | 94 -> 0 (100%) | 239 -> 0 |
| landscape-844 | 211 -> 25 (88% fewer) | 234 -> 0 |
| **all** | **661 -> 33 (95% fewer)** | **1,089 -> 0** |

Horizontal overflow was 0 before and is 0 after.

The 33 remaining were named by this run and closed in the commit after it
(`.btn`/`.mode-btn`/`.sport-tile` never got the landscape floor;
`.position-btn` was 50x33 in the draft modal). A follow-up spot check reads 0
undersized on hub, play and draft at 390, 360 and 844x390.

## What produced the change

| commit | effect |
| --- | --- |
| Type floor (`--text-micro`, `--text-xs`) | the entire 1,089 -> 0 |
| Bottom nav | ~130 of the tap targets, on all nine screens |
| Landscape bottom bar (`pointer: coarse`) | 211 -> 127 at 844x390 |
| Touch floor block | swatches, wordmark, card actions, subtabs, fields |
| Quick Play pool cap | roster from y=828 to y=706; page scroll 282px -> 160px |

## What these numbers do NOT say

- **Nothing here is a claim about how it FEELS.** Every reading is Chromium
  with an iPhone 13 profile. It gets touch, the user agent and the pixel ratio
  right, and reproduces none of iOS Safari's address-bar resize, momentum
  scrolling or tap latency. The real-device pass has not happened.
- **Desktop still reports 28 undersized controls, correctly.** 44px is a floor
  for fingers. Applying it to a mouse would be applying a constraint that
  pointer does not have.
- **The auth screen is still unmeasured.** The Supabase stub always restores a
  session, so `#screen-auth` never renders in the harness.
- **A count is not a layout.** "0 undersized targets" says nothing about
  whether the box score is readable on a phone - it is still six columns and
  2,330px tall - or whether the draft board's information order is right.
  Those are the next items, and they need eyes, not a counter.

## Reproducing

```
npm run baseline:mobile          # the full walk, ~20 minutes
npm run baseline:mobile:quick    # NBA, no draft, five screens
```

Screenshots land in `verify-artifacts/mobile-baseline/<date>-<sha>/`, which is
gitignored: 56 full captures at a phone's pixel ratio is ~55MB, and this repo
is served to the web from its own root.
