# Basketball's live presentation

The court, what feeds it, and the line between what the engine decided and what
this draws.

## The split

`js/sports/nba/engine.js` does not simulate possessions. It produces per-player,
per-quarter **stat lines** through matchups, tactics and variance, and there is
no clock in it.

It does, since the 2026-09 cleanup, produce the **shooting split and the event
ledger** as part of that result — `attachShooting()` and
`js/sports/nba/ledger.js`, both vendored into the Edge Function. That is a
change of ownership, not of technique: the same decomposition, moved out of the
browser and into the simulation, because a decomposition that runs on the client
runs *twice* for an online match and the two answers differed. See "One
derivation of the shooting split" below.

| | source | guarantee |
| --- | --- | --- |
| points, rebounds, assists, steals, blocks, turnovers | the engine | the result, unaltered |
| FG / 3PT / FT, per player per quarter | the engine, via `shooting.js` | attempts come from the player's real 3PA rate and minutes; Shaquille O'Neal cannot attempt a three, in any game, ever |
| the order events fall in within a quarter | the engine, via `ledger.js` | drawn from the simulation's own seeded stream, so an online game has one ledger rather than one per client |
| where on the floor a shot was taken | `ledger.js` | never contradicts the shot — see below |
| the clock | `annotateLedger` | derived, monotonic, honest about it |
| how long each event is on screen | `playback.js` | presentation only; changing it cannot change a number |

`scripts/verify-nba-shot-ledger.mjs` fails on a single point of drift between
the ledger and the engine; `scripts/verify-nba-online-sync.mjs` fails if two
clients reading one stored result disagree about any of it.

## The event

```js
{
  type: "shot" | "rebound" | "steal" | "block" | "turnover",
  side: "a" | "b",
  slot, player,
  period, overtime, order, periodFraction, clockSeconds,

  // shots only
  made, points, shotType: "two" | "three" | "free-throw",
  zone, x, y, strong, assistedBy,

  // read off the running score, so they cannot disagree with the scoreboard
  scoreAfter: { a, b }, leadChange, endOfPeriod, runPoints, runSide,
}
```

Rebounds were the one counting stat the engine records that the ledger used to
drop, so a possession feed could report a steal and a block and never say who
cleaned the glass — which is most of what happens between shots.

## Where a shot goes

Polar from the basket: a distance band and an angle. Each zone's radius band is
the real distance that zone is — rim finishes inside four feet, the arc at
23.75, the corner three at 22 because the corner three genuinely *is* the shorter
shot.

The zone decides the points **before** the position is rolled, so there is no
position a zone can produce that contradicts it. Not a rule applied afterward:
no dunk from thirty feet and no corner three at the rim, structurally.

The coordinate system is feet divided by 50 on **both** axes — x runs 0..1
across a 50ft half-court, y runs 0..0.94 out from the baseline it is attacking —
so a distance measured across it is a real distance and the arc is a circle.

The ledger is **half-court and basket-relative**, and knows nothing about which
end of the floor anybody is shooting at. That is the court's job (below), and it
is what lets the same coordinate be your corner three at one end and the
opponent's at the other.

The first attempt at this was rectangles on a square whose axes were normalised
by different lengths, which put mid-range twos 0.35 from the rim: outside the
arc. The ledger test caught it on 2,289 shots of a 120-game sample. It measures
the real geometry now, written out independently of the placement it checks — a
test that imports the placement only proves it agrees with itself.

The corner three is the zone that keeps catching this out, because it is the one
three that is *closer* to the rim than the arc. What it has to clear is a
straight line 22 feet from the middle of the floor, so what matters is its
**sideways** distance — `r · sin(angle)` — not its radius: a 22-foot shot at 72
degrees is 20.9 feet across, which is a corner three drawn inside the corner
three line. The band is `r 0.452–0.485` over `78–89°` for that reason, and the
ledger test's corner boundary is the real 22 feet rather than the 20 it read
while that was slipping through.

## The court

**A full court, horizontal, 94 by 50 feet on a `0 0 188 100` viewBox** — two
units to the foot, so every constant in `js/sports/nba/court-geometry.js` is the
real measurement. Team identity is **which half a marker is on**: side A attacks
the left basket and side B the right, fixed for the whole game, never mirrored
per possession.

