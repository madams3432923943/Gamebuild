# Brag Plan: Draft Nova

## What is this app?
A multi-sport draft-battle game where both sides draft from the same rolled
squad — "Chicago Bulls 1990s" — and under ranked rules there is no visible
player list, so you type a name from memory and a fuzzy search resolves it.
Then the rosters play a simulated game and the recap explains *why* you lost.

## The angle
It is not a stats app. It is a memory test with a scoreboard attached. The
whole product lives in one uncomfortable moment: an empty roster slot, a blank
search field, and no list to pick from. Everything else in the video exists to
set that moment up and pay it off. The premise: the site asks you a question in
its own hero copy, and the video spends 20 seconds making you answer it.

## Hook (first 2-3 seconds)
The hero line, verbatim, on the near-black page: **"Think you know ball?"** —
held just long enough to feel like a challenge — then **"Prove it."** lands in
amber underneath. No UI yet. Type is the whole frame.

## Key moments (the middle)
- The squad chip rolling and locking: **Chicago Bulls · 1990s**. Both sides get
  the same squad — that is the fairness that makes the recall matter.
- **The empty slot with no list.** Five labelled slots, PG/SG/SF/PF/C, all
  blank. The search field has no dropdown. This is the product.
- A name typed from memory, fuzzy-resolved mid-keystroke, card snapping into
  the slot. Then two more, faster.
- The post-game panel headed **"What your coaching did"** — the product's
  actual answer to "why did that happen".

## Outro / punchline
The recap line resolves, then the board clears to the wordmark. Final beat:
**Draft Nova**. No tagline under it — the hook already asked the question.

## User flow worth showing
Entry → key action → result, all three real:
1. **Entry** — choose sport, squad rolls, roster slots appear empty.
2. **Key action** — type a player from memory into a field with no list; fuzzy
   search resolves it; card fills the slot. Repeat under a pick clock.
3. **Result** — gameplan confirmed, game simulates, recap explains the outcome.

## Tone
- Preset: `polished`
- Creative direction: late-night sports broadcast cold open
- Interpretation: fewer scenes, longer holds, confidence through restraint. The
  amber-on-near-black palette already reads as a scoreboard; lean into that
  rather than adding energy. Motion is fast, but every line settles and holds.

## Format: landscape — 1920x1080
## Duration: 20 seconds

## Visual identity (from the project)
- Background: `#0d1117`
- Accent: `#d9741f` (bright variant `#ff9d4d`)
- Text: `#eef2f8`
- Scoreboard amber: `#ffd166`
- Win green: `#3fcf8e` / buzzer red: `#e8433d`
- Panel line: `#2a323e`
- Display font: system stack (`-apple-system`, `Segoe UI`, Helvetica, Arial) —
  no webfont is loaded; substitute a clean grotesque, do not invent a serif.
- Mono (for the clock and stat columns): `ui-monospace`, Menlo, Consolas
- Strongest visual element: the empty roster slot row against near-black, with
  the pick clock counting in mono amber.

## Share copy (draft)
No player list. No dropdown. Just an empty slot, a pick clock, and whatever you
actually remember about the '96 Bulls. Draft Nova is live.

## Audio direction
- Role: sparse professional accents over a low bed — broadcast cold open, not a
  hype reel.
- Music: one of the bundled `happy-beats-business-moves` tracks, the least
  bouncy available; start low, lift on the squad lock, fade under the recap.
- Music treatment: enter at ~0.5s under the hook, hold low through the typing
  scene so keystrokes read clearly, small lift at the score, fade out over the
  final two seconds so the wordmark lands in near-silence.
- Music cue guidance: read the bundled track's preset from `assets/music/cues/`;
  target strong cues for (1) "Prove it." landing, (2) the squad chip locking,
  (3) the first roster card snapping into its slot. Sequential card reveals
  should use every *other* beat, not every beat — three cards at 110 BPM on
  consecutive beats is too fast to read the names.
