#!/usr/bin/env node
// Guest self-test: `npm run verify:guest-selftest`.
//
// The homepage is Quickplay: a visitor with no account taps a sport and is
// drafting, and the offer to make an account comes after the game. This drives
// that path end to end in a real browser, at phone width, for BOTH sports, and
// then converts - once by creating an account from the results card (NBA) and
// once by signing in from the header after "Maybe later" (NFL) - and checks the
// guest game arrived on the account.
//
// WHAT IT PROVES, beyond "the screens render":
//   - a guest makes NO user-metric call: no track_event, no touch_active_day,
//     no write to `profiles`. Asserted from the stub's own record of every RPC
//     and every write, not inferred from the code;
//   - a guest game is counted exactly once (record_guest_game) and kept locally;
//   - on entering an account the game is written to that profile, the funnel
//     row is claimed, and the local copy is gone;
//   - nothing a guest can see at 375px overflows, and nothing logs an error -
//     a CSP violation included, since the browser reports those to the console.
//
// WHAT IT DOES NOT PROVE: anything about the real record_guest_game and
// claim_guest_games functions. The stub answers every RPC with success and
// does not read arguments; db/migrations/20261022_01_guest_games.sql is the
// thing that has to be right on the server, and it is tested by applying it.

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { renderCheck, renderSection, summarize, check, PASS, FAIL } from "../lib/report.mjs";
import { LAYOUT_AUDIT } from "../lib/browser-instrumentation.mjs";
import { driveDraft, driveStrategyPhases, loadSquadIndex, sleep } from "../lib/app-driver.mjs";
import { serveStatic } from "./static-server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const PORT = Number(process.env.BK_GUEST_SELFTEST_PORT || 8961);

// The phone width the brief names. 360 is covered by the main self-test.
const VIEWPORT = { width: 375, height: 812 };

// The only RPCs a signed-out page may make. Presence is the "N online"
// ticker - a count of open tabs, not of users, and it ran on the old sign-in
// screen too.
const GUEST_RPCS = new Set(["heartbeat_presence", "record_guest_game"]);

const LEGS = [
  { sport: "nba", convert: "signup" },
  { sport: "nfl", convert: "signin" },
];

const verbose = !!process.env.BK_VERBOSE;
const log = (line) => verbose && console.log(line);

async function layoutAt375(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const audit = await page.evaluate(LAYOUT_AUDIT);
  return {
    ok: audit.documentOverflowPx <= 0 && audit.escapingCount === 0 && audit.overlapCount === 0,
    detail:
      `overflow ${audit.documentOverflowPx}px, escaping ${audit.escapingCount}, overlaps ${audit.overlapCount}` +
      [...audit.escaping.slice(0, 3).map((e) => `\nescapes: ${e.el}`), ...audit.overlaps.slice(0, 3).map((o) => `\noverlaps: ${o.a} / ${o.b}`)].join(""),
  };
}

