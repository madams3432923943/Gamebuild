# Game modes

What a player can play, where each answer lives, and what the old vocabulary
maps onto.

## The shape

```
PLAY
├── ONLINE RANKED      real opponent, matchmaking, rank on the line
└── PRACTICE           offline against the bot
    ├── EASY           stats shown, no clock, weak bot
    ├── MEDIUM         the calibrated bot
    └── HARD           elite bot

FRIENDS
└── a specific friend
    └── CHALLENGE      unranked, ranked rules
```

Three cards became two, and Practice grew a difficulty. Everything else about a
match — the roster, the rules, the engine — is now the same in every mode.

## Why it was three, and why that was wrong

`Quick Play` and `Ranked Practice` were the same game at two settings. Worse,
Quick Play also decided **roster shape**: five slots and no bench, against the
other two modes' ten. So the mode you tapped silently changed what a roster
*was*, which is why removing a mode reached the engine (`EDGE_BASELINE` has a
`quickPlay` entry to this day), the draft board, the pick clock, the strategy
phases and the provenance stamp at once.

Practice exists to rehearse Online Ranked. A rehearsal at a different roster
size rehearses nothing.

## Where a mode is declared

`js/modes.js`, once. Before this, a mode was two independent strings —
`game.mode` (`"bot"`/`"online"`) and `game.ruleset` (`"easy"`/`"strict"`) — and
four different questions were answered by re-deriving from one or the other:

| question | old test | now |
| --- | --- | --- |
| is there a pick clock? | `ruleset !== "easy"` | `matchConfig().timed` |
| is the draft board open? | `ruleset === "easy"` | `matchConfig().openBoard` |
| run the strategy phases? | `ruleset !== "strict"` | always |
| which roster shape? | `ruleset === "easy"` | always `slots.ranked` |
| does this move a rank? | `mode === "online"` | `matchConfig().ranked` |

`game.ruleset` no longer exists. `game.modeConfig` holds the resolved record and
every screen reads it.

## Bot difficulty

Difficulty decides **which legal player the bot takes**, and nothing else. It
comes in two shapes, because one ranked list cannot say what football's
difficulties mean.

### The shared window (basketball)

Difficulty selects a **window** over the board's legal players, ranked
best-first by the sport's own `rate()`.

| difficulty | window | notes |
| --- | --- | --- |
| Easy | skip 62% of the board, take 8 | the bottom third — legal, complete, beatable |
| Medium | *(null)* | the legacy ban-and-pool path, bit-for-bit |
| Hard | skip 0%, take 4 | the top of the board, four names wide |

Basketball's Medium is deliberately unchanged: every gamestyle modifier and
variance range in that sport was solved against that exact bot
(`tools/calibrate-*.mjs`), and a "medium" that drafted even slightly differently
would silently invalidate all of them. The calibrators draft through `banTop`,
which overrides difficulty entirely, so a sport's own plan cannot reach them
either.

### The per-position plan (football)

A sport may answer the difficulty question itself, through `botDraftPlan` on the
sport contract. Football does, because its difficulties are about **sides of the
ball**: a window over one list can make a bot better or worse, and cannot make
it good at one thing and bad at another.

| difficulty | offense target | defense target | special teams | the game it is for |
| --- | --- | --- | --- | --- |
| Easy | 0.24 | 0.24 | 0.24 | beat up on a bad team while learning the pool |
| Medium | 0.70 | 0.36 | 0.52 | put up points against an opponent that answers back |
| Hard | 0.87 | 0.87 | 0.87 | a complete team; draft badly on either side and lose |

Targets are in the rating space the draft board already shows — a percentile
among others at the same position (`js/sports/nfl/units.js`) — so one number
means "top of his position" for a cornerback unit and a quarterback alike, and
no per-position raw thresholds are needed. Each pick is weighted by a one-sided
Gaussian on its distance from its group's target (`qualityWeight` in
`js/draft.js`): a preference, never a cutoff, with a floor under it so a squad
holding nothing near the target still gets drafted from rather than forfeiting
a slot. Overshooting is penalised harder than undershooting, since a Medium bot
landing on a superstar is the specific thing Medium is defined by not doing.

The lever reaches **seasons**, not just names, and it has to. A rolled squad is
a team-era, so it offers about 24 distinct offensive candidates and only about 3
defensive ones — one cornerback unit, one line, one safety group. But each of
those units appears once per season in the era (about 8.6 rows) spanning roughly
0.24 to 0.76 in rating, so which season of the Seahawks secondary the bot takes
is most of the quality decision available at a defensive slot. A window over
distinct players cannot express that at all, which is why football's old Hard
drafted a *worse* defense (0.54) than its old Medium (0.70).

Measured over 150 drafts per difficulty (`npm run verify:nfl-practice-difficulty`):

