# Football's game screen

Basketball's counterpart is `docs/nba-presentation.md`. This covers the parts of
a football game a viewer actually watches: the field, the play feed while the
game runs, and what the feed becomes when it stops.

## The play feed has two jobs, and they are not the same job

**While the game runs** the feed is a broadcast. `buildTimeline`
(`js/sports/nfl/playback.js`) turns the engine's drives into events, and
`js/main.js` puts the ones worth reading on screen as they happen: scores,
takeaways, and a one-line epitaph for every drive — including the ones that did
not score, because a twelve-play march that stalled on the 4 used to look
exactly like a three-and-out.

`pushPlayHeadline` keeps **four cards**. That is right for something being
watched: the newest line is the one that matters, and the fixed-height window it
lives in is load-bearing for the mobile scroll fix (see
`docs/nba-presentation.md` — a feed that grows and shrinks moves the page under
a reader).

**When the game ends** those same four cards are the problem. What a player is
left looking at is whichever four moments happened to be last, which for a 25–23
game is usually three punts and a lead change. Nothing on the screen answers
"how did it end up 25–23".

So at the whistle the feed is **replaced by a scoring summary**: every score, in
order, with the man, the play and the clock. The window keeps its fixed height —
a longer summary scrolls inside it, the same way the feed's older cards always
did, rather than growing the page under a reader.

```
madams wins it late, 25-23.
Q1 11:51   MADAMS: Kai Forbath 51 yd field goal        3-0
Q1 2:28    MADAMS: Bubba Franks 5 yd receiving TD      13-0
Q2 10:58   BOT: Mike Nugent 50 yd field goal           13-3
...
```

## How it is put together

| piece | where | what it does |
| --- | --- | --- |
| `scoringPlay` on the scoring event | `js/sports/nfl/playback.js` (`buildTimeline`) | the score as FACTS — scorer, kind, yards, points, conversion |
| `scoringSummary(events, labels)` | `js/sports/nfl/playback.js` | rows of `{ when, team, text, score }`, oldest first |
| `presentation.scoringSummary` | `js/sports/nfl/index.js` | how shared code reaches it |
| `renderScoringSummary` | `js/ui/game.js` | replaces the feed; knows nothing about football |
| the call | `finish()` in `js/main.js` | summary when the sport has one, the old headline push when it does not |

Three things about that split are deliberate.

**The rows are facts, not a sentence.** The event already carries `text` — the
line the live feed shows — and the summary needs the same score spelled
differently ("8 yd rushing TD" beside a clock). Recovering the man, the yards
and the kind by parsing English back out of `text` would make a display string
the source of truth for something the drive already knew.

**It is built from the timeline, not from the drives.** The clock is a
presentation fact: `buildTimeline` derives it, the engine models drives and has
no running clock. Reading `drives` here would mean inventing a second one.

**The renderer's vocabulary is sport-neutral.** `{ when, team, text, score }` is
what a basketball scoring summary would need too, so the shared UI stays shared.
A sport that declares no `scoringSummary` keeps exactly the feed it always had —
which is what basketball does — and `scripts/verify-sport-contract.mjs` requires
the hook of any sport declaring the `field` stage, so football cannot lose it
quietly.

## Known limitation: the field goal with no spot to kick from

A kick's length is the spot plus ten yards of end zone plus seven back to the
holder, so a snap from the 62 is a 55-yard attempt. That needs the spot to be a
real yard line — and on about a quarter of kicking drives the engine's reach
model puts the offense **at or past the goal line** and it kicks anyway. There
is no yard line to measure from there.

Those rows say `field goal` and quote no distance. Printing the floor instead
would put a 17-yarder in a summary a reader takes literally, roughly one kick in
four. Fixing the reach model itself is an engine change — vendored to the Edge
Function and calibrated against — and it is not a presentation problem.

## Verifying

```
npm run verify:nfl-playback       # 120 games: one row per score, the running
                                  # score row by row, no invented kick lengths
npm run verify:nfl-live-playback  # real Chromium: the feed narrates the game
                                  # while it runs, and is a scoring summary after
```
