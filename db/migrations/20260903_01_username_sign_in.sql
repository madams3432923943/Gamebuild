-- Signing in with a username, for accounts that have a real email address.
--
-- THE BUG
--
-- js/supabaseClient.js resolves whatever you type in the identifier box: an
-- "@" means it is an email and is used as-is, anything else is treated as a
-- username and mapped to `username@ballknowledge.app`. That mapping is correct
-- for LEGACY accounts, whose auth address really is that synthetic string,
-- and it is wrong for every account created since sign-up started asking for a
-- real email - their auth address is the real one, so the synthetic address
-- matches no user and the sign-in fails with "invalid credentials".
--
-- So username sign-in worked only for accounts old enough to predate email,
-- which is why it looked like "only email works". The client had no way to do
-- better on its own: mapping a username to its account's address needs a read
-- of auth.users, which no browser has or should have.
--
-- WHY THIS RETURNS THE EMAIL ONLY WHEN THE PASSWORD IS RIGHT
--
-- The obvious version of this function takes a username and returns the
-- address on file. That is an email-harvesting endpoint: anyone who can guess
-- usernames can collect the addresses behind them, and usernames are public -
-- they are on every leaderboard in the game.
--
-- Taking the password too and returning nothing unless it verifies leaks
-- nothing that a successful sign-in does not already reveal. A wrong password
-- and an unknown username are indistinguishable from the outside: both return
-- null, and neither says which. The password is checked against
-- auth.users.encrypted_password with the same crypt() comparison Supabase's
-- own auth does, so this is not a second, weaker way in - it is the same
-- check, used to answer a different question.
--
-- The client still calls signInWithPassword afterwards with the address this
-- returns. Nothing here mints a session or bypasses anything: it converts a
-- username into the address the real sign-in needs, and the real sign-in is
-- still the thing that decides.
--
-- WHY ITS OWN THROTTLE
--
-- public.enforce_rate_limit is keyed on auth.uid(), and nobody signing in has
-- one yet - it would throttle nothing at all here. A function that verifies a
-- password for an anonymous caller is a guessing oracle if it is unbounded, so
-- attempts are counted per username instead.
--
-- ONLY FAILURES COUNT, AND A SUCCESS CLEARS THE SLATE. Counting every call
-- turns the throttle into the attack: usernames are public, so ten anonymous
-- calls against a name would lock its actual owner out of username sign-in for
-- fifteen minutes, renewable forever, by someone who never knew the password.
-- A correct password is proof the caller is the owner, so it empties the
-- bucket rather than filling it, and a person mistyping their own password
-- five times is never a step closer to being locked out of the sixth attempt
-- that works.

create table if not exists public.signin_attempts (
  id bigserial primary key,
  username_key text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists signin_attempts_lookup_idx
  on public.signin_attempts (username_key, attempted_at desc);

-- No policies, and no grants: every read and write goes through the SECURITY
-- DEFINER function below. Nothing client-side has any business reading who has
-- been trying to sign in as whom.
alter table public.signin_attempts enable row level security;
revoke all on public.signin_attempts from anon, authenticated;

create or replace function public.sign_in_email_for(p_username text, p_password text)
returns text
language plpgsql
security definer
-- `extensions` is where Supabase installs pgcrypto, and crypt() lives there.
set search_path = public, extensions, pg_temp
as $$
declare
  v_key   text := lower(btrim(coalesce(p_username, '')));
  v_recent integer;
  v_id    uuid;
  v_email text;
  v_hash  text;
begin
  -- An empty identifier or password is not an attempt, and must not consume
  -- an attempt from the budget either - otherwise a page that fires on every
  -- keystroke would lock a player out of their own account.
  if v_key = '' or coalesce(p_password, '') = '' then
    return null;
  end if;

  -- An address is not a username. The client only calls this for the
  -- no-"@" case; refusing one here as well keeps the function's contract
  -- true on its own rather than by agreement with a caller.
  if position('@' in v_key) > 0 then
    return null;
  end if;

  delete from public.signin_attempts where attempted_at < now() - interval '1 day';

  select count(*) into v_recent
  from public.signin_attempts
  where username_key = v_key and attempted_at > now() - interval '15 minutes';

  -- Ten in fifteen minutes: far more than a person mistyping their own
  -- password, far less than a guessing run. Raised rather than returned as
  -- null so the player is told to wait instead of being told their password
  -- is wrong, which is the message that makes someone reset a password that
  -- was fine.
  if v_recent >= 10 then
    raise exception 'Too many sign-in attempts for that username. Wait a few minutes and try again.';
  end if;

  select p.id into v_id
  from public.profiles p
  where lower(p.username) = v_key
  limit 1;

  if v_id is not null then
    select u.email, u.encrypted_password into v_email, v_hash
    from auth.users u
    where u.id = v_id;
  end if;

  -- The same comparison Supabase's own auth performs.
  if v_email is not null and coalesce(v_hash, '') <> ''
     and crypt(p_password, v_hash) = v_hash then
    -- Proof of ownership. Clear the bucket so a run of typos, or somebody
    -- else's guessing, cannot leave the real owner rate-limited.
    delete from public.signin_attempts where username_key = v_key;
    return v_email;
  end if;

  -- Everything else is a failure and is counted: a wrong password, an unknown
  -- username, an account with no password set. They are indistinguishable to
  -- the caller, which is the point - the return is null either way and neither
  -- says which.
  insert into public.signin_attempts (username_key) values (v_key);
  return null;
end;
$$;

revoke all on function public.sign_in_email_for(text, text) from public;
-- anon, because the whole point is that the caller is not signed in yet.
grant execute on function public.sign_in_email_for(text, text) to anon, authenticated;

-- TWO ADVISOR FINDINGS, BOTH DELIBERATE.
--
--   rls_enabled_no_policy on signin_attempts. The same shape as
--   public.rpc_attempts: RLS on, no policies, no grants, every access through
--   the definer function above. A policy would be a way in that does not need
--   to exist.
--
--   anon_security_definer_function_executable on sign_in_email_for. The anon
--   grant is the entire point - nobody signing in has a session yet. It is the
--   same intentional grant public.username_rejection_reason carries, and for
--   the same reason: sign-up and sign-in both have to answer questions before
--   there is a user to answer them for.
