# Attacking the NFL version

> **Historical. This plan is done and shipped.** NFL has been `live: true` since
> the engine landed; football has its own drive simulation, unit ratings,
> playback, field, recap and draft grade, and it is playable online and ranked.
> Kept as the record of how the second sport was reasoned about, because that
> reasoning is what a third sport should follow.
>
> Two things below did NOT happen as written, and the code is the authority on
> both:
>
> - **Era brackets are plain decades, not rule-change eras.** nflverse data
>   starts in 1999, so the pre-2000 brackets would have been empty shelves. See
>   the comment in `js/sports/nfl/index.js`.
> - **Gamestyles were hand-solved, not calibrated.** Step 3's calibrator was
>   written later than the rest; `js/sports/nfl/tactics.js` says where that
>   stands.

## Context

`js/sports/nfl.js` already declares the sport, `db/migrations/20260731_04_nfl_players.sql`
already creates `nfl_players`, and the sport registry already routes screens
through whichever sport is active. `live: false` is the only thing keeping NFL
out of play. This is the plan for everything between here and flipping it.

The headline decision — **draft defensive position groups as units, offensive
skill positions individually** — turns out to be the load-bearing one. It is
not just a drafting convention; it decides the shape of the simulation, makes
the data importable, and gives the recap something honest to say. The rest of
this document falls out of it.

---

## 1. Why unit drafting is the right call

Three independent reasons, which is what makes it worth building around:

**It is the real knowledge test.** Nobody remembers who the 1985 Bears' third
safety was. Everyone remembers the '85 Bears defense. Football memory is
organised by unit on defense and by name on offense — the Steel Curtain, the
Legion of Boom, the Purple People Eaters, but *Montana*, *Rice*, *Payton*.
Drafting the way people remember is the whole premise of the game.

**Individual defensive stats are a trap.** Tackles are a volume stat that
*punishes* good coverage — a shutdown corner nobody throws at records almost
nothing. Sacks concentrate on one edge rusher and say little about the front
seven. Aggregated to a unit, those same numbers become meaningful, because a
defensive line's combined sacks and a secondary's combined interceptions are
genuinely what those units did.

**It matches how football actually resolves.** Basketball is man-on-man, which
is why `js/sports/nba/engine.js` models five defenders guarding five attackers. Football
is unit-on-unit: pass rush against pass protection, secondary against
receivers, front seven against the run. If the draft slots *are* the matchup
terms, the simulation has no translation layer to write.

### Roster shapes

| Mode | Slots | Shape |
| --- | --- | --- |
| Quick Play | 6 | QB, RB, WR, TE, OL, DEF — one pick per phase, teaches the structure |
| Ranked | 11 | QB, RB, WR1, WR2, TE, OL, DL, LB, CB, S, ST |

Ranked is six individual picks (five skill + special teams) against five unit
picks. Eleven rather than the NBA's ten because dropping the kicker to hit a
round number would be a mistake — field goals decide real games, and a game
where kicking never matters is missing a third of its endings. Special teams is
a unit (K + punter + return game) rather than a lone kicker, so the slot is a
real decision instead of "who kicked the most field goals".

`js/sports/nfl.js` currently declares a provisional fantasy-style lineup
(`QB, RB1, RB2, WR1, WR2, TE, FLEX, K, DEF, BENCH1`). That gets replaced — it
was a placeholder from before this decision existed, and it models fantasy
football rather than football.

### Where unit ratings come from

Units are **derived from `nfl_players`, never hand-authored** — the same rule
that makes `data/nba-players.json` generated rather than edited. A unit row for
"1985 Chicago Bears — LB" aggregates every linebacker on that team-era:
snap-weighted rates for the stats that matter to the unit, plus a depth term
(a two-man unit is thinner than a five-man one, which is the football version
of the bench-coverage rule already in `constructionMetrics`).

Build it as a generated `data/nfl-units.json` beside the player file, produced by
the same import run. Deriving it at squad-roll time instead would mean the
client re-aggregating thousands of rows on every round.

---

## 2. Simulation: a drive model, not a possession model

`js/sports/nfl.js` already records why the NBA engine cannot be reused. What
replaces it:

**A game is ~22–24 drives**, alternating possession, with turnovers and
onside kicks changing the alternation. That is the top-level loop — the
equivalent of the NBA engine's four quarters.

**Each drive resolves to an outcome**, not to a sequence of simulated plays.
Given (offensive strength vs defensive strength on the relevant axis, starting
field position, score, time remaining), roll over:

`{ touchdown, field goal attempt, punt, turnover on downs, interception, fumble, end of half }`

