// App controller: wires draft state + engine + profile to the DOM.

import { PLAYERS } from "./data.js";
import { computeDatasetStats, simulateGame } from "./engine.js";
import { DraftState, eligibleOpenSlots } from "./draft.js";
import { SLOTS, QUARTER_REVEAL_DELAY_MS, DRAFT_REVEAL_DELAY_MS } from "./constants.js";
import { loadProfile, recordResult, recordDraftPicks, setUsername } from "./profile.js";
import {
  renderPositionSelector,
  renderRosterPanel,
  renderPool,
  renderFullBoxScore,
  renderScoreboard,
  renderProfileScreen,
} from "./ui.js";

const datasetStats = computeDatasetStats(PLAYERS);

const screens = {
  home: document.getElementById("screen-home"),
  draft: document.getElementById("screen-draft"),
  game: document.getElementById("screen-game"),
  profile: document.getElementById("screen-profile"),
};

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle("hidden", key !== name);
  }
}

function setActiveNav(which) {
  document.getElementById("nav-play").classList.toggle("active", which === "play");
  document.getElementById("nav-profile").classList.toggle("active", which === "profile");
}

// ---- Home screen ----

const inputNameA = document.getElementById("input-name-a");
const inputNameB = document.getElementById("input-name-b");
const rowNameB = document.getElementById("row-name-b");
const modeRadios = document.querySelectorAll('input[name="mode"]');

const initialProfile = loadProfile();
if (initialProfile.username) inputNameA.value = initialProfile.username;

for (const radio of modeRadios) {
  radio.addEventListener("change", () => {
    rowNameB.hidden = getMode() !== "local";
  });
}

function getMode() {
  return [...modeRadios].find((r) => r.checked).value;
}

document.getElementById("btn-start-draft").addEventListener("click", () => {
  const mode = getMode();
  const nameA = inputNameA.value.trim() || "Player 1";
  game.nameA = nameA;
  game.nameB = mode === "local" ? inputNameB.value.trim() || "Player 2" : "Bot";
  game.mode = mode;
  setUsername(nameA);
  startDraft();
});

document.getElementById("btn-brand").addEventListener("click", () => {
  setActiveNav("play");
  showScreen("home");
});
document.getElementById("nav-play").addEventListener("click", () => {
  setActiveNav("play");
  showScreen("home");
});
document.getElementById("nav-profile").addEventListener("click", () => {
  setActiveNav("profile");
  openProfileScreen();
});

// ---- Draft screen ----

const rosterPanelA = document.getElementById("roster-panel-a");
const rosterPanelB = document.getElementById("roster-panel-b");
const poolSearch = document.getElementById("pool-search");
const poolList = document.getElementById("pool-list");
const positionSelectorEl = document.getElementById("position-selector");
const draftRoundLabel = document.getElementById("draft-round-label");
const squadBannerTeam = document.getElementById("squad-banner-team");
const squadBannerDecade = document.getElementById("squad-banner-decade");
const draftTurnBanner = document.getElementById("draft-turn-banner");
const btnSkipRound = document.getElementById("btn-skip-round");

const game = {
  mode: "bot",
  nameA: "Player 1",
  nameB: "Bot",
  draft: null,
  round: { needNewSquad: true, resolved: {}, activeSide: "A", pendingPlayer: null, pendingSlots: {} },
  roundNumber: 0,
};

function humanSides() {
  return game.mode === "local" ? ["A", "B"] : ["A"];
}
function botSides() {
  return game.mode === "local" ? [] : ["B"];
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

function startDraft() {
  game.draft = new DraftState(PLAYERS);
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
    draft.rollNextSquad();
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
      renderDraftRound();
      return;
    }
    game.round.resolved[pendingHuman] = true;
    advanceDraft();
    return;
  }

  // Every side that needed to act this round has. If anyone actually
  // picked, hold on a "locked in" reveal beat before moving on.
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
  btnSkipRound.disabled = false;
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
  renderPool(poolList, draft.currentSquad, poolSearch.value, rosterFor(side), pendingName, onPoolPick);
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
  const side = game.round.activeSide;
  game.draft.makePick(side, player, slot);
  game.round.resolved[side] = true;
  game.round.pendingSlots[side] = slot;
  game.round.pendingPlayer = null;
  advanceDraft();
}

btnSkipRound.addEventListener("click", () => {
  game.round.resolved[game.round.activeSide] = true;
  game.round.pendingPlayer = null;
  advanceDraft();
});

poolSearch.addEventListener("input", () => {
  if (!game.draft || !game.draft.currentSquad) return;
  renderPoolForCurrentState();
});

function renderRoundReveal() {
  const draft = game.draft;
  draftTurnBanner.textContent = "Revealing picks…";
  poolSearch.hidden = true;
  btnSkipRound.disabled = true;
  positionSelectorEl.innerHTML = "";
  poolList.innerHTML = "";

  renderRosterPanel(rosterPanelA, draft.rosterA, game.nameA, false, { revealSlots: pendingSlotsFor("A") });
  renderRosterPanel(rosterPanelB, draft.rosterB, game.nameB, false, { revealSlots: pendingSlotsFor("B") });
}

