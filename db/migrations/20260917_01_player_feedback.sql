-- In-app player feedback: the table it lands in, and the one function that is
-- allowed to put a row there.
--
-- WHY A TABLE AT ALL, WHEN THE POINT IS AN EMAIL. Email is a notification, not
-- storage. A mailbox cannot be queried, deduplicated or triaged, and a mail
-- provider that is down or misconfigured loses the message outright - which is
-- the one outcome a feedback feature must not have, because the player is told
-- it worked and has no way to find out otherwise. So the row is the record and
-- the mail is the alert: the Edge Function writes the row FIRST and only then
-- tries to send, and a send that fails costs a notification rather than the
-- feedback itself.
--
-- WHY A SECURITY DEFINER FUNCTION AND NOT A PLAIN RLS INSERT. An insert policy
-- can say "the row must be yours". It cannot say "not more than five an hour",
-- and it cannot trim whitespace or reject a 40,000-character paste without a
-- trigger doing the real work anyway. Putting all three in one function means
-- there is exactly one way a feedback row is created, and every rule holds for
-- the Edge Function, for a browser calling the RPC directly, and for anything
-- either of them grows into later.
--
-- THE RATE LIMIT IS REUSED, NOT REINVENTED. public.enforce_rate_limit already
-- exists (20260819_02_rpc_rate_limits.sql) and is the project's answer to this
-- exact question. Five per hour is deliberately generous: somebody who has
-- just hit three separate bugs should be able to report all three.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- A SNAPSHOT, not a join. The name on the message is the name they were
  -- using when they sent it; renaming an account later must not rewrite the
  -- history of what was said and by whom it was said at the time.
  username text,
  body text not null,
  -- Where they were and what they were doing. All optional: a feedback form
  -- that refuses to send because the screen name could not be determined is
  -- worse than one that sends without it.
  page_context text,
  sport_context text,
  app_build text,
  user_agent text,
  -- new -> reviewed -> resolved, for whoever works the queue. Constrained
  -- rather than free text so a triage UI can rely on the three values.
  status text not null default 'new' check (status in ('new', 'reviewed', 'resolved')),
  created_at timestamptz not null default now(),

  -- THE SAME LIMIT THE BROWSER ENFORCES, said here so it is true even when the
  -- browser is not the thing calling. 1,200 characters is long enough for a
  -- detailed bug report and short enough that no single row can be used as
  -- storage. js/feedback.js carries the matching constant and
  -- scripts/verify-feedback.mjs fails the build if the two ever disagree.
  constraint feedback_body_length check (char_length(body) between 1 and 1200)
);

-- The triage queue reads newest first, and that is the only read there is.
create index if not exists feedback_created_idx on public.feedback (created_at desc);
-- The rate-limit question ("how many has this user sent lately?") is answered
-- by rpc_attempts, but a support reply needs every message from one player.
create index if not exists feedback_user_idx on public.feedback (user_id, created_at desc);

alter table public.feedback enable row level security;

-- NO POLICIES, AND THAT IS THE POINT. RLS with zero policies denies everything
-- to anon and authenticated - no select, no insert, no update, no delete. A
-- player cannot read another player's feedback because a player cannot read
-- feedback at all, including their own; the only way a row is created is the
-- SECURITY DEFINER function below, which sets user_id itself rather than
-- trusting a client to. The revoke is belt and braces against a future
-- `grant all on all tables` sweep.
revoke all on public.feedback from anon, authenticated;

-- ---------------------------------------------------------------------------
-- submit_feedback: validate, throttle, record.
-- ---------------------------------------------------------------------------
--
-- Returns the new row's id so the caller can log which message it was without
-- being able to read the table.
--
-- ARGUMENT NAMES ARE THE CONTRACT. PostgREST resolves an RPC by its exact
-- argument names (CLAUDE.md), so an unmatched set reads as a missing function.
-- Anything added here later has to have a default, or every client that has not
-- shipped yet stops finding this function at all.
create or replace function public.submit_feedback(
  p_body text,
  p_page_context text default null,
  p_sport_context text default null,
  p_app_build text default null,
  p_user_agent text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text;
  v_username text;
  v_id uuid;
begin
  -- AUTHENTICATED ONLY. The settings menu this is reached from is behind the
  -- sign-in gate, so there is no legitimate anonymous caller - and an
  -- unauthenticated feedback endpoint that sends mail is an open relay.
  if v_uid is null then
    raise exception 'You need to be signed in to send feedback.' using errcode = 'P0001';
  end if;

  -- TRIMMED BEFORE IT IS MEASURED, so " " is empty rather than one character.
  -- This is the server's own check and not a mirror of the browser's: the
  -- browser's disabled button is a courtesy, this is the rule.
  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then
    raise exception 'Feedback can''t be empty.' using errcode = 'P0001';
  end if;
  if char_length(v_body) > 1200 then
    raise exception 'Feedback is limited to 1200 characters.' using errcode = 'P0001';
  end if;

  perform public.enforce_rate_limit(
    'feedback', 5, interval '1 hour',
    'You''ve sent a few pieces of feedback just now - thanks. Try again in a little while.'
  );

  select username into v_username from public.profiles where id = v_uid;

  insert into public.feedback (user_id, username, body, page_context, sport_context, app_build, user_agent)
  values (
    v_uid,
    v_username,
    v_body,
    -- Context fields are diagnostics chosen by the client, so they are capped
    -- rather than trusted. Nothing renders them as markup, but an unbounded
    -- text column filled from a browser is storage somebody else is paying for.
    left(nullif(btrim(coalesce(p_page_context, '')), ''), 120),
    left(nullif(btrim(coalesce(p_sport_context, '')), ''), 40),
    left(nullif(btrim(coalesce(p_app_build, '')), ''), 60),
    left(nullif(btrim(coalesce(p_user_agent, '')), ''), 400)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Callable by a signed-in player and by nobody else. anon is excluded on
-- purpose even though the body would reject it anyway: an endpoint that exists
-- for anon is an endpoint anon can make us do work for.
revoke all on function public.submit_feedback(text, text, text, text, text) from public, anon;
grant execute on function public.submit_feedback(text, text, text, text, text) to authenticated;
