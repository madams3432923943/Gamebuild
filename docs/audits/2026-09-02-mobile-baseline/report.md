# Mobile baseline — 2026-09-02

Captured by `npm run baseline:mobile`. This is the BEFORE state for the phone-first
rework: every screen, at four phone sizes, in a real touch context. It is evidence,
not a gate — the script exits 0 whatever it finds.

Tap-target floor: 44px. Readable-text floor: 12px.

## Summary

| screen | phone | tap targets < 44px | text < 12px | escaping | h-overflow |
| --- | --- | --- | --- | --- | --- |
| nba-02-hub | android-360 | 6 | 0 | 0 | 0px |
| nba-02-hub | iphone-390 | 7 | 0 | 0 | 0px |
| nba-02-hub | iphone-max-430 | 7 | 0 | 0 | 0px |
| nba-02-hub | landscape-844 | 13 | 0 | 0 | 0px |
| nba-03-play | android-360 | 1 | 0 | 0 | 0px |
| nba-03-play | iphone-390 | 2 | 0 | 0 | 0px |
| nba-03-play | iphone-max-430 | 2 | 0 | 0 | 0px |
| nba-03-play | landscape-844 | 13 | 0 | 0 | 0px |
| nba-04-draft-empty | android-360 | 1 | 0 | 0 | 0px |
| nba-04-draft-empty | iphone-390 | 2 | 0 | 0 | 0px |
| nba-04-draft-empty | iphone-max-430 | 2 | 0 | 0 | 0px |
| nba-04-draft-empty | landscape-844 | 14 | 0 | 0 | 0px |
| nba-05-game-live | android-360 | 0 | 0 | 0 | 0px |
| nba-05-game-live | iphone-390 | 1 | 0 | 0 | 0px |
| nba-05-game-live | iphone-max-430 | 1 | 0 | 0 | 0px |
| nba-05-game-live | landscape-844 | 7 | 0 | 0 | 0px |
| nba-06-game-final | android-360 | 0 | 0 | 0 | 0px |
| nba-06-game-final | iphone-390 | 1 | 0 | 0 | 0px |
| nba-06-game-final | iphone-max-430 | 1 | 0 | 0 | 0px |
| nba-06-game-final | landscape-844 | 10 | 0 | 0 | 0px |
| nba-07-profile | android-360 | 21 | 0 | 0 | 0px |
| nba-07-profile | iphone-390 | 22 | 0 | 0 | 0px |
| nba-07-profile | iphone-max-430 | 22 | 0 | 0 | 0px |
| nba-07-profile | landscape-844 | 28 | 0 | 0 | 0px |
| nba-07-badges | android-360 | 6 | 0 | 0 | 0px |
| nba-07-badges | iphone-390 | 7 | 0 | 0 | 0px |
| nba-07-badges | iphone-max-430 | 7 | 0 | 0 | 0px |
| nba-07-badges | landscape-844 | 15 | 0 | 0 | 0px |
| nba-07-squads | android-360 | 5 | 0 | 0 | 0px |
| nba-07-squads | iphone-390 | 6 | 0 | 0 | 0px |
| nba-07-squads | iphone-max-430 | 6 | 0 | 0 | 0px |
| nba-07-squads | landscape-844 | 14 | 0 | 0 | 0px |
| nfl-02-hub | android-360 | 6 | 0 | 0 | 0px |
| nfl-02-hub | iphone-390 | 7 | 0 | 0 | 0px |
| nfl-02-hub | iphone-max-430 | 7 | 0 | 0 | 0px |
| nfl-02-hub | landscape-844 | 13 | 0 | 0 | 0px |
| nfl-03-play | android-360 | 1 | 0 | 0 | 0px |
| nfl-03-play | iphone-390 | 2 | 0 | 0 | 0px |
| nfl-03-play | iphone-max-430 | 2 | 0 | 0 | 0px |
| nfl-03-play | landscape-844 | 13 | 0 | 0 | 0px |
| nfl-04-draft-empty | android-360 | 1 | 0 | 0 | 0px |
| nfl-04-draft-empty | iphone-390 | 2 | 0 | 0 | 0px |
| nfl-04-draft-empty | iphone-max-430 | 2 | 0 | 0 | 0px |
| nfl-04-draft-empty | landscape-844 | 14 | 0 | 0 | 0px |
| nfl-05-game-live | android-360 | 0 | 0 | 0 | 0px |
| nfl-05-game-live | iphone-390 | 1 | 0 | 0 | 0px |
| nfl-05-game-live | iphone-max-430 | 1 | 0 | 0 | 0px |
| nfl-05-game-live | landscape-844 | 7 | 0 | 0 | 0px |
| nfl-06-game-final | android-360 | 0 | 0 | 0 | 0px |
| nfl-06-game-final | iphone-390 | 1 | 0 | 0 | 0px |
| nfl-06-game-final | iphone-max-430 | 1 | 0 | 0 | 0px |
| nfl-06-game-final | landscape-844 | 10 | 0 | 0 | 0px |
| nfl-07-profile | android-360 | 21 | 0 | 0 | 0px |
| nfl-07-profile | iphone-390 | 22 | 0 | 0 | 0px |
| nfl-07-profile | iphone-max-430 | 22 | 0 | 0 | 0px |
| nfl-07-profile | landscape-844 | 28 | 0 | 0 | 0px |
| nfl-07-badges | android-360 | 6 | 0 | 0 | 0px |
| nfl-07-badges | iphone-390 | 7 | 0 | 0 | 0px |
| nfl-07-badges | iphone-max-430 | 7 | 0 | 0 | 0px |
| nfl-07-badges | landscape-844 | 15 | 0 | 0 | 0px |
| nfl-07-squads | android-360 | 5 | 0 | 0 | 0px |
| nfl-07-squads | iphone-390 | 6 | 0 | 0 | 0px |
| nfl-07-squads | iphone-max-430 | 6 | 0 | 0 | 0px |
| nfl-07-squads | landscape-844 | 14 | 0 | 0 | 0px |

