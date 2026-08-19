-- Per-user rate limits on the writes a script can abuse.
--
-- Nothing in the schema throttled anything before this. At nine players that
-- was theoretical; behind a public domain it is a bill and a moderation queue.
--
-- WHY TRIGGERS AND NOT THE RPCs. The abusable RPCs are long plpgsql bodies
-- (create_squad alone validates five arguments). Editing each one to add a
-- guard means re-issuing the whole body and risking a behaviour change in code
-- that works. A BEFORE INSERT trigger on the table each RPC writes costs one
-- small function, cannot alter the RPC's logic, and catches every path that
-- reaches the table rather than only the RPC we remembered.
--
-- WHY MATCHMAKING IS NOT IN HERE. join_queue IS the poll: js/main.js calls it
-- every ONLINE_QUEUE_POLL_MS (2s) for up to ONLINE_QUEUE_TIMEOUT_SECONDS (120s),
-- so a single search is ~60 calls, and its insert carries `on conflict do
-- update`, which still fires BEFORE INSERT triggers. Any budget low enough to
-- stop a flood would end matchmaking for real players. The queue's protection
-- is that it requires a session and holds one row per user; capping it properly
-- means counting search *sessions* server-side, which is a bigger change than
-- this one and is listed as remaining work rather than pretended to be done.

create table if not exists public.rpc_attempts (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists rpc_attempts_lookup_idx
  on public.rpc_attempts (user_id, action, attempted_at desc);

-- No policies on purpose: every read and write goes through the SECURITY
-- DEFINER function below, and nothing client-side has any business reading
-- another player's attempt history.
alter table public.rpc_attempts enable row level security;
revoke all on public.rpc_attempts from anon, authenticated;

-- Records one attempt for the current user and raises if they are over budget
-- in the trailing window. Returns nothing; it is called for its effect.
--
-- A null auth.uid() means the write came from the service role or a server-side
-- trigger rather than a browser, so it is not throttled - the Edge Function and
-- the seed jobs are not the threat model.
create or replace function public.enforce_rate_limit(
  p_action text, p_max integer, p_window interval, p_message text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then return; end if;

  select count(*) into v_count
    from public.rpc_attempts
   where user_id = v_uid
     and action = p_action
     and attempted_at > now() - p_window;

  if v_count >= p_max then
    raise exception '%', p_message using errcode = 'P0001';
  end if;

  insert into public.rpc_attempts (user_id, action) values (v_uid, p_action);

  -- Opportunistic prune, so the table stays a rolling window rather than a log.
  delete from public.rpc_attempts
   where user_id = v_uid and attempted_at < now() - interval '1 day';
end;
$$;

revoke all on function public.enforce_rate_limit(text,integer,interval,text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Friend requests: the one abusable action that reaches ANOTHER player.
-- ---------------------------------------------------------------------------

create or replace function public.rate_limit_friend_requests()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enforce_rate_limit(
    'friend_request', 20, interval '1 hour',
    'You have sent a lot of friend requests just now. Try again in a little while.'
  );
  return new;
end;
$$;

drop trigger if exists rate_limit_friend_requests on public.friendships;
create trigger rate_limit_friend_requests
  before insert on public.friendships
  for each row execute function public.rate_limit_friend_requests();

-- ---------------------------------------------------------------------------
-- Squad creation: cheap for a script, permanent for everyone browsing squads.
-- ---------------------------------------------------------------------------

create or replace function public.rate_limit_squad_creation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enforce_rate_limit(
    'create_squad', 5, interval '1 hour',
    'You have created several squads recently. Try again in an hour.'
  );
  return new;
end;
$$;

drop trigger if exists rate_limit_squad_creation on public.squads;
create trigger rate_limit_squad_creation
  before insert on public.squads
  for each row execute function public.rate_limit_squad_creation();

-- ---------------------------------------------------------------------------
-- Squad chat: 20 a minute is faster than anyone types and slower than a flood.
-- ---------------------------------------------------------------------------

create or replace function public.rate_limit_squad_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enforce_rate_limit(
    'squad_message', 20, interval '1 minute',
    'You are sending messages too quickly. Give it a moment.'
  );
  return new;
end;
$$;

drop trigger if exists rate_limit_squad_messages on public.squad_messages;
create trigger rate_limit_squad_messages
  before insert on public.squad_messages
  for each row execute function public.rate_limit_squad_messages();
