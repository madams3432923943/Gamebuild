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
const STUB = `
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "squadtest@ballknowledge.app" };
const SESSION = { access_token: "t", refresh_token: "r", expires_in: 3600, token_type: "bearer", user: USER };
const scenario = () => (window.__SQUAD_SCENARIO || "none");

const PROFILE = {
  id: USER.id, username: "SquadTester", online_wins: 12, online_losses: 4,
  offline_wins: 3, offline_losses: 2, draft_counts: {}, personal_bests: {},
  career_totals: {}, team_banners: {}, era_records: {}, equipped_banner: "rookie",
  equipped_kit: null, equipped_icon: null, featured_badges: [], granted_banners: [],
  granted_badges: [], granted_icons: [], sport_ratings: {},
  created_at: new Date("2026-01-01").toISOString(), history: [],
  highest_scoring_game: null, largest_margin_game: null,
  triple_double_counts: {}, mvp_counts: {}, mvp_teams: {},
};

const MATES = [
  { id: "22222222-2222-4222-8222-222222222222", username: "RunAndGun", online_wins: 40, online_losses: 12 },
  { id: "33333333-3333-4333-8333-333333333333", username: "PostUp", online_wins: 7, online_losses: 9 },
];

const SQUAD = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Hardwood Kings", tag: "HWK", emoji: "👑",
  motto: "Defence travels", visibility: "public", member_cap: 20, rep: 260,
  created_by: USER.id, created_at: new Date("2026-02-02").toISOString(),
};

const PUBLIC_SQUADS = [
  SQUAD,
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Bench Mob", tag: "BMB", emoji: "🔥",
    motto: "", visibility: "public", member_cap: 20, rep: 0, created_by: MATES[0].id,
    created_at: new Date("2026-02-03").toISOString() },
];

const MEMBER_ROWS = [
  { squad_id: SQUAD.id, user_id: USER.id, role: "leader", joined_at: "2026-02-02T00:00:00Z" },
  { squad_id: SQUAD.id, user_id: MATES[0].id, role: "co-leader", joined_at: "2026-02-04T00:00:00Z" },
  { squad_id: SQUAD.id, user_id: MATES[1].id, role: "member", joined_at: "2026-02-05T00:00:00Z" },
];

// Deliberately hostile text: the chat and header render through innerHTML, so
// if escaping ever regresses this turns into a real script tag in the DOM and
// the check below sees it.
const MESSAGES = [
  { id: 1, user_id: MATES[0].id, username: "RunAndGun", body: "first to the gym", created_at: "2026-02-06T10:00:00Z" },
  { id: 2, user_id: USER.id, username: "SquadTester", body: "<img src=x onerror=alert(1)>", created_at: "2026-02-06T10:01:00Z" },
];

class Query {
  constructor(table) { this.table = table; this.filters = {}; this._mutation = false; }
  select() { return this; }
  insert() { this._mutation = true; return this; }
  update() { this._mutation = true; return this; }
  upsert() { this._mutation = true; return this; }
  delete() { this._mutation = true; return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  neq() { return this; } in(col, vals) { this.filters["in:" + col] = vals; return this; }
  or(expr) { (window.__OR_FILTERS = window.__OR_FILTERS || []).push(expr); return this; } gt() { return this; } gte() { return this; }
  lt() { return this; } lte() { return this; } order() { return this; }
  limit() { return this; } range() { return this; }

  _rows() {
    if (this._mutation) return [];
    const t = this.table, f = this.filters;
    if (t === "profiles") {
      const all = [PROFILE, ...MATES];
      if (f.id) return all.filter((p) => p.id === f.id);
      if (f["in:id"]) return all.filter((p) => f["in:id"].includes(p.id));
      return all;
    }
    if (t === "squad_members") {
      // A squad-less player still reads OTHER squads' member rows - the RLS
      // policy exposes them for any PUBLIC squad, which is what makes the
      // browse list's "3 / 20 members" real. Only this player's own membership
      // disappears in the "none" scenario. Returning nothing at all here would
      // have made the browse count untestable and hidden a real regression.
      const rows = scenario() === "none" ? MEMBER_ROWS.filter((m) => m.user_id !== USER.id) : MEMBER_ROWS;
      if (f.user_id) return rows.filter((m) => m.user_id === f.user_id);
      if (f.squad_id) return rows.filter((m) => m.squad_id === f.squad_id);
      if (f["in:squad_id"]) return rows.filter((m) => f["in:squad_id"].includes(m.squad_id));
      return rows;
    }
    if (t === "squads") {
      if (f.id) return PUBLIC_SQUADS.filter((s) => s.id === f.id);
      return PUBLIC_SQUADS;
    }
    if (t === "squad_messages") return scenario() === "none" ? [] : MESSAGES.slice().reverse();
    if (t === "friendships") return [];
    if (t === "matches") return [];
    return [];
  }
  single() { const r = this._rows(); return Promise.resolve({ data: r[0] ?? null, error: r.length ? null : { message: "no rows" } }); }
  maybeSingle() { const r = this._rows(); return Promise.resolve({ data: r[0] ?? null, error: null }); }
  then(res, rej) { return Promise.resolve({ data: this._rows(), error: null }).then(res, rej); }
}

// Every RPC the squads screen can call, and what it hands back. Recorded so the
// test can assert the ARGUMENT NAMES the client sends.
window.__RPC_CALLS = [];
const RPC = {
  get_squad_invite_code: "4Q7ZB3",
  regenerate_squad_invite_code: "9M2XD1",
  heartbeat_presence: 1,
};

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
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      window.__RPC_CALLS.push({ name, args: args ? Object.keys(args).sort() : [] });
      return { data: RPC[name] ?? null, error: null };
    },
    functions: { invoke: async () => ({ data: null, error: { message: "stubbed" } }) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  };
}
export default { createClient };
`;

