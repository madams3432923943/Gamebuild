-- Two weaknesses in username sign-in, both found by reading the function
-- rather than by anything failing.
--
-- 1. ANYONE COULD LOCK ANY USERNAME OUT OF USERNAME SIGN-IN.
--
-- The throttle counted attempts and raised BEFORE checking the password, so
-- ten wrong guesses against a username you know - and usernames are public,
-- they are on every squad roster and every friend list - shut that username's
-- own owner out for fifteen minutes. The owner could still sign in with their
-- email address, because the client sends anything containing "@" straight to
-- signInWithPassword (see resolveSignInEmail in js/supabaseClient.js), so this
-- was griefing rather than lockout. It is still a stranger deciding when you
-- can use your own username.
--
-- The order is inverted now: the password is checked first, and a CORRECT
-- password always succeeds however high the counter is. That costs an attacker
-- nothing they had - they do not have the password, which is the whole point -
-- and it removes their ability to affect anybody else's sign-in. The throttle
-- still slows repeated WRONG guesses at one username, which is what it was for.
--
-- 2. THE RESPONSE TIME SAID WHETHER A USERNAME EXISTED.
--
-- crypt() ran only when the username resolved to a user. bcrypt at cost 10 is
-- deliberately slow - tens of milliseconds - so "no such username" returned
-- promptly and "that username with the wrong password" did not. That is a
-- username enumeration oracle, readable over the network without any special
-- tooling.
--
-- One crypt() call now happens on every path, against a real bcrypt hash of a
-- value nobody will guess when the account does not exist. Same cost, same
-- shape, no signal. The constant carries the same `$2a$10$` prefix the stored
-- hashes do, so the work matches rather than merely existing.
--
-- WHAT THIS DOES NOT FIX, stated because it is the bigger risk and it is not
-- solvable here. The throttle is per username, so trying one common password
-- against ten thousand DIFFERENT usernames is unlimited - credential stuffing,
-- which is the attack this endpoint shape actually attracts. Postgres cannot
-- see the client IP through PostgREST, so a real defence belongs in Supabase
-- Auth's own rate limiting and in leaked-password protection (HaveIBeenPwned),
-- which is a dashboard setting and is flagged by the security advisor. A
-- global counter here would only convert it into a way to lock out everybody
-- at once.

create or replace function public.sign_in_email_for(p_username text, p_password text)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  -- A real bcrypt hash, at the same cost as the stored ones, of a string no
  -- account will ever have. Used only to spend the same time when there is no
  -- account to check against. Not a secret: knowing it proves nothing and
  -- unlocks nothing.
  c_absent_hash constant text := '$2a$10$I.yh3yU/Z9gKhrMURSmFVuQn1RUxIEhjlduWMyAdIJ8/TvloH4xLu';
  v_key    text := lower(btrim(coalesce(p_username, '')));
  v_recent integer;
  v_id     uuid;
  v_email  text;
  v_hash   text;
  v_check   text;
  v_matches boolean;
  v_ok      boolean;
begin
  if v_key = '' or coalesce(p_password, '') = '' then
    return null;
  end if;

  -- An address is not a username. The client sends those straight to
  -- signInWithPassword and never comes here.
  if position('@' in v_key) > 0 then
    return null;
  end if;

  delete from public.signin_attempts where attempted_at < now() - interval '1 day';

  select p.id into v_id
  from public.profiles p
  where lower(p.username) = v_key
  limit 1;

  if v_id is not null then
    select u.email, u.encrypted_password into v_email, v_hash
    from auth.users u
    where u.id = v_id;
  end if;

  -- ALWAYS ONE crypt(), whether or not the account exists. See the header: the
  -- absence of this call was itself the answer to "does this username exist".
  --
  -- IT IS ITS OWN STATEMENT FOR A REASON. Written as
  -- `v_email is not null and crypt(...) = v_check` the hash never runs for an
  -- absent account, because `and` short-circuits - which is the identical bug
  -- in a new costume, and the first version of this migration shipped it.
  -- Measured: 111.8ms for a real username against 0.5ms for an absent one.
  -- Computing the comparison first and combining after is what makes the work
  -- unconditional; the same measurement now reads 74ms either way.
  v_check := coalesce(nullif(v_hash, ''), c_absent_hash);
  v_matches := extensions.crypt(p_password, v_check) = v_check;
  v_ok := v_email is not null and v_matches;

  -- THE PASSWORD WINS OVER THE THROTTLE. Whoever holds it is the owner, and no
  -- number of failed guesses by anybody else may stand between them and their
  -- own account.
  if v_ok then
    delete from public.signin_attempts where username_key = v_key;
    return v_email;
  end if;

  insert into public.signin_attempts (username_key) values (v_key);

  select count(*) into v_recent
  from public.signin_attempts
  where username_key = v_key and attempted_at > now() - interval '15 minutes';

  if v_recent >= 10 then
    raise exception 'Too many sign-in attempts for that username. Wait a few minutes and try again.';
  end if;

  return null;
end;
$function$;

-- Unchanged from the previous grant: sign-in has to work before you are signed
-- in. Restated rather than assumed, because a create-or-replace keeps the old
-- grants and a reader should not have to know that to be sure.
grant execute on function public.sign_in_email_for(text, text) to anon, authenticated;
