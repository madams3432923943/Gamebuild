-- Fixes online play: reading your own finished match failed outright with
-- "permission denied for table matches".
--
-- WHAT WAS WRONG
--
-- The read policy on match_results checked participation with a subquery:
--
--   using (exists (select 1 from matches m
--                  where m.id = match_results.match_id
--                    and (m.player_a = auth.uid() or m.player_b = auth.uid())))
--
-- An RLS policy expression is evaluated as the INVOKING role, and `authenticated`
-- has every privilege on `matches` except SELECT. So the policy itself could
-- not run, and the read failed at the permission layer before RLS ever got to
-- decide anything. Every online result reveal hit it: the scoreboard sat on
-- "Simulating..." at 0-0 and the player was told the game couldn't be played
-- back, for a game that had simulated correctly and was already stored.
--
-- WHY NOT JUST GRANT SELECT ON MATCHES
--
-- Because `matches` holds roster_a/roster_b - the hidden draft picks. Granting
-- SELECT would let a participant read their opponent's roster mid-draft, which
-- is the exact leak the matches_public view was created to prevent. The
-- missing grant is doing real work and must stay missing.
--
-- THE FIX
--
-- Move the participation check into a SECURITY DEFINER function, so it runs
-- with the owner's rights and never needs the caller to hold SELECT on
-- `matches`. This is the same pattern the rest of the schema already uses for
-- exactly this reason (get_visible_picks, heartbeat_presence).
--
-- The function leaks nothing: it answers only "is the caller in this match",
-- for the caller's own auth.uid(), which is something they already know.
--
-- Verified after applying, by impersonating real signed-in users:
--   - a participant reads their own result (was: permission denied)
--   - dotch sees exactly the 3 results they played in, not all 4
--   - a direct read of `matches` is still refused, so rosters stay hidden

create or replace function public.is_match_participant(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.matches m
    where m.id = p_match_id
      and (m.player_a = auth.uid() or m.player_b = auth.uid())
  );
$$;

revoke all on function public.is_match_participant(uuid) from public;
grant execute on function public.is_match_participant(uuid) to authenticated, anon;

drop policy if exists "participants read their match result" on public.match_results;
create policy "participants read their match result"
  on public.match_results for select
  using (public.is_match_participant(match_id));
