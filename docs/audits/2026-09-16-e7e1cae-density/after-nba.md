# Density audit — 2026-09-16-e7e1cae (after-nba)

Captured by `npm run audit:density`. `pages` is document height in viewport-fuls:
1.00 means the screen fits. `primary` is where the thing you are on the screen to
use starts, in pixels from the top of the document.

| screen | viewport | pages | nav | banner | tabs | primary | above fold | roster rows visible | h-overflow |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| nba-play | desktop-1920 | 1 | 45 | - | - | 217 | yes | 0/0 | 0px |
| nba-play | laptop-1536 | 1 | 45 | - | - | 213 | yes | 0/0 | 0px |
| nba-play | laptop-1440 | 1 | 45 | - | - | 217 | yes | 0/0 | 0px |
| nba-play | laptop-1366 | 1 | 45 | - | - | 213 | yes | 0/0 | 0px |
| nba-play | phone-430 | 1.04 | 57 | - | - | 236 | yes | 0/0 | 0px |
| nba-play | phone-390 | 1.16 | 57 | - | - | 228 | yes | 0/0 | 0px |
| nba-play | phone-375 | 1.49 | 57 | - | - | 228 | yes | 0/0 | 0px |
| nba-draft-open | desktop-1920 | 1 | 45 | 97 | 28 | 215 | yes | 20/20 | 0px |
| nba-draft-open | laptop-1536 | 1 | 45 | 94 | 28 | 205 | yes | 20/20 | 0px |
| nba-draft-open | laptop-1440 | 1 | 45 | 97 | 28 | 214 | yes | 20/20 | 0px |
| nba-draft-open | laptop-1366 | 1 | 45 | 94 | 28 | 205 | yes | 20/20 | 0px |
| nba-draft-open | phone-430 | 1 | 57 | 106 | 28 | 230 | yes | 20/20 | 0px |
| nba-draft-open | phone-390 | 1 | 57 | 100 | 28 | 217 | yes | 20/20 | 0px |
| nba-draft-open | phone-375 | 1.07 | 57 | 100 | 28 | 217 | yes | 20/20 | 0px |
| nba-rotation | desktop-1920 | 1 | 45 | 93 | 0 | 484 | yes | 20/20 | 0px |
| nba-rotation | laptop-1536 | 1.06 | 45 | 90 | 0 | 468 | yes | 19/20 | 0px |
| nba-rotation | laptop-1440 | 1.04 | 45 | 93 | 0 | 484 | yes | 20/20 | 0px |
| nba-rotation | laptop-1366 | 1.2 | 45 | 90 | 0 | 468 | yes | 15/20 | 0px |
| nba-rotation | phone-430 | 1.7 | 57 | 84 | 3 | 581 | yes | 0/20 | 0px |
| nba-rotation | phone-390 | 1.85 | 57 | 77 | 3 | 586 | yes | 0/20 | 0px |
| nba-rotation | phone-375 | 2.35 | 57 | 77 | 3 | 586 | yes | 0/20 | 0px |
| nba-matchups | desktop-1920 | 1 | 45 | 93 | 0 | 484 | yes | 20/20 | 0px |
| nba-matchups | laptop-1536 | 1.06 | 45 | 90 | 0 | 468 | yes | 19/20 | 0px |
| nba-matchups | laptop-1440 | 1.04 | 45 | 93 | 0 | 484 | yes | 20/20 | 0px |
| nba-matchups | laptop-1366 | 1.2 | 45 | 90 | 0 | 468 | yes | 15/20 | 0px |
| nba-matchups | phone-430 | 1.49 | 57 | 84 | 3 | 596 | yes | 0/20 | 0px |
| nba-matchups | phone-390 | 1.61 | 57 | 77 | 3 | 586 | yes | 0/20 | 0px |
| nba-matchups | phone-375 | 2.04 | 57 | 77 | 3 | 586 | yes | 0/20 | 0px |
| nba-gameplan | desktop-1920 | 1 | 45 | 93 | 0 | 469 | yes | 20/20 | 0px |
| nba-gameplan | laptop-1536 | 1.06 | 45 | 90 | 0 | 453 | yes | 19/20 | 0px |
| nba-gameplan | laptop-1440 | 1.04 | 45 | 93 | 0 | 469 | yes | 20/20 | 0px |
| nba-gameplan | laptop-1366 | 1.2 | 45 | 90 | 0 | 453 | yes | 15/20 | 0px |
| nba-gameplan | phone-430 | 1.38 | 57 | 84 | 3 | 566 | yes | 0/20 | 0px |
| nba-gameplan | phone-390 | 1.49 | 57 | 77 | 3 | 556 | yes | 0/20 | 0px |
| nba-gameplan | phone-375 | 1.89 | 57 | 77 | 3 | 556 | yes | 0/20 | 0px |
| nba-game-live | desktop-1920 | 2.1 | 45 | - | - | 61 | yes | 20/20 | 0px |
| nba-game-live | laptop-1536 | 2.47 | 45 | - | - | 57 | yes | 20/20 | 0px |
| nba-game-live | laptop-1440 | 2.52 | 45 | - | - | 61 | yes | 20/20 | 0px |
| nba-game-live | laptop-1366 | 2.73 | 45 | - | - | 57 | yes | 20/20 | 0px |
| nba-game-live | phone-430 | 2.18 | 57 | - | - | 72 | yes | 20/20 | 0px |
| nba-game-live | phone-390 | 2.32 | 57 | - | - | 67 | yes | 20/20 | 0px |
| nba-game-live | phone-375 | 2.93 | 57 | - | - | 67 | yes | 20/20 | 0px |
| nba-game-final | desktop-1920 | 2.76 | 45 | - | - | 2862 | NO | 20/20 | 0px |
| nba-game-final | laptop-1536 | 3.41 | 45 | - | - | 2826 | NO | 20/20 | 0px |
| nba-game-final | laptop-1440 | 3.32 | 45 | - | - | 2862 | NO | 20/20 | 0px |
| nba-game-final | laptop-1366 | 3.78 | 45 | - | - | 2777 | NO | 20/20 | 0px |
| nba-game-final | phone-430 | 3.14 | 57 | - | - | 1520 | NO | 20/20 | 0px |
| nba-game-final | phone-390 | 3.35 | 57 | - | - | 1468 | NO | 20/20 | 0px |
| nba-game-final | phone-375 | 4.23 | 57 | - | - | 1458 | NO | 20/20 | 0px |

