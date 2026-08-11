-- The http extension lives in the extensions schema, while migration helper
-- functions intentionally run with search_path=public. Expose one tightly
-- scoped wrapper there so the NFL generated-data sync can fetch its source.
create or replace function public.http_get(uri text)
returns extensions.http_response
language sql
security definer
set search_path = public, extensions
as $$
  select extensions.http_get(uri::varchar);
$$;

revoke all on function public.http_get(text) from public, anon, authenticated;
grant execute on function public.http_get(text) to service_role;

-- Older repository migrations created an nfl_players shell before the real
-- generated dataset existed. On a fresh database those migrations run before
-- the online migration, so reconcile that shell here rather than assuming the
-- table is absent. The old uniqueness rule (name, team, era) cannot represent
-- player-seasons and must be removed before the exact generated rows are loaded.
do $$
begin
  if to_regclass('public.nfl_players') is not null then
    alter table public.nfl_players add column if not exists season integer;
    alter table public.nfl_players add column if not exists payload jsonb;
    alter table public.nfl_players add column if not exists kind text not null default 'player';
    alter table public.nfl_players add column if not exists unit_group text;
    alter table public.nfl_players drop constraint if exists nfl_players_name_team_era_key;
  end if;
end;
$$;