## What is worst, screen by screen

### nba-02-hub @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-02-hub--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 116x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 333x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 144x31: `button.sport-card-action "🏆 Rank"`
- tap target 144x31: `button.sport-card-action "📖 How to Play"`
- tap target 144x31: `button.sport-card-action "🏆 Rank"`
- tap target 144x31: `button.sport-card-action "📖 How to Play"`

### nba-02-hub @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-02-hub--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 116x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 157x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 159x31: `button.sport-card-action "🏆 Rank"`
- tap target 159x31: `button.sport-card-action "📖 How to Play"`
- tap target 159x31: `button.sport-card-action "🏆 Rank"`
- tap target 159x31: `button.sport-card-action "📖 How to Play"`

### nba-02-hub @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-02-hub--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 116x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 197x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 179x31: `button.sport-card-action "🏆 Rank"`
- tap target 179x31: `button.sport-card-action "📖 How to Play"`
- tap target 179x31: `button.sport-card-action "🏆 Rank"`
- tap target 179x31: `button.sport-card-action "📖 How to Play"`

### nba-02-hub @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-02-hub--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab.active "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 116x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 130x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 82x31: `button.sport-card-action "🏆 Rank"`
- tap target 124x31: `button.sport-card-action "📖 How to Play"`
- tap target 82x31: `button.sport-card-action "🏆 Rank"`

### nba-03-play @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-03-play--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 77x36: `button#btn-play-back.btn.btn-secondary "← Home"`

### nba-03-play @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-03-play--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 77x36: `button#btn-play-back.btn.btn-secondary "← Home"`

### nba-03-play @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-03-play--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 77x36: `button#btn-play-back.btn.btn-secondary "← Home"`

### nba-03-play @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-03-play--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab.active "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 77x28: `button#btn-play-back.btn.btn-secondary "← Home"`
- tap target 111x32: `button.era-chip.active "🏀All Years"`
- tap target 157x32: `button.era-chip "📻Grandpa's Game"`
- tap target 120x32: `button.era-chip "📼Unc Status"`
- tap target 127x32: `button.era-chip "📱Modern Ball"`

### nba-04-draft-empty @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-04-draft-empty--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 299x38: `input#pool-search`

### nba-04-draft-empty @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-04-draft-empty--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 329x38: `input#pool-search`

### nba-04-draft-empty @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-04-draft-empty--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 369x38: `input#pool-search`

### nba-04-draft-empty @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-04-draft-empty--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab.active "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 50x33: `button.position-btn "PG"`
- tap target 50x33: `button.position-btn "SG"`
- tap target 50x33: `button.position-btn "SF"`
- tap target 50x33: `button.position-btn "PF"`
- tap target 42x33: `button.position-btn "C"`

### nba-05-game-live @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-05-game-live--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`

### nba-05-game-live @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-05-game-live--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`

### nba-05-game-live @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-05-game-live--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab.active "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`

### nba-06-game-final @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-06-game-final--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`

### nba-06-game-final @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-06-game-final--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`

