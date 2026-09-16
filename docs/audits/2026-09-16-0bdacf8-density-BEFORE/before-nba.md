# Density audit — 2026-09-16-0bdacf8 (before-nba)

Captured by `npm run audit:density`. `pages` is document height in viewport-fuls:
1.00 means the screen fits. `primary` is where the thing you are on the screen to
use starts, in pixels from the top of the document.

| screen | viewport | pages | nav | banner | tabs | primary | above fold | roster rows visible | h-overflow |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| nba-play | desktop-1920 | 1 | 65 | - | - | 252 | yes | 0/0 | 0px |
| nba-play | laptop-1536 | 1.12 | 65 | - | - | 251 | yes | 0/0 | 0px |
| nba-play | laptop-1440 | 1.07 | 65 | - | - | 251 | yes | 0/0 | 0px |
| nba-play | laptop-1366 | 1.26 | 65 | - | - | 251 | yes | 0/0 | 0px |
| nba-play | phone-430 | 1.17 | 63 | - | - | 248 | yes | 0/0 | 0px |
| nba-play | phone-390 | 1.28 | 62 | - | - | 243 | yes | 0/0 | 0px |
| nba-play | phone-375 | 1.62 | 62 | - | - | 243 | yes | 0/0 | 0px |
| nba-draft-open | desktop-1920 | 1 | 65 | 114 | 36 | 280 | yes | 20/20 | 0px |
| nba-draft-open | laptop-1536 | 1 | 65 | 114 | 36 | 280 | yes | 20/20 | 0px |
| nba-draft-open | laptop-1440 | 1 | 65 | 114 | 36 | 280 | yes | 20/20 | 0px |
| nba-draft-open | laptop-1366 | 1 | 65 | 114 | 36 | 280 | yes | 20/20 | 0px |
| nba-draft-open | phone-430 | 1 | 63 | 110 | 28 | 240 | yes | 20/20 | 0px |
| nba-draft-open | phone-390 | 1 | 62 | 108 | 28 | 236 | yes | 20/20 | 0px |
| nba-draft-open | phone-375 | 1.19 | 62 | 108 | 28 | 236 | yes | 16/20 | 0px |
| nba-rotation | desktop-1920 | 1.28 | 65 | 111 | 0 | 603 | yes | 20/20 | 0px |
| nba-rotation | laptop-1536 | 1.61 | 65 | 111 | 0 | 603 | yes | 10/20 | 0px |
| nba-rotation | laptop-1440 | 1.54 | 65 | 111 | 0 | 603 | yes | 12/20 | 0px |
| nba-rotation | laptop-1366 | 1.81 | 65 | 111 | 0 | 603 | yes | 8/20 | 0px |
| nba-rotation | phone-430 | 1.86 | 63 | 89 | 3 | 541 | yes | 0/20 | 0px |
| nba-rotation | phone-390 | 2.04 | 62 | 87 | 3 | 562 | yes | 0/20 | 0px |
| nba-rotation | phone-375 | 2.58 | 62 | 87 | 3 | 562 | yes | 0/20 | 0px |
| nba-matchups | desktop-1920 | 1.06 | 65 | 111 | 0 | 603 | yes | 20/20 | 0px |
| nba-matchups | laptop-1536 | 1.32 | 65 | 111 | 0 | 603 | yes | 10/20 | 0px |
| nba-matchups | laptop-1440 | 1.27 | 65 | 111 | 0 | 603 | yes | 12/20 | 0px |
| nba-matchups | laptop-1366 | 1.49 | 65 | 111 | 0 | 603 | yes | 8/20 | 0px |
| nba-matchups | phone-430 | 1.52 | 63 | 89 | 3 | 556 | yes | 0/20 | 0px |
| nba-matchups | phone-390 | 1.66 | 62 | 87 | 3 | 562 | yes | 0/20 | 0px |
| nba-matchups | phone-375 | 2.1 | 62 | 87 | 3 | 562 | yes | 0/20 | 0px |
| nba-gameplan | desktop-1920 | 1.06 | 65 | 111 | 0 | 588 | yes | 20/20 | 0px |
| nba-gameplan | laptop-1536 | 1.32 | 65 | 111 | 0 | 588 | yes | 10/20 | 0px |
| nba-gameplan | laptop-1440 | 1.27 | 65 | 111 | 0 | 588 | yes | 12/20 | 0px |
| nba-gameplan | laptop-1366 | 1.49 | 65 | 111 | 0 | 588 | yes | 8/20 | 0px |
| nba-gameplan | phone-430 | 1.41 | 63 | 89 | 3 | 526 | yes | 2/20 | 0px |
| nba-gameplan | phone-390 | 1.54 | 62 | 87 | 3 | 532 | yes | 0/20 | 0px |
| nba-gameplan | phone-375 | 1.95 | 62 | 87 | 3 | 532 | yes | 0/20 | 0px |
| nba-game-live | desktop-1920 | 2.17 | 65 | - | - | 89 | yes | 20/20 | 0px |
| nba-game-live | laptop-1536 | 2.7 | 65 | - | - | 89 | yes | 20/20 | 0px |
| nba-game-live | laptop-1440 | 2.6 | 65 | - | - | 89 | yes | 20/20 | 0px |
| nba-game-live | laptop-1366 | 2.97 | 65 | - | - | 89 | yes | 20/20 | 0px |
| nba-game-live | phone-430 | 2.22 | 63 | - | - | 78 | yes | 20/20 | 0px |
| nba-game-live | phone-390 | 2.37 | 62 | - | - | 77 | yes | 20/20 | 0px |
| nba-game-live | phone-375 | 2.98 | 62 | - | - | 77 | yes | 20/20 | 0px |
| nba-game-final | desktop-1920 | 2.81 | 65 | - | - | 2898 | NO | 20/20 | 0px |
| nba-game-final | laptop-1536 | 3.52 | 65 | - | - | 2898 | NO | 20/20 | 0px |
| nba-game-final | laptop-1440 | 3.37 | 65 | - | - | 2898 | NO | 20/20 | 0px |
| nba-game-final | laptop-1366 | 3.89 | 65 | - | - | 2849 | NO | 20/20 | 0px |
| nba-game-final | phone-430 | 3.14 | 63 | - | - | 1506 | NO | 20/20 | 0px |
| nba-game-final | phone-390 | 3.36 | 62 | - | - | 1457 | NO | 20/20 | 0px |
| nba-game-final | phone-375 | 4.24 | 62 | - | - | 1448 | NO | 20/20 | 0px |

