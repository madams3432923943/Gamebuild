# Density pass, second round — spending the savings where the screen is short

Three states, all measured with `npm run audit:density` at the same seven
viewports:

- **before** — `../2026-09-16-0bdacf8-density-BEFORE/`, the state the complaint
  was about
- **shipped** — `../2026-09-16-e7e1cae-density/`, what merged in #71
- **now** — this directory

## Why there is a second round

The first pass was measured on a 1366x768 laptop, its decisions were driven by
HEIGHT, and its rules were written with no height condition at all. A 1920x1080
desktop with 300px of room to spare therefore got the same phone-sized header,
roster rows and scoreboard. Reported from the live site as "too zoomed out for
computer view", which is the correct reading.

Every size that moved is now two values: a comfortable one, and the tight one
inside the `max-height: 880px` block. The numbers below are the test of that.

## What the three columns show

| | 1366x768 (short) | 1920x1080 (roomy) | 390 (phone) |
| --- | --- | --- | --- |
| draft board, primary control | 280 -> 205 -> **203px** | 280 -> 215 -> **244px** | 236 -> 217 -> **220px** |
| NFL gameplan, primary control | 712 -> 559 -> **556px** | 712 -> 575 -> **607px** | 668 -> 591 -> **610px** |
| NBA rotation, pages | 1.81 -> 1.20 -> **1.14** | 1.28 -> 1.00 -> **1.00** | 2.04 -> 1.85 -> **1.76** |

The laptop column is flat between "shipped" and "now" - it keeps everything the
first pass won. The desktop column backs off toward comfortable while staying
well ahead of where it started. The phone column never moved, because the phone
breakpoint overrides every value that changed.

The board itself also widens to 1280px on a monitor with the width and the
height to fill it (`--content-max`). At a flat 1100px the game occupied a third
of a 1900px screen, which is the other half of "zoomed out": not that anything
is too big, but that there is so little of it.

## Every reading

91 paired rows, both sports. Zero horizontal overflow, zero escaping elements,
zero overlaps in all of them.

