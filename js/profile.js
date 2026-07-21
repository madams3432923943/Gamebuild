// Persistent player profile: identity, tier progression, online (vs. human)
// and offline (vs. bot) records kept separate, top individual performances,
// and most-drafted-player tracking. Persisted to localStorage so it
// survives across sessions - the foundation for what becomes a real account
// once this is a networked app.

const STORAGE_KEY = "ballknowledge_profile_v2";

export const TIERS = [
  { name: "Rookie", minWins: 0 },
  { name: "Starter", minWins: 3 },
  { name: "All-Star", minWins: 7 },
  { name: "Champion", minWins: 12 },
  { name: "Hall of Famer", minWins: 20 },
  { name: "Legend", minWins: 30 },
];

function defaultProfile() {
  return {
    username: "",
    onlineWins: 0,
    onlineLosses: 0,
    offlineWins: 0,
    offlineLosses: 0,
    history: [],
    draftCounts: {},
    topPerformances: [],
  };
}

export function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProfile();
    return { ...defaultProfile(), ...JSON.parse(raw) };
  } catch {
    return defaultProfile();
  }
}

function saveProfile(profile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

export function setUsername(name) {
  const profile = loadProfile();
  profile.username = name;
  return saveProfile(profile);
}

// Tier progression tracks ONLINE (vs. human) wins only - bot games are
// practice, not rank, since the bot's difficulty isn't a fair ranking bar.
export function currentTier(onlineWins) {
  let tier = TIERS[0];
  for (const t of TIERS) if (onlineWins >= t.minWins) tier = t;
  return tier;
}

export function nextTier(onlineWins) {
  return TIERS.find((t) => t.minWins > onlineWins) || null;
}

/** Records every player name drafted onto the user's own roster this game,
 * for the "most drafted player" profile stat. */
export function recordDraftPicks(playerNames) {
  const profile = loadProfile();
  for (const name of playerNames) {
    profile.draftCounts[name] = (profile.draftCounts[name] || 0) + 1;
  }
  return saveProfile(profile);
}

export function mostDraftedPlayer(profile) {
  let best = null;
  for (const [name, count] of Object.entries(profile.draftCounts)) {
    if (!best || count > best.count) best = { name, count };
  }
  return best;
}

/**
 * @param mode "online" (vs. human) or "offline" (vs. bot)
 * @param bestOwnPerformance {playerName, gameScore, line} - the best game
 *   score from the user's OWN roster this game (not necessarily the MVP,
 *   who may have played for the opponent).
 */
export function recordResult({ mode, won, opponentLabel, scoreFor, scoreAgainst, mvpName, bestOwnPerformance }) {
  const profile = loadProfile();
  if (mode === "online") {
    won ? (profile.onlineWins += 1) : (profile.onlineLosses += 1);
  } else {
    won ? (profile.offlineWins += 1) : (profile.offlineLosses += 1);
  }

  profile.history.unshift({
    date: new Date().toISOString(),
    mode,
    won,
    opponentLabel,
    scoreFor,
    scoreAgainst,
    mvpName,
    tier: currentTier(profile.onlineWins).name,
  });
  profile.history = profile.history.slice(0, 50);

  if (bestOwnPerformance) {
    profile.topPerformances.push({
      date: new Date().toISOString(),
      opponentLabel,
      mode,
      ...bestOwnPerformance,
    });
    profile.topPerformances.sort((a, b) => b.gameScore - a.gameScore);
    profile.topPerformances = profile.topPerformances.slice(0, 10);
  }

  return saveProfile(profile);
}

export function resetProfile() {
  return saveProfile(defaultProfile());
}
