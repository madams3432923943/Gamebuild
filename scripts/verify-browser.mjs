// Real-browser verification: drives an actual match end to end in Chromium
// and measures what a player would actually experience.
//
// WHAT IT COVERS
//   - the homepage loads and paints (paint timings recorded, not inferred)
//   - sign-in works
//   - a match starts, both rosters draft, strategy phases commit
//   - the simulation runs to a final score
//   - no JS errors reach the console, and no request fails, at any point
//   - frames during the animated phases (matchup intro, live scoreboard) stay
//     inside budget, reported as worst-frame and jank counts rather than a
//     mean, because a mean hides the freeze that is the actual complaint
//   - layout does not break (flow siblings overlapping, boxes escaping the
//     viewport, horizontal document overflow)
//
// MODES
//   online  - two browser contexts, two accounts, matched against each other
//             through real matchmaking, simulated by the deployed Edge
//             Function. This is the only leg that exercises the server engine.
//   offline - one context, Ranked Practice against the bot. Same draft,
//             rotation, matchup and gamestyle phases as online (they share
//             the code path), simulated by the client engine.
//
// The app gates EVERY mode behind sign-in - even bot play - so both modes
// need credentials. Without them the browser leg is skipped rather than
// silently passing.
//
// NOTE ON RUNNING ONLINE AGAINST PRODUCTION: an online run creates a real
// ranked match between the two accounts it signs in as, and the Edge Function
// writes a real result - the loser takes a real ranked loss. Use throwaway
// accounts, never a player's.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PASS, FAIL, WARN, SKIP, check } from "./lib/report.mjs";
import { FRAME_SAMPLER, PAINT_METRICS, LAYOUT_AUDIT } from "./lib/browser-instrumentation.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

export const DEFAULT_BASE_URL = "https://madams3432923943.github.io/gamebuild/";

// Budgets. Deliberately generous - this is a regression gate, not a
// performance benchmark, and a flaky CI box should not fail a build over one
// slow frame during a scoreboard tick.
const BUDGET = {
  firstContentfulPaintMs: 3000,
  worstFrameMs: 250,
  janky100Frames: 3,
};

const RANKED_ROUNDS = 10;

// Widths the layout is held to. The two phone sizes are the common floor for
// current iOS and Android hardware; 1280 is what the run itself drives in.
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-360", width: 360, height: 800 },
];

// ---------------------------------------------------------------------------

/** Console errors, page exceptions and failed requests, collected for the
 * whole life of a page. Some are noise that says nothing about the build -
 * a blocked analytics beacon, an extension - so the filter is explicit
 * rather than "anything that looked bad". */
function attachDiagnostics(page, label, sink) {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isIgnorableConsole(text)) return;
    sink.push({ kind: "console", label, text, at: new Date().toISOString() });
  });
  page.on("pageerror", (err) => {
    sink.push({ kind: "pageerror", label, text: err.message, stack: err.stack, at: new Date().toISOString() });
  });
  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText || "unknown";
    if (failure.includes("ERR_ABORTED")) return; // navigations the app cancelled itself
    sink.push({ kind: "requestfailed", label, text: `${req.method()} ${req.url()} - ${failure}`, at: new Date().toISOString() });
  });
  page.on("response", (res) => {
    if (res.status() < 500) return;
    sink.push({ kind: "http5xx", label, text: `${res.status()} ${res.url()}`, at: new Date().toISOString() });
  });
}

function isIgnorableConsole(text) {
  return (
    /favicon/i.test(text) ||
    /Failed to load resource: net::ERR_INTERNET_DISCONNECTED/i.test(text) ||
    /\[vite\]/i.test(text)
  );
}

// ---------------------------------------------------------------------------
// Draft automation
// ---------------------------------------------------------------------------

/** Squad rosters, keyed team|decade, read from the same generated dataset the
 * app ships. Under the ranked ruleset the pool only reveals a player once his
 * name is typed, so the harness has to know the names - it cannot read them
 * off the screen, by design. */
