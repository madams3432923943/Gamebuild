// App controller: wires draft state + engine + profile to the DOM.
// Three modes share these same screens/DOM elements:
//   - "bot": synchronous, client-only (DraftState from draft.js).
//   - "online": async, server-authoritative (Supabase - see online.js).

import { PLAYERS } from "./data.js";
import { buildRecap, buildGameScript } from "./recap.js";
import { DEFAULT_TACTIC, TACTICS, randomTacticChoices } from "./tactics.js";

const TACTIC_IDS = TACTICS.map((t) => t.id);
import { simulateGame, defaultMinutes } from "./engine.js";
import { DraftState, eligibleOpenSlots, worstEligiblePick } from "./draft.js";
import {
  SLOTS,
  STARTER_SLOTS,
  RANKED_SLOTS,
  QUARTER_REVEAL_DELAY_MS,
  QUARTER_TICK_MS,
  DRAFT_REVEAL_DELAY_MS,
  PICK_TIMER_SECONDS,
  TACTIC_TIMER_SECONDS,
  ROTATION_TIMER_SECONDS,
} from "./constants.js";
import {
  loadProfile,
  recordPracticeResult,
  recordDraftPicks,
  setUsername,
  setEquippedBanner,
  setFeaturedBadges,
  FEATURED_BADGE_SLOTS,
} from "./profile.js";
import { getSession, requireSession, signUp, signIn, signOut, USERNAME_PATTERN } from "./supabaseClient.js";
import {
  joinQueue,
  leaveQueue,
  getMatch,
  getVisiblePicks,
  buildVisibleState,
  fetchSquadPlayers,
  submitPick,
  submitSkip,
  simulateMatch,
  getMatchResult,
  getUsername,
  watchMatch,
} from "./online.js";
import {
  renderPositionSelector,
  renderRosterPanel,
  renderPool,
  renderPickTimer,
  renderFullBoxScore,
  renderScoreboard,
  renderProfileScreen,
  renderHomeHeader,
  renderBadgeCollection,
  renderBadgeSportTabs,
  renderBanners,
  renderEquippedBanner,
  renderTacticPicker,
  renderRotationPicker,
  pushPlayHeadline,
  clearPlayFeed,
  buildShotLines,
} from "./ui.js";

// datasetStats for LOCAL (bot/friend) games only - online games are
// simulated server-side by the simulate-match Edge Function, using its own
// copy of the same dataset/engine so a client can't fake a result.
import { computeDatasetStats } from "./engine.js";
const datasetStats = computeDatasetStats(PLAYERS);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const screens = {
  auth: document.getElementById("screen-auth"),
  home: document.getElementById("screen-home"),
  draft: document.getElementById("screen-draft"),
  game: document.getElementById("screen-game"),
  profile: document.getElementById("screen-profile"),
  badges: document.getElementById("screen-badges"),
  squads: document.getElementById("screen-squads"),
};

const NAV_TABS = ["play", "profile", "badges", "squads"];

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle("hidden", key !== name);
  }
}

function setActiveNav(which) {
  for (const tab of NAV_TABS) {
    document.getElementById(`nav-${tab}`).classList.toggle("active", tab === which);
  }
}

function cleanupOnlineWatcher() {
  if (game.online && game.online.stopWatcher) {
    game.online.stopWatcher();
    game.online.stopWatcher = null;
  }
}

// ---- Per-pick countdown timer (shared by local + online draft flows) ----
// Deliberately client-side only - see plan notes on the abandonment gap this
// doesn't cover for a disconnected online opponent.

let pickTimerInterval = null;
const pickTimerEl = document.getElementById("pick-timer");

function cleanupPickTimer() {
  if (pickTimerInterval) {
    clearInterval(pickTimerInterval);
    pickTimerInterval = null;
  }
  if (pickTimerEl) pickTimerEl.textContent = "";
}

/** (Re)starts the countdown from PICK_TIMER_SECONDS. Call exactly once per
 * new turn - never on a re-render of the same turn (e.g. picking a
 * multi-slot-eligible player just re-renders the position selector, it
 * doesn't start a new turn) or the clock would never run out. */
function startPickTimer(onTimeout) {
  cleanupPickTimer();
  let secondsRemaining = PICK_TIMER_SECONDS;
  if (pickTimerEl) renderPickTimer(pickTimerEl, secondsRemaining);
  pickTimerInterval = setInterval(() => {
    secondsRemaining -= 1;
    if (secondsRemaining <= 0) {
      cleanupPickTimer();
      onTimeout();
      return;
    }
    if (pickTimerEl) renderPickTimer(pickTimerEl, secondsRemaining);
  }, 1000);
}

// ---- Modal ----
// One shell for the draft's position picker and How to Play. Kept generic
// (title + body node + optional cancel handler) so both callers share the
// same open/close, backdrop-click and Escape behaviour instead of each
// growing its own slightly different version.

const modalBackdrop = document.getElementById("modal-backdrop");
const modalTitleEl = document.getElementById("modal-title");
const modalBodyEl = document.getElementById("modal-body");
const modalCloseBtn = document.getElementById("modal-close");
let onModalDismiss = null;

function openModal(title, bodyNode, onDismiss) {
  modalTitleEl.textContent = title;
  modalBodyEl.innerHTML = "";
  modalBodyEl.appendChild(bodyNode);
  onModalDismiss = onDismiss || null;
  modalBackdrop.classList.remove("hidden");
}

function closeModal({ dismissed = false } = {}) {
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

/** Position picker: which open slot should this player fill? */
function openSlotPicker(player, slots, onChoose, onCancel) {
  const wrap = document.createElement("div");

  const who = document.createElement("div");
  who.className = "modal-player";
  who.textContent = player.name;
  wrap.appendChild(who);

  const meta = document.createElement("div");
  meta.className = "modal-player-meta";
  meta.textContent = `${player.pos.join(" / ")} · ${player.team} ${player.decade}`;
  wrap.appendChild(meta);

  // Bench spots are interchangeable, so offering five identical "Bench"
  // buttons is noise dressed up as a decision - collapse them to one.
  const benchSlots = slots.filter((s) => s.startsWith("BENCH"));
  const choices = slots
    .filter((s) => !s.startsWith("BENCH"))
    .map((s) => ({ label: s === "6TH" ? "6th Man" : s, slot: s }));
  if (benchSlots.length > 0) {
    choices.push({
      label: benchSlots.length > 1 ? `Bench (${benchSlots.length} open)` : "Bench",
      slot: benchSlots[0],
    });
  }

  const grid = document.createElement("div");
  grid.className = "modal-slot-grid";
  for (const { label, slot } of choices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "modal-slot";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      closeModal();
      onChoose(slot);
    });
    grid.appendChild(btn);
  }
  wrap.appendChild(grid);

  openModal("Where does he play?", wrap, onCancel);
}