### nba-06-game-final @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-06-game-final--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab.active "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 397x40: `button#btn-to-profile.btn.btn-secondary "View Profile"`
- tap target 395x40: `button#btn-play-again.btn.btn-primary "Play Again"`
- tap target 804x40: `button#btn-game-home.btn.btn-secondary "Return to Home"`

### nba-07-profile @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-profile--android-360.png` (regenerate with `npm run baseline:mobile`)

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
- tap target 34x34: `button.kit-swatch`

### nba-07-profile @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-profile--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
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

### nba-07-profile @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-profile--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
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

### nba-07-profile @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-profile--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab.active "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 38x38: `button.kit-swatch.kit-swatch-on`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`

### nba-07-badges @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-badges--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 76x30: `button.subtab.active "Badges"`
- tap target 81x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 100x30: `button.subtab "Team Color"`
- tap target 77x30: `button.subtab.active "🏀 NBA"`
- tap target 74x30: `button.subtab "🏈 NFL"`

### nba-07-badges @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-badges--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 76x30: `button.subtab.active "Badges"`
- tap target 81x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 100x30: `button.subtab "Team Color"`
- tap target 77x30: `button.subtab.active "🏀 NBA"`
- tap target 74x30: `button.subtab "🏈 NFL"`

### nba-07-badges @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-badges--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 76x30: `button.subtab.active "Badges"`
- tap target 81x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 100x30: `button.subtab "Team Color"`
- tap target 77x30: `button.subtab.active "🏀 NBA"`
- tap target 74x30: `button.subtab "🏈 NFL"`

### nba-07-badges @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-badges--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab.active "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 76x30: `button.subtab.active "Badges"`
- tap target 81x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 100x30: `button.subtab "Team Color"`
- tap target 77x30: `button.subtab.active "🏀 NBA"`

### nba-07-squads @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-squads--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 76x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 111x30: `button.subtab "Tournaments"`
- tap target 291x38: `input#input-squad-search`

### nba-07-squads @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-squads--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 76x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 111x30: `button.subtab "Tournaments"`
- tap target 321x38: `input#input-squad-search`

### nba-07-squads @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-squads--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 76x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 111x30: `button.subtab "Tournaments"`
- tap target 361x38: `input#input-squad-search`

### nba-07-squads @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nba-07-squads--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab.active "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 76x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 111x30: `button.subtab "Tournaments"`
- tap target 762x38: `input#input-squad-search`

### nfl-02-hub @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-02-hub--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 116x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 333x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 144x31: `button.sport-card-action "🏆 Rank"`
- tap target 144x31: `button.sport-card-action "📖 How to Play"`
- tap target 144x31: `button.sport-card-action "🏆 Rank"`
- tap target 144x31: `button.sport-card-action "📖 How to Play"`

### nfl-02-hub @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-02-hub--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 116x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 157x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 159x31: `button.sport-card-action "🏆 Rank"`
- tap target 159x31: `button.sport-card-action "📖 How to Play"`
- tap target 159x31: `button.sport-card-action "🏆 Rank"`
- tap target 159x31: `button.sport-card-action "📖 How to Play"`

### nfl-02-hub @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-02-hub--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 116x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 197x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 179x31: `button.sport-card-action "🏆 Rank"`
- tap target 179x31: `button.sport-card-action "📖 How to Play"`
- tap target 179x31: `button.sport-card-action "🏆 Rank"`
- tap target 179x31: `button.sport-card-action "📖 How to Play"`

### nfl-02-hub @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-02-hub--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab.active "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 116x31: `button#btn-customize-profile.sport-card-action "🎨 Customize"`
- tap target 130x31: `button#btn-overall-ladder.sport-card-action "🏅 Overall Rank"`
- tap target 82x31: `button.sport-card-action "🏆 Rank"`
- tap target 124x31: `button.sport-card-action "📖 How to Play"`
- tap target 82x31: `button.sport-card-action "🏆 Rank"`

### nfl-03-play @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-03-play--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 77x36: `button#btn-play-back.btn.btn-secondary "← Home"`

### nfl-03-play @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-03-play--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 77x36: `button#btn-play-back.btn.btn-secondary "← Home"`

### nfl-03-play @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-03-play--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 77x36: `button#btn-play-back.btn.btn-secondary "← Home"`

### nfl-03-play @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-03-play--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab.active "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 77x28: `button#btn-play-back.btn.btn-secondary "← Home"`
- tap target 111x32: `button.era-chip.active "🏈All Years"`
- tap target 91x32: `button.era-chip "📼2000s"`
- tap target 91x32: `button.era-chip "📱2010s"`
- tap target 91x32: `button.era-chip "🚀2020s"`

