# Mobile baseline — 2026-09-02-11195d7

Captured by `npm run baseline:mobile`. This is the BEFORE state for the phone-first
rework: every screen, at four phone sizes, in a real touch context. It is evidence,
not a gate — the script exits 0 whatever it finds.

Tap-target floor: 44px. Readable-text floor: 12px.

## Summary

| screen | phone | tap targets < 44px | text < 12px | escaping | h-overflow |
| --- | --- | --- | --- | --- | --- |
| nba-02-hub | android-360 | 0 | 0 | 0 | 0px |
| nba-02-hub | iphone-390 | 0 | 0 | 0 | 0px |
| nba-02-hub | iphone-max-430 | 0 | 0 | 0 | 0px |
| nba-02-hub | landscape-844 | 0 | 0 | 0 | 0px |
| nba-03-play | android-360 | 0 | 0 | 0 | 0px |
| nba-03-play | iphone-390 | 0 | 0 | 0 | 0px |
| nba-03-play | iphone-max-430 | 0 | 0 | 0 | 0px |
| nba-03-play | landscape-844 | 1 | 0 | 0 | 0px |
| nba-04-draft-empty | android-360 | 0 | 0 | 0 | 0px |
| nba-04-draft-empty | iphone-390 | 0 | 0 | 0 | 0px |
| nba-04-draft-empty | iphone-max-430 | 0 | 0 | 0 | 0px |
| nba-04-draft-empty | landscape-844 | 6 | 0 | 0 | 0px |
| nba-07-profile | android-360 | 6 | 0 | 0 | 0px |
| nba-07-profile | iphone-390 | 0 | 0 | 0 | 0px |
| nba-07-profile | iphone-max-430 | 0 | 0 | 0 | 0px |
| nba-07-profile | landscape-844 | 0 | 0 | 0 | 0px |
| nba-07-badges | android-360 | 2 | 0 | 0 | 0px |
| nba-07-badges | iphone-390 | 0 | 0 | 0 | 0px |
| nba-07-badges | iphone-max-430 | 0 | 0 | 0 | 0px |
| nba-07-badges | landscape-844 | 2 | 0 | 0 | 0px |
| nba-07-squads | android-360 | 0 | 0 | 0 | 0px |
| nba-07-squads | iphone-390 | 0 | 0 | 0 | 0px |
| nba-07-squads | iphone-max-430 | 0 | 0 | 0 | 0px |
| nba-07-squads | landscape-844 | 2 | 0 | 0 | 0px |
| nfl-02-hub | android-360 | 0 | 0 | 0 | 0px |
| nfl-02-hub | iphone-390 | 0 | 0 | 0 | 0px |
| nfl-02-hub | iphone-max-430 | 0 | 0 | 0 | 0px |
| nfl-02-hub | landscape-844 | 0 | 0 | 0 | 0px |
| nfl-03-play | android-360 | 0 | 0 | 0 | 0px |
| nfl-03-play | iphone-390 | 0 | 0 | 0 | 0px |
| nfl-03-play | iphone-max-430 | 0 | 0 | 0 | 0px |
| nfl-03-play | landscape-844 | 1 | 0 | 0 | 0px |
| nfl-04-draft-empty | android-360 | 0 | 0 | 0 | 0px |
| nfl-04-draft-empty | iphone-390 | 0 | 0 | 0 | 0px |
| nfl-04-draft-empty | iphone-max-430 | 0 | 0 | 0 | 0px |
| nfl-04-draft-empty | landscape-844 | 6 | 0 | 0 | 0px |
| nfl-05-game-live | android-360 | 0 | 0 | 0 | 0px |
| nfl-05-game-live | iphone-390 | 0 | 0 | 0 | 0px |
| nfl-05-game-live | iphone-max-430 | 0 | 0 | 0 | 0px |
| nfl-05-game-live | landscape-844 | 0 | 0 | 0 | 0px |
| nfl-06-game-final | android-360 | 0 | 0 | 0 | 0px |
| nfl-06-game-final | iphone-390 | 0 | 0 | 0 | 0px |
| nfl-06-game-final | iphone-max-430 | 0 | 0 | 0 | 0px |
| nfl-06-game-final | landscape-844 | 3 | 0 | 0 | 0px |
| nfl-07-profile | android-360 | 0 | 0 | 0 | 0px |
| nfl-07-profile | iphone-390 | 0 | 0 | 0 | 0px |
| nfl-07-profile | iphone-max-430 | 0 | 0 | 0 | 0px |
| nfl-07-profile | landscape-844 | 0 | 0 | 0 | 0px |
| nfl-07-badges | android-360 | 0 | 0 | 0 | 0px |
| nfl-07-badges | iphone-390 | 0 | 0 | 0 | 0px |
| nfl-07-badges | iphone-max-430 | 0 | 0 | 0 | 0px |
| nfl-07-badges | landscape-844 | 2 | 0 | 0 | 0px |
| nfl-07-squads | android-360 | 0 | 0 | 0 | 0px |
| nfl-07-squads | iphone-390 | 0 | 0 | 0 | 0px |
| nfl-07-squads | iphone-max-430 | 0 | 0 | 0 | 0px |
| nfl-07-squads | landscape-844 | 2 | 0 | 0 | 0px |

## What is worst, screen by screen

### nba-03-play @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02-11195d7/nba-03-play--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 762x38: `button#btn-start-draft.btn.btn-primary "Start Draft"`

### nba-04-draft-empty @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02-11195d7/nba-04-draft-empty--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 50x33: `button.position-btn "PG"`
- tap target 50x33: `button.position-btn "SG"`
- tap target 50x33: `button.position-btn "SF"`
- tap target 50x33: `button.position-btn "PF"`
- tap target 42x33: `button.position-btn "C"`
- tap target 90x33: `button.position-btn "6th Man"`

