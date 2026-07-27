// App controller: wires draft state + engine + profile to the DOM.
// Three modes share these same screens/DOM elements:
//   - "bot": synchronous, client-only (DraftState from draft.js).
//   - "online": async, server-authoritative (Supabase - see online.js).

import { PLAYERS } from "./data.js";
import { buildRecap } from "./recap.js";
import { DEFAULT_TACTIC, TACTICS } from "./tactics.js";

const TACTIC_IDS = TACTICS.map((t) => t.id);
import { simulateGame } from "./engine.js";
import { DraftState, eligibleOpenSlots, worstEligiblePick } from "./draft.js";
import { SLOTS, QUARTER_REVEAL_DELAY_MS, DRAFT_REVEAL_DELAY_MS, PICK_TIMER_SECONDS } from "./constants.js";
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
  renderLiveBox,
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
    hint: "Practice against the bot with every player and their stats on screen. Doesn't affect your rank.",
  },
  "practice-hard": {
    mode: "bot",
    ruleset: "strict",
    hint: "Ranked rules against the bot: type names from memory, no stats, pick clock running. Doesn't affect your rank.",
  },
  online: {
    mode: "online",
    ruleset: "strict",
    hint: "Ranked: a real opponent, no stats, pick clock on both sides. Wins and losses count toward your rank.",
  },
};

const modeHintEl = document.getElementById("mode-hint");
const tacticGridEl = document.getElementById("tactic-grid");

// Your game plan for the next match. Kept between games so a preferred style
// sticks rather than resetting to Balanced every time.
let selectedTactic = DEFAULT_TACTIC;

function renderTactics() {
  renderTacticPicker(tacticGridEl, selectedTactic, (id) => {
    selectedTactic = id;
    renderTactics();
  });
}
renderTactics();

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

function startDraft() {
  cleanupPickTimer();
  applyRulesetToDraftUI();
  game.draft = new DraftState(PLAYERS, recentSquadIds);
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
  const eligibleForPending = pending ? eligibleOpenSlots(pending, roster) : null;

  renderPositionSelector(positionSelectorEl, roster, eligibleForPending, (slot) => {
    finalizePick(game.round.pendingPlayer, slot);
  });

  renderPoolForCurrentState();

  renderRosterPanel(rosterPanelA, draft.rosterA, game.nameA, side === "A", { pendingSlots: pendingSlotsFor("A") });
  renderRosterPanel(rosterPanelB, draft.rosterB, game.nameB, side === "B", { pendingSlots: pendingSlotsFor("B") });
}

function renderPoolForCurrentState() {
  const draft = game.draft;
  const side = game.round.activeSide;
  const pendingName = game.round.pendingPlayer ? game.round.pendingPlayer.name : null;
  renderPool(poolList, draft.currentSquad, poolSearch.value, rosterFor(side), pendingName, onPoolPick, PLAYERS, game.ruleset);
}

