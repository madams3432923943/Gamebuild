# Density pass — before and after

`before-*` in `../2026-09-16-0bdacf8-density-BEFORE/` is the state the complaint
was about; `after-*` here is the same walk after the density pass. Both were
captured by `npm run audit:density`, which drives a real browser through both
sports at seven sizes.

`pages` is document height in viewport-fuls — 1.00 means the screen fits.
`primary` is where the thing you are on the screen to use starts, in pixels from
the top of the document: the search box on a draft, the minutes grid on a
rotation, the scoreboard in a game.

## What moved

| screen | 1366x768 | phone 390 |
| --- | --- | --- |
| Draft board, both sports | search box 280px -> 205px down | 236px -> 217px |
| Set your rotation (NBA) | 1.81 pages -> 1.20; 8 of 20 roster rows visible -> 15 | 2.04 -> 1.85 |
| Gameplan (NFL) | 1.93 pages -> 1.55; grid 712px -> 559px down | 2.16 -> 1.98, and at 375px the grid came back above the fold |
| Live game | 2.97 pages -> 2.73, play-by-play feed now on screen | 2.37 -> 2.32 |
| Setup screen | 1.26 pages -> 1.00, Start Draft above the fold | 1.28 -> 1.16 |

The header is 65px -> 45px on every screen in the game, and the squad banner
114px -> 94px. A ten-slot roster panel is 400px -> 315px.

## What did not

- **Post-game** is still 3.8 pages on a laptop. It is a report - a final
  scoreboard, the story of the game, an MVP, a full box score - and scrolling
  one is what a report is for. The `primary` reading of "below fold" on those
  rows is the box score, which is the bottom of the report by design.
- **The phone rotation screen** is 1.85 pages and the grade card above it is a
  third of that. The card carries more than it used to (nine capability chips
  rather than four numbers), which is a deliberate trade: the analysis was the
  half of that screen the player was told to ignore.
- **Phone setup** is 1.16 pages, so Start Draft is one short scroll below the
  fold at 390px. It is the one screen in the game with no clock running.

## Every reading