async function loadSquadIndex() {
  const { PLAYERS } = await import(new URL(`file://${path.join(ROOT, "data", "nba-players.js")}`).href);
  const index = new Map();
  for (const p of PLAYERS) {
    const key = `${p.team}|${p.decade}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(p);
  }
  // Best players first: a draft that always takes the top available name
  // finishes in the fewest attempts and produces a realistic roster.
  for (const list of index.values()) list.sort((a, b) => b.ppg - a.ppg);
  return index;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Makes one pick. Returns the player taken, or null if the round moved on
 * without us (an opponent timeout, or our own pick clock firing - both are
 * legitimate and the draft continues either way). */
async function makeOnePick(page, squadIndex, log) {
  const team = await page.locator("#squad-banner-team").textContent().catch(() => null);
  const decade = await page.locator("#squad-banner-decade").textContent().catch(() => null);
  if (!team || !decade) return null;

  const squad = squadIndex.get(`${team.trim()}|${decade.trim()}`) || [];
  if (!squad.length) {
    log(`  no local squad data for "${team.trim()} ${decade.trim()}"`);
    return null;
  }

  const search = page.locator("#pool-search");
  for (const candidate of squad.slice(0, 14)) {
    if (!(await search.isVisible().catch(() => false))) return null;
    await search.fill("");
    await search.type(candidate.name, { delay: 8 });

    const card = page.locator("#pool-list .player-card:not(.disabled)").first();
    const appeared = await card.waitFor({ state: "visible", timeout: 2500 }).then(() => true).catch(() => false);
    if (!appeared) continue;

    await card.click();

    // TWO different modals can follow a card click, and they can follow each
    // other. A player with more than one draftable season on this squad opens
    // the season picker first; choosing a year then runs the ordinary pick
    // path, which opens the slot picker if he is eligible for more than one
    // non-bench slot. Handling only the second one left the season modal open
    // over the board, and every later pick clicked into a backdrop.
    const modal = page.locator("#modal-backdrop:not(.hidden)");
    if (await modal.isVisible().catch(() => false)) {
      const season = page.locator("#modal-backdrop .season-option").first();
      if (await season.isVisible().catch(() => false)) {
        await season.click().catch(() => {});
      }
    }
    if (await modal.isVisible().catch(() => false)) {
      await page.locator("#modal-backdrop .modal-slot-grid button").first().click().catch(() => {});
    }
    return candidate.name;
  }
  return null;
}

/** Drives one side's whole draft. Stops as soon as a post-draft phase shows
 * up, so it works for both the 10-round ranked draft and any mode that ends
 * sooner, without hardcoding when the draft is "done". */
async function driveDraft(page, squadIndex, label, log, deadline) {
  let picks = 0;
  let idleRounds = 0;

  while (Date.now() < deadline) {
    if (await isPastDraft(page)) return picks;

    const search = page.locator("#pool-search");
    const ready = await search.waitFor({ state: "visible", timeout: 4000 }).then(() => true).catch(() => false);
    if (!ready) {
      if (await isPastDraft(page)) return picks;
      idleRounds += 1;
      // Waiting on the opponent is normal in online play - the pool is hidden
      // between rounds. Only give up once nothing has moved for a long time.
      if (idleRounds > 45) throw new Error(`${label}: draft stalled - pool never became interactive`);
      await sleep(500);
      continue;
    }

    const before = await roundLabel(page);
    const taken = await makeOnePick(page, squadIndex, log);
    if (taken) {
      picks += 1;
      idleRounds = 0;
      log(`  ${label} round ${picks}: ${taken}`);
    } else {
      idleRounds += 1;
      await sleep(400);
    }

    // Wait for the round to actually turn over before typing into the next
    // one, otherwise the next fill() races the re-render and the pick is
    // typed into a box that is about to be cleared.
    await waitForChange(page, before, 3000);
    if (picks >= RANKED_ROUNDS + 2) return picks;
  }
  throw new Error(`${label}: draft did not finish inside its time budget`);
}

async function roundLabel(page) {
  return (await page.locator("#draft-round-label").textContent().catch(() => "")) || "";
}

async function waitForChange(page, before, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await roundLabel(page)) !== before) return true;
    if (await isPastDraft(page)) return true;
    await sleep(150);
  }
  return false;
}

async function isPastDraft(page) {
  for (const sel of ["#rotation-phase", "#matchup-phase", "#tactic-phase"]) {
    const el = page.locator(sel);
    if (await el.isVisible().catch(() => false)) return true;
  }
  return await page.locator("#screen-game:not(.hidden)").isVisible().catch(() => false);
}

/** Rotation -> matchups -> gamestyle. Each is accepted at its default: the
 * harness is verifying that the phases work and commit, not exploring
 * strategy, and defaults are the path most players take anyway. */
async function driveStrategyPhases(page, label, log, deadline) {
  const phases = [
    { name: "rotation", panel: "#rotation-phase", button: "#btn-confirm-rotation" },
    { name: "matchups", panel: "#matchup-phase", button: "#btn-confirm-matchups" },
  ];

  for (const phase of phases) {
    const shown = await page
      .locator(`${phase.panel}:not(.hidden)`)
      .waitFor({ state: "visible", timeout: Math.max(1000, deadline - Date.now()) })
      .then(() => true)
      .catch(() => false);
    if (!shown) {
      log(`  ${label}: ${phase.name} phase not shown (mode may skip it)`);
      continue;
    }
    await page.locator(phase.button).click({ timeout: 10000 });
    log(`  ${label}: confirmed ${phase.name}`);
  }

  const tactic = await page
    .locator("#tactic-phase:not(.hidden)")
    .waitFor({ state: "visible", timeout: Math.max(1000, deadline - Date.now()) })
    .then(() => true)
    .catch(() => false);
  if (tactic) {
    await page.locator("#tactic-grid .tactic-card, #tactic-grid button").first().click().catch(() => {});
    await page.locator("#btn-play-game").click({ timeout: 10000 }).catch(() => {});
    log(`  ${label}: gamestyle chosen, game started`);
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function signIn(page, { username, password }, log) {
  // Supabase persists a session in browser storage, so a context that already
  // has one lands straight on the home screen and the auth screen never
  // appears. Waiting for it unconditionally would hang on exactly the case
  // that is already succeeding.
  const alreadyIn = await page
    .locator("#screen-home:not(.hidden)")
    .waitFor({ state: "visible", timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (alreadyIn) {
    log("  already signed in (existing session restored)");
    return;
  }

  await page.locator("#screen-auth:not(.hidden)").waitFor({ state: "visible", timeout: 30000 });

  // The screen opens in "Sign In", which asks for one identifier - an email
  // address, or a legacy username, resolved by signIn() in supabaseClient.js.
  // Creating an account (email + username + password) is behind the toggle.
  await page.locator("#input-auth-identifier").fill(username);
  await page.locator("#input-auth-password").fill(password);
  await page.locator("#btn-auth-submit").click();

  const landed = await page
    .locator("#screen-home:not(.hidden)")
    .waitFor({ state: "visible", timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  if (landed) {
    log(`  signed in as ${username}`);
    return;
  }

  const status = (await page.locator("#auth-status").textContent().catch(() => "")) || "";
  throw new Error(`sign-in failed for ${username}: ${status.trim() || "home screen never appeared"}`);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function runBrowserChecks(opts = {}) {
  const {
    baseUrl = DEFAULT_BASE_URL,
    mode = "offline",
    accounts = [],
    artifactDir = path.join(ROOT, "verify-artifacts"),
    headless = true,
    budgetMs = 210000,
    // Optional request interception, used only by the self-test to stand in
    // for the Supabase CDN module. A real run against a real site passes
    // nothing here and talks to the real backend.
    routes = [],
    // A Playwright device descriptor name ("iPhone 13", "Pixel 7"). Resizing
    // a desktop window is not the same test: a real device context also sets
    // touch support, a mobile user agent and a device pixel ratio, and
    // hasTouch in particular changes which code paths and CSS apply. A phone
    // bug that a narrow desktop window cannot reproduce needs this.
    device = null,
    // Per-context init script, by index. The online self-test uses it to give
    // each browser a different identity against a shared fake backend, which
    // is what lets matchmaking pair them with each other.
    initScriptFor = null,
  } = opts;

  const checks = [];
  const diagnostics = [];
  const artifacts = [];
  const logLines = [];
  const log = (line) => {
    logLines.push(line);
    if (process.env.BK_VERBOSE) console.log(line);
  };

  const needed = mode === "online" ? 2 : 1;
  if (accounts.length < needed) {
    return [
      check("browser:run", `Real-browser ${mode} match completes`, SKIP, {
        detail:
          `Needs ${needed} account credential${needed > 1 ? "s" : ""} and none were supplied.\n` +
          `The app gates every mode behind sign-in, so there is no anonymous path to a draft.\n` +
          `Set BK_USER_A/BK_PASS_A${needed > 1 ? " and BK_USER_B/BK_PASS_B" : ""} to enable this leg.`,
      }),
    ];
  }

  let chromium, devices;
  try {
    ({ chromium, devices } = await import("playwright"));
  } catch {
    return [
      check("browser:run", `Real-browser ${mode} match completes`, SKIP, {
        detail: "playwright is not installed. Run `npm install` first.",
      }),
    ];
  }

  await mkdir(artifactDir, { recursive: true });
  const deadline = Date.now() + budgetMs;

  const browser = await chromium.launch({
    headless,
    args: ["--disable-dev-shm-usage"],
  });

  const sessions = [];
  let failed = null;

  try {
    for (let i = 0; i < needed; i++) {
      const label = needed > 1 ? `player${String.fromCharCode(65 + i)}` : "player";
      const deviceProfile = device ? devices[device] : null;
      if (device && !deviceProfile) {
        throw new Error(`unknown device "${device}" - see Playwright's device registry for valid names`);
      }
      const context = await browser.newContext({
        ...(deviceProfile || { viewport: { width: 1280, height: 900 } }),
        recordVideo: { dir: path.join(artifactDir, "video") },
      });
      await context.addInitScript(FRAME_SAMPLER);
      if (initScriptFor) await context.addInitScript(initScriptFor(i));
      for (const route of routes) {
        await context.route(route.pattern, (r) =>
          r.fulfill({ status: 200, contentType: route.contentType || "text/javascript", body: route.body })
        );
      }
      const page = await context.newPage();
      attachDiagnostics(page, label, diagnostics);
      sessions.push({ label, context, page, account: accounts[i] });
    }

    // ---- load -------------------------------------------------------------
    const loadStart = Date.now();
    await Promise.all(
      sessions.map(async ({ page }) => {
        await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.locator("#app-root").waitFor({ state: "attached", timeout: 20000 });
      })
    );
    const paint = await sessions[0].page.evaluate(PAINT_METRICS);
    const fcp = paint.firstContentfulPaint;
    checks.push(
      check(
        "browser:load",
        "Homepage loads and paints",
        fcp != null && fcp <= BUDGET.firstContentfulPaintMs ? PASS : WARN,
        {
          durationMs: Date.now() - loadStart,
          table: [
            ["metric", "ms", "budget"],
            ["first paint", fmt(paint.firstPaint), "-"],
            ["first contentful paint", fmt(paint.firstContentfulPaint), String(BUDGET.firstContentfulPaintMs)],
            ["largest contentful paint", fmt(paint.largestContentfulPaint), "-"],
            ["DOMContentLoaded", fmt(paint.domContentLoaded), "-"],
            ["load complete", fmt(paint.loadComplete), "-"],
          ],
          evidence: paint,
        }
      )
    );

    // ---- auth -------------------------------------------------------------
    const authStart = Date.now();
    await Promise.all(sessions.map(({ page, account }) => signIn(page, account, log)));
    checks.push(
      check("browser:auth", `Sign-in succeeds (${sessions.length} account${sessions.length > 1 ? "s" : ""})`, PASS, {
        durationMs: Date.now() - authStart,
      })
    );

    // ---- every tab, at every width ----------------------------------------
    // The match flow below only ever touches Play. Profile, Rewards and
    // Squads each load their own data and render their own layout, so a
    // failure there is invisible to a match-only test - which is how "the
    // rewards tab doesn't load" reaches a player before it reaches CI.
    // A device context has a fixed emulated screen; resizing it would throw
    // away the emulation that is the whole point of using one.
    const auditViewports = device
      ? [{ name: device, ...sessions[0].page.viewportSize() }]
      : VIEWPORTS;
    checks.push(...(await auditTabs(sessions[0].page, log, auditViewports, !!device)));

    // ---- start the match --------------------------------------------------
    const matchStart = Date.now();
    for (const { page } of sessions) {
      // Pick a sport first. The home screen is a sport hub now - the mode
      // toggle only exists once you are inside a sport, so this test sat on
      // the hub clicking at a button that was not on the page yet. It is not
      // that the app broke; the test was written before the hub existed.
      const sportRow = page.locator(`[data-sport="${(typeof sportId !== "undefined" && sportId) || "nba"}"]`).first();
      if (await sportRow.count()) await sportRow.click();
      const modeBtn = mode === "online" ? '[data-mode="online"]' : '[data-mode="practice-hard"]';
      await page.locator(`#mode-toggle ${modeBtn}`).waitFor({ state: "visible", timeout: 15000 });
      await page.locator(`#mode-toggle ${modeBtn}`).click();
    }
    await Promise.all(sessions.map(({ page }) => page.evaluate(() => window.__bkPerfStart("matchup-intro"))));
    // Both sides enter the queue together so matchmaking pairs them with each
    // other rather than with a stranger who happens to be waiting.
    await Promise.all(sessions.map(({ page }) => page.locator("#btn-start-draft").click()));

    const reachedDraft = await Promise.all(
      sessions.map(({ page }) =>
        page
          .locator("#screen-draft:not(.hidden)")
          .waitFor({ state: "visible", timeout: Math.min(90000, Math.max(5000, deadline - Date.now())) })
          .then(() => true)
          .catch(() => false)
      )
    );
    const introPerf = await sessions[0].page.evaluate(() => window.__bkPerfStop("matchup-intro"));

    if (reachedDraft.some((r) => !r)) {
      throw new Error(
        mode === "online"
          ? "matchmaking never produced a draft screen for both players"
          : "the draft screen never appeared"
      );
    }
    checks.push(
      check("browser:match-start", `${mode === "online" ? "Online" : "Practice"} match starts`, PASS, {
        durationMs: Date.now() - matchStart,
        detail: mode === "online" ? "Both accounts matched with each other through live matchmaking." : undefined,
      })
    );

    if (introPerf?.frameCount) {
      checks.push(frameCheck("browser:anim-intro", "Matchup intro animation renders smoothly", introPerf, sessions.length));
    }

    // ---- draft ------------------------------------------------------------
    const draftStart = Date.now();
    const squadIndex = await loadSquadIndex();
    const picks = await Promise.all(
      sessions.map(({ page, label }) => driveDraft(page, squadIndex, label, log, deadline))
    );
    checks.push(
      check("browser:draft", `Both rosters auto-draft (${picks.join(" + ")} picks)`, PASS, {
        durationMs: Date.now() - draftStart,
      })
    );

    // ---- strategy phases --------------------------------------------------
    const strategyStart = Date.now();
    await Promise.all(sessions.map(({ page, label }) => driveStrategyPhases(page, label, log, deadline)));
    checks.push(check("browser:strategy", "Rotation, matchups and gamestyle commit", PASS, { durationMs: Date.now() - strategyStart }));

    // ---- simulation -------------------------------------------------------
    const simStart = Date.now();
    await Promise.all(sessions.map(({ page }) => page.evaluate(() => window.__bkPerfStart("simulation"))));

    const reachedGame = await Promise.all(
      sessions.map(({ page }) =>
        page
          .locator("#screen-game:not(.hidden)")
          .waitFor({ state: "visible", timeout: Math.min(90000, Math.max(5000, deadline - Date.now())) })
          .then(() => true)
          .catch(() => false)
      )
    );
    if (reachedGame.some((r) => !r)) throw new Error("the game screen never appeared after the strategy phase");

    const finals = await Promise.all(
      sessions.map(({ page }) =>
        page
          .locator("#final-banner:not(.hidden)")
          .waitFor({ state: "visible", timeout: Math.min(120000, Math.max(5000, deadline - Date.now())) })
          .then(() => page.locator("#final-banner").textContent())
          .catch(() => null)
      )
    );
    const simPerf = await sessions[0].page.evaluate(() => window.__bkPerfStop("simulation"));

    if (finals.some((f) => !f)) throw new Error("the simulation never reached a final score");

    // Both clients must be told the same story. In online play they read the
    // result from the same match_results row, so a disagreement here is a
    // real bug (the "result never reaches either player" class of failure the
    // git history already shows fixing once).
    const scores = finals.map((f) => (f || "").replace(/\s+/g, " ").trim());
    const agree = mode !== "online" || new Set(scores.map(normalizeScore)).size === 1;
    checks.push(
      check("browser:simulation", "Match simulates to a final score", agree ? PASS : FAIL, {
        durationMs: Date.now() - simStart,
        detail: scores.map((s, i) => `${sessions[i].label}: ${s}`).join("\n"),
      })
    );

    if (simPerf?.frameCount) {
      checks.push(frameCheck("browser:anim-scoreboard", "Live scoreboard animates without janking", simPerf, sessions.length));
    }

    // ---- box score present ------------------------------------------------
    const boxVisible = await Promise.all(
      sessions.map(({ page }) =>
        page
          .locator("#full-box-score:not(.hidden)")
          .waitFor({ state: "visible", timeout: 30000 })
          .then(() => true)
          .catch(() => false)
      )
    );
    checks.push(
      check("browser:box-score", "Full box score renders after the game", boxVisible.every(Boolean) ? PASS : FAIL, {
        detail: boxVisible.every(Boolean) ? undefined : "At least one client finished without a box score on screen.",
      })
    );

    // ---- layout -----------------------------------------------------------
    // Audited at every viewport, not just the desktop one the run drove in.
    // The post-game screen is the densest in the app (two box-score tables,
    // recap, MVP callout), so if anything breaks on a phone it breaks here -
    // and a desktop-only audit is exactly how a broken phone layout ships.
    const page0 = sessions[0].page;
    const layoutRows = [["viewport", "width", "overlaps", "escaping", "h-overflow"]];
    const layoutProblems = [];
    let layoutEvidence = {};

    for (const vp of auditViewports) {
      if (!device) await page0.setViewportSize({ width: vp.width, height: vp.height });
      // One frame for the resize to settle before measuring.
      await page0.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const audit = await page0.evaluate(LAYOUT_AUDIT);
      layoutEvidence[vp.name] = audit;
      layoutRows.push([
        vp.name,
        `${vp.width}px`,
        String(audit.overlapCount),
        String(audit.escapingCount),
        `${audit.documentOverflowPx}px`,
      ]);
      if (audit.overlapCount || audit.escapingCount || audit.documentOverflowPx) {
        const worstOffenders = [
          ...audit.escaping.slice(0, 4).map((e) => `    escapes: ${e.el} (${e.left}..${e.right} vs ${e.viewport}px)`),
          ...audit.overlaps.slice(0, 4).map((o) => `    overlaps: ${o.a} / ${o.b} by ${o.overlapPx}`),
        ];
        layoutProblems.push(`${vp.name} (${vp.width}px):\n` + worstOffenders.join("\n"));
      }
    }
    if (!device) await page0.setViewportSize({ width: 1280, height: 900 });

    checks.push(
      check("browser:layout", device ? `Post-game layout holds on ${device}` : "Post-game layout holds at desktop and phone widths", layoutProblems.length ? FAIL : PASS, {
        detail: layoutProblems.length ? layoutProblems.join("\n") : undefined,
        table: layoutRows,
        evidence: layoutEvidence,
      })
    );
  } catch (e) {
    failed = e;
    checks.push(
      check("browser:run", `Real-browser ${mode} match completes`, FAIL, {
        detail: `${e.message}`,
      })
    );
  } finally {
    // Screenshots on failure, from every session - the failing player is not
    // always the one that threw.
    if (failed) {
      for (const { label, page } of sessions) {
        const file = path.join(artifactDir, `failure-${label}.png`);
        await page.screenshot({ path: file, fullPage: true }).catch(() => {});
        artifacts.push(file);
        const html = path.join(artifactDir, `failure-${label}.html`);
        await writeFile(html, await page.content().catch(() => "")).catch(() => {});
        artifacts.push(html);
      }
    }

    for (const { context, page } of sessions) {
      const video = page.video();
      await context.close().catch(() => {});
      // Video only survives context close; keep it only when something broke,
      // otherwise a green run leaves megabytes behind every time it passes.
      if (video) {
        if (failed) {
          const p = await video.path().catch(() => null);
          if (p) artifacts.push(p);
        } else {
          await video.delete().catch(() => {});
        }
      }
    }
    await browser.close().catch(() => {});
  }

  // ---- console cleanliness -------------------------------------------------
  const errors = diagnostics.filter((d) => d.kind === "pageerror" || d.kind === "console" || d.kind === "http5xx");
  const netFails = diagnostics.filter((d) => d.kind === "requestfailed");
  checks.push(
    check("browser:console", "No JS errors or failed requests during the run", errors.length === 0 && netFails.length === 0 ? PASS : FAIL, {
      detail:
        errors.length === 0 && netFails.length === 0
          ? undefined
          : [...errors, ...netFails].slice(0, 15).map((d) => `[${d.label}/${d.kind}] ${d.text}`).join("\n"),
      evidence: { errors: errors.length, requestFailures: netFails.length, all: diagnostics.slice(0, 50) },
    })
  );

  if (artifacts.length) {
    checks[checks.length - 1].artifacts = artifacts;
  }
  if (logLines.length) {
    const logFile = path.join(artifactDir, "browser-run.log");
    await writeFile(logFile, logLines.join("\n")).catch(() => {});
  }

  return checks;
}