### nfl-04-draft-empty @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-04-draft-empty--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 299x38: `input#pool-search`

### nfl-04-draft-empty @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-04-draft-empty--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 329x38: `input#pool-search`

### nfl-04-draft-empty @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-04-draft-empty--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 369x38: `input#pool-search`

### nfl-04-draft-empty @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-04-draft-empty--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab.active "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 50x33: `button.position-btn "QB"`
- tap target 50x33: `button.position-btn "RB"`
- tap target 50x33: `button.position-btn "WR"`
- tap target 50x33: `button.position-btn "TE"`
- tap target 50x33: `button.position-btn "OL"`

### nfl-05-game-live @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-05-game-live--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`

### nfl-05-game-live @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-05-game-live--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`

### nfl-05-game-live @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-05-game-live--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab.active "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`

### nfl-06-game-final @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-06-game-final--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`

### nfl-06-game-final @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-06-game-final--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`

### nfl-06-game-final @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-06-game-final--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab.active "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 397x40: `button#btn-to-profile.btn.btn-secondary "View Profile"`
- tap target 395x40: `button#btn-play-again.btn.btn-primary "Play Again"`
- tap target 804x40: `button#btn-game-home.btn.btn-secondary "Return to Home"`

### nfl-07-profile @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-profile--android-360.png` (regenerate with `npm run baseline:mobile`)

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
- tap target 34x34: `button.kit-swatch`

### nfl-07-profile @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-profile--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
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

### nfl-07-profile @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-profile--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
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

### nfl-07-profile @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-profile--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab.active "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 38x38: `button.kit-swatch.kit-swatch-on`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`
- tap target 34x34: `button.kit-swatch`

### nfl-07-badges @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-badges--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 76x30: `button.subtab.active "Badges"`
- tap target 81x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 100x30: `button.subtab "Team Color"`
- tap target 77x30: `button.subtab.active "🏀 NBA"`
- tap target 74x30: `button.subtab "🏈 NFL"`

### nfl-07-badges @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-badges--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 76x30: `button.subtab.active "Badges"`
- tap target 81x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 100x30: `button.subtab "Team Color"`
- tap target 77x30: `button.subtab.active "🏀 NBA"`
- tap target 74x30: `button.subtab "🏈 NFL"`

### nfl-07-badges @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-badges--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 76x30: `button.subtab.active "Badges"`
- tap target 81x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 100x30: `button.subtab "Team Color"`
- tap target 77x30: `button.subtab.active "🏀 NBA"`
- tap target 74x30: `button.subtab "🏈 NFL"`

### nfl-07-badges @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-badges--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab.active "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 76x30: `button.subtab.active "Badges"`
- tap target 81x30: `button.subtab "Banners"`
- tap target 63x30: `button.subtab "Icons"`
- tap target 100x30: `button.subtab "Team Color"`
- tap target 77x30: `button.subtab.active "🏀 NBA"`

### nfl-07-squads @ android-360 (360x800)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-squads--android-360.png` (regenerate with `npm run baseline:mobile`)

- tap target 76x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 111x30: `button.subtab "Tournaments"`
- tap target 291x38: `input#input-squad-search`

### nfl-07-squads @ iphone-390 (390x844)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-squads--iphone-390.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 76x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 111x30: `button.subtab "Tournaments"`
- tap target 321x38: `input#input-squad-search`

### nfl-07-squads @ iphone-max-430 (430x932)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-squads--iphone-max-430.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 76x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 111x30: `button.subtab "Tournaments"`
- tap target 361x38: `input#input-squad-search`

### nfl-07-squads @ landscape-844 (844x390)

Screenshot: `verify-artifacts/mobile-baseline/2026-09-02/nfl-07-squads--landscape-844.png` (regenerate with `npm run baseline:mobile`)

- tap target 197x32: `button#btn-brand.brand "Draft Nova"`
- tap target 67x31: `button#nav-play.nav-tab "🎮 Play"`
- tap target 93x31: `button#nav-profile.nav-tab "👤 Profile"`
- tap target 103x31: `button#nav-badges.nav-tab "🏅 Rewards"`
- tap target 91x31: `button#nav-squads.nav-tab.active "👥 Squads"`
- tap target 42x32: `button#nav-sound.nav-tab.nav-tab-icon "🔊 Sound on"`
- tap target 100x31: `button#nav-signout.nav-tab.nav-tab-danger "Sign Out"`
- tap target 76x30: `button.subtab "Friends"`
- tap target 65x30: `button.subtab.active "Home"`
- tap target 58x30: `button.subtab "Chat"`
- tap target 111x30: `button.subtab "Tournaments"`
- tap target 762x38: `input#input-squad-search`

