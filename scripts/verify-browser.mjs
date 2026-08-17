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

/**
 * Sizes for auditing a screen that only exists part-way through a match.
 *
 * A short list on purpose: each entry costs a resize, two frames and a DOM
 * walk in the middle of a live flow with a running clock, so this is the
 * narrowest pair that still says something the end-of-run audit cannot -
 * the tightest portrait width the suite holds itself to, and the landscape
 * that a phone falls into by accident, where it is vertical room that runs
 * out rather than horizontal.
 */
const MID_FLOW_VIEWPORTS = [
  ["phone-360", 360, 800],
  ["landscape-640", 640, 360],
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
    // The brand mark is optional BY DESIGN: index.html carries
    // onerror="this.remove()" so a missing logo degrades to the wordmark
    // rather than a broken image. Matched on URL, not on the word "404", so a
    // missing resource anywhere else still fails the run.
    if (/404/.test(text) && /assets\/brand\//.test(msg.location()?.url || "")) return;
    sink.push({ kind: "console", label, text, at: new Date().toISOString() });
  });
  page.on("pageerror", (err) => {
    sink.push({ kind: "pageerror", label, text: err.message, stack: err.stack, at: new Date().toISOString() });
  });
  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText || "unknown";
    if (failure.includes("ERR_ABORTED")) return; // navigations the app cancelled itself
    if (/assets\/brand\//.test(req.url())) return; // optional brand mark, see above
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
/**
 * Every squad the draft can roll, keyed the way the squad banner names it.
 *
 * PER SPORT, because the sports do not share a dataset OR a grouping. This
 * read data/nba-players.js unconditionally and keyed on `decade`, so pointing
 * the run at football produced "no local squad data for Cleveland Browns
 * 2010s" on every single round - the harness could not type a name it did not
 * have, the draft never advanced, and it failed as a timeout rather than as a
 * missing dataset. Football groups by ERA and its draftable entries include
 * UNITS as well as people, which have no ppg to sort by.
 */
async function loadSquadIndex(sportId = "nba") {
  const source = sportId === "nfl"
    ? [
        [path.join(ROOT, "data", "nfl-players.js"), "ROWS"],
        [path.join(ROOT, "data", "nfl-units.js"), "ROWS"],
      ]
    : [[path.join(ROOT, "data", "nba-players.js"), "PLAYERS"]];

  const rows = [];
  for (const [file, exportName] of source) {
    const mod = await import(new URL(`file://${file}`).href);
    rows.push(...(mod[exportName] || []));
  }

  const groupKey = sportId === "nfl" ? "era" : "decade";
  const index = new Map();
  for (const p of rows) {
    const key = `${p.team}|${p[groupKey]}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(p);
  }
  // Best players first: a draft that always takes the top available name
  // finishes in the fewest attempts and produces a realistic roster. The
  // ranking is per sport for the same reason the dataset is - football has no
  // ppg, and a unit has no per-game scoring at all.
  const rank = sportId === "nfl"
    ? (p) => (Number(p.pass_yds) || 0) * 0.25 + (Number(p.rush_yds) || 0) +
             (Number(p.rec_yds) || 0) + (Number(p.rating) || 0) + (Number(p.tackles) || 0)
    : (p) => Number(p.ppg) || 0;
  for (const [key, list] of index) {
    list.sort((a, b) => rank(b) - rank(a));
    if (sportId === "nfl") index.set(key, interleaveByPosition(list));
  }
  return index;
}

/**
 * Best-first WITHIN each position, then one position at a time.
 *
 * makeOnePick tries candidates in order and pays up to 2.5 seconds for each
 * one that does not turn into a pick. A straight best-first list is fine for
 * basketball, where almost any guard fits almost any open slot, and badly
 * wrong for football: a twelve-slot roster with one QB and one TE means a list
 * headed by six receivers wastes most of a round's budget before it offers
 * anything the open slot can take. Round-robin means whatever slot is open,
 * something eligible for it shows up in the first handful of tries.
 */
function interleaveByPosition(list) {
  const byPosition = new Map();
  for (const p of list) {
    const key = String(p.group || (p.pos || [])[0] || "?").toUpperCase();
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key).push(p);
  }
  const queues = [...byPosition.values()];
  const out = [];
  for (let i = 0; out.length < list.length; i++) {
    let moved = false;
    for (const q of queues) {
      if (i < q.length) {
        out.push(q[i]);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * How long to wait for one step, given the run's remaining budget.
 *
 * THE FLOOR IS THE POINT. Every call site used to clamp with
 * `Math.max(5000, deadline - Date.now())`, which looks like a safety net and is
 * really a trap: once the budget is spent, every later wait silently collapses
 * to five seconds and its step fails. The run then reports "the simulation
 * never reached a final score" about a game that was playing perfectly and had
 * simply not been given time to finish - a budget overrun wearing a product
 * bug's clothes. That cost a full investigation twice, most recently for
 * football, whose longer draft pushes everything after it past the deadline.
 *
 * The floor is now the minimum time the step genuinely needs, so overrunning
 * the budget produces an honest overrun instead of a false failure. The budget
 * is still a hang guard, because `max` bounds every wait.
 */
const waitBudget = (deadline, minMs, maxMs) =>
  Math.min(maxMs, Math.max(minMs, deadline - Date.now()));

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
      // The first SELECTABLE year, not the first year. Seasons a player
      // cannot be placed in are offered but disabled - Allen Iverson's
      // shooting-guard years are greyed out once SG is filled - and clicking
      // a disabled button leaves the modal open, which then swallows every
      // later click on the board.
      const season = page.locator("#modal-backdrop .season-option:not([disabled])").first();
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
/**
 * Whatever is on screen right now, measured at a phone width and put back.
 *
 * The run drives at desktop size, so anything that only exists mid-flow - the
 * gameplan cards above all - is never seen at 360px by the end-of-run audit.
 * Restores the previous viewport so the flow it interrupted carries on at the
 * size it was driving at.
 */
async function auditAtWidth(page, width, height) {
  const before = page.viewportSize();
  if (!before) return null; // a real device context; its width is already the point
  try {
    await page.setViewportSize({ width, height: height || before.height });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const audit = await page.evaluate(LAYOUT_AUDIT);
    return {
      width,
      overlapCount: audit.overlapCount,
      escapingCount: audit.escapingCount,
      documentOverflowPx: audit.documentOverflowPx,
      worst: [
        ...audit.escaping.slice(0, 3).map((e) => `escapes: ${e.el} (${e.left}..${e.right} vs ${e.viewport}px)`),
        ...audit.overlaps.slice(0, 3).map((o) => `overlaps: ${o.a} / ${o.b} by ${o.overlapPx}`),
      ],
    };
  } catch {
    return null;
  } finally {
    await page.setViewportSize(before).catch(() => {});
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r))).catch(() => {});
  }
}

async function driveStrategyPhases(page, label, log, deadline) {
  const phases = [
    { name: "rotation", panel: "#rotation-phase", button: "#btn-confirm-rotation" },
    { name: "matchups", panel: "#matchup-phase", button: "#btn-confirm-matchups" },
  ];

  for (const phase of phases) {
    const shown = await page
      .locator(`${phase.panel}:not(.hidden)`)
      .waitFor({ state: "visible", timeout: waitBudget(deadline, 10000, 60000) })
      .then(() => true)
      .catch(() => false);
    if (!shown) {
      log(`  ${label}: ${phase.name} phase not shown (mode may skip it)`);
      continue;
    }
    await page.locator(phase.button).click({ timeout: 10000 });
    log(`  ${label}: confirmed ${phase.name}`);
  }

  // THE GAMEPLAN IS ROUNDS, NOT A SCREEN.
  //
  // Basketball asks one question here. Football asks two - offence, then
  // defence - behind the same #tactic-phase panel, each advanced by
  // #btn-play-game. Clicking through once locked the offence, left the
  // defensive round on screen and reported "gamestyle chosen, game started"
  // for a game that had not started, so the failure surfaced much later as
  // "the game screen never appeared" with no hint of the cause.
  //
  // Driven as a loop over whatever rounds the sport puts up, so a third one
  // would not need this written again.
  const MAX_STRATEGY_ROUNDS = 4;
  let rounds = 0;
  const firstRound = await page
    .locator("#tactic-phase:not(.hidden)")
    .waitFor({ state: "visible", timeout: waitBudget(deadline, 10000, 60000) })
    .then(() => true)
    .catch(() => false);
  // What each round actually put up, so the SHAPE of the flow is asserted and
  // not just its completion. Football's two rounds are the case that broke
  // before: the harness clicked once, reported success, and the defensive
  // round was still on screen.
  const shape = [];
  if (firstRound) {
    while (
      rounds < MAX_STRATEGY_ROUNDS &&
      (await page.locator("#tactic-phase:not(.hidden)").isVisible().catch(() => false))
    ) {
      shape.push({
        cards: await page.locator("#tactic-grid .tactic-card, #tactic-grid button").count().catch(() => 0),
        heading: (await page.locator("#draft-turn-banner").textContent().catch(() => "")) || "",
        // Gameplan cards are audited HERE because this is the only moment they
        // exist. The post-game layout audit at the end of the run cannot see
        // them - the phase is long gone by then - so "the cards render on
        // mobile" was a claim no test could make. Measured at 360px, the
        // narrowest width the rest of the suite holds itself to.
        phone: await auditAtWidth(page, 360),
      });
      await page.locator("#tactic-grid .tactic-card, #tactic-grid button").first().click().catch(() => {});
      rounds += 1;
      await page.locator("#btn-play-game").click({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
    log(`  ${label}: gameplan chosen over ${rounds} round${rounds === 1 ? "" : "s"}, game started`);
    for (const [i, r] of shape.entries()) {
      log(`  ${label}: round ${i + 1} offered ${r.cards} card(s) — ${r.heading.replace(/\s+/g, " ").trim()}`);
    }
  }
  return shape;
}

/**
 * The football gameplan flow, asserted rather than merely driven.
 *
 * Three things have gone wrong here before and none of them stops the game
 * from starting, so none of them fails a test that only checks the game
 * started: both sides of the ball on screen at once, a round offering the
 * whole catalogue instead of a hand, and defence being reachable without
 * confirming offence. `shape` is what the rounds actually showed, captured as
 * they were played.
 */
export function checkNflGameplanShape(shape, expectedPerRound = 3) {
  const problems = [];
  if (shape.length !== 2) {
    problems.push(`expected 2 rounds (offense then defense), saw ${shape.length}`);
  }
  const [offense, defense] = shape;
  if (offense && !/offensive/i.test(offense.heading)) {
    problems.push(`round 1 is not the offensive round: "${offense.heading.trim()}"`);
  }
  if (defense && !/defensive/i.test(defense.heading)) {
    problems.push(`round 2 is not the defensive round: "${defense.heading.trim()}"`);
  }
  for (const [i, r] of shape.entries()) {
    if (r.cards !== expectedPerRound) {
      problems.push(`round ${i + 1} offered ${r.cards} cards, expected ${expectedPerRound}`);
    }
  }
  return problems;
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
    // A HANG GUARD, NOT A PERFORMANCE ASSERTION - real responsiveness is
    // measured by the frame budgets above. Football needs more of it than
    // basketball for reasons that are not about speed: twelve draft rounds
    // instead of ten, and names like "Cleveland Browns Offensive Line" typed a
    // character at a time - twelve rounds of that runs about 150 seconds on
    // its own before a down has been played.
    //
    // The KNOWN GAP that stood here - "`SELFTEST_SPORT=nfl` still does not
    // finish", dying on the final-score wait - is closed. The full football
    // run now completes: sign-in, twelve draft rounds, both gameplan rounds, a
    // simulated final score, the box score and the phone-width layout audit,
    // in about 290s of the 420s budget.
    //
    // Not attributable to any one commit. It was measured green on the merge
    // of the NFL playback and engine work, BEFORE the stage-ordering fix that
    // landed alongside this comment - checked deliberately, because the
    // tempting story (football was drawing on a hidden field) is wrong: the
    // wrong-stage flash was only ever in the ONLINE flow, which awaits the
    // server between showing the screen and playing the result, and this
    // harness plays a practice match. Keep the wider budget; football's
    // playback legitimately needs it.
    budgetMs = (process.env.SELFTEST_SPORT || "nba") === "nba" ? 210000 : 420000,
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

    // The profile's hierarchy, not just its dimensions. The layout audit above
    // is happy with a screen that fits and says nothing - it would pass a
    // profile whose name heading rendered empty, or one that opened on the
    // account form again. Both are the exact regression this restructure is.
    await sessions[0].page.locator("#nav-profile").click().catch(() => {});
    await sleep(600);
    const identity = await sessions[0].page.evaluate(() => {
      const heading = document.getElementById("profile-display-name");
      const account = document.querySelector(".profile-account");
      const input = document.getElementById("input-profile-username");
      const headingTop = heading?.getBoundingClientRect().top ?? 0;
      const accountTop = account?.getBoundingClientRect().top ?? 0;
      return {
        name: (heading?.textContent || "").trim(),
        accountOpen: account ? account.hasAttribute("open") : null,
        // The whole point of the change: identity above administration.
        nameAboveAccount: headingTop > 0 && accountTop > headingTop,
        inputStillWired: !!input,
      };
    });
    // Reduced motion, asserted on real computed styles rather than trusted.
    //
    // The app carries thirty-odd keyframe animations and used to protect them
    // one scattered @media block at a time, which left twenty-six unprotected
    // - eight of them infinite. The safety net is meant to make that structural
    // rather than remembered, and the only way to know it holds is to ask the
    // browser with the preference actually set.
    //
    // Near-zero rather than `none`, so animationend still fires: a handler
    // waiting on one before revealing the next thing would otherwise hang, and
    // an accessibility preference that freezes the app is worse than one that
    // is ignored.
    await sessions[0].page.emulateMedia({ reducedMotion: "reduce" });
    await sleep(300);
    const motion = await sessions[0].page.evaluate(() => {
      const ms = (v) => (v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000);
      // EVERYTHING on the visible screen, not a hand-picked selector list.
      // The infinite pulses this is most concerned about - an eligible slot, a
      // live dot, a breathing banner - are none of them buttons, so a sample of
      // buttons would report "no infinite loops" while they ran on regardless.
      const sample = [...document.querySelectorAll(".screen:not(.hidden), .screen:not(.hidden) *, .top-nav, .top-nav *")].slice(0, 600);
      let worstAnim = 0;
      let worstTrans = 0;
      let infinite = 0;
      for (const el of sample) {
        const cs = getComputedStyle(el);
        for (const d of cs.animationDuration.split(",")) worstAnim = Math.max(worstAnim, ms(d.trim()));
        for (const d of cs.transitionDuration.split(",")) worstTrans = Math.max(worstTrans, ms(d.trim()));
        if (/infinite/.test(cs.animationIterationCount)) infinite += 1;
      }
      const spinner = document.querySelector(".search-spinner");
      return {
        sampled: sample.length,
        worstAnim,
        worstTrans,
        infinite,
        // The documented exception: a spinner still spinning is the only thing
        // saying a request is in flight.
        spinnerStillSpins: spinner ? /infinite/.test(getComputedStyle(spinner).animationIterationCount) : "absent",
      };
    });
    // Reduced motion must not mean reduced INFORMATION. A newly filled roster
    // slot is the case that proved it: its glow is the only thing saying which
    // row just changed, and the blanket rule above silenced it outright.
    //
    // Read AFTER the animation would have finished. The first attempt at this
    // read the computed background immediately, which is the glow keyframe's
    // opening colour - so it passed whether or not the static fallback existed,
    // and removing the fallback did not fail it. Waiting past the (now
    // ~0.01ms) animation is what makes this test the thing it claims to be.
    motion.revealStillReads = await sessions[0].page.evaluate(async () => {
      const probe = document.createElement("span");
      probe.className = "slot-filled slot-reveal";
      (document.querySelector(".screen:not(.hidden)") || document.body).appendChild(probe);
      await new Promise((r) => setTimeout(r, 80));
      const bg = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const alpha = /rgba?\(([^)]+)\)/.exec(bg);
      const parts = alpha ? alpha[1].split(",").map((n) => parseFloat(n)) : [];
      return parts.length === 4 ? parts[3] > 0.05 : parts.length === 3;
    });

    await sessions[0].page.emulateMedia({ reducedMotion: null });
    const motionOk =
      motion.sampled > 0 && motion.worstAnim <= 1 && motion.worstTrans <= 1 && motion.infinite === 0 &&
      // Both halves, or this only tests that motion stopped and says nothing
      // about whether the information survived it.
      motion.revealStillReads === true;
    checks.push(
      check(
        "browser:reduced-motion",
        motionOk
          ? `Reduced motion stops movement, not meaning (${motion.sampled} elements stilled, roster reveal still reads as a highlight)`
          : `Reduced motion not honoured: ${JSON.stringify(motion)}`,
        motionOk ? PASS : FAIL
      )
    );

    // Back to Play. auditTabs leaves the app where it started because it ends
    // on its own navigation; this check does not, and leaving the run parked
    // on the profile means the match below never starts.
    await sessions[0].page.locator("#nav-play").click().catch(() => {});
    await sleep(400);

    const identityOk =
      identity.name.length > 0 && identity.name !== "Player" &&
      identity.accountOpen === false && identity.nameAboveAccount && identity.inputStillWired;
    checks.push(
      check(
        "browser:profile-identity",
        identityOk
          ? `Profile leads with the player (“${identity.name}”), account settings collapsed below`
          : `Profile hierarchy wrong: ${JSON.stringify(identity)}`,
        identityOk ? PASS : FAIL
      )
    );

    // ---- start the match --------------------------------------------------
    const matchStart = Date.now();
    for (const { page } of sessions) {
      // Pick a sport first. The home screen is a sport hub now - the mode
      // toggle only exists once you are inside a sport, so this test sat on
      // the hub clicking at a button that was not on the page yet. It is not
      // that the app broke; the test was written before the hub existed.
      //
      // WHICH sport comes from SELFTEST_SPORT, defaulting to basketball. It
      // used to read an identifier that was never defined anywhere, so the
      // expression always fell through to "nba" - except that a restored
      // session remembers the sport it was last on, so the run silently tested
      // whichever sport the previous run happened to leave behind. Two
      // consecutive runs covered different sports and neither said so, which
      // made a real football failure look like it came and went.
      const wantedSport = process.env.SELFTEST_SPORT || "nba";
      const sportRow = page.locator(`[data-sport="${wantedSport}"]`).first();
      if (await sportRow.count()) await sportRow.click();
      // WHICH MODE, likewise. Offline runs only ever drove Ranked Practice, so
      // Quick Play - a mode with its own roster shape, its own ruleset and no
      // strategy phases at all - had no browser coverage in either sport.
      // SELFTEST_MODE selects it; the default is unchanged.
      const offlineMode = process.env.SELFTEST_MODE === "quick" ? "practice-easy" : "practice-hard";
      const modeBtn = mode === "online" ? '[data-mode="online"]' : `[data-mode="${offlineMode}"]`;
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
          .waitFor({ state: "visible", timeout: waitBudget(deadline, 20000, 90000) })
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

    // The draft board is where a player spends most of a match and it was
    // never measured on a phone - the end-of-run audit sees the post-game
    // screen, by which point the board is gone. Landscape is included because
    // it is the orientation a phone lands in by accident, and a 360px-tall
    // viewport is a different problem from a 360px-wide one: it is vertical
    // room that runs out, not horizontal.
    //
    // Measured EMPTY here and again FULL after the draft below, because they
    // are different layouts - an empty slot says "open", a filled one carries
    // a name, a season and, in football, a unit roll.
    const draftShapes = { empty: {}, full: {} };
    for (const [name, w, h] of MID_FLOW_VIEWPORTS) {
      draftShapes.empty[name] = await auditAtWidth(sessions[0].page, w, h);
    }

    // ---- draft ------------------------------------------------------------
    // Watch for the roster reveal animation before a single pick is made.
    // A filled slot flips and glows (.slot-reveal) so you can see WHAT you
    // just got and compare it against the opponent's - the one moment in a
    // draft where something changed and you were not the one who changed it.
    //
    // Sampled with a MutationObserver rather than a poll: the class lives on a
    // node that renderRosterPanel rebuilds every round, and the animation is
    // shorter than any polling interval that would not slow the run down.
    await sessions[0].page.evaluate(() => {
      window.__bkReveals = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const node of r.addedNodes) {
            if (node.nodeType === 1 && node.classList?.contains("slot-reveal")) window.__bkReveals += 1;
            if (node.nodeType === 1 && node.querySelectorAll) {
              window.__bkReveals += node.querySelectorAll(".slot-reveal").length;
            }
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    });

    const draftStart = Date.now();
    const squadIndex = await loadSquadIndex(process.env.SELFTEST_SPORT || "nba");
    const picks = await Promise.all(
      sessions.map(({ page, label }) => driveDraft(page, squadIndex, label, log, deadline))
    );
    checks.push(
      check("browser:draft", `Both rosters auto-draft (${picks.join(" + ")} picks)`, PASS, {
        durationMs: Date.now() - draftStart,
      })
    );

    const reveals = await sessions[0].page.evaluate(() => window.__bkReveals || 0);
    checks.push(
      check(
        "browser:roster-reveal",
        reveals > 0
          ? `Newly filled roster slots animate (${reveals} reveals over the draft)`
          : "No roster slot ever played its reveal animation during the draft",
        reveals > 0 ? PASS : FAIL
      )
    );

    for (const [name, w, h] of MID_FLOW_VIEWPORTS) {
      draftShapes.full[name] = await auditAtWidth(sessions[0].page, w, h);
    }
    const draftProblems = [];
    for (const [when, byViewport] of Object.entries(draftShapes)) {
      for (const [name, a] of Object.entries(byViewport)) {
        if (!a) continue;
        if (a.overlapCount || a.escapingCount || a.documentOverflowPx) {
          draftProblems.push(`${when} @ ${name}: ${a.worst.join("; ") || `${a.documentOverflowPx}px overflow`}`);
        }
      }
    }
    checks.push(
      check(
        "browser:draft-mobile",
        draftProblems.length
          ? `Draft board breaks on a phone — ${draftProblems.join(" | ")}`
          : `Draft board holds empty and full, portrait and landscape (${MID_FLOW_VIEWPORTS.map((v) => v[0]).join(", ")})`,
        draftProblems.length ? FAIL : PASS
      )
    );

    // ---- strategy phases --------------------------------------------------
    const strategyStart = Date.now();
    const shapes = await Promise.all(sessions.map(({ page, label }) => driveStrategyPhases(page, label, log, deadline)));
    checks.push(check("browser:strategy", "Rotation, matchups and gamestyle commit", PASS, { durationMs: Date.now() - strategyStart }));

    // Gameplan cards at 360px, for whichever sport is under test. Both sports
    // put cards up here; only the number of rounds differs.
    const cardProblems = shapes.flatMap((shape, i) =>
      shape
        .filter((r) => r.phone && (r.phone.overlapCount || r.phone.escapingCount || r.phone.documentOverflowPx))
        .map((r, roundIdx) =>
          `${sessions[i].label} round ${roundIdx + 1}: ${r.phone.worst.join("; ") || `${r.phone.documentOverflowPx}px overflow`}`
        )
    );
    const audited = shapes.flat().filter((r) => r.phone).length;
    checks.push(
      check(
        "browser:gameplan-mobile",
        cardProblems.length
          ? `Gameplan cards break at 360px — ${cardProblems.join(" | ")}`
          : `Gameplan cards hold at 360px (${audited} round${audited === 1 ? "" : "s"} audited)`,
        cardProblems.length ? FAIL : PASS
      )
    );

    // Football's two rounds are a shape, not just a count of clicks. Asserted
    // per session, because "the game started" stays true for every way this
    // has broken.
    if ((process.env.SELFTEST_SPORT || "nba") === "nfl") {
      const problems = shapes.flatMap((shape, i) =>
        checkNflGameplanShape(shape).map((p) => `${sessions[i].label}: ${p}`)
      );
      checks.push(
        check(
          "browser:nfl-gameplan-rounds",
          problems.length
            ? `NFL gameplan rounds are wrong — ${problems.join("; ")}`
            : "NFL offers 3 offensive plans, then 3 defensive plans, one round at a time",
          problems.length ? FAIL : PASS
        )
      );
    }

    // ---- simulation -------------------------------------------------------
    // Callouts and moment banners are transient by design - up for about a
    // second and then removed, so nothing about them survives to the end of the
    // run to be counted. Both are the difference between a chart filling in and
    // a game being watched, and neither leaves a trace a post-hoc query could
    // find. Counted as they happen.
    const simStart = Date.now();
    await Promise.all(sessions.map(({ page }) => page.evaluate(() => {
      window.__bkCallouts = 0;
      window.__bkMoments = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const node of r.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.classList?.contains("shot-callout")) window.__bkCallouts += 1;
            if (node.classList?.contains("court-moment")) window.__bkMoments += 1;
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    })));
    await Promise.all(sessions.map(({ page }) => page.evaluate(() => window.__bkPerfStart("simulation"))));

    const reachedGame = await Promise.all(
      sessions.map(({ page }) =>
        page
          .locator("#screen-game:not(.hidden)")
          .waitFor({ state: "visible", timeout: waitBudget(deadline, 30000, 90000) })
          .then(() => true)
          .catch(() => false)
      )
    );
    if (reachedGame.some((r) => !r)) throw new Error("the game screen never appeared after the strategy phase");

    // Long enough for the slowest sport's playback. Football's is a ~55s event
    // timeline against basketball's quarter animation, and it is the whole
    // point of the check that it be watched to the end rather than sampled.
    // Floor above football's ~55s playback, so a long run cannot turn a
    // healthy game into a reported failure.
    const finalWaitMs = waitBudget(deadline, 120000, 240000);
    const finals = await Promise.all(
      sessions.map(({ page }) =>
        page
          .locator("#final-banner:not(.hidden)")
          .waitFor({ state: "visible", timeout: finalWaitMs })
          .then(() => page.locator("#final-banner").textContent())
          .catch(() => null)
      )
    );
    const simPerf = await sessions[0].page.evaluate(() => window.__bkPerfStop("simulation"));

    if (finals.some((f) => !f)) {
      // WHERE IT GOT TO, not just that it did not arrive. "The simulation never
      // reached a final score" is true of a game that stalled on the first snap
      // and of one that was one play short, and those are completely different
      // bugs - the message sent every investigation back to the screenshot.
      const where = await Promise.all(
        sessions.map(({ page, label }) =>
          page
            .evaluate(() => {
              const t = (sel) => document.querySelector(sel)?.textContent?.trim() || "";
              const nums = (t("#live-scoreboard .scoreboard-score") || "").trim();
              return {
                clock: t(".ff-clock"),
                score: nums || t("#live-scoreboard"),
                feed: document.querySelectorAll("#play-feed .play-card").length,
                gameVisible: !document.querySelector("#screen-game")?.classList.contains("hidden"),
              };
            })
            .then((s) => `${label}: clock ${s.clock || "-"}, ${s.feed} feed cards, game screen ${s.gameVisible ? "up" : "gone"}, board "${String(s.score).replace(/\s+/g, " ").slice(0, 90)}"`)
            .catch(() => `${label}: unreadable`)
        )
      );
      throw new Error(
        `the simulation never reached a final score after ${(finalWaitMs / 1000).toFixed(0)}s - ${where.join(" | ")}`
      );
    }

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
    if ((process.env.SELFTEST_SPORT || "nba") === "nba") {
      const drama = await sessions[0].page.evaluate(() => ({
        callouts: window.__bkCallouts || 0,
        moments: window.__bkMoments || 0,
      }));
      // Callouts are withheld from ordinary misses on purpose, so the count is
      // well below the shot count - but a game with none means the whole
      // "worth saying" branch never fired. Moments are rarer still: a game can
      // legitimately have no lead change, so only callouts are required.
      // The buzzer overlay. Only exists after the final whistle, and it is the
      // thing that makes the settled chart readable rather than merely present.
      const zones = await sessions[0].page.evaluate(() => {
        const stats = [...document.querySelectorAll(".zone-stat")];
        const court = document.querySelector('[data-stage="court"]');
        const cr = court?.getBoundingClientRect();
        let outside = 0;
        for (const z of stats) {
          const r = z.getBoundingClientRect();
          if (cr && (r.left < cr.left - 2 || r.right > cr.right + 2)) outside += 1;
        }
        return {
          count: stats.length,
          sideA: document.querySelectorAll(".zone-stat-a").length,
          sideB: document.querySelectorAll(".zone-stat-b").length,
          outside,
          // Every label must carry volume AND rate - a bare percentage hides
          // whether it rests on three attempts or thirty.
          allHaveBoth: stats.every((z) => z.querySelector(".zone-stat-line") && z.querySelector(".zone-stat-pct")),
          sample: stats.slice(0, 2).map((z) => z.textContent.replace(/\s+/g, " ").trim()),
        };
      });
      const zonesOk = zones.count >= 4 && zones.sideA > 0 && zones.sideB > 0 &&
        zones.outside === 0 && zones.allHaveBoth;
      checks.push(
        check(
          "browser:zone-summary",
          zonesOk
            ? `Buzzer overlay reads the floor back (${zones.count} bands, both halves, e.g. ${zones.sample.join(" / ")})`
            : `Zone summary wrong: ${JSON.stringify(zones)}`,
          zonesOk ? PASS : FAIL
        )
      );

      const dramaOk = drama.callouts > 0;
      checks.push(
        check(
          "browser:live-drama",
          dramaOk
            ? `Live callouts fire on the shots worth naming (${drama.callouts} callouts, ${drama.moments} run/lead moments)`
            : `No shot callout ever appeared: ${JSON.stringify(drama)}`,
          dramaOk ? PASS : FAIL
        )
      );
    }

    // Team kits reaching the DOM. The unit test proves the palette is separable;
    // this proves the separation survives the trip through dressStage, the
    // custom properties and the cascade - a kit that is computed correctly and
    // then never applied looks exactly like no kit at all.
    const kits = await sessions[0].page.evaluate(() => {
      const stage = document.getElementById("court-stage");
      const cs = getComputedStyle(stage);
      const a = cs.getPropertyValue("--team-a-ink").trim();
      const b = cs.getPropertyValue("--team-b-ink").trim();
      // Where the kit has to LAND differs by sport, so both are read and the
      // caller asserts whichever this run has. Football has no shot markers at
      // all, and treating their absence as a failure made the football run fail
      // for having no basketball in it.
      const mark = document.querySelector(".shot-mark.shot-a");
      // What the marker ACTUALLY resolved to, not what the variable says. A
      // typo'd var name falls through to the fallback and still "has a colour".
      const markInk = mark ? getComputedStyle(mark).getPropertyValue("--shot-ink").trim() : null;
      const left = document.querySelector(".ff-endzone.left");
      const right = document.querySelector(".ff-endzone.right");
      const endzones = left && right
        ? {
            left: getComputedStyle(left).backgroundColor,
            right: getComputedStyle(right).backgroundColor,
          }
        : null;
      return {
        a,
        b,
        markInk,
        endzones,
        distinct: !!a && !!b && a !== b,
        markUsesKit: markInk === null ? null : markInk === a,
        endzonesDiffer: endzones ? endzones.left !== endzones.right : null,
      };
    });
    // Distinct kits always. Then whichever surface this sport actually draws:
    // basketball's markers, football's endzones. A run that has neither would
    // pass the first and prove nothing, so at least one has to be present.
    const surfaceChecked = kits.markUsesKit !== null || kits.endzonesDiffer !== null;
    const kitsOk =
      kits.distinct &&
      surfaceChecked &&
      kits.markUsesKit !== false &&
      kits.endzonesDiffer !== false;
    checks.push(
      check(
        "browser:team-kits",
        kitsOk
          ? `Both teams wear their own kit (${kits.a} vs ${kits.b}, ${kits.markUsesKit ? "markers follow" : "endzones differ"})`
          : `Kits not applied: ${JSON.stringify(kits)}`,
        kitsOk ? PASS : FAIL
      )
    );

    // The shot chart, if this sport draws one. Counted rather than assumed:
    // the ledger passing its own unit checks says the DATA is right, and a
    // clean console says nothing threw, but neither shows a single marker
    // reached the court. Made and missed are both required - a chart of only
    // makes would mean the miss path never ran.
    if ((process.env.SELFTEST_SPORT || "nba") === "nba") {
      const chart = await sessions[0].page.evaluate(() => {
        const marks = [...document.querySelectorAll(".shot-mark")];
        const court = document.querySelector('[data-stage="court"]');
        const board = document.getElementById("live-scoreboard");
        const cr = court?.getBoundingClientRect();
        const br = board?.getBoundingClientRect();
        // CONTAINMENT is the property that broke. The markers are placed as a
        // percentage of their parent, and when that parent was the whole stage
        // rather than the floor, corner threes landed on the scoreboard. A
        // count of markers cannot see that - they were all present and correct,
        // just drawn on top of the score.
        let outsideCourt = 0;
        let onScoreboard = 0;
        for (const m of marks) {
          const r = m.getBoundingClientRect();
          if (cr && (r.left < cr.left - 2 || r.right > cr.right + 2 || r.top < cr.top - 2 || r.bottom > cr.bottom + 2)) {
            outsideCourt += 1;
          }
          if (br && r.right > br.left && r.left < br.right && r.bottom > br.top && r.top < br.bottom) {
            onScoreboard += 1;
          }
        }
        return {
          total: marks.length,
          made: document.querySelectorAll(".shot-mark.shot-made").length,
          missed: document.querySelectorAll(".shot-mark.shot-miss").length,
          teamA: document.querySelectorAll(".shot-mark.shot-a").length,
          teamB: document.querySelectorAll(".shot-mark.shot-b").length,
          outsideCourt,
          onScoreboard,
          courtAboveBoard: cr && br ? cr.top < br.top : null,
        };
      });
      const chartOk = chart.total > 20 && chart.made > 0 && chart.missed > 0 &&
        chart.teamA > 0 && chart.teamB > 0 &&
        chart.outsideCourt === 0 && chart.onScoreboard === 0 && chart.courtAboveBoard === true;
      checks.push(
        check(
          "browser:shot-chart",
          chartOk
            ? `Shot chart stays on the court (${chart.total} marks — ${chart.made} made, ${chart.missed} missed, both teams, none on the scoreboard)`
            : `Shot chart did not draw as expected: ${JSON.stringify(chart)}`,
          chartOk ? PASS : FAIL
        )
      );
    }

    // The MVP row and the frozen name column. Both are pure CSS/markup and
    // both fail silently: a selector that never matches leaves a box score
    // that still renders correctly and simply never marks anybody, and a
    // sticky column that is not sticky just scrolls away with the numbers.
    const boxDetail = await sessions[0].page.evaluate(() => {
      const rows = document.querySelectorAll(".box-mvp");
      const nameCell = document.querySelector("table.box-table td:nth-child(2)");
      return {
        mvpRows: rows.length,
        starred: document.querySelectorAll(".box-mvp .box-mvp-star").length,
        nameSticky: nameCell ? getComputedStyle(nameCell).position : "no cell",
      };
    });
    // One per team at most, and never zero once a game has finished. Football
    // splits a roster over three grouped tables, so the row can legitimately
    // appear once per table it belongs to - the cap is what matters.
    const boxDetailOk =
      boxDetail.mvpRows >= 1 && boxDetail.mvpRows <= 2 &&
      boxDetail.starred === boxDetail.mvpRows &&
      boxDetail.nameSticky === "sticky";
    checks.push(
      check(
        "browser:box-mvp",
        boxDetailOk
          ? `MVP row marked and the name column stays put (${boxDetail.mvpRows} row, starred, position:sticky)`
          : `Box-score detail wrong: ${JSON.stringify(boxDetail)}`,
        boxDetailOk ? PASS : FAIL
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
  const rows = [["tab", "viewport", "rendered", "error copy", "escaping", "overlap", "h-overflow"]];
  const problems = [];
  // Desktop, the tightest portrait phone, and landscape. The narrow width and
  // the short height are different failure modes - one runs out of room across,
  // the other runs out down - and a tab audited only at 390px wide had never
  // been looked at in the orientation a phone falls into by accident.
  const list = fixedViewport
    ? viewports
    : [viewports[0], { name: "phone-360", width: 360, height: 800 }, { name: "landscape-640", width: 640, height: 360 }];

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
        fixedViewport ? vp.name : `${vp.width}x${vp.height}`,
        shown ? "yes" : "NO",
        errored ? "YES" : empty ? "EMPTY" : "no",
        String(audit.escapingCount),
        String(audit.overlapCount ?? 0),
        `${audit.documentOverflowPx}px`,
      ]);

      if (!shown) problems.push(`${tab.name} @${vp.width}px: screen never became visible`);
      else if (errored) {
        const line = (text.split("\n").find((l) => ERROR_COPY.test(l)) || "").trim();
        problems.push(`${tab.name} @${vp.width}px: shows an error - "${line}"`);
      } else if (empty) problems.push(`${tab.name} @${vp.width}px: rendered empty`);
      // Overlaps were being measured and then thrown away - only escaping
      // elements and page overflow were reported. Two controls sitting on top
      // of each other is the mobile failure a player actually hits: the thing
      // is on screen, it just cannot be tapped.
      if (audit.escapingCount || audit.documentOverflowPx || audit.overlapCount) {
        problems.push(
          `${tab.name} @${vp.width}x${vp.height}: ${audit.escapingCount} escape, ` +
            `${audit.overlapCount} overlap, ${audit.documentOverflowPx}px h-overflow` +
            (audit.escaping.length ? ` (${audit.escaping.slice(0, 3).map((e) => e.el).join(", ")})` : "") +
            (audit.overlaps?.length ? ` [${audit.overlaps.slice(0, 3).map((o) => `${o.a}/${o.b}`).join(", ")}]` : "")
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
