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

// Accounts are EMAIL + password, with a username on top for display.
//
// They didn't used to be. Sign-up took a username and a password, and the
// account was addressed by a synthetic `username@ballknowledge.app` address
// nobody could read. That worked right up until somebody forgot their
// password or got signed out on another device: there was no channel to send
// a reset to, so the account - record, badges, rank and all - was simply
// gone. An account you can't recover isn't an account.
//
// Legacy accounts still exist and still have to sign in, and their address is
// derivable from their username, so `signIn` accepts either: anything with an
// "@" is used as-is, anything without is treated as a legacy username and run
// through usernameToEmail(). Those players can attach a real email from the
// profile screen (see updateEmail) and become recoverable.
//
// IMPORTANT: password recovery requires the project's Site URL and redirect
// allow-list (Authentication > URL Configuration) to include wherever the
// game is served from, or Supabase will refuse to mail a link back to it.
const ACCOUNT_EMAIL_DOMAIN = "ballknowledge.app";

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
// Deliberately loose. Full RFC 5322 in a regex is a well-known way to reject
// real addresses; the only thing worth catching here is a typo obvious enough
// that no mail could ever arrive, and the confirmation mail is the real test.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${ACCOUNT_EMAIL_DOMAIN}`;
}

/** True for the synthetic addresses the old username-only sign-up minted -
 * an account that has one has no working recovery channel yet. */
