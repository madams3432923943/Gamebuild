// Supabase project for online play. The publishable key is safe to ship in
// client code by design (it's the public anon-role key, not the service
// role key) - authorization is enforced server-side by RLS and the
// SECURITY DEFINER functions in the migrations, not by hiding this key.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://aauvgiygwrwdbtruhxta.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_yJtcNBYtXPcH-rS0is_8Sw_p8Z7967a";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

/** Ensures there's a signed-in user, creating an anonymous session on first
 * use. The session persists in the browser (Supabase's own storage), so a
 * returning player keeps their profile without ever seeing a login screen. */
export async function ensureSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) return session;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.session;
}
