// Where a player first came from, kept until they have an account to keep it on.
//
// Nothing recorded this before: a sign-up arrived with no idea whether it came
// from a shared result, a search, or a link in a group chat. The first landing's
// UTM tags and referrer are kept in localStorage on the very first visit, and
// saved once - first write wins, on the server too - when an account exists.
//
// THE REFERRER HOST ONLY. A full referrer URL can carry a search query or a
// token, and "news.ycombinator.com" answers the question without either. The
// landing path is the pathname, never the query string.
//
// Storage that refuses (private mode) means no source is kept; nothing else is
// affected. A server without set_first_visit_source yet (the migration lands by
// hand) leaves the stored source in place to try again on the next app entry.

import { getSupabase } from "./supabaseClient.js";

const KEY = "dn_first_visit";

/** Called on every boot; only the first one on a device writes. */
export function captureFirstVisit() {
  try {
    if (localStorage.getItem(KEY)) return;
    const params = new URLSearchParams(location.search);
    let referrerHost = null;
    try {
      const ref = document.referrer ? new URL(document.referrer) : null;
      // Our own pages are not a source.
      if (ref && ref.host && ref.host !== location.host) referrerHost = ref.host;
    } catch {
      referrerHost = null;
    }
    localStorage.setItem(
      KEY,
      JSON.stringify({
        utmSource: params.get("utm_source"),
        utmMedium: params.get("utm_medium"),
        utmCampaign: params.get("utm_campaign"),
        referrerHost,
        landingPath: location.pathname,
        firstSeenAt: new Date().toISOString(),
        saved: false,
      })
    );
  } catch {
    // Storage refused. Nothing to keep, nothing to report.
  }
}

let reportedFailure = false;

/** Called on app entry with a session. Sends the stored source once. */
export async function saveFirstVisitSource() {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return;
  }
  if (!stored || stored.saved) return;
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc("set_first_visit_source", {
      p_utm_source: stored.utmSource || null,
      p_utm_medium: stored.utmMedium || null,
      p_utm_campaign: stored.utmCampaign || null,
      p_referrer_host: stored.referrerHost || null,
      p_landing_path: stored.landingPath || null,
      p_first_seen_at: stored.firstSeenAt || null,
    });
    if (error) throw new Error(error.message);
    // Saved, or the account already had a source (first write wins). Either
    // way this device has nothing more to send.
    localStorage.setItem(KEY, JSON.stringify({ ...stored, saved: true }));
  } catch (e) {
    if (!reportedFailure) {
      reportedFailure = true;
      console.error("first-visit: source not saved yet, will retry next visit:", e?.message || e);
    }
  }
}
