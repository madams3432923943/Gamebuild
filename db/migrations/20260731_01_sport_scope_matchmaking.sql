-- Sport scoping for online play. Only NBA has a live engine/dataset today,
-- so every existing row defaults to 'nba' and nothing about current
-- behavior changes - this is groundwork for when a second sport (starting
-- with NFL) gets its own engine and player dataset, so matchmaking and
-- challenges never need to pair a player across sports. Deliberately NOT
-- adding a sport column to `players`: per-sport data is meant to live in
-- its own table/dataset once it exists, not share this one with a filter -
-- so this migration only touches the matchmaking/match tables, not players.
alter table public.matchmaking_queue add column sport text not null default 'nba';
alter table public.matches add column sport text not null default 'nba';

create or replace view public.matches_public as
  select id, player_a, player_b, status, round_number, current_squad_team,
    current_squad_decade, used_squads, winner, created_at, updated_at, is_friendly, sport
  from public.matches;

create or replace function public.join_queue(p_sport text default 'nba')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_opponent uuid;
  v_match_id uuid;
  v_sport text := coalesce(p_sport, 'nba');
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select id into v_match_id from public.matches
    where (player_a = v_uid or player_b = v_uid) and status <> 'complete' and sport = v_sport
    order by created_at desc limit 1;
  if v_match_id is not null then
    return jsonb_build_object('status', 'matched', 'match_id', v_match_id);
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

  select id into v_match_id from public.matches
    where status <> 'complete' and sport = v_sport
      and ((player_a = v_uid and player_b = p_friend_id) or (player_a = p_friend_id and player_b = v_uid));
  if v_match_id is not null then
    return v_match_id;
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
