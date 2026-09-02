# Mobile baseline — 2026-09-02

Captured by `npm run baseline:mobile`. This is the BEFORE state for the phone-first
rework: every screen, at four phone sizes, in a real touch context. It is evidence,
not a gate — the script exits 0 whatever it finds.

Tap-target floor: 44px. Readable-text floor: 12px.

## Summary

| screen | phone | tap targets < 44px | text < 12px | escaping | h-overflow |
| --- | --- | --- | --- | --- | --- |
| nba-02-hub | android-360 | 13 | 8 | 0 | 0px |
| nba-02-hub | iphone-390 | 13 | 8 | 0 | 0px |
| nba-02-hub | iphone-max-430 | 7 | 3 | 0 | 0px |
| nba-02-hub | landscape-844 | 13 | 3 | 0 | 0px |
| nba-03-play | android-360 | 8 | 5 | 0 | 0px |
| nba-03-play | iphone-390 | 8 | 5 | 0 | 0px |
| nba-03-play | iphone-max-430 | 2 | 0 | 0 | 0px |
| nba-03-play | landscape-844 | 13 | 0 | 0 | 0px |
| nba-04-draft-empty | android-360 | 8 | 42 | 0 | 0px |
| nba-04-draft-empty | iphone-390 | 8 | 42 | 0 | 0px |
| nba-04-draft-empty | iphone-max-430 | 2 | 37 | 0 | 0px |
| nba-04-draft-empty | landscape-844 | 14 | 35 | 0 | 0px |
| nba-07-profile | android-360 | 28 | 12 | 0 | 0px |
| nba-07-profile | iphone-390 | 28 | 12 | 0 | 0px |
| nba-07-profile | iphone-max-430 | 22 | 7 | 0 | 0px |
| nba-07-profile | landscape-844 | 28 | 7 | 0 | 0px |
| nba-07-badges | android-360 | 13 | 26 | 0 | 0px |
| nba-07-badges | iphone-390 | 13 | 26 | 0 | 0px |
| nba-07-badges | iphone-max-430 | 7 | 21 | 0 | 0px |
| nba-07-badges | landscape-844 | 15 | 21 | 0 | 0px |
| nba-07-squads | android-360 | 12 | 5 | 0 | 0px |
| nba-07-squads | iphone-390 | 12 | 5 | 0 | 0px |
| nba-07-squads | iphone-max-430 | 6 | 0 | 0 | 0px |
| nba-07-squads | landscape-844 | 14 | 0 | 0 | 0px |
| nfl-02-hub | android-360 | 13 | 8 | 0 | 0px |
| nfl-02-hub | iphone-390 | 13 | 8 | 0 | 0px |
| nfl-02-hub | iphone-max-430 | 7 | 3 | 0 | 0px |
| nfl-02-hub | landscape-844 | 13 | 3 | 0 | 0px |
| nfl-03-play | android-360 | 8 | 5 | 0 | 0px |
| nfl-03-play | iphone-390 | 8 | 5 | 0 | 0px |
| nfl-03-play | iphone-max-430 | 2 | 0 | 0 | 0px |
| nfl-03-play | landscape-844 | 13 | 0 | 0 | 0px |
| nfl-04-draft-empty | android-360 | 8 | 70 | 0 | 0px |
| nfl-04-draft-empty | iphone-390 | 8 | 70 | 0 | 0px |
| nfl-04-draft-empty | iphone-max-430 | 2 | 65 | 0 | 0px |
| nfl-04-draft-empty | landscape-844 | 14 | 63 | 0 | 0px |
| nfl-05-game-live | android-360 | 7 | 40 | 0 | 0px |
| nfl-05-game-live | iphone-390 | 7 | 40 | 0 | 0px |
| nfl-05-game-live | iphone-max-430 | 1 | 36 | 0 | 0px |
| nfl-05-game-live | landscape-844 | 7 | 35 | 0 | 0px |
| nfl-06-game-final | android-360 | 7 | 44 | 0 | 0px |
| nfl-06-game-final | iphone-390 | 7 | 44 | 0 | 0px |
| nfl-06-game-final | iphone-max-430 | 1 | 39 | 0 | 0px |
| nfl-06-game-final | landscape-844 | 10 | 39 | 0 | 0px |
| nfl-07-profile | android-360 | 28 | 12 | 0 | 0px |
| nfl-07-profile | iphone-390 | 28 | 12 | 0 | 0px |
| nfl-07-profile | iphone-max-430 | 22 | 7 | 0 | 0px |
| nfl-07-profile | landscape-844 | 28 | 7 | 0 | 0px |
| nfl-07-badges | android-360 | 13 | 26 | 0 | 0px |
| nfl-07-badges | iphone-390 | 13 | 26 | 0 | 0px |
| nfl-07-badges | iphone-max-430 | 7 | 21 | 0 | 0px |
| nfl-07-badges | landscape-844 | 15 | 21 | 0 | 0px |
| nfl-07-squads | android-360 | 12 | 5 | 0 | 0px |
| nfl-07-squads | iphone-390 | 12 | 5 | 0 | 0px |
| nfl-07-squads | iphone-max-430 | 6 | 0 | 0 | 0px |
| nfl-07-squads | landscape-844 | 14 | 0 | 0 | 0px |

## What is worst, screen by screen

### nba-02-hub @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-02-hub--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 333x32: `button#btn-brand.brand "Draft Nova"`
- tap target 40x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 56x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 40x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 113x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 127x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 144x31: `button.sport-card-action "🏆 Rank"`
- tap target 144x31: `button.sport-card-action "📖 How to Play"`
- tap target 144x31: `button.sport-card-action "🏆 Rank"`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 10.9px text: `span#home-joined.pb-joined "Est. 01/2026"` — "Est. 01/2026"
- 10.6px text: `span.pb-stat-label "Rep"` — "Rep"
- 10.6px text: `span.pb-stat-label "Rank"` — "Rank"

### nba-02-hub @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-02-hub--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 363x32: `button#btn-brand.brand "Draft Nova"`
- tap target 50x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 66x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 50x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 113x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 157x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 159x31: `button.sport-card-action "🏆 Rank"`
- tap target 159x31: `button.sport-card-action "📖 How to Play"`
- tap target 159x31: `button.sport-card-action "🏆 Rank"`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 10.9px text: `span#home-joined.pb-joined "Est. 01/2026"` — "Est. 01/2026"
- 10.6px text: `span.pb-stat-label "Rep"` — "Rep"
- 10.6px text: `span.pb-stat-label "Rank"` — "Rank"

### nba-02-hub @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-02-hub--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 403x32: `button#btn-brand.brand "Draft Nova"`
- tap target 113x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 197x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 179x31: `button.sport-card-action "🏆 Rank"`
- tap target 179x31: `button.sport-card-action "📖 How to Play"`
- tap target 179x31: `button.sport-card-action "🏆 Rank"`
- tap target 179x31: `button.sport-card-action "📖 How to Play"`
- 10.9px text: `span#home-joined.pb-joined "Est. 01/2026"` — "Est. 01/2026"
- 10.6px text: `span.pb-stat-label "Rep"` — "Rep"
- 10.6px text: `span.pb-stat-label "Rank"` — "Rank"