// Tabs other than Play, each of which loads its own data and draws its own
// layout. Checked at both a desktop and a phone width, and checked for the
// app's own "couldn't load this" copy - a tab that renders its error message
// perfectly is still a broken tab, and a pure layout/console audit would call
// that a pass.
const TABS = [
  { name: "Profile", nav: "#nav-profile", screen: "#screen-profile" },
  { name: "Rewards", nav: "#nav-badges", screen: "#screen-badges" },
  { name: "Squads", nav: "#nav-squads", screen: "#screen-squads" },
];

const ERROR_COPY = /couldn't load|could not load|something went wrong|failed to load/i;

async function auditTabs(page, log, viewports, fixedViewport = false) {
  const out = [];
  const rows = [["tab", "width", "rendered", "error copy", "escaping", "h-overflow"]];
  const problems = [];
  const list = fixedViewport ? viewports : [viewports[0], viewports[2]].filter(Boolean);

  for (const tab of TABS) {
    for (const vp of list) {
      if (!fixedViewport) await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.locator(tab.nav).click().catch(() => {});
      const shown = await page
        .locator(`${tab.screen}:not(.hidden)`)
        .waitFor({ state: "visible", timeout: 15000 })
        .then(() => true)
        .catch(() => false);

      // Give the tab's own async loads a moment to resolve or fail.
      await sleep(1200);

      const text = shown ? ((await page.locator(tab.screen).innerText().catch(() => "")) || "") : "";
      const errored = ERROR_COPY.test(text);
      const empty = shown && text.trim().length < 20;
      const audit = shown ? await page.evaluate(LAYOUT_AUDIT) : { escapingCount: 0, documentOverflowPx: 0, escaping: [] };

      rows.push([
        tab.name,
        fixedViewport ? vp.name : `${vp.width}px`,
        shown ? "yes" : "NO",
        errored ? "YES" : empty ? "EMPTY" : "no",
        String(audit.escapingCount),
        `${audit.documentOverflowPx}px`,
      ]);

      if (!shown) problems.push(`${tab.name} @${vp.width}px: screen never became visible`);
      else if (errored) {
        const line = (text.split("\n").find((l) => ERROR_COPY.test(l)) || "").trim();
        problems.push(`${tab.name} @${vp.width}px: shows an error - "${line}"`);
      } else if (empty) problems.push(`${tab.name} @${vp.width}px: rendered empty`);
      if (audit.escapingCount || audit.documentOverflowPx) {
        problems.push(
          `${tab.name} @${vp.width}px: ${audit.escapingCount} element(s) escape, ` +
            `${audit.documentOverflowPx}px horizontal overflow` +
            (audit.escaping.length ? ` (${audit.escaping.slice(0, 3).map((e) => e.el).join(", ")})` : "")
        );
      }
      log(`  tab ${tab.name} @${vp.width}px: ${shown ? "shown" : "MISSING"}${errored ? " ERROR" : ""}`);
    }
  }

  if (!fixedViewport) await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("#nav-play").click().catch(() => {});
  await page.locator("#screen-home:not(.hidden)").waitFor({ state: "visible", timeout: 15000 }).catch(() => {});

  out.push(
    check("browser:tabs", "Profile, Rewards and Squads load at desktop and phone widths", problems.length ? FAIL : PASS, {
      detail: problems.length ? problems.join("\n") : undefined,
      table: rows,
    })
  );
  return out;
}