| difficulty | overall | offense | defense | QB | RB | WR | TE | OL | DL | LB | CB | S | ST |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Easy | 0.27 | 0.27 | 0.28 | 0.26 | 0.31 | 0.28 | 0.27 | 0.20 | 0.27 | 0.29 | 0.27 | 0.28 | 0.21 |
| Medium | 0.50 | 0.63 | 0.37 | 0.65 | 0.62 | 0.62 | 0.61 | 0.62 | 0.35 | 0.39 | 0.37 | 0.38 | 0.49 |
| Hard | 0.77 | 0.80 | 0.75 | 0.80 | 0.78 | 0.80 | 0.80 | 0.83 | 0.78 | 0.71 | 0.74 | 0.75 | 0.85 |

And what those rosters do on a Sunday — 120 simulated games each, the same
reference roster on the human side, no difficulty passed to `simulate()` because
it has no parameter for one:

| difficulty | user pts | bot pts | user win rate |
| --- | --- | --- | --- |
| Easy | 37.7 | 7.3 | 98% |
| Medium | 29.4 | 17.1 | 83% |
| Hard | 11.6 | 24.8 | 14% |

Medium's higher scoring is a **roster** result: a decent offense in front of a
soft defense, with no scoring multiplier, no eased RNG and no reduced
interception rate anywhere. Hard against a full-strength drafter
(`banTop: 0`) comes out 23.9–18.0 and 64% — punishing for a mediocre draft,
beatable with a complete one, which is what the mode is for.

Basketball's own spread, over 30 drafts per difficulty
(`npm run verify:mode-rules`), as mean draft grade on a 0–1 scale: 0.15 easy,
0.23 medium, 0.69 hard.

### Difficulty cannot reach the simulation

A difficulty declares seven fields — `id`, `label`, `blurb`, `tagline`,
`timed`, `openBoard`, `window` — and none of them is anything the engine reads.
A sport's plan declares only `{ rating, below, above }` per position group, and
none of those is either. The difficulty travels exactly one hop, from
`matchConfig()` into `DraftState.botAutoPick`, and nothing downstream of that
line knows which was chosen.

`verify-mode-rules` asserts it twice: structurally, that no unexpected field has
appeared on a difficulty; and behaviourally, that the same two rosters with the
same seed produce the identical scoreline whichever difficulty is named.

If Easy loses more, it is because its roster is worse.

## Timers

| mode | clock |
| --- | --- |
| Easy practice | **none** |
| Medium practice | yes |
| Hard practice | yes |
| Online Ranked | yes |
| Friend match | yes |

"No clock" means no interval is created — not a hidden one. `startPickTimer`,
`startRotationPhase` and `startMatchupPhase` all return before creating their
countdown when the match is untimed, so there is no path that confirms a phase
the player did not confirm.

## Friend matches

Reached only from **Friends → Challenge**, never from the Play screen: a friend
match needs a specific person, and a mode card that queued against a stranger
would be a different mode wearing the word "friend".

Same rules as ranked — clock, hidden board, ranked roster, authoritative server
simulation — with `ranked: false`, which is the single fact that keeps it off
the ladder. The server has always written these as `mode: "friendly"` and skips
the rating exchange for them (`supabase/functions/simulate-match/index.ts`).

Challenging used to throw. It called `getEra()`, which is a function in
`js/main.js` and has never been imported into `js/screens/squads.js`, so every
challenge died on a `ReferenceError` that the catch reported as "Couldn't start
that challenge". The challenge dialog now asks for the sport and the era where
the choice is being made, rather than inheriting a bracket picked on a screen
the player cannot see from the Friends tab.

## Stored history

**Nothing is migrated and nothing is rewritten.** The label is computed at read
time by `historyModeLabel`.

| stored `mode` | reads as |
| --- | --- |
| `online` | Ranked |
| `friendly` | Friend Match |
| `local` | Local (pass-and-play, removed years ago) |
| `offline` | Practice |
| *(absent)* | Practice |

Rows written from now on additionally carry `gameMode` and, for practice, a
`difficulty`, so a new row reads "Practice (Hard)" while an old one honestly
reads only "Practice". Both fields are additive: an old row simply lacks them.

Quick Play and Ranked Practice were never stored as distinct modes — both wrote
`mode: "offline"` and differed only inside `rulesVersion`
(`"practice-easy-rules-…"` versus `"practice-strict-rules-…"`). So there is
nothing to migrate: they were already, and correctly, practice games. A friendly
used to render as "Practice" in the match list, which was the one label that was
actually wrong.

`mode` itself stays the storage vocabulary it has always been, because the era
ladders and the online/offline records aggregate on it.

## What was kept and is now unused

`slots.quickPlay` — the five-slot compact shape. No mode deals it any more, but
each sport still declares it and both engines still handle it: games played
under it are in saved history, `EDGE_BASELINE.quickPlay` describes a real roster
shape the engine can be handed, and the calibration and box-score harnesses
drive it. Removing the declaration would remove the engine's ability to score a
roster shape that exists in the database.

## Verifying

```
npm run verify:mode-rules      # what each mode promises, and the bot grades
npm run verify:bot-difficulty  # the top of the board stays the human's
npm run verify:nfl-practice-difficulty  # football's three teams, and the games they play
```
