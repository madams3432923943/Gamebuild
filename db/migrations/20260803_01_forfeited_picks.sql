-- Record which online picks the CLOCK made rather than the player.
--
-- The pick timer auto-drafts the worst eligible player when it runs out, and
-- that was the whole penalty for missing a pick. It wasn't enough: the worst
-- man in a ten-man squad is still an NBA player, and players were losing to
-- opponents who had forfeited two picks. The simulation now charges a real
-- cost for a forfeited pick (see FORFEIT_PLAYER_SCALE / FORFEIT_TEAM_PENALTY
-- in js/constants.js), which means the SERVER has to know which picks those
-- were - the Edge Function simulates online matches, and it can only read
-- what was stored.
--
-- Stored on match_picks rather than on matches, because it is a property of a
-- single pick and the picks table already exists with one row per action.
-- Defaulted false and added as an optional argument so a client that hasn't
-- reloaded yet keeps working exactly as before, just without the penalty.

alter table public.match_picks
  add column if not exists forfeited boolean not null default false;

-- Same body as the previous version (see
-- 20260730_03_online_ranked_parity_and_era_scoping.sql) with one added
-- argument, which is written straight through to the new column. Declared
-- with a default so existing `submit_pick(uuid, text, text, text, text)`
-- calls still resolve to this function.
create or replace function public.submit_pick(
  p_match_id uuid,
  p_player_name text,
  p_team text,
  p_decade text,
  p_slot text,
  p_forfeited boolean default false
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_match record;
  v_side text;
  v_roster jsonb;
  v_player record;
begin
  select public.get_side(p_match_id) into v_side;
  select * into v_match from public.matches where id = p_match_id for update;

  if v_match.status <> 'drafting' then raise exception 'match is not drafting'; end if;
  if p_team <> v_match.current_squad_team or p_decade <> v_match.current_squad_decade then
    raise exception 'player is not part of the currently rolled squad';
  end if;

  select * into v_player from public.players
    where name = p_player_name and team = p_team and decade = p_decade limit 1;
  if v_player is null then raise exception 'unknown player for this squad'; end if;
  if not (p_slot = any(v_player.pos) or p_slot = '6TH' or p_slot like 'BENCH%') then
    raise exception 'player not eligible for slot %', p_slot;
  end if;

  v_roster := case v_side when 'A' then v_match.roster_a else v_match.roster_b end;
  if v_roster ? p_slot then raise exception 'slot already filled'; end if;
  if exists (select 1 from jsonb_each(v_roster) e where (e.value ->> 'name') = p_player_name) then
    raise exception 'player already drafted';
  end if;
  if exists (
    select 1 from public.match_picks
    where match_id = p_match_id and side = v_side and round_number = v_match.round_number
  ) then
    raise exception 'already acted this round';
  end if;

  insert into public.match_picks (match_id, side, round_number, action, player_name, team, decade, slot, forfeited)
  values (p_match_id, v_side, v_match.round_number, 'pick', p_player_name, p_team, p_decade, p_slot, coalesce(p_forfeited, false));

  v_roster := v_roster || jsonb_build_object(p_slot, jsonb_build_object(
    'name', v_player.name, 'team', v_player.team, 'decade', v_player.decade,
    'pos', to_jsonb(v_player.pos), 'ppg', v_player.ppg, 'rpg', v_player.rpg,
    'apg', v_player.apg, 'spg', v_player.spg, 'bpg', v_player.bpg, 'tov', v_player.tov,
    'fga', v_player.fga, 'fgp', v_player.fgp, 'tpa', v_player.tpa, 'tpp', v_player.tpp,
    'fta', v_player.fta, 'ftp', v_player.ftp
  ));

  if v_side = 'A' then
    update public.matches set roster_a = v_roster, updated_at = now() where id = p_match_id;
  else
    update public.matches set roster_b = v_roster, updated_at = now() where id = p_match_id;
  end if;

  perform public.advance_round_if_ready(p_match_id);
end;
$$;

-- The five-argument version is now ambiguous against the six-argument one for
-- calls that pass exactly five arguments, so it goes.
drop function if exists public.submit_pick(uuid, text, text, text, text);

grant execute on function public.submit_pick(uuid, text, text, text, text, boolean) to authenticated;

-- Deliberately NOT added to get_visible_picks' return shape: knowing that the
-- opponent let the clock pick is a live read on how the other side is doing,
-- and the reveal rule exists to withhold exactly that. Only the Edge Function
-- (service role) reads this column, and only after the draft is over.