### nba-02-hub @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-02-hub--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x32: `button#nav-play.nav-tab.active "Play"`
- tap target 93x32: `button#nav-profile.nav-tab "Profile"`
- tap target 103x32: `button#nav-badges.nav-tab "Rewards"`
- tap target 91x32: `button#nav-squads.nav-tab "Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x32: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 113x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 126x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 81x31: `button.sport-card-action "🏆 Rank"`
- tap target 121x31: `button.sport-card-action "📖 How to Play"`
- tap target 81x31: `button.sport-card-action "🏆 Rank"`
- 10.9px text: `span#home-joined.pb-joined "Est. 01/2026"` — "Est. 01/2026"
- 10.6px text: `span.pb-stat-label "Rep"` — "Rep"
- 10.6px text: `span.pb-stat-label "Rank"` — "Rank"

### nba-03-play @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-03-play--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 333x32: `button#btn-brand.brand "Draft Nova"`
- tap target 40x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 56x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 40x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x36: `button#btn-play-back.btn.btn-secondary "← Home"`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"

### nba-03-play @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-03-play--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 363x32: `button#btn-brand.brand "Draft Nova"`
- tap target 50x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 66x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 50x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x36: `button#btn-play-back.btn.btn-secondary "← Home"`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"

### nba-03-play @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-03-play--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 403x32: `button#btn-brand.brand "Draft Nova"`
- tap target 75x36: `button#btn-play-back.btn.btn-secondary "← Home"`

### nba-03-play @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-03-play--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x32: `button#nav-play.nav-tab.active "Play"`
- tap target 93x32: `button#nav-profile.nav-tab "Profile"`
- tap target 103x32: `button#nav-badges.nav-tab "Rewards"`
- tap target 91x32: `button#nav-squads.nav-tab "Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x32: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x27: `button#btn-play-back.btn.btn-secondary "← Home"`
- tap target 111x32: `button.era-chip.active "🏀All Years"`
- tap target 157x32: `button.era-chip "📻Grandpa's Game"`
- tap target 120x32: `button.era-chip "📼Unc Status"`
- tap target 127x32: `button.era-chip "📱Modern Ball"`

### nba-04-draft-empty @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-04-draft-empty--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 333x32: `button#btn-brand.brand "Draft Nova"`
- tap target 40x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 56x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 40x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 299x38: `input#pool-search`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 11.2px text: `span#draft-round-label.round-label "Round 1"` — "Round 1"
- 9.9px text: `span#squad-banner-era.squad-banner-era "🏀 All Years"` — "🏀 All Years"
- 11.2px text: `span#draft-turn-banner.turn-banner "Your Pick"` — "Your Pick"
- 11.5px text: `span.slot-tag "PG"` — "PG"
- 11.5px text: `span.slot-tag "SG"` — "SG"
- 11.5px text: `span.slot-tag "SF"` — "SF"
- 11.5px text: `span.slot-tag "PF"` — "PF"

### nba-04-draft-empty @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-04-draft-empty--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 363x32: `button#btn-brand.brand "Draft Nova"`
- tap target 50x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 66x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 50x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 329x38: `input#pool-search`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 11.2px text: `span#draft-round-label.round-label "Round 1"` — "Round 1"
- 9.9px text: `span#squad-banner-era.squad-banner-era "🏀 All Years"` — "🏀 All Years"
- 11.2px text: `span#draft-turn-banner.turn-banner "Your Pick"` — "Your Pick"
- 11.5px text: `span.slot-tag "PG"` — "PG"
- 11.5px text: `span.slot-tag "SG"` — "SG"
- 11.5px text: `span.slot-tag "SF"` — "SF"
- 11.5px text: `span.slot-tag "PF"` — "PF"

### nba-04-draft-empty @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-04-draft-empty--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 403x32: `button#btn-brand.brand "Draft Nova"`
- tap target 369x38: `input#pool-search`
- 11.2px text: `span#draft-round-label.round-label "Round 1"` — "Round 1"
- 9.9px text: `span#squad-banner-era.squad-banner-era "🏀 All Years"` — "🏀 All Years"
- 11.2px text: `span#draft-turn-banner.turn-banner "Your Pick"` — "Your Pick"
- 11.5px text: `span.slot-tag "PG"` — "PG"
- 11.5px text: `span.slot-tag "SG"` — "SG"
- 11.5px text: `span.slot-tag "SF"` — "SF"
- 11.5px text: `span.slot-tag "PF"` — "PF"
- 11.5px text: `span.slot-tag "6th Man"` — "6th Man"
- 10.9px text: `span.pos-chip "SF"` — "SF"
- 11.5px text: `div.player-stats "25.7 pts · 5.8 reb · 3.9"` — "25.7 pts · 5.8 reb · 3.9 ast ·"
- 11.2px text: `span.player-card-seasons "2 seasons"` — "2 seasons"
- 10.9px text: `span.pos-chip "PG"` — "PG"

### nba-04-draft-empty @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-04-draft-empty--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x32: `button#nav-play.nav-tab.active "Play"`
- tap target 93x32: `button#nav-profile.nav-tab "Profile"`
- tap target 103x32: `button#nav-badges.nav-tab "Rewards"`
- tap target 91x32: `button#nav-squads.nav-tab "Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x32: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 50x33: `button.position-btn "PG"`
- tap target 50x33: `button.position-btn "SG"`
- tap target 50x33: `button.position-btn "SF"`
- tap target 50x33: `button.position-btn "PF"`
- tap target 42x33: `button.position-btn "C"`
- 11.5px text: `span#squad-banner-era.squad-banner-era "🏀 All Years"` — "🏀 All Years"
- 11.5px text: `span.slot-tag "PG"` — "PG"
- 11.5px text: `span.slot-tag "SG"` — "SG"
- 11.5px text: `span.slot-tag "SF"` — "SF"
- 11.5px text: `span.slot-tag "PF"` — "PF"
- 11.5px text: `span.slot-tag "6th Man"` — "6th Man"
- 10.9px text: `span.pos-chip "SF"` — "SF"
- 11.5px text: `div.player-stats "25.7 pts · 5.8 reb · 3.9"` — "25.7 pts · 5.8 reb · 3.9 ast ·"
- 11.2px text: `span.player-card-seasons "2 seasons"` — "2 seasons"
- 10.9px text: `span.pos-chip "PG"` — "PG"
- 11.5px text: `div.player-stats "20.2 pts · 4.1 reb · 8.8"` — "20.2 pts · 4.1 reb · 8.8 ast ·"
- 11.2px text: `span.player-card-seasons "3 seasons"` — "3 seasons"

### nba-07-profile @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-profile--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 333x32: `button#btn-brand.brand "Draft Nova"`
- tap target 40x40: `button#nav-play.nav-tab "Play"`
- tap target 56x40: `button#nav-profile.nav-tab.active "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 56x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 40x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 38x38: `button.kit-swatch.kit-swatch-on`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- 11.2px text: `button#nav-play.nav-tab "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab.active "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 11.5px text: `span.era-record-label "Online"` — "Online"
- 11.5px text: `span.era-record-rank "Provisional"` — "Provisional"
- 11.5px text: `span.era-record-label "Offline"` — "Offline"
- 11.2px text: `th "Date"` — "Date"
- 11.2px text: `th "Result"` — "Result"
- 11.2px text: `th "Score"` — "Score"
- 11.2px text: `th "MVP"` — "MVP"