const HOW_TO_PLAY = [
  ["The draft", "Every round rolls one team-and-decade squad - say Chicago Bulls 1990s - and both sides draft from that same squad. You are picking against the same options your opponent has, so it comes down to who knows the roster better."],
  ["Naming players", "Under ranked rules there is no visible list: you type a name from memory. Spelling is forgiving, so remembering the player matters more than spelling him. Quick Play shows the whole squad with stats instead."],
  ["Your roster", "Five starters, position-locked, plus five bench spots that take anyone. Bench players cover whichever position needs them, so someone who plays two positions is worth more than a specialist."],
  ["Rotation", "240 minutes to spread across ten players, 10 to 40 each, and starters must play more than the bench. Push someone past 34 and he tires and gives production back, so loading your best five is a trade rather than a free win."],
  ["Gamestyle", "Once both rosters are set you pick one of three gamestyles offered at random. Each one boosts something and pays for it elsewhere; none is simply strongest."],
  ["Modes", "Quick Play is a relaxed five-a-side against the bot. Ranked Practice is the full ranked experience against the bot. Ranked is against a real opponent and is the only mode that moves your record."],
];

function openHowToPlay() {
  const wrap = document.createElement("div");
  for (const [heading, body] of HOW_TO_PLAY) {
    const section = document.createElement("div");
    section.className = "howto-section";
    const h = document.createElement("h4");
    h.textContent = heading;
    const p = document.createElement("p");
    p.textContent = body;
    section.appendChild(h);
    section.appendChild(p);
    wrap.appendChild(section);
  }
  openModal("How to Play", wrap);
}

document.getElementById("btn-how-to-play").addEventListener("click", openHowToPlay);

// ---- Auth screen ----
// The whole app sits behind this: no anonymous play, so a player's record,
// badges and rank always belong to a real account they can come back to.

const navTabs = document.getElementById("nav-tabs");
const authHeading = document.getElementById("auth-heading");
const authSubheading = document.getElementById("auth-subheading");
const inputAuthUsername = document.getElementById("input-auth-username");
const inputAuthPassword = document.getElementById("input-auth-password");
const btnAuthSubmit = document.getElementById("btn-auth-submit");
const btnAuthToggle = document.getElementById("btn-auth-toggle");
const authSwitchLabel = document.getElementById("auth-switch-label");
const authStatusEl = document.getElementById("auth-status");
const signedInAsEl = document.getElementById("signed-in-as");

let authMode = "signin"; // "signin" | "signup"

function setAuthStatus(message, kind) {
  authStatusEl.textContent = message || "";
  authStatusEl.classList.toggle("hidden", !message);
  authStatusEl.classList.toggle("auth-error", kind === "error");
}

function renderAuthMode() {
  const isSignup = authMode === "signup";
  authHeading.textContent = isSignup ? "Create Account" : "Sign In";
  authSubheading.textContent = isSignup
    ? "Pick a username - it's what opponents see on the scoreboard."
    : "Sign in to keep your record, badges, and rank.";
  btnAuthSubmit.textContent = isSignup ? "Create Account" : "Sign In";
  btnAuthToggle.textContent = isSignup ? "Sign in instead" : "Create an account";
  authSwitchLabel.textContent = isSignup ? "Already have an account?" : "New here?";
  inputAuthPassword.autocomplete = isSignup ? "new-password" : "current-password";
  setAuthStatus("");
}

btnAuthToggle.addEventListener("click", () => {
  authMode = authMode === "signup" ? "signin" : "signup";
  renderAuthMode();
});

function showAuthScreen() {
  navTabs.hidden = true;
  renderAuthMode();
  showScreen("auth");
}

const homeHeaderRefs = {
  card: document.getElementById("player-banner"),
  username: document.getElementById("home-username"),
  record: document.getElementById("home-record"),
  featured: document.getElementById("home-featured-badges"),
  rankStrip: document.getElementById("home-rank-strip"),
  equippedBanner: document.getElementById("home-equipped-banner"),
};

/** Called once a session exists: loads the profile, shows the app shell, and
 * stamps the display name the game will use for this player. */
async function enterApp() {
  navTabs.hidden = false;
  setActiveNav("play");
  showScreen("home");
  await refreshHome();
}

/** Re-reads the profile and repaints the home header. Called on entry and
 * after anything that can change the record (a finished game, a rename). */
async function refreshHome() {
  try {
    const profile = await loadProfile();
    game.nameA = profile.username || "Player";
    renderHomeHeader(homeHeaderRefs, profile);
    renderEquippedBanner(homeHeaderRefs.equippedBanner, profile);
  } catch (e) {
    console.error("Failed to load profile:", e);
    game.nameA = "Player";
  }
  signedInAsEl.textContent = game.nameA;
}

btnAuthSubmit.addEventListener("click", async () => {
  const username = inputAuthUsername.value.trim();
  const password = inputAuthPassword.value;

  if (!username || !password) {
    setAuthStatus("Username and password are both required.", "error");
    return;
  }
  if (authMode === "signup" && !USERNAME_PATTERN.test(username)) {
    setAuthStatus("Usernames are 3-20 characters: letters, numbers or underscores.", "error");
    return;
  }

  btnAuthSubmit.disabled = true;
  setAuthStatus(authMode === "signup" ? "Creating your account…" : "Signing in…");

  try {
    if (authMode === "signup") {
      const session = await signUp(username, password);
      // No session means the project still has email confirmation enabled,
      // which can't work for username accounts - there's no real inbox to
      // confirm from. Say so plainly instead of leaving them stuck.
      if (!session) {
        setAuthStatus(
          "Account made, but this project still has email confirmation turned on - turn it off in Supabase (Authentication > Sign In / Providers > Email) for username logins to work.",
          "error"
        );
        return;
      }
      await setUsername(username);
    } else {
      await signIn(username, password);
    }
    inputAuthPassword.value = "";
    await enterApp();
  } catch (e) {
    setAuthStatus(e.message || "That didn't work. Try again.", "error");
  } finally {
    btnAuthSubmit.disabled = false;
  }
});

for (const el of [inputAuthPassword, inputAuthUsername]) {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnAuthSubmit.click();
  });
}

document.getElementById("nav-signout").addEventListener("click", async () => {
  cleanupOnlineWatcher();
  cleanupPickTimer();
  try {
    await signOut();
  } catch (e) {
    console.error("Sign out failed:", e);
  }
  inputAuthPassword.value = "";
  showAuthScreen();
});

// ---- Home screen ----

const modeRadios = document.querySelectorAll('input[name="mode"]');
const btnStartDraft = document.getElementById("btn-start-draft");
const btnCancelSearch = document.getElementById("btn-cancel-search");
const searchStatusEl = document.getElementById("search-status");

// Three experiences over two axes: who you're playing (bot / online) and
// which ruleset applies. "easy" shows the whole squad with stats and no
// clock; "strict" is the ranked ruleset - type the name from memory, no
// stats, pick timer running. Only online play touches your rank; bot games
// are practice by definition.
const MODE_CONFIG = {
  "practice-easy": {
    mode: "bot",
    ruleset: "easy",
    hint: "Quick Play against the bot with every player and their stats on screen. Doesn't affect your rank.",
  },
  "practice-hard": {
    mode: "bot",
    ruleset: "strict",
    hint: "Ranked Practice: type names from memory, no stats, pick clock running, then set your rotation and pick a gamestyle - the same steps Online Ranked will ask for. Doesn't affect your rank.",
  },
  online: {
    mode: "online",
    ruleset: "strict",
    hint: "Ranked: a real opponent, no stats, pick clock on both sides. Wins and losses count toward your rank.",
  },
};

const modeHintEl = document.getElementById("mode-hint");

for (const radio of modeRadios) {
  radio.addEventListener("change", renderModeChoice);
}

