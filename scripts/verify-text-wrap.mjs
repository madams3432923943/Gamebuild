#!/usr/bin/env node
// NOTHING BREAKS A WORD IN HALF ON A PHONE. `npm run verify:text-wrap`.
//
// WHY THIS EXISTS
//
// The settings sheet published three email addresses, and on an iPhone
// `business@draftnovagame.com` wrapped after "draftnovaga" so the next line
// read "me.com". An address split mid-token is not merely ugly: you cannot
// tell whether the break is a hyphen, and you cannot select it. The same bug
// was one grid track away in Recent Games, where a 20-character username -
// the maximum the app allows - broke in half on every iPhone width.
//
// Both were caused by the same reflex: reaching for `overflow-wrap: anywhere`
// to stop a long token overflowing the page. It does stop the overflow. It
// pays for it by breaking the word, which for a name or an address is the
// information itself.
//
// The layout audit in verify-browser cannot see this. A broken word overflows
// nothing, overlaps nothing and scrolls nothing - every geometric check passes
// while the screen reads as broken.
//
// HOW IT WORKS
//
// A word that wraps renders as more than one client rect. Wrapping each
// whitespace-delimited token in a Range and counting its rects is exact - no
// font metrics, no guessing which strings "look long". Elements that cannot
// wrap at all (nowrap/pre) are skipped: clipped text still reports two rects,
// and a correctly-truncated ellipsis is the fix, not the fault.
//
// WHAT IT DOES NOT COVER: only text present on the screens it walks, with the
// fixture profile it signs in as. A string that only appears mid-draft or
// after a game is not measured here.

import { readFile } from "node:fs/promises";
import { renderCheck, renderSection, summarize, check, PASS, FAIL } from "./lib/report.mjs";
import { chromium } from "playwright";
import { serveStatic } from "./selftest/static-server.mjs";
import { signIn, sleep } from "./lib/app-driver.mjs";

// The worst case the app can actually produce: a 20-character username (the
// maxlength on both username inputs) of the widest character there is. A
// fixture narrower than the cap would let a real regression through.
const WORST_NAME = "W".repeat(20);
const RICH = {
  username: "MaxwellTheGreat",
  online_wins: 41, online_losses: 27, offline_wins: 63, offline_losses: 22,
  equipped_banner: "purple-wind",
  sport_ratings: { nba: { rating: 761, wins: 24, losses: 14, games: 38 },
                   nfl: { rating: 688, wins: 17, losses: 13, games: 30 } },
  featured_badges: [], draft_counts: { [WORST_NAME]: 9 },
  personal_bests: { pts: { value: 61, playerName: WORST_NAME, season: "2005-06", date: new Date().toISOString() } },
  career_totals: {}, team_banners: {}, granted_banners: ["purple-wind"],
  era_records: { all: { online_wins: 12, online_losses: 8, offline_wins: 20, offline_losses: 6 } },
  highest_scoring_game: null, largest_margin_game: null,
  triple_double_counts: {}, mvp_counts: {},
  history: [{ date: new Date().toISOString(), mode: "online", sport: "nba", won: true,
              opponentLabel: WORST_NAME, scoreFor: 118, scoreAgainst: 104, mvpName: WORST_NAME }],
  created_at: new Date().toISOString(),
};
const WIDTHS = [["iphone-se-375", 375, 667], ["iphone-390", 390, 844], ["android-360", 360, 800]];
const SCREENS = [
  ["home", null], ["play", '.sport-card[data-sport="nba"] .sport-card-open'],
  ["profile", "#nav-profile"],
  ["profile-nfl", "#nav-profile|#profile-stats-sport-tabs .subtab:nth-child(2)"],
  ["rewards", "#nav-badges"], ["squads", "#nav-squads"],
  ["settings", "#btn-settings"],
  ["locker", '#btn-customize-profile|.modal .subtabs:nth-of-type(2) .subtab:nth-child(1)'],
];

const PROBE = `(() => {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || !el.offsetParent) continue;
    if (el.closest(".hidden, [hidden]")) continue;
    // Text that CANNOT wrap cannot break mid-word. Clipped nowrap text still
    // reports more than one client rect, so without this the probe flags
    // every correctly-truncated ellipsis as a wrap - which it did.
    const ws = getComputedStyle(el).whiteSpace;
    if (ws === "nowrap" || ws === "pre") continue;
    nodes.push(n);
  }
  for (const n of nodes) {
    const text = n.nodeValue;
    // Only tokens long enough that a mid-word break is visible and wrong.
    const tokens = text.split(/\\s+/).filter((t) => t.length >= 8);
    if (!tokens.length) continue;
    for (const tok of tokens) {
      const i = text.indexOf(tok);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + tok.length);
      const rects = r.getClientRects();
      if (rects.length > 1) {
        const el = n.parentElement;
        out.push({
          token: tok,
          lines: rects.length,
          el: el.tagName.toLowerCase() +
              (el.id ? "#" + el.id : "") +
              (el.className && typeof el.className === "string"
                 ? "." + el.className.trim().split(/\\s+/).slice(0,2).join(".") : ""),
        });
      }
    }
  }
  // De-duplicate: the same token in the same element type is one finding.
  const seen = new Set();
  return out.filter((f) => { const k = f.el + "|" + f.token; if (seen.has(k)) return false; seen.add(k); return true; });
})()`;

console.log(renderSection("Text must not break mid-word at phone widths"));
const server = await serveStatic(process.cwd(), 8991);
let stub = await readFile("scripts/selftest/supabase-stub.js", "utf8");
stub = stub.replace(/const PROFILE = \{[\s\S]*?\n\};/,
  "const PROFILE = Object.assign({ id: USER.id }, " + JSON.stringify(RICH) + ");");
const browser = await chromium.launch();
const checks = [];

for (const [name, clicks] of SCREENS) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route("**/esm.sh/**", (r) => r.fulfill({ body: stub, contentType: "text/javascript; charset=utf-8" }));
  await page.goto("http://127.0.0.1:8991/", { waitUntil: "domcontentloaded" });
  await signIn(page, { username: "MaxwellTheGreat", password: "pw" }, () => {});
  await sleep(400);
  for (const step of (clicks || "").split("|").filter(Boolean)) {
    await page.locator(step).first().click(); await sleep(700);
  }
  for (const [label, w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await sleep(200);
    const found = await page.evaluate(PROBE);
    const c = check(
      `text-wrap:${name}:${label}`,
      found.length
        ? `${name} at ${label}: ${found.length} word(s) broken in half`
        : `${name} holds at ${label}`,
      found.length ? FAIL : PASS,
      { detail: found.map((f) => `"${f.token}" over ${f.lines} lines in ${f.el}`).join(" | ") || "no mid-word breaks" }
    );
    checks.push(c);
    if (found.length) console.log(renderCheck(c));
  }
  await ctx.close();
}
await browser.close();
server.close();
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
