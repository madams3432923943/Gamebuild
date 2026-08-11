-- Online NFL: submitting an offensive AND a defensive gameplan.
--
-- WHY A SECOND FUNCTION RATHER THAN A WIDER submit_strategy
--
-- submit_strategy() validates basketball: a 240-minute rotation across five
-- starters and a bench, five unique matchups, and one tactic id from the
-- fifteen-gamestyle allowlist. It hard-rejects any sport other than 'nba' for
-- exactly the right reason - every rule in it is a basketball rule.
--
-- Football has no rotation and no matchups (NFL.rotationBudget is 0 and
-- usesMatchups is false), and it submits TWO plans rather than one. Widening
-- the basketball function to branch on sport would put both sports' rules in
-- one body where a change to either can break the other. A separate function
-- keeps each sport's validation next to that sport's rules, which is the same
-- separation the client keeps.
--
-- THE CLIENT IS NOT TRUSTED. The allowlists below are the authority on what a
-- gameplan may be; the browser can send anything. They must be kept in step
-- with js/sports/nfl/tactics.js - if a plan is added there and not here, it
-- will be rejected, which is the safe direction to fail.
--
-- The pair is stored as JSON text in the EXISTING tactic_a / tactic_b columns
-- rather than in two new ones. The Edge Function reads that column already, so
-- there is no schema change and no migration of historical rows: an old row
-- holds a bare basketball id, a new one holds {"offense":...,"defense":...},
-- and parseStrategy() on the client tolerates both.

create or replace function public.submit_nfl_strategy(
  p_match_id uuid,
  p_strategy jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_side text;
  v_match public.matches%rowtype;
  v_offense text;
  v_defense text;
  v_allowed_offense constant text[] := array[
    'balanced-offense', 'ground-control', 'west-coast', 'vertical-attack', 'power-red-zone'
  ];
  v_allowed_defense constant text[] := array[
    'balanced-defense', 'blitz-pressure', 'run-wall', 'ball-hawks', 'keep-it-in-front'
  ];
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- Raises if the caller is not one of the two players in this match.
  v_side := public.get_side(p_match_id);

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match not found';
  end if;
  if v_match.status <> 'strategy' then
    raise exception 'match is not awaiting strategy';
  end if;
  if v_match.sport <> 'nfl' then
    raise exception 'submit_nfl_strategy is for football matches only';
  end if;

  if p_strategy is null or jsonb_typeof(p_strategy) <> 'object' then
    raise exception 'strategy must be an object';
  end if;
  -- Small by construction: two short ids. A generous ceiling still stops a
  -- client posting a megabyte into a text column.
  if pg_column_size(p_strategy) > 1024 then
    raise exception 'strategy payload too large';
  end if;

  v_offense := p_strategy ->> 'offense';
  v_defense := p_strategy ->> 'defense';

  if v_offense is null or not (v_offense = any(v_allowed_offense)) then
    raise exception 'invalid offensive gameplan';
  end if;
  if v_defense is null or not (v_defense = any(v_allowed_defense)) then
    raise exception 'invalid defensive gameplan';
  end if;

  -- Stored NORMALISED, not as the client sent it: exactly two keys, in a fixed
  -- order, so the trusted simulation reads a shape it chose rather than one the
  -- browser chose. Any extra keys the client attached are dropped here.
  if v_side = 'A' then
    update public.matches
       set tactic_a = jsonb_build_object('offense', v_offense, 'defense', v_defense)::text,
           updated_at = now()
     where id = p_match_id;
  else
    update public.matches
       set tactic_b = jsonb_build_object('offense', v_offense, 'defense', v_defense)::text,
           updated_at = now()
     where id = p_match_id;
  end if;

  -- Advance only when BOTH sides have committed, the same gate
  -- submit_strategy() uses. Re-read inside the same transaction so two
  -- simultaneous submissions cannot both see a half-filled match.
  select * into v_match from public.matches where id = p_match_id;
  if v_match.tactic_a is not null and v_match.tactic_b is not null then
    update public.matches
       set status = 'ready_to_simulate', updated_at = now()
     where id = p_match_id;
  end if;
end;
$function$;

-- Same grant posture as submit_strategy: callable by a signed-in player, and
-- by nobody else. The function is SECURITY DEFINER, so this is the only door.
revoke all on function public.submit_nfl_strategy(uuid, jsonb) from public;
revoke all on function public.submit_nfl_strategy(uuid, jsonb) from anon;
grant execute on function public.submit_nfl_strategy(uuid, jsonb) to authenticated;