## Run log

```
Density audit (after-nba) — serving /home/user/Gamebuild at http://127.0.0.1:8936/

NBA
  already signed in (existing session restored)
  nba: play screen open
    nba-play @ desktop-1920: 1 pages, primary at 217px (above fold), 0/0 roster rows visible
    nba-play @ laptop-1536: 1 pages, primary at 213px (above fold), 0/0 roster rows visible
    nba-play @ laptop-1440: 1 pages, primary at 217px (above fold), 0/0 roster rows visible
    nba-play @ laptop-1366: 1 pages, primary at 213px (above fold), 0/0 roster rows visible
    nba-play @ phone-430: 1.04 pages, primary at 236px (above fold), 0/0 roster rows visible
    nba-play @ phone-390: 1.16 pages, primary at 228px (above fold), 0/0 roster rows visible
    nba-play @ phone-375: 1.49 pages, primary at 228px (above fold), 0/0 roster rows visible
    nba-draft-open @ desktop-1920: 1 pages, primary at 215px (above fold), 20/20 roster rows visible
    nba-draft-open @ laptop-1536: 1 pages, primary at 205px (above fold), 20/20 roster rows visible
    nba-draft-open @ laptop-1440: 1 pages, primary at 214px (above fold), 20/20 roster rows visible
    nba-draft-open @ laptop-1366: 1 pages, primary at 205px (above fold), 20/20 roster rows visible
    nba-draft-open @ phone-430: 1 pages, primary at 230px (above fold), 20/20 roster rows visible
    nba-draft-open @ phone-390: 1 pages, primary at 217px (above fold), 20/20 roster rows visible
    nba-draft-open @ phone-375: 1.07 pages, primary at 217px (above fold), 20/20 roster rows visible
  nba-first-half round 1: Cade Cunningham
  nba-first-half round 2: Stephen Curry
  nba-first-half round 3: Shareef Abdur-Rahim
  nba-first-half round 4: David Robinson
  nba-first-half round 5: Terry Catledge
  nba-first-half round 6: Dominique Wilkins
  nba-first-half round 7: Kelly Tripucka
  nba-first-half round 8: Danny Granger
  nba-first-half round 9: Trae Young
  nba-first-half round 10: James Harden
    nba-rotation @ desktop-1920: 1 pages, primary at 484px (above fold), 20/20 roster rows visible
    nba-rotation @ laptop-1536: 1.06 pages, primary at 468px (above fold), 19/20 roster rows visible
    nba-rotation @ laptop-1440: 1.04 pages, primary at 484px (above fold), 20/20 roster rows visible
    nba-rotation @ laptop-1366: 1.2 pages, primary at 468px (above fold), 15/20 roster rows visible
    nba-rotation @ phone-430: 1.7 pages, primary at 581px (above fold), 0/20 roster rows visible
    nba-rotation @ phone-390: 1.85 pages, primary at 586px (above fold), 0/20 roster rows visible
    nba-rotation @ phone-375: 2.35 pages, primary at 586px (above fold), 0/20 roster rows visible
    nba-matchups @ desktop-1920: 1 pages, primary at 484px (above fold), 20/20 roster rows visible
    nba-matchups @ laptop-1536: 1.06 pages, primary at 468px (above fold), 19/20 roster rows visible
    nba-matchups @ laptop-1440: 1.04 pages, primary at 484px (above fold), 20/20 roster rows visible
    nba-matchups @ laptop-1366: 1.2 pages, primary at 468px (above fold), 15/20 roster rows visible
    nba-matchups @ phone-430: 1.49 pages, primary at 596px (above fold), 0/20 roster rows visible
    nba-matchups @ phone-390: 1.61 pages, primary at 586px (above fold), 0/20 roster rows visible
    nba-matchups @ phone-375: 2.04 pages, primary at 586px (above fold), 0/20 roster rows visible
    nba-gameplan @ desktop-1920: 1 pages, primary at 469px (above fold), 20/20 roster rows visible
    nba-gameplan @ laptop-1536: 1.06 pages, primary at 453px (above fold), 19/20 roster rows visible
    nba-gameplan @ laptop-1440: 1.04 pages, primary at 469px (above fold), 20/20 roster rows visible
    nba-gameplan @ laptop-1366: 1.2 pages, primary at 453px (above fold), 15/20 roster rows visible
    nba-gameplan @ phone-430: 1.38 pages, primary at 566px (above fold), 0/20 roster rows visible
    nba-gameplan @ phone-390: 1.49 pages, primary at 556px (above fold), 0/20 roster rows visible
    nba-gameplan @ phone-375: 1.89 pages, primary at 556px (above fold), 0/20 roster rows visible
    nba-game-live @ desktop-1920: 2.1 pages, primary at 61px (above fold), 20/20 roster rows visible
    nba-game-live @ laptop-1536: 2.47 pages, primary at 57px (above fold), 20/20 roster rows visible
    nba-game-live @ laptop-1440: 2.52 pages, primary at 61px (above fold), 20/20 roster rows visible
    nba-game-live @ laptop-1366: 2.73 pages, primary at 57px (above fold), 20/20 roster rows visible
    nba-game-live @ phone-430: 2.18 pages, primary at 72px (above fold), 20/20 roster rows visible
    nba-game-live @ phone-390: 2.32 pages, primary at 67px (above fold), 20/20 roster rows visible
    nba-game-live @ phone-375: 2.93 pages, primary at 67px (above fold), 20/20 roster rows visible
    nba-game-final @ desktop-1920: 2.76 pages, primary at 2862px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ laptop-1536: 3.41 pages, primary at 2826px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ laptop-1440: 3.32 pages, primary at 2862px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ laptop-1366: 3.78 pages, primary at 2777px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ phone-430: 3.14 pages, primary at 1520px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ phone-390: 3.35 pages, primary at 1468px (BELOW fold), 20/20 roster rows visible
    nba-game-final @ phone-375: 4.23 pages, primary at 1458px (BELOW fold), 20/20 roster rows visible
```