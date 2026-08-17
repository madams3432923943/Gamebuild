# Banner artwork: how big the PNGs need to be

## The problem this documents

The twenty general banners are real PNGs in `assets/banners/`, all about
**265×90**. That is the right size for a tile in the Customize grid, which draws
them at roughly 190px wide — a downscale, so they look crisp.

The home identity card is a different question. On a desktop it is about
1060px wide, and painting one 265px texture across it is a **~3.9× upscale**.
It shipped that way and did not read as a soft background; it read as a
rendering fault.

## What was tried

| Approach | Result |
| --- | --- |
| `background-size: cover` (what shipped) | ~3.9× upscale. Visibly broken on desktop. |
| `background-repeat: repeat` at native size | **Rejected — measured.** None of the twenty textures wrap. Seam difference at the edges ran 2–20× each image's own neighbouring-pixel variation, so `repeat` draws a visible grid. |
| Deliberate heavy blur, art only | Looks intentional, but the player never sees their banner. |
| Blurred wash + sharp plate | **Rejected in review.** Still called blurry — deliberate softness and accidental softness are indistinguishable to whoever is looking at it. |
| **Colour field + sharp plate** (shipped) | The field is built from the banner's own two colours in pure CSS, so it is sharp at any size. The art appears once, at ≤1.3× native. Nothing on the card is blurred. |

No CSS invents detail that is not in the file. Those were the only options.

## How it works now

In `css/style.css`, under `.player-banner`:

- `.pb-banner-wash` — the artwork at `cover` on narrow cards; on wide ones the
  same layer paints a gradient of `--banner-c1`/`--banner-c2` instead. No blur
  at any width.
- `.pb-banner-plate` — a second copy, ≤351px wide (1.3× native), right-anchored.
  Only on wide cards.

Both are created in `renderHomeHeader` (`js/ui.js`) and switched by a
**container query on the card's own width**, not the viewport's — the card's
width over the image's width is what sets the scale factor.

> The art is painted on a child layer, never on `.player-banner` itself. An
> element cannot match a container query on itself, only its descendants can.
> Written the other way round, the query silently does nothing.

## The real fix — and it needs no code change

**Replace the files in `assets/banners/` with larger ones.** That is the whole
change. `applyArtResolution()` in `js/ui.js` measures each image's intrinsic
width when the card renders; at **900px wide or more** the card drops the colour
field and the plate and goes back to being the banner, full-bleed and sharp.

### Spec

| | |
| --- | --- |
| **Minimum** | **1600 × 544 px** |
| Preferred | 2120 × 720 px (sharp on 2× displays at full desktop width) |
| Aspect ratio | ~2.94 : 1 — the same as the current files, so nothing crops differently |
| Format | PNG, **same filenames**, same folder |
| Threshold | ≥900px wide flips a banner to full-bleed automatically |

Filenames must match exactly, because `js/banners.js` builds the path as
`assets/banners/<file>.png`. Replacing a file is zero-downtime; deleting one is
not — the card and the Rewards tile both fall back to the banner's two colours
until it returns, which is tidy but is not the artwork.

Files can be replaced one at a time. Each banner is measured independently, so a
mix of upgraded and not-yet-upgraded banners is a supported state, not a broken
one.

`npm run verify:banner-resolution` asserts the PNGs are still the small size the
current layout was written against. If that check fails because the art got
*bigger*, that is the good outcome — the workaround can be deleted.

## What holds it in place

- `npm run verify:banner-resolution` — source sizes, the upscale cap, and that
  the art is painted on a descendant layer.
- `browser:banner-art` in `scripts/verify-browser.mjs` — measures the **painted**
  result in Chromium at 1280px and 360px. Only the browser knows how many source
  pixels ended up covering how many screen pixels. It also generates a 1600px
  image in-page and pushes it through the same code path, so the promise that
  "bigger files just work" is tested before anyone redraws twenty banners.

## Known limitations

- The plate assumes the card's right side is free. No image banner currently
  carries an emblem or a label, which are the only other things that live there;
  if one ever does, they collide.
- On a wide card the field is the banner's two colours, not its artwork, so two
  banners sharing a palette look alike from across the room. The plate is what
  tells them apart.
- Image banners get the left-weighted scrim that patterned banners use. Without
  it a pale palette (Arctic Stripe) put near-white behind the white username.
