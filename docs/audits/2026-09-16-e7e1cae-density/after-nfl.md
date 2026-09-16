# Density audit — 2026-09-16-e7e1cae (after-nfl)

Captured by `npm run audit:density`. `pages` is document height in viewport-fuls:
1.00 means the screen fits. `primary` is where the thing you are on the screen to
use starts, in pixels from the top of the document.

| screen | viewport | pages | nav | banner | tabs | primary | above fold | roster rows visible | h-overflow |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| nfl-play | desktop-1920 | 1 | 45 | - | - | 217 | yes | 0/0 | 0px |
| nfl-play | laptop-1536 | 1 | 45 | - | - | 213 | yes | 0/0 | 0px |
| nfl-play | laptop-1440 | 1 | 45 | - | - | 217 | yes | 0/0 | 0px |
| nfl-play | laptop-1366 | 1 | 45 | - | - | 213 | yes | 0/0 | 0px |
| nfl-play | phone-430 | 1.04 | 57 | - | - | 236 | yes | 0/0 | 0px |
| nfl-play | phone-390 | 1.16 | 57 | - | - | 228 | yes | 0/0 | 0px |
| nfl-play | phone-375 | 1.49 | 57 | - | - | 228 | yes | 0/0 | 0px |
| nfl-draft-open | desktop-1920 | 1 | 45 | 97 | 28 | 215 | yes | 24/24 | 0px |
| nfl-draft-open | laptop-1536 | 1 | 45 | 94 | 28 | 205 | yes | 24/24 | 0px |
| nfl-draft-open | laptop-1440 | 1 | 45 | 97 | 28 | 214 | yes | 24/24 | 0px |
| nfl-draft-open | laptop-1366 | 1 | 45 | 94 | 28 | 205 | yes | 24/24 | 0px |
| nfl-draft-open | phone-430 | 1 | 57 | 106 | 28 | 230 | yes | 24/24 | 0px |
| nfl-draft-open | phone-390 | 1 | 57 | 100 | 28 | 217 | yes | 24/24 | 0px |
| nfl-draft-open | phone-375 | 1.15 | 57 | 100 | 28 | 217 | yes | 22/24 | 0px |
| nfl-draft-mid | desktop-1920 | 1 | 45 | 97 | 29 | 215 | yes | 24/24 | 0px |
| nfl-draft-mid | laptop-1536 | 1 | 45 | 94 | 29 | 206 | yes | 24/24 | 0px |
| nfl-draft-mid | laptop-1440 | 1 | 45 | 97 | 29 | 215 | yes | 24/24 | 0px |
| nfl-draft-mid | laptop-1366 | 1.03 | 45 | 94 | 29 | 206 | yes | 24/24 | 0px |
| nfl-draft-mid | phone-430 | 1 | 57 | 106 | 28 | 230 | yes | 24/24 | 0px |
| nfl-draft-mid | phone-390 | 1.05 | 57 | 100 | 28 | 217 | yes | 24/24 | 0px |
| nfl-draft-mid | phone-375 | 1.33 | 57 | 100 | 28 | 217 | yes | 15/24 | 0px |
| nfl-gameplan | desktop-1920 | 1.12 | 45 | 93 | 0 | 575 | yes | 20/24 | 0px |
| nfl-gameplan | laptop-1536 | 1.38 | 45 | 90 | 0 | 559 | yes | 14/24 | 0px |
| nfl-gameplan | laptop-1440 | 1.34 | 45 | 93 | 0 | 575 | yes | 14/24 | 0px |
| nfl-gameplan | laptop-1366 | 1.55 | 45 | 90 | 0 | 559 | yes | 10/24 | 0px |
| nfl-gameplan | phone-430 | 1.86 | 57 | 84 | 3 | 621 | yes | 0/24 | 0px |
| nfl-gameplan | phone-390 | 1.98 | 57 | 77 | 3 | 591 | yes | 0/24 | 0px |
| nfl-gameplan | phone-375 | 2.63 | 57 | 77 | 3 | 624 | yes | 0/24 | 0px |
| nfl-game-live | desktop-1920 | 2.27 | 45 | - | - | 61 | yes | 24/24 | 0px |
| nfl-game-live | laptop-1536 | 2.83 | 45 | - | - | 57 | yes | 24/24 | 0px |
| nfl-game-live | laptop-1440 | 2.72 | 45 | - | - | 61 | yes | 24/24 | 0px |
| nfl-game-live | laptop-1366 | 3.18 | 45 | - | - | 57 | yes | 24/24 | 0px |
| nfl-game-live | phone-430 | 2.69 | 57 | - | - | 72 | yes | 24/24 | 0px |
| nfl-game-live | phone-390 | 2.86 | 57 | - | - | 67 | yes | 24/24 | 0px |
| nfl-game-live | phone-375 | 3.62 | 57 | - | - | 67 | yes | 24/24 | 0px |
| nfl-game-final | desktop-1920 | 2.7 | 45 | - | - | 2793 | NO | 24/24 | 0px |
| nfl-game-final | laptop-1536 | 3.37 | 45 | - | - | 2789 | NO | 24/24 | 0px |
| nfl-game-final | laptop-1440 | 3.24 | 45 | - | - | 2793 | NO | 24/24 | 0px |
| nfl-game-final | laptop-1366 | 3.79 | 45 | - | - | 2789 | NO | 24/24 | 0px |
| nfl-game-final | phone-430 | 3.27 | 57 | - | - | 1048 | NO | 24/24 | 0px |
| nfl-game-final | phone-390 | 3.49 | 57 | - | - | 1020 | NO | 24/24 | 0px |
| nfl-game-final | phone-375 | 4.41 | 57 | - | - | 1019 | NO | 24/24 | 0px |

