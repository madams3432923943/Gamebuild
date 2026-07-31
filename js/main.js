// App controller: wires draft state + engine + profile to the DOM.
// Three modes share these same screens/DOM elements:
//   - "bot": synchronous, client-only (DraftState from draft.js).
//   - "online": async, server-authoritative (Supabase - see online.js).

import { buildRecap, buildGameScript } from "./recap.js";
import { startPresence } from "./presence.js";
import { DraftState, eligibleOpenSlots, worstEligiblePick } from "./draft.js";
import {
  SLOTS,
  STARTER_SLOTS,
  RANKED_SLOTS,
  DEFAULT_ERA,
  QUARTER_REVEAL_DELAY_MS,
  QUARTER_TICK_MS,
  DRAFT_REVEAL_DELAY_MS,
  PICK_TIMER_SECONDS,
  TACTIC_TIMER_SECONDS,
  ROTATION_TIMER_SECONDS,
  ONLINE_ROTATION_TIMER_SECONDS,
  MATCHUP_TIMER_SECONDS,
  ONLINE_QUEUE_TIMEOUT_SECONDS,
  RESULT_WAIT_MS,
  ONLINE_QUEUE_POLL_MS,
} from "./constants.js";
import { SPORTS, sportById, isLive, DEFAULT_SPORT_ID } from "./sports/index.js";
import {
  loadProfile,
  loadRankInfo,
  recordPracticeResult,
  recordDraftPicks,
  setUsername,
  setEquippedBanner,
  setFeaturedBadges,
  FEATURED_BADGE_SLOTS,
} from "./profile.js";
import { getSession, requireSession, signUp, signIn, signOut, USERNAME_PATTERN } from "./supabaseClient.js";
import {
  myMembership,
  loadMySquad,
  listPublicSquads,
  watchSquadChat,
  sendSquadMessage,
  createSquad,
  joinPublicSquad,
  joinSquadByCode,
  leaveSquad,
  kickMember,
  setMemberRole,
  transferLeadership,
  regenerateInviteCode,
  updateSquadSettings,
  disbandSquad,
  squadRankInfo,
} from "./squads.js";
import {
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  challengeFriend,
  listFriendsLeaderboard,
  listIncomingRequests,
  listOutgoingRequests,
  listPendingChallenges,
  countFriends,
} from "./friends.js";
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
  getOpponentSummary,
  watchMatch,
  cancelMatch,
  submitStrategy,
  fetchStatsForPicks,
} from "./online.js";
import {
  renderPositionSelector,
  renderRosterPanel,
  renderPool,
  renderPickTimer,
  subjectVerb,
  renderFullBoxScore,
  renderScoreboard,
  renderProfileScreen,
  renderHomeHeader,
  renderBadgeCollection,
  renderBadgeSportTabs,
  renderUnlockableTabs,
  renderBanners,
  renderBannerSportTabs,
  renderEquippedBanner,
  renderMatchupSide,
  renderTacticPicker,
  renderRotationPicker,
  renderMatchupPicker,
  pushPlayHeadline,
  clearPlayFeed,
  buildShotLines,
  renderSquadEmojiPalette,
  renderSquadBrowseList,
  renderSquadHeader,
  renderSquadRoster,
  renderSquadChat,
  renderSquadsTopTabs,
  renderFriendChallenges,
  renderFriendRequests,
  renderFriendsLeaderboard,
} from "./ui.js";

// datasetStats for LOCAL (bot/friend) games only - online games are
// simulated server-side by the simulate-match Edge Function, using its own
// copy of the same dataset/engine so a client can't fake a result.
//
// Per sport and computed on first use rather than once at module load: it is
// a full pass over a couple of thousand players, the numbers only make sense
// against the sport they came from, and computing every sport's up front
// would mean a locked sport's missing dataset throwing during boot.
const datasetStatsCache = new Map();
function datasetStatsFor(sportId = getSport()) {
  if (!datasetStatsCache.has(sportId)) {
    const s = sportById(sportId);
    datasetStatsCache.set(sportId, s.computeDatasetStats(s.players()));
  }
  return datasetStatsCache.get(sportId);
}

/** Computes the active sport's dataset statistics ahead of when a game needs
 * them, while the browser is otherwise idle.
 *
 * Making this lazy (it used to run at module load) moved a full pass over
 * ~2500 players out of boot - good - but straight into the first simulate()
 * call, which happens under the live scoreboard animation. The verification
 * harness caught it immediately: worst frame went from 66ms to 333ms. Warming
 * on idle keeps both properties - boot stays cheap, and no locked sport's
 * missing dataset is touched, but the work is already done before the
 * scoreboard starts moving. */
function warmDatasetStats(sportId = getSport()) {
  if (datasetStatsCache.has(sportId) || !isLive(sportId)) return;
  const run = () => {
    try {
      datasetStatsFor(sportId);
    } catch (e) {
      // A sport whose data isn't importable simply stays uncached; the real
      // error belongs at the point of play, not in an idle warm-up.
      console.error("Couldn't precompute dataset stats:", e);
    }
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 0);
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const screens = {
  auth: document.getElementById("screen-auth"),
  home: document.getElementById("screen-home"),
  matchupIntro: document.getElementById("screen-matchup-intro"),
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

let squadChatStop = null;
function cleanupSquadChatWatcher() {
  if (squadChatStop) {
    squadChatStop();
    squadChatStop = null;
  }
}

// ---- Per-pick countdown timer (shared by local + online draft flows) ----
// Deliberately client-side only - see plan notes on the abandonment gap this
// doesn't cover for a disconnected online opponent.

let pickTimerInterval = null;
const pickTimerEl = document.getElementById("pick-timer");
const btnForfeitPick = document.getElementById("btn-forfeit-pick");

// Whatever startPickTimer's caller passed as onTimeout for the CURRENT turn -
// the Forfeit Pick button just invokes this early instead of waiting out the
// clock. Same handler either way (handleLocalTimeout for bot/practice,
// handleOnlineTimeout online), so a forfeit and a timeout are indistinguishable
// downstream: both auto-pick the worst eligible option, or skip if none exists.
let currentPickTimeoutHandler = null;

function cleanupPickTimer() {
  if (pickTimerInterval) {
    clearInterval(pickTimerInterval);
    pickTimerInterval = null;
  }
  if (pickTimerEl) pickTimerEl.textContent = "";
  currentPickTimeoutHandler = null;
  btnForfeitPick.classList.add("hidden");
}

/** (Re)starts the countdown from PICK_TIMER_SECONDS. Call exactly once per
 * new turn - never on a re-render of the same turn (e.g. picking a
 * multi-slot-eligible player just re-renders the position selector, it
 * doesn't start a new turn) or the clock would never run out. */
function startPickTimer(onTimeout) {
  cleanupPickTimer();
  currentPickTimeoutHandler = onTimeout;
  btnForfeitPick.classList.remove("hidden");
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

/** Forfeits the current pick rather than waiting out the timer - a very bad
 * option on purpose (the same worst-eligible-combo/skip logic a timeout
 * already uses), for whenever nothing comes to mind and waiting isn't worth
 * it. Works identically in every mode with a pick clock (bot, ranked
 * practice, online), since all three funnel through startPickTimer. */
btnForfeitPick.addEventListener("click", () => {
  const handler = currentPickTimeoutHandler;
  cleanupPickTimer();
  if (handler) handler();
});

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
  joined: document.getElementById("home-joined"),
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
    const rankInfo = await loadRankInfo(profile);
    renderHomeHeader(homeHeaderRefs, profile, rankInfo);
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

const modeButtons = document.querySelectorAll(".mode-btn");
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

let selectedMode = "practice-easy";

for (const btn of modeButtons) {
  btn.addEventListener("click", () => {
    selectedMode = btn.dataset.mode;
    for (const b of modeButtons) {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-checked", String(b === btn));
    }
    renderModeChoice();
  });
}

function getMode() {
  return selectedMode;
}

function currentModeConfig() {
  return MODE_CONFIG[getMode()] || MODE_CONFIG["practice-easy"];
}

function renderModeChoice() {
  modeHintEl.textContent = currentModeConfig().hint;
}

// --- Era bracket -----------------------------------------------------------
// The chosen bracket narrows the draft pool. It persists across visits because
// somebody grinding Modern Ball shouldn't have to re-pick it every session.
// --- Sport ----------------------------------------------------------------
// The picker used to be four hardcoded tiles with no listener - decoration.
// Sport is now real state: it persists like the era does, it decides which
// era brackets are even on offer, and it is what matchmaking scopes on, so
// two players can never be paired across sports.
const SPORT_KEY = "bk_sport";
const sportGridEl = document.getElementById("sport-grid");

let selectedSport = readStoredSport();

function readStoredSport() {
  try {
    const stored = localStorage.getItem(SPORT_KEY);
    // A stored sport that has since been un-launched (or a stale id from an
    // older build) must not strand someone on an unplayable screen.
    return stored && isLive(stored) ? stored : DEFAULT_SPORT_ID;
  } catch {
    return DEFAULT_SPORT_ID;
  }
}

function getSport() {
  return selectedSport;
}

/** The active sport's definition - slots, eras, dataset, engine, labels.
 * Everything downstream reads this rather than importing basketball. */
function sport() {
  return sportById(selectedSport);
}

function setSport(id) {
  if (!isLive(id)) return;
  selectedSport = id;
  try {
    localStorage.setItem(SPORT_KEY, selectedSport);
  } catch {
    // Storage refused (private mode) - the choice still applies this session.
  }
  // Era ids are only unique within a sport, so a bracket selected under the
  // previous sport may not exist here. Re-resolving through the new sport
  // snaps to its default rather than leaving a dangling id.
  selectedEra = sport().eraById(selectedEra).id;
  renderSportChoice();
  renderEraChoice();
  warmDatasetStats();
}

function renderSportChoice() {
  sportGridEl.innerHTML = "";
  for (const s of SPORTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.sport = s.id;
    btn.className = "sport-tile" + (s.id === selectedSport ? " active" : "") + (s.live ? "" : " locked");
    btn.disabled = !s.live;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(s.id === selectedSport));
    btn.innerHTML =
      `<span class="sport-icon" aria-hidden="true">${s.icon}</span>` +
      `<span class="sport-name"></span>` +
      `<span class="sport-status"></span>`;
    btn.querySelector(".sport-name").textContent = s.name;
    btn.querySelector(".sport-status").textContent = s.status;
    if (s.live) btn.addEventListener("click", () => setSport(s.id));
    sportGridEl.appendChild(btn);
  }
}

const ERA_KEY = "bk_era";
const eraPickerEl = document.getElementById("era-picker");
const eraHintEl = document.getElementById("era-hint");

let selectedEra = readStoredEra();

function readStoredEra() {
  try {
    const stored = localStorage.getItem(ERA_KEY);
    const eras = sport().eras;
    return stored && eras.some((e) => e.id === stored) ? stored : sport().defaultEra;
  } catch {
    return sport().defaultEra;
  }
}

function getEra() {
  return selectedEra;
}

function setEra(id) {
  selectedEra = sport().eraById(id).id;
  try {
    localStorage.setItem(ERA_KEY, selectedEra);
  } catch {
    // Storage refused (private mode) - the choice still applies this session.
  }
  renderEraChoice();
}

// Records live on the Profile tab only (one row per era, split online/offline
// - see renderProfileScreen) - the home screen is for picking what to play
// next, not for re-showing a record you can already see one tab over.
function renderEraChoice() {
  eraPickerEl.innerHTML = "";
  // The active sport's brackets, not a global list: basketball divides on
  // decades and football divides on rule changes, so the chips have to come
  // from whichever sport is selected.
  for (const era of sport().eras) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "era-chip" + (era.id === selectedEra ? " active" : "");
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(era.id === selectedEra));
    btn.innerHTML =
      `<span class="era-chip-emoji" aria-hidden="true">${era.emoji}</span>` +
      `<span class="era-chip-label">${era.label}</span>`;
    btn.addEventListener("click", () => setEra(era.id));
    eraPickerEl.appendChild(btn);
  }
  eraHintEl.textContent = sport().eraById(selectedEra).blurb;
}

