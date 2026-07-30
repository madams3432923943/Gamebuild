-- Syncs the online `players` table to the same real dataset offline/bot
-- play has always used (js/data.js, 2542 players, sourced from Basketball
-- Reference per-game exports - see tools/README.md). Before this, `players`
-- was a much smaller, older placeholder seed: 1024 rows, uneven team/decade
-- coverage (e.g. only 3 teams had any 1970s rows, only 2020s had all 30
-- teams), and no shooting-split columns at all - so online box scores could
-- never show a shot line (js/shooting.js's shotLine() requires fga/fgp/
-- tpa/tpp/fta/ftp) and online matchmaking could randomly land on a
-- team/decade with too few players to draft a full squad.
--
-- Two steps, applied live in this order:

-- 1) Add the shooting-split columns js/data.js has always carried.
alter table public.players
  add column fga numeric,
  add column fgp numeric,
  add column tpa numeric,
  add column tpp numeric,
  add column fta numeric,
  add column ftp numeric;

-- 2) Enable the `http` extension so the replacement data can be fetched
-- directly from the repo rather than inlined as a 2542-row INSERT (far too
-- large to keep readable in a migration file or paste through tooling).
create extension if not exists http with schema extensions;

-- 3) Replace every row with db/seed/players.json (a JSON export of
-- js/data.js's PLAYERS array, committed alongside this migration). Aborts
-- if the fetch fails or the payload looks truncated, so a network hiccup
-- can't silently empty the table.
--
-- The 158 rows carried over from the 1960s/1970s model-recalled placeholder
-- squads (data.js's own header comment: "no shooting-split fields") come
-- through with fga/fgp/tpa/tpp/fta/ftp left NULL - same "no shooting
-- profile" semantics js/shooting.js's hasShootingProfile() already treats
-- specially offline, so nothing downstream needs new null-handling.
--
-- Re-running this later (e.g. after regenerating js/data.js from a newer
-- season import): regenerate db/seed/players.json from js/data.js, push it,
-- and re-run an equivalent fetch+replace block pointed at the new commit.
do $mig$
declare
  resp extensions.http_response;
  payload jsonb;
begin
  resp := extensions.http_get('https://raw.githubusercontent.com/madams3432923943/Gamebuild/claude/gambuild-file-purposes-7rxz2h/db/seed/players.json');
  if resp.status <> 200 then
    raise exception 'players.json fetch failed: status %', resp.status;
  end if;
  payload := resp.content::jsonb;

  if jsonb_array_length(payload) < 2000 then
    raise exception 'players.json payload looks too small (% rows) - aborting replace', jsonb_array_length(payload);
  end if;

  truncate table public.players restart identity;

  insert into public.players (name, team, decade, pos, ppg, rpg, apg, spg, bpg, tov, fga, fgp, tpa, tpp, fta, ftp)
  select
    (rec->>'name'),
    (rec->>'team'),
    (rec->>'decade'),
    array(select jsonb_array_elements_text(rec->'pos')),
    (rec->>'ppg')::numeric,
    (rec->>'rpg')::numeric,
    (rec->>'apg')::numeric,
    (rec->>'spg')::numeric,
    (rec->>'bpg')::numeric,
    (rec->>'tov')::numeric,
    (rec->>'fga')::numeric,
    (rec->>'fgp')::numeric,
    (rec->>'tpa')::numeric,
    (rec->>'tpp')::numeric,
    (rec->>'fta')::numeric,
    (rec->>'ftp')::numeric
  from jsonb_array_elements(payload) as rec;
end;
$mig$;

-- Verified post-apply: 2542 rows, 163 distinct team|decade squads (matching
-- js/data.js exactly), all 30 teams present for 2020s (vs 7 before), and
-- only the 158 known 1960s/70s placeholder rows lack shooting fields.
--
-- Two pre-existing "drafting" matches (round 1, one on the old
-- "Brooklyn/New Jersey Nets" 2000s squad name that this real dataset never
-- produces - the new build script only ever emits "Brooklyn Nets" or
-- "New Jersey Nets" separately) were left as-is rather than force-migrated;
-- they were stale single-round test artifacts, not active games, and at
-- worst show an empty draft pool if resumed.
