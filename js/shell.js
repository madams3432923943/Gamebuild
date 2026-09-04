// App chrome: which screen is showing, which nav tab is lit, and the one modal
// every screen shares.
//
// Extracted so a screen module can reach these without importing main.js -
// which it can't, because main.js imports the screens. Nothing here knows
// anything about basketball; it is the frame the screens hang in.

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const screens = {
  auth: document.getElementById("screen-auth"),
  home: document.getElementById("screen-home"),
  // The hub is sport-neutral; choosing a sport and a mode happens here.
  play: document.getElementById("screen-play"),
  matchupIntro: document.getElementById("screen-matchup-intro"),
  draft: document.getElementById("screen-draft"),
  game: document.getElementById("screen-game"),
  profile: document.getElementById("screen-profile"),
  badges: document.getElementById("screen-badges"),
  squads: document.getElementById("screen-squads"),
};

const NAV_TABS = ["play", "profile", "badges", "squads"];

export function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle("hidden", key !== name);
  }
}

export function setActiveNav(which) {
  for (const tab of NAV_TABS) {
    const el = document.getElementById(`nav-${tab}`);
    const active = tab === which;
    el.classList.toggle("active", active);
    // WHERE YOU ARE, said to the accessibility tree and not only in colour.
    //
    // The active tab was marked by a class, which paints it and announces
    // nothing: a screen reader read all four destinations identically, so the
    // one question a navigation exists to answer - where am I - had no answer.
    // Measured across every screen in the app, this was the only such gap;
    // every control has a name and every field has a label, which is why it is
    // worth fixing rather than filing.
    //
    // `page` rather than `true` because these are destinations within one
    // document, which is what aria-current="page" means. Removed rather than
    // set to "false" on the others: the attribute is meaningful by its
    // presence, and aria-current="false" is a value some readers announce.
    if (active) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  }
}

// ---- Modal ----
// One shell for the draft's position picker, How to Play, the rank ladder and
// every squads dialog. Kept generic (title + body node + optional cancel
// handler) so callers share the same open/close, backdrop-click and Escape
// behaviour instead of each growing its own slightly different version.

const modalBackdrop = document.getElementById("modal-backdrop");
const modalTitleEl = document.getElementById("modal-title");
const modalBodyEl = document.getElementById("modal-body");
const modalCloseBtn = document.getElementById("modal-close");
const modalEl = modalBackdrop.querySelector(".modal");
let onModalDismiss = null;
let modalVariant = null;

/**
 * @param options.variant  a modifier class on the dialog itself, for a modal
 *   whose CONTENT wants a different frame - today only "modal-wide", which the
 *   wardrobe uses because a grid of banner artwork inside 560px gives each
 *   banner 76 pixels to be recognised in. Removed again on close, so the next
 *   modal to open does not inherit the last one's shape.
 */
export function openModal(title, bodyNode, onDismiss, options = {}) {
  modalTitleEl.textContent = title;
  modalBodyEl.innerHTML = "";
  modalBodyEl.appendChild(bodyNode);
  if (modalVariant) modalEl.classList.remove(modalVariant);
  modalVariant = options.variant || null;
  if (modalVariant) modalEl.classList.add(modalVariant);
  onModalDismiss = onDismiss || null;
  modalBackdrop.classList.remove("hidden");
}

export function closeModal({ dismissed = false } = {}) {
  modalBackdrop.classList.add("hidden");
  modalBodyEl.innerHTML = "";
  if (modalVariant) modalEl.classList.remove(modalVariant);
  modalVariant = null;
  const cb = onModalDismiss;
  onModalDismiss = null;
  // A dismissal has to be distinguishable from a choice: abandoning the
  // position picker must put the pending player back, not silently drop him.
  if (dismissed && cb) cb();
}

modalCloseBtn.addEventListener("click", () => closeModal({ dismissed: true }));
modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal({ dismissed: true });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modalBackdrop.classList.contains("hidden")) closeModal({ dismissed: true });
});