function getMode() {
  return [...modeRadios].find((r) => r.checked).value;
}

function currentModeConfig() {
  return MODE_CONFIG[getMode()] || MODE_CONFIG["practice-easy"];
}

function renderModeChoice() {
  modeHintEl.textContent = currentModeConfig().hint;
}

renderModeChoice();

let onlineSearchActive = false;

async function startOnlineSearch() {
  onlineSearchActive = true;
  btnStartDraft.disabled = true;
  btnCancelSearch.classList.remove("hidden");
  searchStatusEl.classList.remove("hidden");
  searchStatusEl.innerHTML = '<span class="search-spinner"></span> Searching for an opponent…';

  try {
    while (onlineSearchActive) {
      const res = await joinQueue();
      if (res.status === "matched") {
        await enterOnlineMatch(res.match_id);
        return;
      }
      await sleep(2000);
    }
  } catch (e) {
    searchStatusEl.textContent = "Couldn't reach matchmaking: " + e.message;
  } finally {
    if (onlineSearchActive === false) {
      btnStartDraft.disabled = false;
      btnCancelSearch.classList.add("hidden");
      searchStatusEl.classList.add("hidden");
    }
  }
}

btnCancelSearch.addEventListener("click", async () => {
  onlineSearchActive = false;
  btnStartDraft.disabled = false;
  btnCancelSearch.classList.add("hidden");
  searchStatusEl.classList.add("hidden");
  try {
    await leaveQueue();
  } catch (e) {
    console.error(e);
  }
});

btnStartDraft.addEventListener("click", async () => {
  const config = currentModeConfig();
  cleanupOnlineWatcher();

  game.ruleset = config.ruleset;

  if (config.mode === "online") {
    startOnlineSearch();
    return;
  }

  game.mode = config.mode;
  game.nameB = "Bot";
  startDraft();
});

/** Every tab leaves whatever was running behind (a live match poller, a pick
 * clock) before switching, so no screen keeps ticking off-screen. */
function goToTab(tab, onArrive) {
  cleanupOnlineWatcher();
  cleanupPickTimer();
  cleanupTacticTimer();
  cleanupRotationTimer();
  setActiveNav(tab);
  onArrive();
}

document.getElementById("btn-brand").addEventListener("click", () => {
  goToTab("play", () => {
    showScreen("home");
    refreshHome();
  });
});
document.getElementById("nav-play").addEventListener("click", () => {
  goToTab("play", () => {
    showScreen("home");
    refreshHome();
  });
});
document.getElementById("nav-profile").addEventListener("click", () => {
  goToTab("profile", openProfileScreen);
});
document.getElementById("nav-badges").addEventListener("click", () => {
  goToTab("badges", openBadgesScreen);
});
document.getElementById("nav-squads").addEventListener("click", () => {
  goToTab("squads", () => showScreen("squads"));
});

// ---- Draft screen (shared DOM for all three modes) ----

const rosterPanelA = document.getElementById("roster-panel-a");
const rosterPanelB = document.getElementById("roster-panel-b");
const poolSearch = document.getElementById("pool-search");
const poolList = document.getElementById("pool-list");
const positionSelectorEl = document.getElementById("position-selector");
const draftRoundLabel = document.getElementById("draft-round-label");
const squadBannerTeam = document.getElementById("squad-banner-team");
const squadBannerDecade = document.getElementById("squad-banner-decade");
const draftTurnBanner = document.getElementById("draft-turn-banner");

const game = {
  mode: "bot",
  nameA: "Player 1",
  nameB: "Bot",
  draft: null,
  round: { needNewSquad: true, resolved: {}, activeSide: "A", pendingPlayer: null, pendingSlots: {} },
  roundNumber: 0,
  ruleset: "easy",
  online: null,
};

// ---- Bot draft flow ----
// Side A is always the human here and side B is always the bot. These stay
// as functions (rather than inlined constants) because the round loop in
// advanceDraft is written against "which sides still need resolving",
// which is what let the same loop drive pass-and-play before it was
// removed - and is what an online-style second human would need again.

function humanSides() {
  return ["A"];
}
function botSides() {
  return ["B"];
}
function rosterFor(side) {
  return side === "A" ? game.draft.rosterA : game.draft.rosterB;
}
function nameFor(side) {
  return side === "A" ? game.nameA : game.nameB;
}
function pendingSlotsFor(side) {
  const slot = game.round.pendingSlots[side];
  return slot ? [slot] : [];
}

const knowledgeHintEl = document.getElementById("knowledge-hint");
const tacticPhaseEl = document.getElementById("tactic-phase");
const tacticGridEl = document.getElementById("tactic-grid");
const tacticPhaseHintEl = document.getElementById("tactic-phase-hint");
const draftPoolPanel = document.getElementById("draft-pool-panel");
const btnPlayGame = document.getElementById("btn-play-game");
const rotationPhaseEl = document.getElementById("rotation-phase");
const rotationGridEl = document.getElementById("rotation-grid");
const rotationTotalEl = document.getElementById("rotation-total");
const rotationPhaseHintEl = document.getElementById("rotation-phase-hint");
const btnConfirmRotation = document.getElementById("btn-confirm-rotation");

// The game plan is chosen AFTER the draft, as a final timed round: you should
// be picking how to play the team you actually ended up with, not guessing at
// a style before you know who you'll get. Every game offers 3 of the 10
// styles at random, so selectedTactic defaults to whichever is first in that
// game's offer rather than a fixed id that might not even be on offer.
let offeredTactics = [TACTICS.find((t) => t.id === DEFAULT_TACTIC)];
let selectedTactic = DEFAULT_TACTIC;
let tacticTimerInterval = null;

function cleanupTacticTimer() {
  if (tacticTimerInterval) {
    clearInterval(tacticTimerInterval);
    tacticTimerInterval = null;
  }
}

function renderTactics() {
  renderTacticPicker(tacticGridEl, offeredTactics, selectedTactic, (id) => {
    selectedTactic = id;
    renderTactics();
  });
}

/** Final round: both rosters are set, 45 seconds to commit to a plan. Running
 * out doesn't punish you - it locks in whatever is highlighted - because the
 * timer exists to keep a match moving, not to tax indecision. */
function startTacticPhase(onConfirm) {
  cleanupPickTimer();
  cleanupTacticTimer();
  offeredTactics = randomTacticChoices(3);
  selectedTactic = offeredTactics[0].id;
  renderTactics();

  draftPoolPanel.classList.add("hidden");
  tacticPhaseEl.classList.remove("hidden");
  pickTimerEl.hidden = false;

  let remaining = TACTIC_TIMER_SECONDS;
  renderPickTimer(pickTimerEl, remaining);
  tacticTimerInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      cleanupTacticTimer();
      confirm();
      return;
    }
    renderPickTimer(pickTimerEl, remaining);
  }, 1000);

  function confirm() {
    cleanupTacticTimer();
    tacticPhaseEl.classList.add("hidden");
    draftPoolPanel.classList.remove("hidden");
    pickTimerEl.hidden = true;
    pickTimerEl.textContent = "";
    btnPlayGame.onclick = null;
    onConfirm();
  }

  btnPlayGame.onclick = confirm;
}

