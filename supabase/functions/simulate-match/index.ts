import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { computeDatasetStats, simulateGame } from "./engine.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const STAT_LABELS = ["pts", "reb", "ast", "stl", "blk"];

// Every response (including the CORS preflight) needs these, or the browser
// never gets past OPTIONS to send the real POST - which is exactly what was
// happening before this: the function only ever handled POST, so OPTIONS got
// a bare 405 with no CORS headers and every online simulation silently died
// at the preflight stage, before a single line of this file's logic ran.
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

/** players table rows come back with `numeric` columns as strings over the
 * wire - coerce to real numbers before they hit the scoring math. Shooting
 * fields are null for the 1960s/70s placeholder squads (no split ever
 * recorded for them), which Number() would turn into 0 - a false "this
 * player never misses" profile - so those stay null, exactly like the
 * client-side data that never had the fields at all. */
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

/** A stored roster_a/roster_b entry already carries every field submit_pick
 * wrote (see the submit_pick migration) - this just coerces the numeric
 * ones back from whatever jsonb round-tripped them as, for every slot the
 * roster actually has (5-slot Quick Play, 6-slot legacy, or Ranked's 10 -
 * nothing here assumes a shape, matching engine.js's own activeSlots()). */
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

const ownLinesFor = (roster: Record<string, any>, box: Record<string, any>) =>
  Object.keys(roster).map((slot) => ({ playerName: roster[slot].name, line: box[slot] }));

/** friendly (challenge-a-friend) matches always skip online_wins/
 * online_losses - "for fun" means not rank-affecting, and it closes off
 * the obvious two-friends-feed-each-other-wins abuse a ranked version of
 * this would invite. Career stats (personal bests, draft counts, history)
 * still record either way, same as they do for offline/practice games. */
