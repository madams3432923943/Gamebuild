#!/usr/bin/env node
// Screenshots of everything this sprint changed, at a desktop width and a
// phone width.
//
// NOT A VERIFICATION SCRIPT. The checks live in verify-onboarding.mjs,
// verify-admin-dashboard.mjs, verify-share-card.mjs and verify-sponsors.mjs and
// they assert things; this exists because some questions about a UI can only be
// answered by looking at it, and "does the sponsor rail look intentional or
// does it look like an ad" is one of them. It is kept out of `npm run verify`
// deliberately - it has no pass/fail to report.
//
//   node scripts/shoot-growth-screens.mjs            everything
//   node scripts/shoot-growth-screens.mjs --skip-game   skips the two real
//                                                       matches (fast)
//
// Output: verify-artifacts/growth-screens/<view>/<name>.png
//
// THE POSTGAME SHOTS DRIVE A REAL MATCH. There is no shortcut: the share
// dialog and the postgame sponsor slot are revealed by the final whistle, and
// faking the state that reveals them would be photographing a mock-up. It
// plays an easy practice game - the whole squad visible and no pick clock, so
// the draft can be driven quickly - and screenshots what a player would see.

import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

import { loadSquadIndex, driveDraft, driveStrategyPhases, signIn } from "./lib/app-driver.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "verify-artifacts", "growth-screens");
const PORT = Number(process.env.BK_SHOOT_PORT || 8951);
const SKIP_GAME = process.argv.includes("--skip-game");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
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

/** The Supabase stand-in. Same shape as the one in verify-onboarding.mjs and
 * for the same reason: the profile has to be the state being photographed. */
function stub({ onboarded }) {
  return `
const USER = { id: "00000000-0000-4000-8000-00000000beef", email: "t@example.com" };
const PROFILE = {
  id: USER.id, username: "madams",
  online_wins: 6, online_losses: 4, offline_wins: 11, offline_losses: 7,
  draft_counts: {}, personal_bests: {}, career_totals: {}, team_banners: {},
  era_records: {}, equipped_banner: null, featured_badges: [],
  created_at: new Date("2026-07-27").toISOString(), history: [],
  highest_scoring_game: null, largest_margin_game: null,
  triple_double_counts: {}, mvp_counts: {},
  sport_ratings: { nba: { rating: 594, wins: 6, losses: 4, games: 10, peak: 612 } },
  has_seen_onboarding: ${onboarded},
};
const SESSION = { access_token: "t", refresh_token: "t", expires_in: 3600, token_type: "bearer", user: USER };
class Query {
  constructor(t) { this.table = t; this._rows = t === "profiles" ? [PROFILE] : []; }
  select() { return this; } insert() { return this; }
  update(p) { if (this.table === "profiles") Object.assign(PROFILE, p); return this; }
  upsert() { return this; } delete() { return this; }
  eq() { return this; } neq() { return this; } in() { return this; }
  gt() { return this; } gte() { return this; } lt() { return this; } lte() { return this; }
  order() { return this; } limit() { return this; } range() { return this; }
  single() { return Promise.resolve({ data: this._rows[0] ?? null, error: this._rows.length ? null : { message: "no rows" } }); }
  maybeSingle() { return Promise.resolve({ data: this._rows[0] ?? null, error: null }); }
  then(r, j) { return Promise.resolve({ data: this._rows, error: null }).then(r, j); }
}
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
    from: (t) => new Query(t),
    rpc: async (n) => ({ data: n === "heartbeat_presence" ? 42 : null, error: null }),
    functions: { invoke: async () => ({ data: null, error: { message: "n/a" } }) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  };
}
export default { createClient };
`;
}

// A DESKTOP WIDE ENOUGH FOR THE SPONSOR RAILS. They appear at 1500px and not
// below, which is the whole point of them - so a 1280px shot would show the
// feature correctly absent and say nothing about it.
const VIEWS = [
  { id: "desktop", label: "desktop (1600x1000)", context: { viewport: { width: 1600, height: 1000 } } },
  { id: "mobile", label: "mobile (iPhone 13)", context: devices["iPhone 13"] },
];

const log = (m) => console.log(m);

async function shoot(page, view, name, { full = false, clip = null } = {}) {
  const dir = path.join(OUT, view.id);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full, ...(clip ? { clip } : {}) });
  log(`    ${view.id}/${name}.png`);
}

async function newPage(browser, view, { onboarded }) {
  const context = await browser.newContext(view.context);
  const page = await context.newPage();
  await page.route("**/esm.sh/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: stub({ onboarded }) })
  );
  return { context, page };
}

