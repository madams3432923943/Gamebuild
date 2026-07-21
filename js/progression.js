// Meta systems: trophy/league progression and leaderboard. Carried forward
// as-is per build spec #8, persisted to localStorage.

const STORAGE_KEY = "ballknowledge_progress_v1";

export const TIERS = [
  { name: "Rookie", minWins: 0 },
  { name: "Starter", minWins: 3 },
  { name: "All-Star", minWins: 7 },
  { name: "Champion", minWins: 12 },
  { name: "Hall of Famer", minWins: 20 },
  { name: "Legend", minWins: 30 },
];

function defaultState() {
  return { wins: 0, losses: 0, history: [] };
}

export function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

function saveProgress(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function currentTier(wins) {
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (wins >= t.minWins) tier = t;
  }
  return tier;
}

export function nextTier(wins) {
  return TIERS.find((t) => t.minWins > wins) || null;
}

/** Records a completed game's result and returns the updated state. */
export function recordResult({ won, opponentLabel, scoreFor, scoreAgainst, mvpName }) {
  const state = loadProgress();
  if (won) state.wins += 1;
  else state.losses += 1;

  state.history.unshift({
    date: new Date().toISOString(),
    won,
    opponentLabel,
    scoreFor,
    scoreAgainst,
    mvpName,
    tier: currentTier(state.wins).name,
  });
  state.history = state.history.slice(0, 50);

  saveProgress(state);
  return state;
}

export function resetProgress() {
  const state = defaultState();
  saveProgress(state);
  return state;
}
