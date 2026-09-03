// Driving the app through its screens, in a real browser.
//
// Extracted from scripts/verify-browser.mjs when a second caller appeared.
// The verification harness drives the app to MEASURE it; the mobile baseline
// capture drives the same screens to PHOTOGRAPH them. Both need a signed-in
// session, a completed draft and the strategy phases committed, and neither
// has any business owning that knowledge - so it lives here, once.
//
// Everything in this file takes a Playwright `page` and a `log` function and
// knows nothing about checks, budgets or reports. That is the seam: a caller
// decides what a screen is FOR, this file only knows how to get there.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { LAYOUT_AUDIT } from "./browser-instrumentation.mjs";
import { loadDataset } from "../../data/load.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/** Rounds in a ranked draft. The draft driver uses it only as a runaway
 * guard - it stops on the first post-draft phase, not on a count. */
export const RANKED_ROUNDS = 10;

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
 * read data/nba-players.json unconditionally and keyed on `decade`, so pointing
 * the run at football produced "no local squad data for Cleveland Browns
 * 2010s" on every single round - the harness could not type a name it did not
 * have, the draft never advanced, and it failed as a timeout rather than as a
 * missing dataset. Football groups by ERA and its draftable entries include
 * UNITS as well as people, which have no ppg to sort by.
 */
export async function loadSquadIndex(sportId = "nba") {
  // Through the one loader rather than importing the files: they are JSON now,
  // and a dynamic import of JSON needs an import attribute the harness has no
  // reason to know about. See data/load.mjs.
  const source = sportId === "nfl" ? ["nfl-players", "nfl-units"] : ["nba-players"];

  const rows = [];
  for (const dataset of source) rows.push(...(await loadDataset(dataset)));

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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
export const waitBudget = (deadline, minMs, maxMs) =>
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
export async function driveDraft(page, squadIndex, label, log, deadline) {
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

export async function isPastDraft(page) {
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
export async function auditAtWidth(page, width, height) {
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

/**
 * Commit whatever the sport asks for between the draft and the game.
 *
 * THE PHASES ARE RACED, NOT QUEUED, and that is the whole of this rewrite.
 *
 * It used to wait for rotation, then matchups, then the gameplan, each in turn
 * and each for up to 60 seconds. Basketball puts all three up, so every wait
 * returned at once and the whole phase took 783ms. FOOTBALL HAS NEITHER A
 * ROTATION NOR MATCHUPS - it substitutes by unit, not by a sixth man - so
 * those two waits sat there for their full 60 seconds each while the gameplan
 * phase, which was on screen the entire time, ran out its own 60-second timer
 * behind them. By the time the harness looked for it, the app had auto-picked
 * and played the game.
 *
 * The run still ended at a final score, because a timed-out gameplan is a
 * legitimate way to reach one - which is exactly why this hid for so long.
 * What was actually happening is that FOOTBALL'S ENTIRE STRATEGY PHASE WENT
 * DRIVEN BY NOBODY: two rounds of gameplan cards that no test ever clicked,
 * on the screen where football's own verify-nfl-gameplans suite says the sport
 * is most different from basketball.
 *
 * So nothing is waited for by name any more. Each turn of the loop asks the
 * page which phase panel is open and handles that one, which is what a person
 * sitting in front of it does. A sport that skips a phase costs nothing; a
 * sport that adds a fourth needs no change here.
 */
export async function driveStrategyPhases(page, label, log, deadline) {
  // Every panel this app can put between the draft and the game, and the
  // control that commits each. Order is not significant - the page decides
  // which is open - it is only the list of what to recognise.
  const PANELS = [
    { name: "rotation", panel: "#rotation-phase", confirm: "#btn-confirm-rotation" },
    { name: "matchups", panel: "#matchup-phase", confirm: "#btn-confirm-matchups" },
    { name: "gameplan", panel: "#tactic-phase", confirm: "#btn-play-game" },
  ];
  // A gameplan is ROUNDS, not a screen: football asks twice, offence then
  // defence, behind the same panel. Anything past this is a loop that is not
  // making progress.
  const MAX_STRATEGY_ROUNDS = 4;
  // How long to keep looking once nothing is open and the game has not
  // started. Long enough to cover the gap between two phases, short enough
  // that a flow which is genuinely finished does not idle here.
  const QUIET_MS = 4000;

  const shape = [];
  let rounds = 0;
  let confirmed = 0;
  let lastActivity = Date.now();

  const openPanel = () =>
    page.evaluate((panels) => {
      if (!document.querySelector("#screen-game")?.classList.contains("hidden")) return "game";
      for (const p of panels) {
        const el = document.querySelector(p.panel);
        if (el && !el.classList.contains("hidden")) return p.name;
      }
      return null;
    }, PANELS.map(({ name, panel }) => ({ name, panel }))).catch(() => null);

  while (Date.now() < deadline) {
    const open = await openPanel();
    // The game screen is the end of this phase however it was reached.
    if (open === "game") break;
    if (!open) {
      // Nothing open and no game yet. Give it a moment - phases hand over
      // through a render - but do not sit here for a minute the way the old
      // per-phase waits did.
      if (Date.now() - lastActivity > QUIET_MS) break;
      await page.waitForTimeout(150);
      continue;
    }

    const phase = PANELS.find((p) => p.name === open);
    if (phase.name === "gameplan") {
      if (rounds >= MAX_STRATEGY_ROUNDS) {
        log(`  ${label}: gameplan still up after ${rounds} rounds - giving up on it`);
        break;
      }
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
    }
    await page.locator(phase.confirm).click({ timeout: 10000 }).catch(() => {});
    if (phase.name !== "gameplan") {
      confirmed += 1;
      log(`  ${label}: confirmed ${phase.name}`);
    }
    lastActivity = Date.now();
    // Long enough for the next panel to render, short enough that two rounds
    // of gameplan do not spend the sport's own timer waiting.
    await page.waitForTimeout(400);
  }

  log(
    `  ${label}: ${confirmed} phase${confirmed === 1 ? "" : "s"} confirmed, ` +
      `gameplan chosen over ${rounds} round${rounds === 1 ? "" : "s"}`
  );
  for (const [i, r] of shape.entries()) {
    log(`  ${label}: round ${i + 1} offered ${r.cards} card(s) — ${r.heading.replace(/\s+/g, " ").trim()}`);
  }
  return shape;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function signIn(page, { username, password }, log) {
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
