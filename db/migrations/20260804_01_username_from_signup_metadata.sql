-- Let a new account keep the username the player chose.
--
-- handle_new_user hardcoded it:
--
--   insert into public.profiles (id, username) values (new.id, 'Player');
--
-- It never looked at raw_user_meta_data, where signUp() puts the chosen name
-- (js/supabaseClient.js passes it as options.data.username). That was masked
-- because js/main.js calls setUsername() immediately after signup - but only
-- when signUp returns a session, and with email confirmation ON it doesn't.
--
-- So turning verification on would have created every account as "Player",
-- permanently, with no way for the player to tell why. This is the fix that
-- has to land before confirmation can be enabled.
--
-- Falls back to 'Player' exactly as before when no username was supplied, so
-- any other path that creates a user is unaffected.

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_username text;
begin
  v_username := nullif(trim(new.raw_user_meta_data ->> 'username'), '');

  -- Same rule the client enforces before submitting (USERNAME_PATTERN in
  -- js/supabaseClient.js). Checked again here because metadata arrives
  -- straight from the auth request and a trigger is the last place that can
  -- refuse a name the rest of the app assumes is well-formed.
  if v_username is null or v_username !~ '^[A-Za-z0-9_]{3,20}$' then
    v_username := 'Player';
  end if;

  insert into public.profiles (id, username) values (new.id, v_username);
  return new;
end;
$$;
