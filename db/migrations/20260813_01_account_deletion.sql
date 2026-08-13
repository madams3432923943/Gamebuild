-- Account deletion, self-serve.
--
-- The privacy policy promises that a player can delete their account and
-- everything attached to it. A promise with no mechanism behind it is worse
-- than no promise, so this is the mechanism.
--
-- Deleting the auth.users row is the only deletion that is actually complete -
-- it takes the email address and the password hash with it, and profiles,
-- squad_members, friendships and matchmaking_queue already cascade from it.
-- Three foreign keys did NOT, and would have blocked the delete outright:
-- matches.player_a/player_b, squads.created_by and squad_messages.user_id.
--
-- Those three are repointed to ON DELETE SET NULL rather than CASCADE on
-- purpose. Cascading would delete shared history that belongs to someone else
-- as much as to the leaver: an opponent's completed match, a squad the leaver
-- happened to found, a conversation other people took part in. Nulling the
-- reference removes the person while leaving the other party's record intact,
-- which is what "delete my data" means and what data-minimisation asks for.

-- ---- 1. Make the shared-history references nullable ----

alter table public.matches alter column player_a drop not null;
alter table public.matches alter column player_b drop not null;
alter table public.matches drop constraint matches_player_a_fkey;
alter table public.matches drop constraint matches_player_b_fkey;
alter table public.matches
  add constraint matches_player_a_fkey foreign key (player_a) references auth.users(id) on delete set null;
alter table public.matches
  add constraint matches_player_b_fkey foreign key (player_b) references auth.users(id) on delete set null;

alter table public.squads alter column created_by drop not null;
alter table public.squads drop constraint squads_created_by_fkey;
alter table public.squads
  add constraint squads_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;

alter table public.squad_messages alter column user_id drop not null;
alter table public.squad_messages drop constraint squad_messages_user_id_fkey;
alter table public.squad_messages
  add constraint squad_messages_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

-- ---- 2. The deletion itself ----
--
-- SECURITY DEFINER because auth.users is not writable by the authenticated
-- role, and deliberately takes NO arguments: the account deleted is always
-- auth.uid(), so there is no parameter a modified client could point at
-- somebody else's account.

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

  -- Squad chat outlives the sender, so the name attached to it has to go
  -- separately - user_id is about to become null on its own, but username is
  -- a denormalised copy that no foreign key reaches.
  update public.squad_messages
     set username = 'Deleted player'
   where user_id = v_uid;

  -- A squad whose only leader leaves is a squad nobody can administer. Hand
  -- it to the longest-serving remaining member; if there is nobody left, the
  -- squad goes with them (members, messages and invite code all cascade).
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

  -- An unfinished match with a missing player can never finish, and would
  -- leave the opponent stuck on a draft screen waiting for a pick that is
  -- never coming. Completed matches stay: they are the opponent's record too.
  delete from public.matches
   where (player_a = v_uid or player_b = v_uid)
     and status <> 'complete';

  delete from public.matchmaking_queue where user_id = v_uid;
  delete from public.presence where user_id = v_uid;

  -- Takes the email, the password hash, the sessions, and by cascade the
  -- profile, squad membership and friendships.
  delete from auth.users where id = v_uid;
end;
$$;

-- Default-deny, then grant exactly one role - the same pattern as the other
-- SECURITY DEFINER functions in this schema.
revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

comment on function public.delete_own_account() is
  'Deletes the calling user''s account and personal data. Shared history (completed matches, squad chat) is retained with the personal reference removed. See legal/privacy.html.';
