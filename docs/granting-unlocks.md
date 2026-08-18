# Granting banners, badges and icons

The owner's override. A grant is a row edit, not a release: it takes effect on
the player's next page load, with no deploy and no wait on GitHub Pages.

## Why it is not code

The first version of "give the founder every banner" was a hardcoded username
check in `js/banners.js`. It worked, and it made every future favour — a friend,
a tester, an apology for a bug — into a code change, a test run, a push, and a
Pages deploy that has failed with a 503 more than once in a single afternoon.
The data shape costs one `UPDATE`.

## The one rule

**Grants are cosmetic.** Banners and badges are decoration; ratings, records and
match results are written by the trusted server (`finalize_match_result`) and are
never grantable. A ladder you can be given a place on is not a ladder — it is the
one thing that would make every other player's rank meaningless. If a future
grant type is not cosmetic, it does not belong in these columns.

## Where it lives

Two `jsonb` arrays of ids on `public.profiles`:

| Column            | Holds                                                  |
| ----------------- | ------------------------------------------------------ |
| `granted_banners` | banner ids from `FRANCHISES` + `GENERAL_BANNERS` (`js/banners.js`) |
| `granted_badges`  | badge ids from `BADGES` (`js/badges.js`)               |
| `granted_icons`   | icon ids from `GENERAL_ICONS` + `TEAM_ICONS` (`js/icons.js`) |

Icon ids follow the same rules. Team icons are namespaced `team-<franchise>`
(`team-bulls`, `team-nfl-packers`) so they cannot be confused with the bare
franchise id a **banner** grant uses; `scripts/verify-icons.mjs` fails the build
if the two namespaces ever overlap.

Arrays, not maps of booleans: the only question ever asked is "is this id in the
list", and an array cannot drift into holding `false` values that read as
present-but-off. Unknown ids are ignored, so a typo grants nothing rather than
breaking a screen, and an id written for a banner that ships next week starts
working the day it does.

A granted unlock is flagged `granted: true` rather than disguised as earned, and
a granted badge lands at its **top** tier — a grant that produced Bronze would
leave the player grinding for something they were given.

## Recipes

Run these in the Supabase SQL editor.

Every general banner for one player:

```sql
select public.grant_all_general_banners('zfolts4');
```

One specific banner, keeping whatever they already have:

```sql
update public.profiles
set granted_banners = (
  select jsonb_agg(distinct id) from (
    select jsonb_array_elements_text(coalesce(granted_banners, '[]'::jsonb)) as id
    union select 'nfl-eagles'
  ) merged
)
where username = 'zfolts4';
```

A badge at its top tier:

```sql
update public.profiles
set granted_badges = granted_badges || '["gunslinger"]'::jsonb
where username = 'madams';
```

Take a grant back:

```sql
update public.profiles
set granted_banners = granted_banners - 'nfl-eagles'
where username = 'zfolts4';
```

Check what someone has:

```sql
select username, granted_banners, granted_badges
from public.profiles where username = 'madams';
```

## Finding ids

Ids are the catalogue's own, not display names:

```
node -e "import('./js/banners.js').then(m => console.log(m.GENERAL_BANNERS.map(b => b.id).join(', ')))"
node -e "import('./js/badges.js').then(m => console.log(m.BADGES.map(b => b.id).join(', ')))"
```

## What holds it in place

`npm run verify:banner-grants` (in the `verify` chain). An override that unlocks
things is exactly the code that gets generalised by accident — a truthy test, a
renamed field, a profile that arrives without the column — and the failure is
silent and generous: everyone gets everything and nothing looks broken. The suite
pins the baseline (no grant unlocks nothing), the narrowness (granting one thing
grants only that thing), the failure modes (missing, null, string, object and junk
ids all deny), and the shape of what a grant may return.

## Known limitations

- No admin UI. Grants are SQL, deliberately — the audience is one person.
- No record of who granted what or when. If grants become common, add a
  `granted_by` / `granted_at` audit table rather than widening these columns.
- Migration: `db/migrations/20260817_01_granted_unlocks.sql`, applied live.
