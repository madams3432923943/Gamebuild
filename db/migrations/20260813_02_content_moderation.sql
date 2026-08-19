-- BACKFILL. Applied live on 2026-08-13 as `content_moderation`; this file was
-- written on 2026-08-19 from the live definitions. It was missing from db/
-- entirely, which meant a whole subsystem - a table with 54 rows in it and
-- three triggers enforcing rules on every username and squad message - existed
-- only in production. scripts/verify-schema-documented.mjs now fails when a
-- migration is applied without a file.
--
-- THE TERM LIST IS NOT IN THIS FILE. `blocked_terms` holds slurs and sexual
-- content by definition, and committing that list would put it in the repo, in
-- every clone, and in every search of it. The schema is here; the rows are data
-- and are managed live. `select count(*) from public.blocked_terms` is the
-- check that it is populated.
--
-- NORMALIZE BEFORE MATCHING. A blocklist that compares raw text is defeated by
-- "sl.ur", "SLUR" and "5lur" in the first ten minutes. Both normalizers fold
-- case, map the obvious character substitutions, and strip punctuation - one to
-- a bare string for substring matching, one to space-delimited words so a term
-- can be required to stand alone. That is why 'word' mode exists: an innocent
-- name containing a blocked substring should not be refused, and a term that
-- IS a word should not need a hundred exceptions.

create table if not exists public.blocked_terms (
  term text primary key,
  category text not null check (category in ('slur', 'sexual', 'harassment', 'reserved', 'spam')),
  -- 'substring' catches it anywhere, 'word' only as a standalone word,
  -- 'exact' only as the entire value. Chosen per term, because the right
  -- answer differs per term.
  match_mode text not null default 'substring' check (match_mode in ('substring', 'word', 'exact')),
  created_at timestamptz not null default now()
);

-- Read only through the SECURITY DEFINER functions below. A client that could
-- read this table could enumerate the blocklist, which is both a way around it
-- and a thing nobody should have to look at.
alter table public.blocked_terms enable row level security;
revoke all on public.blocked_terms from anon, authenticated;

create table if not exists public.message_reports (
  id bigserial primary key,
  message_id bigint references public.squad_messages(id) on delete cascade,
  reported_user_id uuid references auth.users(id) on delete set null,
  reporter_id uuid references auth.users(id) on delete set null,
  reason text not null check (char_length(reason) <= 300),
  -- The message text is COPIED, not just referenced. A report whose evidence
  -- disappears when the message is deleted is not evidence.
  message_body text not null,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);

create unique index if not exists message_reports_one_per_reporter
  on public.message_reports (message_id, reporter_id);
create index if not exists message_reports_open_idx
  on public.message_reports (status, created_at desc);

alter table public.message_reports enable row level security;
revoke all on public.message_reports from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Normalizers
-- ---------------------------------------------------------------------------

create or replace function public.moderation_normalize(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
           translate(lower(coalesce(p_text, '')), '0134578@$!|', 'oieastbasii'),
           '[^a-z0-9]', '', 'g'
         );
$$;

-- The same folding, but keeping word boundaries and padded with spaces at both
-- ends, so `like '% term %'` matches a first or last word too.
create or replace function public.moderation_normalize_words(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select ' ' || btrim(regexp_replace(
           regexp_replace(
             translate(lower(coalesce(p_text, '')), '0134578@$!|', 'oieastbasii'),
             '[^a-z0-9]+', ' ', 'g'
           ),
           '\s+', ' ', 'g'
         )) || ' ';
$$;

-- ---------------------------------------------------------------------------
-- The rule, asked two ways
-- ---------------------------------------------------------------------------

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

-- Raises. Used by the triggers, where refusing the write IS the outcome.
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

-- ANSWERS instead of raising, and this is the one the client calls.
--
-- The username trigger fires inside Supabase's own sign-up transaction (via
-- handle_new_user on auth.users), so its readable message never reaches the
-- browser - the API returns "Database error saving new user". Asking this
-- first is how sign-up can say what is actually wrong. It returns the reason
-- only, never the matched term, and it is the single function `anon` is
-- granted, because a username is chosen before there is a session.
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

-- ---------------------------------------------------------------------------
-- Enforcement
-- ---------------------------------------------------------------------------

create or replace function public.enforce_profile_username_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- An UPDATE that does not touch the username is not a rename. Without this,
  -- every profile write - after every game - would re-run the blocklist, and a
  -- term added later would lock an existing player out of their own record.
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

-- Content rule and a BURST limit in one trigger. Six messages in ten seconds is
-- faster than anyone types and is aimed at a paste-flood; the sustained cap
-- (20/minute) is separate, in db/migrations/20260819_02_rpc_rate_limits.sql,
-- because the two catch different things and neither implies the other.
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

  -- You can only report what you could see. Without this the message id alone
  -- would let anyone pull any squad's chat text into a report row.
  if not public.is_squad_member(v_message.squad_id, v_uid) then
    raise exception 'You can only report messages in your own squad.' using errcode = 'P0001';
  end if;

  insert into public.message_reports (message_id, reported_user_id, reporter_id, reason, message_body)
  values (p_message_id, v_message.user_id, v_uid, coalesce(nullif(btrim(p_reason), ''), 'No reason given'), v_message.body)
  on conflict (message_id, reporter_id) do nothing;
end;
$$;

drop trigger if exists profiles_username_policy on public.profiles;
create trigger profiles_username_policy
  before insert or update of username on public.profiles
  for each row execute function public.enforce_profile_username_policy();

drop trigger if exists squads_text_policy on public.squads;
create trigger squads_text_policy
  before insert or update of name, tag, motto on public.squads
  for each row execute function public.enforce_squad_text_policy();

drop trigger if exists squad_messages_policy on public.squad_messages;
create trigger squad_messages_policy
  before insert on public.squad_messages
  for each row execute function public.enforce_squad_message_policy();

-- Grants live in the manifest at db/migrations/20260819_01, not here.
