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

Difficulty selects a **window** over the board's legal players, ranked
best-first by the sport's own `rate()`. That is the entire mechanism.

| difficulty | window | notes |
| --- | --- | --- |
| Easy | skip 62% of the board, take 8 | the bottom third — legal, complete, beatable |
| Medium | *(null)* | the legacy ban-and-pool path, bit-for-bit |
| Hard | skip 0%, take 4 | the top of the board, four names wide |

Medium is deliberately unchanged: every gamestyle modifier and variance range in
this app was solved against that exact bot (`tools/calibrate-*.mjs`), and a
"medium" that drafted even slightly differently would silently invalidate all of
them.

Measured over 30 drafts per difficulty per sport (`npm run verify:mode-rules`),
as mean draft grade on a 0–1 scale:

| sport | easy | medium | hard |
| --- | --- | --- | --- |
| NBA | 0.15 | 0.23 | 0.69 |
| NFL | 0.38 | 0.60 | 0.65 |

Football's spread is narrower and structurally so: it drafts twelve
position-locked slots, and a late pick with one slot open can offer six eligible
players — a window cannot bite through a board that thin. `BOT_MIN_CHOICES` is
the same floor that stops the legacy ban emptying a thin board.

### Difficulty cannot reach the simulation

A difficulty declares seven fields — `id`, `label`, `blurb`, `tagline`,
`timed`, `openBoard`, `window` — and none of them is anything the engine reads.
The difficulty travels exactly one hop, from `matchConfig()` into
`DraftState.botAutoPick`, and nothing downstream of that line knows which was
chosen.

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
```