renderSportChoice();
renderEraChoice();
warmDatasetStats();
renderModeChoice();

// --- Online ticker ---------------------------------------------------------
// Decoration, so it fails silently: startPresence never rejects, and the
// ticker stays hidden until a real number arrives rather than showing "0"
// when the network is the thing that's actually down.
const onlineTickerEl = document.getElementById("online-ticker");
const onlineTickerCountEl = document.getElementById("online-ticker-count");

startPresence((count) => {
  onlineTickerCountEl.textContent = `${count} online`;
  onlineTickerEl.classList.remove("hidden");
});

let onlineSearchActive = false;

/** Ends a search - whether it timed out, errored, or was cancelled - and
 * hands back a working home screen.
 *
 * Always releases the queue row, even on the error path. Leaving one behind
 * is the failure mode worth avoiding: the next player to search would be
 * paired with someone who stopped waiting minutes ago and get a draft that
 * never advances, which is a worse outcome than simply not matching.
 *
 * `message` is shown in place of the spinner when there's something to say,
 * so "nobody's online" lands on the screen the player is looking at rather
 * than the search just vanishing. */
async function endOnlineSearch(message) {
  onlineSearchActive = false;
  btnStartDraft.disabled = false;
  btnCancelSearch.classList.add("hidden");

  try {
    await leaveQueue();
  } catch (e) {
    console.error("Failed to leave the matchmaking queue:", e);
  }

  showScreen("home");
  setActiveNav("play");
  if (message) {
    searchStatusEl.classList.remove("hidden");
    searchStatusEl.textContent = message;
  } else {
    searchStatusEl.classList.add("hidden");
  }
}

async function startOnlineSearch() {
  onlineSearchActive = true;
  btnStartDraft.disabled = true;
  btnCancelSearch.classList.remove("hidden");
  searchStatusEl.classList.remove("hidden");

  // A visible countdown, so the wait reads as bounded rather than open-ended.
  // Someone who can see it end in 90 seconds waits; someone watching an
  // endless spinner concludes the game is broken and closes the tab.
  const deadline = Date.now() + ONLINE_QUEUE_TIMEOUT_SECONDS * 1000;
  const renderWaiting = () => {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    searchStatusEl.innerHTML =
      `<span class="search-spinner"></span> Searching for an opponent… <strong>${left}s</strong>`;
  };
  renderWaiting();
  const ticker = setInterval(() => {
    if (onlineSearchActive) renderWaiting();
  }, 1000);

  try {
    while (onlineSearchActive) {
      const res = await joinQueue(getSport(), getEra());
      if (res.status === "matched") {
        await enterOnlineMatch(res.match_id);
        return;
      }
      // Checked after the poll, not before it: the last poll of the window
      // is a real chance to match, and giving up without taking it would
      // waste the final two seconds of the wait.
      if (Date.now() >= deadline) {
        await endOnlineSearch(
          "No one else is looking for a game right now. Try Ranked Practice against the bot, or check back in a bit."
        );
        return;
      }
      await sleep(ONLINE_QUEUE_POLL_MS);
    }
  } catch (e) {
    await endOnlineSearch("Couldn't reach matchmaking: " + e.message);
  } finally {
    clearInterval(ticker);
  }
}

btnCancelSearch.addEventListener("click", () => endOnlineSearch(null));

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
  cleanupMatchupTimer();
  cleanupSquadChatWatcher();
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
  goToTab("squads", openSquadsScreen);
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
const btnLeaveMatch = document.getElementById("btn-leave-match");

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
const matchupPhaseEl = document.getElementById("matchup-phase");
const matchupGridEl = document.getElementById("matchup-grid");
const matchupPhaseHintEl = document.getElementById("matchup-phase-hint");
const btnConfirmMatchups = document.getElementById("btn-confirm-matchups");

// The game plan is chosen AFTER the draft, as a final timed round: you should
// be picking how to play the team you actually ended up with, not guessing at
// a style before you know who you'll get. Every game offers 3 of the 10
// styles at random, so selectedTactic defaults to whichever is first in that
// game's offer rather than a fixed id that might not even be on offer.
// Seeded from the active sport rather than a basketball import, so a sport
// with a different set of gamestyles (or none yet) doesn't inherit
// basketball's as a default it never declared.
let offeredTactics = [sport().tacticById(sport().defaultTactic)].filter(Boolean);
let selectedTactic = sport().defaultTactic;
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
  offeredTactics = sport().randomTacticChoices(3);
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
function startRotationPhase(roster, slots, onConfirm, timerSeconds = ROTATION_TIMER_SECONDS) {
  cleanupPickTimer();
  cleanupRotationTimer();
  rotationMinutes = sport().defaultMinutes(roster);
  // Confirm stays locked until the whole 240 is spent. Leaving minutes on the
  // table is never a real choice - it just fields a weaker team - so it's
  // blocked rather than warned about.
  renderRotationPicker(rotationGridEl, roster, rotationMinutes, rotationTotalEl, slots, (valid) => {
    btnConfirmRotation.disabled = !valid;
  });

  draftPoolPanel.classList.add("hidden");
  rotationPhaseEl.classList.remove("hidden");
  pickTimerEl.hidden = false;

  let remaining = timerSeconds;
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

// Who guards whom. Null outside ranked practice, in which case the engine
// falls back to everyone guarding their own position.
let selectedMatchups = null;
let matchupTimerInterval = null;

function cleanupMatchupTimer() {
  if (matchupTimerInterval) {
    clearInterval(matchupTimerInterval);
    matchupTimerInterval = null;
  }
}

/** Between the rotation and the gamestyle: point your defenders at the
 * opponent you actually want them on. Timing out locks in whatever is set,
 * same as the other timed phases - the clock keeps a match moving, it
 * doesn't punish deliberation. */
function startMatchupPhase(myRoster, oppRoster, oppLabel, onConfirm) {
  cleanupPickTimer();
  cleanupMatchupTimer();

  const myStarters = STARTER_SLOTS.filter((slot) => myRoster[slot]);
  const oppStarters = STARTER_SLOTS.filter((slot) => oppRoster[slot]);
  selectedMatchups = sport().defaultMatchups(myRoster, oppRoster);

  renderMatchupPicker(matchupGridEl, myRoster, oppRoster, myStarters, oppStarters, selectedMatchups, oppLabel);

  draftPoolPanel.classList.add("hidden");
  matchupPhaseEl.classList.remove("hidden");
  pickTimerEl.hidden = false;

  let remaining = MATCHUP_TIMER_SECONDS;
  renderPickTimer(pickTimerEl, remaining);
  matchupTimerInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      cleanupMatchupTimer();
      confirm();
      return;
    }
    renderPickTimer(pickTimerEl, remaining);
  }, 1000);

  function confirm() {
    cleanupMatchupTimer();
    matchupPhaseEl.classList.add("hidden");
    pickTimerEl.hidden = true;
    pickTimerEl.textContent = "";
    btnConfirmMatchups.onclick = null;
    onConfirm();
  }

  btnConfirmMatchups.onclick = confirm;
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
  cleanupMatchupTimer();
  tacticPhaseEl.classList.add("hidden");
  rotationPhaseEl.classList.add("hidden");
  matchupPhaseEl.classList.add("hidden");
  rotationMinutes = null;
  selectedMatchups = null;
  draftPoolPanel.classList.remove("hidden");
  btnLeaveMatch.classList.add("hidden");
  applyRulesetToDraftUI();
  game.era = getEra();
  game.sport = getSport();
  game.draft = new DraftState(
    sport().playersInEra(sport().players(), game.era),
    recentSquadIds,
    slotsForRuleset(game.ruleset)
  );
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
  renderPool(poolList, draft.currentSquad, poolSearch.value, rosterFor(side), pendingName, onPoolPick, sport().players(), game.ruleset, draft.slots);
}

