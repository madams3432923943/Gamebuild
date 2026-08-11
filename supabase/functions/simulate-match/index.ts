import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { engineFor } from "./sports/index.ts";
import { applyRatingExchange } from "./rating.js";
import { normalizeSeed, withSeededMathRandom } from "./seeded-rng.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Football stores an offensive + defensive plan pair as JSON in the tactic
 * column. Basketball stores one ordinary tactic id there. */
function parseFootballStrategy(stored: unknown): { offense: string; defense: string } | undefined {
  if (typeof stored !== "string" || !stored.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed.offense === "string" && typeof parsed.defense === "string") {
      return { offense: parsed.offense, defense: parsed.defense };
    }
  } catch {
    // Not a football strategy pair.
  }
  return undefined;
}

function eraRecordKey(sportId: string, eraId: string) {
  return sportId === "nba" ? eraId : `${sportId}:${eraId}`;
}

function bumpEraRecord(records: Record<string, any>, eraKey: string, won: boolean) {
  const empty = { online_wins: 0, online_losses: 0, offline_wins: 0, offline_losses: 0 };
  const current = { ...empty, ...((records || {})[eraKey] || {}) };
  const key = won ? "online_wins" : "online_losses";
  return { ...(records || {}), [eraKey]: { ...current, [key]: (current[key] || 0) + 1 } };
}

const ownLinesFor = (roster: Record<string, any>, box: Record<string, any>) =>
  Object.keys(roster || {}).map((slot) => ({
    playerName: roster[slot]?.name || slot,
    season: roster[slot]?.season ?? null,
    line: box?.[slot] || {},
  }));

function snapshotRoster(roster: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [slot, player] of Object.entries(roster || {})) {
    if (!player) continue;
    out[slot] = {
      name: (player as any).name,
      team: (player as any).team,
      decade: (player as any).decade ?? (player as any).era ?? null,
      era: (player as any).era ?? null,
      season: (player as any).season ?? null,
      group: (player as any).group ?? null,
    };
  }
  return out;
}