- Audio-reactive treatment: subtle. The accent glow on the pick clock may
  breathe with bass. No waveform bars, no pulsing whole-frame.
- SFX posture: sparse and motion-matched. Keyboard ticks under the typed name,
  one dry snap per roster card, one low impact on the squad lock.
- Audio-coupled moments: the hook typing on, the squad chip locking, each
  roster card arriving, the score ticking up.
- Restraint rule: no whoosh on every transition, no riser into the outro, and
  nothing loud enough to compete with the keystrokes in Scene 3 — that scene's
  sound *is* the product.

## Storyboard

### Scene 1 — The question — 3.5s
Near-black frame. "Think you know ball?" types on in display white, holds ~1.2s
settled. Beat of silence. "Prove it." cuts in beneath it in accent amber,
slightly larger, and holds 1.0s. Nothing else on screen — no UI, no logo.
Sequential/interaction: yes — the first line types character by character; the
second line does not type, it cuts in hard.
Audio intent: quiet and expectant; the challenge should feel dry, not hyped.
Audio-coupled idea: subtle key ticks under the typed first line; one soft low
hit as "Prove it." lands.
Music: low bed entering under the type.
Transition mood: clean → Scene 2

### Scene 2 — The roll — 3.5s
The squad chip spins through team-and-decade combinations and locks on
**Chicago Bulls · 1990s**. Beneath it, a small line: both sides draft this same
squad. Five empty roster slots fade up — PG, SG, SF, PF, C — all blank.
Sequential/interaction: yes — the chip cycles then locks; the five empty slots
fade in as a set, not one by one.
Audio intent: mechanical settle, like a board locking in.
Audio-coupled idea: ticking through the roll, one dry impact on the lock.
Music: small lift on the lock.
Transition mood: clean → Scene 3

### Scene 3 — No list — 7s
**The centerpiece.** Push in on one empty slot and the search field. The field
is conspicuously empty — no dropdown, no suggestions, nothing to pick from.
Hold that emptiness ~1s so the viewer registers there is no list. Then a name
types in from memory, resolves mid-keystroke via fuzzy match, and the player
card snaps into the slot. Two more slots fill after it, faster, with the pick
clock counting down in mono amber in the corner.
Sequential/interaction: yes — simulate real typing into the field, then three
cards arriving one by one, each on alternating beats with a full settled hold
on the first name so it can be read.
Audio intent: this is the tense beat. Keystrokes forward in the mix, music
pulled back under them.
Audio-coupled idea: keyboard ticks on the typed name; one dry card snap per
slot filled; soft clock ticks under the countdown.
Music: pulled low.
Transition mood: hard cut → Scene 4

### Scene 4 — Gameplan, then result — 3s
Gameplan cards appear and one is selected. Hard cut to the simulated game: the
scoreline ticks up in scoreboard amber and settles on a final.
Sequential/interaction: yes — a cursor selects one gameplan card; the score
counts rather than appearing.
Audio intent: brief lift, then release on the final score.
Audio-coupled idea: counter ticks on the score; one selection click.
Music: lift.
Transition mood: clean → Scene 5

### Scene 5 — Why — 3s
The post-game panel, headed verbatim **"What your coaching did"**, with one
line of recap resolving beneath it. Hold. Then the panel clears to near-black
and the wordmark **Draft Nova** settles in the centre in amber.
Sequential/interaction: none — one line, one hold, one clear.
Audio intent: everything fades; the wordmark lands nearly dry.
Audio-coupled idea: none. Silence is the point.
Music: fading out across the scene.

**Music mood for this video:** restrained upbeat, broadcast-adjacent
**Audio summary:** a low bed enters under the hook, lifts on the squad lock,
pulls back hard so the typed name and pick clock carry Scene 3 alone, lifts
once on the final score, and fades to near-silence for the wordmark.

**Scene durations:** 3.5 + 3.5 + 7 + 3 + 3 = **20.0s**
