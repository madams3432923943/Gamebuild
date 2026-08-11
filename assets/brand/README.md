# Brand assets

`draft-nova-logo.png` is the header mark, referenced by `index.html`.

It is deliberately OPTIONAL. The `<img>` in the header carries
`onerror="this.remove()"`, so if the file is missing the mark disappears and
the "Draft Nova" wordmark stands on its own - a missing asset degrades to
clean text rather than a broken-image icon.

Drop the logo in here as `draft-nova-logo.png` and it appears with no code
change. A wide, transparent-background PNG works best: the header sizes it to
`1.6em` tall and caps it at `8rem` wide.

Still to add, if you want them (none are wired yet):
  - `favicon.ico` / `favicon.png`  - browser tab icon
  - `apple-touch-icon.png`         - iOS home screen
  - `og-image.png`                 - link previews
