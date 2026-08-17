-- An override the owner controls, so a grant is a row edit and not a deploy.
--
-- WHY
--
-- The first version of "give the founder every banner" was a hardcoded id check
-- in js/banners.js. It worked, and it was the wrong shape: every future grant -
-- a friend, a tester, an apology for a bug, a launch giveaway - would have meant
-- editing code, running the suite, pushing, and waiting on a GitHub Pages deploy
-- that has already failed with a 503 three times today. A cosmetic favour should
-- not require a release.
--
-- So the grant lives in the database, where it can be changed in seconds from
-- the Supabase dashboard or one UPDATE, and takes effect on the player's next
-- page load with no deploy at all.
--
-- SHAPE
--
-- A jsonb ARRAY of ids, not a map of booleans: the question is only ever "is
-- this id in the list", the list is short, and an array cannot drift into
-- holding `false` values that read as present-but-off.
--
-- The ids are whatever the client's catalogues use - banner ids from
-- FRANCHISES/GENERAL_BANNERS in js/banners.js, badge ids from BADGES in
-- js/badges.js. Unknown ids are ignored rather than rejected, so a typo grants
-- nothing instead of breaking a screen, and a grant written for a banner that
-- ships next week simply starts working when it does.
--
-- COSMETIC ONLY, DELIBERATELY.
--
-- Banners and badges are decoration. Nothing here can touch a rating, a record,
-- or a match result - those are written by the trusted server (see
-- finalize_match_result) and must never be grantable, or the ladder everyone
-- else is ranked against stops meaning anything. If a future grant type is not
-- cosmetic it does not belong in this column.

alter table public.profiles
  add column if not exists granted_banners jsonb default '[]'::jsonb,
  add column if not exists granted_badges  jsonb default '[]'::jsonb;

comment on column public.profiles.granted_banners is
  'Banner ids force-unlocked for this player regardless of progress. Ids come '
  'from FRANCHISES and GENERAL_BANNERS in js/banners.js. Cosmetic only. '
  'Example: update profiles set granted_banners = ''["crystal","gold"]''::jsonb where username = ''zfolts4'';';

comment on column public.profiles.granted_badges is
  'Badge ids force-unlocked to their top tier for this player. Ids come from '
  'BADGES in js/badges.js. Cosmetic only.';

-- A convenience for the owner: grant every general banner to one username in a
-- single call, without needing the id list to hand. Security definer so it can
-- write a profile row, but it only ever writes these two cosmetic columns.
create or replace function public.grant_all_general_banners(p_username text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set granted_banners = (
    select jsonb_agg(distinct id)
    from (
      select jsonb_array_elements_text(coalesce(granted_banners, '[]'::jsonb)) as id
      union
      select unnest(array[
        'rookie','forest-pixel','desert-wind','reptile','blossom','purple-wind',
        'blue-wave','arctic-stripe','carbon-fiber','gold','crystal',
        'wild-fur','skulls','inferno',
        'volcanic','crimson-splat','good-luck',
        'woodland-camo','hunter','stealth','urban-camo'
      ])
    ) merged
  )
  where username = p_username;
$$;

comment on function public.grant_all_general_banners(text) is
  'Owner convenience: unions every general banner id into a player''s '
  'granted_banners. Cosmetic only; never touches ratings or records.';
