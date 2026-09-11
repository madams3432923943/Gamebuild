# Production account email

What Draft Nova's account emails do today, what changed in this sprint, and the
short list of things only the project owner can finish.

Audited 2026-09-11 against the live Supabase project (`aauvgiygwrwdbtruhxta`).

---

## The audit

Every flow below was read off the live `auth.users` table rather than assumed.
The numbers are as of the audit date, across 33 auth users.

| Reading | Value | What it means |
| --- | --- | --- |
| Accounts with any address | 18 of 33 | The other 15 are pre-account-era rows from July with no profile and no address. |
| Accounts with a **real** address | 14 | Four are still on the synthetic `@ballknowledge.app` addresses the old username-only sign-up minted. |
| `email_confirmed_at` set | 18 | All of them. |
| `confirmation_sent_at` set | **0** | No confirmation mail has ever been sent — so email confirmation is **switched off** and Supabase is auto-confirming. |
| `recovery_sent_at` set | 1 | Exactly one password reset has ever been requested. |
| `email_change_sent_at` set | 2 | Two players have attached or changed an address. |

Three conclusions worth stating plainly:

1. **Email confirmation is off.** `signUp()` in `js/supabaseClient.js` already
   handles both cases and shows "check your inbox" when it gets no session, so
   the branch is written and dormant. Turning confirmation on is a product
   decision, not a code change (see *Outstanding* below).
2. **Recovery is almost untested in production.** One request, ever. That is not
   evidence it works; it is evidence nobody has needed it yet, which is the
   worst time to find out.
3. **Four accounts cannot be recovered at all.** They have no reachable
   mailbox. Nothing in code can fix that — they have to sign in with the
   password they have and attach an address from the Profile tab.

### Which mail each flow sends

| Flow | Trigger in the app | Supabase template |
| --- | --- | --- |
| Password reset | "Forgot password" on the sign-in screen → `requestPasswordReset()` | Reset password |
| Account confirmation | Sign-up, only while confirmation is on → `signUp()` | Confirm signup |
| Email attach/change | Profile tab → `updateEmail()` | Change email address |
| Password changed | — | *none; see below* |

**There is no "your password was changed" notification, and Supabase does not
send one.** Its auth service has no such template: the six it exposes are
Confirm signup, Invite, Magic Link, Change Email, Reset Password and
Reauthentication. A change-of-password notice would have to be built — an auth
hook or a database trigger on `auth.users` plus an Edge Function to send it —
and that is a feature, not a configuration. It is listed as future work rather
than reported as preserved. What Supabase *does* provide and this project keeps
is the pair that actually gate account takeover: a reset link that expires and
is single-use, and confirmation of a new address sent to the **new** address
before it takes effect.

---

## What changed in the repository

### 1. Mailed links now point at the production domain

`siteUrl()` in `js/supabaseClient.js` built the redirect from
`window.location.origin + window.location.pathname`, which is correct for
exactly one spelling of the site and silently wrong for every other way of
reaching it. A player who arrives at `www.draftnovagame.com`, at the
`github.io` address Pages also serves, or at `…/index.html` with the filename
typed out, got a mail whose link went back to **that** spelling — and Supabase
refuses to mail a link to a URL that is not on the project's redirect
allow-list. The symptom is a player who asks for a reset and receives nothing.

It now returns the canonical `https://draftnovagame.com/` for any non-local
host, so there is one link to get right and one allow-list entry to maintain.
`localhost`, `127.0.0.1` and `*.local` keep sending themselves the link, because
a mail pointing at the live site is useless while testing recovery locally.

### 2. Reset-by-username no longer mails an address nobody can read

`requestPasswordReset()` mapped anything without an `@` to
`<username>@ballknowledge.app`. For the four legacy accounts that address is a
mailbox nobody can open; for every account created since, **no such user
exists**. Either way the call "succeeded", no mail arrived anywhere useful, and
the screen said *"Reset link sent. Check your inbox."*

It now refuses to send in that case and returns `{ sent: false }`, and the
sign-in screen says what to do instead: use the email address, or sign in and
attach one. No mail is sent that could never be read.

### 3. Branded templates exist in the repo

`docs/email/` holds the three templates as reviewable HTML, with
`docs/email/_README.md` explaining the email-client constraints each choice
answers (tables not flexbox, inline styles, a light card on a dark ground so a
client that drops `background-color` does not produce white-on-white, a text
link under every button, one image the mail reads fine without).

