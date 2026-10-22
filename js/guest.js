// Guest play: a practice game with no account behind it.
//
// The homepage is Quickplay. A visitor taps NBA or NFL and is drafting against
// the bot with no sign-up in the way; the offer to make an account comes AFTER
// the first game, on the results screen. This module is everything that is
// different about such a game, so main.js asks it one question - isGuest() -
// rather than re-deriving "is there a session" in each of the places that care.
//
// WHERE A GUEST GAME GOES. Two places, for two different readers:
//
//   1. The server's guest_games table, through record_guest_game() - a
//      summary (sport, difficulty, era, score, won) for the funnel: how many
//      guest games, which sport, and how many of those browsers went on to
//      make an account. It never touches `profiles`, `analytics_events` or
//      `active_days`, so a guest cannot appear in a user count, DAU, a
//      leaderboard or friend search. See db/migrations/20261022_01_guest_games.sql.
//   2. This browser's localStorage - the FULL result, in exactly the shape
//      recordPracticeResult() takes, so that when the guest does sign up or
//      sign in, carryOverGuestGames() replays it onto their own profile and it
//      is in their history, records and badges as if they had been signed in.
//
// WHY NOT SUPABASE ANONYMOUS AUTH. It creates an auth.users row, and the
// on_auth_user_created trigger turns every auth user into a `profiles` row
// named "Player" - a real-looking user in every count this app has. Guests
// need to be nobody, not somebody anonymous.
//
// NOTHING HERE MAY BREAK A GAME. Every network call is fire-and-forget or
// caught; storage that refuses (private mode) loses only the carry-over.

import { getSupabase } from "./supabaseClient.js";
import { recordPracticeResult, recordDraftPicks, snapshotRoster } from "./profile.js";

const GAMES_KEY = "dn_guest_games";
const TOKEN_KEY = "dn_guest_claim";

// Enough for an evening of play before signing up, few enough that the store
// stays small: each entry is a snapshot of two rosters and two box scores.
const MAX_STORED_GAMES = 5;

let guest = false;

/** Whether the app is running without an account right now. Set on boot when
 * there is no session, cleared the moment one exists. */
export function isGuest() {
  return guest;
}

export function setGuest(value) {
  guest = !!value;
}

// ---- The claim token -------------------------------------------------------
//
// 32 random bytes, base64url. The server stores only its SHA-256, and claiming
// a browser's guest games requires presenting the token itself - see
// claim_guest_games(). Created lazily on the first guest game, so a visitor who
// only reads the landing page leaves nothing behind.

function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readToken({ create = false } = {}) {
  try {
    let token = localStorage.getItem(TOKEN_KEY);
    if (!token && create) {
      token = newToken();
      localStorage.setItem(TOKEN_KEY, token);
    }
    return token;
  } catch {
    // Storage refused. A token that cannot be kept cannot be claimed later, so
    // a one-off is still worth sending - the game still counts as a guest game.
    return create ? newToken() : null;
  }
}

// ---- Local copy ------------------------------------------------------------

/** The guest games this browser is holding for carry-over, oldest first. */
export function pendingGuestGames() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GAMES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePending(games) {
  try {
    if (games.length) localStorage.setItem(GAMES_KEY, JSON.stringify(games));
    else localStorage.removeItem(GAMES_KEY);
  } catch (e) {
    // Full or refused. The game was still played and still counted; only the
    // carry-over to a future account is lost, and that is worth saying.
    console.error("guest: could not keep this game for your account:", e?.message || e);
  }
}

/**
 * Records a finished guest game: the local copy for carry-over, and the
 * summary for the server. Returns immediately.
 *
 * @param practiceResult exactly the argument recordPracticeResult() takes.
 *   Rosters are snapshotted here so the stored copy is names, teams and
 *   decades rather than every season of every player drafted.
 * @param draftPicks the names drafted onto the guest's own roster, for
 *   recordDraftPicks().
 */