// Rotation phase: minutes-per-player, shared by Offline Ranked Practice (6
// slots) and (later) Online Ranked. Only shown under the "strict" ruleset -
// Quick Play stays a no-strategy, no-clock, just-play-it experience. A
// rotationMinutes of null means "use the engine's default fixed split," so
// every mode that never enters this phase behaves exactly as before.
let rotationMinutes = null;
let rotationTimerInterval = null;

function cleanupRotationTimer() {
  if (rotationTimerInterval) {
    clearInterval(rotationTimerInterval);
    rotationTimerInterval = null;
  }
}

// Opening split before you touch anything - a conventional starter/backup
// share that already sums to each position's full 48 minutes, so the
// rotation screen starts valid rather than asking you to make it valid.
// Shares the same constants the engine falls back to, so an untouched
// rotation simulates identically to no rotation at all.

/** Between draft-complete and the gamestyle pick in Ranked Practice: assign
 * minutes across your roster before choosing how to play them. Timing out
 * locks in whatever's currently assigned, same philosophy as the tactic
 * timer - it keeps the match moving, it doesn't punish indecision. */
function startRotationPhase(roster, slots, onConfirm) {
  cleanupPickTimer();
  cleanupRotationTimer();
  rotationMinutes = defaultMinutes(roster);
  // Confirm stays locked until the whole 240 is spent. Leaving minutes on the
  // table is never a real choice - it just fields a weaker team - so it's
  // blocked rather than warned about.
  renderRotationPicker(rotationGridEl, roster, rotationMinutes, rotationTotalEl, slots, (valid) => {
    btnConfirmRotation.disabled = !valid;
  });

  draftPoolPanel.classList.add("hidden");
  rotationPhaseEl.classList.remove("hidden");
  pickTimerEl.hidden = false;

  let remaining = ROTATION_TIMER_SECONDS;
  renderPickTimer(pickTimerEl, remaining);
  rotationTimerInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      cleanupRotationTimer();
      confirm();
      return;
    }
    renderPickTimer(pickTimerEl, remaining);
  }, 1000);

  function confirm() {
    cleanupRotationTimer();
    rotationPhaseEl.classList.add("hidden");
    pickTimerEl.hidden = true;
    pickTimerEl.textContent = "";
    btnConfirmRotation.onclick = null;
    onConfirm();
  }

  btnConfirmRotation.onclick = confirm;
}

/** The draft board reads differently under each ruleset, so the search box
 * and its hint have to say which game is actually being played. */
function applyRulesetToDraftUI() {
  const easy = game.ruleset === "easy";
  poolSearch.placeholder = easy ? "Filter this squad…" : "Type a player's name from memory…";
  knowledgeHintEl.textContent = easy
    ? "Practice mode — full squad and stats shown, no clock."
    : "No player list shown — draft on knowledge alone. Type 3+ letters to search.";
  pickTimerEl.hidden = easy;
}

// Squads from the last couple of games. A fresh DraftState avoids these when
// it can, so back-to-back games don't keep rolling the same teams - the
// single most common complaint about the draft feeling samey.
const RECENT_SQUAD_MEMORY = 12;
let recentSquadIds = [];

function rememberSquad(squadId) {
  if (!squadId) return;
  recentSquadIds = [squadId, ...recentSquadIds.filter((id) => id !== squadId)].slice(0, RECENT_SQUAD_MEMORY);
}

// Quick Play (easy ruleset) is a straight 5-slot draft - no bench at all.
// Ranked Practice drafts the full 10-man ranked roster, two per position,
// because its whole job is to rehearse Online Ranked; drafting a different
// roster shape than the mode it prepares you for defeats the point.
//
// This only governs local drafts: the Start Draft handler returns into
// startOnlineSearch() before reaching startDraft(), so online play keeps its
// own (still 6-slot) path until the ranked backend lands.
function slotsForRuleset(ruleset) {
  return ruleset === "easy" ? STARTER_SLOTS : RANKED_SLOTS;
}

function startDraft() {
  cleanupPickTimer();
  cleanupTacticTimer();
  cleanupRotationTimer();
  tacticPhaseEl.classList.add("hidden");
  rotationPhaseEl.classList.add("hidden");
  rotationMinutes = null;
  draftPoolPanel.classList.remove("hidden");
  applyRulesetToDraftUI();
  game.draft = new DraftState(PLAYERS, recentSquadIds, slotsForRuleset(game.ruleset));
  game.round = { needNewSquad: true, resolved: {}, activeSide: "A", pendingPlayer: null, pendingSlots: {} };
  game.roundNumber = 0;
  poolSearch.value = "";
  showScreen("draft");
  advanceDraft();
}

/** Rolls squads and auto-resolves bot/no-valid-pick sides until either the
 * draft is complete, a human decision is genuinely required, or a round
 * has fully resolved and needs its reveal animation played. */
function advanceDraft() {
  const draft = game.draft;

  if (draft.isComplete()) {
    renderDraftComplete();
    return;
  }

  if (game.round.needNewSquad) {
    const rolled = draft.rollNextSquad();
    rememberSquad(rolled && rolled.id);
    game.roundNumber += 1;
    game.round.needNewSquad = false;
    game.round.resolved = {};
    game.round.pendingSlots = {};
  }

  for (const side of botSides()) {
    if (!game.round.resolved[side]) {
      const choice = draft.botAutoPick(side);
      game.round.resolved[side] = true;
      if (choice) game.round.pendingSlots[side] = choice.slot;
    }
  }

  const pendingHuman = humanSides().find((s) => !game.round.resolved[s]);
  if (pendingHuman) {
    if (draft.hasValidPick(rosterFor(pendingHuman))) {
      game.round.activeSide = pendingHuman;
      game.round.pendingPlayer = null;
      poolSearch.value = "";
      if (game.ruleset !== "easy") startPickTimer(handleLocalTimeout);
      renderDraftRound();
      return;
    }
    game.round.resolved[pendingHuman] = true;
    advanceDraft();
    return;
  }

  if (Object.keys(game.round.pendingSlots).length === 0) {
    game.round.needNewSquad = true;
    advanceDraft();
    return;
  }

  renderRoundReveal();
  setTimeout(() => {
    game.round.needNewSquad = true;
    advanceDraft();
  }, DRAFT_REVEAL_DELAY_MS);
}

function renderDraftRound() {
  const draft = game.draft;
  const side = game.round.activeSide;
  const roster = rosterFor(side);

  draftRoundLabel.textContent = `Round ${game.roundNumber}`;
  squadBannerTeam.textContent = draft.currentSquad.team;
  squadBannerDecade.textContent = draft.currentSquad.decade;
  draftTurnBanner.textContent = game.mode === "bot" ? "Your Pick" : `${nameFor(side)}'s Pick`;
  poolSearch.hidden = false;

  const pending = game.round.pendingPlayer;
  const eligibleForPending = pending ? eligibleOpenSlots(pending, roster, draft.slots) : null;

  renderPositionSelector(positionSelectorEl, roster, eligibleForPending, (slot) => {
    finalizePick(game.round.pendingPlayer, slot);
  }, draft.slots);

  renderPoolForCurrentState();

  renderRosterPanel(rosterPanelA, draft.rosterA, game.nameA, side === "A", { pendingSlots: pendingSlotsFor("A"), slots: draft.slots });
  renderRosterPanel(rosterPanelB, draft.rosterB, game.nameB, side === "B", { pendingSlots: pendingSlotsFor("B"), slots: draft.slots });
}

