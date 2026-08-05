// App controller: wires draft state + engine + profile to the DOM.
// Three modes share these same screens/DOM elements:
//   - "bot": synchronous, client-only (DraftState from draft.js).
//   - "online": async, server-authoritative (Supabase - see online.js).

import { confetti, playBuzzer, playFanfare, playDefeat, playWhoosh, playPop, replayAnimation } from "./celebrate.js";
import { snapshotProgress, progressGains } from "./progress.js";
import { game, strategy } from "./state.js";
import { showScreen, setActiveNav, openModal, closeModal, sleep } from "./shell.js";
import { initSquadsScreen, openSquadsScreen, cleanupSquadChatWatcher } from "./screens/squads.js";
import { startPresence } from "./presence.js";
import { DraftState, eligibleOpenSlots, worstEligiblePick } from "./draft.js";
import { QUARTER_REVEAL_DELAY_MS, QUARTER_TICK_MS, OT_REVEAL_DELAY_MS, OT_TICK_MS, DRAFT_REVEAL_DELAY_MS, PICK_TIMER_SECONDS, TACTIC_TIMER_SECONDS, ROTATION_TIMER_SECONDS, ONLINE_ROTATION_TIMER_SECONDS, MATCHUP_TIMER_SECONDS, ONLINE_QUEUE_TIMEOUT_SECONDS, RESULT_WAIT_MS, ONLINE_QUEUE_POLL_MS, MIN_SEARCH_CHARS } from "./constants.js";
// Slot lists and the default era still come from basketball directly. They are
// read at module scope for DOM wiring that runs before any sport is chosen;
// unpicking that is a separate change from this one.
// DEFAULT_ERA only. Slot shapes come from sport().slots - shared code
// importing basketball's roster is what dealt PG/SG/SF/PF/C in an NFL draft.
import { DEFAULT_ERA } from "./sports/nba/constants.js";
import { SPORTS, sportById, isLive, isSelectable, DEFAULT_SPORT_ID, activeSport, activeSportId, setActiveSport } from "./sports/index.js";
import {
  loadProfile,
  loadRankInfo,
  loadOverallRankInfo,
  recordPracticeResult,
  recordDraftPicks,
  setUsername,
  setEquippedBanner,
  setFeaturedBadges,
  FEATURED_BADGE_SLOTS,
  RANK_GAMES_FLOOR,
  allSportRatings,
} from "./profile.js";
import { countFriends } from "./friends.js";
import { GENERAL_TIERS } from "./ranks.js";
import { START_RATING } from "./rating.js";
import {
  getSession,
  requireSession,
  signUp,
  signIn,
  signOut,
  requestPasswordReset,
  updatePassword,
  updateEmail,
  getAuthUser,
  onPasswordRecovery,
  isPlaceholderEmail,
  USERNAME_PATTERN,
  EMAIL_PATTERN,
} from "./supabaseClient.js";
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


/** Stops the online match poller. Lives here rather than in shell.js because
 * it is about a match in progress, not about app chrome - shell.js knows
 * nothing about basketball. */
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

