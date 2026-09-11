// The private admin dashboard.
//
// AUTHORIZATION IS NOT HERE. This file cannot enforce anything: it is a static
// module, anyone can fetch it, read it, and call whatever it calls. Every
// number on the page comes from admin_overview() or admin_funnel(), both
// SECURITY DEFINER functions that ask is_admin() first and raise 42501
// otherwise (db/migrations/20260911_03_admin_dashboard.sql). So a normal
// signed-in player who opens this page sees a refusal, and one who calls the
// RPC by hand gets the same refusal - which is the point. The is_admin() call
// below exists to choose which SCREEN to draw, not to decide who is allowed:
// if it were bypassed, the next call would still fail.
//
// IT IS NOT PART OF THE WEBSITE. The page lives at tools/admin/index.html and
// is opened with `npm run admin`, which serves the repo on 127.0.0.1. There is
// no admin page among draftnovagame.com's own pages and nothing links to one.
//
// NO TABLES ARE DOWNLOADED. CLAUDE.md is explicit about this and it is the
// difference between a dashboard that stays fast and one that stops working at
// ten thousand players: the two RPCs return one jsonb document each, computed
// in Postgres against indexes. This page transfers a few hundred bytes no
// matter how much data is behind it.
//
// IT HAS ITS OWN SIGN-IN, and it has to. This page is served from
// 127.0.0.1 by `npm run admin`; the game is served from draftnovagame.com.
// Those are different origins and localStorage does not cross one, so
// supabase-js finds no session here however recently you signed in over
// there. An earlier version told the reader to "sign in on the game first",
// which was advice that could not work.
//
// Signing in buys nothing on its own: the data still comes from functions
// that check is_admin(), so an ordinary player who signs in here gets the
// same refusal they would get by calling the RPC by hand.

import { getSupabase, getSession, signIn } from "../supabaseClient.js";
import { renderDashboard } from "./render.js";

const statusEl = document.getElementById("admin-status");
const bodyEl = document.getElementById("admin-body");
const generatedEl = document.getElementById("admin-generated");
const refreshBtn = document.getElementById("admin-refresh");
const signInForm = document.getElementById("admin-signin");
const signInError = document.getElementById("admin-signin-error");
const signInSubmit = document.getElementById("admin-signin-submit");

function setStatus(message, kind = "") {
  statusEl.textContent = message || "";
  statusEl.hidden = !message;
  statusEl.className = `admin-status${kind ? ` admin-status-${kind}` : ""}`;
}

function showSignIn(message) {
  signInForm.hidden = false;
  setStatus(message || "");
  bodyEl.hidden = true;
}

signInForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  signInError.hidden = true;
  signInSubmit.disabled = true;
  signInSubmit.textContent = "Signing in…";
  try {
    await signIn(document.getElementById("admin-email").value.trim(), document.getElementById("admin-password").value);
    document.getElementById("admin-password").value = "";
    signInForm.hidden = true;
    await load();
  } catch (err) {
    // The message comes from translateAuthError in js/supabaseClient.js, which
    // already refuses to put a raw Postgres or Auth string in front of a
    // reader - the same treatment the game's own sign-in screen gets.
    signInError.textContent = err.message || "That didn't work.";
    signInError.hidden = false;
  } finally {
    signInSubmit.disabled = false;
    signInSubmit.textContent = "Sign in";
  }
});

async function load() {
  setStatus("Checking your access…");
  bodyEl.hidden = true;
  refreshBtn.disabled = true;

  try {
    const session = await getSession();
    if (!session) {
      showSignIn("");
      return;
    }
    signInForm.hidden = true;

    const supabase = await getSupabase();

    // Asked so the page can say "you are not an administrator" instead of
    // showing a permission error from a function call the reader did not make.
    // is_admin() reveals only the caller's own status.
    const { data: admin, error: adminError } = await supabase.rpc("is_admin", {});
    if (adminError) {
      // A server that has not had the migration applied yet reads as "no
      // dashboard", not as a crash - the same tolerance the rest of the app
      // has for a database behind the client.
      console.error("is_admin() failed:", adminError.message);
      setStatus("Couldn't check your access. The dashboard may not be deployed on this project yet.", "error");
      return;
    }
    if (!admin) {
      setStatus("This account isn't an administrator. Nothing here is available to it.", "error");
      return;
    }

    // Both in flight at once: they read different tables and neither needs the
    // other's answer.
    const [overviewRes, funnelRes] = await Promise.all([
      supabase.rpc("admin_overview", {}),
      supabase.rpc("admin_funnel", { p_days: 30 }),
    ]);

    if (overviewRes.error) throw new Error(overviewRes.error.message);
    // The funnel is the less important half, so a failure there costs the
    // funnel section rather than the whole page.
    if (funnelRes.error) console.error("admin_funnel() failed:", funnelRes.error.message);

    renderDashboard(bodyEl, overviewRes.data, funnelRes.error ? null : funnelRes.data);
    bodyEl.hidden = false;
    setStatus("");
    const generated = overviewRes.data?.generated_at;
    generatedEl.textContent = generated ? `as of ${new Date(generated).toLocaleString()}` : "";
  } catch (e) {
    console.error("Dashboard failed to load:", e);
    setStatus(`Couldn't load the dashboard: ${e.message || e}`, "error");
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", load);
load();