Simulating every snap would be forty times the work for a result nobody sees.
The drive is the unit of football narrative — "they went 80 yards in twelve
plays to go ahead" — so it is the right granularity to model *and* the right
granularity for the recap to talk about.

**Field position carries between drives.** A punt from your own 20 hands them
the ball near midfield; a three-and-out after a turnover is how games get away
from teams. This is the mechanism that makes defense matter without needing a
separate "defensive points" fiction, and it is why scores land at 24–17 and
31–28 rather than looking like basketball with smaller numbers.

**Scoring is discrete.** 7s, 3s, the occasional 8 or 2. Nothing about the NBA
engine's continuous point totals, the 1.55 scoring ceiling or the 190-point
clamp transfers.

### The matchup terms

This is where the unit draft pays off. Each drive picks a play type from the
gamestyle's run/pass mix, then resolves it against the matching axis:

| Play type | Offense | Defense |
| --- | --- | --- |
| Pass | QB + WR1/WR2/TE + OL (protection) | DL (rush) + CB + S |
| Run | RB + OL (run block) | DL + LB |
| Field goal | ST | — (distance and ST rating) |

Every term on that table is a draft slot. No mapping layer, and the post-game
analysis can say "your offensive line lost to their pass rush" because that is
literally a term the simulation evaluated.

### Per-player box scores

They fall out of the drive model rather than being simulated directly:
attribute a drive's passing yards to the QB and distribute them across
receivers by target share, rushing yards to the RB, and so on. Same trick
`js/sports/nba/shooting.js` already uses — the sim decides the total, the split model
decides where it came from, and the two always reconcile.

### Fatigue and depth

The NBA engine's minutes model does not transfer (football has no minutes) but
its *purpose* does. The equivalent: unit depth. A thin defensive line wears
down in the fourth quarter, so its rating decays as the opponent's run play
count climbs. That preserves the "depth is a real draft decision" rule that
`FATIGUE_MINUTES` exists to enforce in basketball.

---

## 3. Data

### Source

**nflverse / nflfastR** (`https://github.com/nflverse/nflverse-data`) over
Pro-Football-Reference. It is public, maintained, machine-readable, and ships
season-level player stats *and* play-by-play. PFR would mean five CSV exports
per season (passing, rushing, receiving, defense, kicking) clicked by hand —
the NBA import's one-file-per-season flow does not scale to that.

The play-by-play is the real prize: **it is how the drive model gets
calibrated**. Real drive-outcome frequencies by field position and down are
directly measurable from it, which means the engine can be fitted to reality
rather than guessed and then balanced. Basketball never had that luxury.

### Pipeline

Mirror the NBA flow exactly, since it works:

```
tools/seasons-nfl/          raw downloads, gitignored like tools/seasons/
tools/build-nfl-data.mjs    -> data/nfl-players.json + data/nfl-units.json
tools/verify-nfl-data.mjs   -> sanity checks before anything ships
tools/export-nfl-json.mjs   -> db/seed/nfl-players.json for the server seed
```

`nfl_players` already has the columns (`pass_yds`, `rush_yds`, `receptions`,
`sacks`, `def_interceptions`, `fg_made`…). It needs one addition: a
`snaps` or `games_started` column, because unit aggregation has to be
snap-weighted or a backup's rate stats distort the unit.

### Era brackets

`js/sports/nfl.js` already notes that football eras follow rule changes, not
decades. Concretely:

| Bracket | Years | Why it's a different game |
| --- | --- | --- |
| Leather | 1950–1969 | Pre-merger, two leagues, run-first |
| Smashmouth | 1970–1977 | Post-merger, pre-passing-rules |
| Air It Out | 1978–1993 | 1978 contact and blocking rules open the passing game |
| Cap Era | 1994–2003 | Salary cap and free agency break up dynasties |
| Modern Passing | 2004–2017 | 2004 illegal-contact enforcement |
| Today | 2018– | RPO, analytics, fourth-down aggression |

Six brackets, each its own ranked ladder, exactly as `ERAS` works today. Note
`eraRecordKey()` in `js/sports/index.js` already namespaces non-NBA era records
so an NFL "all" cannot corrupt the NBA one — that groundwork is done.

---

## 4. Strategies

Same governing rule as `js/sports/nba/tactics.js`, which is the file to copy the *shape*
of, not the contents: **a style must be a real choice, not a power gain**, and
its net effect is solved by simulation rather than hand-picked. Fifteen again,
in three families so the three-card offer stays varied:

**Offensive identity** — Air Raid, Ground and Pound, West Coast, Vertical
Shots, Ball Control, Spread/RPO

**Defensive identity** — Cover 2, Cover 3, Press Man, Blitz Heavy,
Bend-Don't-Break, Run Stuff

**Game management** — Fourth-Down Aggression, Clock Killer, Two-Minute
Specialist

Each moves the drive model's levers: run/pass mix, explosive-play rate,
turnover rate, third-down conversion, field-goal range, tempo (drives per
game).

**Counterplay is sharper here than in basketball**, which is worth exploiting.
Air Raid shreds Bend-Don't-Break and dies to Press Man plus a real pass rush.
Ground and Pound beats Blitz Heavy and stalls against a stacked defensive
line. Clock Killer protects a lead and is a disaster from behind. That is a
genuine rock-paper-scissors layer sitting on top of the roster read — closer
to a chess match than the size-vs-spacing axis basketball has.

---

## 5. What already works, and what has to change

### Reuse as-is

The sport registry, matchmaking and match tables (already sport-scoped by
`20260731_01_sport_scope_matchmaking.sql`), profiles, rank ladder, badges,
banners, the draft screen, the reveal animation, the celebration layer, the
forfeit penalty, and the *structure* of the draft grade and post-game analysis.

### Needs a per-sport seam

**`js/draft.js` is coupled to basketball in three places** and each is a small,
contained fix:

- it imports `impact()` from `js/sports/nba/engine.js` to score bot picks → the sport
  should supply `rate(player)`
- it groups squads by `p.decade` → NFL rows carry `era`
- `decadeWeight()` balances how often each decade comes up → becomes a
  per-sport group weighting

**The Edge Function is hardcoded to basketball.**
`supabase/functions/simulate-match/index.ts` imports `simulateGame` from
`./engine.js` and reads `from("players")` directly. Online NFL needs it to
dispatch on `match.sport` — pick the engine and the table off a server-side
registry mirroring `js/sports/`. This is the single biggest piece of
server work and it gates online play, not offline.

**Engine parity gets a second pair.** `scripts/verify-parity.mjs` currently
diffs one client engine against one vendored copy. It becomes a loop over
sports. Same four axes (constants, tactics, source, box scores) per sport.

**The draft grade needs an NFL `constructionMetrics`.** The concept carries
perfectly — balance, depth, no exploitable hole — but the categories change:
instead of scoring/rebounding/playmaking/defense it is pass offense, run
offense, pass defense, run defense, and trenches. A roster with a great QB and
no offensive line should grade badly and then *lose the way the grade said it
would*, which is the property that makes the NBA grade worth trusting.

---

## 6. Order of work

Deliberately front-loads the thing most likely to be wrong.

1. **Data first.** Import, verify, and eyeball actual unit ratings. If the
   1985 Bears' front seven does not come out elite, nothing downstream is
   worth building. This is also where the play-by-play gets mined for real
   drive-outcome frequencies.
2. **Engine offline, against the bot.** Drive model, box-score attribution,
   fed by the real frequencies from step 1. Target: scorelines and drive
   counts that pass a fan's eye test before a single balance knob is touched.
3. **Calibrate.** Port `tools/calibrate-variance.mjs`'s method — solve how
   often the better roster wins and how much a game swings — then solve the
   gamestyles against that. Same order as basketball: variance, then styles.
4. **Draft grade, strategies, recap.** The layer that makes a result explain
   itself. Reuses the existing shapes.
5. **Online.** Edge Function sport dispatch, parity harness, then the ranked
   flow end to end.
6. **Flip `live: true`** and clear the `todo` array in `js/sports/nfl.js`.

Steps 1–4 ship a complete offline game. That is a real milestone worth
releasing on its own — Quick Play and Ranked Practice against the bot need no
server work at all, and it puts the simulation in front of people while the
online plumbing is still being built.

---

## Open questions

- **Unit granularity on the offensive line.** One OL slot, or split
  interior/tackles? One is cleaner and matches how the unit is remembered;
  splitting rewards deeper knowledge. Recommend starting with one.
- **Do defensive units keep their own box score?** A per-unit line (tackles,
  sacks, takeaways) is more legible than eleven individual lines, but it means
  the box score has two different row types. Recommend yes — legibility wins,
  and it matches the draft.
- **Squad pool size.** Basketball rolls a team-decade with ~10 players.
  A team-era in football has 50+, but only ~11 draftable entries once units are
  aggregated. Needs a check that squads have enough draftable entries for an
  11-slot draft without running dry — the same check
  `tools/check-coverage.mjs` does for basketball.
