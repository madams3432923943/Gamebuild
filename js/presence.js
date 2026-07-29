// "N players online" ticker.
//
// Each open tab writes a heartbeat row every HEARTBEAT_MS and reads back the
// number of rows touched within PRESENCE_WINDOW_SECONDS. That window has to be
// comfortably longer than the heartbeat or a tab that is merely between beats
// would flicker out of the count.
//
// Deliberately a table plus two RPCs rather than a Supabase Realtime presence
// channel: Realtime presence state lives only for the lifetime of a websocket,
// so the count would reset whenever the connection dropped, and every client
// would carry a socket purely to render one number. A heartbeat row survives
// reconnects, costs one tiny write a minute, and lets the server define who
// counts as "online" in one place.
import { getSupabase } from "./supabaseClient.js";

// How often a tab announces itself.
export const HEARTBEAT_MS = 25000;
// How often the ticker re-reads the count. Slower than the heartbeat: the
// number moving every few seconds reads as noise, not liveness.
export const TICKER_REFRESH_MS = 30000;

let timer = null;
let stopped = false;

const CLIENT_ID_KEY = "bk_client_id";

/** A stable per-browser id. Presence has to count signed-out visitors too, so
 * it cannot key on the user id - and keying on something the client invents
 * is what makes one browser count once no matter how many times it beats. */
function clientId() {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() || `c_${Math.random().toString(36).slice(2)}${Date.now()}`);
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    // Private-mode browsers can refuse storage; a per-session id still counts
    // this tab correctly, it just won't be recognised on the next visit.
    return `c_${Math.random().toString(36).slice(2)}${Date.now()}`;
  }
}

/** One heartbeat + count read. Returns the count, or null if the round trip
 * failed - callers use null to mean "leave the ticker as it was". */
export async function beatAndCount() {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc("heartbeat_presence", { p_client_id: clientId() });
    if (error) throw error;
    // The RPC returns the post-write count, so one call does both jobs and a
    // tab is always included in the number it displays.
    return typeof data === "number" ? data : Number(data?.online) || null;
  } catch {
    return null;
  }
}

/**
 * Starts the heartbeat loop, calling `onCount(n)` whenever a fresh number
 * arrives. Never throws: the ticker is decoration, and a presence outage must
 * not stop anyone from playing. Returns a stop() function.
 */
export function startPresence(onCount) {
  stopped = false;

  const tick = async () => {
    if (stopped) return;
    const count = await beatAndCount();
    if (count !== null && !stopped) onCount(count);
    if (!stopped) timer = setTimeout(tick, Math.min(HEARTBEAT_MS, TICKER_REFRESH_MS));
  };
  tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
