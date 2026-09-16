# Density audit — 2026-09-16-0bdacf8 (before-nfl)

Captured by `npm run audit:density`. `pages` is document height in viewport-fuls:
1.00 means the screen fits. `primary` is where the thing you are on the screen to
use starts, in pixels from the top of the document.

| screen | viewport | pages | nav | banner | tabs | primary | above fold | roster rows visible | h-overflow |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| nfl-play | desktop-1920 | 1 | 65 | - | - | 252 | yes | 0/0 | 0px |
| nfl-play | laptop-1536 | 1.12 | 65 | - | - | 251 | yes | 0/0 | 0px |
| nfl-play | laptop-1440 | 1.07 | 65 | - | - | 251 | yes | 0/0 | 0px |
| nfl-play | laptop-1366 | 1.26 | 65 | - | - | 251 | yes | 0/0 | 0px |
| nfl-play | phone-430 | 1.17 | 63 | - | - | 248 | yes | 0/0 | 0px |
| nfl-play | phone-390 | 1.28 | 62 | - | - | 243 | yes | 0/0 | 0px |
| nfl-play | phone-375 | 1.62 | 62 | - | - | 243 | yes | 0/0 | 0px |
| nfl-draft-open | desktop-1920 | 1 | 65 | 114 | 36 | 280 | yes | 24/24 | 0px |
| nfl-draft-open | laptop-1536 | 1 | 65 | 114 | 36 | 280 | yes | 24/24 | 0px |
| nfl-draft-open | laptop-1440 | 1 | 65 | 114 | 36 | 280 | yes | 24/24 | 0px |
| nfl-draft-open | laptop-1366 | 1.07 | 65 | 114 | 36 | 280 | yes | 24/24 | 0px |
| nfl-draft-open | phone-430 | 1 | 63 | 110 | 28 | 240 | yes | 24/24 | 0px |
| nfl-draft-open | phone-390 | 1.02 | 62 | 108 | 28 | 236 | yes | 24/24 | 0px |
| nfl-draft-open | phone-375 | 1.29 | 62 | 108 | 28 | 236 | yes | 16/24 | 0px |
| nfl-draft-mid | desktop-1920 | 1 | 65 | 114 | 38 | 282 | yes | 24/24 | 0px |
| nfl-draft-mid | laptop-1536 | 1.17 | 65 | 114 | 38 | 282 | yes | 21/24 | 0px |
| nfl-draft-mid | laptop-1440 | 1.12 | 65 | 114 | 38 | 282 | yes | 22/24 | 0px |
| nfl-draft-mid | laptop-1366 | 1.32 | 65 | 114 | 38 | 282 | yes | 16/24 | 0px |
| nfl-draft-mid | phone-430 | 1.06 | 63 | 110 | 28 | 240 | yes | 24/24 | 0px |
| nfl-draft-mid | phone-390 | 1.16 | 62 | 108 | 28 | 236 | yes | 20/24 | 0px |
| nfl-draft-mid | phone-375 | 1.46 | 62 | 108 | 28 | 236 | yes | 10/24 | 0px |
| nfl-gameplan | desktop-1920 | 1.38 | 65 | 111 | 0 | 712 | yes | 14/24 | 0px |
| nfl-gameplan | laptop-1536 | 1.72 | 65 | 111 | 0 | 712 | yes | 6/24 | 0px |
| nfl-gameplan | laptop-1440 | 1.65 | 65 | 111 | 0 | 712 | yes | 8/24 | 0px |
| nfl-gameplan | laptop-1366 | 1.93 | 65 | 111 | 0 | 712 | yes | 2/24 | 0px |
| nfl-gameplan | phone-430 | 1.99 | 63 | 89 | 3 | 663 | yes | 0/24 | 0px |
| nfl-gameplan | phone-390 | 2.16 | 62 | 87 | 3 | 668 | yes | 0/24 | 0px |
| nfl-gameplan | phone-375 | 2.94 | 62 | 87 | 3 | 754 | NO | 0/24 | 0px |
| nfl-game-live | desktop-1920 | 2.34 | 65 | - | - | 89 | yes | 24/24 | 0px |
| nfl-game-live | laptop-1536 | 2.92 | 65 | - | - | 89 | yes | 24/24 | 0px |
| nfl-game-live | laptop-1440 | 2.8 | 65 | - | - | 89 | yes | 24/24 | 0px |
| nfl-game-live | laptop-1366 | 3.29 | 65 | - | - | 89 | yes | 24/24 | 0px |
| nfl-game-live | phone-430 | 2.68 | 63 | - | - | 78 | yes | 24/24 | 0px |
| nfl-game-live | phone-390 | 2.85 | 62 | - | - | 77 | yes | 24/24 | 0px |
| nfl-game-live | phone-375 | 3.6 | 62 | - | - | 77 | yes | 24/24 | 0px |
| nfl-game-final | desktop-1920 | 2.77 | 65 | - | - | 2850 | NO | 24/24 | 0px |
| nfl-game-final | laptop-1536 | 3.46 | 65 | - | - | 2850 | NO | 24/24 | 0px |
| nfl-game-final | laptop-1440 | 3.32 | 65 | - | - | 2850 | NO | 24/24 | 0px |
| nfl-game-final | laptop-1366 | 3.89 | 65 | - | - | 2850 | NO | 24/24 | 0px |
| nfl-game-final | phone-430 | 3.26 | 63 | - | - | 1061 | NO | 24/24 | 0px |
| nfl-game-final | phone-390 | 3.47 | 62 | - | - | 1037 | NO | 24/24 | 0px |
| nfl-game-final | phone-375 | 4.39 | 62 | - | - | 1036 | NO | 24/24 | 0px |

