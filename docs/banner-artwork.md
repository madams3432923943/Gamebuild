# Banner artwork

The twenty general banners in `assets/banners/` are the card. On the player
card the artwork fills the whole thing, sharp, at every width. There is no
second treatment, no fallback layout, and nothing is blurred.

That card appears in two places - the home screen and both sides of the matchup
intro (see `docs/matchup-intro.md`), which is the screen where somebody else
sees your banner.

## Spec

| | |
| --- | --- |
| Size | **2120 × 720** |
| Aspect ratio | **2.94 : 1** — the card's own proportions |
| Format | **JPEG**, quality 90 |
| Typical weight | 200–650 KB, ~8 MB for the set |
| Naming | Title-Case-Hyphenated, matching `file` in `js/banners.js` |

2120px is 2× the ~1060px the card reaches on desktop, so it stays sharp on
retina. Building files at exactly the card's ratio means the committed file is
what the player sees — `cover` crops nothing.

## Replacing artwork

Put full-resolution originals in `tools/banner-source/` and run:

```
node tools/build-banner-art.mjs
```

It resizes to 2120×720 with a centre crop and re-encodes to JPEG q90, printing a
before/after table. Originals are **not committed** — 48 MB of source for 8 MB of
output — the same arrangement as `tools/seasons/*.csv` (see `tools/README.md`).
The set as first uploaded is recoverable from git history at commit `daa7589`.

## Two hazards, both of which have already bitten

**Never rename a binary through GitHub's web UI.** It opens the file in a text
editor and saves the result. `Blossom.png` was renamed to `Pink-Blossom.png` that
way and arrived **2 bytes long**, containing `\r\n`. The banner rendered as
nothing. Upload a replacement file instead, or rename via git.

**Renaming a banner's file renames its ID, which is stored in the database.**
`bannerBase()` in `js/banners.js` derives `id` from `file`, and that id is
persisted in `profiles.equipped_banner` and `profiles.granted_banners`. Renaming
`blossom` → `Pink-Blossom` would have changed the id to `pink-blossom` and
silently unequipped everyone flying it, voiding their grants — with no error
anywhere. Pass an explicit `id` to keep the stored value:

```js
{ file: "Pink-Blossom", id: "blossom", name: "Pink Blossom", ... }
```

`verify:banner-resolution` holds a list of the ids that exist in the database and
fails if one stops resolving.

## Why JPEG

The artwork is photographic texture, where PNG's losslessness buys nothing
visible and costs about 6×. Measured on the real files at 2120×720:

| PNG | JPEG q90 | JPEG q82 | WebP q85 |
| --- | --- | --- | --- |
| ~3,600 KB | ~490 KB | ~390 KB | ~350 KB |

q90 because the artwork is the product. WebP would save another ~25%; not taken,
since JPEG is universally supported and the set already fits comfortably. No
banner uses transparency, so nothing was lost leaving PNG behind.

## What holds it in place

- `npm run verify:banner-resolution` — every catalogue entry resolves to a real
  file at the exact path **and case** (Pages is case-sensitive), the file is a
  genuine image rather than just a name, it is wide enough, shaped like the card,
  light enough, and no stored id has changed.
- `browser:banner-art` in `scripts/verify-browser.mjs` — measures the **painted**
  result in Chromium at 1280px and 360px: the card shows the artwork, nothing is
  blurred, the layer covers the card.

## History

Worth reading before "simplifying" any of this, because both dead ends are the
obvious thing to try.

The artwork used to be ~265×90. On a ~1060px card that is a **3.9× upscale**, and
it shipped looking like a rendering fault.

| Attempt | Outcome |
| --- | --- |
| `cover` on the small files | The original bug. |
| `repeat` at native size | **Measured and rejected.** None of the twenty textures wrap; edge seams ran 2–20× each image's own neighbouring-pixel variation, so it draws a visible grid. |
| Blurred wash of the art | **Rejected in review.** Still read as blurry — deliberate softness and accidental softness are indistinguishable to whoever is looking at it. |
| Colour field + small sharp copy | Sharp, but it was not the banner. |
| **Bigger source files** | What actually worked. |

Nothing in CSS invents detail that is not in the file. Only the last row ever
could have.

## Known limitations

- `applyArtFallback()` in `js/ui/profile.js` (module-private there) drops the card back to the banner's two
  colours if a file fails to load, so a bad file degrades rather than rendering a
  blank slab. It does not check size — that is a build-time gate now.
- The Rewards grid renders all twenty at ~8 MB total. Fine today; if the set
  grows much past this, they want lazy loading or a smaller tile variant.
