# CLAUDE.md

# DraftNova Engineering Constitution

## Mission

DraftNova is a production-quality sports platform designed to provide accurate,
fast, and modern sports information across multiple leagues. Every engineering
decision should prioritize maintainability, scalability, consistency, performance,
and data accuracy over short-term convenience.

The application should be built to support millions of future records, multiple
sports, historical seasons, and ongoing feature expansion without requiring
architectural rewrites.

---

# WHAT THIS CODEBASE ACTUALLY IS, TODAY

Read this before applying anything below it. The Constitution describes where
DraftNova is going; this section describes where it is, and the gap between
them is real. Applying a standard that assumes infrastructure we do not have
produces worse code, not better.

**Draft Nova is a static site with no build step.** The browser loads ES
modules directly. Serve the root over HTTP (`python3 -m http.server 8000`);
opening `index.html` from disk will not work.

- There is **no `/services` layer**, no REST API, and no component framework.
  The per-sport service interface the Constitution describes already exists in
  spirit as `js/sports/<id>/index.js`, which every sport implements and
  `scripts/verify-sport-contract.mjs` enforces. Build on that rather than
  introducing a parallel `/services` tree.
- There is **no component library**. Shared UI is `js/ui.js`, one file of
  render functions. "Never duplicate components" applies to it directly.
- The **only backend** is Supabase: Postgres plus one Edge Function
  (`simulate-match`). "API layer" means that function and the Postgres RPCs.
- **Two sports exist: NBA and NFL**, and both are live. NHL and Soccer were
  announced tiles with no dataset, engine or ruleset and have been removed;
  MLB and college sports never existed. The `preview` flag and the
  `.sport-card.locked` state in `js/sports/index.js` are unused today and are
  kept deliberately: they are how sport number three gets its screens looked
  at before it can be played.

Where a Constitution rule cannot yet be honoured, say so in the Engineering
Report rather than pretending it was.

---

# Core Engineering Principles

Every implementation should be:

- Production ready
- Modular
- Reusable
- Easy to maintain
- Easy to extend
- Consistent with existing architecture

Never build "temporary" solutions. If there is a proper engineering solution, use it.

---

# Development Workflow

Before writing any code:

1. Understand the request.
2. Determine the scope.
3. Identify all affected systems.
4. Consider whether reusable code already exists.
5. Explain the implementation plan.
6. Then begin coding.

Never immediately start modifying files without understanding the overall impact.

---

# Request Scope Classification

Every feature request must first determine whether it affects: Entire Application,
Shared UI Components, Shared Backend Services, Shared Database, Single Sport,
Single League, Single Screen, Single Component, Single API, or Single Database Table.

If the intended scope is unclear, ask for clarification before implementing.

**Never accidentally apply a global change to one sport, or vice versa.** This is
the single most expensive mistake made in this codebase to date: shared code
reaching for basketball's constants dealt PG/SG/SF/PF/C in an NFL draft, and a
per-sport hook added for football blanked the basketball draft board. See
"Rules that bite" below.

---

## Rules that bite

- **One folder per sport.** `js/sports/<id>/` holds that sport's engine, constants,
  gamestyles, recap and draft grade. Shared code must never import a sport
  directly — ask `activeSport()` from `js/sports/index.js`. `js/constants.js` is
  app-wide only (clocks, timeouts); simulation numbers live with their sport.
- **Engine parity.** Each sport's `engine.js`, `constants.js` and `tactics.js` are
  vendored into `supabase/functions/simulate-match/sports/<id>/`. Change one, copy
  it across, or online games diverge from offline ones. `npm run verify:parity`
  checks every sport that has both.
- **The server does not read the pool at runtime.** Its rating context is baked
  at build time into `supabase/functions/simulate-match/sports/<id>/stats.generated.js`
  by `npm run bake`, because deriving it per request paged the whole table in
  every time — the isolate cache never survives (12 boots served 6 requests), so
  an online football match cost ~19MB of egress. Regenerate a dataset, re-run
  `npm run bake`; `npm run verify:baked` fails the build if you did not, and the
  server falls back to a full read (loudly) if a live `count(*)` disagrees with
  what was baked.