function renderPoolForCurrentState() {
  const draft = game.draft;
  const side = game.round.activeSide;
  const pendingName = game.round.pendingPlayer ? game.round.pendingPlayer.name : null;
  renderPool(poolList, draft.currentSquad, poolSearch.value, rosterFor(side), pendingName, onPoolPick, PLAYERS, game.ruleset, draft.slots);
}

function onPoolPick(player) {
  const roster = rosterFor(game.round.activeSide);
  const slots = eligibleOpenSlots(player, roster, game.draft.slots);
  if (slots.length === 1) {
    finalizePick(player, slots[0]);
    return;
  }
  // More than one slot fits, so ask - in a popup rather than by re-rendering
  // the board and hoping the position strip is noticed. Dismissing puts the
  // player back rather than dropping the pick.
  game.round.pendingPlayer = player;
  renderDraftRound();
  openSlotPicker(
    player,
    slots,
    (slot) => finalizePick(player, slot),
    () => {
      game.round.pendingPlayer = null;
      renderDraftRound();
    }
  );
}

function finalizePick(player, slot) {
  cleanupPickTimer();
  const side = game.round.activeSide;
  game.draft.makePick(side, player, slot);
  game.round.resolved[side] = true;
  game.round.pendingSlots[side] = slot;
  game.round.pendingPlayer = null;
  advanceDraft();
}

/** Resolves a turn without a pick. There's no longer a Skip button - this
 * is only reached when the rolled squad has no player who can legally fill
 * any of your open slots, so there is genuinely nothing to choose. */
function skipLocalTurn() {
  cleanupPickTimer();
  game.round.resolved[game.round.activeSide] = true;
  game.round.pendingPlayer = null;
  advanceDraft();
}

/** Pick-timer timeout for a local human turn: auto-picks the worst eligible
 * (player, slot) combo through the exact same path a manual pick uses, or
 * resolves the turn pickless if nothing at all is eligible. */
function handleLocalTimeout() {
  const draft = game.draft;
  const side = game.round.activeSide;
  const combo = worstEligiblePick(draft.currentSquad, rosterFor(side), draft.slots);
  if (combo) {
    finalizePick(combo.player, combo.slot);
  } else {
    skipLocalTurn();
  }
}

function renderRoundReveal() {
  cleanupPickTimer();
  const draft = game.draft;
  draftTurnBanner.textContent = "Revealing picks…";
  poolSearch.hidden = true;
  positionSelectorEl.innerHTML = "";
  poolList.innerHTML = "";

  renderRosterPanel(rosterPanelA, draft.rosterA, game.nameA, false, { revealSlots: pendingSlotsFor("A"), slots: draft.slots });
  renderRosterPanel(rosterPanelB, draft.rosterB, game.nameB, false, { revealSlots: pendingSlotsFor("B"), slots: draft.slots });
}

function renderDraftComplete() {
  cleanupPickTimer();
  const draft = game.draft;
  draftRoundLabel.textContent = "Draft complete";
  squadBannerTeam.textContent = "Rosters set";
  squadBannerDecade.textContent = "";
  draftTurnBanner.textContent = "Both rosters are set.";
  poolSearch.hidden = true;
  positionSelectorEl.innerHTML = "";

  renderRosterPanel(rosterPanelA, draft.rosterA, game.nameA, false, { slots: draft.slots });
  renderRosterPanel(rosterPanelB, draft.rosterB, game.nameB, false, { slots: draft.slots });

  poolList.innerHTML = "";

  // Quick Play stays the fast, no-strategy experience: straight to the sim.
  // Ranked Practice adds the two strict-ruleset phases - rotation, then
  // gamestyle - since it's meant to rehearse exactly what Online Ranked asks
  // for, using a bot opponent instead of a real one.
  if (game.ruleset !== "strict") {
    rotationMinutes = null;
    runLocalSimulation();
    return;
  }

  draftTurnBanner.textContent = "Set your rotation";
  rotationPhaseHintEl.textContent =
    `240 minutes to spend, 10-40 each. Starters play more than the bench. ` +
    `Lower someone to free minutes before raising someone else.`;
  startRotationPhase(draft.rosterA, draft.slots, () => {
    draftTurnBanner.textContent = "Final round — set your game plan";
    tacticPhaseHintEl.textContent = `${TACTIC_TIMER_SECONDS} seconds to choose how this team plays.`;
    startTacticPhase(runLocalSimulation);
  });
}

// ---- Online draft flow ----

async function enterOnlineMatch(matchId) {
  btnStartDraft.disabled = false;
  btnCancelSearch.classList.add("hidden");
  searchStatusEl.classList.add("hidden");

  game.mode = "online";
  const session = await requireSession();
  const match = await getMatch(matchId);
  const mySide = match.player_a === session.user.id ? "A" : "B";
  const oppUserId = mySide === "A" ? match.player_b : match.player_a;
  const oppUsername = await getUsername(oppUserId);

  game.online = {
    matchId,
    mySide,
    oppUsername,
    pendingPlayer: null,
    myRoster: {},
    oppRoster: {},
    currentSquad: null,
    stopWatcher: null,
  };

  applyRulesetToDraftUI();
  showScreen("draft");
  await renderOnlineDraftRound(match);
  game.online.stopWatcher = watchMatch(matchId, onOnlineMatchChange);
}

async function onOnlineMatchChange(match) {
  if (match.status === "ready_to_simulate" || match.status === "complete") {
    cleanupOnlineWatcher();
    cleanupPickTimer();
    await runOnlineSimulationFlow(match.id);
    return;
  }
  await renderOnlineDraftRound(match);
}

async function renderOnlineDraftRound(match) {
  const o = game.online;
  if (!o) return;

  draftRoundLabel.textContent = `Round ${match.round_number}`;
  squadBannerTeam.textContent = match.current_squad_team;
  squadBannerDecade.textContent = match.current_squad_decade;
  draftTurnBanner.textContent = "Your Pick";
  poolSearch.hidden = false;
  poolSearch.value = "";
  o.pendingPlayer = null;

  const [players, picks] = await Promise.all([
    fetchSquadPlayers(match.current_squad_team, match.current_squad_decade),
    getVisiblePicks(o.matchId),
  ]);
  o.currentSquad = { team: match.current_squad_team, decade: match.current_squad_decade, players };

  const { rosterA, rosterB } = buildVisibleState(picks, match.round_number);
  o.myRoster = o.mySide === "A" ? rosterA : rosterB;
  o.oppRoster = o.mySide === "A" ? rosterB : rosterA;

  if (game.ruleset !== "easy") startPickTimer(handleOnlineTimeout);
  renderOnlinePositionAndPool();
  renderRosterPanel(rosterPanelA, o.myRoster, "You", true);
  renderRosterPanel(rosterPanelB, o.oppRoster, o.oppUsername, false);
}

function renderOnlinePositionAndPool() {
  const o = game.online;
  const eligibleForPending = o.pendingPlayer ? eligibleOpenSlots(o.pendingPlayer, o.myRoster) : null;
  renderPositionSelector(positionSelectorEl, o.myRoster, eligibleForPending, (slot) => {
    finalizeOnlinePick(o.pendingPlayer, slot);
  });
  const pendingName = o.pendingPlayer ? o.pendingPlayer.name : null;
  renderPool(poolList, o.currentSquad, poolSearch.value, o.myRoster, pendingName, onOnlinePoolPick, PLAYERS, game.ruleset);
}

