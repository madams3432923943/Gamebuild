# Player feedback

How a player's feedback gets from the settings gear to the developers, what
enforces the rules along the way, and the one configuration step that is not in
this repository.

---

## The shape of it

```
Settings (gear, home screen)
  └─ Send Feedback  ──────────────►  js/ui/feedback-form.js    the form and its states
                                        │
                                        ▼
                                     js/feedback.js            the rules and the call
                                        │  functions.invoke("send-feedback")
                                        ▼
                      supabase/functions/send-feedback/index.ts
                                        │
                        ┌───────────────┴───────────────┐
                        ▼                               ▼
              rpc submit_feedback              Resend  ──►  support@draftnovagame.com
              (auth, trim, limit,              (server-side key only)
               rate limit, insert)
                        │
                        ▼
               public.feedback  (RLS: no policies at all)
```

**The row is the record; the email is the alert.** The function stores first and
mails second, so a mail provider that is down, misconfigured or absent costs a
notification rather than the feedback itself. The response separates `stored`
from `emailed` precisely so that "we never sent the mail" cannot be reported to
anyone as success.

---

## Files

| File | What it holds |
| --- | --- |
| `index.html` | The `Feedback` row at the top of `#settings-body`. |
| `js/main.js` | One listener: close Settings, open the form in the shared modal. |
| `js/ui/feedback-form.js` | The dialog body and its idle / submitting / success / error states. |
| `js/feedback.js` | `MAX_FEEDBACK`, `isSendableFeedback`, `feedbackContext`, `sendFeedback`. |
| `js/lib/build-stamp.js` | `buildStamp()`, shared by the Settings sheet and the feedback payload. |
| `js/shell.js` | `currentScreen()`, so a report can name the screen it came from. |
| `supabase/functions/send-feedback/index.ts` | Auth, validation, the RPC call, the mail. |
| `db/migrations/20260917_01_player_feedback.sql` | The table, its RLS, and `submit_feedback`. |
| `scripts/verify-feedback.mjs` | 40 checks, in the verify chain as `npm run verify:feedback`. |

---

## The rules, and where each one is actually enforced

| Rule | Browser | Edge Function | Database |
| --- | --- | --- | --- |
| Signed in | form is behind the auth gate | `auth.getUser()` on the caller's JWT | `auth.uid()`, raises if null |
| Not empty | disabled button | `trim()` then reject | `btrim` then reject |
| Whitespace-only is empty | trimmed before measuring | trimmed | `btrim` |
| ≤ 1,200 characters | counter + `maxlength` | rejected with the number | `CHECK` + explicit guard |
| ≤ 5 per hour | — | — | `enforce_rate_limit('feedback', 5, '1 hour')` |
| Row belongs to the sender | — | — | `user_id` is `auth.uid()`, never a client value |
| Nobody reads anyone's feedback | — | — | RLS on, **zero policies**, privileges revoked |

The browser's copies are courtesies — a live counter and a disabled button. The
database is what decides. `scripts/verify-feedback.mjs` reads the limit out of
all three files and fails the build if they ever disagree, because three copies
of one number is two chances to drift and the drift is invisible until somebody
loses 1,400 characters they had just typed.

**Why the function calls the RPC as the user rather than inserting with the
service role:** `enforce_rate_limit` keys off `auth.uid()` and deliberately does
nothing when there isn't one, so a service-role insert would have had no rate
limit at all. Calling `submit_feedback` on a client carrying the caller's own
JWT means the throttle, the length rule and the ownership of the row are all
enforced against the real user. The function adds the mail; it does not add a
way around the rules.

---

## CONFIGURATION — the one step that is not in this repository

**No email provider has ever been configured for this project.** The audit in
`docs/production-email.md` found no SMTP credentials in the repo or its
environment, and none were invented here. The server-side structure is complete
and the secret has a place to live; the key itself has to be added once.

Until it is, the feature **still works**: feedback is validated, throttled and
stored, and the function answers `{ stored: true, emailed: false, emailStatus:
"not_configured" }`. Nothing is lost and nothing claims to have been mailed.

### To turn the email on

1. Create a [Resend](https://resend.com) account and an API key.
2. Set the secret on the Supabase project:

   ```
   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx \
     --project-ref aauvgiygwrwdbtruhxta
   ```

   Or Dashboard → Edge Functions → `send-feedback` → Secrets.

3. Deploy the function (the workflow does this on push to `main`, or by hand):

   ```
   supabase functions deploy send-feedback --project-ref aauvgiygwrwdbtruhxta
   ```

That is the whole of it. Two further variables are optional:

| Variable | Default | When to set it |
| --- | --- | --- |
| `RESEND_API_KEY` | *(none)* | **Required for mail.** Without it, feedback is stored and not mailed. |
| `FEEDBACK_TO_EMAIL` | `support@draftnovagame.com` | To route reports somewhere else. |
| `FEEDBACK_FROM_EMAIL` | `Draft Nova <onboarding@resend.dev>` | Once `draftnovagame.com` is verified with Resend, change this to an address on it. Resend's sandbox sender works before any domain is verified, which is what makes the feature testable on day one. |

**The key never reaches the browser.** `scripts/verify-feedback.mjs` scans every
module under `js/` for the name of any mail-provider or service-role credential
and fails if one appears, and checks that the function reads its key from
`Deno.env` rather than a literal.

---

## Reading the feedback

RLS denies everything to `anon` and `authenticated`, so the queue is read with
the service role — the SQL editor, or the admin tooling:

```sql
select created_at, username, sport_context, page_context, app_build, status, body
  from public.feedback
 order by created_at desc
 limit 50;
```

`status` moves `new` → `reviewed` → `resolved` and is constrained to those three,
so a triage UI can rely on the values.

---

## Known limitations

- **Mail is unverified end to end.** No provider is configured, so the send path
  has never delivered a real message. Everything up to the `fetch` to Resend is
  checked; the delivery itself is one API call behind a key nobody has set yet.
- **The rate limit is per user, not per IP.** An account is required to submit at
  all, so the cheapest abuse is still "make accounts", which is sign-up's problem
  rather than this feature's.
- **No attachments and no screenshots.** A bug report describes the screen it
  came from (`page_context`) but cannot show it.
- **No reply channel.** Feedback is one-way; answering means mailing the address
  on the account, by hand.
