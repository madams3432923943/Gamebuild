-- Ranked matchmaking dealt a player into a match whose opponent had left ten
-- minutes earlier. Two independent holes did it, and a third was one friend
-- challenge away.
--
-- 1. A DRAFT THAT CANNOT PROGRESS WAS TREATED AS ONE TO REJOIN.
--    20260730_02 made join_queue resume any non-complete match touched in the
--    last 15 minutes, so a reconnect puts you back in your own draft. That
--    window is right for a match that is merely quiet and wrong for one that is
--    over: when a pairing dies at the moment it is created - the client throws,
--    the tab closes, the network drops - the row stays behind and both players
--    are dealt back into it for the next quarter of an hour. Three madams/RS3
--    matches created seconds apart today, no picks in any of them, and the next
--    search resumed one.
--
--    A DRAFTING match is never legitimately quiet. Both clients run a 30-second
--    pick clock that auto-picks when it expires (js/main.js handleOnlineTimeout),
--    and submit_pick touches the match row, so two live players move updated_at
--    at least every ~35 seconds whether or not either of them does anything.
--    Two minutes of silence means at least one side is not running, and a draft
--    cannot advance on one side. Those are deleted and the search goes on.
--
--    The 15-minute window STAYS for every later status. It is not slack, it is
--    the strategy phase: rotation (120s), matchups and tactics (45s) write
--    nothing until the final submit_strategy, so a perfectly live match can sit
--    several minutes without touching its row.
--
--    Only the CALLER's own matches are swept, and only a caller who is asking
--    for a new match - a player inside a live draft never calls join_queue. So
--    this can never delete a draft out from under the person playing it; the
--    worst case is a player whose reconnect took longer than two minutes,
--    against a match their opponent had already been stuck in for just as long.
--
-- 2. A QUEUE ROW OUTLIVED THE CLIENT THAT WROTE IT. Nothing ever expired
--    matchmaking_queue. The client leaves the queue when a search ends
--    (leave_queue), which covers everything except the case that matters: the
--    tab that went away. RS3's row sat in the queue for seven minutes after
--    their session ended, and the next searcher would have paired with it.
--
--    A searching client calls join_queue every 2 seconds, so the row of a player
--    who is still looking is never more than a moment old. last_seen_at records
--    that heartbeat: only rows seen in the last 30 seconds can be paired with,
--    and older ones are pruned on the way past.
--
--    joined_at goes back to meaning what it says. It was being overwritten on
--    every poll, which left `order by joined_at asc` - the FIFO deciding who has
--    waited longest - ordering by nothing in particular. It is now preserved for
--    as long as a search runs, and reset only when a row comes back from the
--    dead or changes what it is searching for.
--
-- 3. A RANKED SEARCH COULD RESUME A FRIEND CHALLENGE. challenge_friend writes
--    is_friendly matches with game_mode 'ranked', and join_queue's lookup
--    filtered on sport/era/game_mode but not is_friendly. A challenge waiting
--    for a friend to open it is idle BY DESIGN (js/friends.js lists exactly
--    those), so a ranked search could swallow one - and rule 1 would then have
--    deleted it two minutes later. Both branches now ignore friendly matches;
--    the friends flow owns them.
--
-- Nothing is lost by deleting any of these. No stats exist until simulate-match
-- writes a result, which is also why cancel_match deletes rather than marks.

-- Existing rows take now() from the default, so any row already in the queue
-- when this ran looked alive for one more 30-second window before expiring.
-- That is the harmless direction, and the queue was empty at the time anyway.
alter table public.matchmaking_queue
  add column if not exists last_seen_at timestamptz not null default now();

comment on column public.matchmaking_queue.last_seen_at is
  'Heartbeat: bumped by every join_queue poll. A row not seen for 30s belongs '
  'to a client that is gone, and is pruned rather than paired with.';

comment on column public.matchmaking_queue.joined_at is
  'When this SEARCH began - the FIFO key. Preserved across polls; reset only '
  'when a stale row is reused, or the search changes sport/era/mode.';

-- No new index: matchmaking_scope_idx (sport, game_mode, era, joined_at) from
-- 20260805_02 already serves the pairing lookup, and last_seen_at is a filter
-- on a table that holds one row per searching player.

