#!/usr/bin/env node
// Ranked draft-board rendering, driven in a real browser.
//
// WHY THIS EXISTS
//
// Ranked Practice search went blank for every player. The search helper was
// never at fault: resolveTypedInput() resolved "jok" to Nikola Jokic exactly
// as it should, and a unit test that stopped there passed all the way through
// the outage. The break was one line further on, in renderPool()'s in-squad
// branch, which read a `pos` it had never bound and threw a ReferenceError
// after the container had already been emptied - so the board showed nothing,
// with a pick timer still running.
//
// A helper test cannot catch that. Only rendering can. This drives the real
// renderPool() against real production NBA data in real Chromium, then clicks
// the cards it produced, opens the season picker, and drafts through it - the
// whole path a player's hands actually take.
//
// verify-playable.mjs plays a full game but calls groupBySeason() directly and
// never renders; the two are complementary and both are needed.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

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
      if (!file.startsWith(root)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      // Read BEFORE writing headers. The other way round, a request for a file
      // that does not exist sends 200, then throws, then tries to send 404 on
      // top of it - ERR_HTTP_HEADERS_SENT, which kills the whole harness
      // rather than returning a 404. A single optional asset in index.html was
      // enough to take the run down.
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
 * Everything below runs INSIDE the page, against the app's own modules. It is
 * one function rather than a dozen round-trips so a single evaluate() covers
 * the whole flow and the dataset is parsed once - it is 2,542 rows.
 *
 * Returns a flat list of {name, ok, detail} so the Node side stays a reporter
 * and every assertion reads the same way in the output.
 */
async function runInPage(page) {
  return page.evaluate(async () => {
    const checks = [];
    const check = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail: String(detail) });
    // One broken assertion must not take the rest of the run down with it -
    // when the board is blank, the very next line is a click on a card that
    // is not there, and losing the remaining checks hides how far the damage
    // actually spreads.
    const section = (label, fn) => {
      try {
        fn();
      } catch (e) {
        check(label, false, `threw: ${e.message}`);
      }
    };

    const { setActiveSport, activeSport, ensureSportData } = await import("/js/sports/index.js");
    const { buildSquads, resolveTypedInput, eligibleOpenSlots, DraftState } = await import("/js/draft.js");
    const { renderPool, groupBySeason, POOL_RENDER_ERROR_MESSAGE } = await import("/js/ui.js");

    setActiveSport("nba");
    // Basketball's dataset loads on demand now, the same as football's, so the
    // pool has to be asked for before it can be read. The app does this in
    // selectSport(); a harness that jumps straight to the draft has to do it
    // itself.
    await ensureSportData("nba");
    const sport = activeSport();
    const allPlayers = sport.players();
    const rankedSlots = sport.slots.ranked;

    const pool = document.getElementById("pool");
    const cardsIn = (el) => [...el.querySelectorAll(".player-card")];
    const strip = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const cardFor = (el, name) => cardsIn(el).find((c) => strip(c.textContent).includes(strip(name)));

    const squads = buildSquads(allPlayers);
    // Data-driven rather than hardcoded to a team: find a squad that actually
    // holds this player, so a dataset rebuild moving him cannot fail the test
    // for the wrong reason.
    const squadWith = (name) =>
      squads.find((s) => s.players.some((p) => strip(p.name) === strip(name)));

    // ---- 1-6: the four named searches render selectable cards -------------
    // Unaccented input against accented stored names is the point of "jok"
    // and "doncic"; "leb" and "dur" cover the plain-ASCII path.
    for (const [query, expected] of [
      ["jok", "Nikola Jokic"],
      ["doncic", "Luka Doncic"],
      ["leb", "LeBron James"],
      ["dur", "Kevin Durant"],
    ]) {
      const squad = squadWith(expected);
      if (!squad) {
        check(`search "${query}" -> ${expected}`, false, "no squad in the dataset holds this player");
        continue;
      }

      const resolved = resolveTypedInput(query, squad, allPlayers);
      const result = renderPool(pool, squad, query, {}, null, () => {}, allPlayers, "strict", rankedSlots, () => {});

      const rendered = cardFor(pool, expected);
      check(
        `ranked search "${query}" renders a ${expected} card`,
        result.ok && resolved.tier === "in-squad" && !!rendered,
        rendered
          ? `${squad.team} ${squad.decade}, ${cardsIn(pool).length} card(s)`
          : `tier=${resolved.tier} renderOk=${result.ok} html=${pool.innerHTML.slice(0, 160)}`
      );

      // "Selectable" is a real assertion, not a synonym for present: a
      // disabled card is in the DOM and cannot be drafted.
      if (rendered) {
        check(
          `"${query}" card is selectable (not disabled)`,
          !rendered.classList.contains("disabled"),
          rendered.className
        );
      }
    }

    // ---- 7: an eligible card is clickable and fires the pick callback -----
    section("clicking a multi-season card opens the season picker", () => {
      const squad = squadWith("Nikola Jokic");
      let picked = null;
      let seasonPickerOpenedWith = null;
      renderPool(
        pool, squad, "jok", {}, null,
        (p) => (picked = p),
        allPlayers, "strict", rankedSlots,
        (p, seasons) => (seasonPickerOpenedWith = { player: p, seasons })
      );
      const card = cardFor(pool, "Nikola Jokic");
      card.click();
      // Jokic has many Denver seasons, so a click must open the picker rather
      // than draft a year the player never chose.
      check(
        "clicking a multi-season card opens the season picker",
        !!seasonPickerOpenedWith && picked === null,
        seasonPickerOpenedWith
          ? `${seasonPickerOpenedWith.seasons.length} seasons offered`
          : `picked=${picked && picked.name}`
      );

      // ---- 8-9: choosing a season produces a LEGAL pick ------------------
      if (seasonPickerOpenedWith) {
        const chosen = seasonPickerOpenedWith.seasons[0];
        const draft = new DraftState(allPlayers, [], rankedSlots);
        draft.currentSquad = squad;
        // Eligibility across every season on this squad, which is what the
        // card offered and what makePick validates - judging the one picked
        // row can name a slot the draft then refuses.
        const unionPos = [...new Set(
          squad.players.filter((p) => p.name === chosen.name).flatMap((p) => p.pos || [])
        )];
        const slots = eligibleOpenSlots({ ...chosen, pos: unionPos }, draft.rosterA, rankedSlots);
        // makePick throws on an illegal pick rather than returning false, so
        // "it did not throw" is the assertion.
        let error = null;
        try {
          draft.makePick("A", chosen, slots[0]);
        } catch (e) {
          error = e.message;
        }
        check(
          "selecting a season produces a legal draft pick",
          !error && slots.length > 0 && draft.rosterA[slots[0]] === chosen,
          error || `${chosen.name} ${chosen.season} -> ${slots[0]}`
        );
      }
    });

    // ---- 10: search still works on the next round, after a completed pick -
    section("search works on the round after a completed pick", () => {
      const draft = new DraftState(allPlayers, [], rankedSlots);
      const first = draft.rollNextSquad();
      const firstCards = groupBySeason(first.players);
      let placed = false;
      for (const { lead, pos } of firstCards) {
        const slots = eligibleOpenSlots({ ...lead, pos }, draft.rosterA, rankedSlots);
        if (!slots.length) continue;
        try {
          draft.makePick("A", lead, slots[0]);
          placed = true;
          break;
        } catch {
          // This card could not fill an open slot; try the next one, exactly
          // as a player scanning the board would.
        }
      }
      // Round two is a KNOWN squad searched for a KNOWN player, not whatever
      // rollNextSquad() happened to land on. Driving this off the random roll
      // made the check fail about one run in three - a three-letter prefix of
      // an arbitrary player is not guaranteed to resolve in-squad, and a
      // verify that fails at random teaches people to re-run it until green.
      const next = squadWith("LeBron James");
      draft.currentSquad = next;
      const result = renderPool(pool, next, "leb", draft.rosterA, null, () => {}, allPlayers, "strict", rankedSlots, () => {});
      const rendered = cardFor(pool, "LeBron James");
      check(
        "search works on the round after a completed pick",
        placed && result.ok && !!rendered,
        `picked=${placed} round2=${next.team} ${next.decade} cards=${cardsIn(pool).length}`
      );
    });

    // ---- 11: Quick Play (easy ruleset) list behaviour is unchanged --------
    section("Quick Play shows the whole squad with stats and still filters", () => {
      const squad = squadWith("Nikola Jokic");
      const full = renderPool(pool, squad, "", {}, null, () => {}, allPlayers, "easy", sport.slots.quickPlay, () => {});
      const fullCount = cardsIn(pool).length;
      const withStats = cardsIn(pool).every((c) => c.classList.contains("with-stats"));

      renderPool(pool, squad, "jok", {}, null, () => {}, allPlayers, "easy", sport.slots.quickPlay, () => {});
      const filtered = cardsIn(pool).length;

      check(
        "Quick Play shows the whole squad with stats and still filters",
        full.ok && fullCount > 0 && withStats && filtered > 0 && filtered < fullCount,
        `unfiltered=${fullCount} withStats=${withStats} filtered=${filtered}`
      );
    });

    // ---- 11b: all three modes render, named as the modes they are ---------
    // The three player-facing modes are two branches of one component: Quick
    // Play takes the easy branch, Ranked Practice and Online Ranked both take
    // the strict one with the same arguments. Asserting them by NAME is worth
    // the near-duplicate calls - the bug that took ranked out left Quick Play
    // working, and a failure reported per mode says which players are stuck
    // instead of which branch is.
    section("every mode renders through the shared pool component", () => {
      const squad = squadWith("Nikola Jokic");
      const renderAs = (ruleset, slots) => {
        const result = renderPool(pool, squad, "jok", {}, null, () => {}, allPlayers, ruleset, slots, () => {});
        return result.ok && !!cardFor(pool, "Nikola Jokic");
      };
      const modes = [
        ["Quick Play", renderAs("easy", sport.slots.quickPlay)],
        ["Ranked Practice", renderAs("strict", rankedSlots)],
        ["Online Ranked", renderAs("strict", rankedSlots)],
      ];
      check(
        "every mode renders through the shared pool component",
        modes.every(([, ok]) => ok),
        modes.map(([name, ok]) => `${name}=${ok ? "ok" : "BLANK"}`).join(" ")
      );
    });

    // ---- 12: a render failure is visible, never a silent blank pool -------
    section("a render failure shows a visible message and reports failure", () => {
      // Force a throw from inside the card renderer by handing the sport a
      // cardStatLine that explodes - the same shape of failure the real bug
      // had, without reintroducing the real bug.
      const original = Object.getOwnPropertyDescriptor(sport, "cardStatLine");
      Object.defineProperty(sport, "cardStatLine", {
        configurable: true,
        get() {
          throw new Error("synthetic render failure");
        },
      });
      let result;
      try {
        result = renderPool(pool, squadWith("Nikola Jokic"), "", {}, null, () => {}, allPlayers, "easy", sport.slots.quickPlay, () => {});
      } finally {
        if (original) Object.defineProperty(sport, "cardStatLine", original);
        else delete sport.cardStatLine;
      }
      const note = pool.querySelector(".pool-error-note");
      check(
        "a render failure shows a visible message and reports failure",
        result && result.ok === false && !!result.error && !!note && note.textContent === POOL_RENDER_ERROR_MESSAGE,
        note ? note.textContent : `no error note; html=${pool.innerHTML.slice(0, 160)}`
      );
      check(
        "the failure message leaks no internals",
        !!note && !/renderPool|ReferenceError|cardStatLine|\bat \b/.test(note.textContent),
        note ? note.textContent : "(no note)"
      );
    });

    return checks;
  });
}