- **Balance is solved, not picked.** Gamestyle `pts` mods, `TALENT_PARITY` and the
  quarter-variance range come from `tools/calibrate-*.mjs`. Re-run after any engine
  or gamestyle change, variance first, then gamestyles.
- **`data/` is data, not code — don't read or search it.** Three generated JSON
  files totalling 7MB: `nba-players.json` (10,290 rows, 2.3MB),
  `nfl-players.json` (9,456 rows, 2.6MB) and `nfl-units.json` (4,975 rows,
  2.2MB). The count in this note used to read "2,542 rows (516 KB)", which was
  four times short and years stale — a reason to state a shape rather than a
  size. Open one only when changing gameplay or the simulation and you actually
  need a player's numbers; never while writing app code.
  Nothing imports them directly: Node goes through `data/load.mjs`, the browser
  through `js/lib/dataset.js`, and that is what made converting them from ES
  modules to JSON a one-file change rather than a twenty-two-file one. See
  `data/README.md`. They are generated from `tools/seasons/*` (not committed);
  never hand-edit — see `tools/README.md`.
- **Roster shapes vary by mode** (5 / 6 / 10 slots). Derive slots from the roster,
  never assume a shape.
- **`db/` is documentation, not a migration runner** — write the file, then apply it
  live. Keep the two in step.

## Verify before pushing

```
npm run verify            # parity + build
npm run verify:selftest   # real Chromium, BOTH sports: sign-in → draft → strategy →
                          # sim → post-game, layout at 360px (~8 min; add
                          # -- --sport=nfl to run one)
```

## Deployment

GitHub Pages serves the repo root from `main`. Pushing to `main` updates the live
site immediately. The Edge Function deploys separately
(`supabase functions deploy simulate-match`) and migrations are applied by hand, so
a change touching all three lands in stages — make client code tolerate a server
that hasn't caught up yet.

---

# Frontend Standards

The frontend is one unified design system. Never duplicate UI components.

Shared UI lives in `js/ui.js`. All spacing, typography, colors, shadows, and
animations stay consistent. Per-sport identity is expressed through the four
theme custom properties each sport declares, not through separate stylesheets.

---

# Backend Standards

Business logic never lives inside UI rendering.

Separate: UI, business logic, API layer, database layer, utility functions.

Each sport has its own module behind a common interface — `js/sports/<id>/index.js`.
Every live sport must implement the full contract; `npm run verify:contract`
fails the build otherwise. Add a hook to shared code, add its name to that test.

---

# Sports Data Standards

Accuracy is the highest priority. Never fabricate data. Never estimate statistics.
Never invent rankings. Never guess player information.

Every piece of data originates from a trusted source. Historical data is immutable
unless corrected by the official source.

Datasets are GENERATED, never hand-edited. `data/nba-players.json` comes from
`tools/build-nba-data.mjs`; `data/nfl-players.json` and `data/nfl-units.json` from
`tools/build-nfl-data.mjs`. Fix the tool, re-run it, commit the output.

---

# Season Architecture

Unlimited seasons. Adding a season is a data update, not a code change.
Both live sports are stored per player per team per season, so a pick resolves
to a specific year rather than a blended average.

---

# Database Standards

Design for long-term scalability. Avoid duplicated information. Normalize
appropriately. Every entity has a stable unique identifier. Model relationships
explicitly instead of duplicating data.

`db/` is DOCUMENTATION of what was applied, not a migration runner — write the
file, then apply it live, and keep the two in step. Never rewrite an applied
migration; add a new one.

---

# API Standards

Predictable, consistent, documented, well validated. Never expose internal
implementation details. Return consistent response structures.

PostgREST resolves an RPC by its exact ARGUMENT NAMES, so an unmatched set reads
as a missing function rather than a type error. Client code must tolerate a
server that has not caught up yet.

---

# Performance

Optimize continuously. Minimize database queries, API calls, rerenders, bundle
size, page load time. Use lazy loading, caching, pagination, and efficient
indexing.

Expensive derived state is built once and memoised. Rebuilding a rating index
per rendered row froze the browser on a single click.

