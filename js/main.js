// App controller: wires draft state + engine + progression to the DOM.

import { PLAYERS } from "./data.js";
import { computeDatasetStats, simulateGame } from "./engine.js";
import { DraftState, eligibleOpenSlots } from "./draft.js";
import { loadProgress, recordResult } from "./progression.js";
import {
  renderRosterPanel,
  renderPool,
  renderSlotPicker,
  hideSlotPicker,
  renderFullBoxScore,
  renderQuarterTabs,
  renderQuarterPanel,
  renderTierSummary,
  renderLeaderboard,
} from "./ui.js";

const datasetStats = computeDatasetStats(PLAYERS);

const screens = {
  home: document.getElementById("screen-home"),
  draft: document.getElementById("screen-draft"),
  boxscore: document.getElementById("screen-boxscore"),
  leaderboard: document.getElementById("screen-leaderboard"),
};

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle("hidden", key !== name);
  }
}

// ---- Home screen ----

const inputNameA = document.getElementById("input-name-a");
const inputNameB = document.getElementById("input-name-b");
const rowNameB = document.getElementById("row-name-b");
const modeRadios = document.querySelectorAll('input[name="mode"]');
const homeTierSummary = document.getElementById("home-tier-summary");

for (const radio of modeRadios) {
  radio.addEventListener("change", () => {
    rowNameB.hidden = getMode() !== "local";
  });
}

function getMode() {
  return [...modeRadios].find((r) => r.checked).value;
}

function refreshHomeTier() {
  renderTierSummary(homeTierSummary, loadProgress().wins);
}
refreshHomeTier();

document.getElementById("btn-view-leaderboard").addEventListener("click", () => {
  showLeaderboard();
});

document.getElementById("btn-start-draft").addEventListener("click", () => {
  const mode = getMode();
  game.nameA = inputNameA.value.trim() || "Player 1";
  game.nameB = mode === "local" ? inputNameB.value.trim() || "Player 2" : "Bot";
  game.mode = mode;
  startDraft();
});

// ---- Draft screen ----

const rosterPanelA = document.getElementById("roster-panel-a");
const rosterPanelB = document.getElementById("roster-panel-b");
const poolSearch = document.getElementById("pool-search");
const poolList = document.getElementById("pool-list");
const slotPicker = document.getElementById("slot-picker");
const draftRoundLabel = document.getElementById("draft-round-label");
const draftSquadLabel = document.getElementById("draft-squad-label");
const draftTurnBanner = document.getElementById("draft-turn-banner");
const btnSkipRound = document.getElementById("btn-skip-round");

