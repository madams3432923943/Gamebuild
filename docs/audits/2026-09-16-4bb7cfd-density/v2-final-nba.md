# Density audit — 2026-09-16-4bb7cfd (v2-final-nba)

Captured by `npm run audit:density`. `pages` is document height in viewport-fuls:
1.00 means the screen fits. `primary` is where the thing you are on the screen to
use starts, in pixels from the top of the document.

| screen | viewport | pages | nav | banner | tabs | primary | above fold | roster rows visible | h-overflow |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| nba-play | desktop-1920 | 1 | 56 | - | - | 233 | yes | 0/0 | 0px |
| nba-play | laptop-1536 | 1 | 44 | - | - | 211 | yes | 0/0 | 0px |
| nba-play | laptop-1440 | 1 | 56 | - | - | 232 | yes | 0/0 | 0px |
| nba-play | laptop-1366 | 1 | 44 | - | - | 211 | yes | 0/0 | 0px |
| nba-play | phone-430 | 1.09 | 57 | - | - | 237 | yes | 0/0 | 0px |
| nba-play | phone-390 | 1.16 | 58 | - | - | 228 | yes | 0/0 | 0px |
| nba-play | phone-375 | 1.49 | 58 | - | - | 228 | yes | 0/0 | 0px |
| nba-draft-open | desktop-1920 | 1 | 56 | 105 | 31 | 244 | yes | 20/20 | 0px |
| nba-draft-open | laptop-1536 | 1 | 44 | 94 | 28 | 203 | yes | 20/20 | 0px |
| nba-draft-open | laptop-1440 | 1 | 56 | 105 | 31 | 243 | yes | 20/20 | 0px |
| nba-draft-open | laptop-1366 | 1 | 44 | 94 | 28 | 203 | yes | 20/20 | 0px |
| nba-draft-open | phone-430 | 1 | 57 | 106 | 28 | 230 | yes | 20/20 | 0px |
| nba-draft-open | phone-390 | 1 | 58 | 100 | 28 | 220 | yes | 20/20 | 0px |
| nba-draft-open | phone-375 | 1.08 | 58 | 100 | 28 | 220 | yes | 20/20 | 0px |
| nba-rotation | desktop-1920 | 1 | 56 | 101 | 0 | 490 | yes | 20/20 | 0px |
| nba-rotation | laptop-1536 | 1.01 | 44 | 89 | 0 | 439 | yes | 20/20 | 0px |
| nba-rotation | laptop-1440 | 1.11 | 56 | 101 | 0 | 490 | yes | 17/20 | 0px |
| nba-rotation | laptop-1366 | 1.14 | 44 | 89 | 0 | 439 | yes | 16/20 | 0px |
| nba-rotation | phone-430 | 1.64 | 57 | 84 | 3 | 500 | yes | 0/20 | 0px |
| nba-rotation | phone-390 | 1.76 | 58 | 77 | 3 | 504 | yes | 0/20 | 0px |
| nba-rotation | phone-375 | 2.22 | 58 | 77 | 3 | 504 | yes | 0/20 | 0px |
| nba-matchups | desktop-1920 | 1 | 56 | 101 | 0 | 490 | yes | 20/20 | 0px |
| nba-matchups | laptop-1536 | 1.01 | 44 | 89 | 0 | 439 | yes | 20/20 | 0px |
| nba-matchups | laptop-1440 | 1.11 | 56 | 101 | 0 | 490 | yes | 17/20 | 0px |
| nba-matchups | laptop-1366 | 1.14 | 44 | 89 | 0 | 439 | yes | 16/20 | 0px |
| nba-matchups | phone-430 | 1.41 | 57 | 84 | 3 | 515 | yes | 0/20 | 0px |
| nba-matchups | phone-390 | 1.52 | 58 | 77 | 3 | 504 | yes | 0/20 | 0px |
| nba-matchups | phone-375 | 1.92 | 58 | 77 | 3 | 504 | yes | 0/20 | 0px |
| nba-gameplan | desktop-1920 | 1 | 56 | 101 | 0 | 475 | yes | 20/20 | 0px |
| nba-gameplan | laptop-1536 | 1.01 | 44 | 89 | 0 | 424 | yes | 20/20 | 0px |
| nba-gameplan | laptop-1440 | 1.11 | 56 | 101 | 0 | 475 | yes | 17/20 | 0px |
| nba-gameplan | laptop-1366 | 1.14 | 44 | 89 | 0 | 424 | yes | 16/20 | 0px |
| nba-gameplan | phone-430 | 1.3 | 57 | 84 | 3 | 485 | yes | 6/20 | 0px |
| nba-gameplan | phone-390 | 1.39 | 58 | 77 | 3 | 474 | yes | 0/20 | 0px |
| nba-gameplan | phone-375 | 1.76 | 58 | 77 | 3 | 474 | yes | 0/20 | 0px |
| nba-game-live | desktop-1920 | 2.13 | 56 | - | - | 76 | yes | 20/20 | 0px |
| nba-game-live | laptop-1536 | 2.46 | 44 | - | - | 56 | yes | 20/20 | 0px |
| nba-game-live | laptop-1440 | 2.55 | 56 | - | - | 76 | yes | 20/20 | 0px |
| nba-game-live | laptop-1366 | 2.76 | 44 | - | - | 56 | yes | 20/20 | 0px |
| nba-game-live | phone-430 | 2.19 | 57 | - | - | 72 | yes | 20/20 | 0px |
| nba-game-live | phone-390 | 2.33 | 58 | - | - | 69 | yes | 20/20 | 0px |
| nba-game-live | phone-375 | 2.93 | 58 | - | - | 69 | yes | 20/20 | 0px |
| nba-game-final | desktop-1920 | 2.76 | 56 | - | - | 2859 | NO | 20/20 | 0px |
| nba-game-final | laptop-1536 | 3.4 | 44 | - | - | 2818 | NO | 20/20 | 0px |
| nba-game-final | laptop-1440 | 3.31 | 56 | - | - | 2859 | NO | 20/20 | 0px |
| nba-game-final | laptop-1366 | 3.77 | 44 | - | - | 2769 | NO | 20/20 | 0px |
| nba-game-final | phone-430 | 3.06 | 57 | - | - | 1491 | NO | 20/20 | 0px |
| nba-game-final | phone-390 | 3.29 | 58 | - | - | 1451 | NO | 20/20 | 0px |
| nba-game-final | phone-375 | 4.14 | 58 | - | - | 1442 | NO | 20/20 | 0px |

