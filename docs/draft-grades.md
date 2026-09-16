# Draft grades

What the letter on the card means, in both sports, and where its numbers come
from.

## Purpose

A box score tells a player that they lost. A grade tells them the roster was
always going to lose, and why — before a minute is simulated, while the lesson
still attaches to a decision they made. That is the whole argument for handing
out a letter at all, and it is why a grade that is generous is worse than no
grade: "A+" over a roster with a hole at point guard teaches the habit it exists
to argue with.

## One philosophy, two sports

Basketball and football read completely different things about a roster — a
capability profile against a nine-unit scouting report — but the shape of the
verdict is the same in both, deliberately. A B+ has to be a B+ in both games or
the grade is a per-sport decoration rather than a judgement.

**Talent sets the level; construction takes away from it.**

```
score = talent × (1 − penalty)
```

Not a weighted sum of talent and construction terms. Summed, a roster that is
uniformly poor collects full marks for balance and for having no spread, so
being evenly bad outscores having an identity — football shipped exactly that
and the Easy bot outscored the Medium one. A multiplier also cannot annihilate:
a poor roster that is at least coherent still outscores a poor roster full of
holes, which is the comparison the bottom of the scale exists for.

**The letter comes from breakpoints solved against real drafts.** Both sports
have a calibration tool (`tools/calibrate-nba-gradecurve.mjs`,
`tools/calibrate-nfl-gradecurve.mjs`) that drafts several hundred bot rosters
across the full skill range and reports where the cut points fall. Re-run the
relevant one after any change to the weights, the spans, the ratings or the
dataset; paste the block it prints into that sport's `constants.js`.

Both tools aim at the same percentile targets, and they are a product decision
rather than a measurement: A+ is the top 3% of real drafts, A and A− ask for
construction rather than names, most competent drafts land in the broad C-to-B
band, and a badly built roster can genuinely draw a D or an F.

**Nothing quotas a letter at runtime.** The targets set the cut points once,
against a measured population. What a player then sees emerges from how well
they actually drafted: draft ten exceptional rosters in a row and you get ten
A+s.

### Why not a percentile curve

Both sports tried one and both had to abandon it. `js/gradecurve.js` sampled 240
rosters by drawing uniformly from every eligible player in the dataset and took
percentiles against that. A draft does not produce uniform rosters — it produces
good ones, because a drafter picks the best name a rolled squad offers and so
does the bot — so a real roster sat in the top few percent of that distribution
almost by construction and collected an A or an A+ for it.

The module is gone. Its last caller was basketball, and with it went the
240-roster curve build that ran lazily on the first graded roster, which is to
say as a frozen screen at the exact moment a draft ends.

## Basketball

`js/sports/nba/draftgrade.js`. Nine capabilities, each a per-player quantity the
dataset carries, averaged over the roster with starters weighted about twice a
reserve:

| capability | read from | what it answers |
| --- | --- | --- |
| Score | `ppg` | can this team put the ball in the basket |
| Eff | true shooting | at what cost |
| Space | `tpa × tpp` | does anyone stretch a defense |
| Pass | `apg` | does the ball move |
| Care | `apg / tov` | what does it give up for what it produces |
| Reb | `rpg` | who owns the glass |
| Rim | `bpg` | is the basket protected |
| Ball D | `spg` | can it pressure the ball |
| Create | best two at `ppg + 1.5 × apg` | is there someone to go to |

Each is a **ratio against what a drafted-calibre player averages** — the
dataset's top quartile by impact — and not against the dataset's mean. The mean
includes every deep reserve who ever appeared in eleven games, and a drafted
roster clears it on every category by construction: measured over 60 bot drafts,
even an Easy bot's roster came out at 0.8–1.0× the mean and a Hard bot's at
1.2–1.9×, so the scale saturated and good drafts could not be told from great
ones. Against the drafted-calibre reference the same rosters spread 0.42–1.26.

A capability the dataset cannot supply a baseline for is **omitted**, not scored
0.5. The grade this replaced carried a `versatility` term that was 0 for
essentially every roster ever drafted, because the dataset lists one position per
player — a seventh of the score was a constant nobody could see.

Construction charges four faults, weighted in `GRADE_WEIGHTS`:

- **hole** — a capability the roster does not have, measured at both depth (the
  worst one) and breadth (the mean shortfall), because one hole and four are not
  the same roster
- **coverage** — a starting position with nobody behind it; those starters play
  all 48 and `fatigueFactor()` charges them for it
- **topHeavy** — how much of the roster's impact its two best players carry, as a
  multiple of an even split so that roster shape (5, 6 or 10 slots) does not
  change what the number means
- **spread** — a chasm between what the roster does best and what it does worst

### The card says nothing about the lineup

The grade is shown on the screen where a player sets their rotation, and it used
to end with "Start Irving over Malone at PF". That was wrong twice. A drafted
roster's positions are not a decision the rotation screen can revisit — it
assigns minutes, so the sentence named a control that does not exist on it — and
more fundamentally, a post-draft analysis exists to say what the choices already
made ADD UP TO, not to re-make them.

So `NBA.rotationHint()` returns null (football answers the same way for the same
reason), and what the sentence was reaching for is on the card as a reading of
the roster that was actually built: the bench's own rating beside the starters'
on the same ruler, and the capability grid saying what the lineup can and cannot
do. The headline scales with the letter, and the calibration tool fails loudly if
an A or an A+ is ever printed over a capability the roster does not have.

## Football

`js/sports/nfl/draftgrade.js`. Same score shape, read off the nine real football
units `scoutingGroups()` already scores, plus a slot-level shortfall weighted by
positional importance — a weak quarterback is 0.40 of an offense and a weak third
receiver is 0.07 of it, so they are not the same mistake.

The two halves of the roster are reported as numbers out of 100 rather than as
letters. Drafted offenses and drafted defenses sit in different places relative
to what was available (a rolled squad offers about ten candidates at a defensive
slot against fifty at receiver), so a per-half curve graded 68% of every defense
ever drafted as A+ while the same rosters' offenses spread from D+ to A. The
comment above `sideOutOf100` has the measurements.

## Known limitations

- **Quick Play grades a little higher than Ranked.** Six picks with no bench has
  no depth decision to make and therefore fewer ways to go wrong; measured over
  200 drafts each, Quick Play produced A+ about 5% of the time against Ranked's
  1%. Both spread across the full scale.
- **Spacing is graded but barely simulated.** The engine models true shooting;
  three-point volume reaches the game through the shot ledger and the court
  rather than as a team factor. A roster can be marked down for no spacing more
  than the simulation will charge it.
- **Era interacts with spacing.** A roster of 1960s and 1970s squads cannot score
  well on `Space`, because those players did not take threes. It is a real
  weakness of that roster in this game's terms rather than a drafting mistake,
  and the grade does not currently distinguish the two.