const game = {
  mode: "bot",
  nameA: "Player 1",
  nameB: "Bot",
  draft: null,
  round: { needNewSquad: true, resolved: {}, activeSide: "A" },
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

function startDraft() {
  game.draft = new DraftState(PLAYERS);
  game.round = { needNewSquad: true, resolved: {}, activeSide: "A" };
  game.roundNumber = 0;
  poolSearch.value = "";
  showScreen("draft");
  advanceDraft();
}

/** Rolls squads and auto-resolves bot/no-valid-pick sides until either the
 * draft is complete or a human decision is genuinely required. */
function advanceDraft() {
  const draft = game.draft;

  while (!draft.isComplete()) {
    if (game.round.needNewSquad) {
      draft.rollNextSquad();
      game.roundNumber += 1;
      game.round.needNewSquad = false;
      game.round.resolved = {};
    }

    for (const side of botSides()) {
      if (!game.round.resolved[side]) {
        draft.botAutoPick(side);
        game.round.resolved[side] = true;
      }
    }

    const pendingHuman = humanSides().find((s) => !game.round.resolved[s]);
    if (pendingHuman) {
      if (draft.hasValidPick(rosterFor(pendingHuman))) {
        game.round.activeSide = pendingHuman;
        renderDraftRound();
        return;
      }
      game.round.resolved[pendingHuman] = true;
      continue;
    }

    game.round.needNewSquad = true;
  }

  renderDraftComplete();
}

function renderDraftRound() {
  const draft = game.draft;
  const side = game.round.activeSide;

  draftRoundLabel.textContent = `Round ${game.roundNumber}`;
  draftSquadLabel.textContent = `${draft.currentSquad.team} — ${draft.currentSquad.decade}`;
  draftTurnBanner.textContent = `${nameFor(side)}'s pick`;
  draftTurnBanner.hidden = false;
  btnSkipRound.disabled = false;
  poolSearch.hidden = false;

  renderRosterPanel(rosterPanelA, draft.rosterA, game.nameA, side === "A");
  renderRosterPanel(rosterPanelB, draft.rosterB, game.nameB, side === "B");

  hideSlotPicker(slotPicker);
  renderPool(poolList, draft.currentSquad, poolSearch.value, rosterFor(side), (player) => onPoolPick(player));
}

function onPoolPick(player) {
  const side = game.round.activeSide;
  const slots = eligibleOpenSlots(player, rosterFor(side));
  if (slots.length === 1) {
    finalizePick(player, slots[0]);
  } else {
    renderSlotPicker(slotPicker, player, slots, (slot) => finalizePick(player, slot));
  }
}

function finalizePick(player, slot) {
  const side = game.round.activeSide;
  game.draft.makePick(side, player, slot);
  hideSlotPicker(slotPicker);
  game.round.resolved[side] = true;
  advanceDraft();
}

btnSkipRound.addEventListener("click", () => {
  game.round.resolved[game.round.activeSide] = true;
  hideSlotPicker(slotPicker);
  advanceDraft();
});

poolSearch.addEventListener("input", () => {
  if (!game.draft || !game.draft.currentSquad) return;
  renderPool(poolList, game.draft.currentSquad, poolSearch.value, rosterFor(game.round.activeSide), onPoolPick);
});

function renderDraftComplete() {
  const draft = game.draft;
  draftRoundLabel.textContent = "Draft complete";
  draftSquadLabel.textContent = "";
  draftTurnBanner.textContent = "Both rosters are set.";
  poolSearch.hidden = true;
  btnSkipRound.disabled = true;
  hideSlotPicker(slotPicker);

  renderRosterPanel(rosterPanelA, draft.rosterA, game.nameA, false);
  renderRosterPanel(rosterPanelB, draft.rosterB, game.nameB, false);

  poolList.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.textContent = "Simulate Game";
  btn.addEventListener("click", runSimulation);
  poolList.appendChild(btn);
}

// ---- Box score screen ----

const finalBanner = document.getElementById("final-banner");
const mvpCallout = document.getElementById("mvp-callout");
const quarterTabs = document.getElementById("quarter-tabs");
const quarterPanel = document.getElementById("quarter-panel");
const fullBoxScore = document.getElementById("full-box-score");

let lastResult = null;

function runSimulation() {
  const draft = game.draft;
  const result = simulateGame(draft.rosterA, draft.rosterB, datasetStats);
  lastResult = result;

  const winnerName = result.winner === "A" ? game.nameA : game.nameB;
  finalBanner.textContent = `${winnerName} wins, ${result.teamScoreA}-${result.teamScoreB}${
    result.overtimePeriods > 0 ? ` (${result.overtimePeriods}OT)` : ""
  }`;

  const mvp = result.mvp;
  const mvpTeamName = mvp.side === "A" ? game.nameA : game.nameB;
  mvpCallout.textContent = `MVP: ${mvp.player.name} (${mvpTeamName}) — ${mvp.line.pts} PTS / ${mvp.line.reb} REB / ${mvp.line.ast} AST`;

  renderQuarterTabs(quarterTabs, result.quarterBoxScores, showQuarter, 0);
  showQuarter(0);

  renderFullBoxScore(fullBoxScore, draft.rosterA, result.boxA, game.nameA, draft.rosterB, result.boxB, game.nameB);

  if (game.mode === "bot") {
    recordResult({
      won: result.winner === "A",
      opponentLabel: "Bot",
      scoreFor: result.teamScoreA,
      scoreAgainst: result.teamScoreB,
      mvpName: mvp.player.name,
    });
  } else {
    recordResult({
      won: result.winner === "A",
      opponentLabel: game.nameB,
      scoreFor: result.teamScoreA,
      scoreAgainst: result.teamScoreB,
      mvpName: mvp.player.name,
    });
  }
  refreshHomeTier();

  showScreen("boxscore");
}

function showQuarter(index) {
  const draft = game.draft;
  renderQuarterTabs(quarterTabs, lastResult.quarterBoxScores, showQuarter, index);
  renderQuarterPanel(quarterPanel, lastResult.quarterBoxScores[index], draft.rosterA, game.nameA, draft.rosterB, game.nameB);
}

document.getElementById("btn-play-again").addEventListener("click", () => {
  showScreen("home");
});

document.getElementById("btn-to-leaderboard").addEventListener("click", () => {
  showLeaderboard();
});

// ---- Leaderboard screen ----

const leaderboardTier = document.getElementById("leaderboard-tier");
const leaderboardBody = document.getElementById("leaderboard-body");

function showLeaderboard() {
  renderLeaderboard(leaderboardTier, leaderboardBody, loadProgress());
  showScreen("leaderboard");
}

document.getElementById("btn-back-home").addEventListener("click", () => {
  showScreen("home");
});