## Run log

```
Density audit (v2-final-nba) — serving /home/user/Gamebuild at http://127.0.0.1:8936/

NBA
  already signed in (existing session restored)
  nba: play screen open
    nba-play @ desktop-1920: 1 pages, primary at 233px (above fold), 0/0 roster rows visible
    nba-play @ laptop-1536: 1 pages, primary at 211px (above fold), 0/0 roster rows visible
    nba-play @ laptop-1440: 1 pages, primary at 232px (above fold), 0/0 roster rows visible
    nba-play @ laptop-1366: 1 pages, primary at 211px (above fold), 0/0 roster rows visible
    nba-play @ phone-430: 1.09 pages, primary at 237px (above fold), 0/0 roster rows visible
    nba-play @ phone-390: 1.16 pages, primary at 228px (above fold), 0/0 roster rows visible
    nba-play @ phone-375: 1.49 pages, primary at 228px (above fold), 0/0 roster rows visible
    nba-draft-open @ desktop-1920: 1 pages, primary at 244px (above fold), 20/20 roster rows visible
    nba-draft-open @ laptop-1536: 1 pages, primary at 203px (above fold), 20/20 roster rows visible
    nba-draft-open @ laptop-1440: 1 pages, primary at 243px (above fold), 20/20 roster rows visible
    nba-draft-open @ laptop-1366: 1 pages, primary at 203px (above fold), 20/20 roster rows visible
    nba-draft-open @ phone-430: 1 pages, primary at 230px (above fold), 20/20 roster rows visible
    nba-draft-open @ phone-390: 1 pages, primary at 220px (above fold), 20/20 roster rows visible
    nba-draft-open @ phone-375: 1.08 pages, primary at 220px (above fold), 20/20 roster rows visible
  nba-first-half round 1: Dominique Wilkins
  nba-first-half round 2: Tim Duncan
  nba-first-half round 3: Dwight Howard
  nba-first-half round 4: George Gervin
  nba-first-half round 5: Kevin Durant
  nba-first-half round 6: Danny Granger
  nba-first-half round 7: Rony Seikaly
  nba-first-half round 8: Donovan Mitchell
  nba-first-half round 9: Michael Adams
  nba-first-half round 10: Isaiah Thomas
    nba-rotation @ desktop-1920: 1 pages, primary at 490px (above fold), 20/20 roster rows visible
    nba-rotation @ laptop-1536: 1.01 pages, primary at 439px (above fold), 20/20 roster rows visible
    nba-rotation @ laptop-1440: 1.11 pages, primary at 490px (above fold), 17/20 roster rows visible
    nba-rotation @ laptop-1366: 1.14 pages, primary at 439px (above fold), 16/20 roster rows visible
    nba-rotation @ phone-430: 1.64 pages, primary at 500px (above fold), 0/20 roster rows visible
    nba-rotation @ phone-390: 1.76 pages, primary at 504px (above fold), 0/20 roster rows visible
    nba-rotation @ phone-375: 2.22 pages, primary at 504px (above fold), 0/20 roster rows visible
    nba-matchups @ desktop-1920: 1 pages, primary at 490px (above fold), 20/20 roster rows visible
    nba-matchups @ laptop-1536: 1.01 pages, primary at 439px (above fold), 20/20 roster rows visible
    nba-matchups @ laptop-1440: 1.11 pages, primary at 490px (above fold), 17/20 roster rows visible
    nba-matchups @ laptop-1366: 1.14 pages, primary at 439px (above fold), 16/20 roster rows visible
    nba-matchups @ phone-430: 1.41 pages, primary at 515px (above fold), 0/20 roster rows visible
    nba-matchups @ phone-390: 1.52 pages, primary at 504px (above fold), 0/20 roster rows visible
    nba-matchups @ phone-375: 1.92 pages, primary at 504px (above fold), 0/20 roster rows visible
    nba-gameplan @ desktop-1920: 1 pages, primary at 475px (above fold), 20/20 roster rows visible
    nba-gameplan @ laptop-1536: 1.01 pages, primary at 424px (above fold), 20/20 roster rows visible
    nba-gameplan @ laptop-1440: 1.11 pages, primary at 475px (above fold), 17/20 roster rows visible
    nba-gameplan @ laptop-1366: 1.14 pages, primary at 424px (above fold), 16/20 roster rows visible
    nba-gameplan @ phone-430: 1.3 pages, primary at 485px (above fold), 6/20 roster rows visible
    nba-gameplan @ phone-390: 1.39 pages, primary at 474px (above fold), 0/20 roster rows visible
    nba-gameplan @ phone-375: 1.76 pages, primary at 474px (above fold), 0/20 roster rows visible
    nba-game-live @ desktop-1920: 2.13 pages, primary at 76px (above fold), 20/20 roster rows visible
    nba-game-live @ laptop-1536: 2.46 pages, primary at 56px (above fold), 20/20 roster rows visible
    nba-game-live @ laptop-1440: 2.55 pages, primary at 76px (above fold), 20/20 roster rows visible
    nba-game-live @ laptop-1366: 2.76 pages, primary at 56px (above fold), 20/20 roster rows visible
    nba-game-live @ phone-430: 2.19 pages, primary at 72px (above fold), 20/20 roster rows visible
    nba-game-live @ phone-390: 2.33 pages, primary at 69px (above fold), 20/20 roster rows visible
    nba-game-live @ phone-375: 2.93 pages, primary at 69px (above fold), 20/20 roster rows visible
    nba-game-final @ desktop-1920: 2.76 pages, primary at 2859px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ laptop-1536: 3.4 pages, primary at 2818px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ laptop-1440: 3.31 pages, primary at 2859px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ laptop-1366: 3.77 pages, primary at 2769px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ phone-430: 3.06 pages, primary at 1491px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ phone-390: 3.29 pages, primary at 1451px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ phone-375: 4.14 pages, primary at 1442px (BELOW fold), 20/20 roster rows visible
```