/** Position picker: which open slot should this player fill? */
function openSlotPicker(player, slots, onChoose, onCancel) {
  const wrap = document.createElement("div");

  const who = document.createElement("div");
  who.className = "modal-player";
  who.textContent = player.name;
  wrap.appendChild(who);

  const meta = document.createElement("div");
  meta.className = "modal-player-meta";
  // The season, not the decade: by this point a year has been chosen and the
  // slot picker should confirm which one, or the last thing you see before
  // committing disagrees with what you committed to.
  meta.textContent = `${player.pos.join(" / ")} · ${player.season || player.decade} ${player.team}`;
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

// The rules differ per sport - basketball drafts ten individuals, football
// drafts units - so the text belongs beside the engine that enforces it. See
// each sport module's `howToPlay`.
function openHowToPlay(sportId = activeSportId()) {
  const s = sportById(sportId);
  const wrap = document.createElement("div");
  for (const [heading, body] of s.howToPlay || []) {
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
  openModal(`How to Play: ${s.name}`, wrap);
}

// ---- Auth screen ----
// The whole app sits behind this: no anonymous play, so a player's record,
// badges and rank always belong to a real account they can come back to.

const navTabs = document.getElementById("nav-tabs");
const authHeading = document.getElementById("auth-heading");
const authSubheading = document.getElementById("auth-subheading");
const inputAuthEmail = document.getElementById("input-auth-email");
const inputAuthIdentifier = document.getElementById("input-auth-identifier");
const inputAuthUsername = document.getElementById("input-auth-username");
const inputAuthPassword = document.getElementById("input-auth-password");
const fieldAuthEmail = document.getElementById("field-auth-email");
const fieldAuthIdentifier = document.getElementById("field-auth-identifier");
const fieldAuthUsername = document.getElementById("field-auth-username");
const btnAuthSubmit = document.getElementById("btn-auth-submit");
const btnAuthToggle = document.getElementById("btn-auth-toggle");
const btnAuthForgot = document.getElementById("btn-auth-forgot");
const authForgotRow = document.getElementById("auth-forgot-row");
const authSwitchLabel = document.getElementById("auth-switch-label");
const authStatusEl = document.getElementById("auth-status");
const signedInAsEl = document.getElementById("signed-in-as");

// "signin" | "signup" | "recover" - the third is the state a password-reset
// link lands in, where the only thing on screen is a new password box.
let authMode = "signin";

function setAuthStatus(message, kind) {
  authStatusEl.textContent = message || "";
  authStatusEl.classList.toggle("hidden", !message);
  authStatusEl.classList.toggle("auth-error", kind === "error");
}

/** One screen, three jobs. Which fields exist is the only difference between
 * them, so they're driven from one table rather than three near-copies of the
 * same markup. */
function renderAuthMode() {
  const isSignup = authMode === "signup";
  const isRecover = authMode === "recover";

  fieldAuthEmail.hidden = !isSignup;
  fieldAuthUsername.hidden = !isSignup;
  fieldAuthIdentifier.hidden = isSignup || isRecover;
  authForgotRow.hidden = isSignup || isRecover;
  btnAuthToggle.parentElement.hidden = isRecover;

  if (isRecover) {
    authHeading.textContent = "Set a New Password";
    authSubheading.textContent = "You're signed in from the reset link - choose a new password.";
    btnAuthSubmit.textContent = "Save Password";
  } else if (isSignup) {
    authHeading.textContent = "Create Account";
    authSubheading.textContent =
      "Email is how you get back in if you forget your password. Your username is what opponents see.";
    btnAuthSubmit.textContent = "Create Account";
  } else {
    authHeading.textContent = "Sign In";
    authSubheading.textContent = "Sign in to keep your record, badges, and rank.";
    btnAuthSubmit.textContent = "Sign In";
  }

  btnAuthToggle.textContent = isSignup ? "Sign in instead" : "Create an account";
  authSwitchLabel.textContent = isSignup ? "Already have an account?" : "New here?";
  inputAuthPassword.placeholder = isRecover ? "New password, at least 6 characters" : "At least 6 characters";
  inputAuthPassword.autocomplete = isSignup || isRecover ? "new-password" : "current-password";
  setAuthStatus("");
}

btnAuthToggle.addEventListener("click", () => {
  authMode = authMode === "signup" ? "signin" : "signup";
  renderAuthMode();
});

/** Mails a reset link. Resolving a legacy username here would send mail to
 * the synthetic address that account was created with, which nobody can read
 * - so that case is called out rather than silently "sent". */
btnAuthForgot.addEventListener("click", async () => {
  const identifier = inputAuthIdentifier.value.trim();
  if (!identifier) {
    setAuthStatus("Enter your email address first, then tap this.", "error");
    return;
  }
  btnAuthForgot.disabled = true;
  setAuthStatus("Sending a reset link…");
  try {
    const { placeholder } = await requestPasswordReset(identifier);
    if (placeholder) {
      setAuthStatus(
        "That's an older username-only account, so there's no inbox to send to. Sign in with your password and add an email on the Profile tab.",
        "error"
      );
    } else {
      setAuthStatus("Reset link sent. Check your inbox, then come back here.");
    }
  } catch (e) {
    setAuthStatus(e.message || "Couldn't send that. Try again.", "error");
  } finally {
    btnAuthForgot.disabled = false;
  }
});

function showAuthScreen(mode = "signin") {
  navTabs.hidden = true;
  authMode = mode;
  renderAuthMode();
  showScreen("auth");
}

// Opening a recovery link drops the player into the app already signed in on
// a temporary session, which looks like an ordinary sign-in and isn't - they
// came here to change a password. Catching the event is the only reliable way
// to tell the difference.
onPasswordRecovery(() => {
  showAuthScreen("recover");
}).catch((e) => console.error("Could not listen for password recovery:", e));

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
  await reconcileUsername();
  await refreshHome();
}

/** Writes the username from the signup metadata onto the profile if the row
 * still carries the placeholder.
 *
 * The database trigger now reads that metadata itself
 * (20260804_01_username_from_signup_metadata.sql), so this is not the primary
 * fix - it is for accounts created BEFORE that landed, and for any path where
 * signUp returns no session and so never reaches setUsername(). Both end with
 * a player called "Player" who never chose that.
 *
 * Deliberately only overwrites the placeholder: someone who has since renamed
 * themselves must not have an old signup value put back. */
async function reconcileUsername() {
  try {
    const user = await getAuthUser();
    const intended = user?.user_metadata?.username;
    if (!intended || !USERNAME_PATTERN.test(intended)) return;
    const profile = await loadProfile();
    if (profile.username && profile.username !== "Player") return;
    await setUsername(intended);
  } catch (e) {
    // A cosmetic repair. It must never be the reason somebody can't get in.
    console.error("Could not reconcile the username:", e);
  }
}

const homeSportCardsEl = document.getElementById("home-sport-cards");

/** The home screen's sport list: one card per sport, and the only way in.
 *
 * Each card carries the three things that are per-sport and used to be
 * app-wide - where you stand in it, its rank ladder, its rules - and the card
 * body itself is the button that takes you into playing it. That is the whole
 * shape of the screen: pick a sport, or read about one.
 *
 * The ladder and How to Play buttons sit INSIDE the card but are not part of
 * the card's own button, because a click on "How to Play" must not also change
 * sport and walk you into the Play screen. */
async function renderHomeSportCards(profile, population = null) {
  homeSportCardsEl.innerHTML = "";
  // One read of the ratings table for every card. Letting each loadRankInfo
  // fetch its own would scan `profiles` once per sport, and that cost grows
  // with the sport list rather than staying flat.
  const rows = population || (await allSportRatings().catch(() => []));
  const standings = await Promise.all(
    SPORTS.map((s) => (s.live ? loadRankInfo(profile, s.id, rows).catch(() => null) : Promise.resolve(null)))
  );

  SPORTS.forEach((s, i) => {
    const info = standings[i];
    const selectable = isSelectable(s.id);

    const card = document.createElement("div");
    // Three states, not two: playable, previewable (selectable but not
    // playable) and locked. A preview card opens so its screens can be seen
    // and built; what it can't do is start a game.
    card.className = "sport-card" + (s.live ? "" : selectable ? " preview" : " locked");
    // Its own accent, even though this screen is sport-neutral: the colour is
    // how you recognise the sport before reading the word, and a row of
    // identical grey cards would throw that away.
    if (s.theme) card.style.setProperty("--card-accent", s.theme.accent);

    const open = document.createElement("button");
    open.type = "button";
    open.className = "sport-card-open";
    open.disabled = !selectable;
    open.innerHTML =
      `<span class="sport-card-icon" aria-hidden="true"></span>` +
      `<span class="sport-card-text">` +
      `<span class="sport-card-name"></span>` +
      `<span class="sport-card-rank"></span>` +
      `</span>` +
      `<span class="sport-card-go" aria-hidden="true">${selectable ? "▸" : "🔒"}</span>`;
    open.querySelector(".sport-card-icon").textContent = s.icon;
    open.querySelector(".sport-card-name").textContent = s.name;

    let rankText;
    if (!s.live) rankText = s.status || "Coming soon";
    else if (!info || info.provisional) {
      const need = info ? info.gamesNeeded : RANK_GAMES_FLOOR;
      rankText = `Unranked — ${need} more online ${need === 1 ? "game" : "games"}`;
    } else rankText = `${info.tier.name} — ${info.rating}`;
    open.querySelector(".sport-card-rank").textContent = rankText;

    if (selectable) {
      open.addEventListener("click", () => {
        setSport(s.id);
        showScreen("play");
      });
    }
    card.appendChild(open);

    // A sport with no ladder written yet gets no ladder button rather than one
    // that opens an empty modal.
    const actions = document.createElement("div");
    actions.className = "sport-card-actions";
    if ((s.tiers || []).length) {
      actions.appendChild(sportCardAction("🏆 Rank", () => openRankLadder(s.id)));
    }
    if ((s.howToPlay || []).length) {
      actions.appendChild(sportCardAction("📖 How to Play", () => openHowToPlay(s.id)));
    }
    if (actions.children.length) card.appendChild(actions);

    homeSportCardsEl.appendChild(card);
  });
}

function sportCardAction(label, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sport-card-action";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

/** The year picker: one player, their seasons on this squad, pick which.
 *
 * The board shows a player once; this is the second, separate decision -
 * knowing Doncic played for the Mavs is the easy half, knowing which year was
 * the scoring title is the half worth testing.
 *
 * Which is exactly why ranked shows YEARS ONLY. Printing the stat lines would
 * answer the question it is asking: anyone could pick the best season off a
 * table without knowing a thing about it. Quick Play shows them, because Quick
 * Play exists to teach the pool and hiding numbers there teaches nothing. Same
 * split the player board itself already makes (`showStats`). */
function openSeasonPicker(player, seasons, onChoose, showStats = false) {
  const wrap = document.createElement("div");

  const intro = document.createElement("p");
  intro.className = "hint-text";
  intro.textContent = showStats
    ? `${player.name} played ${seasons.length} draftable seasons for the ${player.team}. Pick one.`
    : `${player.name} played ${seasons.length} draftable seasons for the ${player.team}. Pick the one you want - no peeking at the numbers.`;
  wrap.appendChild(intro);

  const list = document.createElement("div");
  list.className = "season-picker";
  for (const s of seasons) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "season-option";
    row.innerHTML = `<span class="season-year"></span><span class="season-line"></span>`;
    row.querySelector(".season-year").textContent = String(s.season);
    // Under ranked rules the row is the year and nothing else.
    row.querySelector(".season-line").textContent = showStats
      ? `${s.ppg} pts · ${s.rpg} reb · ${s.apg} ast · ${s.games} games`
      : "";
    row.addEventListener("click", () => {
      closeModal();
      onChoose(s);
    });
    list.appendChild(row);
  }
  wrap.appendChild(list);

  openModal(`Which ${player.name}?`, wrap);
}

/** Re-reads the profile and repaints the home header. Called on entry and
 * after anything that can change the record (a finished game, a rename). */
async function refreshHome() {
  try {
    const profile = await loadProfile();
    game.nameA = profile.username || "Player";
    // The banner is sport-neutral, so it carries the all-sports rank. The
    // ratings table is read once here and handed to both, since the banner and
    // the standings below it are ranking against the same field.
    const population = await allSportRatings().catch(() => []);
    const rankInfo = await loadOverallRankInfo(profile, population);
    renderHomeHeader(homeHeaderRefs, profile, rankInfo);
    renderEquippedBanner(homeHeaderRefs.equippedBanner, profile);
    await renderHomeSportCards(profile, population);
  } catch (e) {
    console.error("Failed to load profile:", e);
    game.nameA = "Player";
  }
  signedInAsEl.textContent = game.nameA;
}

btnAuthSubmit.addEventListener("click", async () => {
  const password = inputAuthPassword.value;

  if (authMode === "recover") {
    if (password.length < 6) {
      setAuthStatus("Password must be at least 6 characters.", "error");
      return;
    }
    btnAuthSubmit.disabled = true;
    setAuthStatus("Saving your new password…");
    try {
      await updatePassword(password);
      inputAuthPassword.value = "";
      // The recovery session is a real session, so there is nothing left to
      // do but let them in - asking them to sign in again with the password
      // they just set would be busywork.
      await enterApp();
    } catch (e) {
      setAuthStatus(e.message || "That didn't work. Try again.", "error");
    } finally {
      btnAuthSubmit.disabled = false;
    }
    return;
  }

  if (authMode === "signup") {
    const email = inputAuthEmail.value.trim();
    const username = inputAuthUsername.value.trim();
    if (!email || !username || !password) {
      setAuthStatus("Email, username and password are all required.", "error");
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      setAuthStatus("That doesn't look like a valid email address.", "error");
      return;
    }
    if (!USERNAME_PATTERN.test(username)) {
      setAuthStatus("Usernames are 3-20 characters: letters, numbers or underscores.", "error");
      return;
    }

    btnAuthSubmit.disabled = true;
    setAuthStatus("Creating your account…");
    try {
      const { session, needsConfirmation } = await signUp(email, username, password);
      // No session means the project has email confirmation on. That is now a
      // sensible configuration rather than a broken one - the address is real
      // - so this is an instruction, not an error.
      if (needsConfirmation || !session) {
        authMode = "signin";
        // After renderAuthMode, which clears the status box on its way in.
        renderAuthMode();
        inputAuthIdentifier.value = email;
        setAuthStatus(`Account created. Check ${email} for the confirmation link, then sign in.`);
        return;
      }
      await setUsername(username);
      inputAuthPassword.value = "";
      await enterApp();
    } catch (e) {
      setAuthStatus(e.message || "That didn't work. Try again.", "error");
    } finally {
      btnAuthSubmit.disabled = false;
    }
    return;
  }

  const identifier = inputAuthIdentifier.value.trim();
  if (!identifier || !password) {
    setAuthStatus("Email (or username) and password are both required.", "error");
    return;
  }
  btnAuthSubmit.disabled = true;
  setAuthStatus("Signing in…");
  try {
    await signIn(identifier, password);
    inputAuthPassword.value = "";
    await enterApp();
  } catch (e) {
    setAuthStatus(e.message || "That didn't work. Try again.", "error");
  } finally {
    btnAuthSubmit.disabled = false;
  }
});

for (const el of [inputAuthPassword, inputAuthUsername, inputAuthEmail, inputAuthIdentifier]) {
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
  renderPlayability();
}

/** Start Draft is only live for a sport that can actually be played.
 *
 * A preview sport reaches every screen EXCEPT this one - its engine, dataset
 * and gamestyles all throw on purpose (see js/sports/nfl/index.js), so
 * pressing Start Draft would surface a stack trace as "the game is broken"
 * rather than "this sport isn't finished". Saying so plainly on the button is
 * both the honest answer and the thing that makes the tile safe to click. */
function renderPlayability() {
  const playable = isLive(getSport());
  btnStartDraft.disabled = !playable;
  btnStartDraft.textContent = playable ? "Start Draft" : `${sport().name} isn't playable yet`;
  sportPreviewNoteEl.hidden = playable;
  if (!playable) {
    sportPreviewNoteEl.textContent =
      `You're previewing ${sport().name}. Everything here is real except the game itself - ` +
      `pick a playable sport above to draft.`;
  }
}

// --- Era bracket -----------------------------------------------------------
// The chosen bracket narrows the draft pool. It persists across visits because
// somebody grinding Modern Ball shouldn't have to re-pick it every session.
// --- Sport ----------------------------------------------------------------
// The picker used to be four hardcoded tiles with no listener - decoration.
// Sport is now real state: it persists like the era does, it decides which
// era brackets are even on offer, and it is what matchmaking scopes on, so
// two players can never be paired across sports.
// Which sport is active now lives in the registry (js/sports/index.js), so
// every module can ask rather than being handed the answer. These two stay as
// thin local names because they are used in a hundred places in this file.
function getSport() {
  return activeSportId();
}

/** The active sport's definition - slots, eras, dataset, engine, labels.
 * Everything downstream reads this rather than importing basketball. */
function sport() {
  return activeSport();
}

/** Repaint the app in the active sport's colors.
 *
 * The four --accent* tokens in css/style.css are the only thing that differs
 * between sports, and everything that wants to follow the sport reads them
 * (button outlines, focus rings, the live-score glow, the tab underline).
 * Writing them onto the root element re-themes all of it in one assignment -
 * a sport that adds no theme simply keeps the stylesheet's defaults. */
function applyTheme(s) {
  const t = s.theme;
  if (!t) return;
  const root = document.documentElement.style;
  root.setProperty("--accent", t.accent);
  root.setProperty("--accent-bright", t.accentBright);
  root.setProperty("--accent-rgb", t.accentRgb);
  root.setProperty("--accent-contrast", t.accentContrast);
  // Phone browsers paint the address bar with this, so leaving it behind is
  // the one place the old sport's color survives the switch.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t.accent);
}

const playSportIconEl = document.getElementById("play-sport-icon");
const playSportNameEl = document.getElementById("play-sport-name");

function setSport(id) {
  if (!setActiveSport(id)) return;
  applyTheme(sport());
  // Era ids are only unique within a sport, so a bracket selected under the
  // previous sport may not exist here. Re-resolving through the new sport
  // snaps to its default rather than leaving a dangling id.
  selectedEra = sport().eraById(selectedEra).id;
  renderPlayHead();
  renderEraChoice();
  renderPlayability();
  warmDatasetStats();
}

/** The Play screen says which sport you are in, because the sport was chosen
 * on the previous screen and there is no picker here to read it off. */
function renderPlayHead() {
  playSportIconEl.textContent = sport().icon;
  playSportNameEl.textContent = sport().name;
}

const sportPreviewNoteEl = document.getElementById("sport-preview-note");

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

// The active sport is restored from storage, so a player who left in NFL
// comes back to it - and has to come back to its colors too, not the
// stylesheet's default sport.
applyTheme(sport());
renderPlayHead();
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
  // Belt as well as braces: the button is disabled for a preview sport, but a
  // stale listener or a keyboard activation must not reach an engine that
  // throws by design.
  if (!isLive(getSport())) return;

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
// Home is the hub and carries no sport; the sport picker, mode and era all
// live one step in, on the Play screen. Going back returns to the hub rather
// than to whatever screen preceded it, because the hub is the only thing
// "back" can mean from here.
document.getElementById("btn-play-back").addEventListener("click", () => {
  showScreen("home");
  refreshHome();
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
const squadBannerEraEl = document.getElementById("squad-banner-era");

/** The era bracket in play, shown on the draft board itself. It was only ever
 * visible on the home screen, which meant that by the time you were being
 * asked to name a player from memory, the single most useful piece of context
 * for doing that - which stretch of history this game is drawn from - was two
 * screens behind you. */
function renderDraftEra(eraId) {
  const era = sport().eraById(eraId || getEra());
  squadBannerEraEl.textContent = `${era.emoji} ${era.label}`;
}
const draftTurnBanner = document.getElementById("draft-turn-banner");
const btnLeaveMatch = document.getElementById("btn-leave-match");

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
/** Every slot this side is charged for at simulation time: the ones the pick
 * clock filled, plus any it never filled at all. An unfilled slot matters
 * because the 240-minute rotation budget is spread across whoever IS on the
 * roster - so a nine-man team would otherwise get ten men's minutes for free. */
function forfeitedSlotsFor(side, roster, slots) {
  const missed = (slots || []).filter((slot) => !roster[slot]);
  return [...new Set([...(game.forfeits[side] || []), ...missed])];
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
// styles at random, so strategy.tactic defaults to whichever is first in that
// game's offer rather than a fixed id that might not even be on offer.
// Seeded from the active sport rather than a basketball import, so a sport
// with a different set of gamestyles (or none yet) doesn't inherit
// basketball's as a default it never declared.
strategy.offeredTactics = [sport().tacticById(sport().defaultTactic)].filter(Boolean);
strategy.tactic = sport().defaultTactic;
let tacticTimerInterval = null;

function cleanupTacticTimer() {
  if (tacticTimerInterval) {
    clearInterval(tacticTimerInterval);
    tacticTimerInterval = null;
  }
}

function renderTactics() {
  renderTacticPicker(tacticGridEl, strategy.offeredTactics, strategy.tactic, (id) => {
    strategy.tactic = id;
    renderTactics();
  });
}

/** Final round: both rosters are set, 45 seconds to commit to a plan. Running
 * out doesn't punish you - it locks in whatever is highlighted - because the
 * timer exists to keep a match moving, not to tax indecision. */
/** @param opts.timed false runs the phase with no clock at all - Quick Play's
 * whole identity is "no clock", and giving it a 45-second gamestyle timer
 * would be the one place that mode suddenly rushed you. Every other mode
 * keeps the timer, since a ranked opponent is waiting on the other side of
 * this decision. */
function startTacticPhase(onConfirm, { timed = true } = {}) {
  cleanupPickTimer();
  cleanupTacticTimer();
  strategy.offeredTactics = sport().randomTacticChoices(3);
  strategy.tactic = strategy.offeredTactics[0].id;
  renderTactics();

  draftPoolPanel.classList.add("hidden");
  tacticPhaseEl.classList.remove("hidden");
  pickTimerEl.hidden = !timed;

  let remaining = TACTIC_TIMER_SECONDS;
  if (timed) {
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
  }

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
// strategy.rotationMinutes of null means "use the engine's default fixed split," so
// every mode that never enters this phase behaves exactly as before.
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
  strategy.rotationMinutes = sport().defaultMinutes(roster);
  // Confirm stays locked until the whole 240 is spent. Leaving minutes on the
  // table is never a real choice - it just fields a weaker team - so it's
  // blocked rather than warned about.
  renderRotationPicker(rotationGridEl, roster, strategy.rotationMinutes, rotationTotalEl, slots, (valid) => {
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

  const myStarters = sport().slots.starters.filter((slot) => myRoster[slot]);
  const oppStarters = sport().slots.starters.filter((slot) => oppRoster[slot]);
  strategy.matchups = sport().defaultMatchups(myRoster, oppRoster);

  renderMatchupPicker(matchupGridEl, myRoster, oppRoster, myStarters, oppStarters, strategy.matchups, oppLabel);

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
    : `No player list — draft from memory. ${MIN_SEARCH_CHARS}+ letters to search.`;
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
  // Ask the SPORT. This returned basketball's slots for every sport, which is
  // why an NFL draft dealt PG/SG/SF/PF/C and five bench spots off a Cowboys
  // roster - the board was basketball wearing a football squad's name.
  const shape = sport().slots;
  return ruleset === "easy" ? shape.quickPlay : shape.ranked;
}

function startDraft() {
  cleanupPickTimer();
  cleanupTacticTimer();
  cleanupRotationTimer();
  cleanupMatchupTimer();
  tacticPhaseEl.classList.add("hidden");
  rotationPhaseEl.classList.add("hidden");
  matchupPhaseEl.classList.add("hidden");
  strategy.rotationMinutes = null;
  strategy.matchups = null;
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
  game.forfeits = { A: [], B: [] };
  game.roundNumber = 0;
  poolSearch.value = "";
  hideDraftGrade();
  captureProgressBaseline();
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
  // groupKey, not "decade" - football's squads are bracketed by era and the
  // hardcoded field left the banner blank for every NFL draft.
  squadBannerDecade.textContent = draft.currentSquad[sport().groupKey] ?? draft.currentSquad.decade ?? "";
  renderDraftEra(game.era);
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
  renderPool(
    poolList,
    draft.currentSquad,
    poolSearch.value,
    rosterFor(side),
    pendingName,
    onPoolPick,
    sport().players(),
    game.ruleset,
    draft.slots,
    (player, seasons, showStats) => openSeasonPicker(player, seasons, onPoolPick, showStats)
  );
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
    // Recorded before the pick lands, because from here on it is an ordinary
    // roster entry - the only thing that distinguishes it is this list.
    game.forfeits[side].push(combo.slot);
    finalizePick(combo.player, combo.slot);
  } else {
    // Nothing was eligible, so nobody forfeited anything - the squad simply
    // had no legal option. The empty slot is charged separately, below.
    skipLocalTurn();
  }
}

function renderRoundReveal() {
  cleanupPickTimer();
  const draft = game.draft;
  poolSearch.hidden = true;
  positionSelectorEl.innerHTML = "";
  poolList.innerHTML = "";

  // Say who they took, in the banner, rather than only lighting it up in the
  // roster panel. On a phone both panels sit below the search box - the whole
  // point of that layout - so the one moment in the round where you learn what
  // you are up against was happening off the bottom of the screen. The banner
  // is already in view, so this puts the answer where the eyes are.
  const oppSlot = pendingSlotsFor("B")[0];
  const oppPick = oppSlot && draft.rosterB[oppSlot];
  draftTurnBanner.textContent = oppPick
    ? `${game.nameB} took ${oppPick.name} — ${oppSlot}`
    : "Revealing picks…";

  renderRosterPanel(rosterPanelA, draft.rosterA, game.nameA, false, { revealSlots: pendingSlotsFor("A"), slots: draft.slots });
  renderRosterPanel(rosterPanelB, draft.rosterB, game.nameB, false, { revealSlots: pendingSlotsFor("B"), slots: draft.slots });
}

// ---- Draft grade ----
// Shown the moment both rosters are set, before a minute is simulated. The
// grade is computed from the same roster metrics the engine is about to
// charge you for (see js/draftgrade.js), so it is a prediction rather than a
// decoration.

const draftGradeEl = document.getElementById("draft-grade");
const draftGradeLetterEl = document.getElementById("draft-grade-letter");
const draftGradeHeadlineEl = document.getElementById("draft-grade-headline");
const draftGradeReasonsEl = document.getElementById("draft-grade-reasons");

function hideDraftGrade() {
  draftGradeEl.classList.add("hidden");
}

/** @param opts.oppRoster adds the counterplay read when the opponent's roster
 *   is already known - it always is by the time a draft finishes. */
function showDraftGrade(roster, opts = {}) {
  let grade;
  try {
    grade = sport().gradeDraft(roster, datasetStatsFor(), opts);
  } catch (e) {
    // A grade is commentary. If it can't be computed for some roster shape,
    // that must never be what stops a finished draft reaching the game.
    console.error("Could not grade draft:", e);
    hideDraftGrade();
    return null;
  }

  draftGradeLetterEl.textContent = grade.letter;
  draftGradeHeadlineEl.textContent = grade.headline;
  draftGradeReasonsEl.innerHTML = "";

  const reasons = [...grade.reasons];
  const hint = sport().rotationHint(roster);
  if (hint) reasons.push(hint);
  for (const reason of reasons) {
    const li = document.createElement("li");
    li.textContent = reason;
    draftGradeReasonsEl.appendChild(li);
  }

  // Grade band drives the colour, so an A doesn't arrive in the same grey as
  // a D - the letter should be readable across the room.
  draftGradeEl.className = `draft-grade grade-${grade.letter[0].toLowerCase()}`;
  replayAnimation(draftGradeEl, "grade-stamp");
  if (grade.letter[0] === "A") confetti({ count: 40, durationMs: 2600 });
  return grade;
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

  showDraftGrade(draft.rosterA, {
    oppRoster: draft.rosterB,
    forfeits: forfeitedSlotsFor("A", draft.rosterA, draft.slots),
  });

  // Quick Play stays the fast, no-strategy experience: straight to the sim.
  // Ranked Practice adds the two strict-ruleset phases - rotation, then
  // gamestyle - since it's meant to rehearse exactly what Online Ranked asks
  // for, using a bot opponent instead of a real one.
  if (game.ruleset !== "strict") {
    // Quick Play drafts five players and no bench, so there is no rotation to
    // set and nobody to switch onto anybody - those two phases would be
    // screens with one legal answer. The gamestyle is a real choice at any
    // roster size, though, and it is the first thing a new player should meet:
    // Quick Play is where people learn what the game is, and hiding a third of
    // the game behind Ranked Practice made gamestyles a thing you discovered
    // late or not at all.
    strategy.rotationMinutes = null;
    strategy.matchups = null;
    draftTurnBanner.textContent = "Pick your game plan";
    tacticPhaseHintEl.textContent = "Choose how this team plays - no clock, take your time.";
    startTacticPhase(runLocalSimulation, { timed: false });
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

/** The "you've been matched" beat between finding an opponent and the draft
 * actually starting.
 *
 * It runs about 9 seconds now, roughly two longer than it did, and the extra
 * time is spent on presentation rather than on waiting: the screen fades up,
 * each side's banner flies in with its own beat (yours first, then theirs -
 * two banners landing simultaneously reads as a layout, one after the other
 * reads as an introduction), the names and ranks type in behind them, VS
 * lands with an impact flash and a shockwave, and only then does the
 * countdown start. A rising whoosh carries the fly-in and the buzzer lands on
 * "GO!".
 *
 * Only for a genuinely fresh match (enterOnlineMatch only calls this when
 * there are no picks yet) - reconnecting to a draft already in progress skips
 * straight to it instead of replaying the intro every time.
 */
async function playMatchupIntro(mySide, oppSide) {
  showScreen("matchupIntro");
  for (const el of [matchupSideAEl, matchupSideBEl]) {
    el.classList.remove("fly-in", "settle");
  }
  matchupVsEl.classList.remove("vs-fade", "vs-land");
  matchupIntroEl.classList.remove("impact-flash", "intro-lit");
  matchupCountdownEl.classList.add("hidden");
  matchupCountdownEl.classList.remove("pulse", "go");
  matchupCountdownEl.textContent = "";

  renderMatchupSide(matchupRefsA, mySide);
  renderMatchupSide(matchupRefsB, oppSide);

  // Force layout before adding the classes, so removing them above and adding
  // them back here actually retriggers the transitions instead of no-op'ing
  // against the previous match's already-settled state.
  void matchupSideAEl.offsetWidth;
  await sleep(120);
  matchupIntroEl.classList.add("intro-lit");

  // Staggered, not simultaneous: your banner arrives, then theirs, which is
  // what makes it read as being introduced to an opponent.
  playWhoosh();
  matchupSideAEl.classList.add("fly-in");
  await sleep(520);
  playWhoosh();
  matchupSideBEl.classList.add("fly-in");

  // A beat after the second banner lands (the fly-in transition is 0.9s), the
  // radial flash and shockwave sell the impact of the two sides meeting.
  await sleep(950);
  matchupSideAEl.classList.add("settle");
  matchupSideBEl.classList.add("settle");
  matchupVsEl.classList.add("vs-land");
  replayAnimation(matchupIntroEl, "impact-flash");
  playPop(2);

  // Time to actually read who you're playing and what rank they are - the
  // whole reason this screen exists, and previously the part it gave the
  // least room to.
  await sleep(2100);

  // The countdown and "VS" occupy the exact same dead-center spot by design -
  // fading VS out is what keeps them from rendering on top of each other
  // instead of the countdown looking like a glitch.
  matchupVsEl.classList.add("vs-fade");
  matchupCountdownEl.classList.remove("hidden");
  for (const n of [3, 2, 1]) {
    matchupCountdownEl.textContent = String(n);
    replayAnimation(matchupCountdownEl, "pulse");
    playPop(3 - n);
    await sleep(1000);
  }
  // The payoff beat: bigger, and in the same buzzer-red the pick timer
  // already uses for urgency, so it reads as "go" rather than just a fourth
  // number in the same countdown color.
  matchupCountdownEl.textContent = "GO!";
  matchupCountdownEl.classList.add("go");
  playBuzzer();
  await sleep(1100);
}

async function enterOnlineMatch(matchId) {
  hideDraftGrade();
  captureProgressBaseline();
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
      loadRankInfo({ sportRatings: oppSummary.sportRatings }),
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
  renderDraftEra(match.era);
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
  renderRosterPanel(rosterPanelA, o.myRoster, "You", true, { slots: sport().slots.ranked });
  renderRosterPanel(rosterPanelB, o.oppRoster, o.oppUsername, false, { slots: sport().slots.ranked, revealSlots: oppRevealSlots });
}

function renderOnlinePositionAndPool() {
  const o = game.online;
  const eligibleForPending = o.pendingPlayer ? eligibleOpenSlots(o.pendingPlayer, o.myRoster, sport().slots.ranked) : null;
  renderPositionSelector(positionSelectorEl, o.myRoster, eligibleForPending, (slot) => {
    finalizeOnlinePick(o.pendingPlayer, slot);
  }, sport().slots.ranked);
  const pendingName = o.pendingPlayer ? o.pendingPlayer.name : null;
  renderPool(
    poolList,
    o.currentSquad,
    poolSearch.value,
    o.myRoster,
    pendingName,
    onOnlinePoolPick,
    sport().players(),
    game.ruleset,
    sport().slots.ranked,
    (player, seasons, showStats) => openSeasonPicker(player, seasons, onOnlinePoolPick, showStats)
  );
}

function onOnlinePoolPick(player) {
  const o = game.online;
  const slots = eligibleOpenSlots(player, o.myRoster, sport().slots.ranked);
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
  const combo = worstEligiblePick(o.currentSquad, o.myRoster, sport().slots.ranked);
  if (combo) {
    await finalizeOnlinePick(combo.player, combo.slot, true);
  } else {
    await onlineSkip();
  }
}

/** @param forfeited true when the pick clock chose this player. Sent through
 * to the server, which is where the simulation reads it back from - the
 * client never gets to declare what the penalty is, only that it applies. */
async function finalizeOnlinePick(player, slot, forfeited = false) {
  cleanupPickTimer();
  const o = game.online;
  o.pendingPlayer = null;
  if (forfeited) o.forfeits = [...(o.forfeits || []), slot];
  draftTurnBanner.textContent = "Locking in pick…";
  poolSearch.hidden = true;
  positionSelectorEl.innerHTML = "";
  poolList.innerHTML = "";

  try {
    await submitPick(o.matchId, player, slot, forfeited);
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

  renderRosterPanel(rosterPanelA, o.myRoster, "You", false, { slots: sport().slots.ranked });
  renderRosterPanel(rosterPanelB, o.oppRoster, o.oppUsername, false, { slots: sport().slots.ranked });

  showDraftGrade(o.myRoster, {
    oppRoster: o.oppRoster,
    forfeits: [...(o.forfeits || []), ...sport().slots.ranked.filter((slot) => !o.myRoster[slot])],
  });

  draftTurnBanner.textContent = "Set your rotation";
  rotationPhaseHintEl.textContent =
    `240 minutes to spend, 10-40 each. Starters play more than the bench. ` +
    `Lower someone to free minutes before raising someone else.`;
  startRotationPhase(o.myRoster, sport().slots.ranked, () => {
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
          await submitStrategy(o.matchId, strategy.rotationMinutes, strategy.matchups, strategy.tactic);
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
// ---- Reward toast ----
// The payoff for playing. Badges, banners and rank are derived from profile
// counters rather than granted by an event, so without a before/after diff a
// badge earned in this game just sits on a tab nobody opened. See progress.js.

const rewardToastEl = document.getElementById("reward-toast");
const rewardToastIconEl = document.getElementById("reward-toast-icon");
const rewardToastTitleEl = document.getElementById("reward-toast-title");
const rewardToastDetailEl = document.getElementById("reward-toast-detail");
const rewardToastMoreEl = document.getElementById("reward-toast-more");

const REWARD_ICONS = { rank: "🏆", badge: "🎖️", banner: "🚩" };

// The profile as it stood when this game started. Captured at draft time so a
// game that takes ten minutes still diffs against the right baseline.
let progressBefore = null;
let rankBefore = null;

/** Snapshots the profile before a game. Failures are swallowed on purpose -
 * a missing baseline costs a celebration, and nothing else. */
async function captureProgressBaseline() {
  progressBefore = null;
  rankBefore = null;
  try {
    const profile = await loadProfile();
    progressBefore = snapshotProgress(profile, getSport());
    rankBefore = await loadRankInfo(profile);
  } catch (e) {
    console.error("Couldn't snapshot progress before the game:", e);
  }
}

/** Diffs against that baseline and celebrates whatever went up. */
async function celebrateProgress() {
  if (!progressBefore) return;
  let gains = [];
  try {
    const profile = await loadProfile();
    const after = snapshotProgress(profile, getSport());
    const rankAfter = await loadRankInfo(profile);
    gains = progressGains(progressBefore, after, { rankBefore, rankAfter });
  } catch (e) {
    console.error("Couldn't work out what improved:", e);
    return;
  }
  if (gains.length === 0) return;

  const [headline, ...rest] = gains;
  rewardToastIconEl.textContent = REWARD_ICONS[headline.kind] || "⭐";
  rewardToastTitleEl.textContent = headline.title;
  rewardToastDetailEl.textContent = headline.detail || "";
  rewardToastMoreEl.innerHTML = "";
  for (const gain of rest.slice(0, 3)) {
    const li = document.createElement("li");
    li.textContent = gain.title;
    rewardToastMoreEl.appendChild(li);
  }

  rewardToastEl.classList.remove("hidden");
  replayAnimation(rewardToastEl, "reward-pop");
  // A second burst, deliberately separate from the win confetti: this is a
  // different thing being celebrated and it should read as one.
  confetti({ count: 70, durationMs: 3400 });
  playFanfare();
}

// ---- Post-game analysis panel ----

const whyBreakdownEl = document.getElementById("why-breakdown");
const whyTitleEl = document.getElementById("why-title");
const whyReasonsEl = document.getElementById("why-reasons");
const whyCoachingEl = document.getElementById("why-coaching");
const whyCoachingListEl = document.getElementById("why-coaching-list");

function renderWhyBreakdown(result, ctx) {
  let breakdown;
  try {
    breakdown = sport().buildWhyBreakdown(result, ctx);
  } catch (e) {
    // Analysis is commentary on a result that already exists - it must never
    // be what keeps the result off the screen.
    console.error("Could not build post-game analysis:", e);
    whyBreakdownEl.classList.add("hidden");
    return;
  }

  whyTitleEl.textContent = breakdown.title;
  whyBreakdownEl.classList.toggle("why-won", breakdown.won);
  whyBreakdownEl.classList.toggle("why-lost", !breakdown.won);

  whyReasonsEl.innerHTML = "";
  for (const reason of breakdown.reasons) {
    const li = document.createElement("li");
    li.textContent = reason;
    whyReasonsEl.appendChild(li);
  }

  whyCoachingListEl.innerHTML = "";
  for (const note of breakdown.coaching) {
    const li = document.createElement("li");
    li.textContent = note;
    whyCoachingListEl.appendChild(li);
  }
  whyCoachingEl.hidden = breakdown.coaching.length === 0;

  whyBreakdownEl.classList.remove("hidden");
}

/** Clears everything the game screen can show, so nothing from the last game
 * survives into the next one.
 *
 * This exists because there used to be TWO of these lists - one here and one
 * in runOnlineSimulationFlow - and they disagreed. The online path hid five
 * elements and left the recap, the analysis panel, the reward toast and the
 * play feed alone, then awaited the server for several seconds. The result of
 * the PREVIOUS game sat on screen for that whole wait, which read as the game
 * flashing its own ending before it had been played.
 *
 * One list cannot drift from itself, which is the actual fix. Anything added
 * to the game screen from here on gets cleared by adding it once, here.
 */
function resetGameScreen() {
  for (const el of [
    finalBanner,
    gameRecapEl,
    mvpCallout,
    whyBreakdownEl,
    rewardToastEl,
    fullBoxScore,
    btnToProfile,
    btnPlayAgain,
    btnGameHome,
  ]) {
    el.classList.add("hidden");
  }
  clearPlayFeed(playFeedEl);
  // These flash/glow classes live directly on the container elements, not on
  // content renderScoreboard rebuilds each tick - so a leftover class from a
  // previous game would otherwise survive into this one.
  liveScoreboard.classList.remove("period-flash", "lead-flash");
  courtStageEl.classList.remove("final-flash");
}

function playOutResult({ result, labelA, labelB, rosterA, rosterB, minutesA, minutesB, matchups, tactic, analysis, onComplete }) {
  resetGameScreen();
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
  function tickScoreTo(fromA2, fromB2, toA, toB, periods, remaining, duringLabel, doneLabel, onDone, tickMs) {
    const started = Date.now();
    const tick = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / (tickMs || QUARTER_TICK_MS));
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
      () => flashClass(liveScoreboard, leadChanged ? "lead-flash" : "period-flash"),
      // Overtime counts up slower, so a two-point period is watchable rather
      // than a number that changes between blinks.
      isOt ? OT_TICK_MS : QUARTER_TICK_MS
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
    // Overtime holds longer - see OT_REVEAL_DELAY_MS. isOt is this period, so
    // the pause after it is the one that lets the decisive score land.
    setTimeout(step, isOt ? OT_REVEAL_DELAY_MS : QUARTER_REVEAL_DELAY_MS);
  }

  function finish() {
    for (const t of scoreTickIntervals) clearInterval(t);
    renderScoreboard(liveScoreboard, labelA, labelB, periodsSoFar, 0, runningA, runningB, "Final", false);
    flashClass(courtStageEl, "final-flash");

    // The broadcast's closing line: not why the winner won (the recap below
    // covers that), just the shape the game itself took.
    pushPlayHeadline(playFeedEl, sport().buildGameScript(periodsSoFar, labelA, labelB), "final");

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
    const recap = sport().buildRecap(result, rosterA, rosterB, labelA, labelB, shotsA, shotsB);
    recapHeadlineEl.textContent = recap.headline;
    recapDetailEl.textContent = recap.detail;
    gameRecapEl.classList.remove("hidden");

    const mvp = result.mvp;
    const mvpTeamName = mvp.side === "A" ? labelA : labelB;
    mvpCallout.textContent = `MVP: ${mvp.player.name} (${mvpTeamName}) — ${Math.round(
      mvp.line.pts
    )} PTS / ${Math.round(mvp.line.reb)} REB / ${Math.round(mvp.line.ast)} AST`;
    mvpCallout.classList.remove("hidden");

    // Why it went that way in terms you can act on, as opposed to the
    // broadcast paragraph above: the numbers that decided it, and what your
    // rotation, matchups and gamestyle actually did.
    renderWhyBreakdown(result, {
      rosterA,
      rosterB,
      minutesA,
      minutesB,
      matchupsA: matchups,
      tacticA: tactic,
      shotsA,
      shotsB,
      analysisA: analysis,
    });

    renderFullBoxScore(fullBoxScore, rosterA, result.boxA, labelA, rosterB, result.boxB, labelB, shotsA, shotsB, minutesA, minutesB, true);
    fullBoxScore.classList.remove("hidden");
    btnToProfile.classList.remove("hidden");
    btnPlayAgain.classList.remove("hidden");
    btnGameHome.classList.remove("hidden");

    // The payoff. A win gets the horn, the confetti and the fanfare; a loss
    // gets the horn and a flat two-note fall, because losing shouldn't be
    // louder than winning.
    playBuzzer();
    if (result.winner === "A") {
      confetti({ count: 110, durationMs: 4200 });
      window.setTimeout(playFanfare, 320);
      replayAnimation(finalBanner, "win-flare");
    } else {
      window.setTimeout(playDefeat, 320);
    }

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
  const minutesA = strategy.rotationMinutes || sport().defaultMinutes(draft.rosterA);
  const minutesB = sport().botMinutes(draft.rosterB);
  const forfeitsA = forfeitedSlotsFor("A", draft.rosterA, draft.slots);
  const forfeitsB = forfeitedSlotsFor("B", draft.rosterB, draft.slots);
  const result = sport().simulate(draft.rosterA, draft.rosterB, datasetStatsFor(), {
    tacticA: strategy.tactic,
    tacticB: botTactic,
    minutesA,
    minutesB,
    matchupsA: strategy.matchups || undefined,
    forfeitsA,
    forfeitsB,
  });

  playOutResult({
    result,
    labelA: game.nameA,
    labelB: game.nameB,
    rosterA: draft.rosterA,
    rosterB: draft.rosterB,
    minutesA,
    minutesB,
    matchups: strategy.matchups || undefined,
    tactic: strategy.tactic,
    // The engine already computed this on its way to the score, so the recap
    // narrates the same numbers the simulation actually used.
    analysis: result.analysis && result.analysis.a,
    onComplete: () => {
      // Carries the season too: the roster entry knows which year was drafted,
      // and the record books need it or "Most Points - Luka Doncic" no longer
      // identifies a player.
      const ownLines = draft.slots.map((slot) => ({
        playerName: draft.rosterA[slot].name,
        season: draft.rosterA[slot].season ?? null,
        line: result.boxA[slot],
      }));

      const resultWritten = recordPracticeResult({
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

      const draftPicksWritten = recordDraftPicks(
        draft.slots.map((slot) => draft.rosterA[slot].name),
        getSport()
      ).catch((e) =>
        console.error("Failed to record draft picks:", e)
      );

      // After BOTH writes land. The diff has to read a profile that already
      // includes this game, or it celebrates nothing now - and, because the
      // baseline moves on, stays silent about it next game too.
      Promise.allSettled([resultWritten, draftPicksWritten]).then(celebrateProgress);
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
  // Clear BEFORE showing the screen, not after: everything below this awaits
  // the server for seconds, and whatever is on the game screen is visible for
  // all of it.
  resetGameScreen();
  showScreen("game");
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

  // The server stores a box score, not the draft analysis behind it. Every
  // term of that analysis is a pure function of the two rosters (see
  // draftAnalysis in engine.js), so the client recomputes rather than the
  // schema growing a column to carry commentary. The one thing it can't
  // recompute is the opponent's forfeits, which is deliberate - that is a
  // live read on how the other side is doing and the reveal rule withholds it.
  let analysisA = null;
  try {
    analysisA = sport().draftAnalysis(myRosterFinal, oppRosterFinal, datasetStatsFor(), o.forfeits || []);
  } catch (e) {
    console.error("Could not rebuild the draft analysis:", e);
  }

  playOutResult({
    result,
    labelA: "You",
    labelB: o.oppUsername,
    rosterA: myRosterFinal,
    rosterB: oppRosterFinal,
    minutesA: strategy.rotationMinutes || undefined,
    matchups: strategy.matchups || undefined,
    tactic: strategy.tactic,
    analysis: analysisA,
    onComplete: () => {
      // online_wins/online_losses, personal_bests, draft_counts, history and
      // banner progress were all written server-side by simulate-match before
      // this client ever saw the result, so the profile is already current.
      celebrateProgress();
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
  sportRankHeading: document.getElementById("profile-sport-rank-heading"),
  sportRank: document.getElementById("profile-sport-rank"),
};
const profileStatsTabsEl = document.getElementById("profile-stats-sport-tabs");

// Which sport's career stats the profile is showing. Starts on whatever sport
// is selected, but is its own state afterwards: looking at your football
// records shouldn't switch the app - and re-theme it - out from under you.
let profileStatsSportId = activeSportId();
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
    await renderProfileFor(profile);
    renderEquippedBanner(profileEquippedBannerEl, profile);
    refreshProfileEmail();
  } catch (e) {
    console.error("Failed to load profile:", e);
  }
}

/** Paints the profile for whichever sport subtab is selected.
 *
 * Two ranks are on this screen and they are different numbers: the headline is
 * the all-sports standing (the one on the banner), and under the subtabs is
 * that one sport's ELO on that sport's own ladder. */
async function renderProfileFor(profile) {
  const statsSport = sportById(profileStatsSportId);
  const population = await allSportRatings().catch(() => []);
  const [overall, sportRank] = await Promise.all([
    loadOverallRankInfo(profile, population),
    // A sport nobody can play yet has no rank to hold, and asking for one
    // would report every player as provisional in it - which reads as "you
    // haven't played enough" rather than "this doesn't exist yet".
    statsSport.live ? loadRankInfo(profile, statsSport.id, population) : Promise.resolve(null),
  ]);
  renderProfileScreen(profileRefs, profile, overall, statsSport, sportRank, openStoredGame);
  renderBadgeSportTabs(profileStatsTabsEl, profileStatsSportId, (id) => {
    profileStatsSportId = id;
    if (currentProfile) renderProfileFor(currentProfile).catch((e) => console.error(e));
  });
}

btnCustomizeBanner.addEventListener("click", () => openCustomizeBannerModal());

// ---- Recovery email ----
// Attaching one is the whole point of the account rework: an account with no
// reachable address can't be recovered, and every account made before email
// sign-up existed is in exactly that state.

const inputProfileEmail = document.getElementById("input-profile-email");
const profileEmailStatusEl = document.getElementById("profile-email-status");
const btnSaveEmail = document.getElementById("btn-save-email");

async function refreshProfileEmail() {
  try {
    const user = await getAuthUser();
    const email = user && user.email;
    if (!email || isPlaceholderEmail(email)) {
      inputProfileEmail.value = "";
      profileEmailStatusEl.textContent =
        "No recovery email yet - add one so you can reset your password if you forget it.";
      profileEmailStatusEl.classList.add("auth-error");
    } else {
      inputProfileEmail.value = email;
      profileEmailStatusEl.textContent = "You can recover this account by email.";
      profileEmailStatusEl.classList.remove("auth-error");
    }
  } catch (e) {
    console.error("Failed to read account email:", e);
  }
}

btnSaveEmail.addEventListener("click", async () => {
  const email = inputProfileEmail.value.trim();
  if (!EMAIL_PATTERN.test(email)) {
    profileEmailStatusEl.textContent = "That doesn't look like a valid email address.";
    profileEmailStatusEl.classList.add("auth-error");
    return;
  }
  btnSaveEmail.disabled = true;
  profileEmailStatusEl.classList.remove("auth-error");
  profileEmailStatusEl.textContent = "Sending a confirmation link…";
  try {
    await updateEmail(email);
    // Supabase only swaps the address over once the link in it is clicked, so
    // this is not "saved" yet and shouldn't claim to be.
    profileEmailStatusEl.textContent = `Confirm it from the link sent to ${email} and it becomes your recovery address.`;
  } catch (e) {
    profileEmailStatusEl.textContent = e.message || "Couldn't save that.";
    profileEmailStatusEl.classList.add("auth-error");
  } finally {
    btnSaveEmail.disabled = false;
  }
});

// ---- Rank ladder ----
// Ranked is a percentile ladder (see loadRankInfo), which is fair but
// invisible: without this a player can only ever see the one rung they are
// standing on, and "AAU" means nothing if you can't see what is above and
// below it.
//
// There are two ladders to show, because there are two ranks. The all-sports
// one is written in general sporting terms (js/ranks.js) and is what a
// player's banner carries. Under it sits the ladder for the sport being
// looked at, in that sport's own language - a basketball player climbs
// through AAU and the G League, a football one through JV and the combine.
// Both stand on the same percentile bands, so a rung means the same thing
// wherever it appears.

/** One ladder, rendered highest rung first - a ladder is read from the top,
 * and what a player wants to see is what they are climbing toward. */
function renderLadder(tiers, rankInfo) {
  const list = document.createElement("ol");
  list.className = "rank-ladder";
  [...tiers].reverse().forEach((tier, i, all) => {
    const row = document.createElement("li");
    row.className = "rank-ladder-row";
    if (rankInfo && !rankInfo.provisional && rankInfo.tier.name === tier.name) row.classList.add("current");
    if (rankInfo && rankInfo.next && rankInfo.next.name === tier.name) row.classList.add("next");

    const name = document.createElement("span");
    name.className = "rank-ladder-name";
    name.textContent = tier.name;

    // The band this tier actually occupies, not "top N%" - the bands stack,
    // so every tier's "top N%" would include everyone above it and the top
    // three rungs would all read "top 2%".
    const band = document.createElement("span");
    band.className = "rank-ladder-band";
    const above = all[i - 1];
    const trim = (n) => String(Number(n.toFixed(1)));
    band.textContent = above
      ? `${trim(tier.minPercentile)}\u2013${trim(above.minPercentile)} percentile`
      : `${trim(tier.minPercentile)}+ percentile`;

    row.append(name, band);
    if (row.classList.contains("current")) {
      const you = document.createElement("span");
      you.className = "rank-ladder-you";
      you.textContent = "YOU";
      row.appendChild(you);
    }
    list.appendChild(row);
  });
  return list;
}

/** The shared preamble both ladders need: what a rating is and how you get one. */
function ladderIntro() {
  const intro = document.createElement("p");
  intro.className = "hint-text";
  intro.textContent =
    `Your rating is an ELO: you gain what a win was worth against that particular opponent, ` +
    `so beating someone above you pays more than beating someone below. Everyone starts at ` +
    `${START_RATING}. Rank is where that rating stands against everyone else's, not a win count. ` +
    `Bot games never count, and you need ${RANK_GAMES_FLOOR} online games before you're ranked at all.`;
  return intro;
}

const LADDER_TIP =
  "Climbing it is about the draft, not the roll: build a roster with no hole to attack, " +
  "counter what your opponent is building rather than mirroring it, back up every position " +
  "so nobody has to play the whole game - and never let the clock make a pick for you.";

/** ONE sport's ladder, opened from that sport's own card.
 *
 * Deliberately just the one: this modal is reached by pressing Rank on the NBA
 * card, and answering with two ladders makes the player find theirs. The
 * all-sports ladder has its own button beside the section heading. */
async function openRankLadder(sportId = profileStatsSportId) {
  const s = sportById(sportId);
  const tiers = s.tiers || [];
  const wrap = document.createElement("div");
  wrap.appendChild(ladderIntro());

  if (!tiers.length) {
    const none = document.createElement("p");
    none.className = "hint-text";
    none.textContent = `${s.name} doesn't have a rank ladder yet.`;
    wrap.appendChild(none);
    openModal(`${s.name} Rank Ladder`, wrap);
    return;
  }

  let info = null;
  if (s.live) {
    const profile = currentProfile || (await loadProfile().catch(() => null));
    if (profile) info = await loadRankInfo(profile, s.id).catch(() => null);
  }

  const note = document.createElement("p");
  note.className = "hint-text";
  note.textContent = !s.live
    ? `${s.name} isn't playable yet, so nobody is on this ladder.`
    : info && info.provisional
      ? `Your ${s.name} rating only - a result in another sport never moves it. ${
          info.gamesNeeded
        } more online game${info.gamesNeeded === 1 ? "" : "s"} and you'll be placed on it.`
      : `Your ${s.name} rating only - a result in another sport never moves it.`;
  wrap.appendChild(note);

  wrap.appendChild(renderLadder(tiers, info));

  const tip = document.createElement("p");
  tip.className = "hint-text";
  tip.textContent = LADDER_TIP;
  wrap.appendChild(tip);

  openModal(`${s.name} Rank Ladder`, wrap);
}

/** The all-sports ladder - the rank a player's banner carries. Its own button
 * beside the sport list, because it belongs to no sport on that list. */
async function openOverallLadder() {
  const wrap = document.createElement("div");
  wrap.appendChild(ladderIntro());

  const profile = currentProfile || (await loadProfile().catch(() => null));
  const info = profile ? await loadOverallRankInfo(profile).catch(() => null) : null;

  const note = document.createElement("p");
  note.className = "hint-text";
  const blurb =
    "Your rating across every sport you play, weighted by how much you play each, so a sport " +
    "you have two games in cannot swing a rank built over a hundred.";
  note.textContent =
    info && info.provisional
      ? `${blurb} ${info.gamesNeeded} more online game${
          info.gamesNeeded === 1 ? "" : "s"
        } and you'll be placed on it.`
      : blurb;
  wrap.appendChild(note);

  wrap.appendChild(renderLadder(GENERAL_TIERS, info));

  const tip = document.createElement("p");
  tip.className = "hint-text";
  tip.textContent = LADDER_TIP;
  wrap.appendChild(tip);

  openModal("Overall Rank Ladder", wrap);
}

document.getElementById("btn-overall-ladder").addEventListener("click", openOverallLadder);

// The profile's ladder button follows that screen's sport subtab. The home
// screen's app-wide one is gone: each sport card opens its own.
document.getElementById("btn-rank-ladder").addEventListener("click", () => openRankLadder(profileStatsSportId));

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

  // Friend count drives the friend banner ladder; it isn't on the profile
  // row, so it's fetched alongside it rather than inferred.
  loadProfileForBanners()
    .then((profile) => {
      renderBanners(grid, summary, profile, onEquipBannerFromProfile, activeBannerSport, true);
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

/** Opens the box score a stored record was set in.
 *
 * Every Top Performances row that carries a snapshot routes here, rather than
 * the one hardcoded Highest Scoring Game listener this replaces - "most points
 * by one of my players" is exactly as worth looking at as "most points by my
 * team", and it was only the latter that was clickable. */
function openStoredGame(game) {
  if (!game || !game.boxA || !game.boxB) return;
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
}

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

/** The profile, plus the friend count the friends banner ladder needs.
 *
 * friendCount isn't a column - friendships live in their own table and only
 * the two participants may read a row - so it has to be counted separately
 * and stitched on. Only the banner screens need it, so only they pay for the
 * extra round trip. A failed count reads as 0, which shows the ladder locked
 * rather than breaking the screen. */
async function loadProfileForBanners() {
  const [profile, friendCount] = await Promise.all([loadProfile(), countFriends().catch(() => 0)]);
  return { ...profile, friendCount };
}

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
      const profile = await loadProfileForBanners();
      renderBanners(bannerGridEl, bannerSummaryEl, profile, onEquipBanner, activeBannerSport, false);
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

// Squads reaches back into the game only to join a challenge, and needs to
// know which sport is selected. Handed over here rather than imported, since
// main.js already imports squads and the reverse would be a cycle.
initSquadsScreen({ joinMatch: enterOnlineMatch, getSport });

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
