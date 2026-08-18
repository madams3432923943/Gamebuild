-- Profile icons: the mark on a player's identity card, and the counter that
-- unlocks the team ones.
--
-- Three cosmetic columns and one counter, all on profiles:
--
--   equipped_icon   which icon is worn. Null means "not chosen", which the
--                   client reads as the default icon - the one that follows
--                   whichever sport the player ranks highest in. Deliberately
--                   nullable rather than defaulted to a literal, because the
--                   default is COMPUTED and pinning a value here would freeze
--                   a football player's card to a basketball the day they
--                   signed up. See DEFAULT_ICON_ID in js/icons.js.
--
--   granted_icons   the owner's override, matching granted_banners and
--                   granted_badges from 20260817_01. Cosmetic only - see
--                   docs/granting-unlocks.md.
--
--   mvp_teams       ranked MVPs per RAW team name, e.g.
--                   {"Chicago Bulls": 2, "Washington Bullets": 1}.
--
-- WHY mvp_teams AND NOT mvp_counts
--
-- mvp_counts (20260730_02) already exists and is explicitly the OFFLINE tally,
-- keyed by player name and written by the client after a practice game. Team
-- icons cannot read it: practice runs entirely in the browser, so an offline
-- MVP is self-reportable, and an award you can hand yourself is not an award.
-- This column is written by finalize_match_result and by nothing else, on the
-- same trusted path that already owns online_wins and sport_ratings.
--
-- Keyed by raw team name rather than by franchise id for the same reason
-- team_banners is: the server would otherwise need its own copy of the
-- relocation/rename alias table, which is a second source of truth that
-- silently drifts. The client folds Bullets into Wizards at read time.

alter table public.profiles
  add column if not exists equipped_icon text,
  add column if not exists granted_icons jsonb default '[]'::jsonb,
  add column if not exists mvp_teams jsonb not null default '{}'::jsonb;

-- mvp_teams is a RECORD, not a preference, so the client may not write it.
--
-- The row-level policy on profiles lets a player update their own row, which
-- is right for the cosmetic columns beside this one - equipped_icon and
-- equipped_kit are theirs to set. It is wrong for a counter that unlocks
-- something: without this trigger a player could hand themselves all
-- sixty-two team icons with a single PATCH, and "the server decides what a
-- pick is worth, never the client" would hold for the scoreboard and not for
-- the shelf.
--
-- Modelled on protect_sport_ratings: keyed on auth.uid() being present, which
-- is true for a logged-in client and null for the service_role key the Edge
-- Function holds, so finalize_match_result writes through it untouched.
create or replace function public.protect_mvp_teams()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
begin
  if auth.uid() is not null and new.mvp_teams is distinct from old.mvp_teams then
    raise exception 'mvp_teams is written server-side only';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_mvp_teams on public.profiles;
create trigger protect_mvp_teams
  before update on public.profiles
  for each row execute function public.protect_mvp_teams();

revoke all on function public.protect_mvp_teams() from public, anon, authenticated;

-- finalize_match_result, carried forward from 20260811_03 with mvp_teams added
-- to the two profile updates and NOTHING ELSE CHANGED.
--
-- THE SIGNATURE IS DELIBERATELY BYTE-IDENTICAL. PostgREST resolves an RPC by
-- its exact set of argument NAMES, so adding a parameter here would not extend
-- this function - it would publish a second one, and every client that has not
-- reloaded would call the old shape and quietly stop recording MVPs. The new
-- value travels inside the existing p_profile_a / p_profile_b payloads, which
-- are already free-form jsonb built by the Edge Function.
--
-- coalesce, like every other column here: an Edge Function that has not
-- deployed yet simply omits the key and the column keeps its current value,
-- rather than being reset to '{}' on every game.
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
