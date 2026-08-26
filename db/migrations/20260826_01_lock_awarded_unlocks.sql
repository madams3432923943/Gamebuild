-- Stop a client granting itself the reward shelf.
--
-- WHAT WAS WRONG
--
-- profiles carries an UPDATE policy for `authenticated` with
-- `auth.uid() = id`, which is row-level, not column-level: a signed-in player
-- could write ANY column of their own row. Three triggers narrowed that -
-- protect_sport_ratings (the ELO), prevent_online_record_tampering
-- (online_wins/online_losses) and protect_mvp_teams - and everything they did
-- not name was writable from the browser console.
--
-- That left the entire reward economy self-serve. Verified against the live
-- database as an ordinary authenticated user, inside a transaction that was
-- rolled back:
--
--   update public.profiles
--      set granted_banners = '["crystal","gold","founder"]'::jsonb,
--          team_banners    = '{"Chicago Bulls": 999}'::jsonb,
--          era_records     = '{"2010s": {"online_wins": 999}}'::jsonb
--    where id = auth.uid();          -- succeeded
--
-- So: every banner, badge and icon in the game could be granted to yourself,
-- every franchise banner filled to its threshold, and the era-mastery ladder -
-- the one ladder deliberately built so it cannot be farmed in a single decade -
-- completed without playing a game in any of them.
--
-- WHAT THIS LOCKS, AND WHAT IT DELIBERATELY DOES NOT
--
-- Server-owned, so refused from a client outright:
--
--   granted_banners / granted_badges / granted_icons
--     The OWNER's override, applied by hand through the dashboard - which
--     connects as service_role and so passes the check below. A player being
--     able to write their own grant list defeated the entire point of it.
--     See docs/granting-unlocks.md.
--
--   team_banners
--     Awarded by the award_banner_progress trigger on match_results, and by
--     nothing else. Same posture mvp_teams already had, for the same reason:
--     a counter that unlocks something may not be written by the thing it
--     unlocks something for.
--
--   the ONLINE half of era_records
--     Not the whole column. era_records is written by BOTH sides by design:
--     the server bumps online_wins/online_losses when a ranked match
--     finalizes, and the client bumps offline_wins/offline_losses after a
--     practice game, because practice runs entirely in the browser. Only the
--     online half feeds the era-mastery banner ladder (winsInEveryEra in
--     js/banners.js reads record.online_wins), so only the online half is
--     defended. era_records_online_half() below is what makes that
--     distinction expressible.
--
-- NOT locked, and this is a deliberate limitation rather than an oversight:
-- career_totals, personal_bests, draft_counts, mvp_counts,
-- triple_double_counts, offline_wins/offline_losses and history stay
-- client-writable, because a practice game legitimately writes all of them
-- from the browser. The badges scored against those counters are therefore
-- still self-reportable. That is the existing shape of the design - practice
-- is unverified by definition (see CLAUDE.md) - and closing it means moving
-- practice results onto a trusted path, which is a much larger change than
-- this one and should not be smuggled in behind a security fix. The ranked
-- ladder, the public win/loss record and the reward shelf are what this
-- protects, and none of those depend on a practice counter.

-- Only the online counters, normalized, and only for eras that HAVE one.
--
-- Zero-valued entries are dropped rather than compared, which is what lets a
-- practice game in a bracket the player has never played online through: the
-- client's bumpEraRecord spreads EMPTY_ERA_RECORD over a new key, so the row
-- gains `{"online_wins": 0, "online_losses": 0}` where before it had no key at
-- all. Comparing raw jsonb would call that a change and refuse it, and the
-- first practice game in a fresh era would fail with a security error.
--
-- Values are cast to numeric rather than compared as jsonb so that 5 and "5"
-- are the same number, which they are.
create or replace function public.era_records_online_half(p jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(
    jsonb_object_agg(
      key,
      jsonb_build_object(
        'online_wins',   coalesce((value ->> 'online_wins')::numeric, 0),
        'online_losses', coalesce((value ->> 'online_losses')::numeric, 0)
      )
    ),
    '{}'::jsonb
  )
  from jsonb_each(coalesce(p, '{}'::jsonb))
  where coalesce((value ->> 'online_wins')::numeric, 0) <> 0
     or coalesce((value ->> 'online_losses')::numeric, 0) <> 0
$$;

comment on function public.era_records_online_half(jsonb) is
  'The online half of an era_records value, normalized and with empty entries '
  'dropped. Used by protect_awarded_unlocks to tell a practice result (which '
  'may touch the offline half) from a forged ranked one.';

-- Keyed on auth.uid() being present, matching protect_mvp_teams: true for a
-- signed-in browser, null for the service_role key the Edge Function and the
-- dashboard hold, so finalize_match_result and a hand-applied grant both write
-- through this untouched.
create or replace function public.protect_awarded_unlocks()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.granted_banners is distinct from old.granted_banners
     or new.granted_badges is distinct from old.granted_badges
     or new.granted_icons is distinct from old.granted_icons then
    raise exception 'granted_banners/granted_badges/granted_icons are owner overrides and cannot be set by a client'
      using errcode = 'P0001';
  end if;

  if new.team_banners is distinct from old.team_banners then
    raise exception 'team_banners is awarded by the match result trigger and cannot be set by a client'
      using errcode = 'P0001';
  end if;

  if public.era_records_online_half(new.era_records)
     is distinct from public.era_records_online_half(old.era_records) then
    raise exception 'the online half of era_records is written by the match result function and cannot be set by a client'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_awarded_unlocks on public.profiles;
create trigger protect_awarded_unlocks
  before update on public.profiles
  for each row execute function public.protect_awarded_unlocks();

-- Same posture as every other trigger helper here: called by the trigger, not
-- over the API. era_records_online_half is immutable and reads nothing, but it
-- has no business being an endpoint either.
revoke all on function public.protect_awarded_unlocks() from public, anon, authenticated;
revoke all on function public.era_records_online_half(jsonb) from public, anon, authenticated;