### nba-07-profile @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-profile--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 363x32: `button#btn-brand.brand "Draft Nova"`
- tap target 50x40: `button#nav-play.nav-tab "Play"`
- tap target 56x40: `button#nav-profile.nav-tab.active "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 66x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 50x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 38x38: `button.kit-swatch.kit-swatch-on`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- 11.2px text: `button#nav-play.nav-tab "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab.active "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 11.5px text: `span.era-record-label "Online"` — "Online"
- 11.5px text: `span.era-record-rank "Provisional"` — "Provisional"
- 11.5px text: `span.era-record-label "Offline"` — "Offline"
- 11.2px text: `th "Date"` — "Date"
- 11.2px text: `th "Result"` — "Result"
- 11.2px text: `th "Score"` — "Score"
- 11.2px text: `th "MVP"` — "MVP"

### nba-07-profile @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-profile--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 403x32: `button#btn-brand.brand "Draft Nova"`
- tap target 38x38: `button.kit-swatch.kit-swatch-on`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- 11.5px text: `span.era-record-label "Online"` — "Online"
- 11.5px text: `span.era-record-rank "Provisional"` — "Provisional"
- 11.5px text: `span.era-record-label "Offline"` — "Offline"
- 11.2px text: `th "Date"` — "Date"
- 11.2px text: `th "Result"` — "Result"
- 11.2px text: `th "Score"` — "Score"
- 11.2px text: `th "MVP"` — "MVP"

### nba-07-profile @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-profile--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x32: `button#nav-play.nav-tab "Play"`
- tap target 93x32: `button#nav-profile.nav-tab.active "Profile"`
- tap target 103x32: `button#nav-badges.nav-tab "Rewards"`
- tap target 91x32: `button#nav-squads.nav-tab "Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x32: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 38x38: `button.kit-swatch.kit-swatch-on`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- 11.5px text: `span.era-record-label "Online"` — "Online"
- 11.5px text: `span.era-record-rank "Provisional"` — "Provisional"
- 11.5px text: `span.era-record-label "Offline"` — "Offline"
- 11.2px text: `th "Date"` — "Date"
- 11.2px text: `th "Result"` — "Result"
- 11.2px text: `th "Score"` — "Score"
- 11.2px text: `th "MVP"` — "MVP"

### nba-07-badges @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-badges--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 333x32: `button#btn-brand.brand "Draft Nova"`
- tap target 40x40: `button#nav-play.nav-tab "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab.active "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 56x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 40x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x30: `button.subtab.active "Badges"`
- tap target 80x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 99x30: `button.subtab "Team Color"`
- tap target 76x30: `button.subtab.active "🏀 NBA"`
- 11.2px text: `button#nav-play.nav-tab "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab.active "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 11.5px text: `div.badge-progress "3 / 10 wins to Silver"` — "3 / 10 wins to Silver"
- 11.2px text: `button.btn.btn-secondary "Feature"` — "Feature"
- 11.5px text: `div.badge-progress "5 / 25 games to Silver"` — "5 / 25 games to Silver"
- 11.5px text: `div.badge-progress "0 / 500 points to Bronze"` — "0 / 500 points to Bronze"
- 11.5px text: `div.badge-progress "0 / 50 % wins to Bronze"` — "0 / 50 % wins to Bronze"
- 11.5px text: `div.badge-progress "0 / 100 assists to Bronz"` — "0 / 100 assists to Bronze"
- 11.5px text: `div.badge-progress "0 / 150 players to Bronz"` — "0 / 150 players to Bronze"

### nba-07-badges @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-badges--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 363x32: `button#btn-brand.brand "Draft Nova"`
- tap target 50x40: `button#nav-play.nav-tab "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab.active "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 66x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 50x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x30: `button.subtab.active "Badges"`
- tap target 80x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 99x30: `button.subtab "Team Color"`
- tap target 76x30: `button.subtab.active "🏀 NBA"`
- 11.2px text: `button#nav-play.nav-tab "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab.active "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 11.5px text: `div.badge-progress "3 / 10 wins to Silver"` — "3 / 10 wins to Silver"
- 11.2px text: `button.btn.btn-secondary "Feature"` — "Feature"
- 11.5px text: `div.badge-progress "5 / 25 games to Silver"` — "5 / 25 games to Silver"
- 11.5px text: `div.badge-progress "0 / 500 points to Bronze"` — "0 / 500 points to Bronze"
- 11.5px text: `div.badge-progress "0 / 50 % wins to Bronze"` — "0 / 50 % wins to Bronze"
- 11.5px text: `div.badge-progress "0 / 100 assists to Bronz"` — "0 / 100 assists to Bronze"
- 11.5px text: `div.badge-progress "0 / 150 players to Bronz"` — "0 / 150 players to Bronze"

### nba-07-badges @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-badges--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 403x32: `button#btn-brand.brand "Draft Nova"`
- tap target 75x30: `button.subtab.active "Badges"`
- tap target 80x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 99x30: `button.subtab "Team Color"`
- tap target 76x30: `button.subtab.active "🏀 NBA"`
- tap target 74x30: `button.subtab "🏈 NFL"`
- 11.5px text: `div.badge-progress "3 / 10 wins to Silver"` — "3 / 10 wins to Silver"
- 11.2px text: `button.btn.btn-secondary "Feature"` — "Feature"
- 11.5px text: `div.badge-progress "5 / 25 games to Silver"` — "5 / 25 games to Silver"
- 11.5px text: `div.badge-progress "0 / 500 points to Bronze"` — "0 / 500 points to Bronze"
- 11.5px text: `div.badge-progress "0 / 50 % wins to Bronze"` — "0 / 50 % wins to Bronze"
- 11.5px text: `div.badge-progress "0 / 100 assists to Bronz"` — "0 / 100 assists to Bronze"
- 11.5px text: `div.badge-progress "0 / 150 players to Bronz"` — "0 / 150 players to Bronze"
- 11.5px text: `div.badge-progress "0 / 200 rebounds to Bron"` — "0 / 200 rebounds to Bronze"
- 11.5px text: `div.badge-progress "0 / 45 points to Bronze"` — "0 / 45 points to Bronze"
- 11.5px text: `div.badge-progress "0 / 5 picks to Bronze"` — "0 / 5 picks to Bronze"
- 11.5px text: `div.badge-progress "0 / 12 assists to Bronze"` — "0 / 12 assists to Bronze"
- 11.5px text: `div.badge-progress "0 / 100 stops to Bronze"` — "0 / 100 stops to Bronze"