## Run log

```
Density audit (before-nfl) — serving /home/user/Gamebuild at http://127.0.0.1:8937/

NFL
  already signed in (existing session restored)
  nfl: play screen open
    nfl-play @ desktop-1920: 1 pages, primary at 252px (above fold), 0/0 roster rows visible
    nfl-play @ laptop-1536: 1.12 pages, primary at 251px (above fold), 0/0 roster rows visible
    nfl-play @ laptop-1440: 1.07 pages, primary at 251px (above fold), 0/0 roster rows visible
    nfl-play @ laptop-1366: 1.26 pages, primary at 251px (above fold), 0/0 roster rows visible
    nfl-play @ phone-430: 1.17 pages, primary at 248px (above fold), 0/0 roster rows visible
    nfl-play @ phone-390: 1.28 pages, primary at 243px (above fold), 0/0 roster rows visible
    nfl-play @ phone-375: 1.62 pages, primary at 243px (above fold), 0/0 roster rows visible
    nfl-draft-open @ desktop-1920: 1 pages, primary at 280px (above fold), 24/24 roster rows visible
    nfl-draft-open @ laptop-1536: 1 pages, primary at 280px (above fold), 24/24 roster rows visible
    nfl-draft-open @ laptop-1440: 1 pages, primary at 280px (above fold), 24/24 roster rows visible
    nfl-draft-open @ laptop-1366: 1.07 pages, primary at 280px (above fold), 24/24 roster rows visible
    nfl-draft-open @ phone-430: 1 pages, primary at 240px (above fold), 24/24 roster rows visible
    nfl-draft-open @ phone-390: 1.02 pages, primary at 236px (above fold), 24/24 roster rows visible
    nfl-draft-open @ phone-375: 1.29 pages, primary at 236px (above fold), 16/24 roster rows visible
  nfl-first-half round 1: Ronnie Brown
  nfl-first-half round 2: CeeDee Lamb
  nfl-first-half round 3: Robert Griffin III
  nfl-first-half round 4: Demaryius Thomas
  nfl-first-half round 5: Terrell Owens
  nfl-first-half round 6: Los Angeles Chargers Offensive Line
  nfl-first-half round 7: Jason Witten
  nfl-first-half round 8: Green Bay Packers Offensive Line
    nfl-draft-mid @ desktop-1920: 1 pages, primary at 282px (above fold), 24/24 roster rows visible
    nfl-draft-mid @ laptop-1536: 1.17 pages, primary at 282px (above fold), 21/24 roster rows visible
    nfl-draft-mid @ laptop-1440: 1.12 pages, primary at 282px (above fold), 22/24 roster rows visible
    nfl-draft-mid @ laptop-1366: 1.32 pages, primary at 282px (above fold), 16/24 roster rows visible
    nfl-draft-mid @ phone-430: 1.06 pages, primary at 240px (above fold), 24/24 roster rows visible
    nfl-draft-mid @ phone-390: 1.16 pages, primary at 236px (above fold), 20/24 roster rows visible
    nfl-draft-mid @ phone-375: 1.46 pages, primary at 236px (above fold), 10/24 roster rows visible
  nfl round 1: Carolina Panthers Linebackers
  nfl round 2: Detroit Lions Cornerbacks
  nfl round 3: Atlanta Falcons Safeties
  nfl round 4: Carolina Panthers Special Teams
    nfl-gameplan @ desktop-1920: 1.38 pages, primary at 712px (above fold), 14/24 roster rows visible
    nfl-gameplan @ laptop-1536: 1.72 pages, primary at 712px (above fold), 6/24 roster rows visible
    nfl-gameplan @ laptop-1440: 1.65 pages, primary at 712px (above fold), 8/24 roster rows visible
    nfl-gameplan @ laptop-1366: 1.93 pages, primary at 712px (above fold), 2/24 roster rows visible
    nfl-gameplan @ phone-430: 1.99 pages, primary at 663px (above fold), 0/24 roster rows visible
    nfl-gameplan @ phone-390: 2.16 pages, primary at 668px (above fold), 0/24 roster rows visible
    nfl-gameplan @ phone-375: 2.94 pages, primary at 754px (BELOW fold), 0/24 roster rows visible
    nfl-game-live @ desktop-1920: 2.34 pages, primary at 89px (above fold), 24/24 roster rows visible
    nfl-game-live @ laptop-1536: 2.92 pages, primary at 89px (above fold), 24/24 roster rows visible
    nfl-game-live @ laptop-1440: 2.8 pages, primary at 89px (above fold), 24/24 roster rows visible
    nfl-game-live @ laptop-1366: 3.29 pages, primary at 89px (above fold), 24/24 roster rows visible
    nfl-game-live @ phone-430: 2.68 pages, primary at 78px (above fold), 24/24 roster rows visible
    nfl-game-live @ phone-390: 2.85 pages, primary at 77px (above fold), 24/24 roster rows visible
    nfl-game-live @ phone-375: 3.6 pages, primary at 77px (above fold), 24/24 roster rows visible
    nfl-game-final @ desktop-1920: 2.77 pages, primary at 2850px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ laptop-1536: 3.46 pages, primary at 2850px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ laptop-1440: 3.32 pages, primary at 2850px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ laptop-1366: 3.89 pages, primary at 2850px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ phone-430: 3.26 pages, primary at 1061px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ phone-390: 3.47 pages, primary at 1037px (BELOW fold), 24/24 roster rows visible
    nfl-game-final @ phone-375: 4.39 pages, primary at 1036px (BELOW fold), 24/24 roster rows visible
```