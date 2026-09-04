// App controller: wires draft state + engine + profile to the DOM.
// Three modes share these same screens/DOM elements:
//   - "bot": synchronous, client-only (DraftState from draft.js).
//   - "online": async, server-authoritative (Supabase - see online.js).

import { playSound, primeSound, soundEnabled, setSoundEnabled } from "./sound.js";
import { wornColours, rgbString, kitById, KITS, DEFAULT_KIT_ID, BOT_KIT_ID } from "./kits.js";
import { confetti, playBuzzer, playFanfare, playDefeat, playWhoosh, playPop, replayAnimation } from "./celebrate.js";
import { snapshotProgress, progressGains } from "./progress.js";
import { game, strategy } from "./state.js";
import { showScreen, setActiveNav, openModal, closeModal, sleep } from "./shell.js";
import { initBrandFallbacks } from "./brand-fallback.js";
import { withSeededMathRandom } from "./lib/seeded-rng.js";
import { newSimulationSeed, provenanceFor } from "./lib/provenance.js";
import { initSquadsScreen, openSquadsScreen, cleanupSquadChatWatcher } from "./screens/squads.js";
import { startPresence } from "./presence.js";
import { DraftState, eligibleOpenSlots, resolvePickSlot, worstEligiblePick } from "./draft.js";
import { adviceNote, isNote, noteText } from "./gradenotes.js";
import { QUARTER_REVEAL_DELAY_MS, QUARTER_TICK_MS, OT_REVEAL_DELAY_MS, OT_TICK_MS, DRAFT_REVEAL_DELAY_MS, PICK_TIMER_SECONDS, TACTIC_TIMER_SECONDS, ROTATION_TIMER_SECONDS, ONLINE_ROTATION_TIMER_SECONDS, MATCHUP_TIMER_SECONDS, ONLINE_QUEUE_TIMEOUT_SECONDS, RESULT_WAIT_MS, SIMULATION_WAIT_MS, ONLINE_QUEUE_POLL_MS, MIN_SEARCH_CHARS } from "./constants.js";
// Slot lists and the default era still come from basketball directly. They are
// read at module scope for DOM wiring that runs before any sport is chosen;
// unpicking that is a separate change from this one.
// DEFAULT_ERA only. Slot shapes come from sport().slots - shared code
// importing basketball's roster is what dealt PG/SG/SF/PF/C in an NFL draft.
import { DEFAULT_ERA } from "./sports/nba/constants.js";
import { SPORTS, sportById, isLive, isSelectable, DEFAULT_SPORT_ID, activeSport, activeSportId, setActiveSport, ensureSportData } from "./sports/index.js";
import {
  loadProfile,
  loadRankInfo,
  loadOverallRankInfo,
  recordPracticeResult,
  recordDraftPicks,
  setUsername,
  setEquippedBanner,
  setEquippedIcon,
  setEquippedKit,
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
  warmSimulator,
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
  setScoreboardStatus,
  renderProfileScreen,
  renderPlayerBannerCard,
  renderBadgeCollection,
  renderBadgeSportTabs,
  renderUnlockableTabs,
  renderBanners,
  renderIcons,
  renderPlayerIcon,
  renderBannerSportTabs,
  renderEquippedBanner,
  renderMatchupSide,
  preloadBannerArt,
  renderTacticPicker,
  renderStrategyGroups,
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
  accumulatePeriodStats,
  liveStatKeys,
  formatMvpStatLine,
  statPairs,
  statLine,
  renderMvpCallout,
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
  // Both live sports now fetch their dataset on selection rather than at boot,
  // so at this point the pool may simply not be here yet. Warming would have to
  // DOWNLOAD it to compute anything, which is the cost the lazy load exists to
  // avoid - so the warm-up waits instead. selectSport() calls this again once
  // ensureSportData() has resolved, which is where the work actually lands.
  if (!sportById(sportId).dataReady()) return;
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
  if (game.online && game.online.watcher) {
    game.online.watcher.stop();
    game.online.watcher = null;
  }
}

/** "I just submitted something - stop waiting out the poll interval."
 *
 * Every online action this player takes is answered by the server before the
 * watcher's next scheduled read, so without this the client sits on a stale
 * screen for up to a full interval after each pick, each skip and the final
 * gameplan submit. Safe to call when there is no watcher (the strategy phase
 * can outlive it). */
function pokeOnlineWatcher() {
  if (game.online && game.online.watcher) game.online.watcher.poke();
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
  avatar: document.getElementById("home-avatar"),
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
    // A stable hook for tests and for anything that needs to address one
    // sport's tile. The browser selftest had no way to pick a sport, so it sat
    // on the hub clicking for a mode toggle that only appears inside one.
    card.dataset.sport = s.id;
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
/**
 * Which year of this player you are drafting.
 *
 * @param placement { roster, slots } - what the pick has to fit into. Seasons
 *   that cannot be placed are offered but not selectable, with the reason
 *   shown, rather than silently accepting a choice that cannot become a pick.
 *
 * WHY THIS FILTERS AT ALL. A player card is enabled from the UNION of the
 * positions he held across every draftable season - a man who was a power
 * forward one year and a centre another is offered while either slot is open.
 * The pick handler then evaluates the ONE season you chose. Pick the year he
 * was a power forward when only centre is open and the two disagree: the card
 * said yes, the handler finds no eligible slot, and what reached the draft was
 * a pick with `undefined` for a slot. Offline that is a lost pick; online the
 * server rejects it, and against the test double it crashed the draft outright.
 * The card is not wrong - he really is draftable - so the fix belongs here,
 * where the year is chosen.
 */
function openSeasonPicker(player, seasons, onChoose, showStats = false, placement = null) {
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
    // Through the sport's own hook, not basketball's columns. This printed
    // "undefined pts · undefined reb · undefined ast" on every football season,
    // which is the same bug the draft board had - fixed there, missed here,
    // because the year picker is a separate render path.
    // A row is one line by design, so this one wants the string form - built
    // from the same pairs the draft card renders as a grid, not authored a
    // second time.
    row.querySelector(".season-line").textContent = showStats
      ? statLine([...statPairs(s), { value: s.games, label: "games" }])
      : "";

    const placeable = !placement || eligibleOpenSlots(s, placement.roster, placement.slots).length > 0;
    if (!placeable) {
      row.disabled = true;
      row.classList.add("disabled");
      // Says WHY, because "that year is greyed out" with no reason reads as a
      // bug. Positions only - no stats - so this cannot leak numbers into the
      // ranked ruleset, which is the whole point of hiding them.
      row.querySelector(".season-line").textContent =
        `${(s.pos || []).join(" / ")} - no open slot`;
    } else {
      row.addEventListener("click", () => {
        closeModal();
        onChoose(s);
      });
    }
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
    // Your kit travels with the session so every stage can dress itself without
    // re-reading the profile mid-match.
    game.myKit = profile.equippedKit || DEFAULT_KIT_ID;
    // YOUR colours, app-wide, for the places that are about you rather than
    // about a match - the banner most of all. These are NEW properties, not a
    // reassignment of --accent: the sport still owns the app's theme, and a kit
    // that repainted 121 accent rules would make every screen look like a
    // different app depending on who was signed in.
    const myKit = kitById(game.myKit);
    document.documentElement.style.setProperty("--my-kit-ink", myKit.primary);
    document.documentElement.style.setProperty("--my-kit-trim", myKit.secondary);
    // The banner is sport-neutral, so it carries the all-sports rank. The
    // ratings table is read once here and handed to both, since the banner and
    // the standings below it are ranking against the same field.
    const population = await allSportRatings().catch(() => []);
    const rankInfo = await loadOverallRankInfo(profile, population);
    renderPlayerBannerCard(homeHeaderRefs, profile, rankInfo);
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
    setAuthStatus(signInFailureMessage(identifier, e), "error");
  } finally {
    btnAuthSubmit.disabled = false;
  }
});

/**
 * Why the sign-in failed, said in terms the player can act on.
 *
 * "Email or username" is only half true, and the half that is false is invisible
 * from the sign-in box. A username with no "@" is resolved to the synthetic
 * <username>@ballknowledge.app address the OLD username-only sign-up minted (see
 * resolveIdentifier in js/supabaseClient.js). Accounts created since - and any
 * legacy account that has attached a real address - do not have that synthetic
 * email any more, so their username resolves to an account that does not exist.
 *
 * Supabase answers that with "Invalid login credentials", which is correct and
 * useless: it is the same sentence a wrong PASSWORD gets. So a player whose
 * username stopped working retypes their password, gets the same message, and
 * concludes the account is gone. That is the report this was written for.
 *
 * Only rewritten for a credentials failure on a username - a network error or a
 * rate limit still says what it was, and an email that fails really might be a
 * wrong password.
 */
function signInFailureMessage(identifier, error) {
  const raw = error?.message || "";
  const usedUsername = !identifier.includes("@");
  const badCredentials = /invalid login credentials/i.test(raw);
  if (usedUsername && badCredentials) {
    return "That username and password didn't match an account. If you signed up with an email address, sign in with the email instead - usernames only work for older accounts.";
  }
  return raw || "That didn't work. Try again.";
}

for (const el of [inputAuthPassword, inputAuthUsername, inputAuthEmail, inputAuthIdentifier]) {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnAuthSubmit.click();
  });
}

// ---- Sound -----------------------------------------------------------------
// The context cannot be created outside a user gesture on mobile, and one made
// before a gesture stays suspended forever - a silent game with nothing in the
// console to explain it. primeSound waits for the first gesture there is.
primeSound();

// Sound lives under Account settings on the profile, not in the header - it is
// a thing you set once, and it was holding permanent space on every screen.
const navSound = document.getElementById("setting-sound");
const navSoundIcon = document.getElementById("setting-sound-icon");
const navSoundLabel = document.getElementById("setting-sound-label");

function paintSoundToggle() {
  const on = soundEnabled();
  navSound.setAttribute("aria-pressed", on ? "true" : "false");
  // The icon is decorative; the state is carried by aria-pressed and by the
  // visually-hidden label, so it is never colour or glyph alone.
  navSoundIcon.textContent = on ? "\u{1F50A}" : "\u{1F507}";
  // "On"/"Off" rather than "Sound on"/"Sound off": the row already says Sound,
  // and aria-labelledby joins the two so a screen reader still hears both.
  navSoundLabel.textContent = on ? "On" : "Off";
  navSound.title = on ? "Sound on" : "Sound off";
}

navSound.addEventListener("click", () => {
  const on = setSoundEnabled(!soundEnabled());
  paintSoundToggle();
  // Confirm turning it ON by making a sound. Turning it off confirms itself
  // by the silence that follows.
  if (on) playSound("tap");
});
paintSoundToggle();

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
/** True while a sport's dataset is still arriving. A sport whose data ships on
 * boot is never in this state; football is, for about as long as 4.2MB takes. */
let sportDataLoading = false;

