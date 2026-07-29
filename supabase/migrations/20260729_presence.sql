-- Presence: the "N players online" ticker.
--
-- One row per browser, refreshed by a heartbeat. Signed-out visitors count
-- too, so the key is a client-generated id rather than auth.uid() - which
-- also means one browser counts once however often it beats.
--
-- Everything goes through heartbeat_presence(): the table itself has RLS on
-- with no policies, so the anon role can never read or write it directly.
-- That keeps the definition of "online" (the freshness window) server-side
-- and stops the raw id list from being enumerable.

create table if not exists public.presence (
  client_id   text primary key,
  user_id     uuid references auth.users (id) on delete set null,
  last_seen   timestamptz not null default now()
);

create index if not exists presence_last_seen_idx on public.presence (last_seen desc);

alter table public.presence enable row level security;

-- Window a heartbeat stays "live" for. Comfortably longer than the client's
-- 25s heartbeat so a browser between beats doesn't flicker out of the count.
create or replace function public.heartbeat_presence(p_client_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_online integer;
begin
  if p_client_id is null or length(p_client_id) not between 8 and 64 then
    raise exception 'invalid client id';
  end if;

  insert into public.presence (client_id, user_id, last_seen)
  values (p_client_id, auth.uid(), now())
  on conflict (client_id)
  do update set last_seen = now(), user_id = excluded.user_id;

  -- Opportunistic cleanup. Rows older than an hour can never be counted
  -- again, and sweeping here avoids needing a scheduled job for a table
  -- this small.
  delete from public.presence where last_seen < now() - interval '1 hour';

  select count(*) into v_online
  from public.presence
  where last_seen > now() - interval '75 seconds';

  return v_online;
end;
$$;

revoke all on function public.heartbeat_presence(text) from public;
grant execute on function public.heartbeat_presence(text) to anon, authenticated;

-- RLS with no policies already blocks every row, but Supabase's default
-- grants still leave the table addressable by anon/authenticated. Revoking
-- them makes heartbeat_presence() the only door in.
revoke all on table public.presence from anon, authenticated;
