// The feedback form: one textarea, a counter, and the three states a
// submission can be in.
//
// A MODULE OF ITS OWN, not another function in main.js. main.js is 6,000 lines
// because every screen's rendering was put where its listener already was, and
// the Settings sheet's own note in index.html says the same thing about
// markup. This is a self-contained dialog body with its own state machine, so
// it is its own file and main.js only has to know how to open it.
//
// BUILT AS NODES, NOT AN HTML STRING, the way js/onboarding.js is. None of
// this is user text on the way in, but the app's rule is that nothing is
// parsed as markup unless it has to be, and the CSP has no 'unsafe-inline'.
//
// THE DIALOG FRAME IS THE SHARED ONE. openModal already owns the backdrop,
// Escape, the close button, the focus trap and focus restore (js/shell.js). A
// feedback panel with its own overlay would be a second set of those rules to
// drift apart.

import { MAX_FEEDBACK, isSendableFeedback, sendFeedback } from "../feedback.js";
import { closeModal } from "../shell.js";

/** The supporting line under the heading. Exported so
 * scripts/verify-feedback.mjs can assert the screen says what the product
 * decided it says, rather than checking for a string it also holds a copy
 * of. */
export const FEEDBACK_BLURB =
  "Have an idea, found a bug, or want to tell us what you think? " +
  "Send it directly to the Draft Nova developers.";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The dialog body for Settings > Send Feedback.
 *
 * @param submit  the sender, injected so the verification harness can drive
 *   every state - submitting, success, failure, throttled - without a network
 *   or a backend. Defaults to the real one.
 * @returns the body node, for openModal().
 */
export function buildFeedbackForm({ submit = sendFeedback } = {}) {
  const body = el("div", "feedback-form");

  body.appendChild(el("p", "feedback-blurb", FEEDBACK_BLURB));

  // A REAL LABEL, not a placeholder. A placeholder disappears the moment
  // somebody types, which is exactly when a screen reader is asked what the
  // field is - and this is the only field in the dialog, so there is nothing
  // else for the question to resolve against.
  const label = el("label", "feedback-label", "Your feedback");
  label.htmlFor = "feedback-text";
  body.appendChild(label);

  const textarea = el("textarea", "feedback-textarea");
  textarea.id = "feedback-text";
  textarea.rows = 6;
  // ENFORCED BY THE FIELD as well as counted below it. maxLength stops a paste
  // at the limit instead of accepting 4,000 characters and refusing them at
  // the far end of a round trip, which is the version where somebody loses
  // what they wrote. The server checks it again regardless - a browser's
  // opinion about a limit is a courtesy, never the rule.
  textarea.maxLength = MAX_FEEDBACK;
  textarea.placeholder = "What's on your mind?";
  body.appendChild(textarea);

  // aria-live so the count is ANNOUNCED as it changes rather than only drawn.
  // polite, not assertive: it should not interrupt somebody mid-sentence.
  const counter = el("div", "feedback-counter");
  counter.setAttribute("aria-live", "polite");
  body.appendChild(counter);

  // One node for both outcomes, because a dialog should never show a success
  // and a failure at the same time. role="status" rather than "alert" for the
  // same reason the counter is polite.
  const status = el("p", "feedback-status");
  status.setAttribute("role", "status");
  status.hidden = true;
  body.appendChild(status);

  const actions = el("div", "feedback-actions");
  const cancel = el("button", "btn btn-secondary", "Cancel");
  cancel.type = "button";
  const send = el("button", "btn btn-primary", "Send Feedback");
  send.type = "button";
  actions.appendChild(cancel);
  actions.appendChild(send);
  body.appendChild(actions);

  // ---- state ----------------------------------------------------------
  // One flag rather than reading the button's disabled attribute: the button
  // is disabled for two different reasons (empty field, send in flight) and
  // only one of them must block a second submit. This is the one that does,
  // and it is what makes a double-tap on a phone - two taps inside the same
  // few hundred milliseconds - send one piece of feedback rather than two.
  let sending = false;
  let sent = false;

  function refresh() {
    const value = textarea.value;
    const trimmed = value.trim().length;
    counter.textContent = `${value.length} / ${MAX_FEEDBACK}`;
    // Only at the ceiling, not as a general warning colour: the counter is
    // information until the field stops accepting characters, and at that
    // moment it is the explanation for why typing did nothing.
    counter.classList.toggle("is-full", value.length >= MAX_FEEDBACK);
    // Whitespace-only is empty. The disabled button is why the player cannot
    // send it; the server's own trim is why they could not send it anyway.
    send.disabled = sending || sent || !isSendableFeedback(value) || trimmed === 0;
  }

  function setStatus(text, kind) {
    status.hidden = !text;
    status.textContent = text || "";
    status.classList.toggle("is-error", kind === "error");
    status.classList.toggle("is-success", kind === "success");
  }

  textarea.addEventListener("input", refresh);

  cancel.addEventListener("click", () => closeModal());

  send.addEventListener("click", async () => {
    // The guard that makes double submission impossible even if the disabled
    // attribute is defeated - by a synthetic click, or by the gap between a
    // touchstart and the paint that greys the button out.
    if (sending || sent) return;
    sending = true;
    refresh();
    send.textContent = "Sending…";
    // The field goes read-only rather than disabled: disabling it would grey
    // out the words somebody just wrote and, if the send fails, they would be
    // watching their own report look discarded while being told to try again.
    textarea.readOnly = true;
    cancel.disabled = true;
    setStatus("", null);

    try {
      await submit(textarea.value);
      // SUCCESS IS SET ONLY HERE - after the backend has confirmed the
      // feedback is stored. sendFeedback() rejects on anything else, including
      // a server too old to answer properly, so there is no path where this
      // line runs on an unconfirmed submission.
      sent = true;
      setStatus("Thanks — your feedback is on its way to the Draft Nova developers.", "success");
      send.textContent = "Sent";
      textarea.readOnly = true;
      // The dialog stays open on the success so the message is read rather
      // than flashed. Cancel becomes the way out and says so.
      cancel.disabled = false;
      cancel.textContent = "Close";
    } catch (e) {
      // Every message that reaches here was written to be read by a player -
      // js/feedback.js is what turns a status code or a constraint into one.
      setStatus(e?.message || "Your feedback couldn't be sent just now. Try again in a moment.", "error");
      send.textContent = "Send Feedback";
      textarea.readOnly = false;
      cancel.disabled = false;
      // Focus back to the field, because the next thing they do is either edit
      // it or press send again.
      textarea.focus();
    } finally {
      sending = false;
      refresh();
    }
  });

  refresh();
  return body;
}
