# Density audit — 2026-09-16-ed62a55 (v3-nba)

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
| nba-draft-open | desktop-1920 | 1 | 56 | 113 | 33 | 256 | yes | 20/20 | 0px |
| nba-draft-open | laptop-1536 | 1 | 44 | 94 | 28 | 203 | yes | 20/20 | 0px |
| nba-draft-open | laptop-1440 | 1 | 56 | 105 | 31 | 243 | yes | 20/20 | 0px |
| nba-draft-open | laptop-1366 | 1 | 44 | 94 | 28 | 203 | yes | 20/20 | 0px |
| nba-draft-open | phone-430 | 1 | 57 | 106 | 28 | 230 | yes | 20/20 | 0px |
| nba-draft-open | phone-390 | 1 | 58 | 100 | 28 | 220 | yes | 20/20 | 0px |
| nba-draft-open | phone-375 | 1.08 | 58 | 100 | 28 | 220 | yes | 20/20 | 0px |
| nba-rotation | desktop-1920 | 1 | 56 | 109 | 0 | 467 | yes | 20/20 | 0px |
| nba-rotation | laptop-1536 | 1 | 44 | 89 | 0 | 408 | yes | 20/20 | 0px |
| nba-rotation | laptop-1440 | 1.08 | 56 | 101 | 0 | 459 | yes | 18/20 | 0px |
| nba-rotation | laptop-1366 | 1.1 | 44 | 89 | 0 | 408 | yes | 18/20 | 0px |
| nba-rotation | phone-430 | 1.58 | 57 | 84 | 3 | 445 | yes | 0/20 | 0px |
| nba-rotation | phone-390 | 1.67 | 58 | 77 | 3 | 432 | yes | 0/20 | 0px |
| nba-rotation | phone-375 | 2.11 | 58 | 77 | 3 | 432 | yes | 0/20 | 0px |
| nba-matchups | desktop-1920 | 1 | 56 | 109 | 0 | 467 | yes | 20/20 | 0px |
| nba-matchups | laptop-1536 | 1 | 44 | 89 | 0 | 408 | yes | 20/20 | 0px |
| nba-matchups | laptop-1440 | 1.08 | 56 | 101 | 0 | 459 | yes | 18/20 | 0px |
| nba-matchups | laptop-1366 | 1.1 | 44 | 89 | 0 | 408 | yes | 18/20 | 0px |
| nba-matchups | phone-430 | 1.35 | 57 | 84 | 3 | 460 | yes | 2/20 | 0px |
| nba-matchups | phone-390 | 1.43 | 58 | 77 | 3 | 432 | yes | 0/20 | 0px |
| nba-matchups | phone-375 | 1.81 | 58 | 77 | 3 | 432 | yes | 0/20 | 0px |
| nba-gameplan | desktop-1920 | 1 | 56 | 109 | 0 | 452 | yes | 20/20 | 0px |
| nba-gameplan | laptop-1536 | 1 | 44 | 89 | 0 | 393 | yes | 20/20 | 0px |
| nba-gameplan | laptop-1440 | 1.08 | 56 | 101 | 0 | 444 | yes | 18/20 | 0px |
| nba-gameplan | laptop-1366 | 1.1 | 44 | 89 | 0 | 393 | yes | 18/20 | 0px |
| nba-gameplan | phone-430 | 1.24 | 57 | 84 | 3 | 430 | yes | 10/20 | 0px |
| nba-gameplan | phone-390 | 1.31 | 58 | 77 | 3 | 402 | yes | 6/20 | 0px |
| nba-gameplan | phone-375 | 1.66 | 58 | 77 | 3 | 402 | yes | 0/20 | 0px |
| nba-game-live | desktop-1920 | 2.13 | 56 | - | - | 76 | yes | 20/20 | 0px |
| nba-game-live | laptop-1536 | 2.46 | 44 | - | - | 56 | yes | 20/20 | 0px |
| nba-game-live | laptop-1440 | 2.55 | 56 | - | - | 76 | yes | 20/20 | 0px |
| nba-game-live | laptop-1366 | 2.76 | 44 | - | - | 56 | yes | 20/20 | 0px |
| nba-game-live | phone-430 | 2.25 | 57 | - | - | 72 | yes | 20/20 | 0px |
| nba-game-live | phone-390 | 2.39 | 58 | - | - | 69 | yes | 20/20 | 0px |
| nba-game-live | phone-375 | 3.02 | 58 | - | - | 69 | yes | 20/20 | 0px |
| nba-game-final | desktop-1920 | 2.72 | 56 | - | - | 2816 | NO | 20/20 | 0px |
| nba-game-final | laptop-1536 | 3.35 | 44 | - | - | 2774 | NO | 20/20 | 0px |
| nba-game-final | laptop-1440 | 3.27 | 56 | - | - | 2816 | NO | 20/20 | 0px |
| nba-game-final | laptop-1366 | 3.71 | 44 | - | - | 2726 | NO | 20/20 | 0px |
| nba-game-final | phone-430 | 3.06 | 57 | - | - | 1436 | NO | 20/20 | 0px |
| nba-game-final | phone-390 | 3.29 | 58 | - | - | 1399 | NO | 20/20 | 0px |
| nba-game-final | phone-375 | 4.17 | 58 | - | - | 1404 | NO | 20/20 | 0px |

