-- Friends: a private request/accept relationship between two players (not
-- a public leaderboard-style read like squad rosters - who's friends with
-- whom isn't anyone else's business). One row per pair regardless of who
-- sent the request, enforced by a unique index on the sorted pair.
create table public.friendships (
  id bigint generated always as identity primary key,
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);

create unique index friendships_pair_idx on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

alter table public.friendships enable row level security;

create policy "participants read their friendship" on public.friendships
  for select using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- No direct client insert/update/delete - every state change goes through
-- an RPC below, same reasoning as squads.

create or replace function public.send_friend_request(p_username text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_target uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  select id into v_target from public.profiles where lower(username) = lower(trim(p_username));
  if v_target is null then
    raise exception 'No player with that username.';
  end if;
  if v_target = auth.uid() then
    raise exception 'You can''t friend yourself.';
  end if;
  if exists (
    select 1 from public.friendships
    where least(requester_id, addressee_id) = least(auth.uid(), v_target)
      and greatest(requester_id, addressee_id) = greatest(auth.uid(), v_target)
  ) then
    raise exception 'You''re already friends or have a pending request with them.';
  end if;
  insert into public.friendships (requester_id, addressee_id) values (auth.uid(), v_target);
end;
$$;

create or replace function public.accept_friend_request(p_requester_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  update public.friendships
    set status = 'accepted', responded_at = now()
    where requester_id = p_requester_id and addressee_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'No pending request from that player.';
  end if;
end;
$$;

-- Also used to cancel a request you sent, not just decline one you received -
-- either side of a still-pending row can remove it.
create or replace function public.decline_friend_request(p_requester_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  delete from public.friendships
    where requester_id = p_requester_id and addressee_id = auth.uid() and status = 'pending';
  if not found then
    delete from public.friendships
      where requester_id = auth.uid() and addressee_id = p_requester_id and status = 'pending';
  end if;
end;
$$;

create or replace function public.remove_friend(p_friend_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  delete from public.friendships
    where status = 'accepted'
      and ((requester_id = auth.uid() and addressee_id = p_friend_id)
        or (requester_id = p_friend_id and addressee_id = auth.uid()));
end;
$$;

-- "Challenge a friend to a 1v1" - reuses the exact same matches/drafting/
-- simulate-match pipeline regular matchmaking uses, just created directly
-- (bypassing matchmaking_queue's random pairing) between two specific
-- friends. is_friendly marks it so simulate-match skips online_wins/
-- online_losses for it - "for fun" means not rank-affecting, and it closes
-- off the obvious two-friends-feed-each-other-wins abuse a ranked version
-- would invite. The simulate-match Edge Function (not in this repo) was
-- updated separately to check this flag.
alter table public.matches add column is_friendly boolean not null default false;

create or replace view public.matches_public as
  select id, player_a, player_b, status, round_number, current_squad_team,
    current_squad_decade, used_squads, winner, created_at, updated_at, is_friendly
  from public.matches;

create or replace function public.challenge_friend(p_friend_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in required.';
  end if;
  if p_friend_id = v_uid then
    raise exception 'You can''t challenge yourself.';
  end if;
  if not exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = v_uid and addressee_id = p_friend_id)
        or (requester_id = p_friend_id and addressee_id = v_uid))
  ) then
    raise exception 'You can only challenge a friend.';
  end if;

  -- Reuse an existing open match between exactly these two rather than
  -- stacking duplicates if Challenge gets tapped twice.
  select id into v_match_id from public.matches
    where status <> 'complete'
      and ((player_a = v_uid and player_b = p_friend_id) or (player_a = p_friend_id and player_b = v_uid));
  if v_match_id is not null then
    return v_match_id;
  end if;

  insert into public.matches (player_a, player_b, current_squad_team, current_squad_decade, round_number, is_friendly)
  select v_uid, p_friend_id, p.team, p.decade, 1, true
  from public.players p
  order by random()
  limit 1
  returning id into v_match_id;

  return v_match_id;
end;
$$;