### nba-07-badges @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-badges--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x32: `button#nav-play.nav-tab "Play"`
- tap target 93x32: `button#nav-profile.nav-tab "Profile"`
- tap target 103x32: `button#nav-badges.nav-tab.active "Rewards"`
- tap target 91x32: `button#nav-squads.nav-tab "Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x32: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x30: `button.subtab.active "Badges"`
- tap target 80x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 99x30: `button.subtab "Team Color"`
- tap target 76x30: `button.subtab.active "🏀 NBA"`
- 11.5px text: `div.badge-progress "3 / 10 wins to Silver"` — "3 / 10 wins to Silver"
- 11.2px text: `button.btn.btn-secondary "Feature"` — "Feature"
- 11.5px text: `div.badge-progress "5 / 25 games to Silver"` — "5 / 25 games to Silver"
- 11.5px text: `div.badge-progress "0 / 500 points to Bronze"` — "0 / 500 points to Bronze"
- 11.5px text: `div.badge-progress "0 / 50 % wins to Bronze"` — "0 / 50 % wins to Bronze"
- 11.5px text: `div.badge-progress "0 / 100 assists to Bronz"` — "0 / 100 assists to Bronze"
- 11.5px text: `div.badge-progress "0 / 150 players to Bronz"` — "0 / 150 players to Bronze"
- 11.5px text: `div.badge-progress "0 / 200 rebounds to Bron"` — "0 / 200 rebounds to Bronze"
- 11.5px text: `div.badge-progress "0 / 45 points to Bronze"` — "0 / 45 points to Bronze"
- 11.5px text: `div.badge-progress "0 / 5 picks to Bronze"` — "0 / 5 picks to Bronze"
- 11.5px text: `div.badge-progress "0 / 12 assists to Bronze"` — "0 / 12 assists to Bronze"
- 11.5px text: `div.badge-progress "0 / 100 stops to Bronze"` — "0 / 100 stops to Bronze"

### nba-07-squads @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-squads--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 333x32: `button#btn-brand.brand "Draft Nova"`
- tap target 40x40: `button#nav-play.nav-tab "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab.active "Squads"`
- tap target 56x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 40x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 109x30: `button.subtab "Tournaments"`
- tap target 291x38: `input#input-squad-search`
- 11.2px text: `button#nav-play.nav-tab "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab.active "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"

### nba-07-squads @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-squads--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 363x32: `button#btn-brand.brand "Draft Nova"`
- tap target 50x40: `button#nav-play.nav-tab "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab.active "Squads"`
- tap target 66x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 50x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 109x30: `button.subtab "Tournaments"`
- tap target 321x38: `input#input-squad-search`
- 11.2px text: `button#nav-play.nav-tab "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab.active "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"

### nba-07-squads @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-squads--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 403x32: `button#btn-brand.brand "Draft Nova"`
- tap target 75x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 109x30: `button.subtab "Tournaments"`
- tap target 361x38: `input#input-squad-search`

### nba-07-squads @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-squads--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x32: `button#nav-play.nav-tab "Play"`
- tap target 93x32: `button#nav-profile.nav-tab "Profile"`
- tap target 103x32: `button#nav-badges.nav-tab "Rewards"`
- tap target 91x32: `button#nav-squads.nav-tab.active "Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x32: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 109x30: `button.subtab "Tournaments"`
- tap target 762x38: `input#input-squad-search`

### nfl-02-hub @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-02-hub--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 333x32: `button#btn-brand.brand "Draft Nova"`
- tap target 40x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 56x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 40x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 113x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 127x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 144x31: `button.sport-card-action "🏆 Rank"`
- tap target 144x31: `button.sport-card-action "📖 How to Play"`
- tap target 144x31: `button.sport-card-action "🏆 Rank"`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 10.9px text: `span#home-joined.pb-joined "Est. 01/2026"` — "Est. 01/2026"
- 10.6px text: `span.pb-stat-label "Rep"` — "Rep"
- 10.6px text: `span.pb-stat-label "Rank"` — "Rank"

### nfl-02-hub @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-02-hub--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 363x32: `button#btn-brand.brand "Draft Nova"`
- tap target 50x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 66x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 50x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 113x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 157x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 159x31: `button.sport-card-action "🏆 Rank"`
- tap target 159x31: `button.sport-card-action "📖 How to Play"`
- tap target 159x31: `button.sport-card-action "🏆 Rank"`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 10.9px text: `span#home-joined.pb-joined "Est. 01/2026"` — "Est. 01/2026"
- 10.6px text: `span.pb-stat-label "Rep"` — "Rep"
- 10.6px text: `span.pb-stat-label "Rank"` — "Rank"

### nfl-02-hub @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-02-hub--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 403x32: `button#btn-brand.brand "Draft Nova"`
- tap target 113x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 197x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 179x31: `button.sport-card-action "🏆 Rank"`
- tap target 179x31: `button.sport-card-action "📖 How to Play"`
- tap target 179x31: `button.sport-card-action "🏆 Rank"`
- tap target 179x31: `button.sport-card-action "📖 How to Play"`
- 10.9px text: `span#home-joined.pb-joined "Est. 01/2026"` — "Est. 01/2026"
- 10.6px text: `span.pb-stat-label "Rep"` — "Rep"
- 10.6px text: `span.pb-stat-label "Rank"` — "Rank"

### nfl-02-hub @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-02-hub--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x32: `button#nav-play.nav-tab.active "Play"`
- tap target 93x32: `button#nav-profile.nav-tab "Profile"`
- tap target 103x32: `button#nav-badges.nav-tab "Rewards"`
- tap target 91x32: `button#nav-squads.nav-tab "Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x32: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 113x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 126x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 81x31: `button.sport-card-action "🏆 Rank"`
- tap target 121x31: `button.sport-card-action "📖 How to Play"`
- tap target 81x31: `button.sport-card-action "🏆 Rank"`
- 10.9px text: `span#home-joined.pb-joined "Est. 01/2026"` — "Est. 01/2026"
- 10.6px text: `span.pb-stat-label "Rep"` — "Rep"
- 10.6px text: `span.pb-stat-label "Rank"` — "Rank"

### nfl-03-play @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-03-play--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 333x32: `button#btn-brand.brand "Draft Nova"`
- tap target 40x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 56x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 40x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x36: `button#btn-play-back.btn.btn-secondary "← Home"`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"

### nfl-03-play @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-03-play--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 363x32: `button#btn-brand.brand "Draft Nova"`
- tap target 50x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 66x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 50x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x36: `button#btn-play-back.btn.btn-secondary "← Home"`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"

### nfl-03-play @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-03-play--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 403x32: `button#btn-brand.brand "Draft Nova"`
- tap target 75x36: `button#btn-play-back.btn.btn-secondary "← Home"`

### nfl-03-play @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-03-play--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x32: `button#nav-play.nav-tab.active "Play"`
- tap target 93x32: `button#nav-profile.nav-tab "Profile"`
- tap target 103x32: `button#nav-badges.nav-tab "Rewards"`
- tap target 91x32: `button#nav-squads.nav-tab "Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x32: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x27: `button#btn-play-back.btn.btn-secondary "← Home"`
- tap target 111x32: `button.era-chip.active "🏈All Years"`
- tap target 91x32: `button.era-chip "📼2000s"`
- tap target 91x32: `button.era-chip "📱2010s"`
- tap target 91x32: `button.era-chip "🚀2020s"`

### nfl-04-draft-empty @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-04-draft-empty--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 333x32: `button#btn-brand.brand "Draft Nova"`
- tap target 40x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 56x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 40x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 299x38: `input#pool-search`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 11.2px text: `span#draft-round-label.round-label "Round 1"` — "Round 1"
- 9.9px text: `span#squad-banner-era.squad-banner-era "🏈 All Years"` — "🏈 All Years"
- 11.2px text: `span#draft-turn-banner.turn-banner "Your Pick"` — "Your Pick"
- 11.5px text: `span.slot-tag "QB"` — "QB"
- 11.5px text: `span.slot-tag "RB"` — "RB"
- 11.5px text: `span.slot-tag "WR"` — "WR"
- 11.5px text: `span.slot-tag "TE"` — "TE"

