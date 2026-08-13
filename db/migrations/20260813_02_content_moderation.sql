-- Content moderation for everything one player can put in front of another:
-- usernames, squad names, tags, mottos and squad chat.
--
-- The rules live HERE, in the database, and not in the client, for the same
-- reason simulate-match owns the score: squad chat is a direct table insert
-- from the browser, so a filter in js/ is a suggestion. A trigger on the
-- table is the rule. The client's job is to show the server's refusal
-- quickly and in plain language, which is why every message raised below is
-- already written for a player to read.
--
-- Blunt by design, and it will be wrong in both directions. A word list
-- cannot tell a slur from a surname, and this game is full of real surnames -
-- so the list is kept narrow, substring matching is reserved for terms that
-- are unlikely to appear inside an innocent word, and reports (below) are the
-- backstop for everything the list misses.

-- ---- Normalisation -------------------------------------------------------
-- Two forms, because two kinds of matching need different things:
--   moderation_normalize      lowercase, leetspeak folded, everything that
--                             isn't a letter or digit removed. "S_L*U.R" and
--                             "5lur" both collapse onto "slur", which is what
--                             substring matching runs against.
--   moderation_normalize_words  the same, but word breaks survive as single
--                             spaces, so a short term can be matched as a
--                             whole word instead of anywhere inside one.
--
-- Repeated letters are deliberately NOT collapsed. Collapsing them catches
-- "sluuur", but it also turns real place names and surnames into slurs, and
-- a filter that blocks somebody's actual name is a worse failure than one
-- that misses a padded spelling.

create or replace function public.moderation_normalize(p_text text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           translate(lower(coalesce(p_text, '')), '0134578@$!|', 'oieastbasii'),
           '[^a-z0-9]', '', 'g'
         );
$$;

create or replace function public.moderation_normalize_words(p_text text)
returns text
language sql
immutable
as $$
  select ' ' || btrim(regexp_replace(
           regexp_replace(
             translate(lower(coalesce(p_text, '')), '0134578@$!|', 'oieastbasii'),
             '[^a-z0-9]+', ' ', 'g'
           ),
           '\s+', ' ', 'g'
         )) || ' ';
$$;

-- ---- The list ------------------------------------------------------------
-- RLS on, zero policies: default deny. No client can read this table, the
-- same treatment squad_invite_codes gets. Publishing the list would be
-- publishing the evasion guide.

create table if not exists public.blocked_terms (
  term text primary key,
  category text not null check (category in ('slur', 'sexual', 'harassment', 'reserved', 'spam')),
  -- substring: matched anywhere, for terms that don't occur inside innocent words
  -- word:      matched as a whole word only, for terms that do
  -- exact:     the whole value must be the term, for reserved names
  match_mode text not null default 'substring' check (match_mode in ('substring', 'word', 'exact')),
  created_at timestamptz not null default now()
);

alter table public.blocked_terms enable row level security;

