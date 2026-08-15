-- Online Ranked (NBA) could not submit a game plan. At all, by anyone, since
-- 20260805_01_ranked_integrity_hardening.sql shipped.
--
-- WHAT HAPPENED
--
-- The hardening migration added validation to submit_strategy, and the
-- matchups half of it was written against an assumption rather than against
-- what the game sends:
--
--     select count(*), count(distinct value) from jsonb_each_text(p_matchups);
--     if v_matchup_count <> 5 or v_unique_targets <> 5 then
--       raise exception 'matchups must assign five unique starters';
--
-- A ranked roster is TEN players, and js/sports/nba/engine.js's
-- defaultMatchups assigns all ten - the five starters onto the five opposing
-- starters, and each bench man onto somebody too, because a bench defender
-- covers the position he is slotted into (see slotsByPosition and
-- defendersOf). So every real submission arrived with ten entries and was
-- rejected with "matchups must assign five unique starters".
--
-- The postgres log for one stuck match shows fifteen of them in fifty
-- seconds: a player pressing the button again and again.
--
-- Offline Ranked Practice was unaffected, because nothing validates there -
-- the engine simply reads the ten assignments and uses them. That is the
-- clearest evidence of which side is wrong here: the engine's contract is
-- ten, and the check was asserting five.
--
-- WHY IT SURVIVED A GREEN VERIFY
--
-- scripts/selftest/supabase-stub.js resolves every rpc() call to success
-- without looking at its arguments, so the online self-test drove the
-- rotation -> matchups -> gamestyle sequence, "submitted", and passed, while
-- the real RPC rejected the same payload every time. A separate check that
-- holds the client's payload to this contract is added alongside this
-- migration (scripts/verify-online-strategy-contract.mjs).
--
-- THE CONTRACT THIS ENFORCES, which is the engine's own:
--   * every key is a slot on the submitting side's roster
--   * every value is a slot on the opponent's roster
--   * every starter the submitter has is given an assignment
--   * no two of the submitter's STARTERS share an assignment - the picker in
--     js/ui.js swaps assignments rather than duplicating them, so a
--     permutation across the starters is a real guarantee and worth keeping
--   * bench assignments are free to double up, because doubling a bench
--     defender onto a man the starters already cover is a legitimate (and
--     costly) choice the engine models by blending defenders over minutes
--
-- Nothing here loosens the parts that were right: the rotation is still held
-- to every slot, its per-slot minute bands and a 240 total, the tactic is
-- still checked against the catalogue, and the payload is still size-capped.

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
  v_starter_targets integer := 0;
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

  -- ---- rotation: unchanged from 20260805_01 --------------------------------
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

  -- ---- matchups: against the ROSTERS, not against a count ------------------
  -- Both sides of every assignment have to name somebody who is actually on
  -- the floor. Because jsonb keys are unique and every key must be a slot on
  -- this roster, the number of assignments is bounded by the roster itself.
  if exists (
    select 1 from jsonb_each_text(p_matchups) e
    where not (v_roster ? e.key) or not (v_opp_roster ? e.value)
  ) then
    raise exception 'matchups name a slot that is not on a roster';
  end if;

  if exists (
    select 1 from unnest(v_starter_slots) s
    where (v_roster ? s) and not (p_matchups ? s)
  ) then
    raise exception 'every starter must be given an assignment';
  end if;

  select count(*), count(distinct value)
    into v_starter_targets, v_unique_targets
  from jsonb_each_text(p_matchups)
  where key = any(v_starter_slots);
  if v_starter_targets <> v_unique_targets then
    raise exception 'two starters cannot be given the same assignment';
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
    update public.matches set status = 'ready_to_simulate', updated_at = now() where id = p_match_id;
  end if;
end;
$$;

revoke all on function public.submit_strategy(uuid,jsonb,jsonb,text) from public, anon;
grant execute on function public.submit_strategy(uuid,jsonb,jsonb,text) to authenticated;
