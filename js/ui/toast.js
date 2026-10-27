// A one-line notice that says something happened without asking for anything.
//
// Built for the pick clock: an auto-pick used to land silently, and players
// found people on their roster they had never chosen with nothing to say how
// they got there. Anything that acts on the player's behalf should say so.
//
// One element, reused. A second toast replaces the first rather than stacking,
// because two of these at once means the first is already out of date.

const VISIBLE_MS = 4000;

let toastEl = null;
let hideTimer = null;

function element() {
  if (toastEl && toastEl.isConnected) return toastEl;
  toastEl = document.createElement("div");
  toastEl.className = "app-toast";
  // role=status, not alert: it reports what already happened, and interrupting
  // a screen reader mid-sentence for that would be louder than the event.
  toastEl.setAttribute("role", "status");
  toastEl.setAttribute("aria-live", "polite");
  toastEl.hidden = true;
  document.body.appendChild(toastEl);
  return toastEl;
}

export function showToast(message) {
  const el = element();
  el.textContent = message;
  el.hidden = false;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    el.hidden = true;
  }, VISIBLE_MS);
}