async function main() {
  const server = await serve(ROOT, PORT);
  const base = `http://127.0.0.1:${PORT}`;
  const browser = await chromium.launch({ headless: true });
  await mkdir(OUT, { recursive: true });

  try {
    for (const view of VIEWS) {
      log(`\n${view.label}`);

      // ---- 1. the first-run welcome -----------------------------------
      {
        const { context, page } = await newPage(browser, view, { onboarded: false });
        await page.goto(`${base}/index.html`);
        await page.locator(".onboarding-cta").waitFor({ state: "visible", timeout: 20000 });
        await page.waitForTimeout(500);
        await shoot(page, view, "01-onboarding");
        // Scrolled to the bottom of the dialog body as well, because on a phone
        // the modes and the button are below the fold and "what does the rest
        // of it look like" is a fair question.
        await page.locator("#modal-body").evaluate((el) => el.scrollTo(0, el.scrollHeight));
        await page.waitForTimeout(300);
        await shoot(page, view, "02-onboarding-scrolled");
        await context.close();
      }

      // ---- 2. the home screen, with the sponsor rails ------------------
      {
        const { context, page } = await newPage(browser, view, { onboarded: true });
        await page.goto(`${base}/index.html`);
        await page.locator("#screen-home:not(.hidden)").waitFor({ state: "visible", timeout: 20000 });
        await page.waitForTimeout(1200);
        await shoot(page, view, "03-home-with-sponsor-rails");
        await shoot(page, view, "04-home-full", { full: true });
        await context.close();
      }

      // ---- 3. an expired recovery link ---------------------------------
      // The URL a dead reset link actually returns to. Before this sprint it
      // landed on the ordinary sign-in screen with no explanation.
      {
        const { context, page } = await newPage(browser, view, { onboarded: true });
        await page.addInitScript(() => {
          // No session, so the app falls through to the auth screen the way it
          // does for a real visitor arriving on a failed link.
          window.__noSession = true;
        });
        await page.route("**/esm.sh/**", (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/javascript; charset=utf-8",
            body: stub({ onboarded: true }).replace(
              "getSession: async () => ({ data: { session: SESSION }, error: null })",
              "getSession: async () => ({ data: { session: null }, error: null })"
            ),
          })
        );
        await page.goto(
          `${base}/index.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`
        );
        await page.locator("#screen-auth:not(.hidden)").waitFor({ state: "visible", timeout: 20000 });
        await page.waitForTimeout(600);
        await shoot(page, view, "05-expired-reset-link");
        await context.close();
      }

      // ---- 4. the admin dashboard --------------------------------------
      {
        const { context, page } = await newPage(browser, view, { onboarded: true });
        await page.goto(`${base}/admin.html`);
        await page.waitForTimeout(400);
        // Rendered from the same fixtures verify-admin-dashboard.mjs asserts
        // against, so the picture and the test are describing one thing.
        await page.evaluate(async () => {
          const { renderDashboard } = await import("/js/admin/render.js");
          const host = document.getElementById("admin-body");
          document.getElementById("admin-status").hidden = true;
          document.getElementById("admin-generated").textContent = "as of 11/09/2026, 15:00:00";
          host.hidden = false;
          renderDashboard(
            host,
            {
              generated_at: "2026-09-11T15:00:00Z",
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
            },
            {
              days: 30,
              events: {
                signup_completed: { users: 121, count: 121 },
                onboarding_viewed: { users: 118, count: 118 },
                onboarding_completed: { users: 92, count: 92 },
                sport_selected: { users: 110, count: 260 },
                mode_selected: { users: 108, count: 301 },
                practice_difficulty_selected: { users: 74, count: 160 },
                draft_started: { users: 104, count: 388 },
                draft_completed: { users: 95, count: 350 },
                simulation_started: { users: 95, count: 350 },
                game_completed: { users: 88, count: 340 },
                ranked_queue_joined: { users: 41, count: 96 },
                ranked_match_found: { users: 33, count: 71 },
                ranked_game_completed: { users: 31, count: 68 },
                friend_added: { users: 22, count: 29 },
                friend_challenge_sent: { users: 14, count: 31 },
                friend_game_completed: { users: 12, count: 26 },
                share_card_created: { users: 19, count: 24 },
                share_card_shared: { users: 11, count: 13 },
                sponsor_impression: { users: 96, count: 96 },
                sponsor_click: { users: 3, count: 3 },
              },
              retention: {
                tracking_since: "2026-08-01",
                day_1: { cohort: 100, retained: 41, rate: 0.41 },
                day_7: { cohort: 80, retained: 18, rate: 0.225 },
              },
            }
          );
        });
        await page.waitForTimeout(400);
        await shoot(page, view, "06-admin-dashboard");
        await shoot(page, view, "07-admin-dashboard-full", { full: true });

        // AND THE REFUSAL, which is the more important screen: this is what an
        // ordinary signed-in player sees.
        await page.evaluate(() => {
          const host = document.getElementById("admin-body");
          host.hidden = true;
          host.replaceChildren();
          const status = document.getElementById("admin-status");
          status.hidden = false;
          status.className = "admin-status admin-status-error";
          status.textContent = "This account isn't an administrator. Nothing here is available to it.";
          document.getElementById("admin-generated").textContent = "";
        });
        await page.waitForTimeout(200);
        await shoot(page, view, "08-admin-refused");
        await context.close();
      }

      // ---- 5. the account emails ---------------------------------------
      // Rendered in a browser at a mail-client-ish width. Not a mail client -
      // nothing here can be - but it is what the markup produces.
      {
        const { context, page } = await newPage(browser, view, { onboarded: true });
        for (const [name, file] of [
          ["09-email-reset-password", "docs/email/reset-password.html"],
          ["10-email-confirm-signup", "docs/email/confirm-signup.html"],
          ["11-email-change-email", "docs/email/change-email.html"],
        ]) {
          await page.goto(`${base}/${file}`);
          await page.waitForTimeout(500);
          await shoot(page, view, name, { full: true });
        }
        await context.close();
      }

      // ---- 6. a real game, to its final screen -------------------------
      if (!SKIP_GAME) {
        const { context, page } = await newPage(browser, view, { onboarded: true });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`${base}/index.html`);
        await signIn(page, { username: "madams", password: "x" }, log);

        // Into basketball, practice, easy - the whole squad on screen and no
        // pick clock, which is what makes driving the draft quick.
        await page.locator("#home-sport-cards .sport-card-open").first().click();
        await page.locator("#screen-play:not(.hidden)").waitFor({ state: "visible", timeout: 20000 });
        await page.waitForTimeout(800);
        await shoot(page, view, "12-play-screen");

        // BY data-mode, NOT BY POSITION. renderChoiceCards stamps the id on
        // the button; the first card in #mode-toggle is Online Ranked, because
        // MODES puts the headline mode first. An earlier version of this script
        // clicked .first() and therefore entered MATCHMAKING against a stub
        // that never pairs, and the only symptom was a 30-second timeout
        // waiting for a draft screen that was never coming.
        await page.locator('#mode-toggle button[data-mode="practice"]').click();
        await page.waitForTimeout(300);
        // Easy: the whole squad on screen and no pick clock, which is what
        // makes the draft quick to drive.
        const easy = page.locator('#difficulty-toggle button[data-mode="easy"]');
        if (await easy.isVisible().catch(() => false)) {
          await easy.click();
          await page.waitForTimeout(300);
        }
        await shoot(page, view, "13-play-screen-mode-chosen");

        await page.locator("#btn-start-draft").click();
        const reachedDraft = await page
          .locator("#screen-draft:not(.hidden)")
          .waitFor({ state: "visible", timeout: 30000 })
          .then(() => true)
          .catch(() => false);
        if (!reachedDraft) {
          // Says WHY rather than timing out on a selector. The screen that
          // fails to appear is never the interesting part; the status line on
          // the screen you are still stuck on is.
          const status = (await page.locator("#search-status").textContent().catch(() => "")) || "";
          const summary = (await page.locator("#launch-summary").textContent().catch(() => "")) || "";
          throw new Error(
            `${view.id}: Start Draft did not reach the draft screen. launch summary: "${summary.trim()}" status: "${status.trim()}"`
          );
        }

        const squadIndex = await loadSquadIndex("nba");
        const deadline = Date.now() + 4 * 60 * 1000;
        await driveDraft(page, squadIndex, `${view.id} draft`, log, deadline);
        await driveStrategyPhases(page, `${view.id} strategy`, log, deadline);

        // The final whistle: the Share Result button and the postgame sponsor
        // slot are both revealed here and nowhere else.
        await page.locator("#btn-share-result:not(.hidden)").waitFor({ state: "visible", timeout: 180000 });
        await page.waitForTimeout(1500);
        await shoot(page, view, "14-postgame-actions");
        await shoot(page, view, "15-postgame-full", { full: true });

        // The share dialog, and the card inside it.
        await page.locator("#btn-share-result").click();
        await page.locator(".share-preview").waitFor({ state: "visible", timeout: 20000 });
        await page.waitForTimeout(1200);
        await shoot(page, view, "16-share-dialog-story");

        await page.locator(".share-format").nth(1).click();
        await page.waitForTimeout(900);
        await shoot(page, view, "17-share-dialog-square");

        if (errors.length) log(`    (page errors: ${errors.slice(0, 2).join(" | ")})`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  log(`\nWrote screenshots to ${path.relative(ROOT, OUT)}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
