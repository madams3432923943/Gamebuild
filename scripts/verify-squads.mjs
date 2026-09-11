#!/usr/bin/env node
// The Squads screen loads and renders, in every state it has.
//
// WHY THIS EXISTS
//
// Squads is the largest screen in the app that the game loop never touches, so
// nothing in the existing suite opens it. `npm run verify` proved the modules
// parse and the sport contracts hold; the online self-test drives matchmaking
// and a draft. Between them, four subtabs, a browse list, a roster with role
// controls, a chat poller and an invite code had no coverage at all - and the
// failure mode for a screen like this is not a crash, it is a panel that
// renders empty and looks like "no squads yet".
//
// WHAT IT DOES AND DOES NOT PROVE
//
// It stubs @supabase/supabase-js, so it proves THE SCREENS work: that the
// render functions receive what the data layer hands them, that the four tabs
// switch, that a squad-less player and a squad leader both get a sensible
// screen, and that nothing throws on the way. It says nothing about whether
// the real RPCs would accept these calls - that is RLS and migration territory,
// and the same caveat the harness stub already carries in big letters.
//
// The RPC ARGUMENT NAMES are checked though, because those are checkable from
// here and are the exact thing PostgREST resolves on: a renamed parameter reads
// as a missing function, which surfaces to a player as a button that silently
// does nothing.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.BK_SQUADS_PORT || 8941);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

function serve(port) {
  const server = createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (rel === "/" || rel.endsWith("/")) rel += "index.html";
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT)) return res.writeHead(403).end("forbidden");
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

/** The stub, as a module served in place of the CDN's supabase-js.
 *
 * Scenario-driven rather than fixed: `window.__SQUAD_SCENARIO` decides whether
 * this player is in a squad, because "squad-less" and "in a squad" are two
 * completely different screens and the interesting bugs live in the second one,
 * which no existing harness can reach. */
// The fixture lives in its own file now - scripts/shoot-growth-screens.mjs
// needs the same squad, and two copies of a roster is two rosters that can
// disagree about what a squad is.
const STUB = await readFile(path.join(ROOT, "scripts/selftest/squads-stub.js"), "utf8");

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

const server = await serve(PORT);
const browser = await chromium.launch();
console.log(renderSection("Squads screen (subtabs, browse, roster, chat renderer)"));

/** Opens the app with a scenario preloaded and lands on the Squads screen. */
async function openSquads(scenario) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  await page.route("**/esm.sh/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: STUB })
  );
  await page.addInitScript((s) => { window.__SQUAD_SCENARIO = s; }, scenario);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.locator("#nav-squads").waitFor({ state: "visible", timeout: 15000 });
  await page.locator("#nav-squads").click();
  await page.locator("#screen-squads:not(.hidden)").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(700);
  return { page, errors };
}

const text = (page, sel) => page.locator(sel).innerText().catch(() => "");
const visible = (page, sel) => page.locator(sel).isVisible().catch(() => false);

/** Clicks one of the four subtabs by its label. */
async function openTab(page, label) {
  await page.locator(`#squads-tabs button:has-text("${label}")`).first().click();
  await page.waitForTimeout(500);
}