function renderDraftComplete() {
  const draft = game.draft;
  draftRoundLabel.textContent = "Draft complete";
  squadBannerTeam.textContent = "Rosters set";
  squadBannerDecade.textContent = "";
  draftTurnBanner.textContent = "Both rosters are set.";
  poolSearch.hidden = true;
  btnSkipRound.disabled = true;
  positionSelectorEl.innerHTML = "";

  renderRosterPanel(rosterPanelA, draft.rosterA, game.nameA, false);
  renderRosterPanel(rosterPanelB, draft.rosterB, game.nameB, false);

  poolList.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "btn btn-primary btn-block";
  btn.textContent = "Simulate Game";
  btn.addEventListener("click", runSimulation);
  poolList.appendChild(btn);
}

// ---- Game screen (live scoreboard + final box score) ----

const liveScoreboard = document.getElementById("live-scoreboard");
const finalBanner = document.getElementById("final-banner");
const mvpCallout = document.getElementById("mvp-callout");
const fullBoxScore = document.getElementById("full-box-score");
const btnToProfile = document.getElementById("btn-to-profile");
const btnPlayAgain = document.getElementById("btn-play-again");

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

const REGULATION_PERIODS = 4;

function runSimulation() {
  const draft = game.draft;
  const result = simulateGame(draft.rosterA, draft.rosterB, datasetStats);

  finalBanner.classList.add("hidden");
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

  renderScoreboard(liveScoreboard, game.nameA, game.nameB, periodsSoFar, REGULATION_PERIODS, 0, 0, "Tip-off", true);

  function step() {
    if (i >= deltaA.length) {
      finishGame(result, periodsSoFar, runningA, runningB);
      return;
    }
    const isOt = result.quarterBoxScores[i].overtime;
    const label = isOt ? `OT${i - REGULATION_PERIODS}` : `Q${i + 1}`;
    periodsSoFar.push({ label, a: deltaA[i], b: deltaB[i] });
    runningA += deltaA[i];
    runningB += deltaB[i];
    const regulationPlayed = periodsSoFar.filter((p) => !p.label.startsWith("OT")).length;
    const periodsRemaining = Math.max(0, REGULATION_PERIODS - regulationPlayed);
    renderScoreboard(liveScoreboard, game.nameA, game.nameB, periodsSoFar, periodsRemaining, runningA, runningB, `End of ${label}`, true);
    i += 1;
    setTimeout(step, QUARTER_REVEAL_DELAY_MS);
  }
  setTimeout(step, QUARTER_REVEAL_DELAY_MS);
}

function finishGame(result, periodsSoFar, runningA, runningB) {
  const draft = game.draft;
  renderScoreboard(liveScoreboard, game.nameA, game.nameB, periodsSoFar, 0, runningA, runningB, "Final", false);

  const winnerName = result.winner === "A" ? game.nameA : game.nameB;
  finalBanner.textContent = `${winnerName} wins, ${result.teamScoreA}-${result.teamScoreB}${
    result.overtimePeriods > 0 ? ` (${result.overtimePeriods}OT)` : ""
  }`;
  finalBanner.classList.remove("hidden");

  const mvp = result.mvp;
  const mvpTeamName = mvp.side === "A" ? game.nameA : game.nameB;
  mvpCallout.textContent = `MVP: ${mvp.player.name} (${mvpTeamName}) — ${Math.round(mvp.line.pts)} PTS / ${Math.round(
    mvp.line.reb
  )} REB / ${Math.round(mvp.line.ast)} AST`;
  mvpCallout.classList.remove("hidden");

  renderFullBoxScore(fullBoxScore, draft.rosterA, result.boxA, game.nameA, draft.rosterB, result.boxB, game.nameB);
  fullBoxScore.classList.remove("hidden");
  btnToProfile.classList.remove("hidden");
  btnPlayAgain.classList.remove("hidden");

  const mode = game.mode === "bot" ? "offline" : "online";
  const opponentLabel = game.mode === "bot" ? "Bot" : game.nameB;
  const ownLines = SLOTS.map((slot) => ({ playerName: draft.rosterA[slot].name, line: result.boxA[slot] }));

  recordResult({
    mode,
    won: result.winner === "A",
    opponentLabel,
    scoreFor: result.teamScoreA,
    scoreAgainst: result.teamScoreB,
    mvpName: mvp.player.name,
    ownLines,
  });
  recordDraftPicks(SLOTS.map((slot) => draft.rosterA[slot].name));
}

btnPlayAgain.addEventListener("click", () => {
  setActiveNav("play");
  showScreen("home");
});
btnToProfile.addEventListener("click", () => {
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
  mostDrafted: document.getElementById("most-drafted"),
  topPerformances: document.getElementById("top-performances"),
  historyBody: document.getElementById("history-body"),
};

function openProfileScreen() {
  renderProfileScreen(profileRefs, loadProfile());
  showScreen("profile");
}

profileRefs.usernameInput.addEventListener("change", () => {
  const name = profileRefs.usernameInput.value.trim();
  setUsername(name);
  inputNameA.value = name;
});
