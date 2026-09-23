-- A completed match must have two players and a winner its score agrees with.
--
-- Three completed ranked rows broke that, and they are two different failures:
--
--   a454fec8-d7b8-467d-a55c-5efcfacf9ab0  NBA 140-140, overtime_periods 0,
--       winner B. A real write-time bug. The NBA engine tested for a tie on
--       Math.round of the team total while the box score sums each player's
--       rounded line, so it skipped overtime on a game it then printed level,
--       and broke the tie by roster strength. Fixed at the source in
--       js/sports/nba/engine.js; this makes the same shape unwritable.
--
--   517b4a0b-f571-4b11-a04b-c5e70b9de041  NFL, player_b null, winner B
--   359de8d2-c39c-4e3b-b942-97c8c0ad9632  NFL, player_a null, winner A
--       Almost certainly NOT written that way. matches.player_a/player_b are
--       ON DELETE SET NULL and delete_own_account() deliberately keeps
--       completed matches, so a player who deletes their account leaves every
--       finished game they played with that side nulled. Both rows are from
--       the same half hour on 2026-08-15 with non-tied scores.
--
-- WHY A TRIGGER AND NOT A CHECK FOR THE PLAYERS. A CHECK (status <> 'complete'
-- or both players present) would make account deletion fail for anyone who
-- has ever finished an online game: the SET NULL would violate it. So the
-- players are checked at the moment a match BECOMES complete, which is the
-- write this is actually about, and a later deletion is left alone.
--
-- WHY A CHECK FOR THE TIE. A result row is never legitimately level - there is
-- no tie outcome in either sport, and overtime exists to prevent one - and
-- nothing nulls a score later. NOT VALID so it binds every new row without
-- failing on the one bad row already there.
--
-- EXISTING ROWS ARE NOT REWRITTEN. The 140-140 game moved two ratings; undoing
-- that is a decision about people's ranks, not a schema change, and is left to
-- the owner.

alter table public.match_results
  drop constraint if exists match_results_no_tie;
alter table public.match_results
  add constraint match_results_no_tie check (score_a <> score_b) not valid;

-- Fires on the transition to complete (and on any later change of winner), so
-- it guards every path that could complete a match, not only the one function
-- that does today.
create or replace function public.guard_match_completion()
returns trigger
language plpgsql
set search_path to public
as $$
declare
  v_score_a integer;
  v_score_b integer;
begin
  if new.status <> 'complete' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'complete' and new.winner is not distinct from old.winner then
    return new;
  end if;

  if new.player_a is null or new.player_b is null then
    raise exception 'a match cannot complete without both players (match %)', new.id
      using errcode = 'P0001';
  end if;
  if new.winner is null or new.winner not in ('A', 'B') then
    raise exception 'a completed match needs a winner (match %)', new.id
      using errcode = 'P0001';
  end if;

  select score_a, score_b into v_score_a, v_score_b
    from public.match_results where match_id = new.id;
  if not found then
    raise exception 'a match cannot complete before its result is written (match %)', new.id
      using errcode = 'P0001';
  end if;
  if v_score_a = v_score_b
     or (new.winner = 'A') <> (v_score_a > v_score_b) then
    raise exception 'winner % does not match the score %-% (match %)', new.winner, v_score_a, v_score_b, new.id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_match_completion on public.matches;
create trigger guard_match_completion
  before insert or update of status, winner on public.matches
  for each row execute function public.guard_match_completion();

revoke all on function public.guard_match_completion() from public, anon, authenticated;

-- Same body as 20260818_01_profile_icons_and_mvp_teams.sql, with the checks
-- made before anything is written so a refused result leaves no half-state:
-- the trigger above would roll the whole call back anyway, but failing here
-- first gives the Edge Function a readable reason instead of a trigger's.
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
  v_score_a integer := (p_result->>'score_a')::integer;
  v_score_b integer := (p_result->>'score_b')::integer;
begin
  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'match not found'; end if;

  select * into v_result from public.match_results where match_id=p_match_id;
  if found then return v_result; end if;

  if v_match.status <> 'ready_to_simulate' then raise exception 'match is not ready to simulate'; end if;
  if v_match.player_a is null or v_match.player_b is null then raise exception 'match is missing a player'; end if;
  if p_winner not in ('A','B') then raise exception 'invalid winner'; end if;
  if v_score_a is null or v_score_b is null then raise exception 'result has no score'; end if;
  if v_score_a = v_score_b then raise exception 'a tied score has no winner'; end if;
  if (p_winner = 'A') <> (v_score_a > v_score_b) then raise exception 'winner does not match the score'; end if;

  insert into public.match_results(
    match_id,box_a,box_b,score_a,score_b,mvp,period_scores,overtime_periods,
    simulation_seed,engine_version,dataset_version,rules_version,game_data,finalized_at
  ) values(
    p_match_id,p_result->'box_a',p_result->'box_b',
    v_score_a,v_score_b,
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
    mvp_teams=coalesce(p_profile_a->'mvp_teams',mvp_teams),
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
    mvp_teams=coalesce(p_profile_b->'mvp_teams',mvp_teams),
    sport_ratings=coalesce(p_profile_b->'sport_ratings',sport_ratings)
  where id=v_match.player_b;

  return v_result;
end;
$$;
