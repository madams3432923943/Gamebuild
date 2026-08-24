# The matchup intro

The nine-second beat between matchmaking finding an opponent and the online
draft starting (`playMatchupIntro` in `js/main.js`, `#screen-matchup-intro` in
`index.html`).

## Purpose

It is the only screen in the game that shows a player somebody else's identity.
It used to show almost none of it: a strip of banner artwork with a username
and a tier caption under it. Two players flying the same banner looked
identical, and everything either of them had earned — their icon, the badges
they chose to feature, their record, rank and rating — was on a card the other
player never saw.

Each side is now that player's **whole card**: the same one they see at the top
of their own home screen, banner artwork and all.

## Architecture

One card, one renderer, two places it appears.

| | |
| --- | --- |
| `createPlayerBannerCard()` (`js/ui.js`) | Builds the card's DOM, matching `#player-banner` in `index.html` class for class. |
| `renderPlayerBannerCard(refs, profile, rankInfo)` (`js/ui.js`) | Paints one card: banner background, icon, name, join plate, featured badges, rep/rank/rating. |
| `renderMatchupSide(refs, { profile, rankInfo })` (`js/ui.js`) | Mounts a built card into one side of the intro. |

The home screen passes the static markup's refs; the intro passes a built
card's. Neither knows which it is. The rank on both is the **sport-neutral**
one (`loadOverallRankInfo`), so a player's rank reads the same here as it does
on their own screen.

`scripts/verify-matchup-intro.mjs` compares the built card's parts against
`index.html`'s own `#player-banner` markup, so the two cannot drift apart
without the build failing.

## Data

The intro renders another player's profile, so `getOpponentSummary`
(`js/online.js`) reads `PUBLIC_CARD_COLUMNS` (`js/profile.js`) and hands back a
row normalized into the same shape as your own profile — which is the only
reason one renderer can draw both sides.

That column list is what the app **shows** about somebody else: equipped
cosmetics, the online record and rank, and the counters the three featured
badges are scored against. It is not a security boundary; profiles are
row-readable and the server decides that, not this list. Nothing else on the
row travels with it — match history, era records, MVP tallies and the offline
stats the Profile screen keeps to itself all stay behind.

## Layout

The two cards are **stacked** with VS between them, at every width. A card is a
wide thing; two side by side are two narrow columns where the stats wrap and
the badges drop. `.player-banner.matchup-card` (in `css/style.css`) is the same
card at intro scale — every selector carries `.player-banner` as well, because
the rules it overrides sit further down the file and would otherwise win on
source order.

A phone held sideways is the tight case: 360px of height for two cards, a VS
and a countdown. The `max-height: 560px and (orientation: landscape)` block
steps everything down together rather than dropping any part of the card — the
intro is a timed animation, so anything below the fold is simply missed.

## Known limitations

- The opponent's featured-badge tiers are computed on the client from their
  counters, exactly as your own are. A profile row that has not been migrated
  for a newer badge shows that badge untiered rather than failing.
- `preloadBannerArt` still caps its wait at 1.2s. On a slow connection a card
  can fly in on its two colours and pick its artwork up a beat later — the same
  trade as before, and deliberate: the intro must not stall on a decoration.
- Cards are rebuilt per intro rather than reused. That is one render of two
  cards per match, and the alternative is a second, quieter copy of the
  renderer to reset a held card for the next opponent.
