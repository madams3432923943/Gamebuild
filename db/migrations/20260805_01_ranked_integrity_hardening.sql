-- Production hardening for online ranked integrity.

-- Online matches are currently supported only by the NBA server engine.
alter table public.matches
  add constraint matches_supported_online_sport check (sport = 'nba') not valid;
alter table public.matches validate constraint matches_supported_online_sport;

alter table public.matchmaking_queue
  add constraint matchmaking_supported_online_sport check (sport = 'nba') not valid;
alter table public.matchmaking_queue validate constraint matchmaking_supported_online_sport;

-- Result replay and audit metadata.
alter table public.match_results
  add column if not exists simulation_seed bigint,
  add column if not exists engine_version text,
  add column if not exists dataset_version text,
  add column if not exists rules_version text,
  add column if not exists finalized_at timestamptz;

-- The view now applies the participant RLS policy of the querying user.
drop view if exists public.matches_public;
create view public.matches_public with (security_invoker = true) as
  select id, player_a, player_b, status, round_number, current_squad_team,
    current_squad_decade, used_squads, winner, created_at, updated_at,
    is_friendly, sport, era
  from public.matches;
revoke all on public.matches_public from anon;
grant select on public.matches_public to authenticated;

-- Competitive state is written through authenticated RPCs and the result
-- Edge Function, never directly by a browser client.
revoke insert, update, delete, truncate on public.matches from anon, authenticated;
revoke insert, update, delete, truncate on public.match_picks from anon, authenticated;
revoke insert, update, delete, truncate on public.match_results from anon, authenticated;

