# Density audit — 2026-09-16-150fd72 (v4-nfl)

Captured by `npm run audit:density`. `pages` is document height in viewport-fuls:
1.00 means the screen fits. `primary` is where the thing you are on the screen to
use starts, in pixels from the top of the document.

| screen | viewport | pages | nav | banner | tabs | primary | above fold | roster rows visible | h-overflow |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| nfl-play | desktop-1920 | 1 | 56 | - | - | 233 | yes | 0/0 | 0px |
| nfl-play | laptop-1536 | 1 | 44 | - | - | 211 | yes | 0/0 | 0px |
| nfl-play | laptop-1440 | 1 | 56 | - | - | 232 | yes | 0/0 | 0px |
| nfl-play | laptop-1366 | 1 | 44 | - | - | 211 | yes | 0/0 | 0px |
| nfl-play | phone-430 | 1.09 | 57 | - | - | 237 | yes | 0/0 | 0px |
| nfl-play | phone-390 | 1.16 | 58 | - | - | 228 | yes | 0/0 | 0px |
| nfl-play | phone-375 | 1.49 | 58 | - | - | 228 | yes | 0/0 | 0px |
| nfl-draft-open | desktop-1920 | 1 | 56 | 113 | 33 | 256 | yes | 24/24 | 0px |
| nfl-draft-open | laptop-1536 | 1 | 44 | 94 | 28 | 203 | yes | 24/24 | 0px |
| nfl-draft-open | laptop-1440 | 1 | 56 | 105 | 31 | 243 | yes | 24/24 | 0px |
| nfl-draft-open | laptop-1366 | 1 | 44 | 94 | 28 | 203 | yes | 24/24 | 0px |
| nfl-draft-open | phone-430 | 1 | 57 | 106 | 28 | 230 | yes | 24/24 | 0px |
| nfl-draft-open | phone-390 | 1 | 58 | 100 | 28 | 220 | yes | 24/24 | 0px |
| nfl-draft-open | phone-375 | 1.16 | 58 | 100 | 28 | 220 | yes | 22/24 | 0px |
| nfl-draft-mid | desktop-1920 | 1 | 56 | 113 | 35 | 258 | yes | 24/24 | 0px |
| nfl-draft-mid | laptop-1536 | 1 | 44 | 94 | 29 | 204 | yes | 24/24 | 0px |
| nfl-draft-mid | laptop-1440 | 1.02 | 56 | 105 | 32 | 244 | yes | 24/24 | 0px |
| nfl-draft-mid | laptop-1366 | 1.05 | 44 | 94 | 29 | 204 | yes | 24/24 | 0px |
| nfl-draft-mid | phone-430 | 1 | 57 | 106 | 28 | 230 | yes | 24/24 | 0px |
| nfl-draft-mid | phone-390 | 1.06 | 58 | 100 | 28 | 220 | yes | 24/24 | 0px |
| nfl-draft-mid | phone-375 | 1.34 | 58 | 100 | 28 | 220 | yes | 15/24 | 0px |
| nfl-gameplan | desktop-1920 | 1.29 | 56 | 109 | 0 | 644 | yes | 16/24 | 0px |
| nfl-gameplan | laptop-1536 | 1.39 | 44 | 89 | 0 | 585 | yes | 14/24 | 0px |
| nfl-gameplan | laptop-1440 | 1.48 | 56 | 101 | 0 | 636 | yes | 10/24 | 0px |
| nfl-gameplan | laptop-1366 | 1.57 | 44 | 89 | 0 | 585 | yes | 8/24 | 0px |
| nfl-gameplan | phone-430 | 1.92 | 57 | 84 | 3 | 669 | yes | 0/24 | 0px |
| nfl-gameplan | phone-390 | 2.04 | 58 | 77 | 3 | 637 | yes | 0/24 | 0px |
| nfl-gameplan | phone-375 | 2.7 | 58 | 77 | 3 | 670 | NO | 0/24 | 0px |
| nfl-game-live | desktop-1920 | 2.3 | 56 | - | - | 76 | yes | 24/24 | 0px |
| nfl-game-live | laptop-1536 | 2.79 | 44 | - | - | 56 | yes | 24/24 | 0px |
| nfl-game-live | laptop-1440 | 2.76 | 56 | - | - | 76 | yes | 24/24 | 0px |
| nfl-game-live | laptop-1366 | 3.14 | 44 | - | - | 56 | yes | 24/24 | 0px |
| nfl-game-live | phone-430 | 2.68 | 57 | - | - | 72 | yes | 24/24 | 0px |
| nfl-game-live | phone-390 | 2.88 | 58 | - | - | 69 | yes | 24/24 | 0px |
| nfl-game-live | phone-375 | 3.64 | 58 | - | - | 69 | yes | 24/24 | 0px |
| nfl-game-final | desktop-1920 | 2.73 | 56 | - | - | 2825 | NO | 24/24 | 0px |
| nfl-game-final | laptop-1536 | 3.33 | 44 | - | - | 2751 | NO | 24/24 | 0px |
| nfl-game-final | laptop-1440 | 3.28 | 56 | - | - | 2825 | NO | 24/24 | 0px |
| nfl-game-final | laptop-1366 | 3.74 | 44 | - | - | 2751 | NO | 24/24 | 0px |
| nfl-game-final | phone-430 | 3.26 | 57 | - | - | 1059 | NO | 24/24 | 0px |
| nfl-game-final | phone-390 | 3.5 | 58 | - | - | 1032 | NO | 24/24 | 0px |
| nfl-game-final | phone-375 | 4.5 | 58 | - | - | 1082 | NO | 24/24 | 0px |

