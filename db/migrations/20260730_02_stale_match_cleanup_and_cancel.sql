-- Fixes "searching for a match dumps you into an old abandoned draft
-- instead of actually matchmaking": join_queue's "resume my existing
-- match" branch had no staleness check, so a match nobody had touched in
-- days (either side closed the tab mid-draft - there's no server-side
-- timeout, only a client-side pick timer that does nothing if the client
-- isn't open) got resurrected forever. Same latent bug existed in
-- challenge_friend, which additionally had no `order by ... limit 1` on
-- its lookup, so with more than one non-complete match between two
-- players it picked an arbitrary one (found while testing this fix).
--
-- Fix: a match untouched for 15+ minutes is treated as abandoned - it's
-- deleted (not carried forward; nothing worth keeping, since no stats are
-- recorded until simulate-match completes) and a real search/challenge
-- proceeds. 15 minutes is generous against the 30s pick timer real play
-- uses, so it never interrupts an actually-active draft.
--
-- Also adds cancel_match(), a SECURITY DEFINER RPC either participant can
-- call to leave a stuck non-complete match immediately rather than waiting
-- out the staleness window - wired to the draft screen's "Leave Match"
-- button (js/online.js's cancelMatch, js/main.js).

create or replace function public.join_queue(p_sport text default 'nba')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_opponent uuid;
  v_match_id uuid;
  v_match_updated timestamptz;
  v_sport text := coalesce(p_sport, 'nba');
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select id, updated_at into v_match_id, v_match_updated from public.matches
    where (player_a = v_uid or player_b = v_uid) and status <> 'complete' and sport = v_sport
    order by created_at desc limit 1;
  if v_match_id is not null then
    if v_match_updated > now() - interval '15 minutes' then
      return jsonb_build_object('status', 'matched', 'match_id', v_match_id);
    end if;
    delete from public.matches where id = v_match_id;
  end if;

  insert into public.matchmaking_queue (user_id, sport) values (v_uid, v_sport)
    on conflict (user_id) do update set joined_at = matchmaking_queue.joined_at, sport = v_sport;

  select user_id into v_opponent from public.matchmaking_queue
    where user_id <> v_uid and sport = v_sport
    order by joined_at asc
    for update skip locked
    limit 1;

  if v_opponent is null then
    return jsonb_build_object('status', 'waiting');
  end if;

  delete from public.matchmaking_queue where user_id in (v_uid, v_opponent);

  insert into public.matches (player_a, player_b, current_squad_team, current_squad_decade, round_number, sport)
  select v_uid, v_opponent, p.team, p.decade, 1, v_sport
  from public.players p
  order by random()
  limit 1
  returning id into v_match_id;

  return jsonb_build_object('status', 'matched', 'match_id', v_match_id);
end;
$$;

create or replace function public.challenge_friend(p_friend_id uuid, p_sport text default 'nba')
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match_id uuid;
  v_match_updated timestamptz;
  v_sport text := coalesce(p_sport, 'nba');
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

  select id, updated_at into v_match_id, v_match_updated from public.matches
    where status <> 'complete' and sport = v_sport
      and ((player_a = v_uid and player_b = p_friend_id) or (player_a = p_friend_id and player_b = v_uid))
    order by created_at desc limit 1;
  if v_match_id is not null then
    if v_match_updated > now() - interval '15 minutes' then
      return v_match_id;
    end if;
    delete from public.matches where id = v_match_id;
  end if;

  insert into public.matches (player_a, player_b, current_squad_team, current_squad_decade, round_number, is_friendly, sport)
  select v_uid, p_friend_id, p.team, p.decade, 1, true, v_sport
  from public.players p
  order by random()
  limit 1
  returning id into v_match_id;

  return v_match_id;
end;
$$;

create or replace function public.cancel_match(p_match_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
begin
  if v_uid is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if v_match.id is null then
    return;
  end if;
  if v_match.player_a <> v_uid and v_match.player_b <> v_uid then
    raise exception 'Not your match.';
  end if;
  if v_match.status = 'complete' then
    raise exception 'That match already finished.';
  end if;

  delete from public.matches where id = p_match_id;
end;
$$;

-- Applied alongside this migration (not part of it, since it's user data,
-- not schema): both non-complete matches live in the table at the time -
-- a several-day-old madams/dotch draft that this fix's root cause exactly
-- explains, and an unrelated week-old test-account draft - were deleted
-- directly, per an explicit "cancel any live games" request.
