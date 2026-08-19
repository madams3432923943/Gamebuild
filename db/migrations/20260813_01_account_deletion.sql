-- BACKFILL. Applied live on 2026-08-13 as `account_deletion`; this file was
-- written on 2026-08-19 from the live definition, not the other way round. It
-- is here because db/ is meant to be the record of what was applied and this
-- was missing from it entirely - see scripts/verify-schema-documented.mjs,
-- which now fails when that happens again.
--
-- Deleting an account is not one DELETE. Rows belong to other people too: a
-- squad someone else is still in cannot vanish because its leader left, and a
-- conversation other players took part in should not develop holes. So the
-- order below is deliberate.
--
--   1. Messages stay, reattributed. Deleting them would edit other people's
--      chat history.
--   2. A squad this player LEADS gets a successor - co-leader first, then the
--      longest-serving member. Only a squad with nobody else in it is deleted.
--   3. Unfinished matches go, since the opponent cannot play them out.
--      COMPLETED matches stay: the other player's record depends on them, and
--      a ladder you can edit by leaving is not a ladder.
--   4. The auth row goes last, and the cascade takes the profile with it.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_squad_id uuid;
  v_successor uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  update public.squad_messages
     set username = 'Deleted player'
   where user_id = v_uid;

  select squad_id into v_squad_id
    from public.squad_members
   where user_id = v_uid and role = 'leader';

  if v_squad_id is not null then
    select user_id into v_successor
      from public.squad_members
     where squad_id = v_squad_id and user_id <> v_uid
     order by case role when 'co-leader' then 0 else 1 end, joined_at
     limit 1;

    if v_successor is null then
      delete from public.squads where id = v_squad_id;
    else
      update public.squad_members set role = 'leader'
       where squad_id = v_squad_id and user_id = v_successor;
    end if;
  end if;

  delete from public.matches
   where (player_a = v_uid or player_b = v_uid)
     and status <> 'complete';

  delete from public.matchmaking_queue where user_id = v_uid;
  delete from public.presence where user_id = v_uid;

  delete from auth.users where id = v_uid;
end;
$$;

-- Granted in the manifest at db/migrations/20260819_01, not here: every
-- SECURITY DEFINER grant lives in one place so the set can be read at a glance.