function onPoolPick(player) {
  const roster = rosterFor(game.round.activeSide);
  const slots = eligibleOpenSlots(player, roster, game.draft.slots);
  // One eligible slot, or every eligible slot is bench (interchangeable, so
  // asking which one isn't a real decision) - place him without a popup.
  if (slots.length === 1 || slots.every((s) => s.startsWith("BENCH"))) {
    finalizePick(player, slots[0]);
    return;
  }
  // A genuine choice exists (a real position, alone or alongside bench), so
  // ask - in a popup rather than by re-rendering the board and hoping the
  // position strip is noticed. Dismissing puts the player back rather than
  // dropping the pick.
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
    draftTurnBanner.textContent = "Set your defensive matchups";
    matchupPhaseHintEl.textContent =
      `Your starters are on their opposite numbers by default. Move anyone you want - ` +
      `switching two players trades their assignments.`;
    startMatchupPhase(draft.rosterA, draft.rosterB, game.nameB, () => {
    draftTurnBanner.textContent = "Final round — set your game plan";
    tacticPhaseHintEl.textContent = `${TACTIC_TIMER_SECONDS} seconds to choose how this team plays.`;
    startTacticPhase(runLocalSimulation);
    });
  });
}

// ---- Online draft flow ----

const matchupIntroEl = document.getElementById("matchup-intro");
const matchupSideAEl = document.getElementById("matchup-side-a");
const matchupSideBEl = document.getElementById("matchup-side-b");
const matchupVsEl = document.getElementById("matchup-vs");
const matchupCountdownEl = document.getElementById("matchup-countdown");
const matchupRefsA = {
  bannerSlot: document.getElementById("matchup-banner-a"),
  username: document.getElementById("matchup-username-a"),
  rank: document.getElementById("matchup-rank-a"),
};
const matchupRefsB = {
  bannerSlot: document.getElementById("matchup-banner-b"),
  username: document.getElementById("matchup-username-b"),
  rank: document.getElementById("matchup-rank-b"),
};

function rankLabelFor(rankInfo) {
  return rankInfo && !rankInfo.provisional ? rankInfo.tier.name : "Unranked";
}

/** The ~7s "you've been matched" beat between finding an opponent and the
 * draft actually starting: both players' banners fly in from the edges with
 * a little overshoot, an impact flash lands as they settle, then a 3-2-1
 * countdown and a buzzer-red "GO!". Only for a genuinely fresh match
 * (enterOnlineMatch only calls this when there are no picks yet) -
 * reconnecting to a draft already in progress skips straight to it instead
 * of replaying the intro every time. */
async function playMatchupIntro(mySide, oppSide) {
  showScreen("matchupIntro");
  matchupSideAEl.classList.remove("fly-in");
  matchupSideBEl.classList.remove("fly-in");
  matchupVsEl.classList.remove("vs-fade");
  matchupIntroEl.classList.remove("impact-flash");
  matchupCountdownEl.classList.add("hidden");
  matchupCountdownEl.classList.remove("pulse", "go");
  matchupCountdownEl.textContent = "";

  renderMatchupSide(matchupRefsA, mySide);
  renderMatchupSide(matchupRefsB, oppSide);

  // Force layout before adding the class, so removing it above and adding
  // it back here actually retriggers the transition instead of no-op'ing
  // against the previous match's already-settled state.
  void matchupSideAEl.offsetWidth;
  await sleep(50);
  matchupSideAEl.classList.add("fly-in");
  matchupSideBEl.classList.add("fly-in");

  // A beat after the banners land (the fly-in transition itself is 0.9s),
  // a quick radial flash sells the "impact" of the two sides meeting.
  await sleep(900);
  matchupIntroEl.classList.add("impact-flash");

  await sleep(1300);
  // The countdown and "VS" occupy the exact same dead-center spot by
  // design - fading VS out is what keeps them from rendering on top of
  // each other instead of the countdown looking like a glitch.
  matchupVsEl.classList.add("vs-fade");
  matchupCountdownEl.classList.remove("hidden");
  for (const n of [3, 2, 1]) {
    matchupCountdownEl.textContent = String(n);
    matchupCountdownEl.classList.remove("pulse");
    void matchupCountdownEl.offsetWidth;
    matchupCountdownEl.classList.add("pulse");
    await sleep(1000);
  }
  // The payoff beat: bigger, and in the same buzzer-red the pick timer
  // already uses for urgency, so it reads as "go" rather than just a
  // fourth number in the same countdown color.
  matchupCountdownEl.textContent = "GO!";
  matchupCountdownEl.classList.add("go");
  await sleep(900);
}

async function enterOnlineMatch(matchId) {
  btnStartDraft.disabled = false;
  btnCancelSearch.classList.add("hidden");
  searchStatusEl.classList.add("hidden");

  game.mode = "online";
  const session = await requireSession();
  const match = await getMatch(matchId);
  const mySide = match.player_a === session.user.id ? "A" : "B";
  const oppUserId = mySide === "A" ? match.player_b : match.player_a;

  const [oppSummary, myProfile, picks] = await Promise.all([
    getOpponentSummary(oppUserId),
    loadProfile(),
    getVisiblePicks(matchId),
  ]);
  const oppUsername = oppSummary.username;

  game.online = {
    matchId,
    mySide,
    oppUsername,
    pendingPlayer: null,
    myRoster: {},
    oppRoster: {},
    currentSquad: null,
    stopWatcher: null,
    // Set once the game reveal has been entered, so the watcher and the
    // post-strategy fallback poll can both aim for it without ever running
    // two reveals at once. See handleOnlineMatchState.
    simulationStarted: false,
  };

  if (picks.length === 0) {
    const [myRankInfo, oppRankInfo] = await Promise.all([
      loadRankInfo(myProfile),
      loadRankInfo({ onlineWins: oppSummary.onlineWins, onlineLosses: oppSummary.onlineLosses }),
    ]);
    await playMatchupIntro(
      { username: myProfile.username || "You", tierLabel: rankLabelFor(myRankInfo), bannerId: myProfile.equippedBanner },
      { username: oppUsername, tierLabel: rankLabelFor(oppRankInfo), bannerId: oppSummary.equippedBanner }
    );
  }

  applyRulesetToDraftUI();
  btnLeaveMatch.classList.remove("hidden");
  // Reset: handleOpponentLeft repurposes this button as "Back to Home", and a
  // new match must not inherit that label.
  btnLeaveMatch.textContent = "Leave Match";
  showScreen("draft");
  await handleOnlineMatchState(match);
  // Pass the match we just handled as the watcher's starting point - without
  // this, watchMatch's first poll (which fires immediately) always looks
  // like a change and re-runs the handler above a second time, concurrently.
  // Harmless mid-draft, but for ready_to_simulate/complete it meant two
  // concurrent runOnlineSimulationFlow() calls racing over the same
  // scoreboard timers/DOM - a real cause of a frozen-looking game screen.
  game.online.stopWatcher = watchMatch(
    matchId,
    onOnlineMatchChange,
    undefined,
    match,
    (e) => {
      // Only fires after a sustained run of failed polls - see WATCH_ERROR_STREAK.
      console.error("Match polling keeps failing:", e);
      if (game.online && !game.online.simulationStarted) {
        draftTurnBanner.textContent = "Lost contact with the match - check your connection. It'll pick back up on its own.";
      }
    },
    handleOpponentLeft
  );
}

async function onOnlineMatchChange(match) {
  await handleOnlineMatchState(match);
}

/**
 * The match row is gone: the opponent left, or the stale-match sweep took it.
 *
 * This is terminal and has to say so. The polling-failure message above tells
 * the player to sit tight because the connection will recover - true for a
 * flaky network, and exactly wrong here, where waiting means staring at a
 * draft screen for a match that no longer exists. Nothing was recorded (no
 * result is written until simulate-match runs), so there is no rank
 * consequence to explain, only a way back.
 */
function handleOpponentLeft() {
  if (!game.online || game.online.simulationStarted) return;
  cleanupPickTimer();
  cleanupRotationTimer();
  cleanupMatchupTimer();
  cleanupTacticTimer();
  cleanupOnlineWatcher();
  game.online = null;

  draftTurnBanner.textContent = "Your opponent left the match. Nothing was recorded - your rank is untouched.";
  poolSearch.hidden = true;
  positionSelectorEl.innerHTML = "";
  poolList.innerHTML = "";
  btnLeaveMatch.classList.remove("hidden");
  btnLeaveMatch.textContent = "Back to Home";
}