create or replace function public.submit_strategy(
  p_match_id uuid,
  p_rotation jsonb,
  p_matchups jsonb,
  p_tactic text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_side text;
  v_match public.matches%rowtype;
  v_roster jsonb;
  v_opp_roster jsonb;
  v_slot text;
  v_minutes integer;
  v_minutes_text text;
  v_total integer := 0;
  v_rotation_count integer := 0;
  v_matchup_count integer := 0;
  v_unique_targets integer := 0;
  v_starter_slots constant text[] := array['PG','SG','SF','PF','C'];
  v_allowed_tactics constant text[] := array[
    'balanced','run-and-gun','spread-perimeter','lockdown-defense',
    'crash-the-glass','paint-dominance','ball-movement','isolation-heavy',
    'small-ball','defensive-pressure','zone-defense','full-court-press',
    'post-up-heavy','switch-everything','grind-it-out'
  ];
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  v_side := public.get_side(p_match_id);

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception 'match not found'; end if;
  if v_match.status <> 'strategy' then raise exception 'match is not awaiting strategy'; end if;
  if v_match.sport <> 'nba' then raise exception 'online sport is not supported'; end if;

  v_roster := case when v_side = 'A' then v_match.roster_a else v_match.roster_b end;
  v_opp_roster := case when v_side = 'A' then v_match.roster_b else v_match.roster_a end;

  if jsonb_typeof(p_rotation) <> 'object' then raise exception 'rotation must be an object'; end if;
  if jsonb_typeof(p_matchups) <> 'object' then raise exception 'matchups must be an object'; end if;
  if p_tactic is null or not (p_tactic = any(v_allowed_tactics)) then raise exception 'invalid tactic'; end if;
  if pg_column_size(p_rotation) > 4096 or pg_column_size(p_matchups) > 4096 then
    raise exception 'strategy payload too large';
  end if;

  for v_slot, v_minutes_text in
    select key, trim(both '"' from value::text) from jsonb_each(p_rotation)
  loop
    if v_minutes_text !~ '^[0-9]+$' then raise exception 'rotation values must be integers'; end if;
    v_minutes := v_minutes_text::integer;

    if not (v_roster ? v_slot) then raise exception 'rotation contains unknown slot %', v_slot; end if;
    if v_slot = any(v_starter_slots) then
      if v_minutes < 25 or v_minutes > 40 then raise exception 'starter minutes out of range'; end if;
    elsif v_slot like 'BENCH%' then
      if v_minutes < 10 or v_minutes > 24 then raise exception 'bench minutes out of range'; end if;
    else
      raise exception 'invalid ranked slot %', v_slot;
    end if;

    v_total := v_total + v_minutes;
    v_rotation_count := v_rotation_count + 1;
  end loop;

  if v_rotation_count <> (select count(*) from jsonb_object_keys(v_roster)) then
    raise exception 'rotation must include every roster slot';
  end if;
  if v_total <> 240 then raise exception 'rotation must total 240 minutes'; end if;

  select count(*), count(distinct value)
    into v_matchup_count, v_unique_targets
  from jsonb_each_text(p_matchups);
  if v_matchup_count <> 5 or v_unique_targets <> 5 then
    raise exception 'matchups must assign five unique starters';
  end if;
  if exists (
    select 1 from jsonb_each_text(p_matchups) e
    where not (e.key = any(v_starter_slots))
       or not (v_roster ? e.key)
       or not (e.value = any(v_starter_slots))
       or not (v_opp_roster ? e.value)
  ) then
    raise exception 'matchups contain invalid slots';
  end if;

  if v_side = 'A' then
    update public.matches
      set rotation_a = p_rotation, matchups_a = p_matchups,
          tactic_a = p_tactic, updated_at = now()
      where id = p_match_id;
  else
    update public.matches
      set rotation_b = p_rotation, matchups_b = p_matchups,
          tactic_b = p_tactic, updated_at = now()
      where id = p_match_id;
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if v_match.tactic_a is not null and v_match.tactic_b is not null then
    update public.matches
      set status = 'ready_to_simulate', updated_at = now()
      where id = p_match_id;
  end if;
end;
$$;
revoke all on function public.submit_strategy(uuid,jsonb,jsonb,text) from public, anon;
grant execute on function public.submit_strategy(uuid,jsonb,jsonb,text) to authenticated;

-- Result insertion, match completion, and both profile/rating replacements are
-- committed together. A retry returns the already stored result.
create or replace function public.finalize_match_result(
  p_match_id uuid,
  p_result jsonb,
  p_winner text,
  p_profile_a jsonb,
  p_profile_b jsonb,
  p_seed bigint,
  p_engine_version text,
  p_dataset_version text,
  p_rules_version text
)
returns public.match_results
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_result public.match_results%rowtype;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception 'match not found'; end if;

  select * into v_result from public.match_results where match_id = p_match_id;
  if found then return v_result; end if;
  if v_match.status <> 'ready_to_simulate' then raise exception 'match is not ready to simulate'; end if;
  if p_winner not in ('A','B') then raise exception 'invalid winner'; end if;

  insert into public.match_results (
    match_id, box_a, box_b, score_a, score_b, mvp, period_scores,
    overtime_periods, simulation_seed, engine_version, dataset_version,
    rules_version, finalized_at
  ) values (
    p_match_id, p_result->'box_a', p_result->'box_b',
    (p_result->>'score_a')::integer, (p_result->>'score_b')::integer,
    p_result->'mvp', p_result->'period_scores',
    coalesce((p_result->>'overtime_periods')::integer, 0), p_seed,
    p_engine_version, p_dataset_version, p_rules_version, now()
  ) returning * into v_result;

  update public.matches
    set status = 'complete', winner = p_winner, updated_at = now()
    where id = p_match_id;

  update public.profiles set
    personal_bests = coalesce(p_profile_a->'personal_bests', personal_bests),
    draft_counts = coalesce(p_profile_a->'draft_counts', draft_counts),
    history = coalesce(p_profile_a->'history', history),
    highest_scoring_game = coalesce(p_profile_a->'highest_scoring_game', highest_scoring_game),
    largest_margin_game = coalesce(p_profile_a->'largest_margin_game', largest_margin_game),
    online_wins = coalesce((p_profile_a->>'online_wins')::integer, online_wins),
    online_losses = coalesce((p_profile_a->>'online_losses')::integer, online_losses),
    era_records = coalesce(p_profile_a->'era_records', era_records),
    sport_ratings = coalesce(p_profile_a->'sport_ratings', sport_ratings)
    where id = v_match.player_a;

  update public.profiles set
    personal_bests = coalesce(p_profile_b->'personal_bests', personal_bests),
    draft_counts = coalesce(p_profile_b->'draft_counts', draft_counts),
    history = coalesce(p_profile_b->'history', history),
    highest_scoring_game = coalesce(p_profile_b->'highest_scoring_game', highest_scoring_game),
    largest_margin_game = coalesce(p_profile_b->'largest_margin_game', largest_margin_game),
    online_wins = coalesce((p_profile_b->>'online_wins')::integer, online_wins),
    online_losses = coalesce((p_profile_b->>'online_losses')::integer, online_losses),
    era_records = coalesce(p_profile_b->'era_records', era_records),
    sport_ratings = coalesce(p_profile_b->'sport_ratings', sport_ratings)
    where id = v_match.player_b;

  return v_result;
end;
$$;
revoke all on function public.finalize_match_result(uuid,jsonb,text,jsonb,jsonb,bigint,text,text,text)
  from public, anon, authenticated;
grant execute on function public.finalize_match_result(uuid,jsonb,text,jsonb,jsonb,bigint,text,text,text)
  to service_role;
