-- SECURITY DEFINER functions are executable by PUBLIC by default. Remove that
-- implicit endpoint exposure, then explicitly grant only the RPCs and policy
-- helpers the signed-in application needs.
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
grant execute on function public.disband_squad() to authenticated;
grant execute on function public.get_squad_invite_code() to authenticated;
grant execute on function public.get_visible_picks(uuid) to authenticated;
grant execute on function public.heartbeat_presence(text) to authenticated;
grant execute on function public.join_public_squad(uuid) to authenticated;
grant execute on function public.join_queue() to authenticated;
grant execute on function public.join_queue(text) to authenticated;
grant execute on function public.join_queue(text,text) to authenticated;
grant execute on function public.join_squad_by_code(text) to authenticated;
grant execute on function public.kick_squad_member(uuid) to authenticated;
grant execute on function public.leave_queue() to authenticated;
grant execute on function public.leave_squad() to authenticated;
grant execute on function public.regenerate_squad_invite_code() to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.set_squad_member_role(uuid,text) to authenticated;
grant execute on function public.sport_stats(uuid) to authenticated;
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

-- Internal-only helpers and trigger functions intentionally receive no client
-- grant: advance_round_if_ready, get_side, handle_new_user, award_banner_progress.
