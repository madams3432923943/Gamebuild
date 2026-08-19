-- Re-close two holes that reopened on their own, and remove the way they
-- reopened.
--
-- 1. GRANTS. 20260805_03 swept EXECUTE off every SECURITY DEFINER function and
--    then re-granted an explicit manifest. That was a one-time sweep, and
--    Postgres grants EXECUTE to PUBLIC on every function created after it. Six
--    migrations later, ten definer functions were reachable by `anon` again -
--    including grant_all_general_banners(text), which has no auth check of its
--    own because it was never meant to be reachable from a browser at all.
--    Anyone could hand any username every cosmetic in the game with one
--    unauthenticated POST.
--
--    The sweep is repeated here, and it will keep needing repeating: any
--    migration that adds a SECURITY DEFINER function must add its grant to the
--    manifest below, or leave it ungranted on purpose. scripts/verify-db-grants.mjs
--    checks the live database against this file's intent.
--
-- 2. THE VIEW. 20260805_01 recreated matches_public `with (security_invoker =
--    true)` so it applies the querying user's RLS. 20260811_01 added game_mode
--    with a plain `create or replace view`, which silently discards reloptions,
--    and the view has been running as its owner ever since. Recreated here with
--    the option and the current column list.
--
-- 3. SEARCH PATH. The two moderation normalizers are SECURITY DEFINER without a
--    pinned search_path - the shape 20260731_05 already fixed for
--    protect_sport_ratings.

-- ---------------------------------------------------------------------------
-- 1. Sweep, then re-grant the manifest
-- ---------------------------------------------------------------------------

do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end;
$$;

-- Authenticated user-facing RPCs.
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.cancel_match(uuid) to authenticated;
grant execute on function public.challenge_friend(uuid) to authenticated;
grant execute on function public.challenge_friend(uuid,text) to authenticated;
grant execute on function public.challenge_friend(uuid,text,text) to authenticated;
grant execute on function public.create_squad(text,text,text,text,text) to authenticated;
grant execute on function public.decline_friend_request(uuid) to authenticated;
grant execute on function public.delete_own_account() to authenticated;
grant execute on function public.disband_squad() to authenticated;
grant execute on function public.get_squad_invite_code() to authenticated;
grant execute on function public.get_visible_picks(uuid) to authenticated;
grant execute on function public.heartbeat_presence(text) to authenticated;
grant execute on function public.join_public_squad(uuid) to authenticated;
grant execute on function public.join_queue() to authenticated;
grant execute on function public.join_queue(text) to authenticated;
grant execute on function public.join_queue(text,text) to authenticated;
grant execute on function public.join_queue(text,text,text) to authenticated;
grant execute on function public.join_squad_by_code(text) to authenticated;
grant execute on function public.kick_squad_member(uuid) to authenticated;
grant execute on function public.leave_queue() to authenticated;
grant execute on function public.leave_squad() to authenticated;
grant execute on function public.regenerate_squad_invite_code() to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.report_squad_message(bigint,text) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.set_squad_member_role(uuid,text) to authenticated;
grant execute on function public.sport_stats(uuid) to authenticated;
grant execute on function public.submit_nfl_strategy(uuid,jsonb) to authenticated;
grant execute on function public.submit_pick(uuid,text,text,text,text,boolean,integer) to authenticated;
grant execute on function public.submit_skip(uuid) to authenticated;
grant execute on function public.submit_strategy(uuid,jsonb,jsonb,text) to authenticated;
grant execute on function public.transfer_squad_leadership(uuid) to authenticated;
grant execute on function public.update_squad_settings(text,text,text) to authenticated;

-- Helpers invoked from RLS policies. They still require EXECUTE under the
-- caller's role, but they are not useful without the policy's row predicates.
grant execute on function public.is_match_participant(uuid) to authenticated;
grant execute on function public.is_squad_member(uuid,uuid) to authenticated;
grant execute on function public.squad_is_public(uuid) to authenticated;
grant execute on function public.squad_role(uuid,uuid) to authenticated;

-- The one deliberate `anon` grant in the schema. A username is checked while
-- the player is still signing up, so this has to answer before there is a
-- session. It returns the REASON a username was refused, never the blocked
-- term list, and it writes nothing.
grant execute on function public.username_rejection_reason(text) to anon, authenticated;

-- Deliberately ungranted, and each for a reason worth writing down:
--
--   grant_all_general_banners(text)   the owner's override, run from the SQL
--                                     editor. It takes a username and no
--                                     credential, so a client grant IS the
--                                     vulnerability - see docs/granting-unlocks.md.
--   moderation_blocked_category(text) internal to the enforce_* triggers.
--   moderation_reject(text,text)      ditto - raises, and leaks the matched term.
--   enforce_profile_username_policy() trigger functions. Postgres invokes them
--   enforce_squad_message_policy()    as the table owner; a client never calls
--   enforce_squad_text_policy()       one directly.
--   advance_round_if_ready, get_side, handle_new_user, award_banner_progress,
--   protect_sport_ratings, protect_mvp_teams, finalize_match_result:
--                                     server-side only, unchanged from 20260805_03.

-- ---------------------------------------------------------------------------
-- 2. matches_public applies the caller's RLS again
-- ---------------------------------------------------------------------------

-- WARNING: `create or replace view` DISCARDS reloptions, so it silently strips
-- security_invoker back off. Any future column change to this view must drop
-- and recreate it exactly as below, never `create or replace`.
drop view if exists public.matches_public;
create view public.matches_public with (security_invoker = true) as
  select id, player_a, player_b, status, round_number, current_squad_team,
    current_squad_decade, used_squads, winner, created_at, updated_at,
    is_friendly, sport, era, game_mode
  from public.matches;
revoke all on public.matches_public from anon;
grant select on public.matches_public to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Pin the moderation normalizers' search_path
-- ---------------------------------------------------------------------------

alter function public.moderation_normalize(text) set search_path = public;
alter function public.moderation_normalize_words(text) set search_path = public;