function onOnlinePoolPick(player) {
  const o = game.online;
  const slots = eligibleOpenSlots(player, o.myRoster);
  if (slots.length === 1) {
    finalizeOnlinePick(player, slots[0]);
  } else {
    o.pendingPlayer = player;
    renderOnlinePositionAndPool();
  }
}

/** Pick-timer timeout for an online turn: auto-picks the worst eligible
 * combo through the exact same submitPick path a manual pick uses, or
 * skips if nothing is eligible - same server-authoritative validation
 * either way, the server can't tell (and shouldn't need to) whether a pick
 * was manual or a timeout auto-pick. */
async function handleOnlineTimeout() {
  const o = game.online;
  if (!o || !o.currentSquad) return;
  const combo = worstEligiblePick(o.currentSquad, o.myRoster);
  if (combo) {
    await finalizeOnlinePick(combo.player, combo.slot);
  } else {
    await onlineSkip();
  }
}

async function finalizeOnlinePick(player, slot) {
  cleanupPickTimer();
  const o = game.online;
  o.pendingPlayer = null;
  draftTurnBanner.textContent = "Locking in pick…";
  poolSearch.hidden = true;
  positionSelectorEl.innerHTML = "";
  poolList.innerHTML = "";

  try {
    await submitPick(o.matchId, player, slot);
    draftTurnBanner.textContent = "Waiting for opponent…";
  } catch (e) {
    draftTurnBanner.textContent = "That pick didn't go through (" + e.message + ") - refreshing round.";
    const match = await getMatch(o.matchId);
    await renderOnlineDraftRound(match);
  }
}

async function onlineSkip() {
  cleanupPickTimer();
  const o = game.online;
  draftTurnBanner.textContent = "Skipping…";
  try {
    await submitSkip(o.matchId);
    draftTurnBanner.textContent = "Waiting for opponent…";
  } catch (e) {
    const match = await getMatch(o.matchId);
    await renderOnlineDraftRound(match);
  }
}

poolSearch.addEventListener("input", () => {
  if (game.mode === "online") {
    if (game.online && game.online.currentSquad) renderOnlinePositionAndPool();
  } else if (game.draft && game.draft.currentSquad) {
    renderPoolForCurrentState();
  }
});

// ---- Game screen (live scoreboard + final box score) - shared by all modes ----

const liveScoreboard = document.getElementById("live-scoreboard");
const finalBanner = document.getElementById("final-banner");
const mvpCallout = document.getElementById("mvp-callout");
const gameRecapEl = document.getElementById("game-recap");
const playFeedEl = document.getElementById("play-feed");
const recapHeadlineEl = document.getElementById("recap-headline");
const recapDetailEl = document.getElementById("recap-detail");
const fullBoxScore = document.getElementById("full-box-score");
const btnToProfile = document.getElementById("btn-to-profile");
const btnPlayAgain = document.getElementById("btn-play-again");

const REGULATION_PERIODS = 4;

/** Distributes a team's true final score across periods proportionally to
 * that period's raw simulated share, so the live reveal ends up exactly at
 * the real final score while still showing quarter-to-quarter variance. */
/** Points scored in each period. The engine reconciles its period lines onto
 * the finished box score, so these already add up to the final total - this
 * used to rescale them to force that, which quietly made the scoreboard the
 * only consumer showing correct figures while the live box score and the
 * recap read the unreconciled numbers underneath. */
function computeDisplayPeriodScores(quarterBoxScores, finalScore, teamKey) {
  return quarterBoxScores.map((q) => Object.values(q[teamKey]).reduce((sum, line) => sum + line.pts, 0));
}

/** Plays the live quarter-by-quarter reveal and final box score for any
 * already-computed result (local simulateGame() output or a normalized
 * server result), then calls onComplete() once everything is on screen. */