function onPoolPick(player) {
  const roster = rosterFor(game.round.activeSide);
  const slots = eligibleOpenSlots(player, roster);
  if (slots.length === 1) {
    finalizePick(player, slots[0]);
  } else {
    game.round.pendingPlayer = player;
    renderDraftRound();
  }
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
  const combo = worstEligiblePick(draft.currentSquad, rosterFor(side));
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

  renderRosterPanel(rosterPanelA, draft.rosterA, game.nameA, false, { revealSlots: pendingSlotsFor("A") });
  renderRosterPanel(rosterPanelB, draft.rosterB, game.nameB, false, { revealSlots: pendingSlotsFor("B") });
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

  renderRosterPanel(rosterPanelA, draft.rosterA, game.nameA, false);
  renderRosterPanel(rosterPanelB, draft.rosterB, game.nameB, false);

  poolList.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "btn btn-primary btn-block";
  btn.textContent = "Simulate Game";
  btn.addEventListener("click", runLocalSimulation);
  poolList.appendChild(btn);
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
const liveBoxEl = document.getElementById("live-box");
const recapHeadlineEl = document.getElementById("recap-headline");
const recapDetailEl = document.getElementById("recap-detail");
const fullBoxScore = document.getElementById("full-box-score");
const btnToProfile = document.getElementById("btn-to-profile");
const btnPlayAgain = document.getElementById("btn-play-again");

const REGULATION_PERIODS = 4;

/** Distributes a team's true final score across periods proportionally to
 * that period's raw simulated share, so the live reveal ends up exactly at
 * the real final score while still showing quarter-to-quarter variance. */
function computeDisplayPeriodScores(quarterBoxScores, finalScore, teamKey) {
  const raw = quarterBoxScores.map((q) => Object.values(q[teamKey]).reduce((sum, line) => sum + line.pts, 0));
  const rawTotal = raw.reduce((a, b) => a + b, 0) || 1;
  const deltas = raw.map((v) => Math.round((finalScore * v) / rawTotal));
  const sum = deltas.reduce((a, b) => a + b, 0);
  deltas[deltas.length - 1] += finalScore - sum;
  return deltas;
}

/** Plays the live quarter-by-quarter reveal and final box score for any
 * already-computed result (local simulateGame() output or a normalized
 * server result), then calls onComplete() once everything is on screen. */
function playOutResult({ result, labelA, labelB, rosterA, rosterB, onComplete }) {
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
  const liveTotals = { a: {}, b: {} };
  for (const slot of SLOTS) {
    liveTotals.a[slot] = { pts: 0, reb: 0, ast: 0 };
    liveTotals.b[slot] = { pts: 0, reb: 0, ast: 0 };
  }

  clearPlayFeed(playFeedEl);
  liveBoxEl.classList.remove("hidden");
  renderLiveBox(liveBoxEl, rosterA, rosterB, labelA, labelB, liveTotals);
  renderScoreboard(liveScoreboard, labelA, labelB, periodsSoFar, REGULATION_PERIODS, 0, 0, "Tip-off", true);
  pushPlayHeadline(playFeedEl, `${labelA} vs ${labelB} — tip-off`);

  /** Standout lines from the period just played, worth calling out. The
   * thresholds are per-quarter, so they fire for a genuinely hot stretch
   * rather than for anyone who merely showed up. */
  function announcePeriod(periodIndex, label) {
    const q = result.quarterBoxScores[periodIndex];
    const calls = [];
    for (const [key, roster, teamLabel] of [
      ["a", rosterA, labelA],
      ["b", rosterB, labelB],
    ]) {
      for (const slot of SLOTS) {
        const line = q[key][slot];
        const player = roster[slot];
        if (!line || !player) continue;
        // Tuned against real per-quarter output: a starter averages roughly
        // 4-6 points a quarter, so 8+ is a genuinely hot stretch rather than
        // just showing up.
        if (line.pts >= 8) calls.push({ text: `${player.name} pours in ${Math.round(line.pts)} in ${label}`, tone: "hot" });
        else if (line.reb >= 4.5) calls.push({ text: `${player.name} owns the glass — ${Math.round(line.reb)} boards in ${label}`, tone: "" });
        else if (line.ast >= 3.5) calls.push({ text: `${player.name} carving it up, ${Math.round(line.ast)} dimes in ${label}`, tone: "" });
        else if (line.blk >= 1.8) calls.push({ text: `${player.name} shutting the rim down in ${label}`, tone: "" });
      }
      void teamLabel;
    }
    // At most two calls per period: a feed that never stops talking stops
    // meaning anything.
    calls.sort(() => Math.random() - 0.5);
    for (const call of calls.slice(0, 2)) pushPlayHeadline(playFeedEl, call.text, call.tone);
  }

  function step() {
    if (i >= deltaA.length) {
      finish();
      return;
    }
    const isOt = result.quarterBoxScores[i].overtime;
    const label = isOt ? `OT${i - REGULATION_PERIODS}` : `Q${i + 1}`;
    periodsSoFar.push({ label, a: deltaA[i], b: deltaB[i] });
    runningA += deltaA[i];
    runningB += deltaB[i];

    for (const slot of SLOTS) {
      for (const key of ["a", "b"]) {
        const src = result.quarterBoxScores[i][key][slot];
        if (!src) continue;
        liveTotals[key][slot].pts += src.pts;
        liveTotals[key][slot].reb += src.reb;
        liveTotals[key][slot].ast += src.ast;
      }
    }

    const regulationPlayed = periodsSoFar.filter((p) => !p.label.startsWith("OT")).length;
    const periodsRemaining = Math.max(0, REGULATION_PERIODS - regulationPlayed);
    renderScoreboard(
      liveScoreboard,
      labelA,
      labelB,
      periodsSoFar,
      periodsRemaining,
      runningA,
      runningB,
      `End of ${label}`,
      true
    );
    renderLiveBox(liveBoxEl, rosterA, rosterB, labelA, labelB, liveTotals);
    announcePeriod(i, label);

    const lead = Math.abs(runningA - runningB);
    if (i === deltaA.length - 1 && lead <= 4) {
      pushPlayHeadline(playFeedEl, "Down to the wire!", "hot");
    }

    i += 1;
    setTimeout(step, QUARTER_REVEAL_DELAY_MS);
  }

  function finish() {
    renderScoreboard(liveScoreboard, labelA, labelB, periodsSoFar, 0, runningA, runningB, "Final", false);

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

    renderFullBoxScore(fullBoxScore, rosterA, result.boxA, labelA, rosterB, result.boxB, labelB, shotsA, shotsB);
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
  const result = simulateGame(draft.rosterA, draft.rosterB, datasetStats, {
    tacticA: selectedTactic,
    tacticB: botTactic,
  });

  playOutResult({
    result,
    labelA: game.nameA,
    labelB: game.nameB,
    rosterA: draft.rosterA,
    rosterB: draft.rosterB,
    onComplete: () => {
      const ownLines = SLOTS.map((slot) => ({ playerName: draft.rosterA[slot].name, line: result.boxA[slot] }));

      recordPracticeResult({
        mode: "offline",
        opponentLabel: "Bot",
        won: result.winner === "A",
        draftedTeams: SLOTS.map((slot) => draft.rosterA[slot].team),
        ruleset: game.ruleset,
        scoreFor: result.teamScoreA,
        scoreAgainst: result.teamScoreB,
        mvpName: result.mvp.player.name,
        ownLines,
      }).catch((e) => console.error("Failed to record result:", e));

      recordDraftPicks(SLOTS.map((slot) => draft.rosterA[slot].name)).catch((e) =>
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
