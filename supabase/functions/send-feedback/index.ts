// send-feedback: the only path from the in-app feedback form to the
// developers' inbox.
//
// WHY A FUNCTION AND NOT A DIRECT INSERT. The row itself could be written from
// the browser through the RPC (and is - see below). What cannot happen in the
// browser is the mail: sending it needs a provider API key, and any key that
// reaches client JavaScript is a key anybody can read out of the bundle and use
// to send mail as us. So the secret stays in the function's environment, and
// the function is the only thing that holds it.
//
// WHY IT CALLS THE RPC AS THE USER RATHER THAN INSERTING WITH THE SERVICE ROLE.
// public.enforce_rate_limit keys off auth.uid() and deliberately does nothing
// when there isn't one - a service-role write is not the threat model, so a
// service-role insert here would silently have NO rate limit at all. Calling
// submit_feedback on a client carrying the caller's own JWT means the throttle,
// the length rule and the ownership of the row are all enforced by the database
// against the real user, exactly as they would be if the browser called it
// directly. This function adds the mail; it does not add a way around the rules.
//
// ORDER MATTERS: STORE, THEN SEND. The row is the record and the mail is the
// alert (see db/migrations/20260917_01_player_feedback.sql). Sending first and
// storing second would mean a storage failure loses a message we had already
// promised to deliver; storing first means the worst case is a message that is
// safely on disk and did not ring a bell. The response says which happened
// rather than reporting "ok" for both, so a misconfigured provider is visible
// in the function logs and in the caller's console instead of looking like
// success.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// THE ONE PIECE OF CONFIGURATION THIS FEATURE NEEDS, and it is deliberately
// absent from the repository. With no key set the function still validates,
// still throttles and still stores - it simply reports that no mail was sent,
// which is an honest degraded mode rather than a fake success or a hard 500
// that would throw away a player's words over a missing setting.
// See docs/player-feedback.md for the one setup step.
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FEEDBACK_TO = Deno.env.get("FEEDBACK_TO_EMAIL") ?? "support@draftnovagame.com";
// Must be an address on a domain verified with the provider, or the provider
// rejects the send. onboarding@resend.dev is Resend's own sandbox sender and
// works before any domain is verified, which makes the feature testable on day
// one without anybody inventing a credential.
const FEEDBACK_FROM = Deno.env.get("FEEDBACK_FROM_EMAIL") ?? "Draft Nova <onboarding@resend.dev>";

// The same number as the CHECK constraint on the table and as MAX_FEEDBACK in
// js/feedback.js. Three copies is two too many to keep in step by hand, which
// is why scripts/verify-feedback.mjs reads all three and fails if they drift.
const MAX_FEEDBACK = 1200;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** A short field as a short field. Context values are diagnostics from a
 * client, so they are bounded here as well as in the database - this function
 * puts them in an email, and the database's own cap is not in force until the
 * insert has already been composed. */
const clamp = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** Text destined for an HTML email body.
 *
 * The feedback is a player's own words and goes out as `text/plain` below, so
 * nothing here is parsed as markup today. This exists for the day somebody adds
 * an HTML part: the escaping has to be written at the moment the field is
 * placed, not remembered later. */
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );

/** Everything the developers need to act on a report, in the order they need
 * it: what was said first, then who and where. Exported so
 * scripts/verify-feedback.mjs can assert the payload carries the context
 * fields rather than trusting that it does. */
export function buildEmail(fields: {
  body: string;
  username: string;
  userId: string;
  submittedAt: string;
  sport: string;
  page: string;
  build: string;
  userAgent: string;
  feedbackId: string;
}) {
  const subject = `Draft Nova Player Feedback — ${fields.username || "unknown player"}`;
  const meta: [string, string][] = [
    ["Username", fields.username || "—"],
    ["User ID", fields.userId],
    ["Submitted", fields.submittedAt],
    ["Sport", fields.sport || "—"],
    ["Screen", fields.page || "—"],
    ["Build", fields.build || "—"],
    ["Feedback ID", fields.feedbackId],
    ["User agent", fields.userAgent || "—"],
  ];
  const text = [
    fields.body,
    "",
    "—".repeat(20),
    ...meta.map(([k, v]) => `${k}: ${v}`),
  ].join("\n");
  const html =
    `<div style="font-family:system-ui,sans-serif">` +
    `<p style="white-space:pre-wrap;font-size:15px">${escapeHtml(fields.body)}</p>` +
    `<hr/><table style="font-size:13px;color:#444">` +
    meta.map(([k, v]) => `<tr><td><b>${escapeHtml(k)}</b></td><td>${escapeHtml(v)}</td></tr>`).join("") +
    `</table></div>`;
  return { subject, text, html };
}

