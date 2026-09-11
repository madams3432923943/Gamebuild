# Draft Nova account emails

These are the **Supabase Auth email templates**, kept in the repo so they are
reviewable, diffable and not a thing that exists only inside a dashboard
textarea nobody can see the history of.

**They are not applied from here.** Supabase renders auth emails from templates
stored in the project's own configuration (Authentication → Emails), and there
is no migration, API call or file in this repository that can set them. Pasting
them in is a manual step — see `docs/production-email.md`, which lists exactly
what goes where and what is still outstanding.

| File | Supabase template | Sent when |
| --- | --- | --- |
| `confirm-signup.html` | Confirm signup | A new account is created, **if** email confirmation is switched on (it is currently off) |
| `reset-password.html` | Reset password | A player uses "Forgot password" |
| `change-email.html` | Change email address | A player attaches or changes their recovery address from the Profile tab |

## Rules these files follow

Email clients are not browsers. Everything here is deliberate:

- **Tables for layout, inline styles for everything.** Gmail strips `<style>`
  blocks in some contexts and no client can be relied on for flexbox or grid.
- **No external CSS and no web fonts.** A system font stack renders everywhere.
- **One image, and the mail reads without it.** Most clients block remote
  images by default, so the wordmark carries `alt` text and the heading below it
  repeats the name in text. A mail whose only branding is a blocked image is an
  unbranded mail.
- **A light card on a dark ground, not a dark mail.** Several clients (Outlook
  desktop especially) drop `background-color` on `<body>` and force their own,
  which turns light-on-dark text into white-on-white — an unreadable mail. The
  page ground is dark and the readable block sits on a light card, so the worst
  case is a correct-looking mail with the wrong backdrop.
- **A real text link under every button.** The button is a table cell with a
  background; if a client flattens it, the URL underneath is still clickable.
- **`{{ .ConfirmationURL }}` and nothing clever.** Supabase substitutes these
  server-side. `scripts/verify-email-templates.mjs` checks every variable used
  here against the set Supabase actually provides, because a typo in one
  (`{{ .ConfirmationUrl }}`) renders as empty and mails a link to nowhere.