-- Seeded through the normaliser rather than by hand, so a stored term is
-- guaranteed to be in the same shape the matcher will compare against.
insert into public.blocked_terms (term, category, match_mode)
select public.moderation_normalize(t.term), t.category, t.match_mode
  from (values
    -- Racial and ethnic slurs. Substring, with the padded spellings listed
    -- out because repeats are not collapsed.
    ('nigger', 'slur', 'substring'),
    ('niggerr', 'slur', 'substring'),
    ('nigga', 'slur', 'substring'),
    ('niggas', 'slur', 'substring'),
    ('chink', 'slur', 'substring'),
    ('gook', 'slur', 'substring'),
    ('spic', 'slur', 'substring'),
    ('wetback', 'slur', 'substring'),
    ('kike', 'slur', 'substring'),
    ('towelhead', 'slur', 'substring'),
    ('raghead', 'slur', 'substring'),
    ('coon', 'slur', 'word'),
    ('jigaboo', 'slur', 'substring'),
    ('beaner', 'slur', 'substring'),
    ('heil hitler', 'slur', 'substring'),
    ('whitepower', 'slur', 'substring'),
    -- Homophobic and transphobic slurs.
    ('faggot', 'slur', 'substring'),
    ('faggit', 'slur', 'substring'),
    ('fagot', 'slur', 'substring'),
    ('tranny', 'slur', 'substring'),
    ('shemale', 'slur', 'substring'),
    ('dyke', 'slur', 'word'),
    -- Ableist slurs.
    ('retard', 'slur', 'substring'),
    ('retarded', 'slur', 'substring'),
    ('sperg', 'slur', 'word'),
    -- Sexual content. Kept tight: this is a game with real athletes' names in
    -- it, and half the obvious entries here appear inside real surnames.
    ('rape', 'sexual', 'word'),
    ('rapist', 'sexual', 'substring'),
    ('molest', 'sexual', 'substring'),
    ('pedophile', 'sexual', 'substring'),
    ('pedo', 'sexual', 'word'),
    ('childporn', 'sexual', 'substring'),
    ('cp', 'sexual', 'exact'),
    ('blowjob', 'sexual', 'substring'),
    ('handjob', 'sexual', 'substring'),
    ('cumshot', 'sexual', 'substring'),
    ('deepthroat', 'sexual', 'substring'),
    ('creampie', 'sexual', 'substring'),
    ('porn', 'sexual', 'word'),
    ('porhub', 'sexual', 'substring'),
    ('pornhub', 'sexual', 'substring'),
    ('onlyfans', 'sexual', 'substring'),
    -- Harassment and self-harm.
    ('killyourself', 'harassment', 'substring'),
    -- 'word', not 'exact': the harassment that matters is "you should kys",
    -- which an exact match on the whole message never sees. Word mode still
    -- leaves names like Kyshawn alone.
    ('kys', 'harassment', 'word'),
    ('killurself', 'harassment', 'substring'),
    -- Names that imply the account speaks for us.
    ('draftnova', 'reserved', 'substring'),
    ('admin', 'reserved', 'exact'),
    ('administrator', 'reserved', 'exact'),
    ('moderator', 'reserved', 'exact'),
    ('staff', 'reserved', 'exact'),
    ('support', 'reserved', 'exact'),
    ('official', 'reserved', 'exact'),
    ('system', 'reserved', 'exact'),
    ('root', 'reserved', 'exact'),
    ('deleted player', 'reserved', 'exact')
  ) as t(term, category, match_mode)
on conflict (term) do nothing;

-- ---- The matcher ---------------------------------------------------------