/** Routes to the right screen/phase for whatever state the match is
 * currently in - shared by the initial entry (enterOnlineMatch) and every
 * subsequent poll tick (onOnlineMatchChange) so a reload or a resume mid-
 * strategy-phase lands in the same place a live status change would.
 *
 * Only the drafting/strategy branches get a try/catch writing to
 * draftTurnBanner here - by the time runOnlineSimulationFlow could throw,
 * showScreen("game") has already run and draftTurnBanner is on a hidden
 * screen, so that branch handles its own errors and reports to finalBanner
 * instead (see runOnlineSimulationFlow). */
async function handleOnlineMatchState(match) {
  // Left the match (or signed out) while a poll was already in flight - the
  // whole online state this routes into is gone, so there's nothing to do.
  if (!game.online) return;

  if (match.status === "ready_to_simulate" || match.status === "complete") {
    // The reveal is deliberately reachable from more than one place (the
    // match watcher AND the post-submit fallback poll in
    // beginOnlineStrategyPhase), because a single trigger that silently dies
    // leaves the player staring at a draft screen forever. Redundant triggers
    // are only safe if entering twice is impossible: two concurrent
    // runOnlineSimulationFlow() calls would fight over the same scoreboard
    // intervals and DOM and look exactly like a frozen game.
    if (game.online.simulationStarted) return;
    game.online.simulationStarted = true;

    cleanupOnlineWatcher();
    cleanupPickTimer();
    // A strategy phase abandoned mid-flight (opponent finished first) leaves
    // its own timers running. They aren't covered by cleanupPickTimer, and on
    // firing they'd re-submit a strategy the server has already moved past,
    // then route the failure back through here.
    cleanupRotationTimer();
    cleanupMatchupTimer();
    cleanupTacticTimer();

    try {
      await runOnlineSimulationFlow(match.id, match.winner);
    } catch (e) {
      // Nothing above this catch can report to the player: the game screen is
      // showing by now, so the draft banner is hidden. Without this the
      // scoreboard just sits on "Simulating…" forever with the real reason
      // buried in an unhandled promise rejection.
      console.error("Online simulation flow failed:", e);
      finalBanner.textContent = "Couldn't play back the game (" + e.message + ") - your result is safe, check Profile > Recent Games.";
      finalBanner.classList.remove("hidden");
      btnToProfile.classList.remove("hidden");
      btnPlayAgain.classList.remove("hidden");
      btnGameHome.classList.remove("hidden");
    }
    return;
  }
  try {
    if (match.status === "strategy") {
      cleanupPickTimer();
      await beginOnlineStrategyPhase(match);
      return;
    }
    await renderOnlineDraftRound(match);
  } catch (e) {
    console.error("Failed to update online match:", e);
    draftTurnBanner.textContent = "Something went wrong (" + e.message + ") - try refreshing, or leave the match.";
  }
}

/** Lets a player walk away from a stuck or unwanted online draft rather than
 * wait out the 15-minute server-side staleness window (see cancel_match) -
 * either side can leave, at any point before simulation starts. */
btnLeaveMatch.addEventListener("click", async () => {
  // Doubles as the way out after an opponent leaves, where the online state
  // has already been torn down and there is no match left to cancel. Without
  // this the button is on screen and does nothing, which is worse than not
  // offering it.
  if (!game.online) {
    showScreen("home");
    refreshHome();
    return;
  }
  const matchId = game.online.matchId;
  cleanupOnlineWatcher();
  cleanupPickTimer();
  // The strategy phase's own timers (rotation/matchups/tactic) aren't
  // covered by cleanupPickTimer - leaving mid-phase without clearing them
  // left a zombie interval that could still fire minutes later against a
  // match cancelMatch just deleted, throwing unhandled deep inside a timer
  // callback with no game.online left to reference.
  cleanupRotationTimer();
  cleanupMatchupTimer();
  cleanupTacticTimer();
  btnLeaveMatch.classList.add("hidden");
  try {
    await cancelMatch(matchId);
  } catch (e) {
    console.error("Failed to cancel match:", e);
  }
  game.online = null;
  showScreen("home");
  refreshHome();
});

async function renderOnlineDraftRound(match) {
  const o = game.online;
  if (!o) return;

  draftRoundLabel.textContent = `Round ${match.round_number}` + (match.is_friendly ? " · Friendly Match (unranked)" : "");
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

  // Stats enrichment isn't needed mid-draft (the roster panels don't show
  // stats under the strict ruleset) - only the post-game box score needs
  // it, via fetchStatsForPicks in runOnlineSimulationFlow.
  const { rosterA, rosterB } = buildVisibleState(picks, match.round_number);
  o.myRoster = o.mySide === "A" ? rosterA : rosterB;
  o.oppRoster = o.mySide === "A" ? rosterB : rosterA;

  // The opponent's pick from the round that just finished becomes visible
  // for the first time exactly when this fires (get_visible_picks only
  // reveals a side's current-round pick once BOTH sides have acted this
  // round) - same highlight animation offline's renderRoundReveal already
  // gives the bot's pick, via the same revealSlots opt on renderRosterPanel.
  const oppSide = o.mySide === "A" ? "B" : "A";
  const oppRevealSlots = picks
    .filter((p) => p.round_number === match.round_number - 1 && p.side === oppSide && p.action === "pick")
    .map((p) => p.slot);

  if (game.ruleset !== "easy") startPickTimer(handleOnlineTimeout);
  renderOnlinePositionAndPool();
  renderRosterPanel(rosterPanelA, o.myRoster, "You", true, { slots: RANKED_SLOTS });
  renderRosterPanel(rosterPanelB, o.oppRoster, o.oppUsername, false, { slots: RANKED_SLOTS, revealSlots: oppRevealSlots });
}

function renderOnlinePositionAndPool() {
  const o = game.online;
  const eligibleForPending = o.pendingPlayer ? eligibleOpenSlots(o.pendingPlayer, o.myRoster, RANKED_SLOTS) : null;
  renderPositionSelector(positionSelectorEl, o.myRoster, eligibleForPending, (slot) => {
    finalizeOnlinePick(o.pendingPlayer, slot);
  }, RANKED_SLOTS);
  const pendingName = o.pendingPlayer ? o.pendingPlayer.name : null;
  renderPool(poolList, o.currentSquad, poolSearch.value, o.myRoster, pendingName, onOnlinePoolPick, sport().players(), game.ruleset, RANKED_SLOTS);
}

function onOnlinePoolPick(player) {
  const o = game.online;
  const slots = eligibleOpenSlots(player, o.myRoster, RANKED_SLOTS);
  // Mirrors onPoolPick (offline) exactly: one eligible slot, or every
  // eligible slot is bench (interchangeable, not a real decision) - place
  // him without a popup.
  if (slots.length === 1 || slots.every((s) => s.startsWith("BENCH"))) {
    finalizeOnlinePick(player, slots[0]);
    return;
  }
  // A genuine choice exists - same popup offline uses, not a different
  // online-only pattern.
  o.pendingPlayer = player;
  renderOnlinePositionAndPool();
  openSlotPicker(
    player,
    slots,
    (slot) => finalizeOnlinePick(player, slot),
    () => {
      o.pendingPlayer = null;
      renderOnlinePositionAndPool();
    }
  );
}

/** Pick-timer timeout for an online turn: auto-picks the worst eligible
 * combo through the exact same submitPick path a manual pick uses, or
 * skips if nothing is eligible - same server-authoritative validation
 * either way, the server can't tell (and shouldn't need to) whether a pick
 * was manual or a timeout auto-pick. */