try {
  // ---- 1. squad-less player: the browse list -------------------------------
  {
    const { page, errors } = await openSquads("none");
    const browseShown = await visible(page, "#squads-browse");
    const listText = await text(page, "#squads-list");
    check(
      "A player with no squad gets the browse list",
      browseShown && listText.includes("Hardwood Kings") && listText.includes("Bench Mob"),
      browseShown ? `list shows: ${listText.replace(/\s+/g, " ").slice(0, 90)}` : "#squads-browse stayed hidden"
    );
    check(
      "Browse rows carry a member count rather than a bare name",
      /\d+\s*\/\s*\d+/.test(listText),
      /\d+\s*\/\s*\d+/.test(listText) ? "counts present" : `no "n / cap" in: ${listText.replace(/\s+/g, " ").slice(0, 90)}`
    );

    // The browse search builds a PostgREST FILTER EXPRESSION out of whatever
    // is typed, so punctuation in the box is syntax. A comma splits the
    // expression into extra OR conditions and a paren closes the group early;
    // either way PostgREST rejects it and the browse list errors instead of
    // simply finding nothing.
    await page.evaluate(() => { window.__OR_FILTERS = []; });
    await page.locator("#input-squad-search").fill("OKC, Thunder (2012)");
    await page.waitForTimeout(700);
    const filters = await page.evaluate(() => window.__OR_FILTERS || []);
    const built = filters[filters.length - 1] || "";
    // Exactly two conditions, one per column, and no stray filter punctuation
    // carried in from the search box.
    const shape = /^name\.ilike\.%[^,().%]*%,tag\.ilike\.%[^,().%]*%$/.test(built);
    check(
      "A search containing punctuation still builds a valid filter",
      shape,
      built ? `built: ${built}` : "no filter was built for a non-empty search"
    );

    check("No errors on the squad-less screen", errors.length === 0, errors.slice(0, 3).join(" | ") || "clean");
    await page.close();
  }

  // ---- 2. squad member: header, roster, chat --------------------------------
  {
    const { page, errors } = await openSquads("member");
    const detailShown = await visible(page, "#squads-detail");
    const header = await text(page, "#squad-header");
    check(
      "A player in a squad gets the squad detail, not the browse list",
      detailShown && header.includes("Hardwood Kings"),
      detailShown ? `header: ${header.replace(/\s+/g, " ").slice(0, 100)}` : "#squads-detail stayed hidden"
    );
    // THE COUNT IS DERIVED FROM THE FIXTURE, NOT HARDCODED. It was /3\s*\/\s*20/,
    // which failed the moment the fixture grew two squadmates - a test asserting
    // the size of its own fixture rather than the behaviour it is checking,
    // which is "the header shows how full the squad is".
    const expectedCount = (STUB.match(/squad_id: SQUAD\.id/g) || []).length;
    const countShown = new RegExp(`${expectedCount}\\s*/\\s*20`).test(header);
    check(
      "The header carries tag, motto and member count",
      header.includes("HWK") && header.includes("Defence travels") && countShown,
      `tag=${header.includes("HWK")} motto=${header.includes("Defence travels")} count=${countShown} (expected ${expectedCount}/20)`
    );
    // Case-insensitive: the tier name is upper-cased by CSS and innerText
    // reports what is rendered. An earlier version of this check tested the
    // status one way and printed its detail another, so it passed while
    // announcing "no tier" - a check that argues with itself is worse than no
    // check, because the next person reads the detail and not the status.
    const tier = header.match(/community college|div 3|aau/i);
    check(
      "Squad Rep resolves to a tier rather than a bare number",
      !!tier,
      tier ? `rep 260 renders as "${tier[0]}"` : `no tier in: ${header.replace(/\s+/g, " ").slice(0, 100)}`
    );
    const invite = header.includes("4Q7ZB3");
    check("A leader sees the invite code", invite, invite ? "code rendered" : "invite code missing for a leader");

    const roster = await text(page, "#squad-roster");
    check(
      "The roster lists every member with their role",
      roster.includes("SquadTester") && roster.includes("RunAndGun") && roster.includes("PostUp"),
      roster.replace(/\s+/g, " ").slice(0, 120)
    );

    // CHAT IS TESTED THROUGH ITS RENDERER, NOT THROUGH THE SCREEN.
    //
    // The Chat tab has been taken off the Squads row for now, so there is no
    // longer a route to click. The renderer and everything behind it are
    // still in the codebase and still meant to come back, and the escaping
    // check below is a SECURITY check on code that still exists - deleting it
    // with the tab, or letting it sit skipped, would mean the day chat
    // returns it returns untested.
    //
    // renderSquadChat writes innerHTML, so escaping is the whole ballgame.
    const chat = await page.evaluate(async () => {
      const { renderSquadChat } = await import("/js/ui.js");
      const host = document.createElement("div");
      document.body.appendChild(host);
      renderSquadChat(host, [
        { user_id: "u1", username: "RunAndGun", body: "first to the gym", created_at: new Date().toISOString() },
        { user_id: "u2", username: "PostUp", body: '<img src=x onerror=alert(1)>', created_at: new Date().toISOString() },
      ], "u1");
      const out = { text: host.textContent, imgs: host.querySelectorAll("img").length };
      host.remove();
      return out;
    });
    check(
      "Chat renders the squad's messages",
      chat.text.includes("first to the gym"),
      chat.text.replace(/\s+/g, " ").slice(0, 100) || "chat pane empty"
    );
    // The hostile message must appear as TEXT, never as an element.
    check(
      "A message containing markup is escaped, not rendered",
      chat.imgs === 0 && chat.text.includes("<img"),
      chat.imgs === 0 ? "rendered as literal text" : `${chat.imgs} <img> element(s) built from a chat message`
    );

    check("No errors on the squad-member screen", errors.length === 0, errors.slice(0, 3).join(" | ") || "clean");
    await page.close();
  }

  // ---- 3. every tab on the row still opens ---------------------------------
  //
  // Driven from the ROW rather than a hardcoded list, so removing a tab (Chat,
  // for now) or adding one cannot leave this asserting about a set that no
  // longer exists. The count is reported so a tab silently vanishing is
  // visible in the output rather than passing as "all of the remaining ones".
  {
    const { page, errors } = await openSquads("member");
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll("#squads-tabs .subtab")].map((b) => b.textContent.trim())
    );
    for (const tab of labels) {
      await openTab(page, tab);
      const onScreen = await visible(page, "#screen-squads");
      if (!onScreen) { check(`The ${tab} tab opens`, false, "squads screen disappeared"); break; }
    }
    check(
      `All ${labels.length} subtabs open without throwing`,
      labels.length > 0 && errors.length === 0,
      labels.length ? `${labels.join(", ")}${errors.length ? " | " + errors.slice(0, 3).join(" | ") : ""}` : "no subtabs rendered"
    );

    // ---- 4. the RPC names the client actually sends -------------------------
    // PostgREST resolves an RPC by its exact argument names, so this is the
    // shape that decides whether a button works at all.
    const calls = await page.evaluate(() => window.__RPC_CALLS || []);
    const invite = calls.find((c) => c.name === "get_squad_invite_code");
    check(
      "The invite-code RPC is called by name with no arguments",
      !!invite && invite.args.length === 0,
      invite ? `get_squad_invite_code(${invite.args.join(", ")})` : "never called"
    );
    await page.close();
  }

  // ---- 5. it holds on a phone ----------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
    await page.route("**/esm.sh/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: STUB })
    );
    await page.addInitScript(() => { window.__SQUAD_SCENARIO = "member"; });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
    await page.locator("#nav-squads").waitFor({ state: "visible", timeout: 15000 });
    await page.locator("#nav-squads").click();
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
    check("The squads screen does not scroll sideways at 360px", overflow === 0, `${overflow}px of horizontal overflow`);
    await page.close();
  }
  // ---- 6. the roster sorts, and win rate is honest -------------------------
  //
  // The comparators are pure and live in js/squads.js, so they are checked
  // directly rather than by clicking chips and reading rows - a browser is the
  // wrong instrument for "does 1-0 outrank 40-10", and that is the question
  // that matters.
  //
  // WIN RATE IS THE ONE THAT GOES WRONG. Sorted naively, one game won is a
  // 100% win rate above a squadmate who is 40-10. That is not a leaderboard,
  // and it is the shape of bug that ships because the list looks sorted.
  {
    const { ROSTER_SORTS, DEFAULT_ROSTER_SORT, rosterSortById, sortRoster, winRateOf } = await import(
      path.join(ROOT, "js/squads.js")
    );

    const ROSTER = [
      { username: "Zed", joinedAt: "2026-01-01", onlineWins: 1, onlineLosses: 0, rating: { rating: 520, games: 1 } },
      { username: "Ann", joinedAt: "2026-02-01", onlineWins: 40, onlineLosses: 10, rating: { rating: 700, games: 50 } },
      { username: "bob", joinedAt: "2026-03-01", onlineWins: 0, onlineLosses: 0, rating: null },
      { username: "Cara", joinedAt: "2026-04-01", onlineWins: 3, onlineLosses: 7, rating: { rating: 430, games: 10 } },
    ];
    const order = (id) => sortRoster(ROSTER, id).map((m) => m.username).join(" > ");

    check(
      "Every sort the UI offers has a comparator",
      ROSTER_SORTS.length >= 3 && ROSTER_SORTS.every((s) => s.id && s.label && typeof s.compare === "function"),
      ROSTER_SORTS.map((s) => s.id).join(", ")
    );

    check(
      "An unknown stored sort falls back to the default",
      rosterSortById("no-such-sort").id === DEFAULT_ROSTER_SORT && rosterSortById(null).id === DEFAULT_ROSTER_SORT,
      `both resolve to "${DEFAULT_ROSTER_SORT}" - a removed sort cannot strand anyone on a blank roster`
    );

    check("Rating sorts high to low", order("rating") === "Ann > Zed > Cara > bob", order("rating"));
    check("Wins sorts high to low", order("wins") === "Ann > Cara > Zed > bob", order("wins"));
    check("Games sorts high to low", order("games") === "Ann > Cara > Zed > bob", order("games"));
    check(
      "Name sorts case-insensitively",
      order("name") === "Ann > bob > Cara > Zed",
      `${order("name")} - a lowercase username must not sort after Z`
    );
    check("Joined keeps the order this screen always had", order("joined") === "Zed > Ann > bob > Cara", order("joined"));

    // THE ONE THAT MATTERS: Zed is 1-0, a perfect record, and must sit BELOW
    // Cara's 3-7 because one game is not a win rate.
    check(
      "A 100% record over one game does not outrank a real one",
      order("winrate") === "Ann > Cara > Zed > bob",
      `${order("winrate")} - Zed is 1-0 and belongs under Cara at 3-7`
    );

    check(
      "A member with no games has no win rate",
      winRateOf({ onlineWins: 0, onlineLosses: 0 }) === null,
      "null, not 0 - never played and lost everything are different facts"
    );

    // A roster that reorders itself between renders looks like it is
    // flickering, and identical records are the case that causes it.
    const tied = [
      { username: "Bea", onlineWins: 5, onlineLosses: 5, rating: { rating: 500, games: 10 } },
      { username: "Abe", onlineWins: 5, onlineLosses: 5, rating: { rating: 500, games: 10 } },
    ];
    const once = sortRoster(tied, "rating").map((m) => m.username).join(",");
    const twice = sortRoster(sortRoster(tied, "rating"), "rating").map((m) => m.username).join(",");
    check(
      "Identical records sort stably",
      once === twice && once === "Abe,Bea",
      `${once} then ${twice} - every order falls back to username`
    );

    // sortRoster must not reorder the caller's array: it is the cached roster
    // the whole screen re-renders from.
    const source = [...ROSTER];
    sortRoster(source, "wins");
    check(
      "Sorting does not mutate the roster it was given",
      source.map((m) => m.username).join(",") === ROSTER.map((m) => m.username).join(","),
      "the screen re-renders from this array; reordering it under the caller would make the sort sticky"
    );

    // The figure shown per row has to exist for the sorts that need one, or the
    // reader is asked to trust an order they cannot see.
    check(
      "The roster reads sport_ratings, so there is a rating to sort by",
      (await readFile(path.join(ROOT, "js/squads.js"), "utf8")).includes("equipped_icon, sport_ratings"),
      "loadSquadRoster selects it on the query that was already running"
    );
  }
} catch (e) {
  check("the harness ran", false, e.message);
}

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);

await browser.close();
server.close();
process.exit(ok ? 0 : 1);
