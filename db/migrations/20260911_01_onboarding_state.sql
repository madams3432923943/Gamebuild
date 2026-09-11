-- Has this account seen the first-run explanation of what Draft Nova is?
--
-- WHY ON THE PROFILE AND NOT IN localStorage. localStorage is per browser, so
-- the same person gets the welcome again on their phone, and again in a private
-- window, and never on a reinstall. The profile is the account, which is the
-- thing "first time" is actually a property of.
--
-- WHY NOT A NEW TABLE. There is already exactly one row per account carrying
-- everything else about them (equipped cosmetics, records, history). A second
-- table keyed by the same id, holding one boolean, would be a second profile
-- system - which CLAUDE.md rules out and which nothing here needs.
--
-- THE BACKFILL IS THE WHOLE MIGRATION, NOT A DETAIL. The column defaults to
-- false, so without the UPDATE below every existing player would be shown a
-- "welcome to Draft Nova" modal on their next visit - having played for weeks.
-- The update runs once, here, over the rows that exist NOW; every row created
-- after this migration takes the default and is genuinely new.
--
-- Client behaviour is deliberately asymmetric about the missing case: the app
-- shows onboarding only when it reads `false`, so a column that is absent
-- (a client newer than the database) shows nothing rather than showing the
-- welcome to everyone. Client code has to tolerate a server that has not
-- caught up - and the failure that matters here is the false positive.

alter table public.profiles
  add column if not exists has_seen_onboarding boolean not null default false;

comment on column public.profiles.has_seen_onboarding is
  'First-run onboarding: false for an account that has never been shown the welcome modal. Set to true by the client (js/onboarding.js) when the modal is closed or completed. Backfilled to true for every account that existed before the modal shipped - see 20260911_01. Not sensitive; profiles is publicly readable.';

-- Everybody who already plays is already onboarded.
update public.profiles set has_seen_onboarding = true;