---

# Mobile Standards

Everything works on desktop, tablet, and mobile, portrait and landscape. No
overlapping UI, no clipped content, no horizontal page scrolling. `npm run
verify:selftest` checks layout at 360px.

---

# Accessibility

Keyboard navigation, screen readers, proper contrast, semantic HTML, accessible
forms, visible focus states. Never an afterthought. A sport's `accentContrast`
must clear 4.5:1 against its `accent`.

---

# Security

Never expose secrets. Never hardcode credentials. Validate every input. Sanitize
user input. Protect against SQL injection, XSS, CSRF, rate abuse, unauthorized
access. Client-side validation is never sufficient by itself — the server decides
what a pick is worth, never the client.

---

# Error Handling

Never allow silent failures. Every error either recovers gracefully or provides
useful debugging information.

A missing value that defaults to something plausible is a silent failure. An
unfilled roster slot rating 0.5 instead of failing hid a draft that could never
complete, because the simulation still produced believable output.

---

# Logging

Log authentication, API, database, exception, and background-job failures. Never
log sensitive user information.

---

# Code Organization

One responsibility per file. Avoid giant files and giant components. Prefer many
small reusable modules. Prefer readable code over clever code.

---

# Naming Conventions

Descriptive names. Avoid abbreviations unless universally understood. Favor
readability over brevity.

---

# Reusability

Before creating anything new, determine whether it already exists. Avoid
duplicate logic, styling, APIs, and database queries.

---

# Documentation

Every significant feature documents purpose, architecture, files affected,
database changes, API changes, future extension points, and known limitations.

Comments explain WHY, not what. Match the density of the surrounding file.

---

# Git Standards

One logical change per commit. Meaningful commit messages. Never combine
unrelated work.

---

# Verify Before Pushing

```
npm run verify            # build stamp + parity + sport contract
npm run verify:selftest   # real Chromium, BOTH sports: sign-in -> draft -> strategy ->
                          # sim -> post-game, layout at 360px (~8 min; add
                          # -- --sport=nfl to run one)
```

A passing `verify` means the modules parse and the contracts hold. It does NOT
mean the app runs. Two blank-screen bugs shipped past a green verify because
nothing loaded a page. Load the page.

---

# Deployment

GitHub Pages serves the repo root from `main`; pushing to `main` updates the live
site. `index.html` loads `js/main.js?v=<commit>`, stamped by `tools/stamp-build.mjs`
on every verify — without it browsers serve stale modules indefinitely.

The Edge Function deploys via `.github/workflows/deploy-edge-function.yml` on push,
and migrations are applied by hand, so a change touching all three lands in stages.
Make client code tolerate a server that has not caught up.

---

# Definition of Done

- Functionality works
- Existing functionality remains intact
- Mobile tested
- Desktop tested
- Edge cases considered
- Error handling added
- Performance considered
- Documentation updated
- Code follows project architecture
- No unnecessary duplication introduced

---

# Engineering Report

At the completion of every task, provide: Summary, Files Modified, Files Added,
Files Removed, Database Changes, API Changes, Global vs Sport-Specific Impact,
Potential Risks, Testing Performed, Future Recommendations, Known Limitations.

State plainly what was NOT verified. "Tests pass" is not "I watched it work".

---

# AI Decision Making

If multiple approaches exist, choose the one that best supports future
scalability, maintainability, and consistency.

If a requested implementation conflicts with existing architecture: explain the
conflict, recommend a better solution, and do not silently introduce
architectural debt.

---

# Never Do These Things

Never hardcode sports data. Never duplicate components or business logic. Never
create one-off implementations. Never fabricate statistics. Never guess API
responses. Never remove code without verifying dependencies. Never ignore
performance implications. Never sacrifice architecture for speed. Never implement
features that cannot be maintained. Never assume whether a request is global or
sport-specific.

---

# Primary Objective

Every decision should make DraftNova easier to maintain, scale, understand,
expand, test, debug, and update. The codebase should become cleaner after every
feature. Future developers — including future AI agents — should immediately
understand how the application works.
