#!/usr/bin/env node
// First-run onboarding, in a real browser, on every profile state it can meet.
//
// WHY THIS EXISTS
//
// "Show it once" is one sentence and four failure modes, and three of them are
// worse than not shipping it:
//
//   Shown to an existing player. Somebody with a rank, a hundred games and a
//   banner is told "Welcome to Draft Nova" and shown how to draft. That is the
//   failure that would actually cost users, and it is exactly what happens if
//   the missing-column case is read as "not onboarded" - the column was added
//   in this sprint, so every client is newer than some database somewhere.
//   Shown again on the next visit, which is the same insult in slow motion.
//   Shown to nobody, because the flag was read from the wrong field - which
//   nothing surfaces at all: the welcome simply never appears and the funnel
//   quietly reports that every new player skipped it.
//   Blocking the app. A modal over the home screen with no way out, or one
//   that traps focus and cannot be dismissed by keyboard.
//
// None of those can be seen from reading the diff, because all of them depend
// on what a profile row happens to say. So this drives the real page with a
// stubbed Supabase whose profile is whatever the case under test needs.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.BK_ONBOARDING_PORT || 8941);

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

/**
 * A Supabase stand-in whose profile row is the case under test, and which
 * RECORDS what the app wrote and which analytics events it sent.
 *
 * Deliberately not scripts/selftest/supabase-stub.js: that one exists to get
 * the harness past the sign-in gate with a fixed profile, and this needs the
 * profile to vary and the writes to be visible. Both are stubs of the same
 * module and neither is the app's own code, so the duplication is a fixture
 * rather than logic.
 */
function stubFor({ onboardingColumn }) {
  // `undefined` means the column is absent entirely - the server-behind-client
  // case, which is the one that must NOT show the welcome.
  const column =
    onboardingColumn === undefined ? "" : `has_seen_onboarding: ${JSON.stringify(onboardingColumn)},`;
  return `
const USER = { id: "00000000-0000-4000-8000-00000000beef", email: "t@example.com" };
const PROFILE = {
  id: USER.id, username: "Tester",
  online_wins: 0, online_losses: 0, offline_wins: 0, offline_losses: 0,
  draft_counts: {}, personal_bests: {}, career_totals: {}, team_banners: {},
  era_records: {}, equipped_banner: null, featured_badges: [],
  created_at: new Date("2026-01-01").toISOString(), history: [],
  highest_scoring_game: null, largest_margin_game: null,
  triple_double_counts: {}, mvp_counts: {}, sport_ratings: {},
  ${column}
};
const SESSION = { access_token: "t", refresh_token: "t", expires_in: 3600, token_type: "bearer", user: USER };

window.__profileWrites = [];
window.__events = [];

class Query {
  constructor(table) { this.table = table; this._rows = table === "profiles" ? [PROFILE] : []; }
  select() { return this; }
  insert() { return this; }
  update(patch) {
    if (this.table === "profiles") {
      window.__profileWrites.push(patch);
      // Applied to the fixture, so a reload behaves the way the database
      // would: the flag the app just wrote is the flag it reads back.
      Object.assign(PROFILE, patch);
      // localStorage, not sessionStorage: Playwright's storageState() - which
      // is how the reload below inherits this one's state - captures
      // localStorage and cookies and NOT sessionStorage. With sessionStorage
      // the second load started from the original fixture and reported that
      // the app re-showed the welcome, when what had actually happened was
      // that the test's stand-in database forgot the write.
      try { localStorage.setItem("stubProfile", JSON.stringify(PROFILE)); } catch {}
    }
    return this;
  }
  upsert() { return this; } delete() { return this; }
  eq() { return this; } neq() { return this; } in() { return this; }
  gt() { return this; } gte() { return this; } lt() { return this; } lte() { return this; }
  order() { return this; } limit() { return this; } range() { return this; }
  single() { return Promise.resolve({ data: this._rows[0] ?? null, error: this._rows.length ? null : { message: "no rows" } }); }
  maybeSingle() { return Promise.resolve({ data: this._rows[0] ?? null, error: null }); }
  then(res, rej) { return Promise.resolve({ data: this._rows, error: null }).then(res, rej); }
}

// A reload has to see what the previous load wrote, or "does it come back?"
// cannot be asked at all.
try {
  const saved = localStorage.getItem("stubProfile");
  if (saved) Object.assign(PROFILE, JSON.parse(saved));
} catch {}

export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: SESSION }, error: null }),
      getUser: async () => ({ data: { user: USER }, error: null }),
      signInWithPassword: async () => ({ data: { session: SESSION, user: USER }, error: null }),
      signUp: async () => ({ data: { session: SESSION, user: USER }, error: null }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      if (name === "track_event") window.__events.push({ event: args?.p_event, props: args?.p_props });
      return { data: name === "heartbeat_presence" ? 1 : null, error: null };
    },
    functions: { invoke: async () => ({ data: null, error: { message: "n/a" } }) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  };
}
export default { createClient };
`;
}