| screen | viewport | pages before | pages after | primary before | primary after | rows visible before | after | h-overflow |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| nba-play | desktop-1920 | 1 | 1 | 252 | 217 | 0/0 | 0/0 | 0 |
| nba-play | laptop-1536 | 1.12 | 1 | 251 | 213 | 0/0 | 0/0 | 0 |
| nba-play | laptop-1440 | 1.07 | 1 | 251 | 217 | 0/0 | 0/0 | 0 |
| nba-play | laptop-1366 | 1.26 | 1 | 251 | 213 | 0/0 | 0/0 | 0 |
| nba-play | phone-430 | 1.17 | 1.04 | 248 | 236 | 0/0 | 0/0 | 0 |
| nba-play | phone-390 | 1.28 | 1.16 | 243 | 228 | 0/0 | 0/0 | 0 |
| nba-play | phone-375 | 1.62 | 1.49 | 243 | 228 | 0/0 | 0/0 | 0 |
| nba-draft-open | desktop-1920 | 1 | 1 | 280 | 215 | 20/20 | 20/20 | 0 |
| nba-draft-open | laptop-1536 | 1 | 1 | 280 | 205 | 20/20 | 20/20 | 0 |
| nba-draft-open | laptop-1440 | 1 | 1 | 280 | 214 | 20/20 | 20/20 | 0 |
| nba-draft-open | laptop-1366 | 1 | 1 | 280 | 205 | 20/20 | 20/20 | 0 |
| nba-draft-open | phone-430 | 1 | 1 | 240 | 230 | 20/20 | 20/20 | 0 |
| nba-draft-open | phone-390 | 1 | 1 | 236 | 217 | 20/20 | 20/20 | 0 |
| nba-draft-open | phone-375 | 1.19 | 1.07 | 236 | 217 | 16/20 | 20/20 | 0 |
| nba-rotation | desktop-1920 | 1.28 | 1 | 603 | 484 | 20/20 | 20/20 | 0 |
| nba-rotation | laptop-1536 | 1.61 | 1.06 | 603 | 468 | 10/20 | 19/20 | 0 |
| nba-rotation | laptop-1440 | 1.54 | 1.04 | 603 | 484 | 12/20 | 20/20 | 0 |
| nba-rotation | laptop-1366 | 1.81 | 1.2 | 603 | 468 | 8/20 | 15/20 | 0 |
| nba-rotation | phone-430 | 1.86 | 1.7 | 541 | 581 | 0/20 | 0/20 | 0 |
| nba-rotation | phone-390 | 2.04 | 1.85 | 562 | 586 | 0/20 | 0/20 | 0 |
| nba-rotation | phone-375 | 2.58 | 2.35 | 562 | 586 | 0/20 | 0/20 | 0 |
| nba-matchups | desktop-1920 | 1.06 | 1 | 603 | 484 | 20/20 | 20/20 | 0 |
| nba-matchups | laptop-1536 | 1.32 | 1.06 | 603 | 468 | 10/20 | 19/20 | 0 |
| nba-matchups | laptop-1440 | 1.27 | 1.04 | 603 | 484 | 12/20 | 20/20 | 0 |
| nba-matchups | laptop-1366 | 1.49 | 1.2 | 603 | 468 | 8/20 | 15/20 | 0 |
| nba-matchups | phone-430 | 1.52 | 1.49 | 556 | 596 | 0/20 | 0/20 | 0 |
| nba-matchups | phone-390 | 1.66 | 1.61 | 562 | 586 | 0/20 | 0/20 | 0 |
| nba-matchups | phone-375 | 2.1 | 2.04 | 562 | 586 | 0/20 | 0/20 | 0 |
| nba-gameplan | desktop-1920 | 1.06 | 1 | 588 | 469 | 20/20 | 20/20 | 0 |
| nba-gameplan | laptop-1536 | 1.32 | 1.06 | 588 | 453 | 10/20 | 19/20 | 0 |
| nba-gameplan | laptop-1440 | 1.27 | 1.04 | 588 | 469 | 12/20 | 20/20 | 0 |
| nba-gameplan | laptop-1366 | 1.49 | 1.2 | 588 | 453 | 8/20 | 15/20 | 0 |
| nba-gameplan | phone-430 | 1.41 | 1.38 | 526 | 566 | 2/20 | 0/20 | 0 |
| nba-gameplan | phone-390 | 1.54 | 1.49 | 532 | 556 | 0/20 | 0/20 | 0 |
| nba-gameplan | phone-375 | 1.95 | 1.89 | 532 | 556 | 0/20 | 0/20 | 0 |
| nba-game-live | desktop-1920 | 2.17 | 2.1 | 89 | 61 | 20/20 | 20/20 | 0 |
| nba-game-live | laptop-1536 | 2.7 | 2.47 | 89 | 57 | 20/20 | 20/20 | 0 |
| nba-game-live | laptop-1440 | 2.6 | 2.52 | 89 | 61 | 20/20 | 20/20 | 0 |
| nba-game-live | laptop-1366 | 2.97 | 2.73 | 89 | 57 | 20/20 | 20/20 | 0 |
| nba-game-live | phone-430 | 2.22 | 2.18 | 78 | 72 | 20/20 | 20/20 | 0 |
| nba-game-live | phone-390 | 2.37 | 2.32 | 77 | 67 | 20/20 | 20/20 | 0 |
| nba-game-live | phone-375 | 2.98 | 2.93 | 77 | 67 | 20/20 | 20/20 | 0 |
| nba-game-final | desktop-1920 | 2.81 | 2.76 | 2898 | 2862 | 20/20 | 20/20 | 0 |
| nba-game-final | laptop-1536 | 3.52 | 3.41 | 2898 | 2826 | 20/20 | 20/20 | 0 |
| nba-game-final | laptop-1440 | 3.37 | 3.32 | 2898 | 2862 | 20/20 | 20/20 | 0 |
| nba-game-final | laptop-1366 | 3.89 | 3.78 | 2849 | 2777 | 20/20 | 20/20 | 0 |
| nba-game-final | phone-430 | 3.14 | 3.14 | 1506 | 1520 | 20/20 | 20/20 | 0 |
| nba-game-final | phone-390 | 3.36 | 3.35 | 1457 | 1468 | 20/20 | 20/20 | 0 |
| nba-game-final | phone-375 | 4.24 | 4.23 | 1448 | 1458 | 20/20 | 20/20 | 0 |
| nfl-play | desktop-1920 | 1 | 1 | 252 | 217 | 0/0 | 0/0 | 0 |
| nfl-play | laptop-1536 | 1.12 | 1 | 251 | 213 | 0/0 | 0/0 | 0 |
| nfl-play | laptop-1440 | 1.07 | 1 | 251 | 217 | 0/0 | 0/0 | 0 |
| nfl-play | laptop-1366 | 1.26 | 1 | 251 | 213 | 0/0 | 0/0 | 0 |
| nfl-play | phone-430 | 1.17 | 1.04 | 248 | 236 | 0/0 | 0/0 | 0 |
| nfl-play | phone-390 | 1.28 | 1.16 | 243 | 228 | 0/0 | 0/0 | 0 |
| nfl-play | phone-375 | 1.62 | 1.49 | 243 | 228 | 0/0 | 0/0 | 0 |
| nfl-draft-open | desktop-1920 | 1 | 1 | 280 | 215 | 24/24 | 24/24 | 0 |
| nfl-draft-open | laptop-1536 | 1 | 1 | 280 | 205 | 24/24 | 24/24 | 0 |
| nfl-draft-open | laptop-1440 | 1 | 1 | 280 | 214 | 24/24 | 24/24 | 0 |
| nfl-draft-open | laptop-1366 | 1.07 | 1 | 280 | 205 | 24/24 | 24/24 | 0 |
| nfl-draft-open | phone-430 | 1 | 1 | 240 | 230 | 24/24 | 24/24 | 0 |
| nfl-draft-open | phone-390 | 1.02 | 1 | 236 | 217 | 24/24 | 24/24 | 0 |
| nfl-draft-open | phone-375 | 1.29 | 1.15 | 236 | 217 | 16/24 | 22/24 | 0 |
| nfl-draft-mid | desktop-1920 | 1 | 1 | 282 | 215 | 24/24 | 24/24 | 0 |
| nfl-draft-mid | laptop-1536 | 1.17 | 1 | 282 | 206 | 21/24 | 24/24 | 0 |
| nfl-draft-mid | laptop-1440 | 1.12 | 1 | 282 | 215 | 22/24 | 24/24 | 0 |
| nfl-draft-mid | laptop-1366 | 1.32 | 1.03 | 282 | 206 | 16/24 | 24/24 | 0 |
| nfl-draft-mid | phone-430 | 1.06 | 1 | 240 | 230 | 24/24 | 24/24 | 0 |
| nfl-draft-mid | phone-390 | 1.16 | 1.05 | 236 | 217 | 20/24 | 24/24 | 0 |
| nfl-draft-mid | phone-375 | 1.46 | 1.33 | 236 | 217 | 10/24 | 15/24 | 0 |
| nfl-gameplan | desktop-1920 | 1.38 | 1.12 | 712 | 575 | 14/24 | 20/24 | 0 |
| nfl-gameplan | laptop-1536 | 1.72 | 1.38 | 712 | 559 | 6/24 | 14/24 | 0 |
| nfl-gameplan | laptop-1440 | 1.65 | 1.34 | 712 | 575 | 8/24 | 14/24 | 0 |
| nfl-gameplan | laptop-1366 | 1.93 | 1.55 | 712 | 559 | 2/24 | 10/24 | 0 |
| nfl-gameplan | phone-430 | 1.99 | 1.86 | 663 | 621 | 0/24 | 0/24 | 0 |
| nfl-gameplan | phone-390 | 2.16 | 1.98 | 668 | 591 | 0/24 | 0/24 | 0 |
| nfl-gameplan | phone-375 | 2.94 | 2.63 | 754 | 624 | 0/24 | 0/24 | 0 |
| nfl-game-live | desktop-1920 | 2.34 | 2.27 | 89 | 61 | 24/24 | 24/24 | 0 |
| nfl-game-live | laptop-1536 | 2.92 | 2.83 | 89 | 57 | 24/24 | 24/24 | 0 |
| nfl-game-live | laptop-1440 | 2.8 | 2.72 | 89 | 61 | 24/24 | 24/24 | 0 |
| nfl-game-live | laptop-1366 | 3.29 | 3.18 | 89 | 57 | 24/24 | 24/24 | 0 |
| nfl-game-live | phone-430 | 2.68 | 2.69 | 78 | 72 | 24/24 | 24/24 | 0 |
| nfl-game-live | phone-390 | 2.85 | 2.86 | 77 | 67 | 24/24 | 24/24 | 0 |
| nfl-game-live | phone-375 | 3.6 | 3.62 | 77 | 67 | 24/24 | 24/24 | 0 |
| nfl-game-final | desktop-1920 | 2.77 | 2.7 | 2850 | 2793 | 24/24 | 24/24 | 0 |
| nfl-game-final | laptop-1536 | 3.46 | 3.37 | 2850 | 2789 | 24/24 | 24/24 | 0 |
| nfl-game-final | laptop-1440 | 3.32 | 3.24 | 2850 | 2793 | 24/24 | 24/24 | 0 |
| nfl-game-final | laptop-1366 | 3.89 | 3.79 | 2850 | 2789 | 24/24 | 24/24 | 0 |
| nfl-game-final | phone-430 | 3.26 | 3.27 | 1061 | 1048 | 24/24 | 24/24 | 0 |
| nfl-game-final | phone-390 | 3.47 | 3.49 | 1037 | 1020 | 24/24 | 24/24 | 0 |
| nfl-game-final | phone-375 | 4.39 | 4.41 | 1036 | 1019 | 24/24 | 24/24 | 0 |
