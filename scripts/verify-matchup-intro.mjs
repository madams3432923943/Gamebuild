#!/usr/bin/env node
// The pre-draft matchup intro, rendered in a real browser.
//
// WHY THIS EXISTS
//
// The intro is the one screen that shows a player somebody ELSE'S identity,
// and for a long time it showed almost none of it: a strip of banner artwork
// with a username and a tier caption under it. Two players flying the same
// banner were indistinguishable, and everything either of them had actually
// earned - their icon, their featured badges, their rep and rating - was on a
// card the other player never saw.
//
// It is also the screen with the least natural coverage. It plays once per
// online match, for nine seconds, between two screens that both have their own
// tests, and it needs two accounts and a live matchmaker to reach. The online
// self-test drives it, but only asserts that a draft screen eventually appears
// on the far side of it.
//
// So this renders both sides directly, and asserts the two things that broke
// before and would break again:
//
//   1. Each side is a WHOLE player card - the same one the home screen shows,
//      built by the same function, carrying the same parts. The check compares
//      the rendered card's structure against index.html's own #player-banner
//      markup, so the two cannot drift apart without failing here.
//
//   2. It holds at 360px. Two full cards and a VS is a much taller screen than
//      two banner strips were, and a phone is where an online match is most
//      likely to be played.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
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
      // Read before writing headers - see the same note in verify-box-score.
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

/** Mounts the real intro markup with two real player cards in it. Returns
 *  nothing; the assertions below read the DOM it leaves behind. */
async function mountIntro(page) {
  return page.evaluate(async () => {
    const { renderMatchupSide } = await import("/js/ui.js");
    const { normalizeProfileRow } = await import("/js/profile.js");

    // The intro's own markup, lifted from the app rather than restated here.
    const appHtml = await (await fetch("/index.html")).text();
    const doc = new DOMParser().parseFromString(appHtml, "text/html");
    const section = doc.querySelector("#screen-matchup-intro");
    const homeCard = doc.querySelector("#player-banner");
    if (!section || !homeCard) return { mounted: false };

    const stage = document.getElementById("stage");
    stage.innerHTML = section.innerHTML;

    // Two players who differ in every field the card draws, so a card that
    // renders the wrong player's data cannot pass by coincidence.
    const me = normalizeProfileRow({
      id: "a",
      username: "HomeSideHank",
      online_wins: 140,
      online_losses: 60,
      offline_wins: 10,
      offline_losses: 4,
      draft_counts: { "Michael Jordan": 9 },
      career_totals: {},
      personal_bests: {},
      featured_badges: ["untouchable"],
      equipped_banner: "gold",
      equipped_icon: null,
      created_at: "2026-02-03T00:00:00.000Z",
      sport_ratings: { nba: { rating: 640, games: 200, wins: 140, losses: 60 } },
    });
    const them = normalizeProfileRow({
      id: "b",
      username: "AwaySideAda",
      online_wins: 12,
      online_losses: 30,
      offline_wins: 0,
      offline_losses: 0,
      draft_counts: {},
      career_totals: {},
      personal_bests: {},
      featured_badges: [],
      equipped_banner: "celtics",
      equipped_icon: null,
      created_at: "2026-06-11T00:00:00.000Z",
      sport_ratings: { nba: { rating: 470, games: 42, wins: 12, losses: 30 } },
    });

    // The shape loadOverallRankInfo returns, built here rather than fetched:
    // ranking is a query against every profile in the database and is not what
    // this screen is being tested for.
    const rankInfo = (name, rating) => ({
      provisional: false,
      rating,
      tier: { name },
      next: null,
      percentile: 90,
      rank: 1,
      totalQualifying: 10,
      gamesPlayed: 200,
    });

    renderMatchupSide({ slot: document.getElementById("matchup-card-a") }, {
      profile: me,
      rankInfo: rankInfo("Legend", 640),
    });
    renderMatchupSide({ slot: document.getElementById("matchup-card-b") }, {
      profile: them,
      rankInfo: rankInfo("Starter", 470),
    });

    // Both sides settled, as they are for the beat where the players are
    // actually reading each other's cards - that is the state whose layout
    // matters, not the off-screen one they fly in from.
    for (const id of ["matchup-side-a", "matchup-side-b"]) {
      document.getElementById(id).classList.add("fly-in", "settle");
    }

    // The home card's part list, as index.html declares it. Compared against
    // the built card below: if one grows a part the other has not, they have
    // drifted and the intro is no longer showing the same card.
    const partsOf = (root) =>
      [...root.querySelectorAll("[class]")]
        .flatMap((el) => [...el.classList])
        .filter((c) => c.startsWith("pb-") || c === "player-name" || c === "player-avatar")
        .filter((c, i, all) => all.indexOf(c) === i)
        .sort();

    return { mounted: true, homeParts: partsOf(homeCard) };
  });
}

