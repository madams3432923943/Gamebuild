-- Squad Rep: a persistent, Clash-Royale-trophy-style score per squad,
-- replacing the old live percentile-vs-other-squads rank. Wins add more
-- than losses take away (asymmetric on purpose - losses should sting far
-- less than wins reward, so a squad generally trends upward with play
-- rather than churning in place), and it's a stored running total rather
-- than something recomputed from a snapshot of everyone's win/loss columns.
alter table public.squads add column rep integer not null default 0 check (rep >= 0);

-- Fires whenever a player's online_wins/online_losses changes - which only
-- ever happens via the simulate-match Edge Function's service-role write,
-- since protect_online_record blocks any other writer. Rather than teaching
-- that function about squads, this observes the effect: it looks up
-- whichever squad the player belongs to *right now* and adjusts that
-- squad's rep. A player who's left their squad by the time this fires
-- simply doesn't move anyone's rep, which is the right outcome - rep
-- belongs to whoever was actually repping the squad when the result landed.
create or replace function public.sync_squad_rep()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_squad_id uuid;
  v_delta_wins integer := coalesce(new.online_wins, 0) - coalesce(old.online_wins, 0);
  v_delta_losses integer := coalesce(new.online_losses, 0) - coalesce(old.online_losses, 0);
begin
  if v_delta_wins = 0 and v_delta_losses = 0 then
    return new;
  end if;

  select squad_id into v_squad_id from public.squad_members where user_id = new.id;
  if v_squad_id is null then
    return new;
  end if;

  -- +10 rep per win, -3 rep per loss, floored at 0 (the column check also
  -- enforces this, but clamping here avoids ever hitting that constraint).
  update public.squads
    set rep = greatest(0, rep + v_delta_wins * 10 - v_delta_losses * 3)
    where id = v_squad_id;

  return new;
end;
$$;

create trigger squad_rep_sync
  after update of online_wins, online_losses on public.profiles
  for each row
  execute function public.sync_squad_rep();