/** Hands the message to the provider. Returns a status rather than throwing:
 * the caller has already stored the row, and a provider outage must not turn a
 * recorded piece of feedback into an error the player is asked to retry. */
async function sendEmail(mail: { subject: string; text: string; html: string }) {
  if (!RESEND_API_KEY) return { emailed: false, emailStatus: "not_configured" as const };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FEEDBACK_FROM,
        to: [FEEDBACK_TO],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    });
    if (!res.ok) {
      // Logged, never returned verbatim: a provider error can quote the key's
      // own id and the account's domain, and this response goes to a browser.
      console.error("Feedback email rejected:", res.status, await res.text().catch(() => ""));
      return { emailed: false, emailStatus: "failed" as const };
    }
    return { emailed: true, emailStatus: "sent" as const };
  } catch (e) {
    console.error("Feedback email could not be sent:", e);
    return { emailed: false, emailStatus: "failed" as const };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  // WHO IS ASKING, decided by the token and never by the body. The body may
  // claim any username it likes; the name on the email is the one the database
  // has for the id inside this JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) return json({ error: "You need to be signed in to send feedback." }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "That request couldn't be read." }, 400);
  }

  // Validated here as well as in the RPC. Not duplication for its own sake: a
  // 4,000-character paste should be refused before it is put on the wire to
  // Postgres, and the message a player sees for "too long" should say the
  // limit rather than surface a constraint name.
  const body = typeof payload.feedback === "string" ? payload.feedback.trim() : "";
  if (!body) return json({ error: "Feedback can't be empty." }, 400);
  if (body.length > MAX_FEEDBACK) {
    return json({ error: `Feedback is limited to ${MAX_FEEDBACK} characters.` }, 400);
  }

  const page = clamp(payload.page, 120);
  const sport = clamp(payload.sport, 40);
  const build = clamp(payload.build, 60);
  // The CLIENT'S header, not the body's claim about it, for the same reason
  // the username is not taken from the body.
  const userAgent = clamp(req.headers.get("user-agent"), 400);

  // STORE FIRST. The rate limit, the length rule and the row's ownership are
  // all enforced inside this call, against this user.
  const { data: feedbackId, error: rpcError } = await userClient.rpc("submit_feedback", {
    p_body: body,
    p_page_context: page,
    p_sport_context: sport,
    p_app_build: build,
    p_user_agent: userAgent,
  });

  if (rpcError) {
    // P0001 is every deliberate `raise exception` in submit_feedback and in
    // enforce_rate_limit - messages written to be read by a player. Anything
    // else is a real fault and is logged rather than shown, so a constraint
    // name or a missing relation never reaches the screen.
    const deliberate = rpcError.code === "P0001";
    if (!deliberate) console.error("Feedback could not be stored:", rpcError);
    return json(
      { error: deliberate ? rpcError.message : "Your feedback couldn't be sent just now. Try again in a moment." },
      // A throttled player is 429 so the client can say so specifically; every
      // other deliberate refusal is a 400.
      deliberate ? (/try again in a little while/i.test(rpcError.message) ? 429 : 400) : 500
    );
  }

  const { data: profile } = await userClient
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  const mail = buildEmail({
    body,
    username: profile?.username ?? "",
    userId: user.id,
    submittedAt: new Date().toISOString(),
    sport,
    page,
    build,
    userAgent,
    feedbackId: String(feedbackId ?? ""),
  });
  const { emailed, emailStatus } = await sendEmail(mail);

  // `stored` is what the player's success message is allowed to be based on -
  // their feedback is durably recorded and reachable by the developers. The
  // mail fields are reported honestly beside it rather than folded into one
  // boolean, so "the provider is not configured" and "the provider rejected
  // us" are both visible instead of passing as success.
  return json({ ok: true, stored: true, id: feedbackId, emailed, emailStatus });
});
