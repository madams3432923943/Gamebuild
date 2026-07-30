-- Squad Rep is reserved for squad-vs-squad tournament play, which doesn't
-- exist yet - so every squad sits at 0 until it does.
--
-- It used to accrue from each member's individual ranked record (+10 win,
-- -3 loss), which measured how much its members played solo rather than
-- anything the squad did together. Rep is meant to say "this squad competes
-- as a unit"; awarding it for solo games made it a playtime counter that a
-- squad could climb without ever playing together once.
drop trigger if exists squad_rep_sync on public.profiles;
drop function if exists public.sync_squad_rep();

-- Reset the rep accrued under the old rule, so no squad carries a lead
-- earned by a mechanism that no longer exists.
update public.squads set rep = 0 where rep <> 0;