export function isPlaceholderEmail(email) {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${ACCOUNT_EMAIL_DOMAIN}`);
}

/** The LEGACY mapping from a typed identifier to an address: an "@" means it
 * is one already, anything else becomes `username@ballknowledge.app`.
 *
 * Sign-in no longer uses this - see resolveSignInEmail, which looks up a
 * modern account's real address and falls back here. Password RESET still
 * does, and inherits the same limitation it always had in a sharper form:
 * resetting by username reaches a legacy account and, for an account created
 * with a real email, mails an address that does not exist. It cannot be fixed
 * the way sign-in was, because the fix there depends on being able to check
 * the password, and a password reset is what you ask for when you cannot.
 * Resetting by email address works for everyone; the caller warns about the
 * placeholder case. */
function resolveIdentifier(identifier) {
  const value = (identifier || "").trim();
  return value.includes("@") ? value.toLowerCase() : usernameToEmail(value);
}

/** Where Supabase should send a recovery link back to - this page, minus any
 * query or hash, so the returning link doesn't stack tokens onto an old one. */
function siteUrl() {
  return window.location.origin + window.location.pathname;
}

/**
 * Creates an account. The `handle_new_user` trigger on auth.users creates the
 * matching profiles row automatically, so there's no row to insert here.
 *
 * Returns { session, needsConfirmation }. A null session means the project has
 * email confirmation switched on - which is now a perfectly reasonable
 * configuration rather than a broken one, since the address is real, so the
 * caller says "check your inbox" instead of reporting a misconfiguration.
 */
export async function signUp(email, username, password) {
  const supabase = await getSupabase();

  // Asked BEFORE sign-up, because afterwards the reason is unrecoverable. The
  // server rejects a blocked username from a trigger on `profiles`, which fires
  // inside the handle_new_user trigger on auth.users - so the useful message
  // ("That username is reserved") is raised deep inside Supabase's own sign-up
  // transaction, and what reaches the browser is "Database error saving new
  // user". A player was told the site was broken when what happened was that
  // they picked a taken word.
  //
  // username_rejection_reason() is the same rule the trigger enforces, exposed
  // as a question instead of an exception, and is the one function anon is
  // granted (db/migrations/20260819_01) precisely so it can be asked here -
  // before there is a session to ask with.
  const rejection = await usernameRejectionReason(username);
  if (rejection) throw new Error(rejection);

  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { data: { username: username.trim() }, emailRedirectTo: siteUrl() },
  });
  if (error) throw new Error(translateAuthError(error));
  return { session: data.session, needsConfirmation: !data.session };
}

/**
 * Why a username would be refused, or null if it is fine.
 *
 * Returns null when the RPC itself cannot be reached - a server that has not
 * had the moderation migration applied has no opinion to offer, and blocking
 * sign-up on a missing function would be worse than the raw error this exists
 * to replace. The trigger is still the authority either way; this only decides
 * whether we can explain the refusal in advance.
 */
export async function usernameRejectionReason(username) {
  const name = (username || "").trim();
  if (!name) return null;
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc("username_rejection_reason", { p_username: name });
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

/** @param identifier an email address, or a legacy username. */
/**
 * The address to sign in with, given whatever was typed.
 *
 * An "@" means it is already an address. Anything else is a username, and a
 * username has TWO possible addresses behind it:
 *
 *   the real one, for every account created since sign-up started asking for
 *   an email - looked up through sign_in_email_for, which returns it only when
 *   the password also verifies (see the migration for why that matters);
 *
 *   the synthetic `username@ballknowledge.app`, for accounts old enough to
 *   predate that.
 *
 * The lookup is tried first and the synthetic address is the fallback, which
 * is also what happens when the server has no such function yet - client code
 * has to tolerate a server that has not caught up (CLAUDE.md), and here that
 * degrades to exactly the behaviour this replaces rather than to an error.
 *
 * This is the fix for "only email works". The old version mapped every
 * username to the synthetic address unconditionally, so a modern account's
 * username matched no user at all and came back as invalid credentials -
 * correct for legacy accounts, wrong for every account made since.
 */
async function resolveSignInEmail(supabase, identifier, password) {
  const value = (identifier || "").trim();
  if (value.includes("@")) return value.toLowerCase();

  try {
    const { data, error } = await supabase.rpc("sign_in_email_for", {
      p_username: value,
      p_password: password,
    });
    // A raised exception here is the throttle, and it carries a message the
    // player needs to see - "wait a few minutes" rather than "wrong password",
    // which is the message that makes someone reset a password that was fine.
    if (error && /too many sign-in attempts/i.test(error.message || "")) {
      throw new Error(error.message);
    }
    if (data) return String(data);
  } catch (e) {
    if (/too many sign-in attempts/i.test(e?.message || "")) throw e;
    // Anything else - the function not deployed yet, no network to the RPC -
    // falls through to the legacy address below. A username that IS a legacy
    // account still signs in; one that is not fails at signInWithPassword with
    // the same message it always did.
  }
  return usernameToEmail(value);
}

export async function signIn(identifier, password) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: await resolveSignInEmail(supabase, identifier, password),
    password,
  });
  if (error) throw new Error(translateAuthError(error));
  return data.session;
}

/** Mails a reset link. Deliberately resolves the same way sign-in does, so
 * "forgot password" works from a legacy username too - though for a legacy
 * account the mail goes to an address that doesn't exist, which is why the
 * caller warns about exactly that case. */
export async function requestPasswordReset(identifier) {
  const supabase = await getSupabase();
  const email = resolveIdentifier(identifier);
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: siteUrl() });
  if (error) throw new Error(translateAuthError(error));
  return { email, placeholder: isPlaceholderEmail(email) };
}

/** Sets a new password for the session in hand - either an ordinary signed-in
 * session, or the temporary one Supabase creates when a recovery link is
 * opened. */
export async function updatePassword(password) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(translateAuthError(error));
}

/** Attaches (or changes) the recovery address. Supabase mails a confirmation
 * link to the NEW address and only swaps it over once that's clicked, so this
 * returning successfully means "check your inbox", not "done". */
export async function updateEmail(email) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.updateUser(
    { email: email.trim().toLowerCase() },
    { emailRedirectTo: siteUrl() }
  );
  if (error) throw new Error(translateAuthError(error));
}

/** The signed-in user's auth record (id, email, ...), or null. */
export async function getAuthUser() {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Fires when Supabase decides the page was opened from a recovery link. The
 * URL hash carries the token; supabase-js consumes it on load and emits
 * PASSWORD_RECOVERY, which is the only reliable signal that the player is
 * here to set a new password rather than to sign in. */
export async function onPasswordRecovery(handler) {
  const supabase = await getSupabase();
  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") handler();
  });
}

/** Supabase phrases its errors in terms of an email address; that's now what
 * the screen asks for too, so most pass through - but a legacy username login
 * still has to read as one. */
function translateAuthError(error) {
  const message = error.message || "Something went wrong.";
  if (/already registered|already been registered|user already exists/i.test(message)) {
    return "There's already an account on that email. Sign in instead, or reset the password.";
  }
  if (/invalid login credentials/i.test(message)) {
    return "Wrong email/username or password.";
  }
  if (/password/i.test(message) && /short|least|weak/i.test(message)) {
    return "Password must be at least 6 characters.";
  }
  if (/email.*(not confirmed|not_confirmed)/i.test(message)) {
    return "Confirm your email first - check your inbox for the link.";
  }
  if (/invalid|email/i.test(message) && /format|valid/i.test(message)) {
    return "That doesn't look like a valid email address.";
  }
  if (/rate|too many/i.test(message)) {
    return "Too many attempts - wait a minute and try again.";
  }
  // The backstop for a server-side rule the client could not ask about first.
  // Supabase collapses ANY exception raised inside the sign-up transaction -
  // including the username moderation trigger's own readable message - into
  // this one string, so "database error" here almost never means the database
  // is broken. signUp() checks username_rejection_reason() up front to avoid
  // ever landing here; this covers the case where that check could not run.
  if (/database error (saving|creating)/i.test(message)) {
    return "Couldn't create that account. Try a different username - some are reserved or not allowed.";
  }

  // ANYTHING NOT RECOGNISED ABOVE DOES NOT REACH THE PLAYER VERBATIM.
  //
  // This used to `return message`, which put whatever Auth or Postgres said
  // straight on the sign-in screen. Every message the app deliberately shows is
  // handled above; what falls through here is by definition one nobody wrote
  // for a reader - a constraint name, a relation that does not exist, an
  // internal identifier - and those describe the schema to a stranger while
  // telling the player nothing they can act on.
  //
  // The real text still goes to the console, because the point is to stop
  // SHOWING it, not to stop knowing it. Anyone debugging a report has it in
  // front of them; anyone reading it in a screenshot does not.
  console.error("Unhandled auth error:", message);
  return "Something went wrong signing you in. Try again in a moment.";
}

export async function signOut() {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
