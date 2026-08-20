-- PUBLISHING THE DATASET WITHOUT EMPTYING THE TABLE FIRST.
--
-- THE PROBLEM
--
-- db/seed/*.sql is generated as `delete from <table>; insert ...; insert ...`
-- across ~30 chunked statements, and tools/apply-seed.mjs sends each one to the
-- Management API separately. The API runs every call on its own connection, so
-- the begin/commit the generator writes is stripped - it would only leave an
-- open transaction that never commits. tools/export-nfl-sql.mjs says this in
-- its own header: the delete commits alone, and the table is EMPTY from then
-- until the last insert lands, about a minute later.
--
-- That was survivable while seeding was a manual act somebody performed at a
-- quiet moment. It stops being survivable the moment the seed runs
-- automatically on every push that touches data/ - which is the change this
-- migration exists to enable. An online match started in that window finds no
-- players at all, and every rating in the engine is a percentile against the
-- pool it was computed from, so "no pool" does not throw: it rates everything
-- neutral and produces a plausible, wrong game. That is exactly the failure
-- scripts/verify-server-dataset.mjs was written for.
--
-- WHY NOT A RENAME SWAP
--
-- tools/export-nfl-sql.mjs recommends loading into a second table and swapping
-- it in with a rename. That advice is wrong here, and this migration is where
-- the correction belongs. `nfl_players` is read by name inside plpgsql RPCs -
-- roll_squad, make_pick's validation, the challenge flows - and plpgsql caches
-- query plans against the table's OID, not its name. A rename leaves every
-- warm session pointing at the OLD table, which after the swap still exists
-- and still holds the previous dataset. Nothing errors; some sessions simply
-- keep drafting from last week's pool until they reconnect.
--
-- WHAT THIS DOES INSTEAD
--
-- One staging table per live sport, and one function per sport that moves
-- staging into live. The chunked inserts - the slow part, the part that has to
-- be many statements - go into staging, where nothing reads them and an empty
-- table means nothing. The publish is then a SINGLE statement, so it gets a
-- single implicit transaction: the live table goes from the old dataset to the
-- new one with no observable state in between, and a failure anywhere inside
-- rolls back to the old dataset rather than to nothing.

-- ---------------------------------------------------------------------------
-- Staging tables.
--
-- Deliberately NOT copies of the live tables. They carry the seeded columns
-- only - no identity column (the generated SQL supplies no id and `generated
-- always` would reject one), no created_at, no constraints. A staging row is
-- in flight, not a record; the live table's constraints are what decide whether
-- it is acceptable, and they run at publish time where a violation aborts the
-- whole swap.

create table if not exists public.players_staging (
  name text not null,
  team text not null,
  decade text not null,
  season integer,
  pos text[] not null,
  ppg numeric, rpg numeric, apg numeric, spg numeric, bpg numeric, tov numeric,
  fga numeric, fgp numeric, tpa numeric, tpp numeric, fta numeric, ftp numeric
);

create table if not exists public.nfl_players_staging (
  kind text not null,
  unit_group text,
  name text not null,
  team text not null,
  era text not null,
  season integer,
  pos text[] not null,
  payload jsonb not null
);

-- RLS on with NO policy, and no grants. The live pools are deliberately public
-- - the draft is not secret and the client renders squads straight out of them
-- - but a staging table is a half-loaded artifact that should never be visible
-- to anyone. Without this it would be readable through PostgREST like any other
-- public table, and a client could draft from a pool that is mid-write.
-- service_role and the definer functions below bypass RLS; nothing else gets in.

alter table public.players_staging enable row level security;
alter table public.nfl_players_staging enable row level security;

revoke all on public.players_staging from public, anon, authenticated;
revoke all on public.nfl_players_staging from public, anon, authenticated;

comment on table public.players_staging is
  'Write buffer for the NBA dataset publish. Filled by db/seed/players-seed.sql, drained by publish_players_from_staging(). Never read directly - it is empty or half-loaded most of the time.';
comment on table public.nfl_players_staging is
  'Write buffer for the NFL dataset publish. Filled by db/seed/nfl-seed.sql, drained by publish_nfl_players_from_staging(). Never read directly - it is empty or half-loaded most of the time.';

-- ---------------------------------------------------------------------------
-- The publish, one statement per sport.
--
-- Each returns the live row count so the caller has something to assert on
-- rather than trusting an HTTP 200. Both refuse an empty staging table: the
-- overwhelmingly likely cause is a seed run that failed partway, and replacing
-- a good dataset with nothing is the one outcome worse than not publishing.

create or replace function public.publish_players_from_staging()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staged integer;
  v_live integer;
begin
  select count(*) into v_staged from public.players_staging;
  if v_staged = 0 then
    raise exception 'players_staging is empty - refusing to replace the live pool with nothing';
  end if;

  delete from public.players;
  insert into public.players
    (name, team, decade, season, pos, ppg, rpg, apg, spg, bpg, tov, fga, fgp, tpa, tpp, fta, ftp)
  select
     name, team, decade, season, pos, ppg, rpg, apg, spg, bpg, tov, fga, fgp, tpa, tpp, fta, ftp
  from public.players_staging;

  select count(*) into v_live from public.players;
  -- Emptied on the way out rather than on the way in: leaving ~1MB of rows
  -- lying around invites someone to read them, and a seed that truncates first
  -- cannot tell "nothing was staged" from "the last run cleaned up".
  truncate table public.players_staging;
  return v_live;
end;
$$;

create or replace function public.publish_nfl_players_from_staging()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staged integer;
  v_live integer;
begin
  select count(*) into v_staged from public.nfl_players_staging;
  if v_staged = 0 then
    raise exception 'nfl_players_staging is empty - refusing to replace the live pool with nothing';
  end if;

  delete from public.nfl_players;
  insert into public.nfl_players (kind, unit_group, name, team, era, season, pos, payload)
  select kind, unit_group, name, team, era, season, pos, payload
  from public.nfl_players_staging;

  select count(*) into v_live from public.nfl_players;
  truncate table public.nfl_players_staging;
  return v_live;
end;
$$;

-- Import-time only. These replace an entire draft pool, so they are not
-- something a signed-in client should be able to reach even by accident.
revoke all on function public.publish_players_from_staging() from public, anon, authenticated;
revoke all on function public.publish_nfl_players_from_staging() from public, anon, authenticated;
grant execute on function public.publish_players_from_staging() to service_role;
grant execute on function public.publish_nfl_players_from_staging() to service_role;