function playOutResult({ result, labelA, labelB, rosterA, rosterB, minutesA, minutesB, onComplete }) {
  finalBanner.classList.add("hidden");
  gameRecapEl.classList.add("hidden");
  mvpCallout.classList.add("hidden");
  fullBoxScore.classList.add("hidden");
  btnToProfile.classList.add("hidden");
  btnPlayAgain.classList.add("hidden");
  showScreen("game");

  const deltaA = computeDisplayPeriodScores(result.quarterBoxScores, result.teamScoreA, "a");
  const deltaB = computeDisplayPeriodScores(result.quarterBoxScores, result.teamScoreB, "b");

  const periodsSoFar = [];
  let runningA = 0;
  let runningB = 0;
  let i = 0;

  // Cumulative per-slot totals, grown as each period is revealed, so the live
  // box score builds through the game instead of appearing finished.
  const scoreTickIntervals = [];
  const liveTotals = { a: {}, b: {} };
  for (const slot of Object.keys(rosterA)) liveTotals.a[slot] = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0 };
  for (const slot of Object.keys(rosterB)) liveTotals.b[slot] = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0 };

  clearPlayFeed(playFeedEl);
  // One box score for the whole game: the same table fills in live as periods
  // are revealed, then gains shooting splits at the final buzzer. Showing a
  // reduced live table alongside a separate full one meant two box scores on
  // screen saying different things.
  fullBoxScore.classList.remove("hidden");
  renderFullBoxScore(fullBoxScore, rosterA, liveTotals.a, labelA, rosterB, liveTotals.b, labelB, null, null, minutesA, minutesB);
  renderScoreboard(liveScoreboard, labelA, labelB, periodsSoFar, REGULATION_PERIODS, 0, 0, "Tip-off", true);
  pushPlayHeadline(playFeedEl, `${labelA} vs ${labelB} — tip-off`);

  // The player each side's memo named last period. A team's best quarter is
  // usually its best player's quarter, so without this the feed reads as the
  // same two names four times running.
  const lastNamed = { a: null, b: null };

  /** The single best storyline for one team in one period - always returns
   * something (falling back to a modest phrasing below the "hot" threshold)
   * so every team gets exactly one memo per period, never zero and never a
   * pile-up on whichever side happened to run hottest. */
  function bestTeamLineForPeriod(periodIndex, key, roster) {
    const q = result.quarterBoxScores[periodIndex];
    if (!q || !q[key]) return null;
    const options = [];
    for (const slot of SLOTS) {
      const line = q[key][slot];
      const player = roster[slot];
      if (!line || !player) continue;
      // Tuned against real per-quarter output: a starter averages roughly
      // 4-6 points a quarter, so 8+ is a genuinely hot stretch. Below that
      // threshold the same category still describes the quarter, just in a
      // more matter-of-fact voice ("led with" instead of "pours in").
      const candidates = [
        { value: line.pts, min: 8, hot: (n, v) => `${n} pours in ${Math.round(v)}`, mild: (n, v) => `${n} led with ${Math.round(v)} points` },
        { value: line.reb, min: 4.5, hot: (n, v) => `${n} owns the glass — ${Math.round(v)} boards`, mild: (n, v) => `${n} crashed the boards for ${Math.round(v)} rebounds` },
        { value: line.ast, min: 3.5, hot: (n, v) => `${n} carving it up, ${Math.round(v)} dimes`, mild: (n, v) => `${n} ran the offense with ${Math.round(v)} assists` },
        { value: line.blk, min: 1.8, hot: (n, v) => `${n} shutting the rim down`, mild: (n, v) => `${n} chipped in on D` },
      ];
      let bestForPlayer = null;
      for (const c of candidates) {
        if (c.value <= 0) continue;
        const weight = c.value / c.min;
        if (!bestForPlayer || weight > bestForPlayer.weight) {
          bestForPlayer = {
            weight,
            name: player.name,
            text: weight >= 1 ? c.hot(player.name, c.value) : c.mild(player.name, c.value),
          };
        }
      }
      if (bestForPlayer) options.push(bestForPlayer);
    }
    if (options.length === 0) return null;
    options.sort((a, b) => b.weight - a.weight);
    // Prefer a name we didn't just use, unless repeating is the only option
    // or the repeat is a genuinely dominant quarter worth calling twice.
    const fresh = options.find((o) => o.name !== lastNamed[key]);
    return fresh && options[0].weight < 1.6 ? fresh : options[0];
  }

  /** Exactly one memo per team per period - the feed talks about both
   * sides every quarter, not whichever team happened to run hot. */
  function announcePeriod(periodIndex, label) {
    for (const [key, roster, teamLabel] of [
      ["a", rosterA, labelA],
      ["b", rosterB, labelB],
    ]) {
      const best = bestTeamLineForPeriod(periodIndex, key, roster);
      if (best) {
        lastNamed[key] = best.name;
        pushPlayHeadline(playFeedEl, `${best.text} in ${label}`, best.weight >= 1 ? "hot" : "");
      } else {
        pushPlayHeadline(playFeedEl, `${teamLabel} scraped by in ${label}`, "");
      }
    }
  }

  /** Animates the scoreboard from one period's totals to the next. */
  function tickScoreTo(fromA2, fromB2, toA, toB, periods, remaining, duringLabel, doneLabel) {
    const started = Date.now();
    const tick = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / QUARTER_TICK_MS);
      const eased = 1 - Math.pow(1 - t, 2);
      const done = t >= 1;
      renderScoreboard(
        liveScoreboard,
        labelA,
        labelB,
        periods,
        remaining,
        Math.round(fromA2 + (toA - fromA2) * eased),
        Math.round(fromB2 + (toB - fromB2) * eased),
        done ? doneLabel : duringLabel,
        true
      );
      if (done) clearInterval(tick);
    }, 60);
    scoreTickIntervals.push(tick);
  }

  function step() {
    if (i >= deltaA.length) {
      finish();
      return;
    }
    const fromA = runningA;
    const fromB = runningB;
    const isOt = result.quarterBoxScores[i].overtime;
    const label = isOt ? `OT${i - REGULATION_PERIODS}` : `Q${i + 1}`;
    periodsSoFar.push({ label, a: deltaA[i], b: deltaB[i] });
    runningA += deltaA[i];
    runningB += deltaB[i];

    for (const key of ["a", "b"]) {
      const period = result.quarterBoxScores[i][key];
      for (const slot of Object.keys(liveTotals[key])) {
        const src = period[slot];
        if (!src) continue;
        for (const stat of ["pts", "reb", "ast", "stl", "blk", "tov"]) liveTotals[key][slot][stat] += src[stat];
      }
    }

    const regulationPlayed = periodsSoFar.filter((p) => !p.label.startsWith("OT")).length;
    const periodsRemaining = Math.max(0, REGULATION_PERIODS - regulationPlayed);

    // Climb to the new totals instead of snapping to them, so a quarter reads
    // as being played rather than reported.
    tickScoreTo(
      fromA,
      fromB,
      runningA,
      runningB,
      periodsSoFar,
      periodsRemaining,
      `${label} in progress`,
      `End of ${label}`
    );
    renderFullBoxScore(fullBoxScore, rosterA, liveTotals.a, labelA, rosterB, liveTotals.b, labelB, null, null, minutesA, minutesB);
    announcePeriod(i, label);

    i += 1;
    setTimeout(step, QUARTER_REVEAL_DELAY_MS);
  }

  function finish() {
    for (const t of scoreTickIntervals) clearInterval(t);
    renderScoreboard(liveScoreboard, labelA, labelB, periodsSoFar, 0, runningA, runningB, "Final", false);

    // The broadcast's closing line: not why the winner won (the recap below
    // covers that), just the shape the game itself took.
    pushPlayHeadline(playFeedEl, buildGameScript(periodsSoFar, labelA, labelB), "final");

    const winnerName = result.winner === "A" ? labelA : labelB;
    finalBanner.textContent = `${winnerName} wins, ${result.teamScoreA}-${result.teamScoreB}${
      result.overtimePeriods > 0 ? ` (${result.overtimePeriods}OT)` : ""
    }`;
    finalBanner.classList.remove("hidden");

    // Shot splits are computed once here and shared by the box score and the
    // recap, so both describe the same night.
    const shotsA = buildShotLines(rosterA, result.boxA);
    const shotsB = buildShotLines(rosterB, result.boxB);

    // Why it went that way, not just what the score was.
    const recap = buildRecap(result, rosterA, rosterB, labelA, labelB, shotsA, shotsB);
    recapHeadlineEl.textContent = recap.headline;
    recapDetailEl.textContent = recap.detail;
    gameRecapEl.classList.remove("hidden");

    const mvp = result.mvp;
    const mvpTeamName = mvp.side === "A" ? labelA : labelB;
    mvpCallout.textContent = `MVP: ${mvp.player.name} (${mvpTeamName}) — ${Math.round(
      mvp.line.pts
    )} PTS / ${Math.round(mvp.line.reb)} REB / ${Math.round(mvp.line.ast)} AST`;
    mvpCallout.classList.remove("hidden");

    renderFullBoxScore(fullBoxScore, rosterA, result.boxA, labelA, rosterB, result.boxB, labelB, shotsA, shotsB, minutesA, minutesB);
    fullBoxScore.classList.remove("hidden");
    btnToProfile.classList.remove("hidden");
    btnPlayAgain.classList.remove("hidden");

    onComplete();
  }

  setTimeout(step, QUARTER_REVEAL_DELAY_MS);
}

function runLocalSimulation() {
  const draft = game.draft;
  // The bot commits to a plan too, chosen at random - a fixed opponent plan
  // would make one counter always correct and collapse the choice.
  const botTactic = TACTIC_IDS[Math.floor(Math.random() * TACTIC_IDS.length)];
  // Resolve both rotations up front so the box score can show the same
  // minutes the simulation actually used, rather than a second guess at them.
  const minutesA = rotationMinutes || defaultMinutes(draft.rosterA);
  const minutesB = defaultMinutes(draft.rosterB);
  const result = simulateGame(draft.rosterA, draft.rosterB, datasetStats, {
    tacticA: selectedTactic,
    tacticB: botTactic,
    minutesA,
    minutesB,
  });

  playOutResult({
    result,
    labelA: game.nameA,
    labelB: game.nameB,
    rosterA: draft.rosterA,
    rosterB: draft.rosterB,
    minutesA,
    minutesB,
    onComplete: () => {
      const ownLines = draft.slots.map((slot) => ({ playerName: draft.rosterA[slot].name, line: result.boxA[slot] }));

      recordPracticeResult({
        mode: "offline",
        opponentLabel: "Bot",
        won: result.winner === "A",
        draftedTeams: draft.slots.map((slot) => draft.rosterA[slot].team),
        ruleset: game.ruleset,
        scoreFor: result.teamScoreA,
        scoreAgainst: result.teamScoreB,
        mvpName: result.mvp.player.name,
        ownLines,
      }).catch((e) => console.error("Failed to record result:", e));

      recordDraftPicks(draft.slots.map((slot) => draft.rosterA[slot].name)).catch((e) =>
        console.error("Failed to record draft picks:", e)
      );
    },
  });
}