### nfl-04-draft-empty @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-04-draft-empty--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 363x32: `button#btn-brand.brand "Draft Nova"`
- tap target 50x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 66x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 50x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 329x38: `input#pool-search`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 11.2px text: `span#draft-round-label.round-label "Round 1"` — "Round 1"
- 9.9px text: `span#squad-banner-era.squad-banner-era "🏈 All Years"` — "🏈 All Years"
- 11.2px text: `span#draft-turn-banner.turn-banner "Your Pick"` — "Your Pick"
- 11.5px text: `span.slot-tag "QB"` — "QB"
- 11.5px text: `span.slot-tag "RB"` — "RB"
- 11.5px text: `span.slot-tag "WR"` — "WR"
- 11.5px text: `span.slot-tag "TE"` — "TE"

### nfl-04-draft-empty @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-04-draft-empty--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 403x32: `button#btn-brand.brand "Draft Nova"`
- tap target 369x38: `input#pool-search`
- 11.2px text: `span#draft-round-label.round-label "Round 1"` — "Round 1"
- 9.9px text: `span#squad-banner-era.squad-banner-era "🏈 All Years"` — "🏈 All Years"
- 11.2px text: `span#draft-turn-banner.turn-banner "Your Pick"` — "Your Pick"
- 11.5px text: `span.slot-tag "QB"` — "QB"
- 11.5px text: `span.slot-tag "RB"` — "RB"
- 11.5px text: `span.slot-tag "WR"` — "WR"
- 11.5px text: `span.slot-tag "TE"` — "TE"
- 11.5px text: `span.slot-tag "OL"` — "OL"
- 11.5px text: `span.slot-tag "DEF"` — "DEF"
- 10.9px text: `span.pos-chip "QB"` — "QB"
- 11.5px text: `div.player-stats "313 pass yds · 2.5 TD · "` — "313 pass yds · 2.5 TD · 0.7 IN"
- 11.2px text: `span.player-card-seasons "3 seasons"` — "3 seasons"

### nfl-04-draft-empty @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-04-draft-empty--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x32: `button#nav-play.nav-tab.active "Play"`
- tap target 93x32: `button#nav-profile.nav-tab "Profile"`
- tap target 103x32: `button#nav-badges.nav-tab "Rewards"`
- tap target 91x32: `button#nav-squads.nav-tab "Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x32: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 50x33: `button.position-btn "QB"`
- tap target 50x33: `button.position-btn "RB"`
- tap target 50x33: `button.position-btn "WR"`
- tap target 50x33: `button.position-btn "TE"`
- tap target 50x33: `button.position-btn "OL"`
- 11.5px text: `span#squad-banner-era.squad-banner-era "🏈 All Years"` — "🏈 All Years"
- 11.5px text: `span.slot-tag "QB"` — "QB"
- 11.5px text: `span.slot-tag "RB"` — "RB"
- 11.5px text: `span.slot-tag "WR"` — "WR"
- 11.5px text: `span.slot-tag "TE"` — "TE"
- 11.5px text: `span.slot-tag "OL"` — "OL"
- 11.5px text: `span.slot-tag "DEF"` — "DEF"
- 10.9px text: `span.pos-chip "QB"` — "QB"
- 11.5px text: `div.player-stats "313 pass yds · 2.5 TD · "` — "313 pass yds · 2.5 TD · 0.7 IN"
- 11.2px text: `span.player-card-seasons "3 seasons"` — "3 seasons"
- 10.9px text: `span.pos-chip "WR"` — "WR"
- 11.5px text: `div.player-stats "4.9 rec · 60 yds · 0.1 T"` — "4.9 rec · 60 yds · 0.1 TD"

### nfl-05-game-live @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-05-game-live--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 333x32: `button#btn-brand.brand "Draft Nova"`
- tap target 40x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 56x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 40x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 8.8px text: `span "SelfTest"` — "SelfTest"
- 8px text: `span.ff-yardnum "10"` — "10"
- 8px text: `span.ff-yardnum "20"` — "20"
- 8px text: `span.ff-yardnum "30"` — "30"
- 8px text: `span.ff-yardnum "40"` — "40"
- 8px text: `span.ff-yardnum "50"` — "50"
- 8.8px text: `span "Bot"` — "Bot"

### nfl-05-game-live @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-05-game-live--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 363x32: `button#btn-brand.brand "Draft Nova"`
- tap target 50x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 66x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 50x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 8.8px text: `span "SelfTest"` — "SelfTest"
- 8px text: `span.ff-yardnum "10"` — "10"
- 8px text: `span.ff-yardnum "20"` — "20"
- 8px text: `span.ff-yardnum "30"` — "30"
- 8px text: `span.ff-yardnum "40"` — "40"
- 8px text: `span.ff-yardnum "50"` — "50"
- 8.8px text: `span "Bot"` — "Bot"

### nfl-05-game-live @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-05-game-live--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 403x32: `button#btn-brand.brand "Draft Nova"`
- 11.5px text: `span.ff-downdist "2nd & 7 · SelfTest"` — "2nd & 7 · SelfTest"
- 8.8px text: `span "SelfTest"` — "SelfTest"
- 8px text: `span.ff-yardnum "10"` — "10"
- 8px text: `span.ff-yardnum "20"` — "20"
- 8px text: `span.ff-yardnum "30"` — "30"
- 8px text: `span.ff-yardnum "40"` — "40"
- 8px text: `span.ff-yardnum "50"` — "50"
- 8.8px text: `span "Bot"` — "Bot"
- 11.5px text: `div.box-group-label "Offense"` — "Offense"
- 11.2px text: `th "Slot"` — "Slot"
- 11.2px text: `th "Player"` — "Player"
- 11.2px text: `th "TOT YDS"` — "TOT YDS"

### nfl-05-game-live @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-05-game-live--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x32: `button#nav-play.nav-tab.active "Play"`
- tap target 93x32: `button#nav-profile.nav-tab "Profile"`
- tap target 103x32: `button#nav-badges.nav-tab "Rewards"`
- tap target 91x32: `button#nav-squads.nav-tab "Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x32: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- 8.8px text: `span "SelfTest"` — "SelfTest"
- 8px text: `span.ff-yardnum "10"` — "10"
- 8px text: `span.ff-yardnum "20"` — "20"
- 8px text: `span.ff-yardnum "30"` — "30"
- 8px text: `span.ff-yardnum "40"` — "40"
- 8px text: `span.ff-yardnum "50"` — "50"
- 8.8px text: `span "Bot"` — "Bot"
- 11.5px text: `div.box-group-label "Offense"` — "Offense"
- 11.2px text: `th "Slot"` — "Slot"
- 11.2px text: `th "Player"` — "Player"
- 11.2px text: `th "TOT YDS"` — "TOT YDS"
- 11.2px text: `th "COMP"` — "COMP"

### nfl-06-game-final @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-06-game-final--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 333x32: `button#btn-brand.brand "Draft Nova"`
- tap target 40x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 56x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 40x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 11.2px text: `th "Q1"` — "Q1"
- 11.2px text: `th "Q2"` — "Q2"
- 11.2px text: `th "Q3"` — "Q3"
- 11.2px text: `th "Q4"` — "Q4"
- 8.8px text: `span "SelfTest"` — "SelfTest"
- 8px text: `span.ff-yardnum "10"` — "10"
- 8px text: `span.ff-yardnum "20"` — "20"