create or replace function public.moderation_blocked_category(p_text text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select bt.category
    from public.blocked_terms bt
   where (bt.match_mode = 'substring'
            and public.moderation_normalize(p_text) like '%' || bt.term || '%')
      or (bt.match_mode = 'word'
            and public.moderation_normalize_words(p_text) like '% ' || bt.term || ' %')
      or (bt.match_mode = 'exact'
            and public.moderation_normalize(p_text) = bt.term)
   limit 1;
$$;

-- Every refusal in this file goes through here, so a player gets the same
-- sentence wherever they hit the rule, and the sentence points at the page
-- that explains it.
create or replace function public.moderation_reject(p_text text, p_field text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_category text := public.moderation_blocked_category(p_text);
begin
  if v_category is null then
    return;
  end if;
  if v_category = 'reserved' then
    raise exception 'That % is reserved. Pick another one.', p_field
      using errcode = 'P0001';
  end if;
  raise exception 'That % breaks the Community Guidelines. Pick something else.', p_field
    using errcode = 'P0001';
end;
$$;

-- ---- Usernames -----------------------------------------------------------
-- The format rule existed only in the browser until now, which meant a
-- 300-character username with newlines in it was one fetch() away.

create or replace function public.enforce_profile_username_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;

  if new.username !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Usernames are 3-20 characters: letters, numbers or underscores.'
      using errcode = 'P0001';
  end if;

  perform public.moderation_reject(new.username, 'username');
  return new;
end;
$$;

drop trigger if exists profiles_username_policy on public.profiles;
create trigger profiles_username_policy
  before insert or update of username on public.profiles
  for each row execute function public.enforce_profile_username_policy();

-- ---- Squad identity ------------------------------------------------------

create or replace function public.enforce_squad_text_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.moderation_reject(new.name, 'squad name');
  perform public.moderation_reject(new.tag, 'squad tag');
  if coalesce(new.motto, '') <> '' then
    perform public.moderation_reject(new.motto, 'squad motto');
  end if;
  return new;
end;
$$;

drop trigger if exists squads_text_policy on public.squads;
create trigger squads_text_policy
  before insert or update of name, tag, motto on public.squads
  for each row execute function public.enforce_squad_text_policy();

-- ---- Squad chat ----------------------------------------------------------
-- Content plus a rate limit. The rate limit is moderation too: the cheapest
-- way to make a chat unusable is not a slur, it is two hundred messages.

create index if not exists squad_messages_user_created_idx
  on public.squad_messages (user_id, created_at desc);

create or replace function public.enforce_squad_message_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
begin
  perform public.moderation_reject(new.body, 'message');

  select count(*) into v_recent
    from public.squad_messages
   where user_id = new.user_id
     and created_at > now() - interval '10 seconds';

  if v_recent >= 6 then
    raise exception 'Slow down - you are sending messages too quickly.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists squad_messages_policy on public.squad_messages;
create trigger squad_messages_policy
  before insert on public.squad_messages
  for each row execute function public.enforce_squad_message_policy();

-- ---- Reports -------------------------------------------------------------
-- What catches everything the list does not. RLS on with no policies: a
-- report is written by the RPC below and read by us, never by a client -
-- neither the reporter's identity nor the fact a report exists should be
-- visible to the reported player.

create table if not exists public.message_reports (
  id bigint generated always as identity primary key,
  message_id bigint references public.squad_messages(id) on delete cascade,
  reported_user_id uuid references auth.users(id) on delete set null,
  reporter_id uuid references auth.users(id) on delete set null,
  reason text not null check (char_length(reason) <= 300),
  message_body text not null,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);

alter table public.message_reports enable row level security;

create index if not exists message_reports_open_idx
  on public.message_reports (status, created_at desc);

-- One report per person per message. A second attempt is a no-op rather than
-- an error: the player pressed the button twice, they do not need telling off.
create unique index if not exists message_reports_one_per_reporter
  on public.message_reports (message_id, reporter_id);

-- The message body is copied into the report on purpose. A report whose
-- evidence can be deleted by the person being reported is not evidence.
create or replace function public.report_squad_message(p_message_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_message record;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  select m.id, m.user_id, m.body, m.squad_id into v_message
    from public.squad_messages m
   where m.id = p_message_id;

  if v_message.id is null then
    raise exception 'That message no longer exists.' using errcode = 'P0001';
  end if;

  -- Only somebody who can see the message may report it, so the RPC cannot be
  -- used to read squad chat from outside the squad by probing ids.
  if not public.is_squad_member(v_message.squad_id, v_uid) then
    raise exception 'You can only report messages in your own squad.' using errcode = 'P0001';
  end if;

  insert into public.message_reports (message_id, reported_user_id, reporter_id, reason, message_body)
  values (p_message_id, v_message.user_id, v_uid, coalesce(nullif(btrim(p_reason), ''), 'No reason given'), v_message.body)
  on conflict (message_id, reporter_id) do nothing;
end;
$$;

revoke all on function public.report_squad_message(bigint, text) from public;
grant execute on function public.report_squad_message(bigint, text) to authenticated;

-- ---- Pre-flight check for sign-up ---------------------------------------
-- Sign-up creates the profile through a trigger on auth.users, so a rejected
-- username surfaces as a generic "database error saving new user" - accurate,
-- useless. This lets the client ask first and say something a human can act
-- on. It is a convenience, not the enforcement: the trigger above is.
--
-- Returns null when the name is fine, or the reason it is not.

create or replace function public.username_rejection_reason(p_username text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_username !~ '^[A-Za-z0-9_]{3,20}$' then
    return 'Usernames are 3-20 characters: letters, numbers or underscores.';
  end if;
  if public.moderation_blocked_category(p_username) = 'reserved' then
    return 'That username is reserved. Pick another one.';
  end if;
  if public.moderation_blocked_category(p_username) is not null then
    return 'That username breaks the Community Guidelines. Pick something else.';
  end if;
  return null;
end;
$$;

revoke all on function public.username_rejection_reason(text) from public;
grant execute on function public.username_rejection_reason(text) to anon, authenticated;
