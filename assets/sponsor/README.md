# Sponsor creative

Campaign artwork goes here, and **only** here.

The page's Content Security Policy sets `img-src 'self' data:`, so an image
hosted on a sponsor's own server does not load — silently, with nothing in the
console for the player and nothing in the slot but the text. Committing the file
under this directory is what makes it loadable, and
`scripts/verify-sponsors.mjs` fails any campaign whose `image` points anywhere
else.

That is a deliberate default, not an inconvenience: a creative served from a
third party means every player fetching something from a sponsor's
infrastructure on page load, which is the tracking-pixel shape this game does
not have and should not acquire.

If a sponsor genuinely cannot supply a file to commit, hosting theirs remotely
needs a CSP change in `index.html` and a decision made on purpose — see
`docs/sponsorship.md`.

## Practical notes

- Give the file the campaign id: `assets/sponsor/<campaign-id>.png`.
- The side rails are 160px wide; the slot caps an image at 180px tall and
  fits it with `object-fit: contain`, so any aspect ratio is safe.
- Ship it at 2x for retina (320px wide) and keep it under ~40KB. It loads on
  the home screen, which is the screen whose load time matters most.
- SVG works and is usually smaller for a wordmark. It is served as a file, not
  inlined, so it cannot carry script.