async function readCards(page) {
  return page.evaluate(() => {
    const read = (id) => {
      const slot = document.getElementById(id);
      const card = slot.querySelector(".player-banner");
      if (!card) return null;
      const parts = [...card.querySelectorAll("[class]")]
        .flatMap((el) => [...el.classList])
        .filter((c) => c.startsWith("pb-") || c === "player-name" || c === "player-avatar")
        .filter((c, i, all) => all.indexOf(c) === i)
        .sort();
      return {
        parts,
        name: card.querySelector(".player-name")?.textContent || "",
        joined: card.querySelector(".pb-joined")?.textContent || "",
        joinedHidden: card.querySelector(".pb-joined")?.classList.contains("hidden") ?? true,
        avatar: card.querySelector(".player-avatar")?.textContent || "",
        badgeSlots: card.querySelectorAll(".pb-badge").length,
        stats: [...card.querySelectorAll(".pb-stat")].map((s) => [
          s.querySelector(".pb-stat-label")?.textContent,
          s.querySelector(".pb-stat-value")?.textContent,
        ]),
        hasBanner: card.classList.contains("has-banner"),
        hasImage: card.classList.contains("has-banner-image"),
        bannerImage: card.style.getPropertyValue("--banner-image"),
        height: Math.round(card.getBoundingClientRect().height),
      };
    };
    return { a: read("matchup-card-a"), b: read("matchup-card-b") };
  });
}

/** Content clipped INSIDE a card, which is invisible to any viewport-level
 *  audit: .player-banner is overflow:hidden, so a name, a stat or a badge that
 *  does not fit is silently cut off rather than pushing the page sideways.
 *  That is precisely how this screen broke at 360px - a leftover rule sized the
 *  side at 42% of the column and the player's own username was cropped mid-word
 *  on their own card, with the document reporting zero overflow. */
async function clippedInsideCards(page) {
  return page.evaluate(() =>
    ["matchup-card-a", "matchup-card-b"].flatMap((id) => {
      const card = document.getElementById(id).querySelector(".player-banner");
      if (!card) return [];
      const box = card.getBoundingClientRect();
      // Decorative layers are MEANT to bleed: the artwork wash fills the card
      // and the ghosted abbreviation is deliberately bled off the corner.
      return [...card.querySelectorAll(".pb-top *, .pb-badges *, .pb-stats *")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.right > box.right + 0.5 || r.left < box.left - 0.5);
        })
        .map((el) => `${id}: .${[...el.classList].join(".")}`);
    })
  );
}

/** Where VS sits at the end of its landing animation versus where it sits at
 *  rest. They must be the same place.
 *
 *  The landing keyframe used to carry translate(-50%, -50%), copied from the
 *  countdown - which is absolutely positioned, where that translate is what
 *  centres it. VS is an ordinary flex item, so the offset applied for the
 *  length of the animation and vanished when it ended: a 24x20px jolt on the
 *  exact beat the animation exists to sell. Nothing errored and no layout
 *  audit could see it, because at rest the element is where it belongs. */