async function applyMatchOutcome(
  admin: ReturnType<typeof createClient>,
  userId: string,
  opponentLabel: string,
  won: boolean,
  scoreFor: number,
  scoreAgainst: number,
  mvpName: string,
  ownLines: { playerName: string; line: Record<string, number> }[],
  friendly: boolean
) {
  const { data: profile, error } = await admin.from("profiles").select("*").eq("id", userId).single();
  if (error || !profile) return;

  const date = new Date().toISOString();
  const personalBests: Record<string, any> = { ...(profile.personal_bests || {}) };
  for (const key of STAT_LABELS) {
    for (const { playerName, line } of ownLines) {
      const value = line[key];
      const current = personalBests[key];
      if (!current || value > current.value) {
        personalBests[key] = { value, playerName, date };
      }
    }
  }

  const draftCounts: Record<string, number> = { ...(profile.draft_counts || {}) };
  for (const { playerName } of ownLines) {
    draftCounts[playerName] = (draftCounts[playerName] || 0) + 1;
  }

  const history = [
    { date, mode: friendly ? "friendly" : "online", won, opponentLabel, scoreFor, scoreAgainst, mvpName },
    ...(profile.history || []),
  ].slice(0, 50);

  const update: Record<string, unknown> = { personal_bests: personalBests, draft_counts: draftCounts, history };
  if (!friendly) {
    update.online_wins = profile.online_wins + (won ? 1 : 0);
    update.online_losses = profile.online_losses + (won ? 0 : 1);
  }

  await admin.from("profiles").update(update).eq("id", userId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let matchId: string | undefined;
  try {
    const body = await req.json();
    matchId = body.match_id;
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

  // Idempotent: a second caller (the other participant) just gets the
  // already-computed result instead of re-simulating.
  const { data: existing } = await admin.from("match_results").select("*").eq("match_id", matchId).maybeSingle();
  if (existing) {
    return json({ status: "complete", result: existing, winner: match.winner });
  }

  if (match.status !== "ready_to_simulate") {
    return json({ error: "match is not ready to simulate", status: match.status }, 409);
  }

  const { data: playerRows, error: playersErr } = await admin.from("players").select("*");
  if (playersErr || !playerRows) return json({ error: "failed to load player dataset" }, 500);

  const datasetStats = computeDatasetStats(playerRows.map(normalizePlayerRow));
  const rosterA = normalizeRoster(match.roster_a);
  const rosterB = normalizeRoster(match.roster_b);

  // Which slots the pick CLOCK filled rather than the player. The simulation
  // charges a real cost for these (FORFEIT_PLAYER_SCALE / FORFEIT_TEAM_PENALTY
  // in constants.js) - without it, an opponent who timed out on two picks was
  // still beating someone who made all ten. Read here rather than trusted from
  // the client for the obvious reason: nobody gets to declare their own
  // opponent's forfeits.
  const { data: pickRows } = await admin
    .from("match_picks")
    .select("side, slot, forfeited, action")
    .eq("match_id", matchId);
  const forfeitedSlots = (side: string) =>
    (pickRows ?? [])
      .filter((p) => p.side === side && p.action === "pick" && p.forfeited && p.slot)
      .map((p) => p.slot as string);
  // A roster slot nobody ever filled counts too. It can only happen when a
  // side had no legal pick and skipped, but a nine-man roster still gets the
  // full 240-minute budget spread across it, so without this it would be a
  // free pass rather than a cost.
  const unfilled = (roster: Record<string, any>, other: Record<string, any>) =>
    Object.keys(other).filter((slot) => !roster[slot]);
  const forfeitsA = [...forfeitedSlots("A"), ...unfilled(rosterA, rosterB)];
  const forfeitsB = [...forfeitedSlots("B"), ...unfilled(rosterB, rosterA)];

  // Each side's rotation/matchups/tactic, submitted via submit_strategy once
  // the draft was complete (see js/main.js's online strategy phase, which
  // runs the exact same startRotationPhase/startMatchupPhase/startTacticPhase
  // sequence offline Ranked Practice does). Undefined falls back inside
  // simulateGame to the same defaults offline uses when a mode skips a
  // phase, so an older/partial match can't crash a simulation.
  const result = simulateGame(rosterA, rosterB, datasetStats, {
    tacticA: match.tactic_a ?? undefined,
    tacticB: match.tactic_b ?? undefined,
    minutesA: match.rotation_a ?? undefined,
    minutesB: match.rotation_b ?? undefined,
    matchupsA: match.matchups_a ?? undefined,
    matchupsB: match.matchups_b ?? undefined,
    forfeitsA,
    forfeitsB,
  });

  const { error: insertErr } = await admin.from("match_results").insert({
    match_id: matchId,
    box_a: result.boxA,
    box_b: result.boxB,
    score_a: result.teamScoreA,
    score_b: result.teamScoreB,
    mvp: { name: result.mvp.player.name, side: result.mvp.side, line: result.mvp.line, score: result.mvp.score },
    period_scores: result.quarterBoxScores,
    overtime_periods: result.overtimePeriods,
  });
  if (insertErr) return json({ error: "failed to store result: " + insertErr.message }, 500);

  await admin
    .from("matches")
    .update({ status: "complete", winner: result.winner, updated_at: new Date().toISOString() })
    .eq("id", matchId);

  const { data: profileRows } = await admin
    .from("profiles")
    .select("id, username")
    .in("id", [match.player_a, match.player_b]);
  const usernameOf = (id: string) => profileRows?.find((p) => p.id === id)?.username || "Opponent";

  await applyMatchOutcome(
    admin,
    match.player_a,
    usernameOf(match.player_b),
    result.winner === "A",
    result.teamScoreA,
    result.teamScoreB,
    result.mvp.player.name,
    ownLinesFor(rosterA, result.boxA),
    match.is_friendly
  );
  await applyMatchOutcome(
    admin,
    match.player_b,
    usernameOf(match.player_a),
    result.winner === "B",
    result.teamScoreB,
    result.teamScoreA,
    result.mvp.player.name,
    ownLinesFor(rosterB, result.boxB),
    match.is_friendly
  );

  return json({ status: "complete", winner: result.winner, scoreA: result.teamScoreA, scoreB: result.teamScoreB });
});
