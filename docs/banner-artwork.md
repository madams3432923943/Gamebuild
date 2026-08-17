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
| **Blurred wash + sharp plate** (shipped) | The blurred copy is the card's colour field; a second copy is drawn sharp at ≤1.3× native. |

No CSS invents detail that is not in the file. Those were the only options.

## How it works now

In `css/style.css`, under `.player-banner`:

- `.pb-banner-wash` — the artwork, `cover`. Sharp on narrow cards, blurred hard
  on wide ones.
- `.pb-banner-plate` — a second copy, ≤351px wide (1.3× native), right-anchored.
  Only on wide cards.

Both are created in `renderHomeHeader` (`js/ui.js`) and switched by a
**container query on the card's own width**, not the viewport's — the card's
width over the image's width is what sets the scale factor.

> The art is painted on a child layer, never on `.player-banner` itself. An
> element cannot match a container query on itself, only its descendants can.
> Written the other way round, the query silently does nothing.

## The real fix

**Commission the artwork at ~1060×360 or larger.** At that size the card can go
back to plain `cover` and the wash/plate treatment can be deleted outright.

`npm run verify:banner-resolution` asserts the PNGs are still the small size the
current layout was written against. If that check fails because the art got
*bigger*, that is the good outcome — re-evaluate whether any of this is still
needed.

## What holds it in place

- `npm run verify:banner-resolution` — source sizes, the upscale cap, and that
  the art is painted on a descendant layer.
- `browser:banner-art` in `scripts/verify-browser.mjs` — measures the **painted**
  result in Chromium at 1280px and 360px. Only the browser knows how many source
  pixels ended up covering how many screen pixels.

## Known limitations

- The plate assumes the card's right side is free. No image banner currently
  carries an emblem or a label, which are the only other things that live there;
  if one ever does, they collide.
- The blurred wash is a `filter: blur(26px)` on a full-card layer. It is static,
  not animated, and only active above 480px of card width.
