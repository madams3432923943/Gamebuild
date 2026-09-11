// App controller: wires draft state + engine + profile to the DOM.
// Three modes share these same screens/DOM elements:
//   - "bot": synchronous, client-only (DraftState from draft.js).
//   - "online": async, server-authoritative (Supabase - see online.js).

import { playSound, primeSound, soundEnabled, setSoundEnabled } from "./sound.js";
import { wornColours, rgbString, kitById, KITS, DEFAULT_KIT_ID, botKitFor } from "./kits.js";
import { confetti, playBuzzer, playFanfare, playDefeat, playWhoosh, playPop, replayAnimation } from "./celebrate.js";
import { snapshotProgress, progressGains } from "./progress.js";
import { game, strategy } from "./state.js";
import { showScreen, setActiveNav, openModal, closeModal, sleep } from "./shell.js";
import { initBrandFallbacks } from "./brand-fallback.js";
import { withSeededMathRandom } from "./lib/seeded-rng.js";
import { newSimulationSeed, provenanceFor } from "./lib/provenance.js";
import { initSquadsScreen, openSquadsScreen, cleanupSquadChatWatcher } from "./screens/squads.js";
import { startPresence } from "./presence.js";
// The wardrobe's action bar names and previews the selected banner, which
// means main.js needs the catalogue and the artwork renderer it used to be
// able to leave entirely to js/ui/profile.js.
import { bannerById, DEFAULT_BANNER_ID } from "./banners.js";
import { bannerArt } from "./ui/banner-art.js";
import { DraftState, eligibleOpenSlots, resolvePickSlot, worstEligiblePick } from "./draft.js";
import { adviceNote, isNote, noteText } from "./gradenotes.js";
import { OPENING_HOLD_MS, FINAL_HOLD_MS, DRAFT_REVEAL_DELAY_MS, PICK_TIMER_SECONDS, TACTIC_TIMER_SECONDS, ROTATION_TIMER_SECONDS, ONLINE_ROTATION_TIMER_SECONDS, MATCHUP_TIMER_SECONDS, ONLINE_QUEUE_TIMEOUT_SECONDS, RESULT_WAIT_MS, SIMULATION_WAIT_MS, ONLINE_QUEUE_POLL_MS, MIN_SEARCH_CHARS } from "./constants.js";
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
import { maybeShowOnboarding } from "./onboarding.js";
import { renderSponsor, releaseSponsor } from "./ads/placements.js";
import { slotLabel, rosterSlots } from "./ui/roster-slots.js";
import { displayEntryName } from "./ui/entry-name.js";
import { PLACEMENTS } from "./ads/campaigns.js";
import { track, trackOnce, markActiveToday, EVENTS } from "./analytics.js";
import {
  MODES, FRIEND_MODE, DIFFICULTY_IDS, DEFAULT_DIFFICULTY, difficultyById,
  resolveMode, modeLabel,
} from "./modes.js";
import { GENERAL_TIERS } from "./ranks.js";
import { START_RATING, ratingFor } from "./rating.js";
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
  authLinkError,
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
  createProfileHero,
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
  renderScoringSummary,
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
    const { sent } = await requestPasswordReset(identifier);
    // NOT SENT means the identifier was a username, which has no inbox behind
    // it - see requestPasswordReset. The old version mailed it anyway and then
    // said "reset link sent", which is the sentence that made someone watch an
    // empty inbox. Recovery is by email address, for every account.
    if (!sent) {
      setAuthStatus(
        "A reset can only be sent to an email address, not a username. Enter the email you signed up with. " +
          "If your account predates email sign-up, sign in with your password and add one on the Profile tab.",
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
async function enterApp({ newAccount = false } = {}) {
  navTabs.hidden = false;
  setActiveNav("play");
  showScreen("home");
  await reconcileUsername();
  const profile = await refreshHome();

  // DAU/WAU/MAU, and nothing else. One idempotent upsert of (user, today) per
  // app entry - see markActiveToday. Not awaited: a retention metric has no
  // business delaying the home screen.
  void markActiveToday();
  // A BRAND-NEW ACCOUNT REACHING THE APP, which is not the same moment as the
  // sign-up form succeeding: with email confirmation on, signUp() returns no
  // session and the account does not enter anything until the link is clicked
  // and they sign in, possibly days later. So this fires on either path - the
  // flag from the sign-up handler, or a profile that has never been onboarded,
  // which is only ever true on an account's first entry.
  if (newAccount || !profile?.hasSeenOnboarding) trackOnce(EVENTS.SIGNUP_COMPLETED);

  // THE WELCOME, for an account that has never seen it. Last, so it opens over
  // a home screen that is already drawn rather than over an empty one, and so
  // a failure anywhere above cannot take the first-run experience down with it.
  if (profile) maybeShowOnboarding(profile);
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
const sponsorRailLeftEl = document.getElementById("sponsor-rail-left");
const sponsorRailRightEl = document.getElementById("sponsor-rail-right");
const sponsorPostgameEl = document.getElementById("sponsor-postgame");

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
    // The card body is one button containing a header, a figures row and the
    // call to action. NOT three separate controls: a click anywhere on a sport
    // card should start that sport, and the two reference buttons are outside
    // it precisely because they must not (nesting a button in a button is
    // invalid, and "How to Play" walking you into the Play screen is the bug
    // that shape would create).
    open.innerHTML =
      `<span class="sport-card-head">` +
      `<span class="sport-card-icon" aria-hidden="true"></span>` +
      `<span class="sport-card-text">` +
      `<span class="sport-card-name"></span>` +
      `<span class="sport-card-rank"></span>` +
      `</span></span>` +
      `<span class="sport-card-figures"></span>` +
      `<span class="sport-card-cta"><span class="sport-card-cta-glyph" aria-hidden="true">${selectable ? "▶" : "🔒"}</span><span class="sport-card-cta-label"></span></span>`;
    open.querySelector(".sport-card-icon").textContent = s.icon;
    open.querySelector(".sport-card-name").textContent = s.name;

    // The tier NAME leads the header - it is the word a player identifies
    // with - and the numbers behind it go in the figures row below, where they
    // line up with the other sport's.
    let rankText;
    if (!s.live) rankText = s.status || "Coming soon";
    else if (!info || info.provisional) {
      const need = info ? info.gamesNeeded : RANK_GAMES_FLOOR;
      rankText = `Unranked — ${need} more online ${need === 1 ? "game" : "games"}`;
    } else rankText = info.tier.name;
    open.querySelector(".sport-card-rank").textContent = rankText;

    // Rating, ranked record and games, read off the per-sport ELO the server
    // writes (protect_sport_ratings). A sport that has never been played has
    // none of these, and gets no figures row rather than a row of zeroes:
    // "0-0" and "500" presented as standings are a record and a rating nobody
    // earned.
    const standing = profile.sportRatings?.[s.id];
    const figures = open.querySelector(".sport-card-figures");
    if (s.live && standing && (standing.games || 0) > 0) {
      const cells = [
        { label: "Rating", value: String(standing.rating ?? "—") },
        { label: "Ranked", value: `${standing.wins || 0}-${standing.losses || 0}` },
        { label: "Games", value: String(standing.games || 0) },
      ];
      for (const cell of cells) {
        const el = document.createElement("span");
        el.className = "sport-card-figure";
        el.innerHTML = `<span class="sport-card-figure-value"></span><span class="sport-card-figure-label"></span>`;
        el.querySelector(".sport-card-figure-value").textContent = cell.value;
        el.querySelector(".sport-card-figure-label").textContent = cell.label;
        figures.appendChild(el);
      }
    } else {
      figures.remove();
    }

    open.querySelector(".sport-card-cta-label").textContent = selectable
      ? `Play ${s.name}`
      : s.status || "Coming soon";

    if (selectable) {
      open.addEventListener("click", () => {
        // The funnel step, recorded where the CHOICE is made. setSport() is
        // also called on boot to restore the stored sport, which is not a
        // player choosing anything - counting it there would make every page
        // load look like a sport selection.
        track(EVENTS.SPORT_SELECTED, { sport: s.id });
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
 * table without knowing a thing about it. Easy practice shows them, because it
 * exists to teach the pool and hiding numbers there teaches nothing. Same split
 * the player board itself already makes (`showStats`). */
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
  let loaded = null;
  try {
    const profile = await loadProfile();
    loaded = profile;
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

  // THE SPONSOR RAILS. Drawn here because this is the function that draws the
  // home screen, and they belong to it. Whether they are VISIBLE is a CSS
  // question and not this function's business - the rails are fixed elements
  // outside #app-root and only appear on a window wide and tall enough, and
  // only while the home screen is up (see the .sponsor-rail rules). This just
  // fills them, and fills them with nothing when no campaign is running, which
  // leaves them hidden.
  //
  // Re-rendering on every return to home is fine and is the point of counting
  // impressions by visibility rather than by render: renderSponsor replaces the
  // old observer, and the impression is keyed per campaign per placement per
  // session, so coming back to this screen ten times is one impression.
  renderSponsor(sponsorRailLeftEl, PLACEMENTS.HOME_RAIL_LEFT);
  renderSponsor(sponsorRailRightEl, PLACEMENTS.HOME_RAIL_RIGHT);

  // RETURNED so a caller that has just triggered this read does not trigger a
  // second one. enterApp needs the profile for the first-run check, and the
  // alternative was loadProfile() twice on the first screen of every visit.
  return loaded;
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
      await enterApp({ newAccount: true });
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

const modeToggleEl = document.getElementById("mode-toggle");
const btnStartDraft = document.getElementById("btn-start-draft");
const btnCancelSearch = document.getElementById("btn-cancel-search");
const searchStatusEl = document.getElementById("search-status");

// WHAT THE PLAY SCREEN OFFERS. Two modes, and a difficulty when the mode has
// one. The definitions live in js/modes.js so that the pick clock, the draft
// board, the strategy phases, the celebration and the history label all read
// the same record rather than each re-deriving the mode from a string.
//
// This replaced a three-card list - Quick Play, Ranked Practice, Ranked - whose
// first two entries were the same game at two settings, and whose first entry
// also silently dealt a different roster shape. Practice is now one mode with a
// difficulty, every mode drafts the ranked roster, and there is one competitive
// mode rather than two things called ranked.

const difficultyToggleEl = document.getElementById("difficulty-toggle");
const difficultyFieldEl = document.getElementById("difficulty-field");
const difficultyNoteEl = document.getElementById("difficulty-note");
const launchSummaryEl = document.getElementById("launch-summary");

const DIFFICULTY_KEY = "bk_practice_difficulty";

let selectedMode = "practice";
let selectedDifficulty = readStoredDifficulty();

/** Difficulty persists like the era does: someone practising at Hard should
 * not be dropped back to Medium every time they open the app. */
function readStoredDifficulty() {
  try {
    const stored = localStorage.getItem(DIFFICULTY_KEY);
    return DIFFICULTY_IDS.includes(stored) ? stored : DEFAULT_DIFFICULTY;
  } catch {
    return DEFAULT_DIFFICULTY;
  }
}

/** One radio button in a radiogroup, in the shape both pickers share.
 *
 * The two pickers are the same control with different contents, and writing
 * the markup twice is how the mode card and the difficulty card drift apart -
 * which is exactly what happened to the old mode list and its blurbs. */
function renderChoiceCards(container, entries, selectedId, onSelect) {
  container.innerHTML = "";
  for (const entry of entries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mode-btn" + (entry.id === selectedId ? " active" : "");
    btn.dataset.mode = entry.id;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(entry.id === selectedId));
    btn.innerHTML =
      // Only when there is one. An empty icon span still costs the card's flex
      // gap, so the difficulty cards - which carry no icon - would sit indented
      // from an icon that is not there.
      (entry.icon ? `<span class="mode-icon" aria-hidden="true"></span>` : "") +
      `<span class="mode-text">` +
      `<span class="mode-title"><span class="mode-label"></span></span>` +
      `<span class="mode-blurb"></span>` +
      `</span>` +
      // aria-hidden: aria-checked on the button already says whether this is
      // selected, and a screen reader announcing a tick as well says it twice.
      `<span class="mode-check" aria-hidden="true">\u2713</span>`;
    if (entry.icon) btn.querySelector(".mode-icon").textContent = entry.icon;
    btn.querySelector(".mode-label").textContent = entry.label;
    btn.querySelector(".mode-blurb").textContent = entry.blurb;
    if (entry.tag) {
      const tag = document.createElement("span");
      tag.className = "mode-tag";
      tag.textContent = entry.tag;
      btn.querySelector(".mode-title").appendChild(tag);
    }
    btn.addEventListener("click", () => onSelect(entry.id));
    container.appendChild(btn);
  }
}

function renderModeCards() {
  renderChoiceCards(modeToggleEl, Object.values(MODES), selectedMode, (id) => {
    // On the click, not on the render: renderModeCards() runs again on every
    // selection and on every return to the Play screen, and an event fired
    // from a render is an event fired by the app rather than by the player.
    track(EVENTS.MODE_SELECTED, { mode: id, sport: getSport() });
    selectedMode = id;
    renderModeCards();
    renderDifficultyCards();
    renderModeChoice();
  });
}

/** The difficulty picker, shown only when Practice is selected. Hidden rather
 * than disabled: a difficulty is not a choice that exists in a ranked game, and
 * a greyed-out row of it reads as something the player has failed to unlock. */
function renderDifficultyCards() {
  const isPractice = selectedMode === "practice";
  difficultyFieldEl.hidden = !isPractice;
  if (!isPractice) return;
  renderChoiceCards(
    difficultyToggleEl,
    DIFFICULTY_IDS.map((id) => difficultyById(id)),
    selectedDifficulty,
    (id) => {
      track(EVENTS.PRACTICE_DIFFICULTY_SELECTED, { difficulty: id, sport: getSport() });
      selectedDifficulty = id;
      try {
        localStorage.setItem(DIFFICULTY_KEY, id);
      } catch {
        // Storage refused (private mode) - the choice still applies this session.
      }
      renderDifficultyCards();
      renderModeChoice();
    }
  );
  // The one line that says what this difficulty actually changes. Easy is the
  // only one that changes the interface as well as the bot, and a player
  // choosing it should know that before the board appears, not after.
  difficultyNoteEl.textContent = difficultyById(selectedDifficulty).tagline;
}

function getMode() {
  return selectedMode;
}

/** The resolved match configuration for whatever is selected right now. */
function currentModeConfig() {
  return resolveMode(selectedMode, selectedDifficulty);
}

function renderModeChoice() {
  renderLaunchSummary();
  renderPlayability();
}

/** What Start Draft is about to launch, in one line directly above it:
 * mode, era bracket, sport.
 *
 * All three are chosen in different places on this screen - two of them in
 * pill rows where the selected one is distinguished only by a border - and
 * nothing restated the combination before committing to it. */
function renderLaunchSummary() {
  if (!launchSummaryEl) return;
  const era = sport().eraById(getEra());
  launchSummaryEl.textContent =
    [modeLabel(currentModeConfig()), era?.label, sport().name].filter(Boolean).join(" • ");
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
    // The dataset and the game-screen modules travel together: both are this
    // sport's, both are only needed once you are playing it, and both must be
    // in memory before any screen reads them synchronously. Loading the
    // presentation here rather than at the whistle means the court is never
    // the thing a player waits for.
    await Promise.all([ensureSportData(id), sport().presentation.load?.()]);
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
  // The launch summary names the era, so it has to be repainted when the era
  // changes - not only when the mode does.
  renderLaunchSummary();
}

// The active sport is restored from storage, so a player who left in NFL
// comes back to it - and has to come back to its colors too, not the
// stylesheet's default sport.
applyTheme(sport());
renderPlayHead();
renderModeCards();
renderDifficultyCards();
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
  // The search, not each poll of it. joinQueue is called every
  // ONLINE_QUEUE_POLL_MS for up to two minutes - roughly sixty calls for one
  // search - so recording the RPC would measure the poll interval rather than
  // player intent. This is the only line that runs once per search.
  track(EVENTS.RANKED_QUEUE_JOINED, { sport: getSport(), era: getEra() });
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
        track(EVENTS.RANKED_MATCH_FOUND, { sport: getSport(), era: getEra() });
        await enterOnlineMatch(res.match_id);
        return;
      }
      // Checked after the poll, not before it: the last poll of the window
      // is a real chance to match, and giving up without taking it would
      // waste the final two seconds of the wait.
      if (Date.now() >= deadline) {
        await endOnlineSearch(
          "No one else is looking for a game right now. Try Practice against the bot, or check back in a bit."
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

  // The whole match configuration, not one flag off it: the clock, the board,
  // the bot's difficulty and whether this counts all travel together from here.
  game.modeConfig = config;

  if (config.online) {
    // A sport whose SERVER cannot run an online match must say so here rather
    // than queue and fail. Football's matchmaking insert violates a CHECK
    // constraint, and the failure path used to navigate home while writing the
    // reason onto the screen it was leaving - so it read as the app silently
    // giving up.
    if (!sport().onlineReady) {
      searchStatusEl.classList.remove("hidden");
      searchStatusEl.textContent =
        `Online ${sport().name} isn't open yet - the server has no ${sport().name} draft pool. ` +
        `Practice against the bot plays the same game.`;
      return;
    }
    startOnlineSearch();
    return;
  }

  game.mode = "bot";
  game.nameB = "Bot";
  startDraft();
});

/** Every tab leaves whatever was running behind (a live match poller, a pick
 * clock, a game being played out) before switching, so no screen keeps ticking
 * off-screen. */
function goToTab(tab, onArrive) {
  cleanupOnlineWatcher();
  // A game left mid-quarter must stop playing, and must still be RECORDED -
  // the timers being cancelled are the same ones that reach finish().
  cleanupPlayback({ settle: true });
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
/** @param opts.timed false runs the phase with no clock at all - Easy practice's
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

// Rotation phase: minutes-per-player, run by every mode that has a rotation to
// set. Easy practice runs it with no clock rather than skipping it - see the
// `timed` option below. A strategy.rotationMinutes of null means "use the
// engine's default fixed split", which is what a sport with no rotation (NFL)
// and a draft that never reached this phase both leave behind.
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

/** Between draft-complete and the gamestyle pick: assign
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

function startRotationPhase(roster, slots, onConfirm, timerSeconds = ROTATION_TIMER_SECONDS, { timed = true } = {}) {
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
  // UNTIMED MEANS NO INTERVAL, not a hidden one. Easy practice must have no
  // path that confirms a phase the player did not confirm, and the only way to
  // guarantee that is for the countdown never to be created.
  pickTimerEl.hidden = !timed;
  if (!timed) {
    btnConfirmRotation.onclick = confirm;
    return;
  }

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

// Who guards whom. Null for a sport with no matchups, in which case the engine
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
function startMatchupPhase(myRoster, oppRoster, oppLabel, onConfirm, { timed = true } = {}) {
  cleanupPickTimer();
  cleanupMatchupTimer();

  const myStarters = sport().slots.starters.filter((slot) => myRoster[slot]);
  const oppStarters = sport().slots.starters.filter((slot) => oppRoster[slot]);
  strategy.matchups = sport().defaultMatchups(myRoster, oppRoster);

  renderMatchupPicker(matchupGridEl, myRoster, oppRoster, myStarters, oppStarters, strategy.matchups, oppLabel);

  draftPoolPanel.classList.add("hidden");
  matchupPhaseEl.classList.remove("hidden");
  pickTimerEl.hidden = !timed;
  if (!timed) {
    btnConfirmMatchups.onclick = confirm;
    return;
  }

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

/** The draft board reads differently in an open-board game, so the search box
 * and its hint have to say which game is actually being played.
 *
 * Reads the MATCH CONFIG rather than a ruleset string: an open board and a
 * missing clock are two separate facts about Easy practice, and every other
 * mode answers both the same way. */
function applyModeToDraftUI() {
  const config = matchConfig();
  const easy = config.openBoard;
  // The sport says what its own board accepts. Basketball's slots are all
  // individuals, so it declares nothing and keeps the original wording;
  // football's board takes a position for its six unit slots and says so,
  // because "type a player's name" is a dead end at half its roster.
  const fromMemory = sport().labels?.searchHint || "Type a player's name from memory…";
  poolSearch.placeholder = easy ? "Filter this squad…" : fromMemory;
  knowledgeHintEl.textContent = easy
    ? "Easy practice — full squad and stats shown, no clock."
    : `No player list — draft from memory. ${MIN_SEARCH_CHARS}+ letters to search.`;
  // Not merely hidden: easy practice runs NO clock at all (see startDraft and
  // advanceDraft), so there is nothing to show and nothing that can time out.
  pickTimerEl.hidden = !config.timed;
}

/** What is being played right now.
 *
 * Every screen between the draft board and the final whistle asks this. It
 * falls back to the resolved Practice default rather than throwing, because an
 * online match entered from a deep link (a friend's challenge) reaches the
 * draft board without the Play screen ever having run - enterOnlineMatch sets
 * the real config a moment later, and a board that threw in between would be a
 * blank screen instead of a slightly generic hint. */
function matchConfig() {
  return game.modeConfig || resolveMode("practice", DEFAULT_DIFFICULTY);
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

// ONE ROSTER SHAPE, IN EVERY MODE. Quick Play used to deal five slots and no
// bench while the other two modes dealt ten, so the mode you picked silently
// changed what a roster WAS - a different draft, a different engine path, and
// its own entry in the balance constants. Practice exists to rehearse Online
// Ranked, and a rehearsal at a different roster size rehearses nothing.
//
// The compact shape is still declared by each sport and still handled by the
// engines (games played under it are in saved history, and the calibration
// harnesses drive it), but no mode selects it any more.

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
  applyModeToDraftUI();
  game.era = getEra();
  game.sport = getSport();
  game.draft = new DraftState(
    sport().playersInEra(sport().players(), game.era),
    recentSquadIds,
    sport().slots.ranked
  );
  game.round = { needNewSquad: true, resolved: {}, activeSide: "A", pendingPlayer: null, pendingSlots: {} };
  game.forfeits = { A: [], B: [] };
  game.roundNumber = 0;
  poolSearch.value = "";
  hideDraftGrade();
  captureProgressBaseline();
  // A DRAFT HAS BEGUN. One of the two places this can be true - the other is
  // enterOnlineMatch, which is how a ranked or friend draft starts - and the
  // mode is carried on the event so the funnel splits without a second one.
  const started = matchConfig();
  track(EVENTS.DRAFT_STARTED, {
    sport: getSport(),
    mode: started.id,
    difficulty: started.difficulty || undefined,
    era: game.era,
  });
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
      // The difficulty is a DRAFTING rule and reaches the bot here and nowhere
      // else - nothing downstream of this line knows which difficulty was
      // chosen, which is what makes "difficulty cannot change the simulation"
      // structural rather than a promise.
      const choice = draft.botAutoPick(side, { difficulty: matchConfig().difficulty });
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
      // Easy practice runs no clock and therefore cannot time out - there is no
      // hidden forfeit path behind this, only the absence of one.
      if (matchConfig().timed) startPickTimer(handleLocalTimeout);
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
    matchConfig().openBoard,
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
const draftGradeTeamsEl = document.getElementById("draft-grade-teams");
const draftGradeScoutingEl = document.getElementById("draft-grade-scouting");

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
  // A grid is a row of chips rather than a label/value pair: one chip per slot,
  // wrapping by column count so it reflows on a phone instead of truncating.
  if (note.kind === "grid") {
    li.className = "grade-note grade-grid";
    const heading = document.createElement("span");
    heading.className = "grade-grid-label";
    const headingName = document.createElement("span");
    headingName.textContent = note.label;
    heading.appendChild(headingName);
    // The side's own score sits in the heading rather than on a row of its
    // own - see gridNote. Same tone rule as a stat row: the number takes the
    // verdict colour, the word does not.
    if (note.value) {
      const headingValue = document.createElement("span");
      headingValue.className = `grade-grid-value grade-${note.tone || "neutral"}`;
      headingValue.textContent = note.value;
      heading.appendChild(headingValue);
    }
    const chips = document.createElement("span");
    chips.className = "grade-grid-chips";
    for (const entry of note.entries) {
      const chip = document.createElement("span");
      chip.className = `grade-chip grade-${entry.tone || "neutral"}`;
      const key = document.createElement("span");
      key.className = "grade-chip-key";
      key.textContent = entry.key;
      const value = document.createElement("span");
      value.className = "grade-chip-value";
      value.textContent = entry.value;
      chip.append(key, value);
      chips.appendChild(chip);
    }
    li.append(heading, chips);
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

/**
 * THE TWO TEAMS' HEADLINE GRADES, and the asymmetry between them.
 *
 * Your card and theirs carry the same three numbers - overall, offense,
 * defense - because that is what a team knows about its next opponent before
 * kickoff. Everything BELOW this block (the per-slot grid, the scouting line)
 * is yours alone: the sport builds no opponent detail at all, so there is
 * nothing here to filter. See the opponent block in
 * js/sports/nfl/draftgrade.js for why revealing their per-slot ratings decided
 * a ranked gameplan before it was chosen.
 *
 * SPORT-AGNOSTIC BY OMISSION. A sport that does not return `opponent` simply
 * does not get this block, and basketball's card renders exactly as it did.
 * Nothing here knows what a slot or a unit is.
 */
function renderGradeTeams(grade) {
  draftGradeTeamsEl.innerHTML = "";
  const sides = [
    { label: "Your team", grade },
    ...(grade.opponent ? [{ label: "Opponent", grade: grade.opponent }] : []),
  ];
  // One side is not a comparison, so the block earns its space only when there
  // is somebody to compare against.
  if (!grade.opponent) {
    draftGradeTeamsEl.classList.add("hidden");
  } else {
    for (const side of sides) {
      const card = document.createElement("div");
      card.className = "grade-team";
      const name = document.createElement("div");
      name.className = "grade-team-name";
      name.textContent = side.label;
      const row = document.createElement("div");
      row.className = "grade-team-row";
      const cells = [
        { key: "Overall", value: side.grade.letter },
        { key: "Offense", value: side.grade.offenseGrade },
        { key: "Defense", value: side.grade.defenseGrade },
      ];
      for (const cell of cells) {
        if (cell.value == null) continue;
        const box = document.createElement("div");
        box.className = "grade-team-cell";
        const k = document.createElement("span");
        k.className = "grade-team-key";
        k.textContent = cell.key;
        const v = document.createElement("span");
        v.className = "grade-team-value";
        v.textContent = cell.value;
        box.append(k, v);
        row.appendChild(box);
      }
      card.append(name, row);
      draftGradeTeamsEl.appendChild(card);
    }
    draftGradeTeamsEl.classList.remove("hidden");
  }

  // One line, and only when the sport generated one from real unit grades.
  if (grade.scouting) {
    draftGradeScoutingEl.textContent = grade.scouting;
    draftGradeScoutingEl.classList.remove("hidden");
  } else {
    draftGradeScoutingEl.textContent = "";
    draftGradeScoutingEl.classList.add("hidden");
  }
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
  renderGradeTeams(grade);

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
  track(EVENTS.DRAFT_COMPLETED, {
    sport: getSport(),
    mode: matchConfig().id,
    difficulty: matchConfig().difficulty || undefined,
  });
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

  // EVERY practice game now runs the full strategy sequence - rotation,
  // matchups, gamestyle - because every practice game now drafts the ranked
  // roster. Quick Play used to skip all of it, which meant two thirds of the
  // game was hidden behind a mode most new players never selected.
  //
  // Easy runs the same phases with no clock on any of them. That is the only
  // difference: the phases, the choices and what the engine does with them are
  // identical at all three difficulties.
  const timed = matchConfig().timed;

  draftTurnBanner.textContent = "Set your rotation";
  rotationPhaseHintEl.textContent =
    `${sport().rotationBudget} ${sport().labels.unit} to spend. Starters play more than the bench. ` +
    `Lower someone to free ${sport().labels.unit} before raising someone else.`;
  const toTactic = () => {
    draftTurnBanner.textContent = "Final round — set your game plan";
    tacticPhaseHintEl.textContent = timed
      ? `${sport().tacticTimerSeconds || TACTIC_TIMER_SECONDS} seconds to choose how this team plays.`
      : "Choose how this team plays - no clock, take your time.";
    startTacticPhase(runLocalSimulation, { timed });
  };
  const afterRotationOffline = () => {
    if (!hasMatchups()) return toTactic();
    draftTurnBanner.textContent = "Set your defensive matchups";
    matchupPhaseHintEl.textContent =
      `Your starters are on their opposite numbers by default. Move anyone you want - ` +
      `switching two players trades their assignments.`;
    startMatchupPhase(draft.rosterA, draft.rosterB, game.nameB, toTactic, { timed });
  };
  // Straight past both phases for a sport that has neither. NFL has no minutes
  // to allocate and no matchups to assign, and the rotation screen keeps its
  // Confirm disabled until the budget is spent - a budget of zero could never
  // be spent, so the draft ended on a dead screen and nothing ever simulated.
  if (hasRotation()) startRotationPhase(draft.rosterA, draft.slots, afterRotationOffline, ROTATION_TIMER_SECONDS, { timed });
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

/** Whether this player asked the operating system for less motion.
 *
 * Read at call time rather than cached: the setting can change while the tab
 * is open, and a value read once at boot would keep animating for the rest of
 * the session for someone who just turned it on.
 *
 * The CSS already stops every animation on this screen under the same query
 * (see the reduced-motion block in style.css). What CSS cannot do is shorten
 * the WAITS: the sequence below sleeps through the fly-in and the impact
 * whether or not they are drawn, so someone who asked for no motion sat
 * looking at a static screen for the full length of an animation they were
 * never shown. This is what lets those beats be skipped instead. */
function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

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
    el.classList.remove("fly-in", "settle", "impact");
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

  const reduced = prefersReducedMotion();
  // Waits that exist only to let an animation play. Under reduced motion there
  // is no animation to let play, so they collapse - the beats that carry
  // INFORMATION (time to read who you are up against, and a second per
  // countdown number) are deliberately not in here and are not shortened.
  const motionBeat = (ms) => sleep(reduced ? 0 : ms);

  await motionBeat(120);
  matchupIntroEl.classList.add("intro-lit");

  // Staggered, not simultaneous: your banner arrives, then theirs, which is
  // what makes it read as being introduced to an opponent. Each card takes a
  // short punch as it lands (the fly-in transition is 0.9s), scheduled rather
  // than awaited so the second card is already on its way in while the first
  // one lands.
  const land = (el) => {
    if (reduced) return;
    setTimeout(() => replayAnimation(el, "impact"), 860);
  };
  playWhoosh();
  matchupSideAEl.classList.add("fly-in");
  land(matchupSideAEl);
  await motionBeat(520);
  playWhoosh();
  matchupSideBEl.classList.add("fly-in");
  land(matchupSideBEl);

  // A beat after the second banner lands, the radial flash and shockwave sell
  // the impact of the two sides meeting.
  await motionBeat(950);
  matchupSideAEl.classList.add("settle");
  matchupSideBEl.classList.add("settle");
  matchupVsEl.classList.add("vs-land");
  replayAnimation(matchupIntroEl, "impact-flash");
  playPop(2);

  // Time to actually read who you're playing and what rank they are - the
  // whole reason this screen exists, and previously the part it gave the
  // least room to. NOT a motion beat: this one is reading time.
  await sleep(1800);

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
  await motionBeat(850);
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
  // A friendly is entered by challenge, never by the Play screen, so this is
  // the only place that can know it is one. Same rules as ranked - clock,
  // hidden board, ranked roster, authoritative server - with `ranked: false`,
  // which is the single fact that keeps it off the ladder.
  game.modeConfig = match.is_friendly ? { ...FRIEND_MODE, difficulty: null } : resolveMode("ranked");

  // The online half of draft_started. Keyed on the match id rather than fired
  // outright: enterOnlineMatch is also how a player RECONNECTS to a match
  // already in progress, and a dropped connection is not a second draft.
  trackOnce(
    EVENTS.DRAFT_STARTED,
    { sport: match.sport || getSport(), mode: game.modeConfig.id, era: match.era },
    `draft_started:${matchId}`
  );

  // THE MATCH DECIDES THE SPORT, not whatever this client last had selected.
  //
  // Matchmaking scopes on sport, so a queued game was always the sport you
  // queued in. A CHALLENGE is not: the Friends dialog asks which sport, and
  // whoever accepts may have NBA open while the invitation is for NFL - which
  // rendered sport().slots.ranked and sport().players() for the wrong sport
  // entirely. Awaited, because a dataset loads on selection and every screen
  // below reads the pool synchronously.
  if (match.sport && match.sport !== getSport()) {
    setActiveSport(match.sport);
    applyTheme(sport());
    await ensureSportData(match.sport);
  }
  // Whatever sport this match is, its stage has to be loaded before the game
  // screen draws one. Outside the branch above because a match in the sport
  // already selected still needs it - setSport() is the only other loader, and
  // a deep link into a challenge never goes through it.
  await sport().presentation.load?.();
  // The bracket is the match's too, for the same reason - the draft board reads
  // it off game.era, and an era id is only unique within one sport.
  game.era = match.era || sport().defaultEra;
  game.sport = match.sport || getSport();

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

  applyModeToDraftUI();
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

  if (matchConfig().timed) startPickTimer(handleOnlineTimeout);
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
    matchConfig().openBoard,
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
 * rotation -> matchups -> tactic sequence offline Practice uses, then
 * submit once instead of simulating locally - the server simulates once
 * BOTH sides have submitted (see submit_strategy). Each side runs this
 * independently at its own pace; nothing here waits on the opponent
 * mid-phase, only after the final submit. */
async function beginOnlineStrategyPhase(match) {
  const o = game.online;
  if (!o) return;

  // Once per match. This runs from the match watcher, which fires on every
  // row change and can re-enter the strategy phase on a reconnect - the
  // reason trackOnce takes a key.
  trackOnce(
    EVENTS.DRAFT_COMPLETED,
    { sport: getSport(), mode: matchConfig().id },
    `draft_completed:${o.matchId}`
  );

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
const playbackControlsEl = document.getElementById("playback-controls");
const btnSkipPlayback = document.getElementById("btn-skip-playback");
const recapHeadlineEl = document.getElementById("recap-headline");
const recapDetailEl = document.getElementById("recap-detail");
const fullBoxScore = document.getElementById("full-box-score");
const btnShareResult = document.getElementById("btn-share-result");
// Read off the markup rather than repeated here, so the label has one home.
const SHARE_BUTTON_LABEL = btnShareResult.textContent;
const btnToProfile = document.getElementById("btn-to-profile");
const btnPlayAgain = document.getElementById("btn-play-again");
const btnGameHome = document.getElementById("btn-game-home");

const REGULATION_PERIODS = 4;

/** "Q3", or "OT1" past regulation, from a ZERO-BASED period index.
 *
 * One function because there were two copies of this arithmetic in this file
 * and they disagreed: the scoreboard's had no +1, so the first overtime column
 * read "OT0" while the recap - written from the other copy - called the same
 * period OT1. Basketball's derived clock now writes a third reading onto the
 * same board, which is what made the disagreement worth ending rather than
 * patching in place. */
function periodLabel(index) {
  return index >= REGULATION_PERIODS ? `OT${index - REGULATION_PERIODS + 1}` : `Q${index + 1}`;
}

/** Plays a finished result out, event by event, and calls onComplete() once
 * everything is on screen. Works from a local simulateGame() output or a
 * normalized server result - they are the same shape by design.
 *
 * GONE FROM HERE: computeDisplayPeriodScores, which summed each period's box
 * lines so the reveal loop could publish a whole quarter at once. The quarter
 * columns are folded from the events as they are watched now (see
 * playEventDriven), which is the only way a column can be true at the moment it
 * appears. */
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
// The per-sport ELO before this game, for the share card's rating line. Read
// here rather than after the fact because "what did this game change" needs
// both ends and only one of them still exists once the game is over.
let ratingBefore = null;

/** Snapshots the profile before a game. Failures are swallowed on purpose -
 * a missing baseline costs a celebration, and nothing else. */
async function captureProgressBaseline() {
  progressBefore = null;
  rankBefore = null;
  ratingBefore = null;
  try {
    const profile = await loadProfile();
    progressBefore = snapshotProgress(profile, getSport());
    ratingBefore = ratingFor(profile.sportRatings, getSport()).rating;
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

// ---- Shareable result card ----
// The one thing on the post-game screen a player would send to somebody.
//
// EVERYTHING ON THE CARD COMES OFF THE RESULT THAT WAS JUST RENDERED. Nothing
// below computes a score, picks an MVP, re-reads a box score or applies a
// rating formula: the card is assembled from the same `result` object the
// scoreboard, the recap and the box score were drawn from, which for an online
// game is the server's own row. A card that disagreed with the screen behind it
// would be worse than no card, and the way to guarantee it cannot is to give
// the drawing code no way to derive anything (see js/sharecard.js).

/** The card for the game on screen, or null before the final whistle. */
let shareCardData = null;

/** How many roster rows are worth putting on a card. Football drafts twelve
 * slots; a card listing all of them at a legible size has nothing else on it,
 * and js/sharecard.js caps it again per format. This is the read-side cap, so
 * a long roster does not travel through the whole path to be thrown away. */
const SHARE_ROSTER_ROWS = 12;

/**
 * Turns the finished game into the flat shape the card draws from.
 *
 * The player's OWN NAME rather than the label on screen: an online game labels
 * your side "You", which reads correctly on the screen you are looking at and
 * as nothing at all on an image somebody else opens.
 */
function buildShareCard({ result, labelB, rosterA, config }) {
  const theSport = sport();
  const mvp = result.mvp;
  return {
    sportName: theSport.name,
    sportId: game.sport || getSport(),
    accent: theSport.theme?.accent || null,
    modeLabel: modeLabel(config),
    ranked: !!config.ranked,
    you: game.nameA || "You",
    opponent: labelB,
    scoreFor: result.teamScoreA,
    scoreAgainst: result.teamScoreB,
    won: result.winner === "A",
    overtimePeriods: result.overtimePeriods || 0,
    mvpName: mvp?.player?.name || null,
    mvpLine: mvp?.line ? formatMvpStatLine(theSport, mvp.line) : null,
    // Slot, name and season - the three things an argument about a draft is
    // ever about. displayEntryName is what the rest of the app calls a drafted
    // entry, so a football unit reads "Offensive Line" here too rather than
    // "Baltimore Ravens Offensive Line" at a size nobody can read.
    roster: rosterSlots(rosterA)
      .slice(0, SHARE_ROSTER_ROWS)
      .map((slot) => ({
        slot: slotLabel(slot),
        name: displayEntryName(rosterA[slot]),
        season: rosterA[slot]?.season ?? null,
      })),
    // Filled in asynchronously for a ranked game, and left null otherwise.
    // Null means "no rating line on the card", never "+0".
    ratingDelta: null,
    ratingAfter: null,
  };
}

/**
 * Fills in the rating line for a ranked game.
 *
 * WHY THIS IS SEPARATE AND ASYNCHRONOUS. The new rating is written server-side
 * by simulate-match, so the only way to know it is to read the profile back -
 * a round trip, at the exact moment the final whistle is blowing. Doing it
 * inline would delay the whole post-game reveal for a line on an image nobody
 * has asked for yet.
 *
 * So the card is usable immediately without it, and this fills it in behind
 * the scenes. If it has not landed by the time someone taps Share, the card is
 * drawn without the rating line - which is the honest outcome. A "+0" would be
 * a number we do not have.
 */
async function resolveShareCardRating(card) {
  if (!card.ranked || ratingBefore === null) return;
  try {
    const profile = await loadProfile();
    const after = ratingFor(profile.sportRatings, card.sportId).rating;
    // Guarded against the card having been replaced by a newer game while this
    // was in flight - writing onto a stale object would put one game's rating
    // change on another game's card.
    if (shareCardData !== card) return;
    if (typeof after !== "number" || after === ratingBefore) return;
    card.ratingAfter = after;
    card.ratingDelta = after - ratingBefore;
  } catch (e) {
    // The card is complete without it. Logged rather than surfaced: nobody
    // asked for this yet.
    console.error("Couldn't read the rating change for the share card:", e);
  }
}

/**
 * The card renderer, fetched on first use.
 *
 * A DYNAMIC IMPORT, like the sports' own presentation modules. This is ~20KB of
 * canvas drawing code that matters only once a game is over and only if
 * somebody taps Share - so it has no business being in the boot payload, which
 * scripts/verify-startup-performance.mjs holds to a budget. The module is
 * cached after the first open, so the second card costs nothing.
 */
let shareCardModule = null;
function loadShareCard() {
  if (!shareCardModule) shareCardModule = import("./sharecard.js");
  return shareCardModule;
}

/** The share dialog: the card as an image, and the two ways out of it. */
async function openShareDialog() {
  const card = shareCardData;
  if (!card) return;

  btnShareResult.disabled = true;
  let sharecard;
  try {
    sharecard = await loadShareCard();
  } catch (e) {
    // Never silent, and never a dead button: the only thing that can fail here
    // is the module fetch, and saying so is more use than a click that does
    // nothing.
    console.error("Couldn't load the share card renderer:", e);
    btnShareResult.disabled = false;
    btnShareResult.textContent = "Share unavailable";
    return;
  }
  btnShareResult.disabled = false;
  const { drawShareCard, shareCard, saveCard, cardPreviewUrl, FORMATS } = sharecard;

  let format = FORMATS.story;
  let canvas = null;

  const body = document.createElement("div");
  body.className = "share-dialog";

  const preview = document.createElement("img");
  preview.className = "share-preview";
  preview.alt = `Draft Nova result card: ${card.you} ${card.scoreFor}, ${card.opponent} ${card.scoreAgainst}`;

  const status = document.createElement("p");
  status.className = "share-status hint-text";

  const draw = () => {
    // drawShareCard also reports where it put each block; only the test needs
    // that (see scripts/verify-share-card.mjs), so the canvas is all this takes.
    ({ canvas } = drawShareCard(card, format));
    // A data: URL, not a blob: one - the page's CSP allows `data:` in img-src
    // and not `blob:`, so the preview and the download encode the same canvas
    // two different ways on purpose (see js/sharecard.js).
    preview.src = cardPreviewUrl(canvas);
    preview.width = format.width;
    preview.height = format.height;
    preview.classList.toggle("share-preview-square", format.id === "square");
  };

  // The format switch. Two buttons rather than a select: there are two of
  // them, and the choice is visual.
  const formats = document.createElement("div");
  formats.className = "share-formats";
  formats.setAttribute("role", "radiogroup");
  formats.setAttribute("aria-label", "Card shape");
  const formatButtons = [];
  for (const option of [FORMATS.story, FORMATS.square]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "share-format";
    btn.textContent = option.label;
    btn.setAttribute("role", "radio");
    const paint = () => {
      for (const [b, o] of formatButtons) {
        const on = o.id === format.id;
        b.classList.toggle("active", on);
        b.setAttribute("aria-checked", String(on));
      }
    };
    btn.addEventListener("click", () => {
      if (format.id === option.id) return;
      format = option;
      paint();
      draw();
      status.textContent = "";
    });
    formatButtons.push([btn, option]);
    formats.appendChild(btn);
  }
  for (const [b, o] of formatButtons) b.setAttribute("aria-checked", String(o.id === format.id));
  formatButtons[0][0].classList.add("active");

  const actions = document.createElement("div");
  actions.className = "share-actions";

  // SHARE FIRST, because on the device most of these are made on - a phone -
  // it is the one that reaches Instagram and Discord in one tap. It falls back
  // to a download on a browser that cannot share a file, so this button always
  // does something (see shareCard).
  const shareBtn = document.createElement("button");
  shareBtn.type = "button";
  shareBtn.className = "btn btn-primary";
  shareBtn.textContent = "Share";
  shareBtn.addEventListener("click", async () => {
    shareBtn.disabled = true;
    status.textContent = "Preparing the image…";
    try {
      const what = await shareCard(canvas, card, format);
      track(EVENTS.SHARE_CARD_SHARED, {
        sport: card.sportId,
        mode: card.ranked ? "ranked" : "practice",
        format: format.id,
        source: "share",
      });
      status.textContent = what === "shared" ? "" : "Saved to your downloads.";
    } catch (e) {
      console.error("Couldn't share the card:", e);
      status.textContent = "Couldn't share that. Try Save Image instead.";
    } finally {
      shareBtn.disabled = false;
    }
  });

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn btn-secondary";
  saveBtn.textContent = "Save Image";
  saveBtn.addEventListener("click", () => {
    saveCard(canvas, card, format);
    track(EVENTS.SHARE_CARD_SHARED, {
      sport: card.sportId,
      mode: card.ranked ? "ranked" : "practice",
      format: format.id,
      source: "save",
    });
    status.textContent = "Saved to your downloads.";
  });

  actions.append(shareBtn, saveBtn);

  // Long-press to save is what people actually do on a phone, and saying so
  // costs one line - the alternative is a person screenshotting the preview.
  const hint = document.createElement("p");
  hint.className = "hint-text";
  hint.textContent = "On a phone you can also press and hold the card to save it.";

  body.append(formats, preview, actions, status, hint);
  draw();

  // Recorded once per page session per card: opening the dialog twice for the
  // same game is one card created, and the format switch redraws it without
  // counting again.
  trackOnce(
    EVENTS.SHARE_CARD_CREATED,
    { sport: card.sportId, mode: card.ranked ? "ranked" : "practice", format: format.id },
    `share_card_created:${card.you}:${card.scoreFor}-${card.scoreAgainst}:${card.mvpName || ""}`
  );

  openModal("Share this result", body);
}

btnShareResult.addEventListener("click", openShareDialog);

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

const shotChartEl = document.getElementById("shot-chart");

function resetGameScreen() {
  // Last game's share card is last game's. Cleared here rather than on the way
  // out, so the button cannot open a dialog describing a result that is no
  // longer on screen.
  shareCardData = null;
  // And the button goes back to saying what it does. Without this, one failed
  // module fetch left it reading "Share unavailable" for the rest of the
  // session - including on the next game, where it would have worked.
  btnShareResult.disabled = false;
  btnShareResult.textContent = SHARE_BUTTON_LABEL;

  // The postgame sponsor slot goes away with everything else a finished game
  // put on this screen. It is filled at the final whistle, so leaving it up
  // would put it over the next game's live scoreboard.
  releaseSponsor(sponsorPostgameEl);
  sponsorPostgameEl.replaceChildren();
  sponsorPostgameEl.hidden = true;

  for (const el of [
    finalBanner,
    gameRecapEl,
    mvpCallout,
    whyBreakdownEl,
    rewardToastEl,
    fullBoxScore,
    // Last game's shot chart is last game's. It carries the previous ledger's
    // markers and would otherwise be on screen for however long the next
    // game takes to reach its own final whistle.
    shotChartEl,
    btnShareResult,
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
  // The bot's kit is DERIVED FROM THE PLAYER'S, not fixed: red, or blue when
  // the player is already wearing red (see botKitFor). An online opponent
  // brings their own, so this only decides what the bot wears.
  const myKit = game.myKit || DEFAULT_KIT_ID;
  dressStage(
    game.online?.homeSide || "A",
    myKit,
    game.online?.oppKit || botKitFor(myKit)
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

/**
 * Every timer a playback has running, so leaving mid-game can stop all of them.
 *
 * They used to be three local arrays inside playOutResult, cleared only by
 * finish() - which is the one path a game reaches when it is WATCHED to the
 * end. Tapping a nav tab during a quarter left the interval ticking, the shot
 * ledger firing play lines, and the football field animating, all of it writing
 * into a screen nobody was looking at, until the game finished on its own.
 * Starting another game before that happened put two playbacks on one
 * scoreboard.
 *
 * A module-level registry rather than a returned handle because the callers
 * that need to stop a playback - the nav tabs - are nowhere near the one that
 * started it, and threading a handle through goToTab would put the playback in
 * the signature of every screen change in the app.
 */
const playbackTimers = { intervals: [], timeouts: [], settle: null };

/**
 * The one clock a game is revealed on.
 *
 * WHY A CLOCK RATHER THAN A PILE OF setTimeouts. Playback used to be a few
 * hundred independent timers fired at fixed real-world delays, which makes two
 * things impossible: changing the speed of a game already running, and jumping
 * to the end without either losing the result or replaying it. Both are things
 * this screen now offers.
 *
 * Everything is scheduled against a VIRTUAL time, and exactly one setTimeout is
 * ever outstanding - the one waiting for whichever event is next. Skip empties
 * the queue in order instead of dropping it, so a game that is skipped finishes
 * rather than being abandoned.
 *
 * TIMING IS NOT A SIMULATION INPUT. Every number in the game - the box score,
 * the shot chart, the MVP, the events themselves - was decided by the engine
 * before this clock started. This only decides when each one appears, which is
 * why watching a game and skipping it cannot produce two different games.
 *
 * `rate` is fixed at 1 and kept as one named constant rather than inlined: it
 * is the unit conversion between virtual and real milliseconds, and spelling
 * that out is what makes the two nowVirtual/setTimeout lines readable.
 */
function createPlaybackClock() {
  let items = [];
  const rate = 1;
  let virtual = 0;
  let anchor = null;
  let timer = null;

  const nowVirtual = () => (anchor === null ? virtual : virtual + (Date.now() - anchor) * rate);

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    clearTimer();
    if (!items.length) return;
    let next = Infinity;
    for (const item of items) if (item.at < next) next = item.at;
    timer = setTimeout(pump, Math.max(0, (next - nowVirtual()) / rate));
  }

  function pump() {
    timer = null;
    const due = nowVirtual() + 1;
    // Sorted each pump rather than kept sorted: a game schedules a few hundred
    // items once, and the ordering has to survive `after()` inserting into the
    // middle of a period from inside another event's handler.
    items.sort((a, b) => a.at - b.at);
    while (items.length && items[0].at <= due) {
      const item = items.shift();
      try {
        item.fn();
      } catch (e) {
        // One bad event must not take the rest of the game down with it - the
        // result is already recorded, and a silent stall would look like a
        // frozen game rather than the handled failure it is.
        console.error("A playback event threw; the game continues:", e);
      }
    }
    schedule();
  }

  const clock = {
    /** Show `fn` at this many virtual milliseconds from the opening tip. */
    at(atMs, fn) {
      if (anchor === null) {
        virtual = 0;
        anchor = Date.now();
      }
      items.push({ at: atMs, fn });
      schedule();
    },
    /** ...or this many from now, for the period-reveal loop, which decides its
     * next wait as it goes. */
    after(delayMs, fn) {
      clock.at(nowVirtual() + delayMs, fn);
    },
    /** The clock's own time. A caller scheduling a whole pre-built timeline has
     * to rebase it onto the moment it starts, or every event the timeline puts
     * before that moment is already due - see playEventDriven. */
    now: () => nowVirtual(),
    /** SKIP. Runs everything still pending, in order, right now - so the game
     * finishes exactly as it would have, including the finish() at the end of
     * it, rather than being abandoned. */
    finishNow() {
      const pending = items.slice().sort((a, b) => a.at - b.at);
      items = [];
      clearTimer();
      for (const item of pending) {
        try {
          item.fn();
        } catch (e) {
          console.error("A playback event threw while skipping to the end:", e);
        }
      }
    },
    stop() {
      items = [];
      clearTimer();
      anchor = null;
      virtual = 0;
    },
    pending: () => items.length,
  };
  return clock;
}

const playbackClock = createPlaybackClock();

// SKIP IS NOT AN ABANDON. It runs everything still queued, in order, right now
// - including the finish() at the end of it - so the game is recorded exactly
// as it would have been. Walking away mid-game settles it the same way; see
// cleanupPlayback.
//
// IT IS ALSO THE ONLY PLAYBACK CONTROL. There were 1x and 2x buttons here,
// which existed because a game took three and a half minutes to watch; the fix
// for that was to make the game a minute long, not to sell a way of halving it.
// With them went a stored preference, a rate on the playback clock, and a
// `speed` divisor threaded through both sports' timelines - three pieces of
// state that could disagree about how fast a game was being shown.
btnSkipPlayback?.addEventListener("click", () => {
  hidePlaybackControls();
  playbackClock.finishNow();
});

/** The controls come and go, THE ROW DOES NOT. `.playback-idle` hides the
 * buttons without taking their height out of the stage: the stage sits above
 * the box score a viewer scrolls down to read while a game plays, so a row that
 * disappeared at the final buzzer would shorten the page underneath them. See
 * scripts/verify-live-scroll.mjs, which caught exactly that. */
function showPlaybackControls() {
  playbackControlsEl?.classList.remove("playback-idle");
}

function hidePlaybackControls() {
  playbackControlsEl?.classList.add("playback-idle");
}

/**
 * Stops whatever is still animating a game. Safe to call when nothing is.
 *
 * SETTLING IS NOT OPTIONAL WHEN A GAME IS ABANDONED. These timers are also the
 * chain that eventually calls finish(), where the result is recorded - history,
 * rank, badges, personal bests, picks - so cancelling them and walking away
 * throws the whole game out. A player who taps Profile in the third quarter did
 * play that game. `settle` finishes it instantly instead, with none of the
 * celebration (see finish()'s `silent`). Callers not abandoning a game in
 * progress pass nothing and get the plain cancel.
 */
function cleanupPlayback({ settle = false } = {}) {
  playbackClock.stop();
  for (const t of playbackTimers.intervals) clearInterval(t);
  for (const t of playbackTimers.timeouts) clearTimeout(t);
  playbackTimers.intervals.length = 0;
  playbackTimers.timeouts.length = 0;
  const finishNow = playbackTimers.settle;
  playbackTimers.settle = null;
  if (settle && finishNow) finishNow();
}

function playOutResult({ result, labelA, labelB, rosterA, rosterB, minutesA, minutesB, matchups, tactic, analysis, onComplete }) {
  // A new game never inherits the last one's timers, and an unfinished game is
  // recorded rather than dropped on the way out - see cleanupPlayback.
  cleanupPlayback({ settle: true });
  resetGameScreen();
  showScreen("game");
  // THE ONE DELIBERATE SCROLL IN A GAME, and it happens before the game starts.
  //
  // Screens are siblings that hide and show, so the page keeps whatever scroll
  // position the previous screen left behind. A draft board is long and you
  // arrive at the bottom of it, which put the viewer 389px down a game screen
  // they had never seen - the scoreboard, the clock and the whole first quarter
  // above the top of the phone.
  //
  // "instant", not smooth: this is the screen arriving, not the page moving,
  // and an animated scroll here is indistinguishable from the app taking the
  // viewport back. After this line nothing in a live game ever scrolls the page
  // again - see scripts/verify-live-scroll.mjs.
  window.scrollTo({ top: 0, behavior: "instant" });

  // The board's state, and NOTHING ELSE'S. These are the presentation's own
  // running totals, folded from the events already revealed - see THE LIVE
  // LEDGER in each sport's playback module. The authoritative result sits
  // untouched in `result` and is read only at the final whistle.
  // EVERY MODE ROUTES THROUGH HERE, which is why the last two funnel events
  // are recorded in this function rather than three times over in the offline,
  // ranked and friendly paths. A simulation has started; the result is already
  // decided and is about to be played out.
  {
    const config = matchConfig();
    track(EVENTS.SIMULATION_STARTED, {
      sport: game.sport || getSport(),
      mode: config.id,
      difficulty: config.difficulty || undefined,
    });
  }

  const periodsSoFar = [];
  let runningA = 0;
  let runningB = 0;
  // The frame a live box-score repaint is waiting on. Held HERE rather than
  // inside the driver so finish() can cancel it: a frame still queued when a
  // viewer walks out mid-game would land after the authoritative box score had
  // been rendered and paint the half-finished live one back over it.
  let boxFrame = 0;

  // Seeded from the SPORT's own line keys. These were basketball's six
  // literals, so a football game opened on a live table of PTS/REB/AST that
  // had nowhere to put a completion - the football columns existed in the
  // header with no key behind them to accumulate into.
  const liveTotals = { a: {}, b: {} };
  const emptyLine = () => {
    const line = {};
    for (const key of liveStatKeys(sport())) line[key] = 0;
    return line;
  };
  for (const slot of Object.keys(rosterA)) liveTotals.a[slot] = emptyLine();
  for (const slot of Object.keys(rosterB)) liveTotals.b[slot] = emptyLine();

  // One box score for the whole game: the same table fills in live as the game
  // is played, then gains shooting splits at the final buzzer. Showing a
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
  if (sport().presentation.stage === "field" && Array.isArray(result.drives) && result.drives.length) {
    fieldRefs = sport().presentation.renderField(footballFieldEl, labelA, labelB);
    timeline = sport().presentation.buildTimeline?.(result.drives) || timeline;
  }

  // Basketball's stage, drawn once and then written into - the same contract
  // the field has. Built BEFORE the ledger below, so the floor is on screen for
  // the opening beat rather than appearing with the first shot.
  const basketballCourtEl = document.getElementById("basketball-court");
  let courtRefs = null;
  if (sport().presentation.stage === "court" && sport().presentation.renderCourt) {
    courtRefs = sport().presentation.renderCourt(basketballCourtEl, labelA, labelB);
  }

  // Basketball's play-by-play. IT COMES WITH THE RESULT NOW.
  //
  // This used to be built here, on the client, by decomposing the box score
  // into shots - and that is the whole of the online desync. An online match is
  // simulated once on the server, but the shooting numbers and every event on
  // the chart were rebuilt on EACH client from the points, off a client-local
  // random stream, and in that client's own "A = me" frame - so the two
  // machines fed their two rosters into the draws in opposite orders. Same
  // score, two different box scores, which is exactly what two players saw.
  //
  // The simulation produces the ledger now (see js/sports/nba/ledger.js), the
  // Edge Function stores it, and this only attaches player NAMES to it - which
  // is a pure lookup, not a derivation. Offline games get the same ledger from
  // the same engine.
  const hydrate = sport().presentation.hydrateLedger;
  const ledgerEvents = Array.isArray(result.shotEvents) ? result.shotEvents : [];
  let ledger = { events: hydrate ? hydrate(ledgerEvents, rosterA, rosterB) : ledgerEvents };

  // ONE TIMELINE SHAPE FOR EVERY SPORT: a flat list of events, each carrying
  // `quarter`, `atMs`, `durationMs` and `quiet`. Football's builder already
  // emitted exactly that; basketball's wraps its ledger events, so they are
  // flattened here rather than teaching the driver two shapes. The copy is
  // shallow and happens once - the ledger itself is never written to, because
  // it is the authoritative record the final box score is checked against.
  const buildShotTimeline = sport().presentation.buildPlaybackTimeline;
  if (buildShotTimeline && ledger.events.length) {
    const built = buildShotTimeline(ledger.events);
    timeline = {
      events: built.events.map(({ event, atMs, durationMs, quiet }) => ({
        ...event,
        quarter: event.period,
        atMs,
        durationMs,
        quiet: !!quiet,
      })),
      totalMs: built.totalMs,
      periods: built.periods,
    };
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

  /** Retriggers a CSS animation class on `el` - removing then re-adding a
   * class that's already present is a no-op without a reflow between the
   * two, so back-to-back flashes (e.g. two period-end flashes in a row)
   * would otherwise only play the first one. */
  function flashClass(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }


/** The shot chart under a finished basketball game.
 *
 * WHY IT IS ONLY EVER POST-GAME. A ranked draft is built on hidden information
 * - you type a name from memory and never see the opponent's board - and a live
 * chart showing every shot both teams took is not a leak of that, because the
 * draft is over by the time anyone is watching. What would be a leak is showing
 * it DURING the draft, and nothing here can: this runs from finish().
 *
 * Structured so a per-player filter is a change to one predicate. Every marker
 * already carries the player who took it and says so in its title, which is
 * also what a screen reader reads off the chart.
 *
 * @returns whether a chart was drawn, so the caller knows whether the live
 *   court has been replaced or is still the only one on the screen.
 */
function showShotChart(events, labelA, labelB) {
  const chart = document.getElementById("shot-chart");
  const court = document.getElementById("shot-chart-court");
  const filters = document.getElementById("shot-chart-filters");
  const legend = document.getElementById("shot-chart-legend");
  const render = sport().presentation.renderShotChart;
  const shots = (events || []).filter((e) => e.type === "shot" && typeof e.x === "number");
  // A sport with no chart, or a game with no placed shots, shows nothing rather
  // than an empty floor claiming nobody took a shot.
  if (!render || !chart || !shots.length) {
    if (chart) chart.classList.add("hidden");
    return false;
  }

  let side = null;
  const paint = () => {
    const summary = render(court, events, { labelA, labelB, side });
    legend.textContent =
      `${summary.made} of ${summary.shots} — green circles are makes, red crosses are misses`;
    for (const btn of filters.querySelectorAll("button")) {
      const mine = btn.dataset.side || null;
      const active = mine === side;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-checked", String(active));
    }
  };

  filters.innerHTML = "";
  for (const [value, label] of [[null, "Both"], ["a", labelA], ["b", labelB]]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "era-chip";
    btn.setAttribute("role", "radio");
    if (value) btn.dataset.side = value;
    btn.textContent = label;
    btn.addEventListener("click", () => {
      side = value;
      paint();
    });
    filters.appendChild(btn);
  }

  paint();
  chart.classList.remove("hidden");
  return true;
}

/** One line of the final banner. Text only, never markup - see finish(). */
  function bannerPart(className, text) {
    const el = document.createElement("span");
    el.className = className;
    el.textContent = text;
    return el;
  }

  /**
   * The final whistle: the board, the banner, the recap, and the result.
   *
   * `silent` is the abandoned-game path - run to land the result rather than to
   * show it, so the horn, the confetti and the fanfare are skipped. A
   * celebration over the Profile tab is a bug, not a payoff. Guarded, because
   * it is now reachable twice (its own timer, and cleanupPlayback settling) and
   * the post-game routine must not record a result twice.
   */
  let finished = false;
  function finish(silent = false) {
    if (finished) return;
    finished = true;

    // A GAME WAS COMPLETED. Recorded here, behind the same `finished` guard
    // that stops the result being written twice, so an abandoned game settled
    // by cleanupPlayback counts exactly once and a game watched to the whistle
    // also counts exactly once.
    //
    // WHY game_completed FIRES FOR EVERY MODE AND THE OTHER TWO DO NOT. The
    // admin aggregates read online games out of `matches`, which is
    // authoritative, and only union the PRACTICE ones in from this event - so
    // game_completed carries `mode` to let them be told apart. The ranked and
    // friendly events are for the funnel, where "how many people finished a
    // ranked game" is a question about people rather than about matches.
    {
      const config = matchConfig();
      const props = {
        sport: game.sport || getSport(),
        mode: config.id,
        difficulty: config.difficulty || undefined,
        won: result.winner === "A",
        margin: Math.abs(result.teamScoreA - result.teamScoreB),
      };
      track(EVENTS.GAME_COMPLETED, props);
      if (config.ranked) track(EVENTS.RANKED_GAME_COMPLETED, props);
      else if (config.id === FRIEND_MODE.id) track(EVENTS.FRIEND_GAME_COMPLETED, props);

      // THE SHARE CARD IS ASSEMBLED FROM THE SAME `result` EVERYTHING ELSE ON
      // THIS SCREEN WAS DRAWN FROM, here, at the one point where the game is
      // definitively over. Nothing recomputes: see buildShareCard.
      shareCardData = buildShareCard({ result, labelB, rosterA, config });
      // The rating line needs a round trip the reveal must not wait for, so it
      // fills itself in behind the scenes and the card is drawn without it if
      // it has not landed.
      void resolveShareCardRating(shareCardData);
    }
    // Everything still waiting to draw on a game that is over: the queued
    // events, the pending box-score frame, and any timer a celebration owns.
    // One of those firing after the whistle lands on the next game's feed, or
    // paints the live table back over the final one.
    cleanupPlayback();
    if (boxFrame) cancelAnimationFrame(boxFrame);
    boxFrame = 0;
    hidePlaybackControls();
    renderScoreboard(liveScoreboard, labelA, labelB, periodsSoFar, 0, runningA, runningB, "Final", false);
    flashClass(gameStageEl, "final-flash");
    // The broadcast's closing line: not why the winner won (the recap below
    // covers that), just the shape the game itself took.
    const headline = sport().buildGameScript(periodsSoFar, labelA, labelB);
    // AND, FOR A SPORT THAT KEEPS ONE, THE SCORING SUMMARY IN PLACE OF THE
    // FEED. The running feed is written to be watched: it holds four cards, so
    // at the whistle it shows whichever four moments happened to be last -
    // three punts and a lead change, for a game that finished 25-23. A scoring
    // summary is what actually answers "how did it end up that", and it is the
    // sport's to write, because who scored and how is football's vocabulary,
    // not shared code's.
    //
    // Called optionally on purpose: a sport without a summary keeps exactly the
    // feed it always had. Football's is required by
    // scripts/verify-sport-contract.mjs for the stage it declares, so it cannot
    // go missing quietly.
    const summary = sport().presentation.scoringSummary?.(timeline.events, { labelA, labelB });
    if (summary?.length) renderScoringSummary(playFeedEl, headline, summary);
    else pushPlayHeadline(playFeedEl, headline, "final");

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
    //
    // THEY COME OFF THE RESULT NOW, not off a client-side derivation. The
    // simulation records fga/fgm/tpa/tpm/fta/ftm per player as part of the box
    // score (see attachShooting in js/sports/nba/engine.js), so an online game's
    // shooting line is the SERVER'S line on both machines - which is the fix for
    // two players seeing one final score under two different box scores.
    //
    // The ledger fold is kept as the fallback for a result that predates those
    // columns; it agrees with them by construction, because the ledger is an
    // expansion of exactly these numbers. buildShotLines - a second, unseeded
    // derivation over whole-game totals - is gone from this path entirely.
    const foldLines = sport().presentation.foldPlayerShotLines;
    const ledgerLines = foldLines && ledger.events.length ? foldLines(ledger.events) : null;
    // buildShotLines reads the result's own shooting columns when they are
    // there, which for basketball they now always are, and only re-derives for
    // a result that predates them. The ledger fold is the middle case: an old
    // online result that stored events but no columns.
    const shotsA = buildShotLines(rosterA, result.boxA) || (ledgerLines && ledgerLines.a);
    const shotsB = buildShotLines(rosterB, result.boxB) || (ledgerLines && ledgerLines.b);

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
    // THE SAME SHOTS, IN THE SAME PLACES, after the whistle. Drawn from the
    // ledger the live court was drawing from, so a three you watched drop in
    // the third quarter is exactly where you watched it drop.
    // ONE COURT ON THE SCREEN, NOT TWO. The live floor is the stage a game is
    // watched on; once it is over, the same picture belongs below the recap,
    // where the chart is - and leaving both up showed the identical court
    // twice with the box score between them. Taken down only when the chart
    // actually replaced it: a sport that draws no chart, or a game with no
    // placed shots, keeps the floor it played on rather than showing nothing.
    if (showShotChart(ledger.events, labelA, labelB)) {
      basketballCourtEl.classList.add("hidden");
    }
    // Only once there is a card to share. The abandoned path reaches finish()
    // too and builds one, so this is always true here - but a button that
    // opened an empty dialog would be the one bug worth being certain about.
    btnShareResult.classList.toggle("hidden", !shareCardData);
    btnToProfile.classList.remove("hidden");
    btnPlayAgain.classList.remove("hidden");
    btnGameHome.classList.remove("hidden");

    // The postgame sponsor slot, revealed with the exit buttons rather than
    // before them: it sits below the result, the recap, the MVP and the box
    // score, and it appears at the same moment as everything else that means
    // the game is over. Renders nothing today - no campaign names this
    // placement - so the slot stays hidden and the layout is unchanged.
    renderSponsor(sponsorPostgameEl, PLACEMENTS.POSTGAME);

    // The payoff. A win gets the horn, the confetti and the fanfare; a loss
    // gets the horn and a flat two-note fall, because losing shouldn't be
    // louder than winning. None of it on the abandoned path.
    if (silent) {
      onComplete();
      return;
    }
    playBuzzer();
    if (result.winner === "A") {
      // How loud a win is depends on what was at stake. Quick Play got the
      // same 110-piece confetti and fanfare as a ranked game against a real
      // opponent, which spends the celebration on the game that risked
      // nothing - and leaves nothing bigger to give the one that did.
      //
      // Read off what the mode actually IS rather than a flag set beside it. A
      // game that moves your rank is the loudest; a friendly against a real
      // person is a real game and gets the middle treatment; practice is
      // practice, and Easy practice - the learning mode - is the quietest.
      const config = matchConfig();
      const stakes = config.ranked
        ? "ranked"
        : config.difficulty === "easy"
          ? "casual"
          : "practice";
      const CELEBRATION = {
        ranked: { count: 110, durationMs: 4200, fanfare: true, flare: true },
        practice: { count: 55, durationMs: 2600, fanfare: true, flare: true },
        casual: { count: 22, durationMs: 1500, fanfare: false, flare: false },
      };
      const party = CELEBRATION[stakes];
      confetti({ count: party.count, durationMs: party.durationMs });
      // REGISTERED, like every other timer a game owns. These two were left
      // out, so the exit buttons could not cancel a fanfare and tapping Play
      // Again inside 320ms played it over the home screen.
      if (party.fanfare) playbackTimers.timeouts.push(window.setTimeout(playFanfare, 320));
      if (party.flare) replayAnimation(finalBanner, "win-flare");
    } else {
      playbackTimers.timeouts.push(window.setTimeout(playDefeat, 320));
    }

    onComplete();
  }

  /**
   * THE PLAYBACK: one event at a time, nothing revealed before the play that
   * produced it.
   *
   * WHAT THIS REPLACED, AND WHY IT WAS WRONG. Basketball used to be revealed a
   * PERIOD at a time: at the first tick of Q1 it pushed
   * result.quarterBoxScores[0] into the running totals - the quarter's finished
   * score AND every player's finished line for it - animated the board up to
   * them over a second and a half, and only then began playing the events that
   * produced them. So the board read 36-24 with 9:52 left in the first, and the
   * fifty shots underneath were a replay of a result the viewer had already
   * been handed. Football had exactly the same bug and was fixed first; this is
   * that fix, generalised, and the period path is gone.
   *
   * THE TWO STATES, KEPT APART.
   *
   *   result       the AUTHORITATIVE record. Read at the final whistle and
   *                nowhere else. Playback cannot write to it and never
   *                recomputes any part of it.
   *   live         the PRESENTATION state: a pure fold of the events already
   *                shown. Every number on screen during a game comes from here.
   *
   * Because each sport's ledger is an exact expansion of its own box score, the
   * fold of ALL the events is the result - so the last frame of playback and
   * the authoritative final are the same numbers by construction, not by two
   * derivations happening to agree. Skip proves it: it runs the rest of the
   * queue immediately and lands on the identical screen.
   *
   * The sport owns the folding (see THE LIVE LEDGER in each playback module);
   * this decides only WHEN each event is shown and what on screen reacts to it.
   */
  /** Whose drive it was, in the names actually on screen. */
  function possessionLabel(side) {
    return side === "A" ? labelA : side === "B" ? labelB : "";
  }

  function playEventDriven() {
    // THE TIMELINE STARTS AT ZERO; THE CLOCK DOES NOT.
    //
    // This runs after the opening hold, so the clock's virtual time is already
    // past OPENING_HOLD_MS by the time the first event is scheduled.
    // Scheduling a timeline offset directly - `at(event.atMs)` - therefore put
    // every event of the first few seconds in the PAST, and they all fired at
    // once: the opening flashed by in a single frame before the game settled
    // into its proper pace. Rebasing onto the moment playback actually begins
    // is what keeps a pre-built timeline in step with a clock that has already
    // been running.
    const base = playbackClock.now();
    const presentation = sport().presentation;
    const live = presentation.createLiveState({ rosterA, rosterB });
    // The feed's voice, made fresh for this game. A sport without one falls
    // back to the plain scoring/turnover lines below.
    const feedLine = presentation.createFeedVoice?.() || null;
    // Whichever stage this sport draws on. One name, because everything below
    // treats it the same way: hand it the event, let the sport decide what that
    // looks like.
    const stageRefs = fieldRefs || courtRefs;
    // A quarter's summary is published once, by whichever event ends it.
    const published = new Set();
    let leader = null;
    // Whether a between-periods card is currently over the stage. Taken down by
    // the next event rather than on a timer of its own, so it can never sit
    // over live play and never needs cancelling when a viewer leaves.
    let breakShowing = false;

    /**
     * A period number, as the board names it and as the recap indexes it.
     *
     * TWO WAYS TO FIND IT, because the two sports record a period differently.
     * Football stamps `period` onto each entry of quarterBoxScores; basketball's
     * entries are `{a, b}` and the period IS the position - and reading only the
     * stamp meant every basketball lookup returned -1, so no quarter was ever
     * published, no card was ever shown, and the board finished a game with an
     * empty grid beside a correct total. Caught by scripts/verify-nba-court.mjs,
     * which is exactly the class of wiring bug a Node test cannot see.
     */
    const labelForQuarter = (quarter) => {
      if (quarter == null) return null;
      let idx = result.quarterBoxScores.findIndex((q) => q.period === quarter);
      if (idx < 0 && quarter >= 1 && quarter <= result.quarterBoxScores.length) idx = quarter - 1;
      if (idx < 0) return null;
      return { idx, label: periodLabel(idx) };
    };

    // WHAT THE BOARD IS ALREADY SHOWING, so a repaint happens only when
    // something on it has actually changed.
    //
    // This is called on EVERY event - a few hundred times a basketball game,
    // most of them a miss that changed no number on the board - and it used to
    // rebuild the whole scoreboard each time. Two things came of that, and the
    // second is the one a viewer complains about:
    //
    //   The score elements were destroyed and recreated between plays, so the
    //   `pulse` glow on them restarted from frame zero several times a second.
    //   A number that is meant to sit still and breathe instead twitched.
    //
    //   The period table was thrown away and re-parsed to change one string.
    //   setScoreboardStatus was written for exactly this and says so in its
    //   own comment - it just was never the only writer, so the saving it
    //   describes was never actually taken on this path.
    //
    // The board's state is the two totals, the quarter columns and the LIVE
    // cell for the quarter in progress; everything else on it is fixed for the
    // game. So those are what is compared, and between scores the centre cell
    // is the only thing that moves.
    let paintedA = null;
    let paintedB = null;
    let paintedPeriods = -1;
    let paintedLive = null;

    /**
     * The quarter columns, as watched.
     *
     * Completed periods carry their finished totals; the one in progress
     * carries the score SO FAR and is marked live; periods that have not
     * started are not in the list at all, and renderScoreboard prints a dash
     * for them. That last part is the whole requirement - a game two minutes
     * old must not be able to tell you what the fourth quarter finished.
     */
    const columnsFor = (quarter) => {
      if (quarter == null || published.has(quarter)) return periodsSoFar;
      const named = labelForQuarter(quarter);
      if (!named) return periodsSoFar;
      const points = presentation.livePeriodScore
        ? presentation.livePeriodScore(live, quarter)
        : null;
      if (!points) return periodsSoFar;
      return [...periodsSoFar, { label: named.label, a: Math.round(points.a), b: Math.round(points.b), live: true }];
    };

    const paint = (statusLabel, { ticking = false, quarter = null } = {}) => {
      const columns = columnsFor(quarter);
      const liveCell = columns.length > periodsSoFar.length
        ? `${columns[columns.length - 1].a}-${columns[columns.length - 1].b}`
        : null;
      if (
        runningA === paintedA &&
        runningB === paintedB &&
        periodsSoFar.length === paintedPeriods &&
        liveCell === paintedLive
      ) {
        setScoreboardStatus(liveScoreboard, statusLabel, ticking);
        return;
      }
      paintedA = runningA;
      paintedB = runningB;
      paintedPeriods = periodsSoFar.length;
      paintedLive = liveCell;
      // Columns that have not been STARTED, which is what reads "-". The live
      // column is one of `columns` now, so it has to come out of the pending
      // count or the board grows a fifth quarter the moment Q1 tips off.
      const regulationShown = columns.filter((p) => !p.label.startsWith("OT")).length;
      renderScoreboard(
        liveScoreboard,
        labelA,
        labelB,
        columns,
        Math.max(0, REGULATION_PERIODS - regulationShown),
        runningA,
        runningB,
        statusLabel,
        true
      );
      // renderScoreboard REBUILDS the centre cell when the board's shape
      // changes, so the ticking state has to go back on after it.
      if (ticking) setScoreboardStatus(liveScoreboard, statusLabel, ticking);
    };

    /**
     * THE BOX SCORE, COALESCED ONTO A FRAME.
     *
     * Basketball produces an event every 150-400ms and every one of them moves
     * some player's line, so repainting the table inline would rebuild a
     * twenty-row table several times a second for a minute. The table is above
     * the fold on a phone and under the reader's thumb; rebuilding it that
     * often is both the churn requirement 19 is about and a scroll hazard.
     *
     * One frame is the right granularity: nothing is ever more than 16ms stale,
     * a burst of folded events lands as a single repaint, and the browser gets
     * to schedule it. The pending flag is cleared BEFORE the paint so an event
     * firing inside the same frame queues the next one rather than being lost.
     */
      const repaintBox = () => {
      boxFrame = 0;
      renderFullBoxScore(
        fullBoxScore, rosterA, presentation.liveBox(live, "A"), labelA,
        rosterB, presentation.liveBox(live, "B"), labelB, null, null, minutesA, minutesB
      );
    };
    const scheduleBoxPaint = () => {
      if (boxFrame) return;
      boxFrame = requestAnimationFrame(repaintBox);
    };

    /**
     * A quarter's line goes up when the quarter ENDS, which is the whole
     * point: the summary is a report of something the viewer has now watched
     * rather than a preview of something they have not.
     *
     * The score comes from the live fold, not from quarterBoxScores, so the
     * column can never disagree with the running total beside it.
     */
    const publishPeriod = (quarter) => {
      if (quarter == null || published.has(quarter)) return;
      const named = labelForQuarter(quarter);
      if (!named) return;
      published.add(quarter);
      const points = presentation.livePeriodScore
        ? presentation.livePeriodScore(live, quarter)
        : { a: 0, b: 0 };
      periodsSoFar.push({ label: named.label, a: Math.round(points.a), b: Math.round(points.b) });
      paint(`End of ${named.label}`);
      flashClass(liveScoreboard, "period-flash");
      announcePeriod(named.idx, named.label);
      // The card between periods, for a sport that draws one. Every number on
      // it comes off the live fold and the engine's own period lines, so it
      // cannot disagree with the board it is covering.
      if (stageRefs && presentation.showQuarterBreak) {
        presentation.showQuarterBreak(stageRefs, {
          label: named.label,
          scoreA: Math.round(points.a),
          scoreB: Math.round(points.b),
          leader: periodLeader(named.idx),
          stats: presentation.liveTeamStats?.(live) || null,
        });
        breakShowing = true;
      }
    };

    for (const event of timeline.events) {
      playbackClock.at(base + event.atMs, () => {
        presentation.applyEvent(live, event);
        const score = presentation.liveScore(live);
        const scoreMoved = score.A !== runningA || score.B !== runningB;
        runningA = score.A;
        runningB = score.B;
        // Only a play that produced something changes the table. Football's
        // kickoffs and drive starts carry no player production; basketball's
        // events all do, and the frame coalescing above is what keeps that
        // affordable.
        if (event.playerDeltas || presentation.eventChangesBox?.(event)) scheduleBoxPaint();

        // A FOLDED EVENT HAS NO TURN ON SCREEN. It has already been counted
        // into the fold above - so the rebound is in the REB column and the
        // strip - it simply shares the beat of the event that follows it
        // rather than spending one of its own. See isQuietEvent.
        if (event.quiet) return;

        // The card from the last period comes down as the next one starts.
        if (breakShowing && presentation.hideQuarterBreak) {
          presentation.hideQuarterBreak(stageRefs);
          breakShowing = false;
        }

        // THE STAGE, THE SCORE AND THE STRIP MOVE TOGETHER. One handler, one
        // frame: the shot marker, the points on the board, the quarter cell and
        // the live shooting line are all written from the same event, so there
        // is no arrangement of them in which the chart is ahead of the score or
        // behind it.
        if (stageRefs) presentation.showEvent(stageRefs, event, presentation.liveTeamStats?.(live));

        // Only the moments worth reading go to the feed. A line for every event
        // is a wall nobody follows, and the stage already showed the ordinary
        // ones. WHAT counts as worth reading is the sport's to say.
        const said = feedLine?.(event, { labelA, labelB });
        if (said) pushPlayHeadline(playFeedEl, said.text, said.kind || "");
        else if (event.scoring > 0 || event.turnover) {
          pushPlayHeadline(playFeedEl, event.text, event.scoring > 0 ? "lead-change" : "");
        } else if (event.driveSummary) {
          // Every drive gets its epitaph, not just the ones that scored. A
          // twelve-play march that stalled on the 4 used to look exactly
          // like a three-and-out, because the feed only spoke about points.
          pushPlayHeadline(playFeedEl, `${possessionLabel(event.possession)}: ${event.text}`, "drive-summary");
        }

        const sfx = presentation.eventSound?.(event);
        if (sfx) playSound(sfx);

        // A lead change is caught on the SCORING PLAY, which is when it
        // actually happens.
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

        if (event.type === "quarterEnd" || event.type === "halfEnd" || event.type === "gameEnd" || event.endOfPeriod) {
          publishPeriod(event.quarter);
        } else {
          const named = labelForQuarter(event.quarter);
          // The sport's own clock in the board's centre cell. Basketball's is
          // derived from the ledger and JUMPS between events rather than
          // counting down - there is no possession between two shots to count
          // through, and a clock ticking past a stage that is not moving is
          // exactly the "the clock runs while the events dribble out" the
          // period reveal produced.
          const ticking = presentation.liveStatusLabel?.(event);
          paint(ticking || (named ? `${named.label} in progress` : openingLabel()), {
            ticking: !!ticking,
            quarter: event.quarter,
          });
        }
      });
    }

    // The whistle goes after the last event has had its time on screen, not
    // at the moment it appears. Long enough for the final card to be read.
    const last = timeline.events[timeline.events.length - 1];
    playbackClock.at(base + last.atMs + last.durationMs + FINAL_HOLD_MS, finish);
  }

  /**
   * Whose period it was, across both rosters, for the between-periods card.
   *
   * From the ENGINE's own period lines - the same numbers the box score is
   * built from. Reading them is not a leak: this is only ever called for a
   * period that has just FINISHED on screen, so every point in it has been
   * watched. A bot's big quarter is still the answer to "who led the scoring",
   * and hiding it would make the card a card about one team.
   */
  function periodLeader(periodIndex) {
    const period = result.quarterBoxScores[periodIndex];
    if (!period) return null;
    let leader = null;
    for (const [key, roster] of [["a", rosterA], ["b", rosterB]]) {
      for (const slot of Object.keys(period[key] || {})) {
        const points = Number(period[key][slot]?.pts) || 0;
        const player = roster[slot];
        if (!player || points <= 0) continue;
        if (!leader || points > leader.points) leader = { name: player.name, points: Math.round(points) };
      }
    }
    return leader;
  }

  // A sport that declares a live ledger is played back event by event;
  // everything else keeps the period reveal.
  // HOW AN ABANDONED GAME STILL COUNTS. Armed here rather than earlier because
  // `finished` is a let and is in its temporal dead zone until this line runs.
  playbackTimers.settle = () => finish(true);
  // SKIP IS THE ONLY CONTROL NOW. 1x/2x is gone: it existed because a game took
  // three and a half minutes, and the answer to that was to make the game a
  // minute long rather than to offer a way to halve it. One less piece of state
  // that could be wrong, and one less thing between a viewer and the game.
  showPlaybackControls();
  // A game with no events cannot be played out and is settled rather than left
  // on an empty board - it is still a result, and the result is what counts.
  if (!timeline.events.length) {
    playbackClock.after(OPENING_HOLD_MS, () => finish());
    return;
  }
  playbackClock.after(OPENING_HOLD_MS, playEventDriven);
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
    // The RULES this game was played under, which is what rulesVersion is for.
    // Every practice game now plays the ranked rules against the ranked roster,
    // so there is one practice ruleset rather than the two Quick Play created.
    // Difficulty is deliberately NOT part of it: it changes who the bot drafts
    // and nothing about the rules or the engine, so folding it in here would
    // claim three incomparable simulations where there is one.
    mode: "practice",
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
        // The mode as HISTORY spells it, from the mode record rather than as a
        // literal here. It is "offline" for every practice game and always has
        // been - what changes is that the string now has one home, beside the
        // "online" and "friendly" the Edge Function writes.
        mode: matchConfig().historyMode,
        sport: game.sport || getSport(),
        era: game.era || DEFAULT_ERA,
        opponentLabel: "Bot",
        won: result.winner === "A",
        draftedTeams: draft.slots.map((slot) => draft.rosterA[slot].team),
        // What was played, in the vocabulary the profile screen reads back.
        // `mode` above stays "offline" because that is what every stored row
        // has said for years and what the era ladders aggregate on; these two
        // are additive, so an old row simply lacks them and reads as a plain
        // "Practice" rather than as a wrong difficulty.
        gameMode: "practice",
        difficulty: matchConfig().difficulty,
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
  // BASKETBALL'S STORED PLAY-BY-PLAY, in the DB's A/B frame, remapped into this
  // client's. `side` is lower-cased in the ledger, so it is remapped on its own
  // terms rather than through remapSide() - and the remap is the ONLY thing
  // done to it. Nothing here re-rolls a shot, a zone or a position: the whole
  // point of storing the ledger is that both clients render the same one.
  //
  // An older result has no ledger. It gets an empty one rather than a rebuilt
  // one: a locally regenerated play-by-play would be a different game from the
  // one the opponent is looking at, which is the bug this replaced.
  const unpack = sport().presentation.unpackLedger;
  const storedEvents = Array.isArray(gameData.shotEvents) && unpack ? unpack(gameData.shotEvents) : [];
  const shotEvents = iAmA
    ? storedEvents
    : storedEvents.map((event) => ({ ...event, side: event.side === "a" ? "b" : "a" }));
  // The running score annotation is keyed by side too, so it is flipped with
  // them - recomputing it instead would be a second derivation of a fact the
  // ledger already carries.
  if (!iAmA) {
    for (const event of shotEvents) {
      if (event.scoreAfter) event.scoreAfter = { a: event.scoreAfter.b, b: event.scoreAfter.a };
      if (event.runSide) event.runSide = event.runSide === "a" ? "b" : "a";
    }
  }

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
    // as offline Practice instead of falling back to period totals.
    drives,
    teamStatsA: iAmA ? gameData.teamStatsA : gameData.teamStatsB,
    teamStatsB: iAmA ? gameData.teamStatsB : gameData.teamStatsA,
    coinToss,
    analysis: gameData.analysis || null,
    shotEvents,
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

// The three ways out of a finished game. All of them stop the playback as well
// as the match watcher: these buttons are revealed at the final whistle, but
// the post-game reveal has its own timers and a fast tap can leave one pending.
btnPlayAgain.addEventListener("click", () => {
  cleanupOnlineWatcher();
  cleanupPlayback();
  setActiveNav("play");
  showScreen("home");
});
btnToProfile.addEventListener("click", () => {
  cleanupOnlineWatcher();
  cleanupPlayback();
  setActiveNav("profile");
  openProfileScreen();
});
btnGameHome.addEventListener("click", () => {
  cleanupOnlineWatcher();
  cleanupPlayback();
  setActiveNav("play");
  showScreen("home");
  refreshHome();
});

// ---- Profile screen ----

// The identity card at the top of the profile. Built rather than written into
// index.html because it is the SAME component the home screen and the matchup
// intro draw - see createProfileHero in js/ui/profile.js. It is created once,
// at module scope, so profileRefs can point straight at its parts exactly the
// way it used to point at markup.
const profileHero = createProfileHero();
document.getElementById("profile-hero-card").appendChild(profileHero.card);

const profileRefs = {
  usernameInput: document.getElementById("input-profile-username"),
  hero: profileHero,
  // The two the rest of this file still writes to directly, aliased so those
  // call sites did not have to learn where identity now lives.
  avatar: profileHero.avatar,
  displayName: profileHero.username,
  kitPicker: document.getElementById("profile-kit-picker"),
  kitName: document.getElementById("profile-kit-name"),
  onlineRecord: document.getElementById("online-record"),
  offlineRecord: document.getElementById("offline-record"),
  totalGames: document.getElementById("total-games"),
  totalWinPct: document.getElementById("total-win-pct"),
  careerHeading: document.getElementById("profile-career-heading"),
  careerSection: document.getElementById("profile-career"),
  sportSummary: document.getElementById("profile-sport-summary"),
  eraRecords: document.getElementById("era-records"),
  topPerformances: document.getElementById("top-performances"),
  historyBody: document.getElementById("history-body"),
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

// ---- Settings ----
// The sheet lives in index.html (see #settings-body) rather than being built
// here, so the sound toggle keeps the ids wired at module load. openModal
// appends the node; closeModal detaches it. This reference is what keeps it -
// and its listeners - alive between openings.
const settingsBodyEl = document.getElementById("settings-body");
const settingsBuildEl = document.getElementById("settings-build");

/** The commit this build was stamped with, read off the entry script's own
 * cache-busting query (see tools/stamp-build.mjs).
 *
 * Worth showing: "what version are you on?" is the first question any bug
 * report needs, and until now nothing on screen could answer it - the stamp
 * existed purely to defeat the browser cache. Falls back to "dev" for a
 * checkout served without a stamp, which is the honest answer rather than a
 * blank. */
function buildStamp() {
  const src = document.querySelector('script[src*="js/main.js"]')?.getAttribute("src") || "";
  return new URLSearchParams(src.split("?")[1] || "").get("v") || "dev";
}

function openSettings() {
  settingsBodyEl.hidden = false;
  if (settingsBuildEl) settingsBuildEl.textContent = buildStamp();
  openModal("Settings", settingsBodyEl);
}

document.getElementById("btn-settings").addEventListener("click", openSettings);

// Account fields stayed on the Profile screen - they are account state, not
// app preferences - so Settings points at them rather than duplicating them.
document.getElementById("btn-settings-account").addEventListener("click", () => {
  closeModal();
  // goToTab, not openProfileScreen directly: it also tears down the watchers
  // and timers the screen you are leaving may have running, and marks the nav.
  // Calling the opener alone leaves "Play" highlighted while the profile is on
  // screen, which is the bug every hand-rolled navigation in this file has
  // had at some point.
  goToTab("profile", openProfileScreen);
});

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

/** Which banner the wardrobe has SELECTED but not yet equipped.
 *
 * Selection is separate from what you are wearing, which is why it lives here
 * rather than being read off the profile: the picker's whole shape is "look at
 * these, choose one, then commit", and the bar at the foot of the modal is
 * where the commit happens. Cleared whenever the modal is reopened onto a
 * different shelf, so a selection cannot survive into a grid it is not in. */
let selectedBannerId = null;

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

  // The picker's one primary action, under the grid. Banners only: badges and
  // icons are still per-tile, and moving all three at once would have been
  // three redesigns in one commit.
  const bar = document.createElement("div");
  bar.className = "locker-bar";
  if (kind === "banners") wrap.appendChild(bar);

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

  // A wardrobe needs room. The default 560px dialog gave a five-column grid of
  // banner ARTWORK 76 pixels per banner, which is not enough to tell Desert
  // Wind from Forest Pixel - and telling them apart is the entire task.
  openModal("Customize", wrap, undefined, { variant: "modal-wide" });

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
        // Opens on whatever you are already flying, so the bar says something
        // true the moment the shelf appears rather than "nothing selected".
        selectedBannerId = profile.equippedBanner || null;
        const paint = () => {
          renderBanners(grid, summary, profile, onEquipBannerFromProfile, activeBannerSport, true, {
            selectedId: selectedBannerId,
            onSelect: (banner) => {
              selectedBannerId = banner.id;
              paint();
            },
          });
          renderLockerBar(bar, profile);
        };
        paint();
      }
    })
    .catch((e) => {
      console.error("Failed to load customization options:", e);
      summary.textContent = "Couldn't load your unlocks right now.";
    });
}

/** The wardrobe's action bar: what you have selected, and the one button that
 * puts it on.
 *
 * Repainted rather than rebuilt on every selection, because it is three
 * elements and the alternative is a second place that has to know the modal's
 * structure. */
function renderLockerBar(bar, profile) {
  bar.innerHTML = "";
  const banner = selectedBannerId ? bannerById(selectedBannerId) : null;
  if (!banner) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const equipped = profile.equippedBanner === banner.id;

  const preview = bannerArt(banner);
  preview.classList.add("locker-bar-art");

  const text = document.createElement("div");
  text.className = "locker-bar-text";
  const name = document.createElement("div");
  name.className = "locker-bar-name";
  name.textContent = banner.name;
  const state = document.createElement("div");
  state.className = "locker-bar-state";
  state.textContent = equipped ? "You are flying this" : "Selected";
  text.append(name, state);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary locker-bar-action";
  // The default banner has no "take down": clearing it falls back to itself
  // (see normalize() in js/profile.js), so the button would do nothing.
  const canRemove = equipped && banner.id !== DEFAULT_BANNER_ID;
  btn.textContent = canRemove ? "Take Down" : "Equip Banner";
  btn.disabled = equipped && !canRemove;
  btn.addEventListener("click", () => onEquipBannerFromProfile(canRemove ? null : banner.id));

  bar.append(preview, text, btn);
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
  // The whole hero, not just the icon: the profile's identity card now paints
  // the equipped BANNER as its background, so equipping one and repainting
  // only the avatar left the card wearing the previous banner until the next
  // full load of the screen.
  await renderProfileFor(profile);
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
  // A LINK THAT DID NOT WORK IS REPORTED BEFORE ANYTHING ELSE.
  //
  // An expired or already-used recovery link redirects back here with the
  // failure in the URL and no session, which is indistinguishable from an
  // ordinary cold visit - so it used to land on the sign-in screen saying
  // nothing, and the player's only move was to click the dead link again. The
  // failure is captured at module load (see authLinkError) because supabase-js
  // clears the fragment as soon as it initialises.
  //
  // Checked FIRST: if there is no session, this is why, and there is nothing
  // to gain from asking the network before saying so.
  const linkError = authLinkError();
  if (linkError) {
    showAuthScreen("signin");
    setAuthStatus(linkError, "error");
    return;
  }

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
