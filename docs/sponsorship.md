# Sponsorship inventory

How a sponsor gets on the site, what the slots are, and what is measured.

This is **inventory, not advertising**. There is no ad network, no tag manager,
no auction, no third-party script and no cross-site anything — and adding one
would be a different decision from anything described here. A campaign is a
row in `js/ads/campaigns.js`; a placement is a slot on a screen that draws
whichever campaign is currently running for it.

## The placements

| Placement | Where | Renders today |
| --- | --- | --- |
| `home-rail-left` | The empty column left of the centred home content | House slot |
| `home-rail-right` | The same on the right | House slot |
| `postgame` | Below the final screen's box score and exit buttons | Nothing — no campaign names it |
| `event` | A sponsored tournament, challenge or event | Nothing; declared so the shape exists |

`event` has no container anywhere on purpose. The brief was explicit about not
cluttering the site with empty ad boxes, so the first sponsored event brings its
own screen with it; the placement id exists so that work is a container and a
campaign row rather than a new system. `scripts/verify-sponsors.mjs` fails a
campaign that names it, so nobody can sell it by accident.

### Desktop and mobile

The rails are `position: fixed` and live outside `#app-root`, which is
`max-width: 1100px` and centred. That is the whole design:

- They use space the content column was **already not using**. Laying them out
  in the flow — a three-column grid — would narrow the draft board, the court
  and the box score at every width, to make room for something that is empty
  most of the time. The game's column is byte-for-byte unchanged.
- They appear only at **≥1500px wide and ≥560px tall**. The width is
  arithmetic, not taste: 1100px of content plus two 160px rails plus 24px of
  clearance and a 16px window margin each side. Below it they are
  `display: none` — not narrowed, not stacked under the content, not a
  horizontal scrollbar. The height gate exists because a fixed rail taller than
  the window has no scroll of its own, so on a short laptop the bottom of the
  card would be unreachable.
- They appear only while the **home screen** is showing, enforced in CSS with
  `body:has(#screen-home:not(.hidden))` rather than by hiding them on every
  navigation path. A rail over the draft board is structurally impossible, not
  a thing someone has to remember.

On tablet and phone there is no side placement at all, and no alternate banner
squeezed in above the game. The intentional mobile placement is `postgame`,
which is in the flow, full width, and sits below everything a player came to
that screen for.

## Adding a campaign

1. Commit the creative to `assets/sponsor/<campaign-id>.<ext>` — see that
   directory's README. The CSP is `img-src 'self' data:`, so a remotely hosted
   image does not load, silently.
2. Add a row to `CAMPAIGNS` in `js/ads/campaigns.js`:

```js
{
  id: "acme-2026-11",                     // stable; it is the analytics key
  sponsor: "Acme",
  headline: "One line, as text not baked into the image",
  body: "Optional second line.",
  cta: "See the range",                   // omit for a non-clickable slot
  href: "https://acme.example/",          // https or mailto only
  image: "assets/sponsor/acme-2026-11.png",
  placements: [PLACEMENTS.POSTGAME],
  start: "2026-11-01",                    // inclusive
  end: "2026-11-30",                      // inclusive; null for open-ended
}
```

3. `npm run verify:sponsors`.

**Never reuse or rename an `id`.** It is the key impressions and clicks are
recorded under, so reusing one merges two campaigns' reporting into a row that
can never be separated again.

The dates are data, which is the point: a campaign that has ended stops drawing
on the next page load, with nothing to deploy and nobody to remember. The
headline is **text** rather than part of the image so it stays legible at any
width, is readable by a screen reader, and can be translated later.

Every string a campaign supplies is written with `textContent`. There is no path
from this config to `innerHTML`, and it must stay that way.

## What gets measured

Two events, through the app's own analytics (`js/analytics.js`) — no sponsor
tracking pixel, no third-party beacon.

| Event | Props | When |
| --- | --- | --- |
| `sponsor_impression` | `placement`, `campaign` | The slot was actually on screen |
| `sponsor_click` | `placement`, `campaign` | The CTA was clicked |

CTR is `sponsor_click` over `sponsor_impression` for a campaign, readable from
the admin dashboard's funnel section.

### An impression is a view, not a render

This is the part worth understanding before quoting a number to anybody.

Screens in this app re-render for reasons that have nothing to do with anyone
looking at them: the home screen redraws every time you come back to it, and the
rails are rebuilt with it. Counting renders would measure how often the app
called a function — a number that looks billable and is not.

So a slot is counted when the browser says it is genuinely visible:
`IntersectionObserver` at a 50% threshold, held for **1 second**, and at most
**once per campaign per placement per page session**. Scrolling a slot out of
view and back does not count twice. A slot rendered into a hidden screen does
not count at all, which is correct — the rails are filled whether or not the
home screen is up.

The result is deliberately **conservative**: impressions here are lower than a
render count would be, and the CTR computed from them is a real ratio. A browser
without `IntersectionObserver` records no impression rather than falling back to
counting the render, because the fallback would be exactly the overcount this
design exists to avoid, and it would be invisible in the data.

## What is deliberately not built

- **No ad network integration.** No Google, no header bidding, no third-party
  JavaScript. The CSP would block it and that is the correct default.
- **No gambling or sportsbook creative.** Not a technical limitation — a
  standing decision, given who plays this.
- **No frequency capping, pacing, rotation or A/B testing.** With single-digit
  campaigns these are ceremony. `activeCampaigns()` returns a list and the
  renderer takes the first, so rotation is a change to one function rather than
  to any screen.
- **No campaign database or admin CRUD screen.** Every campaign has to be
  reviewed by a person before it goes live anyway; a table would add a home-page
  round trip, a schema to migrate, a screen to build, and a way for a bad row to
  put unreviewed artwork in front of players. The object above is already the
  shape of the row when the time comes — `activeCampaigns()` is the only thing
  that would have to learn to fetch.