async function vsLandingDrift(page) {
  const box = () => page.evaluate(() => {
    const r = document.getElementById("matchup-vs").getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  });

  await page.evaluate(() => document.getElementById("matchup-vs").classList.remove("vs-land"));
  const rest = await box();
  await page.evaluate(() => {
    const el = document.getElementById("matchup-vs");
    void el.offsetWidth;
    el.classList.add("vs-land");
  });
  // Late in the 0.5s landing, where the old translate was still applied and
  // the snap-back was one frame away.
  await page.waitForTimeout(430);
  const landing = await box();
  return { dx: Math.abs(landing.x - rest.x), dy: Math.abs(landing.y - rest.y) };
}

/** What still moves when the viewer has asked for less motion.
 *
 *  Two mechanisms cover this screen and only one of them is local: a global
 *  reduced-motion reset at the end of style.css clamps every animation and
 *  transition to 0.01ms with !important, and the per-component `animation:
 *  none` blocks are belt-and-braces on top of it. So the threshold below is an
 *  epsilon, not zero - a clamped transition reports 1e-05s, which is "still"
 *  by any honest reading.
 *
 *  Checked against the outcome rather than either mechanism, because that is
 *  the part that must hold: what fails here is a future rule that escapes the
 *  global reset (an !important duration of its own, an inline style, a
 *  Web-Animations call), not a missing entry in a list. */
const STILL_MS = 0.05;
async function motionUnderReducedMotion(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const moving = await page.evaluate(() => {
    const STILL_MS = 0.05;
    const secs = (v) => v.split(",").reduce((worst, part) => Math.max(worst, parseFloat(part) || 0), 0);
    const out = [];
    const check = (id, cls) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (cls) el.classList.add(cls);
      const cs = getComputedStyle(el);
      const animated = cs.animationName !== "none" && secs(cs.animationDuration) > STILL_MS;
      if (animated || secs(cs.transitionDuration) > STILL_MS) {
        out.push(`#${id}${cls ? "." + cls : ""}: ${animated ? cs.animationName : `transition ${cs.transitionDuration}`}`);
      }
    };
    check("matchup-side-a", "fly-in");
    check("matchup-side-a", "settle");
    check("matchup-vs", "vs-land");
    check("matchup-countdown", "pulse");
    check("matchup-intro", "intro-lit");
    return out;
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  return moving;
}

/** Anything sticking out sideways at this width, and by how much. The same
 *  question the mobile audit in verify-browser asks, kept narrow: this screen
 *  is two cards and a countdown, so a full overlap sweep would be noise. */
async function auditWidth(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(120);
  return page.evaluate(() => {
    const overflow = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
    // Vertical room matters here in a way it does not on an ordinary screen:
    // the intro is a timed animation, so a second card pushed below the fold
    // is a card the player never sees rather than one they scroll to.
    const below = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const escaping = [...document.querySelectorAll("#stage *")].filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      // The sides fly in from off-screen; only what has landed is in scope.
      if (!el.closest(".fly-in") && el.closest(".matchup-side")) return false;
      return r.right > window.innerWidth + 1 || r.left < -1;
    }).length;
    return { overflow, escaping, below };
  });
}