async function main() {
  const port = Number(process.env.BK_RANKED_SEARCH_PORT || 8934);
  const server = await serve(ROOT, port);
  console.log(renderSection("Ranked draft-board rendering (real Chromium, real NBA data)"));

  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const page = await browser.newPage();

  // Any uncaught page error is a failure in its own right: "no console errors
  // during normal gameplay" is part of what this is asserting.
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text());
  });

  let checks = [];
  try {
    await page.goto(`http://127.0.0.1:${port}/scripts/selftest/ranked-search-harness.html`);
    checks = await runInPage(page);
  } catch (e) {
    checks.push({ name: "harness ran", ok: false, detail: e.message });
  }

  // The synthetic-failure check deliberately logs one console error, and that
  // log IS the behaviour under test. Anything else is real.
  const unexpected = pageErrors.filter((m) => !m.includes("Draft pool render failed"));
  checks.push({
    name: "no unexpected console or page errors",
    ok: unexpected.length === 0,
    detail: unexpected.slice(0, 3).join(" | ") || "clean",
  });

  await browser.close();
  server.close();

  const report = checks.map((c) => ({ title: c.name, status: c.ok ? PASS : FAIL, detail: c.detail }));
  for (const c of report) console.log(renderCheck(c));
  const { counts, ok } = summarize(report);
  console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
