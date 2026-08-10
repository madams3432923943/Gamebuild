import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { computeDatasetStats } from "./sports/nba/engine.js";
import { engineFor } from "./sports/index.ts";
import { applyRatingExchange } from "./rating.js";
import { normalizeSeed, withSeededMathRandom } from "./seeded-rng.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const ENGINE_VERSION = "nba-engine-2026-08-05.1";
const RULES_VERSION = "ranked-rules-2026-08-05.1";
const STAT_LABELS = ["pts", "reb", "ast", "stl", "blk"];
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

function normalizePlayerRow(p: Record<string, unknown>) {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    ...p,
    ppg: Number(p.ppg),
    rpg: Number(p.rpg),
    apg: Number(p.apg),
    spg: Number(p.spg),
    bpg: Number(p.bpg),
    tov: Number(p.tov),
    fga: num(p.fga),
    fgp: num(p.fgp),
    tpa: num(p.tpa),
    tpp: num(p.tpp),
    fta: num(p.fta),
    ftp: num(p.ftp),
  };
}

function normalizeRoster(roster: Record<string, any>) {
  const out: Record<string, any> = {};
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  for (const slot of Object.keys(roster || {})) {
    const p = roster[slot];
    if (!p) continue;
    out[slot] = {
      name: p.name,
      team: p.team,
      decade: p.decade,
      season: p.season ?? null,
      pos: p.pos,
      ppg: Number(p.ppg),
      rpg: Number(p.rpg),
      apg: Number(p.apg),
      spg: Number(p.spg),
      bpg: Number(p.bpg),
      tov: Number(p.tov),
      fga: num(p.fga),
      fgp: num(p.fgp),
      tpa: num(p.tpa),
      tpp: num(p.tpp),
      fta: num(p.fta),
      ftp: num(p.ftp),
    };
  }
  return out;
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
  Object.keys(roster).map((slot) => ({
    playerName: roster[slot].name,
    season: roster[slot].season ?? null,
    line: box[slot],
  }));

function snapshotRoster(roster: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [slot, player] of Object.entries(roster || {})) {
    if (player) {
      out[slot] = {
        name: (player as any).name,
        team: (player as any).team,
        decade: (player as any).decade,
        season: (player as any).season ?? null,
      };
    }
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
  friendly: boolean,
  sport: string,
  era: string,
  nextSportRatings: Record<string, any> | null,
  snapshot: Record<string, any> | null,
  date: string,
) {
  const key = (k: string) => (sport === "nba" ? k : `${sport}:${k}`);
  const game = snapshot
    ? { date, mode: friendly ? "friendly" : "online", era, opponentLabel, scoreFor, scoreAgainst, ...snapshot }
    : null;

  const personalBests: Record<string, any> = { ...(profile.personal_bests || {}) };
  for (const statKey of STAT_LABELS) {
    for (const { playerName, season, line } of ownLines) {
      const value = line[statKey];
      const current = personalBests[key(statKey)];
      if (!current || value > current.value) {
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
      // Stamped with the sport, exactly as the client does for practice games
      // (see recordPracticeResult). Without it an online football result lands
      // in the same undifferentiated list as a basketball one, and the profile
      // has no honest way to tell them apart afterwards.
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

function datasetVersion(playerRows: Record<string, any>[]) {
  let maxSeason = 0;
  for (const row of playerRows) maxSeason = Math.max(maxSeason, Number(row.season || 0));
  return `nba-players-${playerRows.length}-${maxSeason || "legacy"}`;
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

  const sportEngine = engineFor(match.sport);
  if (!sportEngine) return json({ error: `no server engine for sport '${match.sport}'` }, 501);

  const { data: playerRows, error: playersErr } = await admin.from(sportEngine.table).select("*");
  if (playersErr || !playerRows) return json({ error: "failed to load player dataset" }, 500);

  const rosterA = normalizeRoster(match.roster_a);
  const rosterB = normalizeRoster(match.roster_b);
  const datasetStats = computeDatasetStats(playerRows.map(normalizePlayerRow));

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
  const result = withSeededMathRandom(seed, () =>
    sportEngine.simulate(rosterA, rosterB, datasetStats, {
      tacticA: match.tactic_a ?? undefined,
      tacticB: match.tactic_b ?? undefined,
      minutesA: match.rotation_a ?? undefined,
      minutesB: match.rotation_b ?? undefined,
      matchupsA: match.matchups_a ?? undefined,
      matchupsB: match.matchups_b ?? undefined,
      forfeitsA,
      forfeitsB,
    })
  );

  const [{ data: profileA }, { data: profileB }, { data: profileRows }] = await Promise.all([
    admin.from("profiles").select("*").eq("id", match.player_a).single(),
    admin.from("profiles").select("*").eq("id", match.player_b).single(),
    admin.from("profiles").select("id, username").in("id", [match.player_a, match.player_b]),
  ]);
  if (!profileA || !profileB) return json({ error: "participant profile missing" }, 500);

  const usernameOf = (id: string) => profileRows?.find((p) => p.id === id)?.username || "Opponent";
  const sportId = match.sport ?? "nba";
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
    },
    p_winner: result.winner,
    p_profile_a: profileUpdateA,
    p_profile_b: profileUpdateB,
    p_seed: seed,
    p_engine_version: ENGINE_VERSION,
    p_dataset_version: datasetVersion(playerRows),
    p_rules_version: RULES_VERSION,
  });

  if (finalizeErr) return json({ error: "failed to finalize result: " + finalizeErr.message }, 500);
  return json({
    status: "complete",
    winner: result.winner,
    scoreA: result.teamScoreA,
    scoreB: result.teamScoreB,
    result: finalized,
    simulationSeed: seed,
    engineVersion: ENGINE_VERSION,
    datasetVersion: datasetVersion(playerRows),
    rulesVersion: RULES_VERSION,
  });
});