### nfl-06-game-final @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-06-game-final--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 363x32: `button#btn-brand.brand "Draft Nova"`
- tap target 50x40: `button#nav-play.nav-tab.active "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 66x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 50x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- 11.2px text: `button#nav-play.nav-tab.active "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 11.2px text: `th "Q1"` — "Q1"
- 11.2px text: `th "Q2"` — "Q2"
- 11.2px text: `th "Q3"` — "Q3"
- 11.2px text: `th "Q4"` — "Q4"
- 8.8px text: `span "SelfTest"` — "SelfTest"
- 8px text: `span.ff-yardnum "10"` — "10"
- 8px text: `span.ff-yardnum "20"` — "20"

### nfl-06-game-final @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-06-game-final--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 403x32: `button#btn-brand.brand "Draft Nova"`
- 11.2px text: `th "Q1"` — "Q1"
- 11.2px text: `th "Q2"` — "Q2"
- 11.2px text: `th "Q3"` — "Q3"
- 11.2px text: `th "Q4"` — "Q4"
- 8.8px text: `span "SelfTest"` — "SelfTest"
- 8px text: `span.ff-yardnum "10"` — "10"
- 8px text: `span.ff-yardnum "20"` — "20"
- 8px text: `span.ff-yardnum "30"` — "30"
- 8px text: `span.ff-yardnum "40"` — "40"
- 8px text: `span.ff-yardnum "50"` — "50"
- 8.8px text: `span "Bot"` — "Bot"
- 11.5px text: `div.box-group-label "Offense"` — "Offense"

### nfl-06-game-final @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-06-game-final--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x32: `button#nav-play.nav-tab.active "Play"`
- tap target 93x32: `button#nav-profile.nav-tab "Profile"`
- tap target 103x32: `button#nav-badges.nav-tab "Rewards"`
- tap target 91x32: `button#nav-squads.nav-tab "Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x32: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 397x40: `button#btn-to-profile.btn.btn-secondary "View Profile"`
- tap target 395x40: `button#btn-play-again.btn.btn-primary "Play Again"`
- tap target 804x40: `button#btn-game-home.btn.btn-secondary "Return to Home"`
- 11.2px text: `th "Q1"` — "Q1"
- 11.2px text: `th "Q2"` — "Q2"
- 11.2px text: `th "Q3"` — "Q3"
- 11.2px text: `th "Q4"` — "Q4"
- 8.8px text: `span "SelfTest"` — "SelfTest"
- 8px text: `span.ff-yardnum "10"` — "10"
- 8px text: `span.ff-yardnum "20"` — "20"
- 8px text: `span.ff-yardnum "30"` — "30"
- 8px text: `span.ff-yardnum "40"` — "40"
- 8px text: `span.ff-yardnum "50"` — "50"
- 8.8px text: `span "Bot"` — "Bot"
- 11.5px text: `div.box-group-label "Offense"` — "Offense"

### nfl-07-profile @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-profile--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 333x32: `button#btn-brand.brand "Draft Nova"`
- tap target 40x40: `button#nav-play.nav-tab "Play"`
- tap target 56x40: `button#nav-profile.nav-tab.active "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 56x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 40x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 38x38: `button.kit-swatch.kit-swatch-on`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- 11.2px text: `button#nav-play.nav-tab "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab.active "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 11.5px text: `span.era-record-label "Online"` — "Online"
- 11.5px text: `span.era-record-rank "Provisional"` — "Provisional"
- 11.5px text: `span.era-record-label "Offline"` — "Offline"
- 11.2px text: `th "Date"` — "Date"
- 11.2px text: `th "Result"` — "Result"
- 11.2px text: `th "Score"` — "Score"
- 11.2px text: `th "MVP"` — "MVP"

### nfl-07-profile @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-profile--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 363x32: `button#btn-brand.brand "Draft Nova"`
- tap target 50x40: `button#nav-play.nav-tab "Play"`
- tap target 56x40: `button#nav-profile.nav-tab.active "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 66x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 50x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 38x38: `button.kit-swatch.kit-swatch-on`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- 11.2px text: `button#nav-play.nav-tab "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab.active "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 11.5px text: `span.era-record-label "Online"` — "Online"
- 11.5px text: `span.era-record-rank "Provisional"` — "Provisional"
- 11.5px text: `span.era-record-label "Offline"` — "Offline"
- 11.2px text: `th "Date"` — "Date"
- 11.2px text: `th "Result"` — "Result"
- 11.2px text: `th "Score"` — "Score"
- 11.2px text: `th "MVP"` — "MVP"

### nfl-07-profile @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-profile--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 403x32: `button#btn-brand.brand "Draft Nova"`
- tap target 38x38: `button.kit-swatch.kit-swatch-on`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- 11.5px text: `span.era-record-label "Online"` — "Online"
- 11.5px text: `span.era-record-rank "Provisional"` — "Provisional"
- 11.5px text: `span.era-record-label "Offline"` — "Offline"
- 11.2px text: `th "Date"` — "Date"
- 11.2px text: `th "Result"` — "Result"
- 11.2px text: `th "Score"` — "Score"
- 11.2px text: `th "MVP"` — "MVP"

### nfl-07-profile @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-profile--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x32: `button#nav-play.nav-tab "Play"`
- tap target 93x32: `button#nav-profile.nav-tab.active "Profile"`
- tap target 103x32: `button#nav-badges.nav-tab "Rewards"`
- tap target 91x32: `button#nav-squads.nav-tab "Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x32: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 38x38: `button.kit-swatch.kit-swatch-on`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- 11.5px text: `span.era-record-label "Online"` — "Online"
- 11.5px text: `span.era-record-rank "Provisional"` — "Provisional"
- 11.5px text: `span.era-record-label "Offline"` — "Offline"
- 11.2px text: `th "Date"` — "Date"
- 11.2px text: `th "Result"` — "Result"
- 11.2px text: `th "Score"` — "Score"
- 11.2px text: `th "MVP"` — "MVP"

### nfl-07-badges @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-badges--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 333x32: `button#btn-brand.brand "Draft Nova"`
- tap target 40x40: `button#nav-play.nav-tab "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab.active "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 56x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 40x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x30: `button.subtab.active "Badges"`
- tap target 80x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 99x30: `button.subtab "Team Color"`
- tap target 76x30: `button.subtab.active "🏀 NBA"`
- 11.2px text: `button#nav-play.nav-tab "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab.active "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 11.5px text: `div.badge-progress "3 / 10 wins to Silver"` — "3 / 10 wins to Silver"
- 11.2px text: `button.btn.btn-secondary "Feature"` — "Feature"
- 11.5px text: `div.badge-progress "5 / 25 games to Silver"` — "5 / 25 games to Silver"
- 11.5px text: `div.badge-progress "0 / 500 points to Bronze"` — "0 / 500 points to Bronze"
- 11.5px text: `div.badge-progress "0 / 50 % wins to Bronze"` — "0 / 50 % wins to Bronze"
- 11.5px text: `div.badge-progress "0 / 100 assists to Bronz"` — "0 / 100 assists to Bronze"
- 11.5px text: `div.badge-progress "0 / 150 players to Bronz"` — "0 / 150 players to Bronze"

