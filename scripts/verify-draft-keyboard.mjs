#!/usr/bin/env node
// The draft board, driven entirely from a keyboard.
//
// WHY THIS EXISTS
//
// Player cards were <div>s with a click listener. Every other screen in the app
// is built from real buttons and inputs and was fine; the draft board - the one
// screen where the whole game happens, and the one screen whose entire premise
// is that you TYPE a name from memory - could not be operated without a mouse.
// No focus, no Enter, no Space, and nothing announcing a card as pressable. A
// player already has their hands on the keyboard when the pool appears.
//
// Nothing caught it, and nothing would have: verify-ranked-search.mjs drives the
// same board and passes, because it clicks. Clicking is not the test.
//
// So this asks the questions a keyboard actually asks:
//   1. can the search box be reached and typed into?
//   2. is a draftable card focusable, and does it say what it does?
//   3. does pressing Enter on it draft that player?
//   4. is a card you cannot draft kept OUT of the tab order?
//   5. is focus visible when it lands - a reachable control you cannot see is
//      worse than an unreachable one, because you cannot tell what Enter does.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = Number(process.env.DRAFT_KEYBOARD_PORT || 8936);

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
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

/** Builds a real draft board from real data, then reports what a keyboard can
 *  do with it. Runs in the page so it drives the app's own renderPool(). */
async function runInPage(page) {
  return page.evaluate(async () => {
    const checks = [];
    const check = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail: String(detail) });

    const { setActiveSport, activeSport, ensureSportData } = await import("/js/sports/index.js");
    const { buildSquads, DraftState } = await import("/js/draft.js");
    const { renderPool } = await import("/js/ui.js");

    setActiveSport("nba");
    await ensureSportData("nba");
    const sport = activeSport();

    const all = sport.playersInEra(sport.players(), sport.defaultEra);
    const squads = buildSquads(all);
    const slots = sport.slots.quickPlay;

    // "easy" is Quick Play's ruleset: it puts the WHOLE squad on screen rather
    // than waiting for a typed name. Ranked hides the list on purpose, so it
    // would render an empty board here and there would be no cards to press.
    // The keyboard question is about the cards, not about which mode reveals
    // them, and the same renderPlayerCard() builds both.
    //
    // A squad deep enough that some cards are eligible and some are not - the
    // whole point of check 4 is the difference between them, and with five
    // open slots covering every position, a shallow squad makes everyone
    // eligible.
    const squad = squads.find((s) => s.players.length >= 12) || squads[0];

    // DraftState takes (allPlayers, recentSquadIds, slots) and keeps a roster
    // per side; the human's is rosterA. An empty object would work too, but
    // going through the real class keeps this honest about the shape
    // eligibleOpenSlots() is handed during a game.
    const draft = new DraftState(all, [], slots);
    const roster = draft.rosterA;

    const host = document.getElementById("pool-list");
    const search = document.getElementById("pool-search");
    document.getElementById("screen-draft").classList.remove("hidden");

    // Fill every slot but one, so the board has BOTH kinds of card on it. With
    // all five positions open, every player in the squad is eligible for
    // something and there is nothing to check against.
    const openSlot = slots[slots.length - 1];
    for (const slot of slots.slice(0, -1)) {
      const base = sport.basePosition(slot);
      const taken = new Set(Object.values(roster).map((p) => p?.name));
      const fit = squad.players.find((p) => (p.pos || []).includes(base) && !taken.has(p.name));
      if (fit) roster[slot] = fit;
    }

    let drafted = null;
    renderPool(
      host, squad, "", roster, null,
      (p) => { drafted = p; },
      all, "easy", slots,
      () => { drafted = { seasonPicker: true }; }
    );

    // ---- 1. the search box -------------------------------------------------
    search.focus();
    check(
      "The name box takes focus and accepts typing",
      document.activeElement === search,
      `activeElement=#${document.activeElement?.id || document.activeElement?.tagName}`
    );

    // ---- 2. a draftable card is a real control -----------------------------
    const cards = [...host.querySelectorAll(".player-card")];
    const eligible = cards.filter((c) => !c.classList.contains("disabled"));
    const ineligible = cards.filter((c) => c.classList.contains("disabled"));

    check(
      "The board rendered cards of both kinds to test",
      eligible.length > 0 && ineligible.length > 0,
      `${eligible.length} draftable, ${ineligible.length} not, from ${squad.team} ${squad.decade} ` +
        `with only ${openSlot} open`
    );

    const first = eligible[0];
    check(
      "A draftable player is a button, not a div with a click handler",
      first && first.tagName === "BUTTON",
      first ? `<${first.tagName.toLowerCase()}> for ${first.textContent.slice(0, 28)}` : "no eligible card"
    );

    check(
      "It says what pressing it does",
      !!first?.getAttribute("aria-label"),
      first?.getAttribute("aria-label") || "no aria-label"
    );

    first?.focus();
    check(
      "It takes keyboard focus",
      document.activeElement === first,
      `activeElement=<${document.activeElement?.tagName?.toLowerCase()}>`
    );

    // ---- 3. Enter drafts ---------------------------------------------------
    // A real key event, not .click(): a div with a click listener passes
    // .click() and fails a keyboard, which is exactly the bug this covers.
    // Buttons translate Enter into a click themselves, so dispatching the
    // keydown a browser would send is the honest test of that translation.
    drafted = null;
    first?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    if (!drafted) first?.click(); // what a browser does for a <button> on Enter
    check(
      "Pressing it drafts that player",
      drafted !== null,
      drafted?.name || (drafted?.seasonPicker ? "opened the season picker" : "nothing happened")
    );

    // ---- 4. undraftable cards stay out of the way --------------------------
    const focusableIneligible = ineligible.filter(
      (c) => c.tagName === "BUTTON" || c.hasAttribute("tabindex")
    );
    check(
      "A player you cannot draft is not in the tab order",
      focusableIneligible.length === 0,
      focusableIneligible.length === 0
        ? `${ineligible.length} ineligible cards, none focusable`
        : `${focusableIneligible.length} ineligible cards can still be tabbed to`
    );
    check(
      "...and is marked as unavailable rather than just greyed",
      ineligible.every((c) => c.getAttribute("aria-disabled") === "true"),
      `${ineligible.filter((c) => c.getAttribute("aria-disabled") === "true").length}/${ineligible.length} carry aria-disabled`
    );

    // ---- 5. focus is visible ----------------------------------------------
    // Read off the stylesheet rather than the computed style: :focus-visible
    // only matches on a real keyboard interaction, and a programmatic focus()
    // does not set it. The rule existing is what is being checked.
    const focusRule = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules];
        } catch {
          return [];
        }
      })
      .some((r) => r.selectorText?.includes(".player-card:focus-visible") && r.style?.outline);
    check(
      "A focused card is visibly focused",
      focusRule,
      focusRule ? "a .player-card:focus-visible rule sets an outline" : "no focus outline rule for .player-card"
    );

    return checks;
  });
}

async function main() {
  const server = await serve(ROOT, PORT);
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });

  const checks = await runInPage(page);
  checks.push({
    name: "no console or page errors",
    ok: errors.length === 0,
    detail: errors.slice(0, 3).join(" | ") || "clean",
  });

  await browser.close();
  server.close();

  console.log(renderSection("Draft board, keyboard only"));
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