async function handleOnlineTimeout() {
  const o = game.online;
  if (!o || !o.currentSquad) return;
  const combo = worstEligiblePick(o.currentSquad, o.myRoster, RANKED_SLOTS);
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

/** Online's equivalent of renderDraftComplete's strict-ruleset branch: once
 * both rosters are full (status flips to 'strategy'), run the identical
 * rotation -> matchups -> tactic sequence offline Ranked Practice uses, then
 * submit once instead of simulating locally - the server simulates once
 * BOTH sides have submitted (see submit_strategy). Each side runs this
 * independently at its own pace; nothing here waits on the opponent
 * mid-phase, only after the final submit. */
async function beginOnlineStrategyPhase(match) {
  const o = game.online;
  if (!o) return;

  draftRoundLabel.textContent = "Draft complete";
  squadBannerTeam.textContent = "Rosters set";
  squadBannerDecade.textContent = "";
  poolSearch.hidden = true;
  positionSelectorEl.innerHTML = "";
  poolList.innerHTML = "";
  // Visible feedback for the round-trip below, so a slow (not failed) load
  // reads as "working" instead of a blank, seemingly frozen screen.
  draftTurnBanner.textContent = "Loading final rosters…";

  const picks = await getVisiblePicks(o.matchId);
  const statsByKey = await fetchStatsForPicks(picks);
  const { rosterA, rosterB } = buildVisibleState(picks, Infinity, statsByKey);
  o.myRoster = o.mySide === "A" ? rosterA : rosterB;
  o.oppRoster = o.mySide === "A" ? rosterB : rosterA;

  renderRosterPanel(rosterPanelA, o.myRoster, "You", false, { slots: RANKED_SLOTS });
  renderRosterPanel(rosterPanelB, o.oppRoster, o.oppUsername, false, { slots: RANKED_SLOTS });

  draftTurnBanner.textContent = "Set your rotation";
  rotationPhaseHintEl.textContent =
    `240 minutes to spend, 10-40 each. Starters play more than the bench. ` +
    `Lower someone to free minutes before raising someone else.`;
  startRotationPhase(o.myRoster, RANKED_SLOTS, () => {
    draftTurnBanner.textContent = "Set your defensive matchups";
    matchupPhaseHintEl.textContent =
      `Your starters are on their opposite numbers by default. Move anyone you want - ` +
      `switching two players trades their assignments.`;
    startMatchupPhase(o.myRoster, o.oppRoster, o.oppUsername, () => {
      draftTurnBanner.textContent = "Final round — set your game plan";
      tacticPhaseHintEl.textContent = `${TACTIC_TIMER_SECONDS} seconds to choose how this team plays.`;
      startTacticPhase(async () => {
        draftTurnBanner.textContent = "Submitting your game plan…";
        try {
          await submitStrategy(o.matchId, rotationMinutes, selectedMatchups, selectedTactic);
          draftTurnBanner.textContent = "Waiting for opponent to finish their game plan…";
          awaitSimulationStart();
        } catch (e) {
          draftTurnBanner.textContent = "Couldn't submit your game plan (" + e.message + ") - try again.";
          const freshMatch = await getMatch(o.matchId);
          await handleOnlineMatchState(freshMatch);
        }
      });
    });
  }, ONLINE_ROTATION_TIMER_SECONDS);
}

/** A second, independent path from "I've submitted my game plan" to the game
 * reveal, running alongside the match watcher.
 *
 * The watcher is a single long-lived poller started once at match entry, and
 * anything that stops it early (a tab switch, a run of failed polls, an
 * unhandled error in an earlier handler) silently takes the reveal with it -
 * the match completes server-side, the profile updates, and the player is
 * left on a draft screen that never changes. This starts fresh at the exact
 * moment the reveal becomes possible and only has to survive seconds, so the
 * two failure modes don't overlap. handleOnlineMatchState is idempotent
 * (simulationStarted), so whichever gets there first wins and the other is a
 * no-op. */
function awaitSimulationStart() {
  const matchId = game.online && game.online.matchId;
  if (!matchId) return;
  let tries = 0;

  async function poll() {
    // Left the match, or the reveal already started from the watcher.
    if (!game.online || game.online.matchId !== matchId || game.online.simulationStarted) return;
    if (tries > 150) {
      draftTurnBanner.textContent = "Still waiting on your opponent - you can leave the match if they've dropped.";
      return;
    }
    tries += 1;
    try {
      const match = await getMatch(matchId);
      if (match.status !== "strategy") {
        await handleOnlineMatchState(match);
        return;
      }
    } catch (e) {
      console.error("Waiting-for-simulation poll failed:", e);
    }
    setTimeout(poll, 2000);
  }

  setTimeout(poll, 2000);
}

poolSearch.addEventListener("input", () => {
  if (game.mode === "online") {
    if (game.online && game.online.currentSquad) renderOnlinePositionAndPool();
  } else if (game.draft && game.draft.currentSquad) {
    renderPoolForCurrentState();
  }
});

// ---- Game screen (live scoreboard + final box score) - shared by all modes ----

const courtStageEl = document.getElementById("court-stage");
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
const btnGameHome = document.getElementById("btn-game-home");

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
  btnGameHome.classList.add("hidden");
  // These flash/glow classes live directly on the container elements, not on
  // content renderScoreboard rebuilds each tick - so a leftover class from a
  // previous game would otherwise survive into this one.
  liveScoreboard.classList.remove("period-flash", "lead-flash");
  courtStageEl.classList.remove("final-flash");
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
    // Derived from the roster's own keys, not the fixed 6-slot legacy list -
    // a Ranked roster's 5 bench players were previously invisible to the
    // recap feed, which could never credit a bench performance no matter
    // how big the quarter.
    for (const slot of Object.keys(roster)) {
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

  /** Animates the scoreboard from one period's totals to the next. `onDone`
   * (optional) fires right as the numbers land on the new total - that's
   * when a period-end flash actually reads as tied to the score, not just
   * to a timer running somewhere else. */
  function tickScoreTo(fromA2, fromB2, toA, toB, periods, remaining, duringLabel, doneLabel, onDone) {
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
      if (done) {
        clearInterval(tick);
        if (onDone) onDone();
      }
    }, 60);
    scoreTickIntervals.push(tick);
  }

  /** Retriggers a CSS animation class on `el` - removing then re-adding a
   * class that's already present is a no-op without a reflow between the
   * two, so back-to-back flashes (e.g. two period-end flashes in a row)
   * would otherwise only play the first one. */
  function flashClass(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
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

    // A real lead change (not just the opening 0-0 tie resolving) gets its
    // own flash and headline - the score ticking up is the baseline, this is
    // the moment actually worth reacting to.
    const prevLeader = fromA === fromB ? null : fromA > fromB ? "A" : "B";
    const newLeader = runningA === runningB ? null : runningA > runningB ? "A" : "B";
    const leadChanged = !!newLeader && !!prevLeader && newLeader !== prevLeader;

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
    // as being played rather than reported. The flash fires once the count
    // actually lands - a bigger, buzzer-colored one for a lead change, the
    // calmer accent one for an ordinary period end.
    tickScoreTo(
      fromA,
      fromB,
      runningA,
      runningB,
      periodsSoFar,
      periodsRemaining,
      `${label} in progress`,
      `End of ${label}`,
      () => flashClass(liveScoreboard, leadChanged ? "lead-flash" : "period-flash")
    );
    renderFullBoxScore(fullBoxScore, rosterA, liveTotals.a, labelA, rosterB, liveTotals.b, labelB, null, null, minutesA, minutesB);
    announcePeriod(i, label);
    if (leadChanged) {
      const leaderLabel = newLeader === "A" ? labelA : labelB;
      pushPlayHeadline(
        playFeedEl,
        `${leaderLabel} ${subjectVerb(leaderLabel, "takes", "take")} the lead in ${label}`,
        "lead-change"
      );
    }

    i += 1;
    setTimeout(step, QUARTER_REVEAL_DELAY_MS);
  }

  function finish() {
    for (const t of scoreTickIntervals) clearInterval(t);
    renderScoreboard(liveScoreboard, labelA, labelB, periodsSoFar, 0, runningA, runningB, "Final", false);
    flashClass(courtStageEl, "final-flash");

    // The broadcast's closing line: not why the winner won (the recap below
    // covers that), just the shape the game itself took.
    pushPlayHeadline(playFeedEl, buildGameScript(periodsSoFar, labelA, labelB), "final");

    const winnerName = result.winner === "A" ? labelA : labelB;
    finalBanner.textContent = `${winnerName} ${subjectVerb(winnerName, "wins", "win")}, ${result.teamScoreA}-${result.teamScoreB}${
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

    renderFullBoxScore(fullBoxScore, rosterA, result.boxA, labelA, rosterB, result.boxB, labelB, shotsA, shotsB, minutesA, minutesB, true);
    fullBoxScore.classList.remove("hidden");
    btnToProfile.classList.remove("hidden");
    btnPlayAgain.classList.remove("hidden");
    btnGameHome.classList.remove("hidden");

    onComplete();
  }

  setTimeout(step, QUARTER_REVEAL_DELAY_MS);
}

function runLocalSimulation() {
  const draft = game.draft;
  // The bot commits to a plan too, chosen at random - a fixed opponent plan
  // would make one counter always correct and collapse the choice.
  const tacticIds = sport().tactics.map((t) => t.id);
  const botTactic = tacticIds[Math.floor(Math.random() * tacticIds.length)];
  // Resolve both rotations up front so the box score can show the same
  // minutes the simulation actually used, rather than a second guess at them.
  const minutesA = rotationMinutes || sport().defaultMinutes(draft.rosterA);
  const minutesB = sport().botMinutes(draft.rosterB);
  const result = sport().simulate(draft.rosterA, draft.rosterB, datasetStatsFor(), {
    tacticA: selectedTactic,
    tacticB: botTactic,
    minutesA,
    minutesB,
    matchupsA: selectedMatchups || undefined,
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
        sport: game.sport || getSport(),
        era: game.era || DEFAULT_ERA,
        opponentLabel: "Bot",
        won: result.winner === "A",
        draftedTeams: draft.slots.map((slot) => draft.rosterA[slot].team),
        ruleset: game.ruleset,
        scoreFor: result.teamScoreA,
        scoreAgainst: result.teamScoreB,
        mvpName: result.mvp.player.name,
        mvpIsOwnTeam: result.mvp.side === "A",
        ownLines,
        rosterA: draft.rosterA,
        rosterB: draft.rosterB,
        boxA: result.boxA,
        boxB: result.boxB,
        labelA: game.nameA,
        labelB: game.nameB,
        minutesA,
        minutesB,
      }).catch((e) => console.error("Failed to record result:", e));

      recordDraftPicks(draft.slots.map((slot) => draft.rosterA[slot].name)).catch((e) =>
        console.error("Failed to record draft picks:", e)
      );
    },
  });
}

/** Re-expresses a server match_results row (whose a/b sides refer to the
 * DB's player_a/player_b, not "me") into the "A = me" frame every render
 * function here already expects.
 *
 * `serverWinner` comes from the MATCH row (matches.winner, exposed through
 * matches_public), not from match_results - that table has no winner column
 * at all. Reading dbResult.winner, as this used to, always yielded undefined,
 * which normalized to "B" every single time: both players were told their
 * opponent had won, regardless of the actual score. Falls back to comparing
 * the two scores so a missing/blank winner still resolves correctly. */
function normalizeServerResult(dbResult, iAmA, serverWinner) {
  const dbSideIsMe = (side) => side === (iAmA ? "A" : "B");
  const winnerSide = serverWinner || (dbResult.score_a > dbResult.score_b ? "A" : "B");
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
    winner: dbSideIsMe(winnerSide) ? "A" : "B",
    mvp: {
      player: { name: dbResult.mvp.name },
      side: dbSideIsMe(dbResult.mvp.side) ? "A" : "B",
      line: dbResult.mvp.line,
    },
  };
}

async function runOnlineSimulationFlow(matchId, serverWinner) {
  const o = game.online;
  btnLeaveMatch.classList.add("hidden");
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

  // Wait for the result row rather than assuming our own simulate-match call
  // produced it. Both clients race to trigger the simulation and the function
  // is idempotent, so whichever loses the race sees its call fail and has to
  // wait for the winner's write to land.
  //
  // This used to give up after 6s (12 x 500ms), which is inside the range a
  // cold-started Edge Function legitimately takes: it boots a Deno isolate,
  // pulls the whole ~2500-row player table, then simulates. A player whose
  // game was completing perfectly well would be told it had failed. The
  // window is now ~25s with a widening gap - cheap, because the loop exits
  // the moment the row appears, and only a genuinely stuck simulation ever
  // pays the full wait.
  // Guarded like every attempt inside the loop below. Left bare, a single
  // failure on the FIRST read skipped the whole patient wait and surfaced the
  // raw database error to the player as "Couldn't play back the game
  // (permission denied for table matches)" - a game that had in fact
  // simulated fine and was sitting in the database.
  let dbResult = await getMatchResult(matchId).catch((e) => {
    console.error("First result read failed, falling back to the retry window:", e);
    return null;
  });
  let waited = 0;
  let gap = 400;
  while (!dbResult && waited < RESULT_WAIT_MS) {
    // Says what it is waiting for. Silence here reads as a hung game, which
    // is what "the online match froze" has usually meant.
    if (waited > 3000) {
      renderScoreboard(liveScoreboard, "You", o.oppUsername, [], REGULATION_PERIODS, 0, 0, "Still simulating…", true);
    }
    await sleep(gap);
    waited += gap;
    gap = Math.min(1500, Math.round(gap * 1.25));
    dbResult = await getMatchResult(matchId).catch(() => null);
  }

  if (!dbResult) {
    finalBanner.textContent = "Couldn't load the result - check Profile > Recent Games in a moment.";
    finalBanner.classList.remove("hidden");
    btnGameHome.classList.remove("hidden");
    return;
  }

  const iAmA = o.mySide === "A";
  // matches.winner is only stamped alongside the result; if this client got
  // here off a 'ready_to_simulate' poll the field can still be blank, so
  // re-read the match rather than trusting the status that triggered us.
  let winnerSide = serverWinner;
  if (!winnerSide) {
    try {
      winnerSide = (await getMatch(matchId)).winner;
    } catch (e) {
      console.error("Couldn't re-read the match for its winner:", e);
    }
  }
  const result = normalizeServerResult(dbResult, iAmA, winnerSide);

  // showScreen("game") already ran above, so draftTurnBanner (the error
  // target for the drafting/strategy branches in handleOnlineMatchState) is
  // on a hidden screen from here on - anything that throws in this section
  // has to report to finalBanner instead, which IS visible on this screen.
  let rosterA, rosterB;
  try {
    const picks = await getVisiblePicks(matchId);
    const statsByKey = await fetchStatsForPicks(picks);
    ({ rosterA, rosterB } = buildVisibleState(picks, Infinity, statsByKey));
  } catch (e) {
    console.error("Failed to load final rosters for the result screen:", e);
    finalBanner.textContent = "Result saved, but the box score couldn't load - check Profile > Recent Games.";
    finalBanner.classList.remove("hidden");
    btnGameHome.classList.remove("hidden");
    return;
  }
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
btnGameHome.addEventListener("click", () => {
  cleanupOnlineWatcher();
  setActiveNav("play");
  showScreen("home");
  refreshHome();
});

// ---- Profile screen ----

const profileRefs = {
  usernameInput: document.getElementById("input-profile-username"),
  tierBadge: document.getElementById("profile-tier-badge"),
  tierCaption: document.getElementById("profile-tier-caption"),
  onlineRecord: document.getElementById("online-record"),
  offlineRecord: document.getElementById("offline-record"),
  totalGames: document.getElementById("total-games"),
  eraRecords: document.getElementById("era-records"),
  mostDrafted: document.getElementById("most-drafted"),
  topPerformances: document.getElementById("top-performances"),
  highestScoringGame: document.getElementById("highest-scoring-game"),
  largestMargin: document.getElementById("largest-margin"),
  mostTripleDoubles: document.getElementById("most-triple-doubles"),
  mostMvps: document.getElementById("most-mvps"),
  longestWinStreak: document.getElementById("longest-win-streak"),
  historyBody: document.getElementById("history-body"),
};
const profileEquippedBannerEl = document.getElementById("profile-equipped-banner");
const btnCustomizeBanner = document.getElementById("btn-customize-banner");

// Kept only so the "highest scoring game" button can open its stored box
// score on click without a second round-trip to Supabase.
let currentProfile = null;

async function openProfileScreen() {
  showScreen("profile");
  try {
    const profile = await loadProfile();
    currentProfile = profile;
    const rankInfo = await loadRankInfo(profile);
    renderProfileScreen(profileRefs, profile, rankInfo, sport());
    renderEquippedBanner(profileEquippedBannerEl, profile);
  } catch (e) {
    console.error("Failed to load profile:", e);
  }
}

btnCustomizeBanner.addEventListener("click", () => openCustomizeBannerModal());

/** "Customize Banner" from the Profile screen - the same sport-tabbed
 * banner grid Rewards > Banners shows, just reached from Profile too
 * (rather than duplicating renderBanners/renderBannerSportTabs) since
 * equipping a banner is really a profile customization, not an unlock. */
function openCustomizeBannerModal() {
  const wrap = document.createElement("div");
  const tabs = document.createElement("div");
  tabs.className = "subtabs";
  const summary = document.createElement("p");
  summary.className = "hint-text";
  const grid = document.createElement("div");
  grid.className = "banner-grid";
  wrap.append(tabs, summary, grid);

  renderBannerSportTabs(tabs, activeBannerSport, (sport) => {
    activeBannerSport = sport;
    openCustomizeBannerModal();
  });

  openModal("Customize Banner", wrap);

  // Friend count drives the friend-count banners; it isn't on the profile
  // row, so it's fetched alongside it rather than inferred.
  Promise.all([loadProfile(), countFriends().catch(() => 0)])
    .then(([profile, friendCount]) => {
      renderBanners(grid, summary, profile, onEquipBannerFromProfile, activeBannerSport, true, { friendCount });
    })
    .catch((e) => {
      console.error("Failed to load banners:", e);
      summary.textContent = "Couldn't load your banners right now.";
    });
}

async function onEquipBannerFromProfile(franchiseId) {
  try {
    await setEquippedBanner(franchiseId);
  } catch (e) {
    console.error("Failed to equip banner:", e);
    return;
  }
  openCustomizeBannerModal();
  const profile = await loadProfile();
  currentProfile = profile;
  renderEquippedBanner(profileEquippedBannerEl, profile);
}

profileRefs.highestScoringGame.addEventListener("click", () => {
  const game = currentProfile?.highestScoringGame;
  if (!game) return;
  const wrap = document.createElement("div");
  renderFullBoxScore(
    wrap,
    game.rosterA,
    game.boxA,
    game.labelA,
    game.rosterB,
    game.boxB,
    game.labelB,
    null,
    null,
    game.minutesA,
    game.minutesB,
    true
  );
  openModal(`${game.scoreFor}-${game.scoreAgainst} vs ${game.opponentLabel}`, wrap);
});

const unlockablesTabsEl = document.getElementById("unlockables-tabs");
const unlockablesBadgesEl = document.getElementById("unlockables-badges");
const unlockablesBannersEl = document.getElementById("unlockables-banners");
const badgeGridEl = document.getElementById("badge-grid");
const badgeSummaryEl = document.getElementById("badge-summary");
const badgeSportTabsEl = document.getElementById("badge-sport-tabs");
const bannerGridEl = document.getElementById("banner-grid");
const bannerSummaryEl = document.getElementById("banner-summary");
const bannerSportTabsEl = document.getElementById("banner-sport-tabs");

// Which sport's badges/banners are on screen, and which of Badges/Banners.
// Kept across visits so switching tabs and coming back doesn't reset any pick.
let activeBadgeSport = "nba";
let activeBannerSport = "nba";
let activeUnlockablesTab = "badges";

async function openBadgesScreen() {
  showScreen("badges");
  renderUnlockableTabs(unlockablesTabsEl, activeUnlockablesTab, (kind) => {
    activeUnlockablesTab = kind;
    openBadgesScreen();
  });
  unlockablesBadgesEl.classList.toggle("hidden", activeUnlockablesTab !== "badges");
  unlockablesBannersEl.classList.toggle("hidden", activeUnlockablesTab !== "banners");

  if (activeUnlockablesTab === "banners") {
    renderBannerSportTabs(bannerSportTabsEl, activeBannerSport, (sport) => {
      activeBannerSport = sport;
      openBadgesScreen();
    });
    try {
      const [profile, friendCount] = await Promise.all([loadProfile(), countFriends().catch(() => 0)]);
      renderBanners(bannerGridEl, bannerSummaryEl, profile, onEquipBanner, activeBannerSport, false, { friendCount });
    } catch (e) {
      console.error("Failed to load banners:", e);
      bannerSummaryEl.textContent = "Couldn't load your banners right now.";
    }
    return;
  }

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

/** Equipping is cosmetic, so it writes straight from the client. Repaints
 * the Rewards screen (where the equip button lives) - the home header's
 * equipped-banner display picks up the change next time it's shown, via
 * refreshHome()'s normal reload. */
async function onEquipBanner(franchiseId) {
  try {
    await setEquippedBanner(franchiseId);
  } catch (e) {
    console.error("Failed to equip banner:", e);
    return;
  }
  await openBadgesScreen();
}

// ---- Squads screen ----
// Four subtabs sharing one screen: Friends (add/accept, leaderboard,
// challenges), Home (browse/create when squad-less, or squad info + roster
// once in one), Chat (squad chat, needs a squad), Tournaments (placeholder).

const squadsTabsEl = document.getElementById("squads-tabs");
const squadsPanelFriendsEl = document.getElementById("squads-panel-friends");
const squadsPanelHomeEl = document.getElementById("squads-panel-home");
const squadsPanelChatEl = document.getElementById("squads-panel-chat");
const squadsPanelTournamentsEl = document.getElementById("squads-panel-tournaments");

const squadsBrowseEl = document.getElementById("squads-browse");
const squadsDetailEl = document.getElementById("squads-detail");
const squadStatusEl = document.getElementById("squad-status");
const squadSearchInput = document.getElementById("input-squad-search");
const squadsListEl = document.getElementById("squads-list");
const squadHeaderEl = document.getElementById("squad-header");
const squadRosterEl = document.getElementById("squad-roster");
const squadChatNoneEl = document.getElementById("squad-chat-none");
const squadChatActiveEl = document.getElementById("squad-chat-active");
const squadChatMessagesEl = document.getElementById("squad-chat-messages");
const squadChatInput = document.getElementById("input-squad-chat");

const friendUsernameInput = document.getElementById("input-friend-username");
const friendChallengesListEl = document.getElementById("friend-challenges-list");
const friendRequestsListEl = document.getElementById("friend-requests-list");
const friendsLeaderboardEl = document.getElementById("friends-leaderboard");

// Which of the four subtabs is showing, kept across visits like every other
// subtab pattern in this app.
let activeSquadsTab = "home";

// Cache of the last-loaded squad detail, so toggling the settings editor is
// a pure re-render (no round trip) - only actual mutations refetch. Cleared
// whenever the player leaves the squads tab or their squad changes.
let squadDetailData = null;
let squadEditing = false;

function setSquadStatus(message, kind) {
  squadStatusEl.textContent = message || "";
  squadStatusEl.classList.toggle("hidden", !message);
  squadStatusEl.classList.toggle("auth-error", kind === "error");
}

/** Runs a squads.js mutation, shows its error message inline (these are
 * already player-facing text - see the `raise exception` strings in the
 * squads_*_rpcs migrations) instead of throwing, and refreshes the screen
 * on success. Used by every button that changes squad/roster state. */
async function runSquadAction(fn) {
  try {
    await fn();
    setSquadStatus("");
  } catch (e) {
    setSquadStatus(e.message || "Something went wrong.", "error");
    return;
  }
  await openSquadsScreen();
}

/** Same shape as runSquadAction, for friends.js mutations - kept separate
 * because it refreshes only the Friends panel, not the whole screen. */
async function runFriendAction(fn) {
  try {
    await fn();
    setSquadStatus("");
  } catch (e) {
    setSquadStatus(e.message || "Something went wrong.", "error");
    return;
  }
  await loadFriendsPanel();
}

let squadSearchDebounce = null;
squadSearchInput.addEventListener("input", () => {
  clearTimeout(squadSearchDebounce);
  squadSearchDebounce = setTimeout(() => refreshSquadBrowseList(squadSearchInput.value), 300);
});

async function refreshSquadBrowseList(search = "") {
  try {
    const squads = await listPublicSquads(search);
    renderSquadBrowseList(squadsListEl, squads, (squadId) => runSquadAction(() => joinPublicSquad(squadId)));
  } catch (e) {
    console.error("Failed to load squads:", e);
    setSquadStatus("Couldn't load squads right now.", "error");
  }
}

async function openSquadsScreen() {
  showScreen("squads");
  cleanupSquadChatWatcher();
  renderSquadsTopTabs(squadsTabsEl, activeSquadsTab, (tab) => {
    activeSquadsTab = tab;
    openSquadsScreen();
  });
  setSquadStatus("");

  squadsPanelFriendsEl.classList.toggle("hidden", activeSquadsTab !== "friends");
  squadsPanelHomeEl.classList.toggle("hidden", activeSquadsTab !== "home");
  squadsPanelChatEl.classList.toggle("hidden", activeSquadsTab !== "chat");
  squadsPanelTournamentsEl.classList.toggle("hidden", activeSquadsTab !== "tournaments");

  if (activeSquadsTab === "friends") {
    await loadFriendsPanel();
    return;
  }
  if (activeSquadsTab === "tournaments") {
    return;
  }

  // Home and Chat both hinge on squad membership.
  squadDetailData = null;
  squadEditing = false;
  try {
    const membership = await myMembership();
    if (!membership) {
      if (activeSquadsTab === "home") {
        squadsBrowseEl.classList.remove("hidden");
        squadsDetailEl.classList.add("hidden");
        await refreshSquadBrowseList(squadSearchInput.value);
      } else {
        squadChatNoneEl.classList.remove("hidden");
        squadChatActiveEl.classList.add("hidden");
      }
      return;
    }
    if (activeSquadsTab === "home") {
      squadsBrowseEl.classList.add("hidden");
      squadsDetailEl.classList.remove("hidden");
      // Needed before the roster renders, so Add Friend is hidden on people
      // you're already connected to rather than appearing then vanishing.
      await refreshKnownFriendIds();
    } else {
      squadChatNoneEl.classList.add("hidden");
      squadChatActiveEl.classList.remove("hidden");
    }
    await loadSquadDetail();
  } catch (e) {
    console.error("Failed to load squad membership:", e);
    setSquadStatus("Couldn't load your squad right now.", "error");
  }
}

/** Fetches the caller's squad + roster + rank, then renders whichever of
 * Home/Chat is actually active - the other tab's content stays stale until
 * it's opened, and the chat poller only ever runs while Chat is on screen. */
async function loadSquadDetail() {
  const detail = await loadMySquad();
  if (!detail) {
    // Left/kicked between the membership check and here - just re-enter.
    await openSquadsScreen();
    return;
  }
  const rankInfo = squadRankInfo(detail.squad);
  const session = await getSession();
  squadDetailData = { ...detail, rankInfo, myUserId: session.user.id };

  if (activeSquadsTab === "home") {
    renderSquadDetailFromCache();
  } else if (activeSquadsTab === "chat") {
    cleanupSquadChatWatcher();
    squadChatStop = watchSquadChat(detail.squad.id, (messages) => {
      renderSquadChat(squadChatMessagesEl, messages, squadDetailData.myUserId);
    });
  }
}

/** Re-renders the header + roster from the cached detail - no network call.
 * Used after toggling the settings editor, which is pure UI state. */
function renderSquadDetailFromCache() {
  if (!squadDetailData) return;
  const { squad, myRole, roster, inviteCode, rankInfo, myUserId } = squadDetailData;
  renderSquadHeader(
    squadHeaderEl,
    { squad, myRole, memberCount: roster.length, rankInfo, inviteCode, editing: squadEditing },
    {
      onToggleEdit: () => {
        squadEditing = !squadEditing;
        renderSquadDetailFromCache();
      },
      onRegenerateCode: () => runSquadAction(() => regenerateInviteCode()),
      onDisband: () => {
        if (!window.confirm(`Disband ${squad.name}? This removes every member and can't be undone.`)) return;
        runSquadAction(() => disbandSquad());
      },
      // Don't optimistically close the editor here - runSquadAction only
      // re-renders (via a full openSquadsScreen(), which naturally resets
      // squadEditing) on success. On failure it leaves the form exactly as
      // the player left it, with their typed changes intact, so flipping
      // squadEditing here first would desync in-memory state from what's
      // still on screen if the save fails.
      onSaveSettings: ({ emoji, motto, visibility }) => {
        runSquadAction(() => updateSquadSettings({ emoji, motto, visibility }));
      },
    }
  );

  renderSquadRoster(
    squadRosterEl,
    roster,
    myUserId,
    myRole,
    {
      onSetRole: (userId, role) => runSquadAction(() => setMemberRole(userId, role)),
      onTransfer: (userId) => {
        if (!window.confirm("Make this player the new leader? You'll become a co-leader.")) return;
        runSquadAction(() => transferLeadership(userId));
      },
      onKick: (userId) => {
        if (!window.confirm("Remove this player from the squad?")) return;
        runSquadAction(() => kickMember(userId));
      },
      onAddFriend: (username) => addFriendFromSquad(username),
    },
    squadKnownFriendIds
  );
}