/** Re-expresses a server match_results row (whose a/b sides refer to the
 * DB's player_a/player_b, not "me") into the "A = me" frame every render
 * function here already expects. */
function normalizeServerResult(dbResult, iAmA) {
  const dbSideIsMe = (side) => side === (iAmA ? "A" : "B");
  return {
    teamScoreA: iAmA ? dbResult.score_a : dbResult.score_b,
    teamScoreB: iAmA ? dbResult.score_b : dbResult.score_a,
    boxA: iAmA ? dbResult.box_a : dbResult.box_b,
    boxB: iAmA ? dbResult.box_b : dbResult.box_a,
    quarterBoxScores: dbResult.period_scores.map((q) => ({
      a: iAmA ? q.a : q.b,
      b: iAmA ? q.b : q.a,
      overtime: q.overtime,
    })),
    overtimePeriods: dbResult.overtime_periods,
    winner: dbSideIsMe(dbResult.winner) ? "A" : "B",
    mvp: {
      player: { name: dbResult.mvp.name },
      side: dbSideIsMe(dbResult.mvp.side) ? "A" : "B",
      line: dbResult.mvp.line,
    },
  };
}

async function runOnlineSimulationFlow(matchId) {
  const o = game.online;
  showScreen("game");
  finalBanner.classList.add("hidden");
  mvpCallout.classList.add("hidden");
  fullBoxScore.classList.add("hidden");
  btnToProfile.classList.add("hidden");
  btnPlayAgain.classList.add("hidden");
  renderScoreboard(liveScoreboard, "You", o.oppUsername, [], REGULATION_PERIODS, 0, 0, "Simulating…", true);

  try {
    await simulateMatch(matchId);
  } catch (e) {
    console.error("simulate-match call failed (may already be done by the other player):", e);
  }

  let dbResult = await getMatchResult(matchId);
  let tries = 0;
  while (!dbResult && tries < 12) {
    await sleep(500);
    dbResult = await getMatchResult(matchId);
    tries += 1;
  }

  if (!dbResult) {
    finalBanner.textContent = "Couldn't load the result - check Profile > Recent Games in a moment.";
    finalBanner.classList.remove("hidden");
    return;
  }

  const iAmA = o.mySide === "A";
  const result = normalizeServerResult(dbResult, iAmA);

  const picks = await getVisiblePicks(matchId);
  const { rosterA, rosterB } = buildVisibleState(picks, Infinity);
  const myRosterFinal = iAmA ? rosterA : rosterB;
  const oppRosterFinal = iAmA ? rosterB : rosterA;

  playOutResult({
    result,
    labelA: "You",
    labelB: o.oppUsername,
    rosterA: myRosterFinal,
    rosterB: oppRosterFinal,
    onComplete: () => {
      // online_wins/online_losses, personal_bests, draft_counts, and history
      // were already written server-side by simulate-match.
    },
  });
}

btnPlayAgain.addEventListener("click", () => {
  cleanupOnlineWatcher();
  setActiveNav("play");
  showScreen("home");
});
btnToProfile.addEventListener("click", () => {
  cleanupOnlineWatcher();
  setActiveNav("profile");
  openProfileScreen();
});

// ---- Profile screen ----

const profileRefs = {
  usernameInput: document.getElementById("input-profile-username"),
  tierBadge: document.getElementById("profile-tier-badge"),
  tierCaption: document.getElementById("profile-tier-caption"),
  onlineRecord: document.getElementById("online-record"),
  offlineRecord: document.getElementById("offline-record"),
  totalGames: document.getElementById("total-games"),
  bannerGrid: document.getElementById("banner-grid"),
  bannerSummary: document.getElementById("banner-summary"),
  mostDrafted: document.getElementById("most-drafted"),
  topPerformances: document.getElementById("top-performances"),
  historyBody: document.getElementById("history-body"),
};

async function openProfileScreen() {
  showScreen("profile");
  try {
    const profile = await loadProfile();
    renderProfileScreen(profileRefs, profile);
    renderBanners(profileRefs.bannerGrid, profileRefs.bannerSummary, profile, onEquipBanner);
  } catch (e) {
    console.error("Failed to load profile:", e);
  }
}

const badgeGridEl = document.getElementById("badge-grid");
const badgeSummaryEl = document.getElementById("badge-summary");
const badgeSportTabsEl = document.getElementById("badge-sport-tabs");

// Which sport's badges are on screen. Kept across visits so switching tabs
// and coming back doesn't dump you on NBA every time.
let activeBadgeSport = "nba";

async function openBadgesScreen() {
  showScreen("badges");
  renderBadgeSportTabs(badgeSportTabsEl, activeBadgeSport, (sport) => {
    activeBadgeSport = sport;
    openBadgesScreen();
  });
  try {
    const profile = await loadProfile();
    renderBadgeCollection(badgeGridEl, badgeSummaryEl, profile, activeBadgeSport, onToggleFeaturedBadge);
  } catch (e) {
    console.error("Failed to load badges:", e);
    badgeSummaryEl.textContent = "Couldn't load your badges right now.";
  }
}

/** Toggles a badge on your banner. At the slot limit the oldest pick drops
 * out rather than erroring - silently swapping is friendlier than telling
 * someone to go unfeature something first. */
async function onToggleFeaturedBadge(badgeId) {
  try {
    const profile = await loadProfile();
    const current = profile.featuredBadges || [];
    const next = current.includes(badgeId)
      ? current.filter((id) => id !== badgeId)
      : [...current, badgeId].slice(-FEATURED_BADGE_SLOTS);
    await setFeaturedBadges(next);
  } catch (e) {
    console.error("Failed to update featured badges:", e);
    return;
  }
  await openBadgesScreen();
}

/** Equipping is cosmetic, so it writes straight from the client. Repaint the
 * profile and the home header so the change shows everywhere it appears. */
async function onEquipBanner(franchiseId) {
  try {
    await setEquippedBanner(franchiseId);
  } catch (e) {
    console.error("Failed to equip banner:", e);
    return;
  }
  await openProfileScreen();
}

profileRefs.usernameInput.addEventListener("change", async () => {
  const name = profileRefs.usernameInput.value.trim();
  if (!name) return;
  try {
    await setUsername(name);
  } catch (e) {
    console.error("Failed to save username:", e);
    return;
  }
  game.nameA = name;
  signedInAsEl.textContent = name;
});

// ---- Bootstrap ----
// Runs last so every const above it is initialized. Gates the app on an
// existing session; a Supabase/CDN failure here must not leave a blank page,
// so any error falls through to the sign-in screen.
(async () => {
  try {
    const session = await getSession();
    if (session) {
      await enterApp();
      return;
    }
  } catch (e) {
    console.error("Couldn't check the existing session:", e);
  }
  showAuthScreen();
})();
