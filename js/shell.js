// App chrome: which screen is showing, which nav tab is lit, and the one modal
// every screen shares.
//
// Extracted so a screen module can reach these without importing main.js -
// which it can't, because main.js imports the screens. Nothing here knows
// anything about basketball; it is the frame the screens hang in.

import { initBrandImages } from "./brand-image.js";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The brand mark and the sign-in lockup are both optional files that degrade
// to plain text. That used to be an inline onerror attribute on each; the
// Content-Security-Policy in index.html blocks those, so it happens here.
initBrandImages();

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
    document.getElementById(`nav-${tab}`).classList.toggle("active", tab === which);
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
let onModalDismiss = null;

export function openModal(title, bodyNode, onDismiss) {
  modalTitleEl.textContent = title;
  modalBodyEl.innerHTML = "";
  modalBodyEl.appendChild(bodyNode);
  onModalDismiss = onDismiss || null;
  modalBackdrop.classList.remove("hidden");
}

export function closeModal({ dismissed = false } = {}) {
  modalBackdrop.classList.add("hidden");
  modalBodyEl.innerHTML = "";
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