/** Ids we already have a friendship row with (accepted OR pending, either
 * direction) - the squad roster hides its Add Friend button for these, so it
 * never offers a request the server would reject as a duplicate. Refreshed
 * whenever the squad screen loads; an empty set just means every button
 * shows, which is the safe direction to fail in. */
let squadKnownFriendIds = new Set();

async function refreshKnownFriendIds() {
  try {
    const [leaderboard, incoming, outgoing] = await Promise.all([
      listFriendsLeaderboard(),
      listIncomingRequests(),
      listOutgoingRequests(),
    ]);
    squadKnownFriendIds = new Set([
      ...leaderboard.map((e) => e.userId),
      ...incoming.map((r) => r.requesterId),
      ...outgoing.map((r) => r.addresseeId),
    ]);
  } catch (e) {
    console.error("Couldn't load existing friendships:", e);
    squadKnownFriendIds = new Set();
  }
}

async function addFriendFromSquad(username) {
  try {
    await sendFriendRequest(username);
  } catch (e) {
    window.alert(`Couldn't send that friend request: ${e.message}`);
    return;
  }
  await refreshKnownFriendIds();
  renderSquadDetailFromCache();
}

document.getElementById("btn-leave-squad").addEventListener("click", () => {
  const label = squadDetailData ? squadDetailData.squad.name : "your squad";
  if (!window.confirm(`Leave ${label}?`)) return;
  runSquadAction(() => leaveSquad());
});