### nfl-07-badges @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-badges--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 363x32: `button#btn-brand.brand "Draft Nova"`
- tap target 50x40: `button#nav-play.nav-tab "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab.active "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab "Squads"`
- tap target 66x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 50x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x30: `button.subtab.active "Badges"`
- tap target 80x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 99x30: `button.subtab "Team Color"`
- tap target 76x30: `button.subtab.active "🏀 NBA"`
- 11.2px text: `button#nav-play.nav-tab "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab.active "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"
- 11.5px text: `div.badge-progress "3 / 10 wins to Silver"` — "3 / 10 wins to Silver"
- 11.2px text: `button.btn.btn-secondary "Feature"` — "Feature"
- 11.5px text: `div.badge-progress "5 / 25 games to Silver"` — "5 / 25 games to Silver"
- 11.5px text: `div.badge-progress "0 / 500 points to Bronze"` — "0 / 500 points to Bronze"
- 11.5px text: `div.badge-progress "0 / 50 % wins to Bronze"` — "0 / 50 % wins to Bronze"
- 11.5px text: `div.badge-progress "0 / 100 assists to Bronz"` — "0 / 100 assists to Bronze"
- 11.5px text: `div.badge-progress "0 / 150 players to Bronz"` — "0 / 150 players to Bronze"

### nfl-07-badges @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-badges--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 403x32: `button#btn-brand.brand "Draft Nova"`
- tap target 75x30: `button.subtab.active "Badges"`
- tap target 80x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 99x30: `button.subtab "Team Color"`
- tap target 76x30: `button.subtab.active "🏀 NBA"`
- tap target 74x30: `button.subtab "🏈 NFL"`
- 11.5px text: `div.badge-progress "3 / 10 wins to Silver"` — "3 / 10 wins to Silver"
- 11.2px text: `button.btn.btn-secondary "Feature"` — "Feature"
- 11.5px text: `div.badge-progress "5 / 25 games to Silver"` — "5 / 25 games to Silver"
- 11.5px text: `div.badge-progress "0 / 500 points to Bronze"` — "0 / 500 points to Bronze"
- 11.5px text: `div.badge-progress "0 / 50 % wins to Bronze"` — "0 / 50 % wins to Bronze"
- 11.5px text: `div.badge-progress "0 / 100 assists to Bronz"` — "0 / 100 assists to Bronze"
- 11.5px text: `div.badge-progress "0 / 150 players to Bronz"` — "0 / 150 players to Bronze"
- 11.5px text: `div.badge-progress "0 / 200 rebounds to Bron"` — "0 / 200 rebounds to Bronze"
- 11.5px text: `div.badge-progress "0 / 45 points to Bronze"` — "0 / 45 points to Bronze"
- 11.5px text: `div.badge-progress "0 / 5 picks to Bronze"` — "0 / 5 picks to Bronze"
- 11.5px text: `div.badge-progress "0 / 12 assists to Bronze"` — "0 / 12 assists to Bronze"
- 11.5px text: `div.badge-progress "0 / 100 stops to Bronze"` — "0 / 100 stops to Bronze"

### nfl-07-badges @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-badges--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x32: `button#nav-play.nav-tab "Play"`
- tap target 93x32: `button#nav-profile.nav-tab "Profile"`
- tap target 103x32: `button#nav-badges.nav-tab.active "Rewards"`
- tap target 91x32: `button#nav-squads.nav-tab "Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x32: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x30: `button.subtab.active "Badges"`
- tap target 80x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 99x30: `button.subtab "Team Color"`
- tap target 76x30: `button.subtab.active "🏀 NBA"`
- 11.5px text: `div.badge-progress "3 / 10 wins to Silver"` — "3 / 10 wins to Silver"
- 11.2px text: `button.btn.btn-secondary "Feature"` — "Feature"
- 11.5px text: `div.badge-progress "5 / 25 games to Silver"` — "5 / 25 games to Silver"
- 11.5px text: `div.badge-progress "0 / 500 points to Bronze"` — "0 / 500 points to Bronze"
- 11.5px text: `div.badge-progress "0 / 50 % wins to Bronze"` — "0 / 50 % wins to Bronze"
- 11.5px text: `div.badge-progress "0 / 100 assists to Bronz"` — "0 / 100 assists to Bronze"
- 11.5px text: `div.badge-progress "0 / 150 players to Bronz"` — "0 / 150 players to Bronze"
- 11.5px text: `div.badge-progress "0 / 200 rebounds to Bron"` — "0 / 200 rebounds to Bronze"
- 11.5px text: `div.badge-progress "0 / 45 points to Bronze"` — "0 / 45 points to Bronze"
- 11.5px text: `div.badge-progress "0 / 5 picks to Bronze"` — "0 / 5 picks to Bronze"
- 11.5px text: `div.badge-progress "0 / 12 assists to Bronze"` — "0 / 12 assists to Bronze"
- 11.5px text: `div.badge-progress "0 / 100 stops to Bronze"` — "0 / 100 stops to Bronze"

### nfl-07-squads @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-squads--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 333x32: `button#btn-brand.brand "Draft Nova"`
- tap target 40x40: `button#nav-play.nav-tab "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab.active "Squads"`
- tap target 56x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 40x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 109x30: `button.subtab "Tournaments"`
- tap target 291x38: `input#input-squad-search`
- 11.2px text: `button#nav-play.nav-tab "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab.active "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"

### nfl-07-squads @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-squads--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 363x32: `button#btn-brand.brand "Draft Nova"`
- tap target 50x40: `button#nav-play.nav-tab "Play"`
- tap target 56x40: `button#nav-profile.nav-tab "Profile"`
- tap target 65x40: `button#nav-badges.nav-tab "Rewards"`
- tap target 55x40: `button#nav-squads.nav-tab.active "Squads"`
- tap target 66x40: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 50x40: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 109x30: `button.subtab "Tournaments"`
- tap target 321x38: `input#input-squad-search`
- 11.2px text: `button#nav-play.nav-tab "Play"` — "Play"
- 11.2px text: `button#nav-profile.nav-tab "Profile"` — "Profile"
- 11.2px text: `button#nav-badges.nav-tab "Rewards"` — "Rewards"
- 11.2px text: `button#nav-squads.nav-tab.active "Squads"` — "Squads"
- 11.2px text: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"` — "Sign Out"

### nfl-07-squads @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-squads--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 403x32: `button#btn-brand.brand "Draft Nova"`
- tap target 75x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 109x30: `button.subtab "Tournaments"`
- tap target 361x38: `input#input-squad-search`

### nfl-07-squads @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-squads--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x32: `button#nav-play.nav-tab "Play"`
- tap target 93x32: `button#nav-profile.nav-tab "Profile"`
- tap target 103x32: `button#nav-badges.nav-tab "Rewards"`
- tap target 91x32: `button#nav-squads.nav-tab.active "Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x32: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 75x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 109x30: `button.subtab "Tournaments"`
- tap target 762x38: `input#input-squad-search`

## Run log

