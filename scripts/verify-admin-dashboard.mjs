#!/usr/bin/env node
// The admin dashboard: its authorization model, and what it does with a metric
// it does not have.
//
// WHY THIS EXISTS
//
// TWO THINGS ON THIS PAGE CAN BE WRONG IN A WAY NOBODY NOTICES.
//
// 1. AUTHORIZATION. admin.html is a static file on a static host. Anyone can
//    fetch it, read it and call what it calls, so if any number on it came
//    from a table read rather than from a guarded RPC, the dashboard would be
//    open to every signed-in player - and it would look exactly the same to
//    the person who built it. That property is checked live against the
//    database by the grant assertions further down; what this file checks is
//    that the PAGE has no other way to get data, which is the half a migration
//    cannot enforce.
//
// 2. A METRIC THAT CANNOT BE CALCULATED. The brief was explicit: do not fake
//    one. Retention before a cohort has closed, and games-per-active-user
//    before there is an active user, are genuinely unknown - and the natural
//    thing for a renderer to do with a null is print 0, or 0%, which on a
//    business dashboard is not "no data", it is a finding. Somebody plans
//    around a 0% Day-1 retention that was never measured.
//
// The render is tested in a browser because it builds DOM, and it is separate
// from js/admin/main.js precisely so it can be: main.js is the part that talks
// to Supabase, this is the part that turns a document into a page.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.BK_ADMIN_PORT || 8943);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function serve(root, port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/" || rel.endsWith("/")) rel += "index.html";
      const file = path.join(root, rel);
      if (!file.startsWith(root)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

// A day of real-looking data, and a day with nothing measured yet. The second
// is the one that matters: it is the state the dashboard is in right now.
const POPULATED = {
  generated_at: "2026-09-11T14:00:00Z",
  users: { total: 1842, today: 17, this_week: 121, this_month: 466 },
  activity: { dau: 210, wau: 705, mau: 1310, tracking_since: "2026-08-01" },
  games: { today: 340, this_week: 2210, this_month: 8904, total: 41203 },
  by_sport: { nba: 24000, nfl: 17203 },
  by_mode: { practice: 30000, ranked: 10203, friend: 1000 },
  by_difficulty: { easy: 9000, medium: 15000, hard: 6000 },
  engagement: {
    games_per_active_user: 6.8,
    games_per_active_user_days: 30,
    accounts_with_no_completed_game: 402,
    first_game_completion_rate: 0.7818,
  },
};

const EMPTY = {
  generated_at: "2026-09-11T14:00:00Z",
  users: { total: 18, today: 1, this_week: 8, this_month: 12 },
  activity: { dau: 0, wau: 0, mau: 0, tracking_since: null },
  games: { today: 0, this_week: 0, this_month: 0, total: 50 },
  by_sport: { nba: 22, nfl: 28 },
  by_mode: { ranked: 50 },
  by_difficulty: {},
  engagement: {
    // THE NULLS. Both are genuinely unknown, and neither may be drawn as zero.
    games_per_active_user: null,
    games_per_active_user_days: null,
    accounts_with_no_completed_game: 2,
    first_game_completion_rate: 0.8889,
  },
};

const FUNNEL = {
  days: 30,
  events: {
    signup_completed: { users: 121, count: 121 },
    onboarding_viewed: { users: 118, count: 118 },
    onboarding_completed: { users: 92, count: 92 },
    sport_selected: { users: 110, count: 260 },
    game_completed: { users: 88, count: 940 },
  },
  retention: {
    tracking_since: "2026-08-01",
    day_1: { cohort: 100, retained: 41, rate: 0.41 },
    day_7: { cohort: 80, retained: 18, rate: 0.225 },
  },
};

const FUNNEL_NO_COHORT = {
  days: 30,
  events: {},
  retention: { tracking_since: null, day_1: null, day_7: null },
};

async function main() {
  const server = await serve(ROOT, PORT);
  const browser = await chromium.launch({ headless: true });
  const checks = [];
  const add = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

  // ---- static: the page has no data of its own ----------------------------
  const adminHtml = await readFile(path.join(ROOT, "admin.html"), "utf8");
  const adminMain = await readFile(path.join(ROOT, "js/admin/main.js"), "utf8");
  const migration = await readFile(path.join(ROOT, "db/migrations/20260911_03_admin_dashboard.sql"), "utf8");

  // EVERY number has to come through one of the two guarded RPCs. A .from()
  // anywhere in this page's code is a direct table read, which RLS on
  // `profiles` would happily serve to any signed-in player.
  add(
    "The dashboard reads no table directly",
    !/\.from\s*\(/.test(adminMain),
    /\.from\s*\(/.test(adminMain)
      ? "found a .from() - a table read is not covered by is_admin()"
      : "every figure comes from admin_overview() or admin_funnel()"
  );

  add(
    "Both aggregates check is_admin() before returning anything",
    (migration.match(/if not public\.is_admin\(\) then\s*\n\s*raise exception 'Not authorized\.' using errcode = '42501';/g) || []).length === 2,
    "admin_overview and admin_funnel each raise 42501 for a non-admin"
  );

  // The allowlist must not be on `profiles`, which is publicly readable - that
  // would publish the list of administrators to every visitor.
  add(
    "The admin allowlist is its own table, not a column on profiles",
    /create table if not exists public\.admin_users/.test(migration) &&
      !/alter table public\.profiles[\s\S]{0,120}is_admin/.test(migration),
    "profiles is publicly readable; a flag there would name every administrator"
  );

  add(
    "The allowlist table has RLS on and no client grants",
    /alter table public\.admin_users enable row level security/.test(migration) &&
      /revoke all on table public\.admin_users from anon, authenticated/.test(migration),
    "only SECURITY DEFINER code can see inside it"
  );

  add(
    "admin.html is kept out of search results",
    /<meta name="robots" content="noindex, nofollow"/.test(adminHtml) &&
      (await readFile(path.join(ROOT, "robots.txt"), "utf8")).includes("Disallow: /admin.html"),
    "noindex and robots.txt - neither is what protects it, and both are worth having"
  );

  // ---- the render ---------------------------------------------------------
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/admin.html`);

    const read = async (overview, funnel) =>
      page.evaluate(
        async ([o, f]) => {
          const { renderDashboard } = await import("/js/admin/render.js");
          const host = document.getElementById("admin-body");
          host.hidden = false;
          renderDashboard(host, o, f);
          const stats = [...host.querySelectorAll(".stat")].map((el) => ({
            label: el.querySelector(".stat-label")?.textContent || "",
            value: el.querySelector(".stat-value")?.textContent || "",
            note: el.querySelector(".stat-note")?.textContent || "",
          }));
          // The retention SECTION on its own, not the whole page. A check for
          // "0.0%" across host.textContent matches inside "100.0%", which a
          // single-mode breakdown legitimately prints - so the first version of
          // the no-cohort assertion failed on a correct page.
          const panelText = (title) => {
            const heading = [...host.querySelectorAll(".panel-title")].find((el) => el.textContent === title);
            return heading ? heading.parentElement.textContent : "";
          };

          return {
            text: host.textContent,
            retentionText: panelText("Retention"),
            activityText: panelText("Activity"),
            stats,
            panels: [...host.querySelectorAll(".panel-title")].map((el) => el.textContent),
            // Every breakdown table's own total row, so a breakdown whose parts
            // do not add up is visible rather than merely wrong.
            totals: [...host.querySelectorAll(".admin-table-total td")].map((el) => el.textContent).filter(Boolean),
            funnelRows: [...host.querySelectorAll(".admin-funnel tbody tr th")].map((el) => el.textContent),
            sidewaysScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
          };
        },
        [overview, funnel]
      );

    // ---- populated -------------------------------------------------------
    const full = await read(POPULATED, FUNNEL);
    add(
      "Every section renders",
      ["Users", "Activity", "Games", "By sport", "By mode", "Practice difficulty", "Engagement", "Retention", "Funnel"].every(
        (p) => full.panels.includes(p)
      ),
      full.panels.join(", ")
    );

    const dau = full.stats.find((s) => s.label === "DAU");
    add("DAU/WAU/MAU are shown", dau?.value === "210", `DAU ${dau?.value}`);

    add(
      "Large numbers are grouped",
      full.stats.some((s) => s.value === "41,203"),
      "41,203 rather than 41203 - a dashboard is read at a glance"
    );

    // A breakdown that does not visibly add up is the one people stop
    // trusting, so each table carries its own total.
    add(
      "Breakdowns show their own total",
      full.totals.includes("41,203") && full.totals.includes("30,000"),
      `totals rendered: ${full.totals.join(", ")}`
    );

    add(
      "Retention is shown as a percentage",
      full.retentionText.includes("41.0%") && full.retentionText.includes("22.5%"),
      "Day 1 41.0%, Day 7 22.5%"
    );

    add(
      "The funnel reads in the order the steps happen",
      full.funnelRows.indexOf("Signed up") === 0 &&
        full.funnelRows.indexOf("Saw the welcome") === 1 &&
        full.funnelRows.indexOf("Completed a game") > full.funnelRows.indexOf("Started a draft"),
      "a funnel sorted by size is not a funnel"
    );

    const gpu = full.stats.find((s) => s.label === "Games per active user");
    add(
      "Games per active user says how wide its window is",
      gpu?.value === "6.80" && /30 days/.test(gpu?.note || ""),
      `${gpu?.value} — "${gpu?.note}"`
    );

    // ---- THE EMPTY CASE, WHICH IS TODAY ----------------------------------
    const empty = await read(EMPTY, FUNNEL_NO_COHORT);

    const emptyGpu = empty.stats.find((s) => s.label === "Games per active user");
    add(
      "An unmeasurable rate is an em dash, not zero",
      emptyGpu?.value === "—",
      `games per active user rendered as "${emptyGpu?.value}" - 0.00 would be a finding, not a blank`
    );
    add(
      "And it says why it is blank",
      /no active players/i.test(emptyGpu?.note || ""),
      `"${emptyGpu?.note}"`
    );

    add(
      "Retention with no closed cohort says so instead of reading 0%",
      !/\d\.\d%/.test(empty.retentionText) && /not recorded a day|Nothing to measure/i.test(empty.retentionText),
      /\d\.\d%/.test(empty.retentionText)
        ? `printed a rate for a cohort that does not exist: "${empty.retentionText}"`
        : "explains that nothing has been measured"
    );

    add(
      "Zero activity is labelled as not-yet-measured",
      /No active days recorded yet/i.test(empty.activityText),
      "a 0 DAU because nothing was measured is not a 0 DAU because nobody played"
    );

    add(
      "An empty breakdown explains itself rather than rendering an empty table",
      /No practice game has recorded a difficulty yet/i.test(empty.text),
      "by_difficulty is {} on a project with no practice events"
    );

    // The rate that CAN be computed still is, so "shows em dashes" is not
    // passing by showing them everywhere.
    add(
      "A rate that can be computed is still computed",
      empty.text.includes("88.9%"),
      "first-game completion rate is knowable without activity tracking"
    );

    add("Nothing threw while rendering", errors.length === 0, errors.slice(0, 2).join(" | ") || "console clean");
    add("No horizontal page scroll at desktop width", !full.sidewaysScroll, "1280px");

    // ---- a phone ---------------------------------------------------------
    // An internal tool gets read on a phone more than anyone plans for.
    const mobile = await browser.newPage({ ...devices["iPhone 13"] });
    await mobile.goto(`http://127.0.0.1:${PORT}/admin.html`);
    const mobileState = await mobile.evaluate(
      async ([o, f]) => {
        const { renderDashboard } = await import("/js/admin/render.js");
        const host = document.getElementById("admin-body");
        host.hidden = false;
        renderDashboard(host, o, f);
        // The funnel table is allowed to scroll inside its own container; the
        // PAGE is not.
        return {
          sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
          scrollerWraps: !!host.querySelector(".table-scroll .admin-funnel"),
          width: window.innerWidth,
        };
      },
      [POPULATED, FUNNEL]
    );
    add(
      "No horizontal page scroll on a phone",
      !mobileState.sideways,
      `${mobileState.width}px viewport`
    );
    add(
      "The funnel table scrolls inside its own container",
      mobileState.scrollerWraps,
      "a table may be wider than the page; the page may not"
    );
    await mobile.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(renderSection("Admin dashboard"));
  for (const c of checks) console.log(renderCheck(c));
  const { counts, ok } = summarize(checks);
  console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