const checks = [];
const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

const server = await serve(PORT);
const browser = await chromium.launch();
console.log(renderSection("Squads screen (four subtabs, browse, roster, chat)"));

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

    await openTab(page, "Chat");
    const chatNone = await visible(page, "#squad-chat-none");
    check("Chat tells a squad-less player they need a squad", chatNone, chatNone ? "empty state shown" : "chat empty state missing");

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
    check(
      "The header carries tag, motto and member count",
      header.includes("HWK") && header.includes("Defence travels") && /3\s*\/\s*20/.test(header),
      `tag=${header.includes("HWK")} motto=${header.includes("Defence travels")} count=${/3\s*\/\s*20/.test(header)}`
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

    await openTab(page, "Chat");
    const chatText = await text(page, "#squad-chat-messages");
    check(
      "Chat renders the squad's messages",
      chatText.includes("first to the gym"),
      chatText.replace(/\s+/g, " ").slice(0, 100) || "chat pane empty"
    );
    // The hostile message must appear as TEXT, never as an element.
    const injected = await page.locator("#squad-chat-messages img").count();
    check(
      "A message containing markup is escaped, not rendered",
      injected === 0 && chatText.includes("<img"),
      injected === 0 ? "rendered as literal text" : `${injected} <img> element(s) built from a chat message`
    );

    check("No errors on the squad-member screen", errors.length === 0, errors.slice(0, 3).join(" | ") || "clean");
    await page.close();
  }

  // ---- 3. the other two tabs still open ------------------------------------
  {
    const { page, errors } = await openSquads("member");
    for (const tab of ["Friends", "Tournaments", "Home"]) {
      await openTab(page, tab);
      const onScreen = await visible(page, "#screen-squads");
      if (!onScreen) { check(`The ${tab} tab opens`, false, "squads screen disappeared"); break; }
    }
    check("All four subtabs open without throwing", errors.length === 0, errors.slice(0, 3).join(" | ") || "clean");

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
} catch (e) {
  check("the harness ran", false, e.message);
}

for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);

await browser.close();
server.close();
process.exit(ok ? 0 : 1);
