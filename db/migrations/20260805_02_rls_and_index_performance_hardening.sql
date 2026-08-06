-- Cover foreign keys used in joins, deletes, and membership lookups.
create index if not exists friendships_requester_id_idx on public.friendships(requester_id);
create index if not exists friendships_addressee_id_idx on public.friendships(addressee_id);
create index if not exists presence_user_id_idx on public.presence(user_id);
create index if not exists squad_messages_user_id_idx on public.squad_messages(user_id);
create index if not exists squads_created_by_idx on public.squads(created_by);

-- Profiles: explicit authenticated ownership and stable auth init plans.
drop policy if exists "users insert their own profile" on public.profiles;
create policy "users insert their own profile" on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "users manage their own profile" on public.profiles;
create policy "users manage their own profile" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Matchmaking is RPC-managed. Keep only participant visibility and remove the
-- duplicate ALL/SELECT policies that were evaluated together.
drop policy if exists "users manage their own queue row" on public.matchmaking_queue;
drop policy if exists "users see their own queue row" on public.matchmaking_queue;
create policy "users see their own queue row" on public.matchmaking_queue
  for select to authenticated
  using ((select auth.uid()) = user_id);
revoke insert, update, delete, truncate on public.matchmaking_queue from anon, authenticated;

-- Participant and social visibility policies use one auth lookup per query.
drop policy if exists "participants read their match" on public.matches;
create policy "participants read their match" on public.matches
  for select to authenticated
  using ((select auth.uid()) = player_a or (select auth.uid()) = player_b);

drop policy if exists "participants read their friendship" on public.friendships;
create policy "participants read their friendship" on public.friendships
  for select to authenticated
  using ((select auth.uid()) = requester_id or (select auth.uid()) = addressee_id);

drop policy if exists "public squads and own squad are readable" on public.squads;
create policy "public squads and own squad are readable" on public.squads
  for select to authenticated
  using (visibility = 'public' or public.is_squad_member(id, (select auth.uid())));

drop policy if exists "rosters follow squad visibility" on public.squad_members;
create policy "rosters follow squad visibility" on public.squad_members
  for select to authenticated
  using (public.squad_is_public(squad_id) or public.is_squad_member(squad_id, (select auth.uid())));

drop policy if exists "members read squad chat" on public.squad_messages;
create policy "members read squad chat" on public.squad_messages
  for select to authenticated
  using (public.is_squad_member(squad_id, (select auth.uid())));

drop policy if exists "members post squad chat" on public.squad_messages;
create policy "members post squad chat" on public.squad_messages
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_squad_member(squad_id, (select auth.uid())));

-- These helpers are called only by privileged RPCs or triggers. They should
-- not be exposed as standalone Data API endpoints.
revoke all on function public.advance_round_if_ready(uuid) from public, anon, authenticated;
revoke all on function public.get_side(uuid) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.award_banner_progress() from public, anon, authenticated;