## Run log

```
Density audit (before-nba) — serving /home/user/Gamebuild at http://127.0.0.1:8936/

NBA
  already signed in (existing session restored)
  nba: play screen open
    nba-play @ desktop-1920: 1 pages, primary at 252px (above fold), 0/0 roster rows visible
    nba-play @ laptop-1536: 1.12 pages, primary at 251px (above fold), 0/0 roster rows visible
    nba-play @ laptop-1440: 1.07 pages, primary at 251px (above fold), 0/0 roster rows visible
    nba-play @ laptop-1366: 1.26 pages, primary at 251px (above fold), 0/0 roster rows visible
    nba-play @ phone-430: 1.17 pages, primary at 248px (above fold), 0/0 roster rows visible
    nba-play @ phone-390: 1.28 pages, primary at 243px (above fold), 0/0 roster rows visible
    nba-play @ phone-375: 1.62 pages, primary at 243px (above fold), 0/0 roster rows visible
    nba-draft-open @ desktop-1920: 1 pages, primary at 280px (above fold), 20/20 roster rows visible
    nba-draft-open @ laptop-1536: 1 pages, primary at 280px (above fold), 20/20 roster rows visible
    nba-draft-open @ laptop-1440: 1 pages, primary at 280px (above fold), 20/20 roster rows visible
    nba-draft-open @ laptop-1366: 1 pages, primary at 280px (above fold), 20/20 roster rows visible
    nba-draft-open @ phone-430: 1 pages, primary at 240px (above fold), 20/20 roster rows visible
    nba-draft-open @ phone-390: 1 pages, primary at 236px (above fold), 20/20 roster rows visible
    nba-draft-open @ phone-375: 1.19 pages, primary at 236px (above fold), 16/20 roster rows visible
  nba-first-half round 1: Isaiah Thomas
  nba-first-half round 2: Kevin Durant
  nba-first-half round 3: Brad Daugherty
  nba-first-half round 4: Devin Booker
  nba-first-half round 5: Clyde Drexler
  nba-first-half round 6: Kyrie Irving
  nba-first-half round 7: Karl Malone
  nba-first-half round 8: Amar'e Stoudemire
  nba-first-half round 9: Blake Griffin
  nba-first-half round 10: Vince Carter
    nba-rotation @ desktop-1920: 1.28 pages, primary at 603px (above fold), 20/20 roster rows visible
    nba-rotation @ laptop-1536: 1.61 pages, primary at 603px (above fold), 10/20 roster rows visible
    nba-rotation @ laptop-1440: 1.54 pages, primary at 603px (above fold), 12/20 roster rows visible
    nba-rotation @ laptop-1366: 1.81 pages, primary at 603px (above fold), 8/20 roster rows visible
    nba-rotation @ phone-430: 1.86 pages, primary at 541px (above fold), 0/20 roster rows visible
    nba-rotation @ phone-390: 2.04 pages, primary at 562px (above fold), 0/20 roster rows visible
    nba-rotation @ phone-375: 2.58 pages, primary at 562px (above fold), 0/20 roster rows visible
    nba-matchups @ desktop-1920: 1.06 pages, primary at 603px (above fold), 20/20 roster rows visible
    nba-matchups @ laptop-1536: 1.32 pages, primary at 603px (above fold), 10/20 roster rows visible
    nba-matchups @ laptop-1440: 1.27 pages, primary at 603px (above fold), 12/20 roster rows visible
    nba-matchups @ laptop-1366: 1.49 pages, primary at 603px (above fold), 8/20 roster rows visible
    nba-matchups @ phone-430: 1.52 pages, primary at 556px (above fold), 0/20 roster rows visible
    nba-matchups @ phone-390: 1.66 pages, primary at 562px (above fold), 0/20 roster rows visible
    nba-matchups @ phone-375: 2.1 pages, primary at 562px (above fold), 0/20 roster rows visible
    nba-gameplan @ desktop-1920: 1.06 pages, primary at 588px (above fold), 20/20 roster rows visible
    nba-gameplan @ laptop-1536: 1.32 pages, primary at 588px (above fold), 10/20 roster rows visible
    nba-gameplan @ laptop-1440: 1.27 pages, primary at 588px (above fold), 12/20 roster rows visible
    nba-gameplan @ laptop-1366: 1.49 pages, primary at 588px (above fold), 8/20 roster rows visible
    nba-gameplan @ phone-430: 1.41 pages, primary at 526px (above fold), 2/20 roster rows visible
    nba-gameplan @ phone-390: 1.54 pages, primary at 532px (above fold), 0/20 roster rows visible
    nba-gameplan @ phone-375: 1.95 pages, primary at 532px (above fold), 0/20 roster rows visible
    nba-game-live @ desktop-1920: 2.17 pages, primary at 89px (above fold), 20/20 roster rows visible
    nba-game-live @ laptop-1536: 2.7 pages, primary at 89px (above fold), 20/20 roster rows visible
    nba-game-live @ laptop-1440: 2.6 pages, primary at 89px (above fold), 20/20 roster rows visible
    nba-game-live @ laptop-1366: 2.97 pages, primary at 89px (above fold), 20/20 roster rows visible
    nba-game-live @ phone-430: 2.22 pages, primary at 78px (above fold), 20/20 roster rows visible
    nba-game-live @ phone-390: 2.37 pages, primary at 77px (above fold), 20/20 roster rows visible
    nba-game-live @ phone-375: 2.98 pages, primary at 77px (above fold), 20/20 roster rows visible
    nba-game-final @ desktop-1920: 2.81 pages, primary at 2898px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ laptop-1536: 3.52 pages, primary at 2898px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ laptop-1440: 3.37 pages, primary at 2898px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ laptop-1366: 3.89 pages, primary at 2849px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ phone-430: 3.14 pages, primary at 1506px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ phone-390: 3.36 pages, primary at 1457px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ phone-375: 4.24 pages, primary at 1448px (BELOW fold), 20/20 roster rows visible
```