async function openApp(browser, { onboardingColumn, device = null, storage = null }) {
  const context = await browser.newContext({
    ...(device ? devices[device] : { viewport: { width: 1280, height: 900 } }),
    ...(storage ? { storageState: storage } : {}),
  });
  const page = await context.newPage();
  await page.route("**/esm.sh/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: stubFor({ onboardingColumn }) })
  );
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  // The welcome opens after the profile load and the home render, both of
  // which are awaited network calls against the stub.
  await page.waitForFunction(() => !document.getElementById("screen-home").classList.contains("hidden"), { timeout: 15000 });
  await page.waitForTimeout(600);
  return { context, page };
}

const modalOpen = (page) =>
  page.evaluate(() => {
    const backdrop = document.getElementById("modal-backdrop");
    return {
      open: !backdrop.classList.contains("hidden"),
      title: document.getElementById("modal-title").textContent,
      hasCta: !!document.querySelector(".onboarding-cta"),
    };
  });

async function main() {
  const server = await serve(ROOT, PORT);
  const browser = await chromium.launch({ headless: true });
  const checks = [];
  const add = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

  try {
    // ---- 1. a brand-new account sees it ----------------------------------
    {
      const { context, page } = await openApp(browser, { onboardingColumn: false });
      const first = await modalOpen(page);
      add(
        "A new account sees the welcome",
        first.open && /welcome to draft nova/i.test(first.title) && first.hasCta,
        first.open ? first.title : "no modal appeared"
      );

      const events = await page.evaluate(() => window.__events.map((e) => e.event));
      add(
        "Opening it records onboarding_viewed exactly once",
        events.filter((e) => e === "onboarding_viewed").length === 1,
        `events: ${events.join(", ") || "none"}`
      );
      add(
        "A first entry also records signup_completed",
        events.filter((e) => e === "signup_completed").length === 1,
        "a new account reaching the app is the signup, not the form submitting"
      );

      const writes = await page.evaluate(() => window.__profileWrites);
      add(
        "Completion is written to the profile, not to localStorage",
        writes.some((w) => w.has_seen_onboarding === true),
        `profile writes: ${JSON.stringify(writes)}`
      );

      // ---- keyboard and focus -------------------------------------------
      const focused = await page.evaluate(() => document.activeElement?.className || "");
      add(
        "Focus moves into the dialog",
        focused.includes("onboarding-cta") || focused.includes("modal-close"),
        `focus is on .${focused.split(" ").join(".")}`
      );

      // Tab from the last control must wrap back inside rather than walking
      // into the home screen behind the backdrop.
      const trapped = await page.evaluate(async () => {
        const items = [...document.querySelectorAll("#modal-backdrop .modal button")];
        items[items.length - 1].focus();
        return true;
      });
      await page.keyboard.press("Tab");
      const stillInside = await page.evaluate(() =>
        document.querySelector("#modal-backdrop .modal").contains(document.activeElement)
      );
      add("Tab stays inside the dialog", trapped && stillInside, stillInside ? "wraps to the first control" : "focus escaped to the page behind");

      // The CTA is the documented way out, and it records the completion.
      await page.click(".onboarding-cta");
      const afterCta = await modalOpen(page);
      const completed = await page.evaluate(() =>
        window.__events.filter((e) => e.event === "onboarding_completed").length
      );
      add("Start Playing closes it", !afterCta.open, afterCta.open ? "still open" : "closed");
      add("Start Playing records onboarding_completed once", completed === 1, `${completed} event(s)`);

      // ---- it does not come back on a reload -----------------------------
      const storage = await context.storageState();
      await context.close();
      const again = await openApp(browser, { onboardingColumn: false, storage });
      const second = await modalOpen(again.page);
      add(
        "A reload does not show it again",
        !second.open,
        second.open ? "shown a second time" : "the profile flag is respected"
      );
      await again.context.close();
    }

    // ---- 2. an existing account never sees it ----------------------------
    {
      const { context, page } = await openApp(browser, { onboardingColumn: true });
      const state = await modalOpen(page);
      add("An onboarded account does not see it", !state.open, state.open ? state.title : "no modal");
      await context.close();
    }

    // ---- 3. THE SERVER-BEHIND-CLIENT CASE --------------------------------
    // The column absent entirely, which is every existing player the moment
    // this ships to a project where the migration has not been applied. It
    // must read as "already onboarded": showing the welcome to the whole
    // existing player base is far worse than one new player missing it.
    {
      const { context, page } = await openApp(browser, { onboardingColumn: undefined });
      const state = await modalOpen(page);
      add(
        "A profile with no onboarding column does NOT see it",
        !state.open,
        state.open
          ? "shown - a database without the migration would welcome every existing player at once"
          : "absent reads as onboarded"
      );
      await context.close();
    }

    // ---- 4. it works on a phone ------------------------------------------
    {
      const { context, page } = await openApp(browser, { onboardingColumn: false, device: "iPhone 13" });
      const state = await modalOpen(page);
      add("The welcome opens on a phone", state.open, state.open ? state.title : "no modal on mobile");

      if (state.open) {
        const layout = await page.evaluate(() => {
          const modal = document.querySelector("#modal-backdrop .modal");
          const cta = document.querySelector(".onboarding-cta");
          const r = modal.getBoundingClientRect();
          return {
            withinWidth: r.left >= -1 && r.right <= window.innerWidth + 1,
            withinHeight: r.height <= window.innerHeight,
            pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1,
            // The CTA has to be reachable: the modal body scrolls, so it can
            // be below the fold, but it must exist and have a real tap target.
            ctaHeight: cta ? Math.round(cta.getBoundingClientRect().height) : 0,
            viewport: window.innerWidth,
          };
        });
        add("It fits the phone's width", layout.withinWidth, `viewport ${layout.viewport}px`);
        add("It fits the phone's height", layout.withinHeight, "the body scrolls inside the dialog");
        add("It causes no horizontal page scroll", !layout.pageScrollsSideways, "scrollWidth is within the viewport");
        add("Start Playing is a real tap target", layout.ctaHeight >= 40, `${layout.ctaHeight}px tall`);
      }
      await context.close();
    }

    // ---- 5. Escape is a way out, and it still counts as seen -------------
    {
      const { context, page } = await openApp(browser, { onboardingColumn: false });
      await page.keyboard.press("Escape");
      const after = await modalOpen(page);
      const writes = await page.evaluate(() => window.__profileWrites);
      add("Escape dismisses the welcome", !after.open, after.open ? "still open" : "closed");
      add(
        "Dismissing still records it as seen",
        writes.some((w) => w.has_seen_onboarding === true),
        "the flag is written when it OPENS - a player who read it and left has still seen it"
      );
      const completed = await page.evaluate(() =>
        window.__events.filter((e) => e.event === "onboarding_completed").length
      );
      add(
        "Dismissing does not count as completing",
        completed === 0,
        "viewed is everyone; completed is only the ones who pressed the button"
      );
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(renderSection("First-run onboarding"));
  for (const c of checks) console.log(renderCheck(c));
  const { counts, ok } = summarize(checks);
  console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
