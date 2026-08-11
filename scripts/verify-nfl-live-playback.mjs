#!/usr/bin/env node
// Football's live playback, WATCHED IN A REAL BROWSER.
//
// WHY THIS EXISTS SEPARATELY FROM verify-nfl-event-ledger.mjs
//
// The ledger test proves the arithmetic: fold every event and you land on the
// engine's own box score, and stopping halfway through Q1 leaves the rest of
// Q1 genuinely absent from the state. That is necessary and it is not
// sufficient. A correct ledger wired into the screen incorrectly still shows
// the viewer a finished quarter - the bug this all exists to fix lived in
// main.js, not in the arithmetic, and no amount of module-level testing would
// have caught it.
//
// CLAUDE.md is blunt about this: a green verify means the modules parse and
// the contracts hold, not that the app runs. Two blank-screen bugs shipped
// past one. So this drives the actual app in Chromium, samples the actual DOM
// while a football game is actually playing, and asserts that what a viewer
// can read on screen only ever grows toward the result - never starts there.
//
// The self-test harness (scripts/selftest/run-selftest.mjs) drives basketball
// and picks players by name from data/nba-players.js. This one takes whatever
// card is offered instead, which needs no per-sport data and is all a draft
// needs to complete.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = Number(process.env.BK_NFL_PLAYBACK_PORT || 8937);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serve(root, port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/" || rel.endsWith("/")) rel += "index.html";
      const file = path.join(root, rel);
      if (!file.startsWith(root)) return res.writeHead(403).end("forbidden");
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Everything a viewer could read off the screen at one instant. */
const SAMPLE = () => {
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() || "";
  const scores = [...document.querySelectorAll("#live-scoreboard .scoreboard-score")]
    .map((el) => Number(el.textContent.trim()) || 0);
  // A published quarter is a column with a real label; the ones still to come
  // render as an en dash.
  const periodHeads = [...document.querySelectorAll("#live-scoreboard .scoreboard-grid thead th")]
    .map((el) => el.textContent.trim())
    .filter((t) => t && t !== "–" && t !== "T");
  // Everything the box score currently claims happened, as one number. It only
  // has to move in one direction for the assertion below to mean something.
  const boxTotal = [...document.querySelectorAll("#full-box-score td")]
    .reduce((sum, td) => {
      const n = Number(td.textContent.trim());
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  return {
    scoreA: scores[0] ?? 0,
    scoreB: scores[1] ?? 0,
    periods: periodHeads,
    boxTotal,
    status: text("#live-scoreboard .scoreboard-period"),
    finalShown: !document.querySelector("#final-banner")?.classList.contains("hidden"),
    finalText: text("#final-banner"),
    // The way OUT of the game. These are unhidden at the very end of the
    // post-game routine, so anything that throws partway through leaves them
    // hidden and the viewer with nowhere to go - which is exactly what a
    // missing MVP used to do to every football game.
    // Possession as STATE, not as words: which way the field is currently
    // leaning, and whether the viewer is attacking or defending.
    possession: (() => {
      const f = document.querySelector("#football-field");
      if (!f) return "none";
      if (f.classList.contains("ff-user-offense")) return "offense";
      if (f.classList.contains("ff-user-defense")) return "defense";
      return "none";
    })(),
    possessionText: document.querySelector("#football-field .ff-possession")?.textContent?.trim() || "",
    driveSummaries: document.querySelectorAll("#play-feed .play-card.drive-summary").length,
    canLeave: !document.querySelector("#btn-play-again")?.classList.contains("hidden"),
    mvpShown: !document.querySelector("#mvp-callout")?.classList.contains("hidden"),
    mvpText: text("#mvp-callout"),
  };
};

async function main() {
  const { chromium } = await import("playwright");
  const server = await serve(ROOT, PORT);
  const baseUrl = `http://127.0.0.1:${PORT}/`;
  console.log(renderSection("NFL live playback (real Chromium, stubbed backend)"));
  console.log(`  serving ${ROOT} at ${baseUrl}`);

  const stub = await readFile(path.join(HERE, "selftest", "supabase-stub.js"), "utf8");
  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const consoleErrors = [];
  const checks = [];
  let samples = [];

  try {
    const context = await browser.newContext(
      process.argv.includes("--mobile")
        ? { viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
        : {}
    );
    await context.route("**/esm.sh/**", (route) =>
      route.fulfill({ status: 200, body: stub, contentType: "text/javascript; charset=utf-8" })
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    // The brand mark is optional by design - index.html carries
    // onerror="this.remove()" so a missing file degrades to the wordmark. Its
    // 404 is therefore expected behaviour, not a fault. Ignored by PATH rather
    // than by status, so a 404 on anything else still fails this check.
    const OPTIONAL_ASSET = /assets\/brand\//;
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      if (/404/.test(text) && OPTIONAL_ASSET.test(m.location()?.url || "")) return;
      consoleErrors.push(text);
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    // ---- sign in ---------------------------------------------------------
    const home = page.locator("#screen-home:not(.hidden)");
    if (!(await home.isVisible().catch(() => false))) {
      await page.locator("#screen-auth:not(.hidden)").waitFor({ state: "visible", timeout: 30000 });
      await page.locator("#input-auth-identifier").fill("NflPlaybackTest");
      await page.locator("#input-auth-password").fill("nfl-playback-password");
      await page.locator("#btn-auth-submit").click();
      await home.waitFor({ state: "visible", timeout: 30000 });
    }

    // ---- football, quick play -------------------------------------------
    await page.locator('[data-sport="nfl"]').first().click();
    const mode = page.locator('#mode-toggle [data-mode="practice-easy"]');
    await mode.waitFor({ state: "visible", timeout: 15000 });
    await mode.click();
    // Football's data loads on selection, and the button says so while it
    // does. Waiting for it to become enabled is exactly what a user does.
    await page.locator("#btn-start-draft:not([disabled])").waitFor({ state: "visible", timeout: 60000 });
    await page.locator("#btn-start-draft").click();
    await page.locator("#screen-draft:not(.hidden)").waitFor({ state: "visible", timeout: 60000 });

    // ---- draft, by taking whatever is on offer ---------------------------
    const pastDraft = async () => {
      for (const sel of ["#rotation-phase", "#matchup-phase", "#tactic-phase", "#screen-game:not(.hidden)"]) {
        if (await page.locator(sel).isVisible().catch(() => false)) return true;
      }
      return false;
    };
    const draftDeadline = Date.now() + 120000;
    let picks = 0;
    while (Date.now() < draftDeadline && !(await pastDraft())) {
      const card = page.locator("#pool-list .player-card:not(.disabled)").first();
      if (!(await card.isVisible().catch(() => false))) {
        await sleep(300);
        continue;
      }
      await card.click().catch(() => {});
      const modal = page.locator("#modal-backdrop:not(.hidden)");
      if (await modal.isVisible().catch(() => false)) {
        const season = page.locator("#modal-backdrop .season-option").first();
        if (await season.isVisible().catch(() => false)) await season.click().catch(() => {});
      }
      if (await modal.isVisible().catch(() => false)) {
        await page.locator("#modal-backdrop .modal-slot-grid button").first().click().catch(() => {});
      }
      picks += 1;
      await sleep(250);
    }
    if (!(await pastDraft())) throw new Error("the NFL draft never completed");

    // ---- strategy --------------------------------------------------------
    // Football asks two questions here, not one. Both groups have to be on
    // screen and both have to be selectable, or half the gameplan is a
    // decision the player was never offered.
    let groupCardCounts = [];
    let selectedPlans = [];
    let strategyRounds = 0;
    for (const [panel, button] of [
      ["#rotation-phase", "#btn-confirm-rotation"],
      ["#matchup-phase", "#btn-confirm-matchups"],
    ]) {
      if (!(await page.locator(panel).isVisible().catch(() => false))) continue;
      await page.locator(button).click({ timeout: 10000 }).catch(() => {});
    }

    // THE GAMEPLAN IS ROUNDS NOW, NOT A SCREEN. Offence and defence became
    // separate rounds behind the same #tactic-phase panel, each advanced by
    // #btn-play-game - so a harness that clicked through once locked the
    // offence, left the defensive round on screen, and then waited sixty
    // seconds for a game that could not start. It reported the timeout rather
    // than the cause, which is the worst way for a browser test to fail.
    //
    // Driven as a loop over whatever rounds the sport declares, so this does
    // not have to be rewritten again if a third one is ever added.
    const MAX_ROUNDS = 4;
    while (
      strategyRounds < MAX_ROUNDS &&
      (await page.locator("#tactic-phase").isVisible().catch(() => false))
    ) {
      const groups = page.locator("#tactic-phase .strategy-group");
      const count = await groups.count().catch(() => 0);
      if (count > 0) {
        for (let g = 0; g < count; g++) {
          groupCardCounts.push(await groups.nth(g).locator(".tactic-card").count().catch(() => 0));
          // The SECOND card, so the run exercises a real selection rather than
          // whatever happened to be the default.
          const card = groups.nth(g).locator(".tactic-card").nth(1);
          if (await card.isVisible().catch(() => false)) {
            await card.click().catch(() => {});
            selectedPlans.push((await card.textContent().catch(() => "") || "").trim().slice(0, 40));
          }
        }
      } else {
        const option = page.locator("#tactic-phase .tactic-card").first();
        if (await option.isVisible().catch(() => false)) await option.click().catch(() => {});
      }
      strategyRounds += 1;
      await page.locator("#btn-play-game").click({ timeout: 10000 }).catch(() => {});
      await sleep(400);
    }
    await page.locator("#screen-game:not(.hidden)").waitFor({ state: "visible", timeout: 60000 });

    // ---- watch it ---------------------------------------------------------
    // Sampled densely enough that a quarter's worth of playback produces many
    // readings, so "the table filled in gradually" is a measurement rather
    // than an impression.
    const watchDeadline = Date.now() + 150000;
    while (Date.now() < watchDeadline) {
      const sample = await page.evaluate(SAMPLE);
      samples.push({ t: Date.now(), ...sample });
      if (sample.finalShown) break;
      // 220ms, not 300. Playback was shortened to ~58s, and at 300ms the
      // sample count fell far enough that a short, low-scoring game could
      // miss box-score changes and fail a threshold it actually meets. This
      // is measurement resolution, not the bar.
      await sleep(220);
    }

    const first = samples[0];
    const last = samples[samples.length - 1];
    const reachedFinal = !!last?.finalShown;

    // THE SPOILER CHECK. At the first reading the game has barely begun, so
    // nothing may be published yet: no quarter column, no score, no box score.
    const cleanStart = first && first.periods.length === 0 && first.scoreA === 0 && first.scoreB === 0;

    // Quarters appear one at a time as they END, rather than all at once.
    const periodCounts = samples.map((s) => s.periods.length);
    const monotonicPeriods = periodCounts.every((n, i) => i === 0 || n >= periodCounts[i - 1]);
    const distinctPeriodCounts = new Set(periodCounts).size;

    // The score only ever climbs, and it climbs in more than one step - a
    // scoreboard that jumped straight to the final score would pass a
    // "non-decreasing" test on its own.
    const scoreTotals = samples.map((s) => s.scoreA + s.scoreB);
    const monotonicScore = scoreTotals.every((n, i) => i === 0 || n >= scoreTotals[i - 1]);
    const scoreSteps = new Set(scoreTotals).size;

    // The box score fills in over the game rather than arriving complete.
    //
    // THE THRESHOLD IS THE WHOLE TEST. Measured against the behaviour this
    // replaced, a quarter-at-a-time reveal produces 5 distinct totals across a
    // whole game - one per quarter plus the empty opening - because each
    // quarter's entire line lands in a single write. Play-by-play produces
    // around 95. Anything above about 25 is unreachable by revealing whole
    // quarters even with overtime, so this number is what separates the two
    // designs rather than merely observing that the table changed at all.
    const boxTotals = samples.map((s) => s.boxTotal);
    // THE BOX SCORE CAN GO DOWN A LITTLE, AND SHOULD.
    //
    // This asserted the summed box score never decreases, which is only true
    // if every column is a counter. Rushing and receiving yards are SIGNED - a
    // run for a loss and a sack both take yards off a line - so a live box
    // score genuinely dips on a bad play. It held only while drives that lose
    // ground were rare, and started failing about one run in three once the
    // engine produced them at football's rate: the check was passing for the
    // wrong reason.
    //
    // What it is actually here to prove is that the table is FOLDED IN from
    // events rather than pasted in from the finished game, and boxSteps and
    // the midpoint check below are what prove that. So the guard becomes a
    // ceiling on how far it can fall in one sampling window - a few yards is a
    // tackle for loss, a large drop would be a re-render from stale state.
    const maxBoxBackstep = boxTotals.reduce(
      (worst, n, i) => (i === 0 ? worst : Math.max(worst, boxTotals[i - 1] - n)),
      0
    );
    const monotonicBox = maxBoxBackstep <= 30;
    const boxSteps = new Set(boxTotals).size;
    const boxGrew = boxTotals[boxTotals.length - 1] > 0;

    // Sharper still, and the most direct statement of the bug: WITHIN the
    // first quarter - before any quarter column has been published - the box
    // score must change repeatedly. Revealing a quarter at a time gives it
    // exactly two values in that window (empty, then the quarter's finished
    // line, written at the quarter's first snap). A ledger gives it dozens.
    const duringQ1 = samples.filter((s) => s.periods.length === 0);
    const q1BoxSteps = new Set(duringQ1.map((s) => s.boxTotal)).size;

    // Half the game must still be unwritten at the halfway point. This is the
    // assertion that would have failed loudest against the old behaviour,
    // where the quarter's totals landed at the quarter's first snap.
    const midpoint = samples[Math.floor(samples.length / 2)];
    const midwayIncomplete =
      !!midpoint && boxTotals[boxTotals.length - 1] > 0 && midpoint.boxTotal < boxTotals[boxTotals.length - 1];

    // The final banner and the scoreboard have to agree about who won.
    const finalNumbers = (last?.finalText || "").match(/(\d+)\s*-\s*(\d+)/);
    const bannerAgrees =
      !!finalNumbers &&
      Number(finalNumbers[1]) === last.scoreA &&
      Number(finalNumbers[2]) === last.scoreB;

    const elapsedMs = last && first ? last.t - first.t : 0;

    // State transitions, per #18: possession has to CHANGE, repeatedly, and be
    // readable without relying on colour.
    const possessionStates = new Set(samples.map((s) => s.possession).filter((p) => p !== "none"));
    let possessionFlips = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].possession !== samples[i - 1].possession && samples[i].possession !== "none") possessionFlips += 1;
    }
    const possessionTextSample = samples.find((s) => s.possessionText)?.possessionText || "";
    const sawPossessionText = /ball/.test(possessionTextSample);
    // The feed holds four cards, so the count is a high-water mark rather than
    // a total - it only has to prove non-scoring drives are being reported.
    const maxDriveSummaries = samples.reduce((m, s) => Math.max(m, s.driveSummaries || 0), 0);
    const sawManyDriveSummaries = maxDriveSummaries >= 2;

    checks.push(
      { title: "A football game plays to a final score in the browser", ok: reachedFinal,
        detail: reachedFinal ? `${last.finalText} after ${(elapsedMs / 1000).toFixed(1)}s` : "no final banner appeared" },
      { title: "Playback opens with nothing revealed", ok: !!cleanStart,
        detail: first ? `${first.periods.length} quarter columns, ${first.scoreA}-${first.scoreB} on the board` : "no samples" },
      { title: "Quarter columns appear as quarters end, never all at once", ok: monotonicPeriods && distinctPeriodCounts >= 3,
        detail: `${distinctPeriodCounts} distinct column counts, ending at ${last?.periods.length ?? 0}` },
      { title: "The score only climbs, and in more than one step", ok: monotonicScore && scoreSteps >= 3,
        detail: `${scoreSteps} distinct scores over ${samples.length} readings` },
      { title: "The box score fills in play by play, not quarter by quarter", ok: monotonicBox && boxSteps >= 25 && boxGrew,
        detail: `${boxSteps} distinct totals (a quarter-at-a-time reveal gives 5), ending at ${boxTotals[boxTotals.length - 1]}, worst dip ${maxBoxBackstep}` },
      { title: "The box score moves repeatedly within the first quarter", ok: q1BoxSteps >= 8,
        detail: `${q1BoxSteps} distinct totals over ${duringQ1.length} readings before Q1 was published` },
      { title: "Half the game is still unwritten at the halfway point", ok: midwayIncomplete,
        detail: midpoint ? `${midpoint.boxTotal} of ${boxTotals[boxTotals.length - 1]} at the midpoint` : "no midpoint sample" },
      { title: "The final banner agrees with the scoreboard", ok: bannerAgrees,
        detail: last ? `banner "${last.finalText}" against ${last.scoreA}-${last.scoreB}` : "no final" },
      { title: "Regulation playback lands in the readable 48-60s band", ok: elapsedMs >= 48000 && elapsedMs <= 60000,
        detail: `${(elapsedMs / 1000).toFixed(1)}s of browser wall clock` },
      { title: "Possession flips between attacking and defending, as state", ok: possessionStates.has("offense") && possessionStates.has("defense") && possessionFlips >= 4,
        detail: `${possessionFlips} changes across ${[...possessionStates].join("/")}` },
      { title: "Possession is not carried by colour alone", ok: sawPossessionText,
        detail: sawPossessionText ? `e.g. "${possessionTextSample}"` : "no possession chip text" },
      { title: "Every drive gets a summary, not just the scoring ones", ok: (last?.driveSummaries || 0) > 0 && sawManyDriveSummaries,
        detail: `${maxDriveSummaries} drive summaries seen in the feed` },
      { title: "The post-game screen offers a way out", ok: !!last?.canLeave,
        detail: last?.canLeave ? "Play Again is reachable" : "no post-game controls - the routine threw before unhiding them" },
      { title: "A football MVP is named in football statistics", ok: !!last?.mvpShown && /\d/.test(last?.mvpText || ""),
        detail: last?.mvpText || "no MVP callout" },
      { title: "Offence and defence are two separate gameplan rounds", ok: strategyRounds === 2 && selectedPlans.length === 2,
        detail: `${strategyRounds} rounds, chose: ${selectedPlans.join(" | ") || "nothing"}` },
      { title: "Each gameplan round offers three of its five plans", ok: groupCardCounts.length === 2 && groupCardCounts.every((n) => n === 3),
        detail: `cards per round: ${groupCardCounts.join(", ") || "none"}` },
      { title: "No JS errors during the game", ok: consoleErrors.length === 0,
        detail: consoleErrors.length ? consoleErrors.slice(0, 3).join(" | ") : "clean console" }
    );

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }

  const report = checks.map((c) => ({ title: c.title, status: c.ok ? PASS : FAIL, detail: c.detail }));
  for (const c of report) console.log(renderCheck(c));
  const { counts, ok } = summarize(report);
  console.log(`\n  ${samples.length} DOM samples\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