## Run log

```
Density audit (v3-nba) — serving /home/user/Gamebuild at http://127.0.0.1:8936/

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
    nba-draft-open @ desktop-1920: 1 pages, primary at 256px (above fold), 20/20 roster rows visible
    nba-draft-open @ laptop-1536: 1 pages, primary at 203px (above fold), 20/20 roster rows visible
    nba-draft-open @ laptop-1440: 1 pages, primary at 243px (above fold), 20/20 roster rows visible
    nba-draft-open @ laptop-1366: 1 pages, primary at 203px (above fold), 20/20 roster rows visible
    nba-draft-open @ phone-430: 1 pages, primary at 230px (above fold), 20/20 roster rows visible
    nba-draft-open @ phone-390: 1 pages, primary at 220px (above fold), 20/20 roster rows visible
    nba-draft-open @ phone-375: 1.08 pages, primary at 220px (above fold), 20/20 roster rows visible
  nba-first-half round 1: Kelly Tripucka
  nba-first-half round 2: Trae Young
  nba-first-half round 3: Mike Conley
  nba-first-half round 4: Charles Barkley
  nba-first-half round 5: Kevin Durant
  nba-first-half round 6: Karl Malone
  nba-first-half round 7: Pascal Siakam
  nba-first-half round 8: Allen Iverson
  nba-first-half round 9: World B. Free
    nba-rotation @ desktop-1920: 1 pages, primary at 467px (above fold), 20/20 roster rows visible
    nba-rotation @ laptop-1536: 1 pages, primary at 408px (above fold), 20/20 roster rows visible
    nba-rotation @ laptop-1440: 1.08 pages, primary at 459px (above fold), 18/20 roster rows visible
    nba-rotation @ laptop-1366: 1.1 pages, primary at 408px (above fold), 18/20 roster rows visible
    nba-rotation @ phone-430: 1.58 pages, primary at 445px (above fold), 0/20 roster rows visible
    nba-rotation @ phone-390: 1.67 pages, primary at 432px (above fold), 0/20 roster rows visible
    nba-rotation @ phone-375: 2.11 pages, primary at 432px (above fold), 0/20 roster rows visible
    nba-matchups @ desktop-1920: 1 pages, primary at 467px (above fold), 20/20 roster rows visible
    nba-matchups @ laptop-1536: 1 pages, primary at 408px (above fold), 20/20 roster rows visible
    nba-matchups @ laptop-1440: 1.08 pages, primary at 459px (above fold), 18/20 roster rows visible
    nba-matchups @ laptop-1366: 1.1 pages, primary at 408px (above fold), 18/20 roster rows visible
    nba-matchups @ phone-430: 1.35 pages, primary at 460px (above fold), 2/20 roster rows visible
    nba-matchups @ phone-390: 1.43 pages, primary at 432px (above fold), 0/20 roster rows visible
    nba-matchups @ phone-375: 1.81 pages, primary at 432px (above fold), 0/20 roster rows visible
    nba-gameplan @ desktop-1920: 1 pages, primary at 452px (above fold), 20/20 roster rows visible
    nba-gameplan @ laptop-1536: 1 pages, primary at 393px (above fold), 20/20 roster rows visible
    nba-gameplan @ laptop-1440: 1.08 pages, primary at 444px (above fold), 18/20 roster rows visible
    nba-gameplan @ laptop-1366: 1.1 pages, primary at 393px (above fold), 18/20 roster rows visible
    nba-gameplan @ phone-430: 1.24 pages, primary at 430px (above fold), 10/20 roster rows visible
    nba-gameplan @ phone-390: 1.31 pages, primary at 402px (above fold), 6/20 roster rows visible
    nba-gameplan @ phone-375: 1.66 pages, primary at 402px (above fold), 0/20 roster rows visible
    nba-game-live @ desktop-1920: 2.13 pages, primary at 76px (above fold), 20/20 roster rows visible
    nba-game-live @ laptop-1536: 2.46 pages, primary at 56px (above fold), 20/20 roster rows visible
    nba-game-live @ laptop-1440: 2.55 pages, primary at 76px (above fold), 20/20 roster rows visible
    nba-game-live @ laptop-1366: 2.76 pages, primary at 56px (above fold), 20/20 roster rows visible
    nba-game-live @ phone-430: 2.25 pages, primary at 72px (above fold), 20/20 roster rows visible
    nba-game-live @ phone-390: 2.39 pages, primary at 69px (above fold), 20/20 roster rows visible
    nba-game-live @ phone-375: 3.02 pages, primary at 69px (above fold), 20/20 roster rows visible
    nba-game-final @ desktop-1920: 2.72 pages, primary at 2816px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ laptop-1536: 3.35 pages, primary at 2774px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ laptop-1440: 3.27 pages, primary at 2816px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ laptop-1366: 3.71 pages, primary at 2726px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ phone-430: 3.06 pages, primary at 1436px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ phone-390: 3.29 pages, primary at 1399px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ phone-375: 4.17 pages, primary at 1404px (BELOW fold), 20/20 roster rows visible
```