function renderPlayability() {
  const playable = isLive(getSport());
  // A SPORT THAT IS STILL LOADING IS NOT YET PLAYABLE.
  //
  // Football's dataset now arrives when football is chosen rather than on
  // boot, which opens a window - short on a desktop, not short on a phone -
  // where the button looks ready and the player pool does not exist yet.
  // Clicking through it produced a draft screen that never appeared, with
  // nothing on screen to say why. The button now says what it is waiting for.
  btnStartDraft.disabled = !playable || sportDataLoading;
  btnStartDraft.textContent = !playable
    ? `${sport().name} isn't playable yet`
    : sportDataLoading
      ? `Loading ${sport().name}…`
      : "Start Draft";
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

async function setSport(id) {
  if (!setActiveSport(id)) return;
  applyTheme(sport());
  // Football's dataset is 4.2MB and is fetched the moment football is chosen,
  // not on boot. Awaited HERE, before anything reads the player pool, so every
  // screen below can stay synchronous - the alternative is every caller
  // learning that one sport loads late.
  sportDataLoading = true;
  renderPlayability();
  try {
    await ensureSportData(id);
  } catch (error) {
    // Never silent: the button stays disabled and says so, and the reason is
    // on the console for anyone debugging it.
    console.error(`Could not load ${id} data:`, error);
    sportDataLoading = false;
    renderPlayability();
    sportPreviewNoteEl.hidden = false;
    sportPreviewNoteEl.textContent = `${sport().name} data could not be loaded. Check your connection and try again.`;
    return;
  }
  sportDataLoading = false;
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

  // STAY WHERE THE MESSAGE IS. This used to navigate home and then write the
  // reason into an element on the Play screen it had just left, so every
  // matchmaking failure looked like the app bouncing you to the home screen
  // for no stated reason. Only a clean cancel goes home.
  if (message) {
    searchStatusEl.classList.remove("hidden");
    searchStatusEl.textContent = message;
  } else {
    searchStatusEl.classList.add("hidden");
    showScreen("home");
    setActiveNav("play");
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
    // A sport whose SERVER cannot run an online match must say so here rather
    // than queue and fail. Football's matchmaking insert violates a CHECK
    // constraint, and the failure path used to navigate home while writing the
    // reason onto the screen it was leaving - so it read as the app silently
    // giving up.
    if (!sport().onlineReady) {
      searchStatusEl.classList.remove("hidden");
      searchStatusEl.textContent =
        `Online ${sport().name} isn't open yet - the server has no ${sport().name} draft pool. ` +
        `Ranked Practice against the bot plays the same game.`;
      return;
    }
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
// A sport may run more than one strategy decision at once - football picks an
// offensive AND a defensive gameplan. Held beside `tactic` rather than
// replacing it so basketball's single choice keeps working untouched.
strategy.strategy = sport().defaultStrategy ? { ...sport().defaultStrategy } : null;
let tacticTimerInterval = null;

function cleanupTacticTimer() {
  if (tacticTimerInterval) {
    clearInterval(tacticTimerInterval);
    tacticTimerInterval = null;
  }
}

function renderTactics() {
  const groups = sport().strategyGroups;
  if (groups && strategy.strategy) {
    // Only what this game offered, not the whole catalogue.
    const offered = strategy.offeredPlans
      ? groups.map((g) => ({ ...g, plans: strategy.offeredPlans[g.key] || g.plans }))
      : groups;
    renderStrategyGroups(tacticGridEl, offered, strategy.strategy, (groupKey, id) => {
      strategy.strategy = { ...strategy.strategy, [groupKey]: id };
      renderTactics();
    });
    return;
  }
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

  const groups = sport().strategyGroups;
  const perGroup = sport().strategyChoices || 3;
  let groupIndex = 0;

  // Grouped sports (NFL) make each side of the ball its own round.
  // Draw all offers once so advancing from offense to defense never
  // rerolls either hand, then show only the current group.
  if (groups && groups.length) {
    strategy.offeredPlans = {};
    for (const group of groups) {
      const pool = [...group.plans];
      const picked = [];
      while (picked.length < Math.min(perGroup, pool.length)) {
        picked.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
      }
      strategy.offeredPlans[group.key] = picked;
    }
    strategy.strategy = Object.fromEntries(
      groups.map((g) => [g.key, strategy.offeredPlans[g.key][0].id])
    );
  } else {
    // Basketball keeps the original single-round 3-card gamestyle.
    strategy.offeredTactics = sport().randomTacticChoices(3);
    strategy.tactic = strategy.offeredTactics[0].id;
  }

  draftPoolPanel.classList.add("hidden");
  tacticPhaseEl.classList.remove("hidden");
  pickTimerEl.hidden = !timed;

  function startRoundTimer() {
    cleanupTacticTimer();
    if (!timed) return;
    let remaining = sport().tacticTimerSeconds || TACTIC_TIMER_SECONDS;
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

  function renderCurrentRound() {
    if (!groups || !groups.length) {
      renderTactics();
      startRoundTimer();
      return;
    }

    const group = groups[groupIndex];
    const plans = strategy.offeredPlans[group.key] || group.plans;
    const isOffense = group.key === "offense";
    const roundName = isOffense ? "Offensive Gameplan" : group.key === "defense" ? "Defensive Gameplan" : (group.label || "Gameplan");

    draftTurnBanner.textContent = `${roundName} — Round ${groupIndex + 1} of ${groups.length}`;
    tacticPhaseHintEl.textContent = timed
      ? `${sport().tacticTimerSeconds || TACTIC_TIMER_SECONDS} seconds — choose 1 of ${plans.length} ${roundName.toLowerCase()} options.`
      : `Choose 1 of ${plans.length} ${roundName.toLowerCase()} options.`;

    renderStrategyGroups(
      tacticGridEl,
      [{ ...group, plans }],
      strategy.strategy,
      (groupKey, id) => {
        strategy.strategy = { ...strategy.strategy, [groupKey]: id };
        renderCurrentRound();
      }
    );

    btnPlayGame.textContent = groupIndex < groups.length - 1
      ? "Lock Offense & Continue"
      : "Lock Defense & Continue";
    startRoundTimer();
  }

  function confirm() {
    cleanupTacticTimer();

    // NFL offense confirms into a brand-new defensive round with a
    // fresh clock and its own three random choices. Nothing from the
    // defensive hand is visible while offense is being chosen.
    if (groups && groupIndex < groups.length - 1) {
      groupIndex += 1;
      renderCurrentRound();
      return;
    }

    tacticPhaseEl.classList.add("hidden");
    draftPoolPanel.classList.remove("hidden");
    pickTimerEl.hidden = true;
    pickTimerEl.textContent = "";
    btnPlayGame.onclick = null;
    btnPlayGame.textContent = "Play Game";
    onConfirm();
  }

  btnPlayGame.onclick = confirm;
  renderCurrentRound();
}

/** Re-show the gamestyle screen as a retry, without re-running the phase.
 *
 * startTacticPhase would redraw a fresh hand of gamestyles and reset the
 * choice; this only unhides the cards that are already rendered, so what the
 * player sees is the plan they committed, waiting to be sent again. No clock:
 * the pick was already made in time, and a countdown on an error message
 * pressures the player over a failure that wasn't theirs. */
function offerStrategyResubmit(message, onRetry) {
  cleanupTacticTimer();
  draftPoolPanel.classList.add("hidden");
  tacticPhaseEl.classList.remove("hidden");
  pickTimerEl.hidden = true;
  pickTimerEl.textContent = "";
  tacticPhaseHintEl.textContent = message;
  btnPlayGame.textContent = "Send Game Plan Again";
  btnPlayGame.onclick = () => {
    // One retry per press - a double tap must not fire two submits.
    btnPlayGame.onclick = null;
    tacticPhaseEl.classList.add("hidden");
    draftPoolPanel.classList.remove("hidden");
    btnPlayGame.textContent = "Play Game";
    onRetry();
  };
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
/** Sports that have a rotation to set. Basketball spends 240 minutes across
 * ten players; football plays everyone every snap of his side of the ball, so
 * there is nothing to allocate.
 *
 * This is why NFL never simulated: the rotation screen keeps Confirm disabled
 * until the whole budget is spent, NFL's budget is 0 with no minutes to spend,
 * so the button could never unlock and the draft ended at a dead screen. The
 * phase is skipped rather than shown empty - an empty screen with a dead button
 * is worse than no screen.
 */
function hasRotation() {
  return (sport().rotationBudget || 0) > 0;
}

/** Same for defensive matchups, asked as a DECLARED FACT rather than by
 * calling defaultMatchups to see what comes back.
 *
 * Probing it was a bug: NBA's signature is defaultMatchups(roster, oppRoster)
 * and this passed a slots array, which threw inside the check and stopped
 * basketball dead right after the rotation screen. A capability question
 * should never be answered by invoking the capability with invented
 * arguments. */
function hasMatchups() {
  return sport().usesMatchups === true;
}

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
  // The sport says what its own board accepts. Basketball's slots are all
  // individuals, so it declares nothing and keeps the original wording;
  // football's board takes a position for its six unit slots and says so,
  // because "type a player's name" is a dead end at half its roster.
  const fromMemory = sport().labels?.searchHint || "Type a player's name from memory…";
  poolSearch.placeholder = easy ? "Filter this squad…" : fromMemory;
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
  const rendered = renderPool(
    poolList,
    draft.currentSquad,
    poolSearch.value,
    rosterFor(side),
    pendingName,
    onPoolPick,
    sport().players(),
    game.ruleset,
    draft.slots,
    (player, seasons, showStats) =>
      openSeasonPicker(player, seasons, onPoolPick, showStats, {
        roster: rosterFor(game.round.activeSide),
        slots: game.draft.slots,
      })
  );
  // The pool told the player it is broken; running the clock down and
  // forfeiting their pick on top of that would be charging them for our bug.
  if (!rendered.ok) cleanupPickTimer();
}

function onPoolPick(player) {
  const roster = rosterFor(game.round.activeSide);
  const { slot, choices } = resolvePickSlot(player, roster, game.draft.slots);
  // Nothing fits: re-render so the board reflects reality rather than
  // swallowing the click. See resolvePickSlot for why this is not a shortcut.
  if (!slot && choices.length === 0) {
    game.round.pendingPlayer = null;
    renderDraftRound();
    return;
  }
  // One eligible slot, or every eligible slot is bench (interchangeable, so
  // asking which one isn't a real decision) - place him without a popup.
  if (slot) {
    finalizePick(player, slot);
    return;
  }
  const slots = choices;
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

/**
 * One note on the grade card.
 *
 * A FACT IS A ROW, ADVICE IS A CLAUSE, and the difference is why the card
 * stopped wrapping. A fact puts its label and its value at opposite ends of
 * one line and forbids either from breaking; a clause is allowed the words it
 * needs. See js/gradenotes.js for the measurements that led here.
 *
 * A plain string still renders - as a clause - because a sport is free not to
 * have been converted, and a card that throws on one note is worse than a card
 * with one long bullet in it.
 */
function gradeNoteRow(note) {
  const li = document.createElement("li");
  if (!isNote(note) || note.kind === "advice") {
    li.className = "grade-note grade-advice";
    li.textContent = noteText(note);
    return li;
  }
  li.className = `grade-note grade-stat grade-${note.tone || "neutral"}`;
  const label = document.createElement("span");
  label.className = "grade-note-label";
  label.textContent = note.label;
  const value = document.createElement("span");
  value.className = "grade-note-value";
  value.textContent = note.value;
  li.append(label, value);
  return li;
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
  // The rotation nudge is advice by nature - it tells you to go and change
  // something - so it joins the clauses at the bottom rather than the numbers
  // at the top.
  if (hint) reasons.push(adviceNote(hint));
  for (const reason of reasons) {
    draftGradeReasonsEl.appendChild(gradeNoteRow(reason));
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
    `${sport().rotationBudget} ${sport().labels.unit} to spend. Starters play more than the bench. ` +
    `Lower someone to free ${sport().labels.unit} before raising someone else.`;
  const toTactic = () => {
    draftTurnBanner.textContent = "Final round — set your game plan";
    tacticPhaseHintEl.textContent = `${sport().tacticTimerSeconds || TACTIC_TIMER_SECONDS} seconds to choose how this team plays.`;
    startTacticPhase(runLocalSimulation);
  };
  const afterRotationOffline = () => {
    if (!hasMatchups()) return toTactic();
    draftTurnBanner.textContent = "Set your defensive matchups";
    matchupPhaseHintEl.textContent =
      `Your starters are on their opposite numbers by default. Move anyone you want - ` +
      `switching two players trades their assignments.`;
    startMatchupPhase(draft.rosterA, draft.rosterB, game.nameB, toTactic);
  };
  // Straight past both phases for a sport that has neither. NFL has no minutes
  // to allocate and no matchups to assign, and the rotation screen keeps its
  // Confirm disabled until the budget is spent - a budget of zero could never
  // be spent, so the draft ended on a dead screen and nothing ever simulated.
  if (hasRotation()) startRotationPhase(draft.rosterA, draft.slots, afterRotationOffline);
  else afterRotationOffline();
}

// ---- Online draft flow ----

const matchupIntroEl = document.getElementById("matchup-intro");
const matchupSideAEl = document.getElementById("matchup-side-a");
const matchupSideBEl = document.getElementById("matchup-side-b");
const matchupVsEl = document.getElementById("matchup-vs");
const matchupCountdownEl = document.getElementById("matchup-countdown");
const matchupRefsA = { slot: document.getElementById("matchup-card-a") };
const matchupRefsB = { slot: document.getElementById("matchup-card-b") };

/** The "you've been matched" beat between finding an opponent and the draft
 * actually starting.
 *
 * Each side is that player's whole card - the same one they see on their home
 * screen, banner artwork and all (see renderMatchupSide in js/ui.js) - so the
 * screen introduces two players rather than two pieces of wallpaper.
 *
 * It runs about 9 seconds now, roughly two longer than it did, and the extra
 * time is spent on presentation rather than on waiting: the screen fades up,
 * each side's card flies in with its own beat (yours first, then theirs -
 * two cards landing simultaneously reads as a layout, one after the other
 * reads as an introduction), VS lands with an impact flash and a shockwave,
 * and only then does the countdown start. A rising whoosh carries the fly-in and the buzzer lands on
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

  // Wait for the artwork BEFORE the banners fly in, not while they do. The
  // intro is a fixed-length animation and it does not wait for images, so a
  // banner whose file was still in flight flew in as a bare colour gradient and
  // the whole point of the screen - seeing what the two players are flying -
  // was missed. Capped, so a slow connection delays the intro by at most a
  // beat instead of holding the match up for a decoration.
  await preloadBannerArt([mySide.profile.equippedBanner, oppSide.profile.equippedBanner]);

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
    // The opponent's kit, and who is at home.
    //
    // Home is player_a - the same fact mySide is derived from, so both clients
    // reach the same answer with nothing to negotiate. Deliberately NOT random:
    // two clients rolling for it would dress the same match two ways.
    //
    // Expressed in the RENDER frame, where side A is always "me" (see
    // normalizeServerResult). If I am player_a then home is me, render side A.
    // If I am player_b then home is my opponent, who renders as side B. Which
    // collapses to mySide - not a tautology, just the two frames agreeing here.
    oppKit: oppSummary.equippedKit || DEFAULT_KIT_ID,
    homeSide: mySide,
    pendingPlayer: null,
    myRoster: {},
    oppRoster: {},
    currentSquad: null,
    watcher: null,
    // Set once the game reveal has been entered, so the watcher and the
    // post-strategy fallback poll can both aim for it without ever running
    // two reveals at once. See handleOnlineMatchState.
    simulationStarted: false,
    // Same idea for the rotation -> matchups -> gamestyle sequence: entering
    // it twice would ask the player to redo choices they already made.
    strategyPhaseStarted: false,
  };

  if (picks.length === 0) {
    // Both cards carry the SPORT-NEUTRAL rank, the one the home card shows -
    // a player's rank should read the same in the intro as it does on their
    // own screen. One read of the ratings table serves both sides, since the
    // two are being ranked against the same field.
    const population = await allSportRatings().catch(() => []);
    const [myRankInfo, oppRankInfo] = await Promise.all([
      loadOverallRankInfo(myProfile, population),
      loadOverallRankInfo(oppSummary, population),
    ]);
    await playMatchupIntro(
      { profile: myProfile, rankInfo: myRankInfo },
      { profile: oppSummary, rankInfo: oppRankInfo }
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
  game.online.watcher = watchMatch(
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
      showBannerMessage("Couldn't play back the game (" + e.message + ") - your result is safe, check Profile > Recent Games.");
      btnToProfile.classList.remove("hidden");
      btnPlayAgain.classList.remove("hidden");
      btnGameHome.classList.remove("hidden");
    }
    return;
  }
  try {
    if (match.status === "strategy") {
      cleanupPickTimer();
      // Enter the strategy sequence ONCE per match. Every phase in it is a
      // decision the player already made - re-entering restarts them at the
      // rotation screen and throws those decisions away, which is exactly what
      // a failed strategy submit used to do: submit fails, the error routes
      // back through here, the player sets 240 minutes again, the retry fails
      // the same way. Recovery from a failed submit belongs at the submit (see
      // beginOnlineStrategyPhase), not at the top of the phase.
      if (game.online.strategyPhaseStarted) return;
      game.online.strategyPhaseStarted = true;
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

  // ENRICHED MID-DRAFT, not only at the end.
  //
  // This used to skip enrichment on the grounds that the roster panels show no
  // stats under the strict ruleset. True for basketball, where a roster row is
  // a name and a season. Not true for football: a drafted unit's row names the
  // MEN in it - "Grady Jarrett, Jonathan Babineaux, Courtney Upshaw" - and
  // that list lives in the pool payload, not on the pick row. Without it the
  // defensive picks sat as bare unit names for the whole draft and the names
  // appeared all at once at the final screen, which is where they matter
  // least.
  //
  // Costs nothing: every squad this needs was already fetched as the current
  // squad in the round it was offered, and fetchSquadPlayers caches.
  const statsByKey = await fetchStatsForPicks(picks);
  const { rosterA, rosterB } = buildVisibleState(picks, match.round_number, statsByKey);
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
  const rendered = renderPool(
    poolList,
    o.currentSquad,
    poolSearch.value,
    o.myRoster,
    pendingName,
    onOnlinePoolPick,
    sport().players(),
    game.ruleset,
    sport().slots.ranked,
    (player, seasons, showStats) =>
      openSeasonPicker(player, seasons, onOnlinePoolPick, showStats, {
        roster: game.online.myRoster,
        slots: sport().slots.ranked,
      })
  );
  // Same contract as offline. The server still holds the turn clock, so this
  // only stops the local countdown from pressuring a player who cannot search.
  if (!rendered.ok) cleanupPickTimer();
}

function onOnlinePoolPick(player) {
  const o = game.online;
  const { slot, choices } = resolvePickSlot(player, o.myRoster, sport().slots.ranked);
  // Same rule as offline, from the same function - and it matters more here:
  // an undefined slot reached the server as `p_slot: undefined`, which the real
  // RPC rejects with "slot is not valid", a confusing error for a click the
  // interface had allowed.
  if (!slot && choices.length === 0) {
    o.pendingPlayer = null;
    renderOnlinePositionAndPool();
    return;
  }
  if (slot) {
    finalizeOnlinePick(player, slot);
    return;
  }
  const slots = choices;
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
    // The round may already have advanced - if the opponent picked first, the
    // server rolled the next squad while this request was in flight.
    pokeOnlineWatcher();
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
    pokeOnlineWatcher();
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

  // The draft is over, so the next server call this match makes is the
  // simulation. Start its cold start NOW, against the seconds the player is
  // about to spend on a rotation and a gameplan, rather than after they have
  // committed and are watching an empty scoreboard. Not awaited: nothing here
  // depends on it, and a failed warm-up costs a cold start, not a game.
  warmSimulator();

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

  if (hasRotation()) {
    draftTurnBanner.textContent = "Set your rotation";
    rotationPhaseHintEl.textContent =
      `${sport().rotationBudget} ${sport().labels.unit} to spend. Starters play more than the bench. ` +
      `Lower someone to free ${sport().labels.unit} before raising someone else.`;
  }
  /**
   * Commit rotation + matchups + gamestyle, and recover in place if that
   * fails.
   *
   * The failure path is the whole point. This used to hand the error back to
   * handleOnlineMatchState, which saw a match still in 'strategy' and started
   * the phase over - so a rejected submit sent the player back to the rotation
   * screen to re-assign 240 minutes, re-assign matchups and re-pick a
   * gamestyle, only to be rejected again. A submit that fails must not cost
   * the player the choices the submit was carrying.
   *
   * Three outcomes are genuinely different and are told apart here:
   *   - the match moved on (both sides in, or already simulating): follow it
   *   - the match is gone (opponent left, stale sweep): say so, terminally
   *   - the submit itself failed: keep every choice, show why, offer a retry
   */
  const submitOnlineStrategy = async () => {
    draftTurnBanner.textContent = "Submitting your game plan…";
    try {
      // A sport with strategy groups commits the whole pair; one without
      // commits its single gamestyle id, exactly as before.
      await submitStrategy(
        o.matchId,
        strategy.rotationMinutes,
        strategy.matchups,
        sport().strategyGroups ? strategy.strategy : strategy.tactic
      );
      draftTurnBanner.textContent = "Waiting for opponent to finish their game plan…";
      // If the opponent got their gameplan in first, the match flipped to
      // ready_to_simulate inside the call that just returned, and the reveal
      // can start now rather than after the next scheduled poll.
      pokeOnlineWatcher();
      awaitSimulationStart();
      return;
    } catch (e) {
      console.error("Strategy submit failed:", e);
      let freshMatch;
      try {
        freshMatch = await getMatch(o.matchId);
      } catch (pollError) {
        console.error("Couldn't re-read the match after a failed submit:", pollError);
        freshMatch = undefined;
      }
      // getMatch returns null (not an error) when the row is gone.
      if (freshMatch === null) {
        handleOpponentLeft();
        return;
      }
      if (freshMatch && freshMatch.status !== "strategy") {
        await handleOnlineMatchState(freshMatch);
        return;
      }
      draftTurnBanner.textContent = "Couldn't submit your game plan.";
      offerStrategyResubmit(
        `${e.message} - your rotation, matchups and game plan are all still set. Send them again.`,
        submitOnlineStrategy
      );
    }
  };

  const onlineTactic = () => {
      draftTurnBanner.textContent = "Final round — set your game plan";
      tacticPhaseHintEl.textContent = `${sport().tacticTimerSeconds || TACTIC_TIMER_SECONDS} seconds to choose how this team plays.`;
      startTacticPhase(submitOnlineStrategy);
  };
  const afterRotationOnline = () => {
    if (!hasMatchups()) return onlineTactic();
    draftTurnBanner.textContent = "Set your defensive matchups";
    matchupPhaseHintEl.textContent =
      `Your starters are on their opposite numbers by default. Move anyone you want - ` +
      `switching two players trades their assignments.`;
    startMatchupPhase(o.myRoster, o.oppRoster, o.oppUsername, onlineTactic);
  };
  if (hasRotation()) {
    startRotationPhase(o.myRoster, sport().slots.ranked, afterRotationOnline, ONLINE_ROTATION_TIMER_SECONDS);
  } else {
    afterRotationOnline();
  }
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
  const startedAt = Date.now();
  // Fast first, then backing off. The likeliest single moment for the match to
  // already BE ready is the instant this starts - the opponent submitted while
  // this player was still choosing - and that case used to cost a flat two
  // seconds of "waiting for opponent" before anything looked at the match.
  // After the first few reads the honest answer is that the opponent is still
  // deciding, and there is nothing to be gained by asking quickly.
  let gap = 250;

  async function poll() {
    // Left the match, or the reveal already started from the watcher.
    if (!game.online || game.online.matchId !== matchId || game.online.simulationStarted) return;
    if (Date.now() - startedAt > SIMULATION_WAIT_MS) {
      draftTurnBanner.textContent = "Still waiting on your opponent - you can leave the match if they've dropped.";
      return;
    }
    try {
      const match = await getMatch(matchId);
      if (match.status !== "strategy") {
        await handleOnlineMatchState(match);
        return;
      }
    } catch (e) {
      console.error("Waiting-for-simulation poll failed:", e);
    }
    setTimeout(poll, gap);
    gap = Math.min(2000, Math.round(gap * 1.6));
  }

  poll();
}

poolSearch.addEventListener("input", () => {
  if (game.mode === "online") {
    if (game.online && game.online.currentSquad) renderOnlinePositionAndPool();
  } else if (game.draft && game.draft.currentSquad) {
    renderPoolForCurrentState();
  }
});

// ---- Game screen (live scoreboard + final box score) - shared by all modes ----

const gameStageEl = document.getElementById("game-stage");
const liveScoreboard = document.getElementById("live-scoreboard");
const finalBanner = document.getElementById("final-banner");

/**
 * The final banner as a PLAIN MESSAGE, not a result.
 *
 * finish() dresses this element up: a won/lost class for the border colour and
 * an aria-label carrying the whole sentence, because the three stacked spans
 * would otherwise be read as "Lost24-28Bot wins". Both of those outlive the
 * game unless something removes them, and the error paths below reuse the same
 * element - so an error could arrive wearing the last game's green WON border,
 * and a screen reader would announce the previous game's final score instead
 * of the message, since aria-label wins over text content.
 *
 * Anything that puts a sentence in this banner goes through here.
 */
function showBannerMessage(text) {
  finalBanner.classList.remove("final-won", "final-lost", "win-flare");
  finalBanner.removeAttribute("aria-label");
  finalBanner.textContent = text;
  finalBanner.classList.remove("hidden");
}
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
  // OPTIONAL, like buildTimeline. A sport that has not written its own
  // analysis panel does not get one - it does not get basketball's, and it
  // does not get an exception every game either. Football declares
  // buildPostGameAnalysis instead, which is a different panel with a
  // different signature, so calling this unconditionally logged a caught
  // TypeError at the end of every single football game. That noise was
  // invisible until the MVP crash above it was fixed.
  if (typeof sport().buildWhyBreakdown !== "function") {
    whyBreakdownEl.classList.add("hidden");
    return;
  }
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
/**
 * Dresses the stage in both players' colours.
 *
 * Module scope, not nested inside playOutResult - resetGameScreen calls this,
 * and the first version of it lived inside playOutResult where nothing outside
 * could see it. That threw a ReferenceError the moment the game screen was
 * cleared, which surfaced as "the game screen never appeared" in the football
 * playback test rather than as anything mentioning colour.
 *
 * Scoped to #game-stage, NEVER to documentElement. --accent is the SPORT's
 * identity and themes 121 rules across the app; a player's kit has no business
 * overwriting it, which is why applyTheme() stays global and this does not.
 *
 * Home wears its primary, away its secondary, and wornColours settles any clash
 * deterministically - both clients compute the same answer from the same two kit
 * ids, the way the shot ledger is seeded from the same match.
 *
 * Sides here are the RENDER frame, where A is always "me".
 */
/**
 * The kit picker: one swatch per kit, showing both of its colours.
 *
 * Each swatch shows the PAIR, because the pair is what you are choosing - a
 * single dot would hide the alternate you wear on the road. Radio semantics
 * rather than buttons, since this is one choice among many and a screen reader
 * should be told that.
 */
function renderKitPicker(container, equippedId, onPick) {
  if (!container) return;
  container.innerHTML = "";
  for (const kit of KITS) {
    const equipped = kit.id === equippedId;
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = `kit-swatch${equipped ? " kit-swatch-on" : ""}`;
    swatch.setAttribute("role", "radio");
    swatch.setAttribute("aria-checked", equipped ? "true" : "false");
    // The name, not just the colours: a swatch row is unusable to anyone who
    // cannot see it, and "Jade" is the actual choice being made.
    swatch.setAttribute("aria-label", `${kit.name}${equipped ? " (equipped)" : ""}`);
    swatch.title = kit.name;
    swatch.style.setProperty("--kit-primary", kit.primary);
    swatch.style.setProperty("--kit-secondary", kit.secondary);
    swatch.innerHTML = '<span class="kit-swatch-primary"></span><span class="kit-swatch-secondary"></span>';
    swatch.addEventListener("click", () => onPick(kit.id));
    container.appendChild(swatch);
  }
}

function dressStage(homeSide, kitA, kitB) {
  const aIsHome = homeSide !== "B";
  const worn = wornColours(aIsHome ? kitA : kitB, aIsHome ? kitB : kitA);
  const forA = aIsHome ? worn.home : worn.away;
  const forB = aIsHome ? worn.away : worn.home;
  const style = gameStageEl.style;
  style.setProperty("--team-a-ink", forA.ink);
  style.setProperty("--team-a-ink-rgb", rgbString(forA.ink));
  style.setProperty("--team-a-trim", forA.trim);
  style.setProperty("--team-b-ink", forB.ink);
  style.setProperty("--team-b-ink-rgb", rgbString(forB.ink));
  style.setProperty("--team-b-trim", forB.trim);
}

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
  gameStageEl.classList.remove("final-flash");
  // The kits, decided before the first paint for the same reason the stage is:
  // whatever is on this screen is visible while the online flow awaits the
  // server, and a stage in last game's colours is a worse lie than a blank one.
  // Offline you are always home - it is your floor and there is no second
  // profile to consult. The bot wears a fixed neutral kit so the two sides still
  // read as two teams.
  dressStage(
    game.online?.homeSide || "A",
    game.myKit || DEFAULT_KIT_ID,
    game.online?.oppKit || BOT_KIT_ID
  );
  // Nor is the last game's result. The won/lost colour and the aria-label
  // outlive the banner being hidden, and both are wrong for the next game.
  finalBanner.classList.remove("final-won", "final-lost", "win-flare");
  finalBanner.removeAttribute("aria-label");
  // The stage belongs to the RESET, not to playback. playOutResult sets it
  // too, but that runs after the online flow has awaited the server for
  // seconds - and whatever index.html leaves unhidden is what shows, so an
  // NFL match sat on the wrong stage for the whole cold start. Whoever
  // clears the game screen is the one who knows a sport is about to be
  // watched on it; deciding the stage here means it is already correct the
  // first time the screen is painted, in every flow, rather than each caller
  // having to remember.
  showStage(sport().presentation.stage);
}

/** The active sport's opening word, in the scoreboard's sentence case -
 * "Tip-off", "Kickoff". The word itself belongs to the sport; only the
 * capitalisation is this screen's business. */
function openingLabel() {
  const word = sport().labels.opening || "";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Shows the one stage this sport is watched on and hides every other.
 *
 * Keyed on data-stage in index.html rather than on ids, so adding a sport
 * means adding a sibling element and declaring its name - not editing a
 * condition here. Hiding the others is the half that was once missing:
 * switching from a sport with field art to one without would otherwise leave
 * the previous sport's stage on screen underneath.
 *
 * A stage name with NO element is legitimate and deliberate: basketball's
 * live stage is "board", which has no field art at all - the scoreboard is
 * the stage, and it lives outside this rotation because every sport shows it.
 * So "board" correctly hides the field and shows nothing else. */
function showStage(stage) {
  for (const el of document.querySelectorAll("#game-stage [data-stage]")) {
    el.classList.toggle("hidden", el.dataset.stage !== stage);
  }
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
  // Seeded from the SPORT's own line keys. These were basketball's six
  // literals, so a football game opened on a live table of PTS/REB/AST that
  // had nowhere to put a completion - the football columns existed in the
  // header with no key behind them to accumulate into.
  const liveTotals = { a: {}, b: {} };
  const emptyLine = () => {
    const line = { pts: 0 };
    for (const key of sport().lineKeys) line[key] = 0;
    return line;
  };
  for (const slot of Object.keys(rosterA)) liveTotals.a[slot] = emptyLine();
  for (const slot of Object.keys(rosterB)) liveTotals.b[slot] = emptyLine();

  // One box score for the whole game: the same table fills in live as periods
  // are revealed, then gains shooting splits at the final buzzer. Showing a
  // reduced live table alongside a separate full one meant two box scores on
  // screen saying different things.
  fullBoxScore.classList.remove("hidden");
  renderFullBoxScore(fullBoxScore, rosterA, liveTotals.a, labelA, rosterB, liveTotals.b, labelB, null, null, minutesA, minutesB);
  // The sport's own word for how a game starts. This said "Tip-off" for
  // everything, so a football game opened by telling you there had been a
  // jump ball.
  renderScoreboard(liveScoreboard, labelA, labelB, periodsSoFar, REGULATION_PERIODS, 0, 0, openingLabel(), true);

  // The stage is whichever one this sport declares, and every other stage is
  // hidden. Previously the field was toggled on the presence of `drives` and
  // nothing ever hid the other sport's stage, so football played with a
  // basketball floor drawn over its field.
  showStage(sport().presentation.stage);
  const footballFieldEl = document.getElementById("football-field");
  let fieldRefs = null;
  // The whole game's playback, built as data before a single timer starts.
  let timeline = { events: [], totalMs: 0 };
  const fieldTimers = [];
  // The board's centre cell has TWO writers: the per-play loop below, and
  // tickScoreTo's 60ms score animation, which re-renders the whole board for
  // QUARTER_TICK_MS at the start of every period. Without one value they both
  // read, the score animation spends the first 1.5s of each quarter painting
  // "Q3 in progress" over a clock that is trying to count down, and the clock
  // appears to freeze at every period break. Whoever writes last wins is not a
  // design; this is.
  let liveStatus = null;
  if (sport().presentation.stage === "field" && Array.isArray(result.drives) && result.drives.length) {
    fieldRefs = sport().presentation.renderField(footballFieldEl, labelA, labelB);
    timeline = sport().presentation.buildTimeline?.(result.drives) || timeline;
  }

  // Basketball's equivalent: a ledger of shots decomposed from the same result
  // the box score is built from, narrated in the feed as the game reveals.
  //
  // The seed has to be the SAME on both machines watching an online game, so
  // it is derived from the result itself rather than drawn fresh - the stored
  // simulation seed when the server recorded one, and the final score when it
  // did not, which is stable for a finished game and differs between games.
  let ledger = { events: [] };
  const shotTimers = [];
  if (sport().presentation.buildShotLedger && Array.isArray(result.quarterBoxScores)) {
    const seed = Number(result.simulationSeed) ||
      (result.teamScoreA * 1000 + result.teamScoreB) * 7919 + result.quarterBoxScores.length;
    ledger = sport().presentation.buildShotLedger(result.quarterBoxScores, rosterA, rosterB, seed);
  }

  /**
   * Spreads one period's shots across the hold that period is given.
   *
   * The ledger carries an ORDER, not a clock - the engine models no game
   * clock, and inventing one would put a second source of truth next to the
   * score. So the events of a period are laid evenly across however long that
   * period is on screen, which keeps them in step with the scoreboard ticking
   * up beside them without pretending to a precision the simulation never had.
   */
  /**
   * How much of a period's screen time one event deserves.
   *
   * Evenly spreading a quarter's shots is arithmetically fair and dramatically
   * flat: a garbage-time miss got exactly as long as the shot that swung the
   * game. Real games are not evenly paced, and a playback that is reads as a
   * progress bar with basketballs on it.
   *
   * So time is spent where the ledger says something happened. Every weight
   * here is a fact the ledger already carries - a lead change, a run past
   * eight, the last shot of the quarter, a make rather than a miss - so the
   * pacing follows the game rather than a script laid over it.
   */
  function dramaWeight(event) {
    let weight = event.made ? 1.15 : 0.85;
    if (event.shotType === "three" && event.made) weight += 0.35;
    if (event.strong) weight += 0.2;
    if (event.runPoints) weight += 0.5;
    if (event.leadChange) weight += 1.2;
    // The last shot of a quarter gets the longest hold in the period. There is
    // no clock in this engine, so it is not literally a buzzer-beater - but it
    // is literally the last thing that happened, and a beat there is what makes
    // a quarter feel like it ENDED rather than just stopped.
    if (event.endOfPeriod) weight += 1.6;
    return weight;
  }

  function playQuarterShots(period, holdMs) {
    const ofPeriod = ledger.events.filter((e) => e.period === period && e.type === "shot" && e.zone != null);
    if (!ofPeriod.length) return;

    // Weighted cumulative offsets rather than an even division. The period
    // still finishes inside its own hold - the weights decide how the time is
    // divided, never how much there is.
    const spread = Math.max(0, holdMs - 500);
    const weights = ofPeriod.map(dramaWeight);
    const total = weights.reduce((sum, w) => sum + w, 0) || 1;
    let elapsed = 0;

    ofPeriod.forEach((event, i) => {
      const at = (elapsed / total) * spread;
      elapsed += weights[i];
      shotTimers.push(setTimeout(() => {
        // The play line is what turns a score ticking up into a game being
        // watched. Withheld from ordinary misses: naming every brick is noise,
        // and the score already says whether the shot fell.
        const worthSaying =
          event.made && (event.shotType === "three" || event.strong || event.runPoints || event.leadChange || event.endOfPeriod);
        // The line a commentator would say, in the feed under the board -
        // which is the thing a person is actually looking at.
        if (worthSaying) {
          const verdict = event.shotType === "three" ? "for three" : event.strong ? "at the rim" : "for two";
          pushPlayHeadline(playFeedEl, `${event.player} ${verdict}`, event.leadChange ? "lead-change" : "");
        }

        // The sound names the KIND of shot, and the throttle in sound.js keeps
        // a busy quarter from turning into a buzz. A miss is quieter than a
        // make on purpose - the chart already shows every attempt, and the
        // sound is there to mark the ones that changed the score.
        playSound(
          !event.made ? "shotMiss" : event.strong ? "rimFinish" : event.shotType === "three" ? "shotThree" : "shotMade"
        );

        // The two things a person watching would say out loud. Both are read
        // off the ledger's running score, so they can never disagree with the
        // scoreboard ticking up beside them.
        if (event.leadChange) {
          const who = event.side === "a" ? labelA : labelB;
          pushPlayHeadline(playFeedEl, `${who} TAKE THE LEAD`, "lead-change");
          playSound("steal");
        } else if (event.runPoints) {
          const who = event.runSide === "a" ? labelA : labelB;
          pushPlayHeadline(playFeedEl, `${who} ON A ${event.runPoints}-0 RUN`, "run");
        }
      }, at));
    });
  }

  /**
   * Plays one period's slice of the timeline.
   *
   * The events already carry their own offsets, so this only has to rebase
   * them onto the moment the period starts. Timing comes from the timeline,
   * not from the period's hold - which is what stops a game with few drives
   * crawling and one with many flickering past.
   */
  /** How long one period's events actually take, at the pace the timeline was
   * built for. Zero when this sport has no timeline. */
  function timelineSpanFor(period) {
    const ofPeriod = timeline.events.filter((e) => e.quarter === period);
    if (!ofPeriod.length) return 0;
    const last = ofPeriod[ofPeriod.length - 1];
    return Math.max(0, last.atMs + last.durationMs - ofPeriod[0].atMs);
  }

  /**
   * Plays one period's slice of the timeline, AT ITS OWN PACE.
   *
   * This used to compress the slice to fit basketball's quarter hold: a
   * quarter of football spans about eight seconds and the hold is 3.8, so
   * every event was shown at under half the speed it was designed for. That
   * is the whole of "the simulation finishes too quickly to follow" - the
   * timeline was right and the harness around it was throwing the pacing
   * away.
   *
   * Nothing is squeezed now. The period reveal WAITS for the timeline
   * instead (see holdFor below), which is the only way the ball, the down and
   * distance, the description and the score can stay in step with each other.
   */
  function playQuarterEvents(period) {
    if (!fieldRefs) return;
    const ofPeriod = timeline.events.filter((e) => e.quarter === period);
    if (!ofPeriod.length) return;
    const base = ofPeriod[0].atMs;
    for (const event of ofPeriod) {
      fieldTimers.push(
        setTimeout(() => {
          sport().presentation.showEvent(fieldRefs, event);
          // The clock belongs on the board, where a broadcast puts it and
          // where the eye already is. Sports without a play clock leave this
          // hook off and keep the board's plain period text.
          liveStatus = sport().presentation.liveStatusLabel?.(event) || liveStatus;
          setScoreboardStatus(liveScoreboard, liveStatus);
          // Only the moments worth reading go to the feed. Every snap would
          // be a wall of text nobody follows, and the ball already showed the
          // ordinary ones.
          if (event.scoring > 0 || event.turnover) {
            pushPlayHeadline(playFeedEl, event.text, event.scoring > 0 ? "lead-change" : "");
          }
        }, event.atMs - base)
      );
    }
  }

  /** The pause before the next period is revealed. A sport with a timeline
   * gets however long that period's events genuinely take; everything else
   * keeps basketball's fixed hold. */
  function holdFor(period, isOtPeriod) {
    const fixed = isOtPeriod ? OT_REVEAL_DELAY_MS : QUARTER_REVEAL_DELAY_MS;
    const span = timelineSpanFor(period);
    return span > 0 ? Math.max(fixed, span + 250) : fixed;
  }
  pushPlayHeadline(playFeedEl, `${labelA} vs ${labelB} — ${sport().labels.opening}`);

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
      // The SPORT decides what a big period is and what to call it. This was
      // a hardcoded basketball list, so the feed narrated football in boards
      // and dimes.
      const candidates = (sport().highlights || []).map((h) => ({
        value: line[h.key] || 0,
        min: h.min,
        hot: h.hot,
        mild: h.mild,
      }));
      let bestForPlayer = null;
      for (const c of candidates) {
        if (c.value <= 0) continue;
        const weight = c.value / c.min;
        if (!bestForPlayer || weight > bestForPlayer.weight) {
          bestForPlayer = {
            weight,
            name: player.name,
            text: weight >= 1 ? c.hot(player.name, Math.round(c.value)) : c.mild(player.name, Math.round(c.value)),
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
        pushPlayHeadline(playFeedEl, `${teamLabel} ${fieldRefs ? "held on" : "scraped by"} in ${label}`, "");
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
        done ? doneLabel : liveStatus || duringLabel,
        true
      );
      // renderScoreboard REBUILDS the centre cell, so the ticking state has to
      // go back on after it. Without this the class survives exactly until the
      // next score frame and the clock blinks anyway - which is precisely how
      // this shipped the first time.
      if (!done && liveStatus) setScoreboardStatus(liveScoreboard, liveStatus);
      if (done) {
        // The period is over: drop the last clock reading so the next quarter
        // does not open showing the previous one's final seconds.
        liveStatus = null;
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

    // The stats this sport keeps, not basketball's six literals. A football
    // period line has no `reb`, so every one of those added undefined and
    // turned the running total into NaN, while a completion or a passing yard
    // was never added at all because nothing asked for it.
    const statKeys = liveStatKeys(sport());
    for (const key of ["a", "b"]) {
      const period = result.quarterBoxScores[i][key];
      for (const slot of Object.keys(liveTotals[key])) {
        accumulatePeriodStats(liveTotals[key][slot], period[slot], statKeys);
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
    // Football's playback runs off its own timeline (below), built once for
    // the whole game rather than sliced out of each quarter's hold - see
    // js/sports/nfl/playback.js for why that distinction matters.
    playQuarterEvents(i + 1);
    playQuarterShots(i + 1, holdFor(i + 1, isOt));
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

    // The period just revealed is the one whose events are now playing, so
    // the wait has to be ITS span - read before `i` moves on to the next.
    const wait = holdFor(i + 1, isOt);
    i += 1;
    // Overtime holds longer - see OT_REVEAL_DELAY_MS. isOt is this period, so
    // the pause after it is the one that lets the decisive score land.
    setTimeout(step, wait);
  }

/** One line of the final banner. Text only, never markup - see finish(). */
  function bannerPart(className, text) {
    const el = document.createElement("span");
    el.className = className;
    el.textContent = text;
    return el;
  }

  function finish() {
    for (const t of scoreTickIntervals) clearInterval(t);
    // Nothing should still be waiting to draw on a field the game has left.
    for (const t of fieldTimers) clearTimeout(t);
    // Same for the shot ledger: a pending play line firing after the game ends
    // would land on the next game's feed, or on a screen that has moved on.
    for (const t of shotTimers) clearTimeout(t);
    renderScoreboard(liveScoreboard, labelA, labelB, periodsSoFar, 0, runningA, runningB, "Final", false);
    flashClass(gameStageEl, "final-flash");
    // The broadcast's closing line: not why the winner won (the recap below
    // covers that), just the shape the game itself took.
    pushPlayHeadline(playFeedEl, sport().buildGameScript(periodsSoFar, labelA, labelB), "final");

    const winnerName = result.winner === "A" ? labelA : labelB;
    const otNote = result.overtimePeriods > 0 ? ` (${result.overtimePeriods}OT)` : "";
    // The SCORE leads. It was one uppercase sentence with the numbers buried in
    // the middle of it, which made the single thing everyone looks for the
    // hardest thing on the screen to find. Winner, score, then the outcome from
    // the player's own side.
    //
    // "Won"/"Lost" is spelled out rather than carried by the green or red
    // alone: win and loss are exactly the pair that has to survive being
    // colourblind, and the whole screen is the answer to "did I win".
    const youWon = result.winner === "A";
    // Built as nodes rather than markup. The winner's name is an opponent's
    // username in an online game - untrusted text that has no business being
    // parsed as HTML, and textContent settles that without an escaping step
    // anyone can forget.
    finalBanner.replaceChildren(
      bannerPart("fb-outcome", youWon ? "Won" : "Lost"),
      bannerPart("fb-score", `${result.teamScoreA}–${result.teamScoreB}`),
      bannerPart("fb-winner", `${winnerName} ${subjectVerb(winnerName, "wins", "win")}${otNote}`)
    );
    finalBanner.classList.toggle("final-won", youWon);
    finalBanner.classList.toggle("final-lost", !youWon);
    // Three stacked spans read as one run-on string to a screen reader -
    // "Lost24-28Bot wins". The visual split is a layout decision; the sentence
    // is what should be announced.
    finalBanner.setAttribute(
      "aria-label",
      `${youWon ? "Won" : "Lost"}. Final score ${result.teamScoreA} to ${result.teamScoreB}. ${winnerName} ${subjectVerb(winnerName, "wins", "win")}${otNote}.`
    );
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
    // In the sport's own statistics. This was three basketball literals, so
    // football's best player was announced with a rebound and an assist total
    // that do not exist, both reading zero.
    // THE MOST PASSABLE FACT ON THE SCREEN, built as a card rather than a
    // sentence. This was one line of orange text with no box around it,
    // wedged between the recap card and the Why card - the runt of a stack of
    // panels, and the single thing a person actually turns the phone round to
    // show someone. Same words, given the room they were always worth.
    renderMvpCallout(mvpCallout, {
      name: mvp.player.name,
      team: mvpTeamName,
      line: formatMvpStatLine(sport(), mvp.line),
      // Football explains itself; basketball has no reason to give yet, and
      // the card omits the line rather than printing an empty one.
      note: mvp.reason || null,
    });
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

    // The MVP is already named in the callout above; the box score is where
    // the line that earned it lives, and finding it meant reading two tables.
    renderFullBoxScore(fullBoxScore, rosterA, result.boxA, labelA, rosterB, result.boxB, labelB, shotsA, shotsB, minutesA, minutesB, true,
                       { side: mvp.side, name: mvp.player.name });
    fullBoxScore.classList.remove("hidden");
    btnToProfile.classList.remove("hidden");
    btnPlayAgain.classList.remove("hidden");
    btnGameHome.classList.remove("hidden");

    // The payoff. A win gets the horn, the confetti and the fanfare; a loss
    // gets the horn and a flat two-note fall, because losing shouldn't be
    // louder than winning.
    playBuzzer();
    if (result.winner === "A") {
      // How loud a win is depends on what was at stake. Quick Play got the
      // same 110-piece confetti and fanfare as a ranked game against a real
      // opponent, which spends the celebration on the game that risked
      // nothing - and leaves nothing bigger to give the one that did.
      //
      // Read off what the mode actually IS rather than a flag set beside it:
      // an online game is a real opponent, a strict ruleset is the full game,
      // and anything else is casual.
      const stakes = game.mode === "online" ? "ranked" : game.ruleset === "strict" ? "practice" : "casual";
      const CELEBRATION = {
        ranked: { count: 110, durationMs: 4200, fanfare: true, flare: true },
        practice: { count: 55, durationMs: 2600, fanfare: true, flare: true },
        casual: { count: 22, durationMs: 1500, fanfare: false, flare: false },
      };
      const party = CELEBRATION[stakes];
      confetti({ count: party.count, durationMs: party.durationMs });
      if (party.fanfare) window.setTimeout(playFanfare, 320);
      if (party.flare) replayAnimation(finalBanner, "win-flare");
    } else {
      window.setTimeout(playDefeat, 320);
    }

    onComplete();
  }

  /**
   * Playback for a sport that keeps a LIVE LEDGER - one event at a time,
   * nothing revealed before the play that produced it.
   *
   * The period path above (`step`) reveals a whole quarter at once: it
   * accumulates `result.quarterBoxScores[i]` into the running totals the
   * moment quarter i begins, and only then starts playing that quarter's
   * events. For basketball that is exactly right - the quarter reveal IS the
   * presentation. For football it meant the scoreboard showed the quarter's
   * final score at its first snap and the box score showed every yard still
   * to be gained, so the plays that followed were a replay of a result the
   * viewer had already been given.
   *
   * Here the state is a fold of the events shown so far and nothing else, so
   * a viewer knows exactly as much as the play feed has told them. The sport
   * owns the folding (see js/sports/nfl/playback.js); this function only
   * decides when each event is shown and what on screen reacts to it.
   */
  /** Whose drive it was, in the names actually on screen. */
  function possessionLabel(side) {
    return side === "A" ? labelA : side === "B" ? labelB : "";
  }

  function playEventDriven() {
    const presentation = sport().presentation;
    const live = presentation.createLiveState({ rosterA, rosterB });
    // A quarter's summary is published once, by whichever event ends it.
    const published = new Set();
    let leader = null;

    const labelForQuarter = (quarter) => {
      const idx = result.quarterBoxScores.findIndex((q) => q.period === quarter);
      if (idx < 0) return null;
      return { idx, label: idx >= REGULATION_PERIODS ? `OT${idx - REGULATION_PERIODS + 1}` : `Q${idx + 1}` };
    };

    // WHAT THE BOARD IS ALREADY SHOWING, so a repaint happens only when
    // something on it has actually changed.
    //
    // This is called on EVERY event - roughly 130 times a game, most of them
    // an ordinary snap that scored nothing - and it used to rebuild the whole
    // scoreboard each time. Two things came of that, and the second is the one
    // a viewer complains about:
    //
    //   The score elements were destroyed and recreated between plays, so the
    //   `pulse` glow on them restarted from frame zero about twice a second.
    //   A number that is meant to sit still and breathe instead twitched.
    //
    //   The period table was thrown away and re-parsed to change one string.
    //   setScoreboardStatus was written for exactly this and says so in its
    //   own comment - it just was never the only writer, so the saving it
    //   describes was never actually taken on this path.
    //
    // The board's state is the two totals and the quarter columns; everything
    // else on it is fixed for the game. So those three are what is compared,
    // and between scores the centre cell is the only thing that moves.
    let paintedA = null;
    let paintedB = null;
    let paintedPeriods = -1;

    const paint = (statusLabel, ticking = false) => {
      if (runningA === paintedA && runningB === paintedB && periodsSoFar.length === paintedPeriods) {
        setScoreboardStatus(liveScoreboard, statusLabel, ticking);
        return;
      }
      paintedA = runningA;
      paintedB = runningB;
      paintedPeriods = periodsSoFar.length;
      const regulationPlayed = periodsSoFar.filter((p) => !p.label.startsWith("OT")).length;
      renderScoreboard(
        liveScoreboard,
        labelA,
        labelB,
        periodsSoFar,
        Math.max(0, REGULATION_PERIODS - regulationPlayed),
        runningA,
        runningB,
        statusLabel,
        true
      );
      // Same rebuild, same reason as tickScoreTo above.
      if (ticking) setScoreboardStatus(liveScoreboard, statusLabel, ticking);
    };

    /**
     * A quarter's line goes up when the quarter ENDS, which is the whole
     * point: the summary is a report of something the viewer has now watched
     * rather than a preview of something they have not.
     *
     * The score comes from the live ledger, not from quarterBoxScores, so the
     * column can never disagree with the running total beside it.
     */
    const publishPeriod = (quarter) => {
      if (quarter == null || published.has(quarter)) return;
      const named = labelForQuarter(quarter);
      if (!named) return;
      published.add(quarter);
      const points = live.quarterScores[quarter] || { A: 0, B: 0 };
      periodsSoFar.push({ label: named.label, a: Math.round(points.A), b: Math.round(points.B) });
      paint(`End of ${named.label}`);
      flashClass(liveScoreboard, "period-flash");
      announcePeriod(named.idx, named.label);
    };

    for (const event of timeline.events) {
      fieldTimers.push(
        setTimeout(() => {
          presentation.applyEvent(live, event);
          const score = presentation.liveScore(live);
          const scoreMoved = score.A !== runningA || score.B !== runningB;
          runningA = score.A;
          runningB = score.B;

          if (fieldRefs) sport().presentation.showEvent(fieldRefs, event);
          // Only the moments worth reading go to the feed - every snap would
          // be a wall of text nobody follows, and the ball already showed the
          // ordinary ones.
          if (event.scoring > 0 || event.turnover) {
            pushPlayHeadline(playFeedEl, event.text, event.scoring > 0 ? "lead-change" : "");
          } else if (event.driveSummary) {
            // Every drive gets its epitaph, not just the ones that scored. A
            // twelve-play march that stalled on the 4 used to look exactly
            // like a three-and-out, because the feed only spoke about points.
            pushPlayHeadline(playFeedEl, `${possessionLabel(event.possession)}: ${event.text}`, "drive-summary");
          }

          // Only a play that produced something changes the table. Kickoffs
          // and drive starts carry no player production, and rebuilding the
          // box score for them would be pure churn.
          if (event.playerDeltas) {
            renderFullBoxScore(
              fullBoxScore, rosterA, presentation.liveBox(live, "A"), labelA,
              rosterB, presentation.liveBox(live, "B"), labelB, null, null, minutesA, minutesB
            );
          }

          // A lead change is now caught on the SCORING PLAY rather than at the
          // quarter break, which is when it actually happens.
          if (scoreMoved) {
            const newLeader = runningA === runningB ? null : runningA > runningB ? "A" : "B";
            if (newLeader && leader && newLeader !== leader) {
              const leaderLabel = newLeader === "A" ? labelA : labelB;
              pushPlayHeadline(
                playFeedEl,
                `${leaderLabel} ${subjectVerb(leaderLabel, "takes", "take")} the lead`,
                "lead-change"
              );
              flashClass(liveScoreboard, "lead-flash");
            }
            if (newLeader) leader = newLeader;
          }

          if (event.type === "quarterEnd" || event.type === "halfEnd" || event.type === "gameEnd") {
            publishPeriod(event.quarter);
          } else {
            const named = labelForQuarter(event.quarter);
            // Football puts the running clock in the board's centre cell.
            // Online repaints the board once per event anyway, so unlike the
            // offline path this needs no second writer - the clock is just a
            // better status label.
            const ticking = sport().presentation.liveStatusLabel?.(event);
            paint(ticking || (named ? `${named.label} in progress` : openingLabel()), !!ticking);
          }
        }, event.atMs)
      );
    }

    // The whistle goes after the last event has had its time on screen, not
    // at the moment it appears.
    const last = timeline.events[timeline.events.length - 1];
    fieldTimers.push(setTimeout(finish, last.atMs + last.durationMs + 250));
  }

  // A sport that declares a live ledger is played back event by event;
  // everything else keeps the period reveal.
  const hasLiveLedger = !!(
    sport().presentation.createLiveState &&
    sport().presentation.applyEvent &&
    timeline.events.length
  );
  setTimeout(hasLiveLedger ? playEventDriven : step, QUARTER_REVEAL_DELAY_MS);
}

function runLocalSimulation() {
  const draft = game.draft;
  // Resolve the user's own rotation up front so the box score can show the
  // same minutes the simulation actually used, rather than a second guess.
  const minutesA = strategy.rotationMinutes || sport().defaultMinutes(draft.rosterA);
  const forfeitsA = forfeitedSlotsFor("A", draft.rosterA, draft.slots);
  const forfeitsB = forfeitedSlotsFor("B", draft.rosterB, draft.slots);

  /**
   * SEEDED, THE WAY THE EDGE FUNCTION HAS ALWAYS BEEN.
   *
   * An online game is simulated inside withSeededMathRandom and records its
   * seed, so a finished ranked result can be re-derived from four strings and
   * a number. An offline game recorded none of that and could not have: this
   * path called bare Math.random(), so the same rosters produced a different
   * game every time by about 36% peak-to-peak on team score. That variance is
   * the point of the simulation and it made an offline result unverifiable -
   * "my draft scored 118" was a claim with nothing behind it, including for
   * the person making it.
   *
   * EVERYTHING THE SIMULATION DEPENDS ON GOES INSIDE THE BLOCK, which is the
   * part that is easy to get wrong. The bot's gameplan and the bot's rotation
   * are drawn at random too, and drawing them outside would leave a replay
   * running the right engine on the wrong opponent - a reproduction that
   * reproduces nothing, and one that would look correct because the score it
   * returns is still a plausible score.
   *
   * The seed itself is drawn OUTSIDE, from the real Math.random. Drawn inside,
   * it would be the same number every time and every offline game ever played
   * would be the identical simulation.
   */
  const seed = newSimulationSeed();
  const { result, minutesB } = withSeededMathRandom(seed, () => {
    // The bot commits to a plan too, chosen at random - a fixed opponent plan
    // would make one counter always correct and collapse the choice. For a
    // sport with groups it draws each side of the ball independently, so half
    // its plan is never guessable from the other half.
    const tacticIds = sport().tactics.map((t) => t.id);
    const botTactic = tacticIds[Math.floor(Math.random() * tacticIds.length)];
    const botStrategy = sport().randomStrategy ? sport().randomStrategy() : null;
    const botMinutes = sport().botMinutes(draft.rosterB);
    return {
      minutesB: botMinutes,
      result: sport().simulate(draft.rosterA, draft.rosterB, datasetStatsFor(), {
        tacticA: strategy.tactic,
        tacticB: botTactic,
        strategyA: strategy.strategy,
        strategyB: botStrategy,
        minutesA,
        minutesB: botMinutes,
        matchupsA: strategy.matchups || undefined,
        forfeitsA,
        forfeitsB,
      }),
    };
  });

  // Stamped in the same shape the Edge Function returns, so offline and online
  // results are read by one code path rather than two. The shot ledger already
  // prefers result.simulationSeed when there is one and falls back to the final
  // score when there is not (see playOutResult) - offline games take the first
  // branch now, so the replay and the highlights are drawn from one number.
  const provenance = provenanceFor({
    sportId: getSport(),
    mode: game.ruleset === "strict" ? "practice-strict" : "practice-easy",
    seed,
    datasetVersion: sport().datasetVersion(),
  });
  Object.assign(result, provenance);

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
        provenance,
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
  const remapSide = (side) => {
    if (side !== "A" && side !== "B") return side;
    return dbSideIsMe(side) ? "A" : "B";
  };
  const winnerSide = serverWinner || (dbResult.score_a > dbResult.score_b ? "A" : "B");
  const gameData = dbResult.game_data || {};
  const drives = Array.isArray(gameData.drives)
    ? gameData.drives.map((drive) => ({ ...drive, team: remapSide(drive.team) }))
    : [];
  const coinToss = gameData.coinToss
    ? {
        ...gameData.coinToss,
        winner: remapSide(gameData.coinToss.winner),
        firstHalfReceiver: remapSide(gameData.coinToss.firstHalfReceiver),
      }
    : null;

  return {
    teamScoreA: iAmA ? dbResult.score_a : dbResult.score_b,
    teamScoreB: iAmA ? dbResult.score_b : dbResult.score_a,
    boxA: iAmA ? dbResult.box_a : dbResult.box_b,
    boxB: iAmA ? dbResult.box_b : dbResult.box_a,
    quarterBoxScores: (dbResult.period_scores || []).map((q) => ({
      period: q.period,
      a: iAmA ? q.a : q.b,
      b: iAmA ? q.b : q.a,
      overtime: q.overtime,
    })),
    overtimePeriods: dbResult.overtime_periods,
    winner: dbSideIsMe(winnerSide) ? "A" : "B",
    mvp: {
      player: { name: dbResult.mvp.name },
      side: remapSide(dbResult.mvp.side),
      line: dbResult.mvp.line,
      score: dbResult.mvp.score,
    },
    // Football's trusted server simulation stores its event/drive
    // ledger separately from the common score columns. Restore it
    // here so online NFL uses the same event-driven field playback
    // as Ranked Practice instead of falling back to period totals.
    drives,
    teamStatsA: iAmA ? gameData.teamStatsA : gameData.teamStatsB,
    teamStatsB: iAmA ? gameData.teamStatsB : gameData.teamStatsA,
    coinToss,
    analysis: gameData.analysis || null,
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
  // An empty stage for the length of a cold start reads as a broken screen,
  // so a sport whose stage means something before the result arrives draws it
  // now: football's field with the endzones named and no ball on it yet.
  //
  // Keyed on the DECLARED stage name, the same way showStage and playOutResult
  // below already are - not on a sport id. The stage the sport asked for is
  // the only thing this knows about it.
  //
  // Ideally the sport would own this and hand back its own idle view, but
  // js/ui.js imports js/sports/index.js, so a sport reaching back into ui.js
  // for the renderer closes an import cycle. Left here until the football
  // renderer moves out of shared UI, which is its own piece of work.
  if (sport().presentation.stage === "field") {
    sport().presentation.renderField(document.getElementById("football-field"), "You", o.oppUsername);
  }

  // The final rosters are needed for the box score at the END of this
  // function, and fetching them is a round trip that has nothing to do with
  // the simulation - so it runs alongside it rather than after it. Started
  // before the simulate call, awaited after the result lands; on the ordinary
  // path it has been sitting finished for seconds by then.
  //
  // Better still when the strategy phase ran on this client: it already built
  // both full rosters from a visible-picks read (the draft is over, so nothing
  // is hidden any more and nothing about them can change), and re-fetching
  // them would be asking the server a question this client has already
  // answered. A reconnect straight into the reveal has no such state, which is
  // why the fetch is still here at all.
  const rostersReady =
    o.strategyPhaseStarted && Object.keys(o.myRoster || {}).length && Object.keys(o.oppRoster || {}).length
      ? Promise.resolve({
          rosterA: o.mySide === "A" ? o.myRoster : o.oppRoster,
          rosterB: o.mySide === "A" ? o.oppRoster : o.myRoster,
        })
      : getVisiblePicks(matchId)
          .then((picks) => fetchStatsForPicks(picks).then((statsByKey) => buildVisibleState(picks, Infinity, statsByKey)));
  // Nothing awaits this until well below, and an unhandled rejection in the
  // meantime would be reported as a page error rather than as the handled
  // failure it is. The catch below re-reads the settled value.
  rostersReady.catch(() => {});

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
    showBannerMessage("Couldn't load the result - check Profile > Recent Games in a moment.");
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
    ({ rosterA, rosterB } = await rostersReady);
  } catch (e) {
    console.error("Failed to load final rosters for the result screen:", e);
    showBannerMessage("Result saved, but the box score couldn't load - check Profile > Recent Games.");
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
  //
  // ...but "a pure function of the two rosters" is only true GIVEN A POOL.
  // Every rating in the analysis is a percentile against the dataset that
  // computed it, and this client recomputes against data/*.js while the server
  // simulated against its own table. Those are two copies of one dataset and
  // they are meant to be identical - see js/lib/dataset-version.js - but when
  // they are not, the analysis is ranked against a different distribution than
  // the score it is explaining. It would still read as confident commentary:
  // "your safeties were elite" beside a result that disagrees.
  //
  // So the fingerprint the server stamped on the result is checked first, and
  // the analysis is withheld rather than shown against the wrong pool. There is
  // no local fix available at this point - reconstructing the server's pool
  // would mean downloading the whole table - and a missing explanation is much
  // better than a plausible wrong one.
  let analysisA = null;
  const serverDataset = dbResult?.dataset_version || null;
  let localDataset = null;
  try {
    localDataset = sport().datasetVersion();
  } catch (e) {
    console.error("Could not compute this client's dataset version:", e);
  }
  // Older results predate the stamp, so a missing one is not drift - it is an
  // unanswerable question, and refusing to show an analysis over it would break
  // every historical game.
  const datasetDrift = !!serverDataset && !!localDataset && serverDataset !== localDataset;

  if (datasetDrift) {
    console.error(
      `Dataset mismatch: this game was simulated on ${serverDataset}, this client holds ${localDataset}. ` +
        `Withholding the draft analysis - it would be ranked against a different pool than the result.`
    );
    showBannerMessage("Result saved. The draft breakdown is hidden: this game was played on a different dataset version than your app has loaded.");
  } else {
    try {
      analysisA = sport().draftAnalysis(myRosterFinal, oppRosterFinal, datasetStatsFor(), o.forfeits || []);
    } catch (e) {
      console.error("Could not rebuild the draft analysis:", e);
    }
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
  avatar: document.getElementById("profile-avatar"),
  displayName: document.getElementById("profile-display-name"),
  kitPicker: document.getElementById("profile-kit-picker"),
  kitName: document.getElementById("profile-kit-name"),
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

  // The kit picker. Writes through and repaints from the same profile object the
  // rest of this screen was drawn from, so the swatch that lights up is the one
  // the database now holds rather than the one that was clicked.
  const equippedKitId = profile.equippedKit || DEFAULT_KIT_ID;
  if (profileRefs.kitName) profileRefs.kitName.textContent = kitById(equippedKitId).name;
  renderKitPicker(profileRefs.kitPicker, equippedKitId, async (kitId) => {
    if (kitId === equippedKitId) return;
    try {
      await setEquippedKit(kitId);
    } catch (e) {
      // Cosmetic, so a failure must not eat the screen - but it must not
      // silently pretend to have worked either, or the next reload undoes a
      // change the player watched happen.
      console.error("Couldn't save your kit:", e);
      if (profileRefs.kitName) profileRefs.kitName.textContent = "Couldn't save that - try again";
      return;
    }
    playSound("cardSelect");
    const fresh = await loadProfile();
    currentProfile = fresh;
    await renderProfileFor(fresh);
    // The kit is not a profile-screen setting. game.myKit and the app-wide
    // --my-kit-ink / --my-kit-trim are set by refreshHome(), and until this
    // ran your colour on the board, your end zone and the possession marker
    // all stayed on the old one until you happened to navigate Home.
    //
    // This screen used to get away with not calling it because the Customize
    // modal's own kit shelf did, through afterCustomize(). That shelf is gone,
    // so this is the only route a kit is chosen by, and it has to finish the
    // job.
    await refreshHome();
  });
  renderBadgeSportTabs(profileStatsTabsEl, profileStatsSportId, (id) => {
    profileStatsSportId = id;
    if (currentProfile) renderProfileFor(currentProfile).catch((e) => console.error(e));
  });
}

// Both routes into the wardrobe open the SAME modal. The profile button kept
// its id (the screen is wired by id, and renaming it to match its new label
// would be a gratuitous break) and gained the icon and badge shelves; the home
// button is the one that makes it reachable without leaving the screen the
// identity card is on.
btnCustomizeBanner.addEventListener("click", () => openCustomizeModal());
document.getElementById("btn-customize-profile").addEventListener("click", () => openCustomizeModal());

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

/** Which shelf the Customize modal is open on. Module-level like the Rewards
 * tabs beside it, so re-opening lands where you left off. */
let activeCustomizeTab = "banners";

/**
 * "Customize" - your wardrobe: banner, badges and icon in one place.
 *
 * WHAT THIS REPLACED. There used to be a "Customize Banner" button on the
 * Profile screen and nothing else: badges were featured from the Rewards
 * screen, banners were equipped from two different places, and the icon on
 * your card could not be changed at all. Three cosmetics, three unrelated
 * routes, none of them on the screen the card actually appears on.
 *
 * ONLY WHAT YOU HAVE UNLOCKED, on every tab. That is the difference between
 * this and Rewards, and it is the whole reason both exist: Rewards is the
 * ladder - everything there is to earn and how close you are - and this is the
 * wardrobe. Offering to "customize" with something you have not earned is the
 * Rewards tab with extra steps.
 *
 * Every grid here is the SAME renderer Rewards uses, passed onlyUnlocked. A
 * second set of tile renderers for the picker is how the two would end up
 * disagreeing about what a locked tile looks like.
 */
function openCustomizeModal(kind = activeCustomizeTab) {
  activeCustomizeTab = kind;

  const wrap = document.createElement("div");
  const kindTabs = document.createElement("div");
  kindTabs.className = "subtabs";
  const tabs = document.createElement("div");
  tabs.className = "subtabs";
  const summary = document.createElement("p");
  summary.className = "hint-text";
  const grid = document.createElement("div");
  wrap.append(kindTabs, tabs, summary, grid);

  renderUnlockableTabs(kindTabs, activeCustomizeTab, (next) => openCustomizeModal(next));

  // Badges have no General shelf and their own sport tabs; banners and icons
  // share the General/NBA/NFL set.
  if (kind === "badges") {
    grid.className = "badge-grid";
    renderBadgeSportTabs(tabs, activeBadgeSport, (sport) => {
      activeBadgeSport = sport;
      openCustomizeModal(kind);
    });
  } else if (kind === "icons") {
    grid.className = "icon-grid";
    renderBannerSportTabs(tabs, activeIconSport, (sport) => {
      activeIconSport = sport;
      openCustomizeModal(kind);
    });
  } else {
    grid.className = "banner-grid";
    renderBannerSportTabs(tabs, activeBannerSport, (sport) => {
      activeBannerSport = sport;
      openCustomizeModal(kind);
    });
  }

  openModal("Customize", wrap);

  // Friend count drives the friend ladders on both the banner and icon
  // shelves; it isn't on the profile row, so it's fetched alongside it rather
  // than inferred.
  loadProfileForBanners()
    .then((profile) => {
      if (kind === "badges") {
        renderBadgeCollection(grid, summary, profile, activeBadgeSport, onFeatureBadgeFromProfile, true);
      } else if (kind === "icons") {
        renderIcons(grid, summary, profile, onEquipIconFromProfile, activeIconSport, true);
      } else {
        renderBanners(grid, summary, profile, onEquipBannerFromProfile, activeBannerSport, true);
      }
    })
    .catch((e) => {
      console.error("Failed to load customization options:", e);
      summary.textContent = "Couldn't load your unlocks right now.";
    });
}

/** What every equip from this modal has to do afterwards.
 *
 * refreshHome() is the part that used to be missing. Equipping from here
 * repainted the profile screen and nothing else, so the identity card on the
 * home screen - the one the change is FOR - kept showing the old cosmetic
 * until some unrelated reload happened to fire. Changing what you are wearing
 * and watching it not change is indistinguishable from the save failing.
 */
async function afterCustomize() {
  openCustomizeModal();
  const profile = await loadProfile();
  currentProfile = profile;
  renderEquippedBanner(profileEquippedBannerEl, profile);
  renderPlayerIcon(profileRefs.avatar, profile);
  await refreshHome();
}

async function onEquipBannerFromProfile(franchiseId) {
  try {
    await setEquippedBanner(franchiseId);
  } catch (e) {
    console.error("Failed to equip banner:", e);
    return;
  }
  await afterCustomize();
}

async function onEquipIconFromProfile(iconId) {
  try {
    await setEquippedIcon(iconId);
  } catch (e) {
    console.error("Failed to equip icon:", e);
    return;
  }
  await afterCustomize();
}

async function onFeatureBadgeFromProfile(badgeId) {
  await toggleFeaturedBadge(badgeId);
  await afterCustomize();
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
const unlockablesIconsEl = document.getElementById("unlockables-icons");
const iconGridEl = document.getElementById("icon-grid");
const iconSummaryEl = document.getElementById("icon-summary");
const iconSportTabsEl = document.getElementById("icon-sport-tabs");

// Which sport's badges/banners/icons are on screen, and which shelf.
// Kept across visits so switching tabs and coming back doesn't reset any pick.
let activeBadgeSport = "nba";
let activeBannerSport = "nba";
// Icons open on the General shelf: the default icon and the ranked-win ladder
// live there, and a new player has no team icons at all, so landing on a wall
// of locked emblems would read as an empty feature.
let activeIconSport = "general";
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
  unlockablesIconsEl.classList.toggle("hidden", activeUnlockablesTab !== "icons");

  if (activeUnlockablesTab === "icons") {
    renderIconSportTabs();
    try {
      const profile = await loadProfileForBanners();
      renderIcons(iconGridEl, iconSummaryEl, profile, onEquipIcon, activeIconSport, false);
    } catch (e) {
      console.error("Failed to load icons:", e);
      iconSummaryEl.textContent = "Couldn't load your icons right now.";
    }
    return;
  }

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

/** Icons share the banner shelf's General/NBA/NFL tabs - one tab renderer,
 * because the two shelves are scoped the same way. */
function renderIconSportTabs() {
  renderBannerSportTabs(iconSportTabsEl, activeIconSport, (sport) => {
    activeIconSport = sport;
    openBadgesScreen();
  });
}

/** Toggles a badge on your banner. At the slot limit the oldest pick drops
 * out rather than erroring - silently swapping is friendlier than telling
 * someone to go unfeature something first.
 *
 * Split from its Rewards-screen handler so the Customize modal can perform the
 * same toggle without repainting the Rewards screen underneath it. */
async function toggleFeaturedBadge(badgeId) {
  try {
    const profile = await loadProfile();
    const current = profile.featuredBadges || [];
    const next = current.includes(badgeId)
      ? current.filter((id) => id !== badgeId)
      : [...current, badgeId].slice(-FEATURED_BADGE_SLOTS);
    await setFeaturedBadges(next);
  } catch (e) {
    console.error("Failed to update featured badges:", e);
  }
}

async function onToggleFeaturedBadge(badgeId) {
  await toggleFeaturedBadge(badgeId);
  await openBadgesScreen();
}

/** Equipping an icon is cosmetic, so it writes straight from the client -
 * same contract as the banner beside it. */
async function onEquipIcon(iconId) {
  try {
    await setEquippedIcon(iconId);
  } catch (e) {
    console.error("Failed to equip icon:", e);
    return;
  }
  await openBadgesScreen();
  await refreshHome();
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
  await refreshHome();
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
  // The heading above is the same fact as this field. Editing one without the
  // other leaves the profile disagreeing with itself until the next render.
  if (profileRefs.displayName) profileRefs.displayName.textContent = name;
});

// Squads reaches back into the game only to join a challenge, and needs to
// know which sport is selected. Handed over here rather than imported, since
// main.js already imports squads and the reverse would be a cycle.
initSquadsScreen({ joinMatch: enterOnlineMatch, getSport });

// ---- Bootstrap ----
// Before the session check, because it depends on nothing and the images it
// governs are on screen already: the sign-in screen is what a failed session
// check falls through to, and it is the screen carrying the lockup.
initBrandFallbacks();

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