### nba-07-profile @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02-11195d7/nba-07-profile--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 44x44: `button.kit-swatch`
- tap target 44x44: `button.kit-swatch`
- tap target 44x44: `button.kit-swatch`
- tap target 44x44: `button.kit-swatch`
- tap target 44x44: `button.kit-swatch`
- tap target 44x44: `button.kit-swatch`

### nba-07-badges @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02-11195d7/nba-07-badges--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 77x44: `button.subtab.active "🏀 NBA"`
- tap target 74x44: `button.subtab "🏈 NFL"`

### nba-07-badges @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02-11195d7/nba-07-badges--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 365x32: `button.btn.btn-secondary "Feature"`
- tap target 365x32: `button.btn.btn-secondary "Feature"`

### nba-07-squads @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02-11195d7/nba-07-squads--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 149x40: `button#btn-create-squad.btn.btn-primary "Create a Squad"`
- tap target 180x40: `button#btn-join-by-code.btn.btn-secondary "Join by Invite Code"`

### nfl-03-play @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02-11195d7/nfl-03-play--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 762x38: `button#btn-start-draft.btn.btn-primary "Start Draft"`

### nfl-04-draft-empty @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02-11195d7/nfl-04-draft-empty--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 50x33: `button.position-btn "QB"`
- tap target 50x33: `button.position-btn "RB"`
- tap target 50x33: `button.position-btn "WR"`
- tap target 50x33: `button.position-btn "TE"`
- tap target 50x33: `button.position-btn "OL"`
- tap target 58x33: `button.position-btn "DEF"`

### nfl-06-game-final @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02-11195d7/nfl-06-game-final--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 397x40: `button#btn-to-profile.btn.btn-secondary "View Profile"`
- tap target 395x40: `button#btn-play-again.btn.btn-primary "Play Again"`
- tap target 804x40: `button#btn-game-home.btn.btn-secondary "Return to Home"`

### nfl-07-badges @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02-11195d7/nfl-07-badges--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 365x32: `button.btn.btn-secondary "Feature"`
- tap target 365x32: `button.btn.btn-secondary "Feature"`

### nfl-07-squads @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02-11195d7/nfl-07-squads--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 149x40: `button#btn-create-squad.btn.btn-primary "Create a Squad"`
- tap target 180x40: `button#btn-join-by-code.btn.btn-secondary "Join by Invite Code"`

## Run log

```
Mobile baseline — serving /home/user/Gamebuild at http://127.0.0.1:8934/
Writing to docs/audits/2026-09-02-11195d7-mobile-baseline

NBA
  already signed in (existing session restored)
    nba-02-hub @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-02-hub @ iphone-390: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-02-hub @ iphone-max-430: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-02-hub @ landscape-844: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
  nba: play screen open
    nba-03-play @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-03-play @ iphone-390: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-03-play @ iphone-max-430: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-03-play @ landscape-844: 1 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-04-draft-empty @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-04-draft-empty @ iphone-390: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-04-draft-empty @ iphone-max-430: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-04-draft-empty @ landscape-844: 6 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
  nba round 1: Amar'e Stoudemire
  nba round 2: Tom Chambers
  nba round 3: Kevin Garnett
  nba round 4: Mike Conley
  draft did not complete: nba: draft did not finish inside its time budget
  drafted 0 round(s)
  nba: rotation phase not shown (mode may skip it)
  nba: matchups phase not shown (mode may skip it)
  strategy rounds: 0
    nba-07-profile @ android-360: 6 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-profile @ iphone-390: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-profile @ iphone-max-430: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-profile @ landscape-844: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-badges @ android-360: 2 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-badges @ iphone-390: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-badges @ iphone-max-430: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-badges @ landscape-844: 2 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-squads @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-squads @ iphone-390: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-squads @ iphone-max-430: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-squads @ landscape-844: 2 small target(s), 0 tiny text, 0 escaping, 0px h-overflow

NFL
  already signed in (existing session restored)
    nfl-02-hub @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-02-hub @ iphone-390: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-02-hub @ iphone-max-430: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-02-hub @ landscape-844: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
  nfl: play screen open
    nfl-03-play @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-03-play @ iphone-390: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-03-play @ iphone-max-430: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-03-play @ landscape-844: 1 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-04-draft-empty @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-04-draft-empty @ iphone-390: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-04-draft-empty @ iphone-max-430: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-04-draft-empty @ landscape-844: 6 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
  nfl round 1: Adrian Peterson
  nfl round 2: Terrell Owens
  nfl round 3: Dak Prescott
  nfl round 4: Green Bay Packers Offensive Line
  nfl round 5: Carolina Panthers Linebackers
  nfl round 6: Dallas Clark
  drafted 6 round(s)
  nfl: rotation phase not shown (mode may skip it)
  nfl: matchups phase not shown (mode may skip it)
  nfl: gameplan chosen over 2 rounds, game started
  nfl: round 1 offered 3 card(s) — Offensive Gameplan — Round 1 of 2
  nfl: round 2 offered 3 card(s) — Defensive Gameplan — Round 2 of 2
  strategy rounds: 2
    nfl-05-game-live @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-05-game-live @ iphone-390: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-05-game-live @ iphone-max-430: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-05-game-live @ landscape-844: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-06-game-final @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-06-game-final @ iphone-390: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-06-game-final @ iphone-max-430: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-06-game-final @ landscape-844: 3 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-profile @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-profile @ iphone-390: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-profile @ iphone-max-430: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-profile @ landscape-844: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-badges @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-badges @ iphone-390: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-badges @ iphone-max-430: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-badges @ landscape-844: 2 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-squads @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-squads @ iphone-390: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-squads @ iphone-max-430: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-squads @ landscape-844: 2 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
```