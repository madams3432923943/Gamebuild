// First-party product analytics: did the player actually get through the game.
//
// WHAT THIS IS NOT. It is not a tracker. There is no page-view event, no
// scroll depth, no device fingerprint, no third party, and nothing leaves the
// Supabase project this app already talks to. The whole surface is the funnel
// the business needs to read - account created, welcome seen, sport chosen,
// draft finished, game played - plus two sponsor-placement counters.
//
// WHAT IT DELIBERATELY DOES NOT DUPLICATE. Online matches are already recorded
// authoritatively in `matches` and `match_results`, with their sport, their
// mode, both participants and their timestamps. Counting them again here would
// create a second number that can disagree with the first, so the admin
// aggregates read the match tables for online games and these events only for
// what no table records: the pre-match funnel, and PRACTICE games, which are
// simulated in the browser and have no match row at all.
//
// PRIVACY. The payload is filtered a second time server-side against a key
// allowlist (sanitize_event_props in db/migrations/20260911_02), because
// client-side validation is never sufficient by itself. Nothing here may carry
// an email address, a token, a username or a message - only facts about a
// game: which sport, which mode, which difficulty, won or lost.
//
// NOTHING HERE MAY EVER BREAK A GAME. Every call is fire-and-forget and every
// failure is swallowed to the console. A player whose network drops, whose
// session expired, or who is playing against a server that has not had the
// migration applied yet, plays exactly as before and loses only the metric.

import { getSupabase, getSession } from "./supabaseClient.js";

/** The events this app records. Mirrors public.analytics_event_types, which is
 * the authority: track_event() raises on a name that is not in the table, so a
 * typo here fails at the point it was introduced rather than quietly creating
 * a metric nobody can find. Adding one means a migration AND a line here. */
export const EVENTS = {
  SIGNUP_COMPLETED: "signup_completed",
  ONBOARDING_VIEWED: "onboarding_viewed",
  ONBOARDING_COMPLETED: "onboarding_completed",
  SPORT_SELECTED: "sport_selected",
  MODE_SELECTED: "mode_selected",
  PRACTICE_DIFFICULTY_SELECTED: "practice_difficulty_selected",
  DRAFT_STARTED: "draft_started",
  DRAFT_COMPLETED: "draft_completed",
  SIMULATION_STARTED: "simulation_started",
  GAME_COMPLETED: "game_completed",
  RANKED_QUEUE_JOINED: "ranked_queue_joined",
  RANKED_MATCH_FOUND: "ranked_match_found",
  RANKED_GAME_COMPLETED: "ranked_game_completed",
  FRIEND_ADDED: "friend_added",
  FRIEND_CHALLENGE_SENT: "friend_challenge_sent",
  FRIEND_GAME_COMPLETED: "friend_game_completed",
  SPONSOR_IMPRESSION: "sponsor_impression",
  SPONSOR_CLICK: "sponsor_click",
  SHARE_CARD_CREATED: "share_card_created",
  SHARE_CARD_SHARED: "share_card_shared",
};

/** The only keys that may be sent. The server enforces the same list; this
 * copy exists so a payload that would be stripped there is caught in the
 * console here, where whoever wrote it is looking. */
const ALLOWED_PROPS = new Set([
  "sport", "mode", "difficulty", "era", "won", "margin",
  "placement", "campaign", "format", "source", "step", "seconds",
]);

/** Keys already recorded once this page session - see trackOnce. */
const alreadyFired = new Set();

/** Scalars only, allowlisted keys only, and undefined/null dropped rather than
 * stored as an empty value. */
function cleanProps(props) {
  const out = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (!ALLOWED_PROPS.has(key)) {
      console.warn(`analytics: dropping unknown prop "${key}" - add it to ALLOWED_PROPS and sanitize_event_props, or don't send it.`);
      continue;
    }
    if (value === null || value === undefined) continue;
    const type = typeof value;
    if (type !== "string" && type !== "number" && type !== "boolean") {
      console.warn(`analytics: dropping non-scalar prop "${key}"`);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Records one event. Returns immediately; the write happens in the background.
 *
 * Deliberately not awaited by any caller. An event is a note about something
 * that already happened, so making a player wait for it - or letting it fail a
 * click handler - would be spending their game on our metric.
 */
export function track(event, props = {}) {
  void send(event, props);
}

/**
 * Records one event AT MOST ONCE per page session.
 *
 * This is the answer to the duplicate-event problem. A render is not an
 * action: a screen that re-renders when the profile reloads, a sponsor
 * placement that scrolls out of view and back, an onboarding modal reopened by
 * a stray call - each would otherwise inflate the metric by a factor nobody
 * can back out later. Funnel events are milestones, and a milestone happens
 * once.
 *
 * @param key what "the same thing" means. Defaults to the event name; pass
 *   something narrower when the event legitimately recurs for different
 *   subjects - one impression per placement per session, for instance, rather
 *   than one impression ever.
 */
export function trackOnce(event, props = {}, key = event) {
  if (alreadyFired.has(key)) return false;
  alreadyFired.add(key);
  void send(event, props);
  return true;
}

/** Whether trackOnce would still fire for this key. For a caller that has to
 * do real work (build an image, open a dialog) only if the event is new. */
export function firedAlready(key) {
  return alreadyFired.has(key);
}

async function send(event, props) {
  try {
    // No session means the sign-in screen, where track_event would raise
    // 42501. Nothing to record and nothing to report: a visitor who has not
    // signed in is not in the funnel yet.
    const session = await getSession();
    if (!session) return;
    const supabase = await getSupabase();
    const { error } = await supabase.rpc("track_event", {
      p_event: event,
      p_props: cleanProps(props),
    });
    // Logged, not thrown. CLAUDE.md forbids silent failures, and a console
    // error is the useful debugging information here - there is no recovery to
    // attempt and nothing to tell the player.
    if (error) console.error(`analytics: ${event} not recorded:`, error.message);
  } catch (e) {
    console.error(`analytics: ${event} not recorded:`, e?.message || e);
  }
}

/**
 * Marks today as an active day for this player - the whole of DAU/WAU/MAU.
 *
 * Called on app entry. The RPC is an idempotent upsert on (user_id, day), so
 * calling it twice in a session costs one no-op round trip; the localStorage
 * guard below saves even that, and is allowed to be wrong (a cleared store, a
 * private window) because the server is what actually deduplicates.
 */
export async function markActiveToday() {
  const today = new Date().toISOString().slice(0, 10);
  const key = "bk_active_day";
  try {
    if (localStorage.getItem(key) === today) return;
  } catch {
    // Storage refused. Fall through and let the server deduplicate.
  }
  try {
    const session = await getSession();
    if (!session) return;
    const supabase = await getSupabase();
    const { error } = await supabase.rpc("touch_active_day", {});
    if (error) {
      console.error("analytics: could not record today as active:", error.message);
      return;
    }
    try {
      localStorage.setItem(key, today);
    } catch {
      // Same as above - harmless, costs one extra upsert next time.
    }
  } catch (e) {
    console.error("analytics: could not record today as active:", e?.message || e);
  }
}