| screen | viewport | pages: before / shipped / now | primary px: before / shipped / now | rows visible now | h-overflow |
| --- | --- | --- | --- | --- | --- |
| nba-play | desktop-1920 | 1 / 1 / 1 | 252 / 217 / 233 | 0/0 | 0px |
| nba-play | laptop-1536 | 1.12 / 1 / 1 | 251 / 213 / 211 | 0/0 | 0px |
| nba-play | laptop-1440 | 1.07 / 1 / 1 | 251 / 217 / 232 | 0/0 | 0px |
| nba-play | laptop-1366 | 1.26 / 1 / 1 | 251 / 213 / 211 | 0/0 | 0px |
| nba-play | phone-430 | 1.17 / 1.04 / 1.09 | 248 / 236 / 237 | 0/0 | 0px |
| nba-play | phone-390 | 1.28 / 1.16 / 1.16 | 243 / 228 / 228 | 0/0 | 0px |
| nba-play | phone-375 | 1.62 / 1.49 / 1.49 | 243 / 228 / 228 | 0/0 | 0px |
| nba-draft-open | desktop-1920 | 1 / 1 / 1 | 280 / 215 / 244 | 20/20 | 0px |
| nba-draft-open | laptop-1536 | 1 / 1 / 1 | 280 / 205 / 203 | 20/20 | 0px |
| nba-draft-open | laptop-1440 | 1 / 1 / 1 | 280 / 214 / 243 | 20/20 | 0px |
| nba-draft-open | laptop-1366 | 1 / 1 / 1 | 280 / 205 / 203 | 20/20 | 0px |
| nba-draft-open | phone-430 | 1 / 1 / 1 | 240 / 230 / 230 | 20/20 | 0px |
| nba-draft-open | phone-390 | 1 / 1 / 1 | 236 / 217 / 220 | 20/20 | 0px |
| nba-draft-open | phone-375 | 1.19 / 1.07 / 1.08 | 236 / 217 / 220 | 20/20 | 0px |
| nba-rotation | desktop-1920 | 1.28 / 1 / 1 | 603 / 484 / 490 | 20/20 | 0px |
| nba-rotation | laptop-1536 | 1.61 / 1.06 / 1.01 | 603 / 468 / 439 | 20/20 | 0px |
| nba-rotation | laptop-1440 | 1.54 / 1.04 / 1.11 | 603 / 484 / 490 | 17/20 | 0px |
| nba-rotation | laptop-1366 | 1.81 / 1.2 / 1.14 | 603 / 468 / 439 | 16/20 | 0px |
| nba-rotation | phone-430 | 1.86 / 1.7 / 1.64 | 541 / 581 / 500 | 0/20 | 0px |
| nba-rotation | phone-390 | 2.04 / 1.85 / 1.76 | 562 / 586 / 504 | 0/20 | 0px |
| nba-rotation | phone-375 | 2.58 / 2.35 / 2.22 | 562 / 586 / 504 | 0/20 | 0px |
| nba-matchups | desktop-1920 | 1.06 / 1 / 1 | 603 / 484 / 490 | 20/20 | 0px |
| nba-matchups | laptop-1536 | 1.32 / 1.06 / 1.01 | 603 / 468 / 439 | 20/20 | 0px |
| nba-matchups | laptop-1440 | 1.27 / 1.04 / 1.11 | 603 / 484 / 490 | 17/20 | 0px |
| nba-matchups | laptop-1366 | 1.49 / 1.2 / 1.14 | 603 / 468 / 439 | 16/20 | 0px |
| nba-matchups | phone-430 | 1.52 / 1.49 / 1.41 | 556 / 596 / 515 | 0/20 | 0px |
| nba-matchups | phone-390 | 1.66 / 1.61 / 1.52 | 562 / 586 / 504 | 0/20 | 0px |
| nba-matchups | phone-375 | 2.1 / 2.04 / 1.92 | 562 / 586 / 504 | 0/20 | 0px |
| nba-gameplan | desktop-1920 | 1.06 / 1 / 1 | 588 / 469 / 475 | 20/20 | 0px |
| nba-gameplan | laptop-1536 | 1.32 / 1.06 / 1.01 | 588 / 453 / 424 | 20/20 | 0px |
| nba-gameplan | laptop-1440 | 1.27 / 1.04 / 1.11 | 588 / 469 / 475 | 17/20 | 0px |
| nba-gameplan | laptop-1366 | 1.49 / 1.2 / 1.14 | 588 / 453 / 424 | 16/20 | 0px |
| nba-gameplan | phone-430 | 1.41 / 1.38 / 1.3 | 526 / 566 / 485 | 6/20 | 0px |
| nba-gameplan | phone-390 | 1.54 / 1.49 / 1.39 | 532 / 556 / 474 | 0/20 | 0px |
| nba-gameplan | phone-375 | 1.95 / 1.89 / 1.76 | 532 / 556 / 474 | 0/20 | 0px |
| nba-game-live | desktop-1920 | 2.17 / 2.1 / 2.13 | 89 / 61 / 76 | 20/20 | 0px |
| nba-game-live | laptop-1536 | 2.7 / 2.47 / 2.46 | 89 / 57 / 56 | 20/20 | 0px |
| nba-game-live | laptop-1440 | 2.6 / 2.52 / 2.55 | 89 / 61 / 76 | 20/20 | 0px |
| nba-game-live | laptop-1366 | 2.97 / 2.73 / 2.76 | 89 / 57 / 56 | 20/20 | 0px |
| nba-game-live | phone-430 | 2.22 / 2.18 / 2.19 | 78 / 72 / 72 | 20/20 | 0px |
| nba-game-live | phone-390 | 2.37 / 2.32 / 2.33 | 77 / 67 / 69 | 20/20 | 0px |
| nba-game-live | phone-375 | 2.98 / 2.93 / 2.93 | 77 / 67 / 69 | 20/20 | 0px |
| nba-game-final | desktop-1920 | 2.81 / 2.76 / 2.76 | 2898 / 2862 / 2859 | 20/20 | 0px |
| nba-game-final | laptop-1536 | 3.52 / 3.41 / 3.4 | 2898 / 2826 / 2818 | 20/20 | 0px |
| nba-game-final | laptop-1440 | 3.37 / 3.32 / 3.31 | 2898 / 2862 / 2859 | 20/20 | 0px |
| nba-game-final | laptop-1366 | 3.89 / 3.78 / 3.77 | 2849 / 2777 / 2769 | 20/20 | 0px |
| nba-game-final | phone-430 | 3.14 / 3.14 / 3.06 | 1506 / 1520 / 1491 | 20/20 | 0px |
| nba-game-final | phone-390 | 3.36 / 3.35 / 3.29 | 1457 / 1468 / 1451 | 20/20 | 0px |
| nba-game-final | phone-375 | 4.24 / 4.23 / 4.14 | 1448 / 1458 / 1442 | 20/20 | 0px |
| nfl-play | desktop-1920 | 1 / 1 / 1 | 252 / 217 / 233 | 0/0 | 0px |
| nfl-play | laptop-1536 | 1.12 / 1 / 1 | 251 / 213 / 211 | 0/0 | 0px |
| nfl-play | laptop-1440 | 1.07 / 1 / 1 | 251 / 217 / 232 | 0/0 | 0px |
| nfl-play | laptop-1366 | 1.26 / 1 / 1 | 251 / 213 / 211 | 0/0 | 0px |
| nfl-play | phone-430 | 1.17 / 1.04 / 1.09 | 248 / 236 / 237 | 0/0 | 0px |
| nfl-play | phone-390 | 1.28 / 1.16 / 1.16 | 243 / 228 / 228 | 0/0 | 0px |
| nfl-play | phone-375 | 1.62 / 1.49 / 1.49 | 243 / 228 / 228 | 0/0 | 0px |
| nfl-draft-open | desktop-1920 | 1 / 1 / 1 | 280 / 215 / 244 | 24/24 | 0px |
| nfl-draft-open | laptop-1536 | 1 / 1 / 1 | 280 / 205 / 203 | 24/24 | 0px |
| nfl-draft-open | laptop-1440 | 1 / 1 / 1 | 280 / 214 / 243 | 24/24 | 0px |
| nfl-draft-open | laptop-1366 | 1.07 / 1 / 1 | 280 / 205 / 203 | 24/24 | 0px |
| nfl-draft-open | phone-430 | 1 / 1 / 1 | 240 / 230 / 230 | 24/24 | 0px |
| nfl-draft-open | phone-390 | 1.02 / 1 / 1 | 236 / 217 / 220 | 24/24 | 0px |
| nfl-draft-open | phone-375 | 1.29 / 1.15 / 1.16 | 236 / 217 / 220 | 22/24 | 0px |
| nfl-draft-mid | desktop-1920 | 1 / 1 / 1 | 282 / 215 / 244 | 24/24 | 0px |
| nfl-draft-mid | laptop-1536 | 1.17 / 1 / 1 | 282 / 206 / 204 | 24/24 | 0px |
| nfl-draft-mid | laptop-1440 | 1.12 / 1 / 1.06 | 282 / 215 / 244 | 23/24 | 0px |
| nfl-draft-mid | laptop-1366 | 1.32 / 1.03 / 1.07 | 282 / 206 / 204 | 23/24 | 0px |
| nfl-draft-mid | phone-430 | 1.06 / 1 / 1 | 240 / 230 / 230 | 24/24 | 0px |
| nfl-draft-mid | phone-390 | 1.16 / 1.05 / 1.04 | 236 / 217 / 220 | 24/24 | 0px |
| nfl-draft-mid | phone-375 | 1.46 / 1.33 / 1.32 | 236 / 217 / 220 | 15/24 | 0px |
| nfl-gameplan | desktop-1920 | 1.38 / 1.12 / 1.2 | 712 / 575 / 607 | 18/24 | 0px |
| nfl-gameplan | laptop-1536 | 1.72 / 1.38 / 1.39 | 712 / 559 / 556 | 14/24 | 0px |
| nfl-gameplan | laptop-1440 | 1.65 / 1.34 / 1.48 | 712 / 575 / 607 | 12/24 | 0px |
| nfl-gameplan | laptop-1366 | 1.93 / 1.55 / 1.57 | 712 / 559 / 556 | 10/24 | 0px |
| nfl-gameplan | phone-430 | 1.99 / 1.86 / 1.89 | 663 / 621 / 642 | 0/24 | 0px |
| nfl-gameplan | phone-390 | 2.16 / 1.98 / 2.07 | 668 / 591 / 610 | 0/24 | 0px |
| nfl-gameplan | phone-375 | 2.94 / 2.63 / 2.64 | 754 / 624 / 625 | 0/24 | 0px |
| nfl-game-live | desktop-1920 | 2.34 / 2.27 / 2.3 | 89 / 61 / 76 | 24/24 | 0px |
| nfl-game-live | laptop-1536 | 2.92 / 2.83 / 2.79 | 89 / 57 / 56 | 24/24 | 0px |
| nfl-game-live | laptop-1440 | 2.8 / 2.72 / 2.76 | 89 / 61 / 76 | 24/24 | 0px |
| nfl-game-live | laptop-1366 | 3.29 / 3.18 / 3.14 | 89 / 57 / 56 | 24/24 | 0px |
| nfl-game-live | phone-430 | 2.68 / 2.69 / 2.61 | 78 / 72 / 72 | 24/24 | 0px |
| nfl-game-live | phone-390 | 2.85 / 2.86 / 2.77 | 77 / 67 / 69 | 24/24 | 0px |
| nfl-game-live | phone-375 | 3.6 / 3.62 / 3.5 | 77 / 67 / 69 | 24/24 | 0px |
| nfl-game-final | desktop-1920 | 2.77 / 2.7 / 2.73 | 2850 / 2793 / 2825 | 24/24 | 0px |
| nfl-game-final | laptop-1536 | 3.46 / 3.37 / 3.33 | 2850 / 2789 / 2751 | 24/24 | 0px |
| nfl-game-final | laptop-1440 | 3.32 / 3.24 / 3.28 | 2850 / 2793 / 2825 | 24/24 | 0px |
| nfl-game-final | laptop-1366 | 3.89 / 3.79 / 3.74 | 2850 / 2789 / 2751 | 24/24 | 0px |
| nfl-game-final | phone-430 | 3.26 / 3.27 / 3.19 | 1061 / 1048 / 1052 | 24/24 | 0px |
| nfl-game-final | phone-390 | 3.47 / 3.49 / 3.39 | 1037 / 1020 / 1025 | 24/24 | 0px |
| nfl-game-final | phone-375 | 4.39 / 4.41 / 4.29 | 1036 / 1019 / 1024 | 24/24 | 0px |