## Run log

```
Density audit (v4-nfl) — serving /home/user/Gamebuild at http://127.0.0.1:8937/

NFL
  already signed in (existing session restored)
  nfl: play screen open
    nfl-play @ desktop-1920: 1 pages, primary at 233px (above fold), 0/0 roster rows visible
    nfl-play @ laptop-1536: 1 pages, primary at 211px (above fold), 0/0 roster rows visible
    nfl-play @ laptop-1440: 1 pages, primary at 232px (above fold), 0/0 roster rows visible
    nfl-play @ laptop-1366: 1 pages, primary at 211px (above fold), 0/0 roster rows visible
    nfl-play @ phone-430: 1.09 pages, primary at 237px (above fold), 0/0 roster rows visible
    nfl-play @ phone-390: 1.16 pages, primary at 228px (above fold), 0/0 roster rows visible
    nfl-play @ phone-375: 1.49 pages, primary at 228px (above fold), 0/0 roster rows visible
    nfl-draft-open @ desktop-1920: 1 pages, primary at 256px (above fold), 24/24 roster rows visible
    nfl-draft-open @ laptop-1536: 1 pages, primary at 203px (above fold), 24/24 roster rows visible
    nfl-draft-open @ laptop-1440: 1 pages, primary at 243px (above fold), 24/24 roster rows visible
    nfl-draft-open @ laptop-1366: 1 pages, primary at 203px (above fold), 24/24 roster rows visible
    nfl-draft-open @ phone-430: 1 pages, primary at 230px (above fold), 24/24 roster rows visible
    nfl-draft-open @ phone-390: 1 pages, primary at 220px (above fold), 24/24 roster rows visible
    nfl-draft-open @ phone-375: 1.16 pages, primary at 220px (above fold), 22/24 roster rows visible
  nfl-first-half round 1: Tiki Barber
  nfl-first-half round 2: Daniel Jones
  nfl-first-half round 3: Josh Gordon
  nfl-first-half round 4: Dallas Cowboys Offensive Line
  nfl-first-half round 5: Baltimore Ravens Offensive Line
  nfl-first-half round 6: Eric Moulds
  nfl-first-half round 7: Nico Collins
  nfl-first-half round 8: Todd Heap
    nfl-draft-mid @ desktop-1920: 1 pages, primary at 258px (above fold), 24/24 roster rows visible
    nfl-draft-mid @ laptop-1536: 1 pages, primary at 204px (above fold), 24/24 roster rows visible
    nfl-draft-mid @ laptop-1440: 1.02 pages, primary at 244px (above fold), 24/24 roster rows visible
    nfl-draft-mid @ laptop-1366: 1.05 pages, primary at 204px (above fold), 24/24 roster rows visible
    nfl-draft-mid @ phone-430: 1 pages, primary at 230px (above fold), 24/24 roster rows visible
    nfl-draft-mid @ phone-390: 1.06 pages, primary at 220px (above fold), 24/24 roster rows visible
    nfl-draft-mid @ phone-375: 1.34 pages, primary at 220px (above fold), 15/24 roster rows visible
  nfl round 1: Tampa Bay Buccaneers Linebackers
  nfl round 2: Los Angeles Chargers Cornerbacks
  nfl round 3: San Francisco 49ers Safeties
  nfl round 4: Washington Commanders Special Teams
    nfl-gameplan @ desktop-1920: 1.29 pages, primary at 644px (above fold), 16/24 roster rows visible
    nfl-gameplan @ laptop-1536: 1.39 pages, primary at 585px (above fold), 14/24 roster rows visible
    nfl-gameplan @ laptop-1440: 1.48 pages, primary at 636px (above fold), 10/24 roster rows visible
    nfl-gameplan @ laptop-1366: 1.57 pages, primary at 585px (above fold), 8/24 roster rows visible
    nfl-gameplan @ phone-430: 1.92 pages, primary at 669px (above fold), 0/24 roster rows visible
    nfl-gameplan @ phone-390: 2.04 pages, primary at 637px (above fold), 0/24 roster rows visible
    nfl-gameplan @ phone-375: 2.7 pages, primary at 670px (BELOW fold), 0/24 roster rows visible
    nfl-game-live @ desktop-1920: 2.3 pages, primary at 76px (above fold), 24/24 roster rows visible
    nfl-game-live @ laptop-1536: 2.79 pages, primary at 56px (above fold), 24/24 roster rows visible
    nfl-game-live @ laptop-1440: 2.76 pages, primary at 76px (above fold), 24/24 roster rows visible
    nfl-game-live @ laptop-1366: 3.14 pages, primary at 56px (above fold), 24/24 roster rows visible
    nfl-game-live @ phone-430: 2.68 pages, primary at 72px (above fold), 24/24 roster rows visible
    nfl-game-live @ phone-390: 2.88 pages, primary at 69px (above fold), 24/24 roster rows visible
    nfl-game-live @ phone-375: 3.64 pages, primary at 69px (above fold), 24/24 roster rows visible
    nfl-game-final @ desktop-1920: 2.73 pages, primary at 2825px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ laptop-1536: 3.33 pages, primary at 2751px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ laptop-1440: 3.28 pages, primary at 2825px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ laptop-1366: 3.74 pages, primary at 2751px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ phone-430: 3.26 pages, primary at 1059px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ phone-390: 3.5 pages, primary at 1032px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ phone-375: 4.5 pages, primary at 1082px (BELOW fold), 24/24 roster rows visible
```