document.getElementById("btn-squad-chat-send").addEventListener("click", sendSquadChatFromInput);
squadChatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendSquadChatFromInput();
});
async function sendSquadChatFromInput() {
  const body = squadChatInput.value.trim();
  if (!body || !squadDetailData) return;
  squadChatInput.value = "";
  try {
    await sendSquadMessage(squadDetailData.squad.id, body);
  } catch (e) {
    console.error("Failed to send squad chat:", e);
    setSquadStatus(e.message || "Couldn't send that message.", "error");
  }
}

// ---- Friends panel ----

async function loadFriendsPanel() {
  try {
    const [challenges, incoming, outgoing, leaderboard] = await Promise.all([
      listPendingChallenges(),
      listIncomingRequests(),
      listOutgoingRequests(),
      listFriendsLeaderboard(),
    ]);
    renderFriendChallenges(friendChallengesListEl, challenges, onJoinChallenge);
    renderFriendRequests(friendRequestsListEl, incoming, outgoing, {
      onAccept: (id) => runFriendAction(() => acceptFriendRequest(id)),
      onDecline: (id) => runFriendAction(() => declineFriendRequest(id)),
      // Cancelling a request you sent uses the same RPC as declining one you
      // received - decline_friend_request checks both directions.
      onCancel: (id) => runFriendAction(() => declineFriendRequest(id)),
    });
    renderFriendsLeaderboard(friendsLeaderboardEl, leaderboard, {
      onChallenge: onChallengeFriend,
      onRemove: (friendId) => {
        if (!window.confirm("Remove this friend?")) return;
        runFriendAction(() => removeFriend(friendId));
      },
    });
  } catch (e) {
    console.error("Failed to load friends:", e);
    setSquadStatus("Couldn't load friends right now.", "error");
  }
}

