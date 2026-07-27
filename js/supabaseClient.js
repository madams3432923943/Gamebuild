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

// Accounts are username + password - players never see or need an email.
// Supabase Auth is still doing the real work (password hashing, sessions,
// refresh tokens); we just address each account by a synthetic email derived
// from the username. Nothing is ever sent to these addresses.
//
// Two useful properties fall out of this: Supabase's own unique-email
// constraint gives us unique usernames for free, and lowercasing the local
// part makes usernames case-insensitive for login while `profiles.username`
// still stores the display casing the player typed.
//
// IMPORTANT: this requires "Confirm email" to be OFF for the project
// (Authentication > Sign In / Providers > Email). With it on, Supabase tries
// to mail a confirmation link to an address nobody can read, and the account
// can never be used.
const ACCOUNT_EMAIL_DOMAIN = "ballknowledge.app";

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

export function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${ACCOUNT_EMAIL_DOMAIN}`;
}

/**
 * Creates an account. The `handle_new_user` trigger on auth.users creates the
 * matching profiles row automatically, so there's no row to insert here.
 * Returns the session, or null if the project still has email confirmation
 * enabled (see the note above - that configuration can't work here).
 */
export async function signUp(username, password) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: usernameToEmail(username),
    password,
  });
  if (error) throw new Error(translateAuthError(error));
  return data.session;
}

export async function signIn(username, password) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  if (error) throw new Error(translateAuthError(error));
  return data.session;
}

/** Supabase phrases its errors in terms of the email we invented, which would
 * be baffling on a screen that only ever mentions usernames. */
function translateAuthError(error) {
  const message = error.message || "Something went wrong.";
  if (/already registered|already been registered|user already exists/i.test(message)) {
    return "That username is taken. Try another one.";
  }
  if (/invalid login credentials/i.test(message)) {
    return "Wrong username or password.";
  }
  if (/password/i.test(message) && /short|least|weak/i.test(message)) {
    return "Password must be at least 6 characters.";
  }
  if (/invalid|email/i.test(message) && /format|valid/i.test(message)) {
    return "That username can't be used. Stick to letters, numbers and underscores.";
  }
  return message;
}

export async function signOut() {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