function normalizeScore(text) {
  const nums = (text.match(/\d+/g) || []).map(Number).sort((a, b) => a - b);
  return nums.join("-");
}

function frameCheck(id, title, perf, sessionCount = 1) {
  const ok = perf.worstMs <= BUDGET.worstFrameMs && perf.janky100 <= BUDGET.janky100Frames;
  // A two-context run puts two Chromiums (and the harness) on one CPU, and
  // the contention shows up as frames landing on every other vsync - a p50 of
  // exactly 33.3ms against 16.7ms for the same code in a single context. That
  // is the measurement environment, not the app, and reading it as jank would
  // send someone optimising a problem players never see. Said out loud so the
  // number isn't quietly mistaken for a finding.
  const contention =
    sessionCount > 1 && perf.p50Ms > 25
      ? `Two browser contexts share one CPU in this run; a p50 near 33ms is that contention, not the app. ` +
        `Compare against the single-context run for the app's real frame budget.`
      : undefined;
  return check(id, title, ok ? PASS : WARN, {
    detail: contention,
    durationMs: perf.durationMs,
    table: [
      ["metric", "value", "budget"],
      ["frames sampled", String(perf.frameCount), "-"],
      ["mean frame", `${perf.meanMs.toFixed(1)}ms`, "-"],
      ["p50 frame", `${perf.p50Ms.toFixed(1)}ms`, "-"],
      ["p95 frame", `${perf.p95Ms.toFixed(1)}ms`, "-"],
      ["worst frame", `${perf.worstMs.toFixed(1)}ms`, `${BUDGET.worstFrameMs}ms`],
      ["frames > 50ms", String(perf.janky50), "-"],
      ["frames > 100ms", String(perf.janky100), String(BUDGET.janky100Frames)],
    ],
    evidence: perf,
  });
}

function fmt(v) {
  return v == null ? "-" : Math.round(v).toString();
}
