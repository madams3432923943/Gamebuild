-- Two tables were protected by accident rather than on purpose, and two
-- foreign keys had no index.
--
-- SECURE BY ACCIDENT IS NOT SECURE.
--
-- `blocked_terms` and `message_reports` both have row level security ENABLED
-- and NO POLICIES, while still carrying table grants to `anon` and
-- `authenticated`. RLS with no policy denies everything, so today neither is
-- readable and there is no live exposure. That is the whole problem: the
-- protection is a side effect of a policy list being empty, and the day
-- somebody adds one narrow policy to either table - which is a perfectly
-- ordinary thing to do - the grants underneath it come alive with it.
--
-- What would come alive is not trivial:
--
--   blocked_terms is the moderation word list. Handing it to a client tells
--   every griefer exactly which strings to spell differently.
--
--   message_reports is who reported whom, and why. It is the last table in
--   this database that should be readable by the person being reported.
--
-- Neither is ever read from a browser. Reports are written through
-- report_squad_message(), a SECURITY DEFINER function that checks the caller;
-- the blocklist is read inside moderation_blocked_category(), also DEFINER.
-- Both keep working with no client grant at all, because a DEFINER function
-- runs as its owner. Revoking makes the intent explicit and leaves RLS as the
-- second line rather than the only one.
--
-- The other seven RLS-enabled, policy-less tables the advisor lists -
-- presence, rpc_attempts, signin_attempts, squad_invite_codes, both staging
-- tables and the players backup - already have no client grants at all. They
-- are service-role-only by design and need no change; they are named here so
-- the next reader of that advisor list does not have to work it out again.

revoke all on table public.blocked_terms   from anon, authenticated;
revoke all on table public.message_reports from anon, authenticated;

-- UNINDEXED FOREIGN KEYS on message_reports.
--
-- Both columns point at auth.users, and neither had a covering index. That
-- costs nothing today - the table is nearly empty - but the cost lands in the
-- worst place: deleting a user makes Postgres scan this table once per foreign
-- key to enforce the constraint, and delete_own_account() is a function a
-- player triggers themselves and waits on.
--
-- These are ADDED rather than the "unused" ones being dropped. The advisor
-- also lists eight indexes as never used, and with six online games ever
-- played that is a statement about how new the app is, not about whether the
-- indexes are needed. Dropping an index because a beta has not exercised it is
-- how the first busy week finds out why it existed.
create index if not exists message_reports_reported_user_id_idx
  on public.message_reports (reported_user_id);
create index if not exists message_reports_reporter_id_idx
  on public.message_reports (reporter_id);