// Deliberately NOT routed through runFriendAction: success here means
// leaving the squads screen entirely for the draft screen, which a
// loadFriendsPanel()/openSquadsScreen() refresh afterward would undo.
async function onChallengeFriend(friendId) {
  try {
    const matchId = await challengeFriend(friendId, getSport(), getEra());
    await enterOnlineMatch(matchId);
  } catch (e) {
    setSquadStatus(e.message || "Couldn't start that challenge.", "error");
  }
}

async function onJoinChallenge(matchId) {
  try {
    await enterOnlineMatch(matchId);
  } catch (e) {
    setSquadStatus(e.message || "Couldn't open that match.", "error");
  }
}

document.getElementById("btn-send-friend-request").addEventListener("click", async () => {
  const username = friendUsernameInput.value.trim();
  if (!username) return;
  try {
    await sendFriendRequest(username);
    friendUsernameInput.value = "";
    setSquadStatus("");
  } catch (e) {
    setSquadStatus(e.message || "Couldn't send that request.", "error");
    return;
  }
  await loadFriendsPanel();
});

document.getElementById("btn-join-by-code").addEventListener("click", () => {
  const wrap = document.createElement("div");

  const field = document.createElement("div");
  field.className = "field-row";
  field.innerHTML = `<label for="input-join-code">Invite code</label>`;
  const codeInput = document.createElement("input");
  codeInput.id = "input-join-code";
  codeInput.type = "text";
  codeInput.maxLength = 6;
  codeInput.placeholder = "e.g. BDF870";
  field.appendChild(codeInput);
  wrap.appendChild(field);

  const errorEl = document.createElement("div");
  errorEl.className = "auth-status hidden";
  wrap.appendChild(errorEl);

  const joinBtn = document.createElement("button");
  joinBtn.type = "button";
  joinBtn.className = "btn btn-primary btn-block";
  joinBtn.textContent = "Join Squad";
  joinBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    if (!code) return;
    try {
      await joinSquadByCode(code);
    } catch (e) {
      errorEl.textContent = e.message || "That code didn't work.";
      errorEl.classList.remove("hidden");
      errorEl.classList.add("auth-error");
      return;
    }
    closeModal();
    await openSquadsScreen();
  });
  wrap.appendChild(joinBtn);

  openModal("Join by Invite Code", wrap);
});

document.getElementById("btn-create-squad").addEventListener("click", () => {
  const wrap = document.createElement("div");
  let chosenEmoji = "🏀";

  const nameField = document.createElement("div");
  nameField.className = "field-row";
  nameField.innerHTML = `<label for="input-squad-name">Name</label>`;
  const nameInput = document.createElement("input");
  nameInput.id = "input-squad-name";
  nameInput.type = "text";
  nameInput.maxLength = 30;
  nameInput.placeholder = "3-30 characters";
  nameField.appendChild(nameInput);
  wrap.appendChild(nameField);

  const tagField = document.createElement("div");
  tagField.className = "field-row";
  tagField.innerHTML = `<label for="input-squad-tag">Tag</label>`;
  const tagInput = document.createElement("input");
  tagInput.id = "input-squad-tag";
  tagInput.type = "text";
  tagInput.maxLength = 5;
  tagInput.placeholder = "2-5 letters/numbers";
  tagField.appendChild(tagInput);
  wrap.appendChild(tagField);

  const emojiLabel = document.createElement("div");
  emojiLabel.className = "field-row";
  emojiLabel.innerHTML = `<label>Crest</label>`;
  wrap.appendChild(emojiLabel);
  const emojiPalette = document.createElement("div");
  emojiPalette.className = "squad-emoji-palette";
  wrap.appendChild(emojiPalette);
  const paintCreatePalette = () => {
    renderSquadEmojiPalette(emojiPalette, chosenEmoji, (emoji) => {
      chosenEmoji = emoji;
      paintCreatePalette();
    });
  };
  paintCreatePalette();

  const mottoField = document.createElement("div");
  mottoField.className = "field-row";
  mottoField.innerHTML = `<label for="input-squad-motto">Motto (optional)</label>`;
  const mottoInput = document.createElement("textarea");
  mottoInput.id = "input-squad-motto";
  mottoInput.maxLength = 120;
  mottoInput.rows = 2;
  mottoField.appendChild(mottoInput);
  wrap.appendChild(mottoField);

  const visField = document.createElement("div");
  visField.className = "field-row";
  visField.innerHTML = `<label for="input-squad-visibility">Visibility</label>`;
  const visSelect = document.createElement("select");
  visSelect.id = "input-squad-visibility";
  visSelect.innerHTML = `<option value="public">Public - anyone can join</option><option value="private">Private - invite code only</option>`;
  visField.appendChild(visSelect);
  wrap.appendChild(visField);

  const errorEl = document.createElement("div");
  errorEl.className = "auth-status hidden";
  wrap.appendChild(errorEl);

  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.className = "btn btn-primary btn-block";
  createBtn.textContent = "Create Squad";
  const showCreateError = (message) => {
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
    errorEl.classList.add("auth-error");
  };

  createBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const tag = tagInput.value.trim();
    if (!name || !tag) return;
    // Client-side checks matching the squads table's own constraints, so a
    // bad tag surfaces a readable message here instead of a raw Postgres
    // check-constraint error from the RPC (which only catches name/tag
    // uniqueness itself, not format - see create_squad in the migrations).
    if (name.length < 3 || name.length > 30) {
      showCreateError("Name must be 3-30 characters.");
      return;
    }
    if (!/^[A-Za-z0-9]{2,5}$/.test(tag)) {
      showCreateError("Tag must be 2-5 letters or numbers, no spaces or symbols.");
      return;
    }
    try {
      await createSquad({ name, tag, emoji: chosenEmoji, motto: mottoInput.value.trim(), visibility: visSelect.value });
    } catch (e) {
      showCreateError(e.message || "Couldn't create that squad.");
      return;
    }
    closeModal();
    await openSquadsScreen();
  });
  wrap.appendChild(createBtn);

  openModal("Create a Squad", wrap);
});

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
