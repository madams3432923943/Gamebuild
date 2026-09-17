// Sending feedback to the developers: the rules, and the one call that does it.
//
// BUSINESS LOGIC, NOT UI. The form that collects the text lives in
// js/ui/feedback-form.js; what a valid submission is, where it goes and what
// comes back lives here, so the screen can be rebuilt without the rules moving
// with it.
//
// THE LIMIT IS STATED IN THREE PLACES and that is one fact in three
// languages, not three facts: this constant, the CHECK constraint on
// public.feedback, and the guard in the send-feedback Edge Function. The
// browser's copy exists to give a live counter and a disabled button; the
// other two are what actually decide. scripts/verify-feedback.mjs reads all
// three and fails the build if they ever drift apart.
//
// WHY THE EDGE FUNCTION AND NOT THE RPC DIRECTLY. The row could be written
// straight from here - submit_feedback is granted to authenticated for exactly
// that reason, and it is what enforces the throttle either way. What the
// browser cannot do is send the mail, because that needs a provider key and a
// key in client JavaScript is a key anybody can read. So the browser asks the
// function, the function stores and sends, and the secret never leaves the
// server.

import { getSupabase, requireSession } from "./supabaseClient.js";
import { activeSportId } from "./sports/index.js";
import { currentScreen } from "./shell.js";
import { buildStamp } from "./lib/build-stamp.js";

/** The most characters a single piece of feedback may carry.
 *
 * 1,200 is a deliberate middle: long enough to describe a bug with the steps
 * that caused it, short enough that the field is not usable as storage. */
export const MAX_FEEDBACK = 1200;

/** Is this text something we would send? The button's enabled state and the
 * server's first check are the same question, asked here once.
 *
 * Trimmed before it is measured, so a field holding only spaces is empty
 * rather than valid - which is the whole of the whitespace-only rule. */
export function isSendableFeedback(text) {
  const trimmed = (text || "").trim();
  return trimmed.length > 0 && trimmed.length <= MAX_FEEDBACK;
}

/** What the developers get besides the words: where the player was and what
 * they were running. Every field is best-effort - a screen name that could not
 * be determined must never be the reason a report is not sent. */
export function feedbackContext() {
  let sport = "";
  try {
    sport = activeSportId() || "";
  } catch {
    // No sport chosen yet is the normal case on the home screen.
  }
  return { page: currentScreen() || "", sport, build: buildStamp() };
}

/**
 * Sends one piece of feedback.
 *
 * Resolves only when the server has confirmed the message is stored, so the
 * caller's success state cannot appear before the backend has agreed to it.
 * Rejects with a message written to be read by a player.
 *
 * @returns { id, emailed, emailStatus } - `emailed` is reported rather than
 *   folded into success on purpose. The feedback IS delivered once it is
 *   stored (the developers read the table); the mail is the notification on
 *   top of it, and a provider that is unconfigured or refusing has to be
 *   visible as itself instead of passing silently as "sent".
 */
export async function sendFeedback(text) {
  const feedback = (text || "").trim();
  if (!feedback) throw new Error("Feedback can't be empty.");
  if (feedback.length > MAX_FEEDBACK) {
    throw new Error(`Feedback is limited to ${MAX_FEEDBACK} characters.`);
  }

  // Asked for before the call rather than discovered by a 401. The settings
  // menu is behind the sign-in gate, so this is a bug rather than a state a
  // player can reach - and it throws with a sentence rather than a status code.
  await requireSession();

  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke("send-feedback", {
    body: { feedback, ...feedbackContext() },
  });

  if (error) throw new Error(await readFunctionError(error));
  // A function that answered without `stored` is one that has not caught up
  // with this client (CLAUDE.md: tolerate a server mid-deploy). Treated as a
  // failure, because the alternative is telling a player their words were kept
  // when nothing has said so.
  if (!data || data.stored !== true) {
    throw new Error("Your feedback couldn't be sent just now. Try again in a moment.");
  }
  if (data.emailed === false) {
    // Not shown to the player - their feedback is stored and reachable - but
    // never swallowed either. This is the line that turns a silently
    // unconfigured mail provider into something somebody can see.
    console.warn(`Feedback stored but not emailed (${data.emailStatus || "unknown"}).`);
  }
  return { id: data.id ?? null, emailed: data.emailed === true, emailStatus: data.emailStatus || "unknown" };
}

/**
 * The sentence behind a FunctionsHttpError.
 *
 * supabase-js does NOT put a non-2xx function response body on the error - it
 * reports "Edge Function returned a non-2xx status code" and hangs the real
 * Response off `error.context`. Without reading that, every server-side
 * refusal this feature has (empty, too long, throttled, signed out) arrives on
 * screen as the same meaningless string, which is the specific failure the
 * feedback form must not have: a player who is rate-limited needs to be told
 * that, not told nothing.
 */
async function readFunctionError(error) {
  try {
    const body = await error?.context?.json?.();
    if (body && typeof body.error === "string" && body.error) return body.error;
  } catch {
    // A body that is not JSON, or has already been consumed. Fall through.
  }
  // A network failure or a function that is not deployed yet. The raw message
  // ("Failed to send a request to the Edge Function") describes our plumbing,
  // not their problem, so it goes to the console and they get a sentence.
  console.error("Feedback submission failed:", error);
  return "Your feedback couldn't be sent just now. Check your connection and try again.";
}
