# Basketball's live presentation

The court, what feeds it, and the line between what the engine decided and what
this draws.

## The split

`js/sports/nba/engine.js` does not simulate possessions. It produces per-player,
per-quarter **stat lines** — points, rebounds, assists, steals, blocks,
turnovers — through matchups, tactics and variance. There is no shot in there to
draw and there is no clock.

So nothing here asks the engine for events it does not have, and nothing here
runs a second simulation to get them. `js/sports/nba/playback.js` **decomposes**
what the engine already decided:

| | source | guarantee |
| --- | --- | --- |
| points, rebounds, assists, steals, blocks, turnovers | the engine | reproduced exactly, per player per quarter |
| how points split into twos, threes and free throws | `shooting.js`, from the player's real shot profile | Shaquille O'Neal cannot attempt a three, in any game, ever |
| the order events fall in within a quarter | this module | seeded, so both players in an online game see the same one |
| where on the floor a shot was taken | this module | never contradicts the shot — see below |
| the clock | this module | derived, monotonic, honest about it |

`scripts/verify-nba-shot-ledger.mjs` fails on a single point of drift between
the ledger and the engine.

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

## The post-game chart

The same court, the same `shotToCourt`, the same marker builder — so a three you
watched drop in the third quarter is exactly where you watched it drop. Filters
to Both / your team / the opponent, and filtering never moves anything: a team's
shots are on that team's half whether the other half is drawn or not, so the
three views are one picture with one end blanked. A per-player filter is a
change to that one predicate; every marker already carries a `<title>` with the
play it was, which is also what a screen reader reads off the chart.

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

## Verifying

```
npm run verify:nba-shot-ledger    # the ledger against the engine, 120 games
npm run verify:nba-court-geometry # the shape of the court, no browser needed
npm run verify:nba-court          # the court in Chromium, one real game
npm run verify:live-scroll       # both sports, five viewports
```