export function recordGuestGame({ practiceResult, draftPicks, difficulty }) {
  const stored = {
    savedAt: new Date().toISOString(),
    practiceResult: {
      ...practiceResult,
      date: new Date().toISOString(),
      rosterA: practiceResult.rosterA && snapshotRoster(practiceResult.rosterA),
      rosterB: practiceResult.rosterB && snapshotRoster(practiceResult.rosterB),
    },
    draftPicks,
  };
  // Newest last, oldest dropped first: the games a player remembers playing
  // just before signing up are the ones that should arrive in their history.
  writePending([...pendingGuestGames(), stored].slice(-MAX_STORED_GAMES));

  void sendGuestGame({
    sport: practiceResult.sport,
    difficulty,
    era: practiceResult.era,
    won: practiceResult.won,
    scoreFor: practiceResult.scoreFor,
    scoreAgainst: practiceResult.scoreAgainst,
  });
}

// One line per failure kind, not one per game: a server that has not had the
// migration applied yet would otherwise log the same "function not found"
// after every game for every guest.
const reported = new Set();
function reportOnce(kind, message) {
  if (reported.has(kind)) return;
  reported.add(kind);
  console.error(`guest: ${message}`);
}

async function sendGuestGame({ sport, difficulty, era, won, scoreFor, scoreAgainst }) {
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc("record_guest_game", {
      p_sport: sport,
      p_difficulty: difficulty || null,
      p_era: era,
      p_won: !!won,
      p_score_for: Math.round(scoreFor),
      p_score_against: Math.round(scoreAgainst),
      p_claim_token: readToken({ create: true }),
    });
    if (error) reportOnce("record", `game not counted: ${error.message}`);
  } catch (e) {
    reportOnce("record", `game not counted: ${e?.message || e}`);
  }
}

// ---- Carry-over --------------------------------------------------------------

let carrying = null;

/**
 * Moves this browser's guest games onto the account that just signed in, then
 * forgets them. Called once on every app entry; a no-op when there is nothing
 * pending, which is almost always.
 *
 * ORDER MATTERS. The local copy is cleared only after every game has been
 * written to the profile, so a failure part-way leaves the rest to retry on the
 * next entry rather than losing them. Each game that DID land is removed as it
 * lands, so a retry cannot write it twice.
 *
 * The server-side claim runs last and its failure is logged, not fatal: it
 * marks the funnel row converted, which is our metric, not the player's game.
 *
 * Returns how many games were carried over.
 */
export function carryOverGuestGames() {
  // Concurrent entries (a sign-in racing a session restore) share one run.
  if (!carrying) carrying = runCarryOver().finally(() => (carrying = null));
  return carrying;
}

async function runCarryOver() {
  let pending = pendingGuestGames();
  if (!pending.length) {
    await claimGuestGames();
    return 0;
  }
  let carried = 0;
  while (pending.length) {
    const [next, ...rest] = pending;
    try {
      await recordPracticeResult(next.practiceResult);
      if (next.draftPicks?.length) await recordDraftPicks(next.draftPicks, next.practiceResult.sport);
    } catch (e) {
      console.error("guest: could not carry a guest game over to this account; will retry next visit:", e);
      return carried;
    }
    pending = rest;
    writePending(pending);
    carried += 1;
  }
  await claimGuestGames();
  return carried;
}

async function claimGuestGames() {
  const token = readToken();
  if (!token) return;
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc("claim_guest_games", { p_claim_token: token });
    if (error) {
      reportOnce("claim", `could not mark guest games as converted: ${error.message}`);
      return;
    }
    // Claimed: a token whose games now belong to an account has done its job,
    // and keeping it would let the NEXT guest on this browser's games be
    // claimed by this account on its next sign-in.
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Refused storage never had a token to remove.
    }
  } catch (e) {
    reportOnce("claim", `could not mark guest games as converted: ${e?.message || e}`);
  }
}
