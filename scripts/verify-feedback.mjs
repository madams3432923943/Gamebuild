#!/usr/bin/env node
// The feedback feature, checked where it can actually go wrong.
//
// WHY THIS EXISTS
//
// A feedback form is three rules and a promise, and every one of them fails
// silently:
//
//   THE LIMIT IS WRITTEN THREE TIMES - in js/feedback.js for the counter and
//   the disabled button, in the CHECK constraint on public.feedback, and in
//   the Edge Function. Three copies of one number is two chances to drift, and
//   the drift is invisible until a player writes 1,400 characters, watches the
//   counter say it is fine, presses send and loses all of it to a constraint.
//   SUCCESS THAT IS NOT SUCCESS. "Thanks, we got it" printed for a submission
//   the server never stored is the worst outcome this feature has: the player
//   believes they have reported the bug and stops reporting it.
//   THE SECRET. The whole reason there is a server here at all is that the
//   mail provider's key must never reach the browser. Nothing enforces that
//   except a check that looks.
//
// The three states below are driven in a real browser against an injected
// sender, because the states are what the player sees and none of them can be
// read off the diff.

import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.BK_FEEDBACK_PORT || 8943);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json",
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

const checks = [];
const add = (title, ok, detail = "") => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

// ---------------------------------------------------------------------------
// 1. The limit is ONE number, however many places it is written in.
// ---------------------------------------------------------------------------

const clientSrc = await readFile(path.join(ROOT, "js/feedback.js"), "utf8");
const fnSrc = await readFile(path.join(ROOT, "supabase/functions/send-feedback/index.ts"), "utf8");
const migrationDir = path.join(ROOT, "db/migrations");
const migrationFile = (await readdir(migrationDir)).find((f) => /player_feedback/.test(f));
const sql = migrationFile ? await readFile(path.join(migrationDir, migrationFile), "utf8") : "";

const clientLimit = Number(clientSrc.match(/export const MAX_FEEDBACK\s*=\s*(\d+)/)?.[1]);
const fnLimit = Number(fnSrc.match(/const MAX_FEEDBACK\s*=\s*(\d+)/)?.[1]);
// Both the CHECK constraint and the explicit guard inside submit_feedback.
const sqlLimits = [...sql.matchAll(/char_length\([^)]*\)\s*(?:between\s+1\s+and|>)\s*(\d+)/g)].map((m) => Number(m[1]));

add(
  "The character limit is the same number in the client, the function and the database",
  clientLimit > 0 && clientLimit === fnLimit && sqlLimits.length >= 2 && sqlLimits.every((n) => n === clientLimit),
  `client=${clientLimit} edge-function=${fnLimit} database=[${sqlLimits.join(", ")}]`
);
add(
  "The limit is in the 1,000-1,500 range the product asked for",
  clientLimit >= 1000 && clientLimit <= 1500,
  `${clientLimit} characters`
);

// ---------------------------------------------------------------------------
// 2. No credential reaches the browser.
// ---------------------------------------------------------------------------
//
// The server-side file is allowed to NAME its environment variables; what it
// must never do is carry a value. Everything under js/ must not even name them.

const clientFiles = [];
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(full);
    else if (entry.name.endsWith(".js")) clientFiles.push(full);
  }
}
await collect(path.join(ROOT, "js"));

const SECRET_NAMES = /RESEND_API_KEY|SERVICE_ROLE|SMTP_PASS|SENDGRID|MAILGUN|POSTMARK/i;
const leaking = [];
for (const file of clientFiles) {
  const text = await readFile(file, "utf8");
  if (SECRET_NAMES.test(text)) leaking.push(path.relative(ROOT, file));
}
add(
  "No mail-provider or service-role credential is named in client JavaScript",
  leaking.length === 0,
  leaking.length ? `named in: ${leaking.join(", ")}` : `${clientFiles.length} client modules scanned, none reference one`
);
// A key PASTED into the function is just as bad as one in the browser, since
// the repository is the thing that gets cloned and shared.
add(
  "The Edge Function reads its provider key from the environment, never a literal",
  /Deno\.env\.get\("RESEND_API_KEY"\)/.test(fnSrc) && !/re_[A-Za-z0-9]{10,}/.test(fnSrc),
  "RESEND_API_KEY comes from Deno.env and no key literal is present"
);