async function main() {
  const port = Number(process.env.BK_MATCHUP_PORT || 8938);
  const server = await serve(ROOT, port);
  console.log(renderSection("Matchup intro (both players' full cards, real Chromium)"));

  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text());
  });

  const checks = [];
  const check = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail });

  try {
    await page.goto(`http://127.0.0.1:${port}/scripts/selftest/matchup-harness.html`);
    const { mounted, homeParts } = await mountIntro(page);
    if (!mounted) throw new Error("index.html has no #screen-matchup-intro or no #player-banner to compare against");

    const { a, b } = await readCards(page);
    check("Both sides render a player card", !!a && !!b, a && b ? "two .player-banner cards" : "a side rendered nothing");

    if (a && b) {
      // 1. Same card as home, part for part.
      const missing = homeParts.filter((p) => !a.parts.includes(p));
      check(
        "The intro card carries every part the home card does",
        missing.length === 0,
        missing.length ? `missing: ${missing.join(", ")}` : `parts: ${a.parts.join(" ")}`
      );

      // 2. Each side shows ITS OWN player - the failure mode where a shared
      // renderer paints one profile onto both cards.
      check(
        "Each side shows its own player",
        a.name === "HomeSideHank" && b.name === "AwaySideAda",
        `a="${a.name}" b="${b.name}"`
      );
      check(
        "Each side shows its own record and rank",
        JSON.stringify(a.stats) !== JSON.stringify(b.stats) &&
          a.stats.some(([l, v]) => l === "Rep" && v === "140-60") &&
          b.stats.some(([l, v]) => l === "Rep" && v === "12-30") &&
          a.stats.some(([l, v]) => l === "Rank" && v === "Legend"),
        `a=${JSON.stringify(a.stats)} b=${JSON.stringify(b.stats)}`
      );

      // 3. The details that were missing entirely before.
      check(
        "Both cards show the join plate",
        !a.joinedHidden && !b.joinedHidden && /^Est\. \d{2}\/\d{4}$/.test(a.joined),
        `a="${a.joined}" b="${b.joined}"`
      );
      check(
        "Both cards show the featured-badge row",
        a.badgeSlots > 0 && a.badgeSlots === b.badgeSlots,
        `${a.badgeSlots} slots per card`
      );
      check("Both cards show a player icon", !!a.avatar && !!b.avatar, `a="${a.avatar}" b="${b.avatar}"`);

      // 4. The banner is still the card's background - the one thing the old
      // intro DID show, which must not be lost on the way to showing the rest.
      check(
        "The equipped banner is the card's background",
        a.hasBanner && b.hasBanner && a.hasImage && a.bannerImage.includes("Gold"),
        `a: has-banner=${a.hasBanner} image=${a.bannerImage || "(colours only)"} | b: has-banner=${b.hasBanner}`
      );
    }

    // 5. Phone layout. Portrait first, then the landscape height a phone lands
    // in by accident, where two stacked cards have the least room.
    const clipped = [];
    const audits = {};
    for (const [name, w, h] of [["desktop", 1280, 900], ["phone-360", 360, 780], ["landscape-640", 640, 360]]) {
      audits[name] = await auditWidth(page, w, h);
      clipped.push(...(await clippedInsideCards(page)).map((c) => `${name} ${c}`));
    }
    check(
      "The intro holds at desktop, 360px portrait and 640x360 landscape",
      Object.values(audits).every((r) => r.overflow === 0 && r.escaping === 0),
      Object.entries(audits).map(([n, r]) => `${n} ${r.overflow}px/${r.escaping}`).join(" | ")
    );
    check(
      "Both cards fit on screen without scrolling, landscape included",
      Object.values(audits).every((r) => r.below === 0),
      Object.entries(audits).map(([n, r]) => `${n} ${r.below}px below the fold`).join(" | ")
    );
    check(
      "Nothing on either card is cropped by the card itself",
      clipped.length === 0,
      clipped.length ? clipped.slice(0, 6).join(" | ") : "name, badges and stats fit at every width"
    );

    // Back to a normal viewport before asking anything about the animations.
    await page.setViewportSize({ width: 1280, height: 900 });
    const drift = await vsLandingDrift(page);
    check(
      "VS lands where it comes to rest",
      drift.dx <= 2 && drift.dy <= 2,
      `${drift.dx}px x, ${drift.dy}px y between the end of the landing and its resting place`
    );

    const stillMoving = await motionUnderReducedMotion(page);
    check(
      "Nothing on the intro moves under prefers-reduced-motion",
      stillMoving.length === 0,
      stillMoving.length ? stillMoving.join(" | ") : "fly-in, settle, VS, countdown and stage lights all still"
    );
  } catch (e) {
    check("harness ran", false, e.message);
  }

  check("no console or page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "clean");

  await browser.close();
  server.close();

  for (const c of checks) console.log(renderCheck(c));
  const { counts, ok } = summarize(checks);
  console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
