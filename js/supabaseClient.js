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

/** The current signed-in session, or null. Supabase persists this in browser
 * storage, so a returning player stays signed in across visits. */
export async function getSession() {
  const supabase = await getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

/** The session for an action that requires a signed-in user. Throws rather
 * than silently creating one - every caller here runs behind the auth gate,
 * so reaching this without a session is a bug worth surfacing. */
export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("You need to be signed in to do that.");
  return session;
}

/**
 * Creates an account. The `handle_new_user` trigger on auth.users creates the
 * matching profiles row automatically, so there's no row to insert here.
 * Returns the session, or null when the project requires email confirmation
 * (in which case the account exists but can't act until the link is clicked).
 */
export async function signUp(email, password) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signIn(email, password) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