function buildMatchOutcome(
  profile: Record<string, any>,
  opponentLabel: string,
  won: boolean,
  scoreFor: number,
  scoreAgainst: number,
  mvpName: string,
  ownLines: { playerName: string; season?: number | null; line: Record<string, number> }[],
  statKeys: string[],
  friendly: boolean,
  sport: string,
  era: string,
  nextSportRatings: Record<string, any> | null,
  snapshot: Record<string, any> | null,
  date: string,
) {
  const key = (k: string) => (sport === "nba" ? k : `${sport}:${k}`);
  const game = snapshot
    ? { date, mode: friendly ? "friendly" : "online", sport, era, opponentLabel, scoreFor, scoreAgainst, ...snapshot }
    : null;

  const personalBests: Record<string, any> = { ...(profile.personal_bests || {}) };
  for (const statKey of statKeys) {
    for (const { playerName, season, line } of ownLines) {
      const value = Number(line?.[statKey]);
      if (!Number.isFinite(value)) continue;
      const current = personalBests[key(statKey)];
      if (!current || value > Number(current.value || 0)) {
        personalBests[key(statKey)] = { value, playerName, season: season ?? null, date, game };
      }
    }
  }

  const draftCounts: Record<string, number> = { ...(profile.draft_counts || {}) };
  for (const { playerName } of ownLines) {
    draftCounts[key(playerName)] = (draftCounts[key(playerName)] || 0) + 1;
  }

  const recordFor = (stored: Record<string, any> | null, sportId: string) =>
    !stored ? null : stored.value !== undefined ? (sportId === "nba" ? stored : null) : stored[sportId] || null;
  const putRecord = (stored: Record<string, any> | null, sportId: string, entry: Record<string, any>) => ({
    ...(stored && stored.value !== undefined ? { nba: stored } : stored || {}),
    [sportId]: entry,
  });

  let highestScoringGame = profile.highest_scoring_game;
  const bestScoring = recordFor(highestScoringGame, sport);
  if (game && (!bestScoring || scoreFor > bestScoring.value)) {
    highestScoringGame = putRecord(highestScoringGame, sport, { value: scoreFor, ...game });
  }

  let largestMarginGame = profile.largest_margin_game;
  const bestMargin = recordFor(largestMarginGame, sport);
  const margin = scoreFor - scoreAgainst;
  if (won && game && (!bestMargin || margin > bestMargin.value)) {
    largestMarginGame = putRecord(largestMarginGame, sport, { value: margin, ...game });
  }

  const update: Record<string, unknown> = {
    personal_bests: personalBests,
    draft_counts: draftCounts,
    history: [
      { date, mode: friendly ? "friendly" : "online", sport, won, opponentLabel, scoreFor, scoreAgainst, mvpName },
      ...(profile.history || []),
    ].slice(0, 50),
    highest_scoring_game: highestScoringGame,
    largest_margin_game: largestMarginGame,
  };

  if (!friendly) {
    update.online_wins = Number(profile.online_wins || 0) + (won ? 1 : 0);
    update.online_losses = Number(profile.online_losses || 0) + (won ? 0 : 1);
    update.era_records = bumpEraRecord(profile.era_records, eraRecordKey(sport, era), won);
    if (nextSportRatings) update.sport_ratings = nextSportRatings;
  }

  return update;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let matchId: string | undefined;
  try {
    matchId = (await req.json()).match_id;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (!matchId) return json({ error: "match_id required" }, 400);

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: "not authenticated" }, 401);
  const uid = userData.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: match, error: matchErr } = await admin.from("matches").select("*").eq("id", matchId).single();
  if (matchErr || !match) return json({ error: "match not found" }, 404);
  if (match.player_a !== uid && match.player_b !== uid) return json({ error: "not a participant" }, 403);

  const { data: existing } = await admin.from("match_results").select("*").eq("match_id", matchId).maybeSingle();
  if (existing) return json({ status: "complete", result: existing, winner: match.winner });
  if (match.status !== "ready_to_simulate") {
    return json({ error: "match is not ready to simulate", status: match.status }, 409);
  }

  const sportId = match.sport ?? "nba";
  const sportEngine = engineFor(sportId);
  if (!sportEngine) return json({ error: `no server engine for sport '${sportId}'` }, 501);

  const { data: playerRows, error: playersErr } = await admin.from(sportEngine.table).select("*");
  if (playersErr || !playerRows) return json({ error: `failed to load ${sportId} player dataset` }, 500);

  // Every sport owns these conversions. This is the critical boundary that
  // prevents a shared online shell from turning an NFL roster into basketball
  // fields or feeding football data through the NBA stats preprocessor.
  const rosterA = sportEngine.normalizeRoster(match.roster_a);
  const rosterB = sportEngine.normalizeRoster(match.roster_b);
  const datasetStats = sportEngine.computeDatasetStats(playerRows);

  const { data: pickRows } = await admin
    .from("match_picks")
    .select("side, slot, forfeited, action")
    .eq("match_id", matchId);
  const forfeitedSlots = (side: string) =>
    (pickRows ?? [])
      .filter((p) => p.side === side && p.action === "pick" && p.forfeited && p.slot)
      .map((p) => p.slot as string);
  const unfilled = (roster: Record<string, any>, other: Record<string, any>) =>
    Object.keys(other).filter((slot) => !roster[slot]);
  const forfeitsA = [...new Set([...forfeitedSlots("A"), ...unfilled(rosterA, rosterB)])];
  const forfeitsB = [...new Set([...forfeitedSlots("B"), ...unfilled(rosterB, rosterA)])];

  const seed = normalizeSeed(matchId);
  let result: any;
  try {
    result = withSeededMathRandom(seed, () =>
      sportEngine.simulate(rosterA, rosterB, datasetStats, {
        tacticA: match.tactic_a ?? undefined,
        tacticB: match.tactic_b ?? undefined,
        strategyA: parseFootballStrategy(match.tactic_a),
        strategyB: parseFootballStrategy(match.tactic_b),
        minutesA: match.rotation_a ?? undefined,
        minutesB: match.rotation_b ?? undefined,
        matchupsA: match.matchups_a ?? undefined,
        matchupsB: match.matchups_b ?? undefined,
        forfeitsA,
        forfeitsB,
      })
    );
  } catch (error) {
    console.error(`${sportId} simulation failed`, error);
    return json({ error: `${sportId} simulation failed` }, 500);
  }

  // Ranked head-to-head needs a winner for the existing ELO contract. The NFL
  // engine already runs paired overtime possessions up to its safety cap; if a
  // pathological game is still tied after that, refuse to write a fake winner
  // rather than silently awarding a tied game to one side.
  if (result.winner !== "A" && result.winner !== "B") {
    return json({ error: `${sportId} simulation ended tied after overtime safety cap` }, 409);
  }
  if (!result.mvp?.player?.name) return json({ error: `${sportId} simulation produced no MVP` }, 500);

  const [{ data: profileA }, { data: profileB }, { data: profileRows }] = await Promise.all([
    admin.from("profiles").select("*").eq("id", match.player_a).single(),
    admin.from("profiles").select("*").eq("id", match.player_b).single(),
    admin.from("profiles").select("id, username").in("id", [match.player_a, match.player_b]),
  ]);
  if (!profileA || !profileB) return json({ error: "participant profile missing" }, 500);

  const usernameOf = (id: string) => profileRows?.find((p) => p.id === id)?.username || "Opponent";
  const eraId = match.era ?? "all";
  const exchange = match.is_friendly
    ? null
    : applyRatingExchange(profileA.sport_ratings, profileB.sport_ratings, sportId, result.winner === "A");
  const date = new Date().toISOString();

  const profileUpdateA = buildMatchOutcome(
    profileA,
    usernameOf(match.player_b),
    result.winner === "A",
    result.teamScoreA,
    result.teamScoreB,
    result.mvp.player.name,
    ownLinesFor(rosterA, result.boxA),
    sportEngine.statKeys,
    match.is_friendly,
    sportId,
    eraId,
    exchange?.a ?? null,
    {
      labelA: usernameOf(match.player_a),
      labelB: usernameOf(match.player_b),
      rosterA: snapshotRoster(rosterA),
      rosterB: snapshotRoster(rosterB),
      boxA: result.boxA,
      boxB: result.boxB,
      minutesA: match.rotation_a ?? null,
      minutesB: match.rotation_b ?? null,
    },
    date,
  );

  const profileUpdateB = buildMatchOutcome(
    profileB,
    usernameOf(match.player_a),
    result.winner === "B",
    result.teamScoreB,
    result.teamScoreA,
    result.mvp.player.name,
    ownLinesFor(rosterB, result.boxB),
    sportEngine.statKeys,
    match.is_friendly,
    sportId,
    eraId,
    exchange?.b ?? null,
    {
      labelA: usernameOf(match.player_b),
      labelB: usernameOf(match.player_a),
      rosterA: snapshotRoster(rosterB),
      rosterB: snapshotRoster(rosterA),
      boxA: result.boxB,
      boxB: result.boxA,
      minutesA: match.rotation_b ?? null,
      minutesB: match.rotation_a ?? null,
    },
    date,
  );

  // Common result columns stay common. Sport-owned presentation data travels
  // in game_data so football can replay its drive/event ledger while NBA keeps
  // using the period reveal it always has.
  const gameData = {
    drives: result.drives ?? null,
    teamStatsA: result.teamStatsA ?? null,
    teamStatsB: result.teamStatsB ?? null,
    coinToss: result.coinToss ?? null,
    analysis: result.analysis ?? null,
  };
  const engineVersion = `${sportId}-engine-2026-08-11.1`;
  const rulesVersion = `${match.game_mode || "ranked"}-rules-2026-08-11.1`;
  const datasetVersion = sportEngine.datasetVersion(playerRows);

  const { data: finalized, error: finalizeErr } = await admin.rpc("finalize_match_result", {
    p_match_id: matchId,
    p_result: {
      box_a: result.boxA,
      box_b: result.boxB,
      score_a: result.teamScoreA,
      score_b: result.teamScoreB,
      mvp: {
        name: result.mvp.player.name,
        side: result.mvp.side,
        line: result.mvp.line,
        score: result.mvp.score,
      },
      period_scores: result.quarterBoxScores,
      overtime_periods: result.overtimePeriods,
      game_data: gameData,
    },
    p_winner: result.winner,
    p_profile_a: profileUpdateA,
    p_profile_b: profileUpdateB,
    p_seed: seed,
    p_engine_version: engineVersion,
    p_dataset_version: datasetVersion,
    p_rules_version: rulesVersion,
  });

  if (finalizeErr) return json({ error: "failed to finalize result: " + finalizeErr.message }, 500);
  return json({
    status: "complete",
    winner: result.winner,
    scoreA: result.teamScoreA,
    scoreB: result.teamScoreB,
    result: finalized,
    simulationSeed: seed,
    engineVersion,
    datasetVersion,
    rulesVersion,
  });
});