// ---------------------------------------------------------------------------
// 3. The database refuses what the form refuses.
// ---------------------------------------------------------------------------

add(
  "Feedback rows are locked down by RLS with no read policy for players",
  /alter table public\.feedback enable row level security/.test(sql) &&
    /revoke all on public\.feedback from anon, authenticated/.test(sql) &&
    !/create policy/i.test(sql),
  "RLS on, no policies, table privileges revoked - the SECURITY DEFINER function is the only way in"
);
add(
  "submit_feedback requires a signed-in user and sets user_id itself",
  /v_uid uuid := auth\.uid\(\)/.test(sql) &&
    /if v_uid is null then/.test(sql) &&
    /values \(\s*v_uid,/.test(sql),
  "auth.uid() decides the owner; the client cannot name one"
);
add(
  "submit_feedback trims before it measures, so whitespace-only is empty",
  /btrim\(coalesce\(p_body/.test(sql) && /if v_body = '' then/.test(sql),
  "btrim then the empty test"
);
add(
  "Feedback submissions are rate limited per user",
  /enforce_rate_limit\(\s*'feedback',\s*(\d+),\s*interval '1 hour'/.test(sql),
  `${sql.match(/enforce_rate_limit\(\s*'feedback',\s*(\d+)/)?.[1] ?? "?"} per hour, via the shared enforce_rate_limit`
);
add(
  "The function is granted to authenticated and not to anon",
  /grant execute on function public\.submit_feedback[^;]*to authenticated/.test(sql) &&
    /revoke all on function public\.submit_feedback[^;]*from public, anon/.test(sql),
  "an unauthenticated caller cannot reach it - the open-relay case"
);

// ---------------------------------------------------------------------------
// 4. The email carries the context a report is useless without.
// ---------------------------------------------------------------------------

// Deno's own `jsr:` imports cannot resolve under Node, so the payload is
// checked as text rather than by executing buildEmail. Less satisfying, and
// still the difference between "the fields are listed" and "somebody believes
// they are".
for (const field of ["Username", "User ID", "Submitted", "Sport", "Screen", "Build", "User agent"]) {
  add(`The email payload carries ${field}`, fnSrc.includes(`"${field}"`), `"${field}" appears in buildEmail`);
}
add(
  "The subject names the player, as the product asked",
  /Draft Nova Player Feedback — \$\{fields\.username/.test(fnSrc),
  "`Draft Nova Player Feedback — ${username}`"
);
add(
  "The email goes to support@draftnovagame.com by default",
  /FEEDBACK_TO_EMAIL"\) \?\? "support@draftnovagame\.com"/.test(fnSrc),
  "overridable by env, but that is the default with no configuration at all"
);
add(
  "The row is stored BEFORE the mail is attempted",
  fnSrc.indexOf('rpc("submit_feedback"') < fnSrc.indexOf("sendEmail(mail)"),
  "a provider outage costs a notification, not the feedback"
);
add(
  "A failed or unconfigured send is reported rather than passed off as sent",
  /emailStatus: "not_configured"/.test(fnSrc) &&
    /emailStatus: "failed"/.test(fnSrc) &&
    /ok: true, stored: true, id: feedbackId, emailed, emailStatus/.test(fnSrc),
  "the response separates `stored` from `emailed`"
);

// ---------------------------------------------------------------------------
// 5. THE FORM ITSELF, in a real browser, in every state it has.
// ---------------------------------------------------------------------------

const server = await serve(ROOT, PORT);
const browser = await chromium.launch({ headless: true });
const stub = await readFile(path.join(ROOT, "scripts/selftest/supabase-stub.js"), "utf8");

/** Opens the app, then mounts the feedback form with an INJECTED sender, which
 * is how the submitting / success / failure states are driven without a
 * backend. buildFeedbackForm takes the sender for exactly this reason.
 *
 * The scenarios are NAMED rather than passed as source to be compiled in the
 * page. The first version of this did the latter and the page's own CSP threw
 * it out - `script-src` has no 'unsafe-eval', so `new Function` does not run
 * here any more than an injected <script> would. That is the policy working,
 * and a test is not a reason to weaken it. */
async function openForm(page, scenario) {
  return page.evaluate(async (which) => {
    const { buildFeedbackForm } = await import("/js/ui/feedback-form.js");
    const { openModal } = await import("/js/shell.js");
    const SCENARIOS = {
      succeeds: async () => {
        window.__sent = (window.__sent || 0) + 1;
        await new Promise((r) => setTimeout(r, 250));
        return { id: "abc", emailed: true, emailStatus: "sent" };
      },
      fails: async () => {
        throw new Error("Your feedback couldn't be sent just now. Check your connection and try again.");
      },
      throttled: async () => {
        throw new Error("You've sent a few pieces of feedback just now - thanks. Try again in a little while.");
      },
    };
    openModal("Send Feedback", buildFeedbackForm({ submit: SCENARIOS[which] }));
  }, scenario);
}

const read = (page) =>
  page.evaluate(() => ({
    sendLabel: document.querySelector(".feedback-actions .btn-primary")?.textContent?.trim(),
    sendDisabled: document.querySelector(".feedback-actions .btn-primary")?.disabled,
    cancelLabel: document.querySelector(".feedback-actions .btn-secondary")?.textContent?.trim(),
    counter: document.querySelector(".feedback-counter")?.textContent?.trim(),
    status: document.querySelector(".feedback-status")?.textContent?.trim() || "",
    statusKind: document.querySelector(".feedback-status.is-success")
      ? "success"
      : document.querySelector(".feedback-status.is-error")
        ? "error"
        : "none",
    maxLength: document.getElementById("feedback-text")?.maxLength,
  }));

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("**/esm.sh/**", (route) =>
    route.fulfill({ status: 200, body: stub, contentType: "text/javascript; charset=utf-8" })
  );
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
  await page.locator("#screen-home:not(.hidden)").waitFor({ state: "visible", timeout: 30000 });

  // ---- the route a player actually takes ---------------------------------
  await page.locator("#btn-settings").click();
  const rowVisible = await page.locator("#btn-send-feedback").isVisible();
  add("Settings has a visible Send Feedback control", rowVisible, rowVisible ? "#btn-send-feedback" : "not found");
  await page.locator("#btn-send-feedback").click();
  const formShown = await page.locator("#feedback-text").isVisible();
  add("It opens the feedback form", formShown, formShown ? "textarea present" : "no form");

  const blurbShown = await page.locator(".feedback-blurb").textContent();
  add(
    "The form carries the supporting copy",
    /idea, found a bug/i.test(blurbShown || "") && /Draft Nova developers/i.test(blurbShown || ""),
    blurbShown?.slice(0, 70)
  );

  // ---- empty / whitespace-only / counter ---------------------------------
  let state = await read(page);
  add("Submit is disabled on an empty field", state.sendDisabled === true, `disabled=${state.sendDisabled}`);
  add("The counter starts at zero over the limit", state.counter === `0 / ${clientLimit}`, state.counter);
  add("The textarea enforces the limit itself", state.maxLength === clientLimit, `maxlength=${state.maxLength}`);

  await page.fill("#feedback-text", "        ");
  state = await read(page);
  add("Submit stays disabled for whitespace only", state.sendDisabled === true, `8 spaces -> disabled=${state.sendDisabled}`);

  await page.fill("#feedback-text", "The draft timer keeps running after I pick.");
  state = await read(page);
  add("Submit enables for real text", state.sendDisabled === false, `counter ${state.counter}`);

  // A paste longer than the limit is TRUNCATED by the field rather than
  // accepted and refused later.
  await page.fill("#feedback-text", "x".repeat(clientLimit + 500));
  const typedLength = await page.evaluate(() => document.getElementById("feedback-text").value.length);
  add(
    "An over-limit paste is capped at the limit instead of being lost at the server",
    typedLength === clientLimit,
    `pasted ${clientLimit + 500}, field holds ${typedLength}`
  );

  // ---- success: only after the backend confirms --------------------------
  await page.evaluate(() => document.getElementById("modal-close").click());
  await openForm(page, "succeeds");
  await page.fill("#feedback-text", "Everything works, just wanted to say thanks.");
  await page.click(".feedback-actions .btn-primary");
  // Mid-flight: the loading state, and the second click that must do nothing.
  await page.waitForTimeout(60);
  const inFlight = await read(page);
  await page.evaluate(() => document.querySelector(".feedback-actions .btn-primary").click());
  add(
    "Submitting shows a loading state",
    /sending/i.test(inFlight.sendLabel || "") && inFlight.sendDisabled === true,
    `button reads "${inFlight.sendLabel}", disabled=${inFlight.sendDisabled}`
  );
  await page.waitForTimeout(500);
  const sentCount = await page.evaluate(() => window.__sent);
  add(
    "A second click while a send is in flight does not send twice",
    sentCount === 1,
    `the sender ran ${sentCount} time(s)`
  );
  state = await read(page);
  add(
    "Success is shown only after the backend confirms, and reads as success",
    state.statusKind === "success" && /on its way to the Draft Nova developers/i.test(state.status),
    `${state.statusKind}: ${state.status}`
  );
  add("Submit cannot be pressed again after a success", state.sendDisabled === true, `disabled=${state.sendDisabled}`);
  add("Cancel becomes the way out of a completed form", /close/i.test(state.cancelLabel || ""), state.cancelLabel);

  // ---- failure: never mistaken for success -------------------------------
  await page.evaluate(() => document.getElementById("modal-close").click());
  await openForm(page, "fails");
  await page.fill("#feedback-text", "This one is going to fail.");
  await page.click(".feedback-actions .btn-primary");
  await page.waitForTimeout(300);
  state = await read(page);
  add(
    "A failed send shows the error, not a success",
    state.statusKind === "error" && /couldn't be sent/i.test(state.status),
    `${state.statusKind}: ${state.status}`
  );
  add(
    "The player can try again after a failure, with their words still in the field",
    state.sendDisabled === false &&
      (await page.evaluate(() => document.getElementById("feedback-text").value)) === "This one is going to fail.",
    "button re-enabled and the text is intact"
  );

  // ---- the throttle, as the player sees it -------------------------------
  await page.evaluate(() => document.getElementById("modal-close").click());
  await openForm(page, "throttled");
  await page.fill("#feedback-text", "Fourth report in five minutes.");
  await page.click(".feedback-actions .btn-primary");
  await page.waitForTimeout(300);
  state = await read(page);
  add(
    "A throttled player is told they are throttled, specifically",
    state.statusKind === "error" && /try again in a little while/i.test(state.status),
    state.status
  );

  // ---- mobile ------------------------------------------------------------
  const phone = await browser.newContext({ viewport: { width: 360, height: 740 } });
  await phone.route("**/esm.sh/**", (route) =>
    route.fulfill({ status: 200, body: stub, contentType: "text/javascript; charset=utf-8" })
  );
  const small = await phone.newPage();
  await small.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
  await small.locator("#screen-home:not(.hidden)").waitFor({ state: "visible", timeout: 30000 });
  await small.locator("#btn-settings").click();
  await small.locator("#btn-send-feedback").click();
  await small.locator("#feedback-text").waitFor({ state: "visible", timeout: 10000 });
  const mobile = await small.evaluate(() => {
    const modal = document.querySelector("#modal-backdrop .modal");
    const send = document.querySelector(".feedback-actions .btn-primary");
    const m = modal.getBoundingClientRect();
    const s = send.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      modalFits: m.left >= 0 && m.right <= window.innerWidth,
      sendW: s.width,
      sendH: s.height,
      sendInView: s.top >= 0 && s.bottom <= window.innerHeight,
    };
  });
  add("At 360px the dialog fits without clipping", mobile.modalFits && mobile.overflow === 0, `overflow ${mobile.overflow}px`);
  add(
    // 44px on BOTH axes is the app's own touch floor (see the phone breakpoint
    // in css/style.css). A width floor with no height floor is the mistake the
    // mobile audit found repeatedly, so this asserts both.
    "At 360px the submit button is on screen and clears the 44px touch floor",
    mobile.sendInView && mobile.sendW >= 44 && mobile.sendH >= 44,
    `in view=${mobile.sendInView}, ${mobile.sendW.toFixed(1)}x${mobile.sendH.toFixed(1)}px`
  );
  await phone.close();

  add("No uncaught page errors during the whole flow", consoleErrors.length === 0, consoleErrors.join(" | ") || "none");
  await context.close();
} finally {
  await browser.close();
  server.close();
}

console.log(renderSection("Player feedback"));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