`npm run verify:email` checks them: that every `{{ .Variable }}` they use is one
Supabase actually substitutes — a typo like `{{ .ConfirmationUrl }}` renders as
empty and mails a link to nowhere — and that each one carries the brand, the
domain and the support address.

---

## Outstanding — owner only

These need credentials or dashboard access that is deliberately not in this
repository. **Nothing below has been done.**

### A. Add the production URL to the redirect allow-list

Supabase Dashboard → **Authentication → URL Configuration**:

- **Site URL**: `https://draftnovagame.com/`
- **Redirect URLs**: `https://draftnovagame.com/**`

Without this, every mailed link is refused and change 1 above buys nothing.
This is the single most important item on the list.

### B. Paste the three templates

Supabase Dashboard → **Authentication → Emails**, then for each file in
`docs/email/`, paste the body and set the subject:

| File | Template | Subject |
| --- | --- | --- |
| `reset-password.html` | Reset password | `Reset your Draft Nova password` |
| `confirm-signup.html` | Confirm signup | `Confirm your Draft Nova account` |
| `change-email.html` | Change email address | `Confirm your new Draft Nova email` |

Re-paste after editing a file here. There is no sync: the repo copy is the
reviewable source, the dashboard copy is what sends.

### C. Custom SMTP on the business domain

**No SMTP credentials exist in this repository or its environment, and none were
invented.** Supabase's built-in mailer is rate-limited to a couple of messages
an hour and sends from a Supabase address, which is fine for a handful of
players and not fine for a launch: mail from `noreply@mail.app.supabase.io`
about an account at `draftnovagame.com` is the exact shape spam filters are
tuned for.

Supabase Dashboard → **Project Settings → Authentication → SMTP Settings**, and
supply from whoever hosts `draftnovagame.com` mail:

- Host and port (587 with STARTTLS, or 465 with TLS)
- Username and password (an app password or API key, **not** the mailbox login)
- Sender email: `noreply@draftnovagame.com`
- Sender name: `Draft Nova`
- Minimum interval between emails: leave at the default

Then, in DNS for `draftnovagame.com`, so the mail is not filed as spam:

- **SPF** — a TXT record authorising the provider's servers
- **DKIM** — the CNAME or TXT records the provider issues
- **DMARC** — a TXT record at `_dmarc`, starting at `p=none` to collect reports
  before tightening

The provider's own documentation gives the exact record values; they differ per
provider and guessing them would be worse than leaving this blank.

### D. Decide whether email confirmation goes on

Currently off, so sign-up is immediate. Turning it on
(**Authentication → Providers → Email → Confirm email**) stops a player using an
address they do not own, at the cost of a step between sign-up and the first
game. The app handles both already — `signUp()` returns
`{ needsConfirmation: true }` and the screen says to check the inbox — so this
is a single toggle whenever you want it.

**Do C before D.** Confirmation on top of the built-in rate-limited mailer means
a player who signs up during a busy hour cannot get in at all.

### E. One toggle unrelated to email, found while auditing

**Authentication → Policies → Leaked password protection** is off. Supabase can
check a chosen password against HaveIBeenPwned on sign-up and password reset and
refuse the ones that are already in a breach corpus. It is a switch, it costs
nothing, and it is the single highest-value auth setting not currently enabled.

Supabase's own security advisor reports it (`auth_leaked_password_protection`).
Noted here rather than filed elsewhere because the reset flow is where it
matters most: a reset is exactly when somebody types the password they use
everywhere.

Nothing else in the advisor output is a finding. The `analytics_events`,
`active_days`, `analytics_event_types` and `admin_users` tables appear under
"RLS enabled, no policy", which is the intended design and the same shape
`presence`, `rpc_attempts` and `signin_attempts` already have: RLS on with no
policies and no grants means only `SECURITY DEFINER` code can read them. And no
function added in this sprint is reachable by `anon` — the advisor's anon list
contains only the two sign-in helpers that are meant to be.

### F. Then test recovery end to end

Once A and B are in:

1. Sign out, choose **Forgot password**, enter a real address.
2. Check the mail is branded and that its link starts with
   `https://draftnovagame.com/`.
3. Follow it — the app should open on **Set a New Password**, not on sign-in.
4. Set a password and confirm you land in the game already signed in.
5. Open the same link a second time. It must be refused; the screen should show
   the expired/invalid message rather than a blank page.

Step 5 is the one people skip, and a reset link that still works on the second
use is a security bug rather than a convenience.