async function runLeg(browser, stub, baseUrl, { sport, convert }) {
  const checks = [];
  const add = (id, title, ok, detail) => checks.push(check(`${sport}:${id}`, title, ok ? PASS : FAIL, { detail }));
  const errors = [];

  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true });
  await context.addInitScript("window.__bkStartSignedOut = true;");
  await context.route("**/esm.sh/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: stub })
  );
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // The optional brand mark, which removes itself when missing - the same
    // exemption scripts/verify-browser.mjs makes.
    if (/assets\/brand\//.test(msg.location()?.url || "")) return;
    errors.push(msg.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  try {
    // ---- the landing ------------------------------------------------------
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.locator(":root[data-guest] #screen-quickplay:not(.hidden)").waitFor({ timeout: 20000 });
    const landing = await page.evaluate(() => ({
      h1: document.querySelector("#screen-quickplay h1")?.textContent.trim(),
      navHidden: document.getElementById("nav-tabs").hidden,
      signinShown: !document.getElementById("btn-header-signin").hidden,
      cards: [...document.querySelectorAll("#quickplay-sports [data-quickplay]")].map((c) => c.dataset.quickplay),
    }));
    add(
      "landing",
      "Signed-out boot lands on Quickplay: H1, both sports, no nav tabs, Sign in in the header",
      landing.h1 === "Free NBA & NFL All-Time Draft Game With Friends" &&
        landing.navHidden && landing.signinShown && landing.cards.join() === "nba,nfl",
      JSON.stringify(landing)
    );
    const landingLayout = await layoutAt375(page);
    add("landing-layout", "Landing fits at 375px", landingLayout.ok, landingLayout.detail);

    // ---- one tap to a draft -------------------------------------------------
    await page.locator(`[data-quickplay="${sport}"] .sport-card-open`).click();
    const drafting = await page
      .locator("#screen-draft:not(.hidden)")
      .waitFor({ timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    add("one-tap", `One tap on ${sport.toUpperCase()} starts a practice draft`, drafting, drafting ? "" : "never reached the draft screen");
    if (!drafting) return checks;

    const deadline = Date.now() + (sport === "nfl" ? 360000 : 240000);
    const squadIndex = await loadSquadIndex(sport);
    await driveDraft(page, squadIndex, sport, log, deadline);
    await driveStrategyPhases(page, sport, log, deadline);

    // Skip the playback: what is under test is what happens at the whistle.
    const skip = page.locator("#btn-skip-playback");
    await skip.waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
    await skip.click().catch(() => {});
    const card = page.locator("#guest-signup-card:not([hidden])");
    const cardShown = await card.waitFor({ timeout: 90000 }).then(() => true).catch(() => false);
    const result = await page.evaluate(() => {
      const visible = (id) => {
        const el = document.getElementById(id);
        return !!el && getComputedStyle(el).display !== "none" && !el.classList.contains("hidden");
      };
      return {
        title: document.getElementById("guest-signup-title")?.textContent.trim(),
        friendsLine: /Play your friends now\./.test(document.getElementById("guest-signup-card")?.textContent || ""),
        profileBtn: visible("btn-to-profile"),
        homeBtn: visible("btn-game-home"),
        playAgain: visible("btn-play-again"),
        stored: JSON.parse(localStorage.getItem("dn_guest_games") || "[]").length,
        token: !!localStorage.getItem("dn_guest_claim"),
        rpcs: window.__bkRpcs || [],
        writes: window.__bkWrites || [],
      };
    });
    add(
      "card",
      "The results screen offers an account, with the friends line, and hides what needs one",
      cardShown && result.title === "Want to track your stats? Create an account. It's free." &&
        result.friendsLine && !result.profileBtn && !result.homeBtn && result.playAgain,
      JSON.stringify({ cardShown, ...result, rpcs: undefined, writes: undefined })
    );
    // Evidence for a reviewer, not an assertion: what the offer looks like.
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: path.join(ROOT, "verify-artifacts", "guest", `${sport}-results-card.png`) }).catch(() => {});
    const gameLayout = await layoutAt375(page);
    add("game-layout", "Results screen fits at 375px", gameLayout.ok, gameLayout.detail);

    const recorded = result.rpcs.filter((r) => r.name === "record_guest_game");
    add(
      "counted",
      "The guest game is counted once (record_guest_game) and kept on this device",
      recorded.length === 1 && recorded[0].args.p_sport === sport && result.stored === 1 && result.token,
      `record_guest_game calls: ${JSON.stringify(recorded.map((r) => r.args))}, stored: ${result.stored}`
    );
    const strays = result.rpcs.filter((r) => !GUEST_RPCS.has(r.name));
    add(
      "no-user-metrics",
      "A guest makes no user-metric call and no profile write",
      strays.length === 0 && result.writes.length === 0,
      `other RPCs: ${JSON.stringify(strays.map((r) => r.name))}, writes: ${JSON.stringify(result.writes)}`
    );

    // ---- converting -------------------------------------------------------
    if (convert === "signup") {
      await page.locator("#btn-guest-signup").click();
      await page.locator("#screen-auth:not(.hidden) #field-auth-email:not([hidden])").waitFor({ timeout: 10000 });
      await page.locator("#input-auth-email").fill("guest-selftest@example.com");
      await page.locator("#input-auth-username").fill("GuestSelfTest");
      await page.locator("#input-auth-password").fill("guest-selftest-password");
    } else {
      await page.locator("#btn-guest-later").click();
      const later = await page.evaluate(() => ({
        cardHidden: document.getElementById("guest-signup-card").hidden,
        focused: document.activeElement?.id,
      }));
      add("maybe-later", "Maybe later closes the card and puts focus on Play Again", later.cardHidden && later.focused === "btn-play-again", JSON.stringify(later));
      await page.locator("#btn-play-again").click();
      // Straight into the next draft, same sport, still a guest. It used to go
      // back to Quickplay, which testers read as being thrown out of the game.
      const again = await page
        .locator(":root[data-guest] #screen-draft:not(.hidden) #pool-search:not([hidden])")
        .waitFor({ timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      const label = await page.locator("#draft-round-label").textContent().catch(() => "");
      add("play-again", "Play Again takes a guest straight into a new draft", again && /^Pick 1 of /.test(label || ""), label || "");
      await page.locator("#btn-header-signin").click();
      await page.locator("#screen-auth:not(.hidden) #field-auth-identifier:not([hidden])").waitFor({ timeout: 10000 });
      await page.locator("#input-auth-identifier").fill("guest-selftest@example.com");
      await page.locator("#input-auth-password").fill("guest-selftest-password");
    }
    await page.locator("#btn-auth-submit").click();
    await page.locator("#screen-home:not(.hidden)").waitFor({ timeout: 20000 });
    // The carry-over is awaited inside enterApp before the home screen reads
    // the profile, so by the time home is drawn it has run - but give the
    // claim RPC after it a moment.
    await sleep(500);
    const after = await page.evaluate(() => ({
      guestAttr: document.documentElement.hasAttribute("data-guest"),
      navShown: !document.getElementById("nav-tabs").hidden,
      signinHidden: document.getElementById("btn-header-signin").hidden,
      stored: localStorage.getItem("dn_guest_games"),
      token: localStorage.getItem("dn_guest_claim"),
      historyWrite: (window.__bkWrites || []).some((w) => w.table === "profiles" && w.keys.includes("history")),
      claimed: (window.__bkRpcs || []).some((r) => r.name === "claim_guest_games" && r.signedIn),
    }));
    add(
      "carry-over",
      `${convert === "signup" ? "Creating an account from the card" : "Signing in after Maybe later"} carries the guest game onto the account`,
      after.historyWrite && after.claimed && after.stored === null && after.token === null,
      JSON.stringify(after)
    );
    add(
      "signed-in-chrome",
      "Once in, the app is the signed-in app: nav tabs back, no guest Sign in button",
      !after.guestAttr && after.navShown && after.signinHidden,
      JSON.stringify(after)
    );
  } catch (e) {
    add("run", "Guest leg completed", false, e.stack || e.message);
  } finally {
    add("console", "No console errors or CSP violations", errors.length === 0, errors.slice(0, 5).join("\n"));
    await context.close();
  }
  return checks;
}

async function main() {
  await mkdir(path.join(ROOT, "verify-artifacts", "guest"), { recursive: true });
  const server = await serveStatic(ROOT, PORT);
  const baseUrl = `http://127.0.0.1:${PORT}/`;
  const stub = await readFile(path.join(HERE, "supabase-stub.js"), "utf8");
  const wanted = (process.argv.find((a) => a.startsWith("--sport=")) || "").slice("--sport=".length);
  const legs = wanted ? LEGS.filter((l) => wanted.split(",").includes(l.sport)) : LEGS;
  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });

  console.log(renderSection("Guest Quickplay self-test (local server, stubbed backend, 375px)"));
  const all = [];
  for (const leg of legs) {
    console.log(renderSection(`${leg.sport.toUpperCase()} — guest game, then ${leg.convert === "signup" ? "create account" : "sign in"}`));
    const checks = await runLeg(browser, stub, baseUrl, leg);
    for (const c of checks) console.log(renderCheck(c));
    all.push(...checks);
  }
  await browser.close();
  server.close();
  const { counts, ok } = summarize(all);
  console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