## Run log

```
Density audit (after-nfl) — serving /home/user/Gamebuild at http://127.0.0.1:8937/

NFL
  already signed in (existing session restored)
  nfl: play screen open
    nfl-play @ desktop-1920: 1 pages, primary at 217px (above fold), 0/0 roster rows visible
    nfl-play @ laptop-1536: 1 pages, primary at 213px (above fold), 0/0 roster rows visible
    nfl-play @ laptop-1440: 1 pages, primary at 217px (above fold), 0/0 roster rows visible
    nfl-play @ laptop-1366: 1 pages, primary at 213px (above fold), 0/0 roster rows visible
    nfl-play @ phone-430: 1.04 pages, primary at 236px (above fold), 0/0 roster rows visible
    nfl-play @ phone-390: 1.16 pages, primary at 228px (above fold), 0/0 roster rows visible
    nfl-play @ phone-375: 1.49 pages, primary at 228px (above fold), 0/0 roster rows visible
    nfl-draft-open @ desktop-1920: 1 pages, primary at 215px (above fold), 24/24 roster rows visible
    nfl-draft-open @ laptop-1536: 1 pages, primary at 205px (above fold), 24/24 roster rows visible
    nfl-draft-open @ laptop-1440: 1 pages, primary at 214px (above fold), 24/24 roster rows visible
    nfl-draft-open @ laptop-1366: 1 pages, primary at 205px (above fold), 24/24 roster rows visible
    nfl-draft-open @ phone-430: 1 pages, primary at 230px (above fold), 24/24 roster rows visible
    nfl-draft-open @ phone-390: 1 pages, primary at 217px (above fold), 24/24 roster rows visible
    nfl-draft-open @ phone-375: 1.15 pages, primary at 217px (above fold), 22/24 roster rows visible
  nfl-first-half round 1: Eddie Lacy
  nfl-first-half round 2: Jayden Daniels
  nfl-first-half round 3: Eric Moulds
  nfl-first-half round 4: Tennessee Titans Offensive Line
  nfl-first-half round 5: Torry Holt
  nfl-first-half round 6: Allen Robinson
  nfl-first-half round 7: Dalton Schultz
  nfl-first-half round 8: Washington Commanders Offensive Line
    nfl-draft-mid @ desktop-1920: 1 pages, primary at 215px (above fold), 24/24 roster rows visible
    nfl-draft-mid @ laptop-1536: 1 pages, primary at 206px (above fold), 24/24 roster rows visible
    nfl-draft-mid @ laptop-1440: 1 pages, primary at 215px (above fold), 24/24 roster rows visible
    nfl-draft-mid @ laptop-1366: 1.03 pages, primary at 206px (above fold), 24/24 roster rows visible
    nfl-draft-mid @ phone-430: 1 pages, primary at 230px (above fold), 24/24 roster rows visible
    nfl-draft-mid @ phone-390: 1.05 pages, primary at 217px (above fold), 24/24 roster rows visible
    nfl-draft-mid @ phone-375: 1.33 pages, primary at 217px (above fold), 15/24 roster rows visible
  nfl round 1: Kansas City Chiefs Linebackers
  nfl round 2: Los Angeles Chargers Cornerbacks
  nfl round 3: Buffalo Bills Safeties
  nfl round 4: Denver Broncos Special Teams
    nfl-gameplan @ desktop-1920: 1.12 pages, primary at 575px (above fold), 20/24 roster rows visible
    nfl-gameplan @ laptop-1536: 1.38 pages, primary at 559px (above fold), 14/24 roster rows visible
    nfl-gameplan @ laptop-1440: 1.34 pages, primary at 575px (above fold), 14/24 roster rows visible
    nfl-gameplan @ laptop-1366: 1.55 pages, primary at 559px (above fold), 10/24 roster rows visible
    nfl-gameplan @ phone-430: 1.86 pages, primary at 621px (above fold), 0/24 roster rows visible
    nfl-gameplan @ phone-390: 1.98 pages, primary at 591px (above fold), 0/24 roster rows visible
    nfl-gameplan @ phone-375: 2.63 pages, primary at 624px (above fold), 0/24 roster rows visible
    nfl-game-live @ desktop-1920: 2.27 pages, primary at 61px (above fold), 24/24 roster rows visible
    nfl-game-live @ laptop-1536: 2.83 pages, primary at 57px (above fold), 24/24 roster rows visible
    nfl-game-live @ laptop-1440: 2.72 pages, primary at 61px (above fold), 24/24 roster rows visible
    nfl-game-live @ laptop-1366: 3.18 pages, primary at 57px (above fold), 24/24 roster rows visible
    nfl-game-live @ phone-430: 2.69 pages, primary at 72px (above fold), 24/24 roster rows visible
    nfl-game-live @ phone-390: 2.86 pages, primary at 67px (above fold), 24/24 roster rows visible
    nfl-game-live @ phone-375: 3.62 pages, primary at 67px (above fold), 24/24 roster rows visible
    nfl-game-final @ desktop-1920: 2.7 pages, primary at 2793px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ laptop-1536: 3.37 pages, primary at 2789px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ laptop-1440: 3.24 pages, primary at 2793px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ laptop-1366: 3.79 pages, primary at 2789px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ phone-430: 3.27 pages, primary at 1048px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ phone-390: 3.49 pages, primary at 1020px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ phone-375: 4.41 pages, primary at 1019px (BELOW fold), 24/24 roster rows visible
```