```
Mobile baseline — serving /home/user/Gamebuild at http://127.0.0.1:8934/
Writing to docs/audits/2026-09-02-mobile-baseline

NBA
  already signed in (existing session restored)
    nba-02-hub @ android-360: 13 small target(s), 8 tiny text, 0 escaping, 0px h-overflow
    nba-02-hub @ iphone-390: 13 small target(s), 8 tiny text, 0 escaping, 0px h-overflow
    nba-02-hub @ iphone-max-430: 7 small target(s), 3 tiny text, 0 escaping, 0px h-overflow
    nba-02-hub @ landscape-844: 13 small target(s), 3 tiny text, 0 escaping, 0px h-overflow
  nba: play screen open
    nba-03-play @ android-360: 8 small target(s), 5 tiny text, 0 escaping, 0px h-overflow
    nba-03-play @ iphone-390: 8 small target(s), 5 tiny text, 0 escaping, 0px h-overflow
    nba-03-play @ iphone-max-430: 2 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-03-play @ landscape-844: 13 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-04-draft-empty @ android-360: 8 small target(s), 42 tiny text, 0 escaping, 0px h-overflow
    nba-04-draft-empty @ iphone-390: 8 small target(s), 42 tiny text, 0 escaping, 0px h-overflow
    nba-04-draft-empty @ iphone-max-430: 2 small target(s), 37 tiny text, 0 escaping, 0px h-overflow
    nba-04-draft-empty @ landscape-844: 14 small target(s), 35 tiny text, 0 escaping, 0px h-overflow
  nba round 1: Vince Carter
  nba round 2: Terry Cummings
  nba round 3: Jalen Brunson
  nba round 4: Dirk Nowitzki
  nba round 5: Monta Ellis
  draft did not complete: nba: draft did not finish inside its time budget
  drafted 0 round(s)
  nba: rotation phase not shown (mode may skip it)
  nba: matchups phase not shown (mode may skip it)
  strategy rounds: 0
    nba-07-profile @ android-360: 28 small target(s), 12 tiny text, 0 escaping, 0px h-overflow
    nba-07-profile @ iphone-390: 28 small target(s), 12 tiny text, 0 escaping, 0px h-overflow
    nba-07-profile @ iphone-max-430: 22 small target(s), 7 tiny text, 0 escaping, 0px h-overflow
    nba-07-profile @ landscape-844: 28 small target(s), 7 tiny text, 0 escaping, 0px h-overflow
    nba-07-badges @ android-360: 13 small target(s), 26 tiny text, 0 escaping, 0px h-overflow
    nba-07-badges @ iphone-390: 13 small target(s), 26 tiny text, 0 escaping, 0px h-overflow
    nba-07-badges @ iphone-max-430: 7 small target(s), 21 tiny text, 0 escaping, 0px h-overflow
    nba-07-badges @ landscape-844: 15 small target(s), 21 tiny text, 0 escaping, 0px h-overflow
    nba-07-squads @ android-360: 12 small target(s), 5 tiny text, 0 escaping, 0px h-overflow
    nba-07-squads @ iphone-390: 12 small target(s), 5 tiny text, 0 escaping, 0px h-overflow
    nba-07-squads @ iphone-max-430: 6 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-squads @ landscape-844: 14 small target(s), 0 tiny text, 0 escaping, 0px h-overflow

NFL
  already signed in (existing session restored)
    nfl-02-hub @ android-360: 13 small target(s), 8 tiny text, 0 escaping, 0px h-overflow
    nfl-02-hub @ iphone-390: 13 small target(s), 8 tiny text, 0 escaping, 0px h-overflow
    nfl-02-hub @ iphone-max-430: 7 small target(s), 3 tiny text, 0 escaping, 0px h-overflow
    nfl-02-hub @ landscape-844: 13 small target(s), 3 tiny text, 0 escaping, 0px h-overflow
  nfl: play screen open
    nfl-03-play @ android-360: 8 small target(s), 5 tiny text, 0 escaping, 0px h-overflow
    nfl-03-play @ iphone-390: 8 small target(s), 5 tiny text, 0 escaping, 0px h-overflow
    nfl-03-play @ iphone-max-430: 2 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-03-play @ landscape-844: 13 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-04-draft-empty @ android-360: 8 small target(s), 70 tiny text, 0 escaping, 0px h-overflow
    nfl-04-draft-empty @ iphone-390: 8 small target(s), 70 tiny text, 0 escaping, 0px h-overflow
    nfl-04-draft-empty @ iphone-max-430: 2 small target(s), 65 tiny text, 0 escaping, 0px h-overflow
    nfl-04-draft-empty @ landscape-844: 14 small target(s), 63 tiny text, 0 escaping, 0px h-overflow
  nfl round 1: Rachaad White
  nfl round 2: Joe Horn
  nfl round 3: Aaron Rodgers
  nfl round 4: San Francisco 49ers Offensive Line
  nfl round 5: Jacob Tamme
  nfl round 6: Miami Dolphins Linebackers
  drafted 6 round(s)
  nfl: rotation phase not shown (mode may skip it)
  nfl: matchups phase not shown (mode may skip it)
  nfl: gameplan chosen over 2 rounds, game started
  nfl: round 1 offered 3 card(s) — Offensive Gameplan — Round 1 of 2
  nfl: round 2 offered 3 card(s) — Defensive Gameplan — Round 2 of 2
  strategy rounds: 2
    nfl-05-game-live @ android-360: 7 small target(s), 40 tiny text, 0 escaping, 0px h-overflow
    nfl-05-game-live @ iphone-390: 7 small target(s), 40 tiny text, 0 escaping, 0px h-overflow
    nfl-05-game-live @ iphone-max-430: 1 small target(s), 36 tiny text, 0 escaping, 0px h-overflow
    nfl-05-game-live @ landscape-844: 7 small target(s), 35 tiny text, 0 escaping, 0px h-overflow
    nfl-06-game-final @ android-360: 7 small target(s), 44 tiny text, 0 escaping, 0px h-overflow
    nfl-06-game-final @ iphone-390: 7 small target(s), 44 tiny text, 0 escaping, 0px h-overflow
    nfl-06-game-final @ iphone-max-430: 1 small target(s), 39 tiny text, 0 escaping, 0px h-overflow
    nfl-06-game-final @ landscape-844: 10 small target(s), 39 tiny text, 0 escaping, 0px h-overflow
    nfl-07-profile @ android-360: 28 small target(s), 12 tiny text, 0 escaping, 0px h-overflow
    nfl-07-profile @ iphone-390: 28 small target(s), 12 tiny text, 0 escaping, 0px h-overflow
    nfl-07-profile @ iphone-max-430: 22 small target(s), 7 tiny text, 0 escaping, 0px h-overflow
    nfl-07-profile @ landscape-844: 28 small target(s), 7 tiny text, 0 escaping, 0px h-overflow
    nfl-07-badges @ android-360: 13 small target(s), 26 tiny text, 0 escaping, 0px h-overflow
    nfl-07-badges @ iphone-390: 13 small target(s), 26 tiny text, 0 escaping, 0px h-overflow
    nfl-07-badges @ iphone-max-430: 7 small target(s), 21 tiny text, 0 escaping, 0px h-overflow
    nfl-07-badges @ landscape-844: 15 small target(s), 21 tiny text, 0 escaping, 0px h-overflow
    nfl-07-squads @ android-360: 12 small target(s), 5 tiny text, 0 escaping, 0px h-overflow
    nfl-07-squads @ iphone-390: 12 small target(s), 5 tiny text, 0 escaping, 0px h-overflow
    nfl-07-squads @ iphone-max-430: 6 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-squads @ landscape-844: 14 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
```