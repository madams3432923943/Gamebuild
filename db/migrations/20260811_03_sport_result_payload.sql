-- A football result contains more than period score boxes: its authoritative
-- playback is the drive/event ledger. Keep those sport-owned extras beside the
-- common score/box columns so online NFL can replay the exact same game the
-- trusted server simulated instead of degrading to basketball's period-only
-- result shape.
alter table public.match_results
  add column if not exists game_data jsonb not null default '{}'::jsonb;

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
set search_path to public
as $$
declare
  v_match public.matches%rowtype;
  v_result public.match_results%rowtype;
begin
  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'match not found'; end if;

  select * into v_result from public.match_results where match_id=p_match_id;
  if found then return v_result; end if;

  if v_match.status <> 'ready_to_simulate' then raise exception 'match is not ready to simulate'; end if;
  if p_winner not in ('A','B') then raise exception 'invalid winner'; end if;

  insert into public.match_results(
    match_id,box_a,box_b,score_a,score_b,mvp,period_scores,overtime_periods,
    simulation_seed,engine_version,dataset_version,rules_version,game_data,finalized_at
  ) values(
    p_match_id,p_result->'box_a',p_result->'box_b',
    (p_result->>'score_a')::integer,(p_result->>'score_b')::integer,
    p_result->'mvp',p_result->'period_scores',
    coalesce((p_result->>'overtime_periods')::integer,0),
    p_seed,p_engine_version,p_dataset_version,p_rules_version,
    coalesce(p_result->'game_data','{}'::jsonb),now()
  ) returning * into v_result;

  update public.matches
  set status='complete',winner=p_winner,updated_at=now()
  where id=p_match_id;

  update public.profiles set
    personal_bests=coalesce(p_profile_a->'personal_bests',personal_bests),
    draft_counts=coalesce(p_profile_a->'draft_counts',draft_counts),
    history=coalesce(p_profile_a->'history',history),
    highest_scoring_game=coalesce(p_profile_a->'highest_scoring_game',highest_scoring_game),
    largest_margin_game=coalesce(p_profile_a->'largest_margin_game',largest_margin_game),
    online_wins=coalesce((p_profile_a->>'online_wins')::integer,online_wins),
    online_losses=coalesce((p_profile_a->>'online_losses')::integer,online_losses),
    era_records=coalesce(p_profile_a->'era_records',era_records),
    sport_ratings=coalesce(p_profile_a->'sport_ratings',sport_ratings)
  where id=v_match.player_a;

  update public.profiles set
    personal_bests=coalesce(p_profile_b->'personal_bests',personal_bests),
    draft_counts=coalesce(p_profile_b->'draft_counts',draft_counts),
    history=coalesce(p_profile_b->'history',history),
    highest_scoring_game=coalesce(p_profile_b->'highest_scoring_game',highest_scoring_game),
    largest_margin_game=coalesce(p_profile_b->'largest_margin_game',largest_margin_game),
    online_wins=coalesce((p_profile_b->>'online_wins')::integer,online_wins),
    online_losses=coalesce((p_profile_b->>'online_losses')::integer,online_losses),
    era_records=coalesce(p_profile_b->'era_records',era_records),
    sport_ratings=coalesce(p_profile_b->'sport_ratings',sport_ratings)
  where id=v_match.player_b;

  return v_result;
end;
$$;
