// Supabase project for online play. The publishable key is safe to ship in
// client code by design (it's the public anon-role key, not the service
// role key) - authorization is enforced server-side by RLS and the
// SECURITY DEFINER functions in the migrations, not by hiding this key.
//
// @supabase/supabase-js is loaded via a lazy dynamic import (from a CDN in
// the hosted/standalone build) rather than a static import, on purpose:
// a static `import ... from "@supabase/supabase-js"` fails the ENTIRE
// module graph if that fetch is slow or unreachable, which would take
// bot/local play down with it even though those modes never need the
// network. A dynamic import confines that failure to online-mode calls,
// which already handle rejected promises.
const SUPABASE_URL = "https://aauvgiygwrwdbtruhxta.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_yJtcNBYtXPcH-rS0is_8Sw_p8Z7967a";

let clientPromise = null;

export function getSupabase() {
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    );
  }
  return clientPromise;
}

/** Ensures there's a signed-in user, creating an anonymous session on first
 * use. The session persists in the browser (Supabase's own storage), so a
 * returning player keeps their profile without ever seeing a login screen. */
export async function ensureSession() {
  const supabase = await getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) return session;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.session;
}