## Run log

```
Mobile baseline — serving /home/user/Gamebuild at http://127.0.0.1:8934/
Writing to docs/audits/2026-09-02-mobile-baseline

NBA
  already signed in (existing session restored)
    nba-02-hub @ android-360: 6 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-02-hub @ iphone-390: 7 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-02-hub @ iphone-max-430: 7 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-02-hub @ landscape-844: 13 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
  nba: play screen open
    nba-03-play @ android-360: 1 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-03-play @ iphone-390: 2 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-03-play @ iphone-max-430: 2 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-03-play @ landscape-844: 13 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-04-draft-empty @ android-360: 1 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-04-draft-empty @ iphone-390: 2 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-04-draft-empty @ iphone-max-430: 2 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-04-draft-empty @ landscape-844: 14 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
  nba round 1: Nikola Jokić
  nba round 2: Giannis Antetokounmpo
  nba round 3: LeBron James
  nba round 4: Ralph Sampson
  nba round 5: Larry Bird
  nba round 6: Malcolm Brogdon
  drafted 6 round(s)
  nba: rotation phase not shown (mode may skip it)
  nba: matchups phase not shown (mode may skip it)
  nba: gameplan chosen over 1 round, game started
  nba: round 1 offered 3 card(s) — Pick your game plan
  strategy rounds: 1
    nba-05-game-live @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-05-game-live @ iphone-390: 1 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-05-game-live @ iphone-max-430: 1 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-05-game-live @ landscape-844: 7 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-06-game-final @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-06-game-final @ iphone-390: 1 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-06-game-final @ iphone-max-430: 1 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-06-game-final @ landscape-844: 10 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-profile @ android-360: 21 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-profile @ iphone-390: 22 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-profile @ iphone-max-430: 22 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-profile @ landscape-844: 28 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-badges @ android-360: 6 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-badges @ iphone-390: 7 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-badges @ iphone-max-430: 7 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-badges @ landscape-844: 15 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-squads @ android-360: 5 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-squads @ iphone-390: 6 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-squads @ iphone-max-430: 6 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nba-07-squads @ landscape-844: 14 small target(s), 0 tiny text, 0 escaping, 0px h-overflow

NFL
  already signed in (existing session restored)
    nfl-02-hub @ android-360: 6 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-02-hub @ iphone-390: 7 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-02-hub @ iphone-max-430: 7 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-02-hub @ landscape-844: 13 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
  nfl: play screen open
    nfl-03-play @ android-360: 1 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-03-play @ iphone-390: 2 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-03-play @ iphone-max-430: 2 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-03-play @ landscape-844: 13 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-04-draft-empty @ android-360: 1 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-04-draft-empty @ iphone-390: 2 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-04-draft-empty @ iphone-max-430: 2 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-04-draft-empty @ landscape-844: 14 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
  nfl round 1: Alvin Kamara
  nfl round 2: Wes Welker
  nfl round 3: Green Bay Packers Offensive Line
  nfl round 4: Jalen Hurts
  nfl round 5: Chris Cooley
  nfl round 6: San Francisco 49ers Linebackers
  drafted 6 round(s)
  nfl: rotation phase not shown (mode may skip it)
  nfl: matchups phase not shown (mode may skip it)
  nfl: gameplan chosen over 2 rounds, game started
  nfl: round 1 offered 3 card(s) — Offensive Gameplan — Round 1 of 2
  nfl: round 2 offered 3 card(s) — Defensive Gameplan — Round 2 of 2
  strategy rounds: 2
    nfl-05-game-live @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-05-game-live @ iphone-390: 1 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-05-game-live @ iphone-max-430: 1 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-05-game-live @ landscape-844: 7 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-06-game-final @ android-360: 0 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-06-game-final @ iphone-390: 1 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-06-game-final @ iphone-max-430: 1 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-06-game-final @ landscape-844: 10 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-profile @ android-360: 21 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-profile @ iphone-390: 22 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-profile @ iphone-max-430: 22 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-profile @ landscape-844: 28 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-badges @ android-360: 6 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-badges @ iphone-390: 7 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-badges @ iphone-max-430: 7 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-badges @ landscape-844: 15 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-squads @ android-360: 5 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-squads @ iphone-390: 6 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-squads @ iphone-max-430: 6 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
    nfl-07-squads @ landscape-844: 14 small target(s), 0 tiny text, 0 escaping, 0px h-overflow
```