One half is drawn, once, into `<defs>`; the other end is that same group
`<use>`d with `translate(188 0) scale(-1 1)`. There is no second copy of the
geometry to keep in step, which is why correcting the three-point line was a
one-line change rather than two.

### The malformed three-point line

The previous court's arc was drawn with **the wrong SVG sweep flag**. An arc
command names its endpoints, a radius and two flags — not a centre — and the
flags choose between four curves that all connect those endpoints. `0 0 0` chose
the one that curves around a centre 36 units from the basket and bows *toward*
the baseline. The corner segments still met it at exactly the right two points,
so the line was joined, symmetric, and wrong. The restricted-area arc had the
same flag and the same problem.

Nothing measured it. The browser test checked that markers land where their
shots say, which a malformed line does not affect, and the ledger test checked
the ledger, which was correct.

`scripts/verify-nba-court-geometry.mjs` now solves each arc's real centre out of
its endpoints and flags the way a renderer does, and asserts the curve is 23.75
feet from the rim at every sampled point along it. Flipping the flag back fails
it by 17.8 feet.

### Placing a shot

`shotToCourt` is the only conversion, and both charts call it:

```
across = x · 100                      // sideline to sideline
out    = y · 100                      // from the baseline being attacked
side a → ( out,       across )        // attacking the left basket
side b → ( 188 - out, across )        // the same shot, mirrored
```

So an identical ledger coordinate is the same shot at either end, and the two
teams can never occupy the same pixel.

## The clock

The engine has no clock, so this is the period's real length (12 minutes, 5 in
overtime) laid over the period's own event order. It counts down, it restarts
each period, and its quarter boundaries are where the ledger says they are.

It is **not** a claim that a shot went up at 4:12, and nothing downstream treats
it as one. It reaches the scoreboard's centre cell through
`presentation.liveStatusLabel`, the same hook football's play clock uses.

## What is deliberately absent

**Dunks and and-ones.** The engine models neither a dunk nor a foul. A rim
finish is a real *zone* — the shot went in from close — and gets the loudest
visual treatment there is on that basis, captioned as what it actually is. A
banner reading DUNK would be a fabricated statistic with a font.

**Offensive versus defensive rebounds.** The engine records a rebound total and
nothing about which end of the floor. The feed says "Rebound".

**A real buzzer-beater.** `endOfPeriod` marks the last event of a quarter, which
is true and is what earns that shot its longer beat. It is not a claim that the
shot went up at 0:00.

## The screen

```
SCOREBOARD    names · score · quarter · clock          (shared, every sport)
STATUS        possession chip · run chip
COURT         markers, +N pops, big-play banner, quarter card   (overlays)
STRIP         FG% · 3P% · REB · AST · TO, per side
FEED          recent plays, newest first                (shared, every sport)
```

Everything on the court comes from the ledger. The live strip is folded from the
start of the game **up to the event on screen** — not summed from the engine's
quarter lines, which are only true once a quarter is over and would show a
shooting percentage for shots that have not been taken yet.

### Nothing here may change the page's height while a game is playing

The court has a fixed aspect ratio (188:100) and its width is capped by the
viewport's height as well as its width, so a landscape phone shrinks the court
rather than pushing the scoreboard off the top. It stays horizontal at every
width: a court that turns vertical on a phone is a different picture, and its
halves stop meaning "your end" and "theirs". The big-play
banner and the quarter card are absolutely-positioned overlays. The stat strip
has a stable row count. The play feed is a fixed-height window.