create or replace function public.join_queue(p_sport text, p_era text, p_game_mode text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  -- A search polls every 2s (ONLINE_QUEUE_POLL_MS). Fifteen missed polls is a
  -- tab that closed, not a slow network.
  c_queue_stale constant interval := interval '30 seconds';
  -- Two live clients touch a drafting match every ~35s through the pick clock.
  c_draft_stale constant interval := interval '2 minutes';
  -- The strategy phase writes nothing for minutes at a time and is still live.
  -- Unchanged from 20260730_02.
  c_resume_window constant interval := interval '15 minutes';

  v_uid uuid := auth.uid();
  v_opponent uuid;
  v_match_id uuid;
  v_sport text := coalesce(nullif(trim(p_sport), ''), 'nba');
  v_era text := coalesce(nullif(trim(p_era), ''), 'all');
  v_mode text := coalesce(nullif(trim(p_game_mode), ''), 'ranked');
  v_team text;
  v_group text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.online_game_modes
    where sport = v_sport and game_mode = v_mode and matchmaking_enabled
  ) then
    raise exception 'online mode %/% is not enabled', v_sport, v_mode;
  end if;

  -- Dead matches first, across every sport and era rather than only the one
  -- being searched: a player who collected three of them (see above) should not
  -- have to search three times to clear them.
  delete from public.matches m
   where (m.player_a = v_uid or m.player_b = v_uid)
     and m.status <> 'complete'
     and not m.is_friendly
     and m.updated_at < now() - case
           when m.status = 'drafting' then c_draft_stale
           else c_resume_window
         end;

  -- Whatever survived is either a draft still moving or a pairing young enough
  -- that the other side may still be arriving.
  select id into v_match_id
  from public.matches
  where (player_a = v_uid or player_b = v_uid)
    and status <> 'complete'
    and not is_friendly
    and sport = v_sport and era = v_era and game_mode = v_mode
  order by created_at desc limit 1;

  if v_match_id is not null then
    return jsonb_build_object('status', 'matched', 'match_id', v_match_id);
  end if;

  -- Nobody is paired with a client that stopped calling.
  delete from public.matchmaking_queue where last_seen_at < now() - c_queue_stale;

  insert into public.matchmaking_queue (user_id, sport, era, game_mode)
  values (v_uid, v_sport, v_era, v_mode)
  on conflict (user_id) do update
  set last_seen_at = now(),
      sport = v_sport, era = v_era, game_mode = v_mode,
      -- A search that is still running keeps its place in line; one that had
      -- gone stale, or has switched sport/era/mode, starts a fresh wait.
      joined_at = case
        when public.matchmaking_queue.last_seen_at < now() - c_queue_stale
          or public.matchmaking_queue.sport <> v_sport
          or public.matchmaking_queue.era <> v_era
          or public.matchmaking_queue.game_mode <> v_mode
        then now() else public.matchmaking_queue.joined_at
      end;

  select user_id into v_opponent
  from public.matchmaking_queue
  where user_id <> v_uid
    and sport = v_sport and era = v_era and game_mode = v_mode
    and last_seen_at > now() - c_queue_stale
  order by joined_at asc
  for update skip locked
  limit 1;

  if v_opponent is null then
    return jsonb_build_object('status', 'waiting');
  end if;

  delete from public.matchmaking_queue where user_id in (v_uid, v_opponent);

  select s.out_team, s.out_era into v_team, v_group
  from public.next_draft_squad(v_sport, v_era, array[]::text[]) s;

  if v_team is null then raise exception 'no draft squads available for %/%/%', v_sport, v_mode, v_era; end if;

  insert into public.matches (
    player_a, player_b, current_squad_team, current_squad_decade,
    round_number, sport, era, game_mode, used_squads
  ) values (
    v_uid, v_opponent, v_team, v_group,
    1, v_sport, v_era, v_mode, array[v_team || '|' || v_group]
  ) returning id into v_match_id;

  return jsonb_build_object('status', 'matched', 'match_id', v_match_id);
end;
$$;

-- The three older overloads are already thin wrappers around this body, so they
-- inherit all of it. `create or replace` keeps the grants the 20260819_01 sweep
-- re-issued; re-stated here so this file is honest read on its own.
grant execute on function public.join_queue(text,text,text) to authenticated;

-- Applied alongside this migration, not part of it - user data, not schema. The
-- four open matches these rules would have reaped were deleted directly rather
-- than left to be cleared lazily on each player's next search: the two
-- madams/RS3 pairings from 02:27 today, a dotch/judge34 one from three days ago
-- (all three still on round 1 with no picks at all), and an eight-day-old nba
-- match stuck in 'strategy'. Every completed match was left alone.

-- Verified against the live database, each step rolled back: a first poll
-- waits; a second player pairs; the first resumes the same match while it is
-- fresh; five minutes idle in 'drafting' deletes it and returns to waiting; a
-- ten-minute-old queue row is pruned instead of paired with; and a friendly
-- challenge between the same two players is left untouched.
