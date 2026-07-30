-- Squads: player-run clans. One squad per player at a time. Every write
-- that isn't plain chat goes through a SECURITY DEFINER RPC rather than a
-- direct table write - membership caps, one-squad-per-player, and who's
-- allowed to kick/promote whom are all enforced server-side, the same way
-- simulate-match owns online_wins/online_losses instead of trusting the
-- client.

create table public.squads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 30),
  tag text not null check (tag ~ '^[A-Za-z0-9]{2,5}$'),
  emoji text not null default '🏀',
  motto text not null default '' check (char_length(motto) <= 120),
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  member_cap integer not null default 30 check (member_cap between 2 and 50),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create unique index squads_name_lower_idx on public.squads (lower(name));
create unique index squads_tag_lower_idx on public.squads (lower(tag));

create table public.squad_members (
  squad_id uuid not null references public.squads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('leader', 'co-leader', 'member')),
  joined_at timestamptz not null default now(),
  primary key (squad_id, user_id)
);

-- One squad per player at a time, mirroring Clash Royale's one-clan rule -
-- keeps roster/rep math simple (no double-counting a player in two squads).
create unique index squad_members_one_per_user on public.squad_members (user_id);

create table public.squad_messages (
  id bigint generated always as identity primary key,
  squad_id uuid not null references public.squads(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  username text not null,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);

create index squad_messages_squad_created_idx on public.squad_messages (squad_id, created_at);

-- Invite codes live in their own table with NO client-facing RLS policies at
-- all (RLS enabled, zero policies = default deny) - only the SECURITY
-- DEFINER functions below can read or write one. A private squad's code is
-- the actual access control, so it must never be selectable through a
-- general "squads are public" style policy the way squad metadata is.
create table public.squad_invite_codes (
  squad_id uuid primary key references public.squads(id) on delete cascade,
  code text not null unique
);

alter table public.squads enable row level security;
alter table public.squad_members enable row level security;
alter table public.squad_messages enable row level security;
alter table public.squad_invite_codes enable row level security;

-- ---- RLS helpers (SECURITY DEFINER, so a policy can check membership/role
-- without needing its own policy on squad_members to already be resolved) --

create or replace function public.squad_role(p_squad_id uuid, p_user_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.squad_members where squad_id = p_squad_id and user_id = p_user_id;
$$;

create or replace function public.is_squad_member(p_squad_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.squad_members where squad_id = p_squad_id and user_id = p_user_id);
$$;

create or replace function public.squad_is_public(p_squad_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select visibility = 'public' from public.squads where id = p_squad_id;
$$;

-- ---- RLS policies -----------------------------------------------------

-- squads: metadata is visible to the world for public squads (browsable),
-- but a private squad is invisible to anyone who isn't already a member -
-- same "you need the invite to even see it" model as a real private clan.
create policy "public squads and own squad are readable" on public.squads
  for select using (visibility = 'public' or public.is_squad_member(id, auth.uid()));

-- squad_members: a public squad's roster is a public leaderboard; a private
-- squad's roster is members-only. No client-side insert/update/delete -
-- every membership change goes through an RPC.
create policy "rosters follow squad visibility" on public.squad_members
  for select using (public.squad_is_public(squad_id) or public.is_squad_member(squad_id, auth.uid()));

-- squad_messages: members-only in both directions. Chat is low-stakes
-- enough to allow a direct client insert rather than routing through an RPC.
create policy "members read squad chat" on public.squad_messages
  for select using (public.is_squad_member(squad_id, auth.uid()));

create policy "members post squad chat" on public.squad_messages
  for insert with check (user_id = auth.uid() and public.is_squad_member(squad_id, auth.uid()));

-- ---- RPCs --------------------------------------------------------------

create or replace function public.gen_squad_invite_code()
returns text language sql volatile as $$
  select upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
$$;

create or replace function public.create_squad(p_name text, p_tag text, p_emoji text, p_motto text, p_visibility text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_squad_id uuid;
  v_code text;
  v_visibility text := coalesce(p_visibility, 'public');
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if v_visibility not in ('public', 'private') then
    raise exception 'Visibility must be public or private.';
  end if;
  if exists (select 1 from public.squad_members where user_id = auth.uid()) then
    raise exception 'You''re already in a squad - leave it first.';
  end if;

  begin
    insert into public.squads (name, tag, emoji, motto, visibility, created_by)
    values (trim(p_name), trim(p_tag), coalesce(nullif(trim(p_emoji), ''), '🏀'), coalesce(p_motto, ''), v_visibility, auth.uid())
    returning id into v_squad_id;
  exception when unique_violation then
    raise exception 'That squad name or tag is already taken.';
  end;

  insert into public.squad_members (squad_id, user_id, role) values (v_squad_id, auth.uid(), 'leader');

  v_code := public.gen_squad_invite_code();
  for i in 1..5 loop
    begin
      insert into public.squad_invite_codes (squad_id, code) values (v_squad_id, v_code);
      exit;
    exception when unique_violation then
      v_code := public.gen_squad_invite_code();
    end;
  end loop;

  return v_squad_id;
end;
$$;

create or replace function public.join_public_squad(p_squad_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_squad record;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  select * into v_squad from public.squads where id = p_squad_id;
  if not found then
    raise exception 'Squad not found.';
  end if;
  if v_squad.visibility <> 'public' then
    raise exception 'This squad is private - you need an invite code.';
  end if;
  if exists (select 1 from public.squad_members where user_id = auth.uid()) then
    raise exception 'You''re already in a squad - leave it first.';
  end if;
  select count(*) into v_count from public.squad_members where squad_id = p_squad_id;
  if v_count >= v_squad.member_cap then
    raise exception 'That squad is full.';
  end if;
  insert into public.squad_members (squad_id, user_id, role) values (p_squad_id, auth.uid(), 'member');
end;
$$;

create or replace function public.join_squad_by_code(p_code text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_squad_id uuid;
  v_cap integer;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  select squad_id into v_squad_id from public.squad_invite_codes where upper(code) = upper(trim(p_code));
  if v_squad_id is null then
    raise exception 'Invalid invite code.';
  end if;
  if exists (select 1 from public.squad_members where user_id = auth.uid()) then
    raise exception 'You''re already in a squad - leave it first.';
  end if;
  select member_cap into v_cap from public.squads where id = v_squad_id;
  select count(*) into v_count from public.squad_members where squad_id = v_squad_id;
  if v_count >= v_cap then
    raise exception 'That squad is full.';
  end if;
  insert into public.squad_members (squad_id, user_id, role) values (v_squad_id, auth.uid(), 'member');
  return v_squad_id;
end;
$$;

-- Leaving as leader auto-promotes the longest-serving co-leader (or, absent
-- one, the longest-serving member) rather than blocking the leave - a squad
-- should never be left leaderless just because someone wants out. If the
-- leader is the last member, the squad disbands with them.
create or replace function public.leave_squad()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_squad_id uuid;
  v_role text;
  v_successor uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  select squad_id, role into v_squad_id, v_role from public.squad_members where user_id = auth.uid();
  if v_squad_id is null then
    raise exception 'You''re not in a squad.';
  end if;

  if v_role = 'leader' then
    select user_id into v_successor from public.squad_members
      where squad_id = v_squad_id and user_id <> auth.uid()
      order by (role = 'co-leader') desc, joined_at asc
      limit 1;
    if v_successor is null then
      delete from public.squads where id = v_squad_id;
      return;
    end if;
    update public.squad_members set role = 'leader' where squad_id = v_squad_id and user_id = v_successor;
  end if;

  delete from public.squad_members where squad_id = v_squad_id and user_id = auth.uid();
end;
$$;

create or replace function public.kick_squad_member(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_caller_squad uuid;
  v_caller_role text;
  v_target_squad uuid;
  v_target_role text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  select squad_id, role into v_caller_squad, v_caller_role from public.squad_members where user_id = auth.uid();
  if v_caller_squad is null or v_caller_role = 'member' then
    raise exception 'Only a leader or co-leader can remove members.';
  end if;
  select squad_id, role into v_target_squad, v_target_role from public.squad_members where user_id = p_user_id;
  if v_target_squad is distinct from v_caller_squad then
    raise exception 'That player is not in your squad.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Use Leave Squad instead.';
  end if;
  if v_target_role = 'leader' then
    raise exception 'The leader can''t be removed - transfer leadership first.';
  end if;
  if v_caller_role = 'co-leader' and v_target_role = 'co-leader' then
    raise exception 'Co-leaders can''t remove other co-leaders - ask the leader.';
  end if;
  delete from public.squad_members where user_id = p_user_id;
end;
$$;

-- Promote/demote between member and co-leader. Leadership itself only moves
-- via transfer_squad_leadership, so there's always exactly one leader.
create or replace function public.set_squad_member_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_caller_squad uuid;
  v_caller_role text;
  v_target_squad uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if p_role not in ('co-leader', 'member') then
    raise exception 'Invalid role.';
  end if;
  select squad_id, role into v_caller_squad, v_caller_role from public.squad_members where user_id = auth.uid();
  if v_caller_role <> 'leader' then
    raise exception 'Only the leader can change roles.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Use Transfer Leadership to change your own role.';
  end if;
  select squad_id into v_target_squad from public.squad_members where user_id = p_user_id;
  if v_target_squad is distinct from v_caller_squad then
    raise exception 'That player is not in your squad.';
  end if;
  update public.squad_members set role = p_role where user_id = p_user_id;
end;
$$;

create or replace function public.transfer_squad_leadership(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_caller_squad uuid;
  v_caller_role text;
  v_target_squad uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  select squad_id, role into v_caller_squad, v_caller_role from public.squad_members where user_id = auth.uid();
  if v_caller_role <> 'leader' then
    raise exception 'Only the leader can transfer leadership.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You''re already the leader.';
  end if;
  select squad_id into v_target_squad from public.squad_members where user_id = p_user_id;
  if v_target_squad is distinct from v_caller_squad then
    raise exception 'That player is not in your squad.';
  end if;
  update public.squad_members set role = 'co-leader' where user_id = auth.uid();
  update public.squad_members set role = 'leader' where user_id = p_user_id;
end;
$$;

create or replace function public.get_squad_invite_code()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_squad_id uuid;
  v_role text;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  select squad_id, role into v_squad_id, v_role from public.squad_members where user_id = auth.uid();
  if v_squad_id is null or v_role = 'member' then
    raise exception 'Only a leader or co-leader can view the invite code.';
  end if;
  select code into v_code from public.squad_invite_codes where squad_id = v_squad_id;
  if v_code is null then
    v_code := public.gen_squad_invite_code();
    insert into public.squad_invite_codes (squad_id, code) values (v_squad_id, v_code);
  end if;
  return v_code;
end;
$$;

create or replace function public.regenerate_squad_invite_code()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_squad_id uuid;
  v_role text;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  select squad_id, role into v_squad_id, v_role from public.squad_members where user_id = auth.uid();
  if v_squad_id is null or v_role = 'member' then
    raise exception 'Only a leader or co-leader can regenerate the invite code.';
  end if;
  v_code := public.gen_squad_invite_code();
  for i in 1..5 loop
    begin
      update public.squad_invite_codes set code = v_code where squad_id = v_squad_id;
      exit;
    exception when unique_violation then
      v_code := public.gen_squad_invite_code();
    end;
  end loop;
  return v_code;
end;
$$;

create or replace function public.update_squad_settings(p_emoji text, p_motto text, p_visibility text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_squad_id uuid;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  select squad_id, role into v_squad_id, v_role from public.squad_members where user_id = auth.uid();
  if v_squad_id is null or v_role = 'member' then
    raise exception 'Only a leader or co-leader can change squad settings.';
  end if;
  if p_visibility is not null and p_visibility not in ('public', 'private') then
    raise exception 'Visibility must be public or private.';
  end if;
  update public.squads set
    emoji = coalesce(nullif(trim(p_emoji), ''), emoji),
    motto = coalesce(p_motto, motto),
    visibility = coalesce(p_visibility, visibility)
    where id = v_squad_id;
end;
$$;

create or replace function public.disband_squad()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_squad_id uuid;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  select squad_id, role into v_squad_id, v_role from public.squad_members where user_id = auth.uid();
  if v_role <> 'leader' then
    raise exception 'Only the leader can disband the squad.';
  end if;
  delete from public.squads where id = v_squad_id;
end;
$$;