A page that gets shorter drags a reader at the bottom of it upward — see
[the scroll note below](#the-mobile-scroll-bug).

### The fade is CSS, not a timer

A marker's entrance ends on the faint accumulated state, which is what turns the
last few seconds into "what just happened" and everything older into the shot
chart building underneath. Two hundred `setTimeout`s a game would each need
cancelling when a viewer leaves mid-quarter; an animation cannot outlive its
element.

### Made and missed

**Green circle in, red cross out** — the only thing a marker's colour says.
Which team took it is which half it is on, so the two questions never share a
channel and no marker has to be read twice.

Shape carries it as well as colour: a chart whose only distinction is hue is one
that roughly eight percent of men cannot read, and this one is small and dense
by design.

### Clutter at the rim

Four things, none of which moves a shot far enough to make its position a lie:

1. Markers **shrink as the chart fills** — 2 units down to 0.72 of that over
   220 attempts, because a quiet first quarter and a 200-shot final chart are
   the same picture at two densities and one size cannot serve both.
2. Newest on **top**: markers are appended, so the fresh one is the readable one
   and the pile beneath it is the chart it is becoming.
3. **Deterministic jitter inside the zone**, which the polar placement already
   provides — twenty shots from the same zone are a fan, not a stack.
4. Settled markers hold at **0.58–0.78 opacity**, not 0.2. The emphasis on the
   newest shot is the first third of a second of its entrance, not the erasure
   of everything before it.

### The newest shot

A make gets an expanding ring and a `+2`/`+3`, both in the flash layer as their
own elements so the disc underneath keeps its place in the chart. A miss draws
its cross and settles. Under a second, then it is one more marker.

### The live percentages

`FG% · 3P% · REB · AST · TO` per side, under that side's half. Folded forward
from the ledger by `foldLiveStats` — **the simulation's numbers**, never counted
off the markers on screen. A percentage derived from what happens to be drawn
would drift from the box score the moment one of them differed.

## One derivation of the shooting split

This has been fixed twice, and the second fix is the one that mattered.

**First**, the box score and the chart were two derivations of one fact: an
unseeded `shotLine()` over each player's whole-game total, against a seeded one
rolled per quarter for the ledger. Over 40 games the box score's team
three-point makes differed from the threes drawn on the chart in **37 of them**.
Folding both from one event list fixed that.

**Second — and this is the online desync players actually reported** — folding
them from one event list was not enough, because *the event list itself was
built on the client*. An online match is simulated once on the server, but the
server stored only points, rebounds, assists, steals, blocks and turnovers.
Every shooting number and every marker on the chart was rebuilt on each machine:

- **in that machine's own frame.** The rebuild ran over `rosterA`/`rosterB` in
  the "A = me" frame, which is a different frame on each client. One fed its own
  roster into the first draws of the stream and the opponent's into the second;
  the other did the reverse. Same seed, opposite order, different box score.
- **off a seed that was never the server's.** It fell back to a function of the
  final score whenever the simulation seed had not reached the client — and it
  never had, because `normalizeServerResult` did not copy it.

So two players saw one final score and two different box scores. Neither client
was wrong; there were simply two derivations of a fact that must have one.

The fix is structural. `shooting.js` and `ledger.js` moved into the engine's
directory and into `tools/vendor-engines.mjs`, so the Edge Function runs exactly
the code the browser does. `simulateGame()` returns `shotEvents` alongside the
box score, the Edge Function packs them into `match_results.game_data.shotEvents`
(about 16KB a match), and both clients unpack, remap the sides and render. There
is **no gameplay randomness left on the client at all** — `verify-nba-online-sync`
runs the whole read-hydrate-fold-and-time path with `Math.random` replaced by a
function that throws.

`foldPlayerShotLines(events)` still exists and still agrees, because the ledger
is an expansion of the box score's own shooting columns. It is what the LIVE
table uses mid-game, when the final columns describe a game that has not
finished yet.

`scripts/verify-nba-court.mjs` counts the green circles on a filtered chart
against that team's FG line in the box score — a made field goal is a circle,
every attempt is a marker, and free throws are neither drawn nor field goals.

### Unplaced scoring

A player with no shooting profile still scores, and those points enter the ledger
as an event with no position rather than being dropped. It is marked `unplaced`,
because it is **not a free throw** — it can be worth two or three — so anything
folding the ledger into a shooting line leaves it out, and the feed calls it
"Scored" rather than crediting a three-point free throw. The shipped dataset
gives every row a shooting profile, so this branch does not fire today.

## The post-game chart

The same court, the same `shotToCourt`, the same marker builder — so a three you
watched drop in the third quarter is exactly where you watched it drop. Filters
to Both / your team / the opponent, and filtering never moves anything: a team's
shots are on that team's half whether the other half is drawn or not, so the
three views are one picture with one end blanked. A per-player filter is a
change to that one predicate; every marker already carries a `<title>` with the
play it was, which is also what a screen reader reads off the chart.

**And it is the only court on the screen by then.** The live floor is the stage
a game is watched on; at the whistle it comes down and the same picture appears
below the recap, where a reader arrives at it after being told why the game went
that way. Both were up for a while, which showed the identical court twice with
the box score between them. The floor is only taken down when the chart actually
replaced it — a sport that draws no chart, or a game with no placed shots, keeps
the court it played on rather than being left with nothing.

It is post-game only, which is not a restriction that needed adding — it runs
from `finish()`. A ranked draft's hidden information is hidden during the
*draft*, and the draft is over by the time anyone is looking at this.

## The mobile scroll bug

Scrolling down to read the box score during a simulation used to pull you back
up toward the scoreboard. There is no `scrollIntoView`, no `window.scrollTo` and
no `focus()` anywhere in the app, which is why reading for one found nothing.

Measured in Chromium at 360px: **every upward jump in the scroll position lined
up one-for-one with a reduction in document height.** Three shrinks, three jumps,
45px, in one basketball game. The play feed was a plain flex column holding up to
four cards of one or two lines each, so the page's height was the sum of whatever
headlines the game had most recently produced, and a reader at the bottom of the
page is pinned to its maximum scroll.

Two fixes:

1. **The feed is a fixed-height window.** Same space with one card as with four;
   older cards scroll inside it. `overflow-anchor: none`, because a card
   entering at the top is exactly what the browser would otherwise anchor to.
2. **The scoreboard is built once per shape and patched after.**
   `renderScoreboard` opened with `innerHTML = ""` and `tickScoreTo` calls it
   every 60ms for the first 1.5s of every quarter. Measured after: 5 rebuilds a
   game against 11 scoreboard states.

There is exactly one deliberate scroll in a game and it happens before the game
starts: screens are siblings that hide and show, so the game screen inherited
the draft board's scroll position and a viewer arrived 389px down a screen they
had never seen.

`scripts/verify-live-scroll.mjs` drives a real game in both sports at 360, 390,
430, tablet and desktop, sits the viewer at the bottom of the page, and asserts
their position never travels up and the document never gets shorter. It samples
**inside the page** at 25ms: the first version polled from Node at 120ms and
passed against the un-fixed app, because the shrinks are three discrete events
in a seventeen-second game.

It reports **which element shrank**, which is how three more were found during
the 2026-09 cleanup — none of them findable by reading the CSS, all three
obvious the moment the failure named the box:

- a play-feed card falling off the bottom while a shorter one arrived at the top
  (the feed's height floor only rises now, and resets with the feed);
- the field's status strip wrapping onto a second line when a username was long
  (it does not wrap, and an over-long username ellipsises instead of the down
  and distance);
- an **empty** possession chip collapsing to its padding on a kickoff (its height
  is reserved rather than conditional).

The playback speed controls sit inside the stage for the same reason, and are
hidden with `visibility` rather than `display` — a control row that vanished at
the final buzzer would take 54px out from under a reader.

## Playback pacing

A quarter used to be revealed inside `QUARTER_REVEAL_DELAY_MS` — 4.2 seconds, of
which the between-quarters card took 1.6. About ninety events shared the
remaining 2.6, so an ordinary shot was on screen for roughly **25 milliseconds**
and a whole game finished in seventeen seconds.

`buildPlaybackTimeline()` replaces that with football's shape in basketball's
units: every event gets a duration in proportion to how much there is to take
in (`EVENT_MS`, plus `EMPHASIS_MS` for a run, a lead change or the last event of
a quarter), and the whole game is scaled to land near **195 seconds**. Measured
over 60 games: 202–206s total whatever the event count, a median event of 590ms,
an ordinary missed field goal at ~600ms, a made three at ~1.1s, and a
lead-changing three that ends a quarter at 2.9s. The period reveal now *waits*
for its events rather than squeezing them into a fixed hold.

Everything is scheduled on one **virtual clock** (`createPlaybackClock` in
`js/main.js`), which is what makes 1x / 2x / Skip possible: changing the rate
re-times what has not happened yet, and Skip runs the remaining queue in order —
so a skipped game still *finishes*, and is recorded, rather than being
abandoned. Speed is a presentation input and reaches nothing else; the result,
the box score, the chart and the MVP are all decided before the first timer
starts.

## Verifying

```
npm run verify:nba-shot-ledger    # the ledger against the engine, 120 games
npm run verify:nba-shooting       # 3PA by roster and era, FT realism, Monte Carlo
npm run verify:nba-online-sync    # two clients, one stored result, field for field
npm run verify:nba-playback-pace  # event timing, 2x, and that speed changes nothing else
npm run verify:nba-court-geometry # the shape of the court, no browser needed
npm run verify:nba-court          # the court in Chromium, one real game
npm run verify:live-scroll        # both sports, five viewports
```
