// The private admin dashboard.
//
// AUTHORIZATION IS NOT HERE. This file cannot enforce anything: it is a static
// module on a static host, anyone can fetch it, read it, and call whatever it
// calls. Every number on the page comes from admin_overview() or
// admin_funnel(), both SECURITY DEFINER functions that ask is_admin() first
// and raise 42501 otherwise (db/migrations/20260911_03_admin_dashboard.sql).
// So a normal signed-in player who opens admin.html sees a refusal, and one
// who calls the RPC by hand gets the same refusal - which is the point. The
// is_admin() call below exists to choose which SCREEN to draw, not to decide
// who is allowed: if it were bypassed, the next call would still fail.
//
// NO TABLES ARE DOWNLOADED. CLAUDE.md is explicit about this and it is the
// difference between a dashboard that stays fast and one that stops working at
// ten thousand players: the two RPCs return one jsonb document each, computed
// in Postgres against indexes. This page transfers a few hundred bytes no
// matter how much data is behind it.
//
// THE SESSION IS THE GAME'S SESSION. Same origin, so supabase-js finds the
// same persisted session localStorage already holds. There is deliberately no
// sign-in form here - a second auth surface is a second thing to get wrong,
// and "sign in on the game first" is one sentence.

import { getSupabase, getSession } from "../supabaseClient.js";
import { renderDashboard } from "./render.js";

const statusEl = document.getElementById("admin-status");
const bodyEl = document.getElementById("admin-body");
const generatedEl = document.getElementById("admin-generated");
const refreshBtn = document.getElementById("admin-refresh");

function setStatus(message, kind = "") {
  statusEl.textContent = message || "";
  statusEl.hidden = !message;
  statusEl.className = `admin-status${kind ? ` admin-status-${kind}` : ""}`;
}

async function load() {
  setStatus("Checking your access…");
  bodyEl.hidden = true;
  refreshBtn.disabled = true;

  try {
    const session = await getSession();
    if (!session) {
      setStatus("You're not signed in. Sign in on Draft Nova first, then come back to this page.", "error");
      return;
    }

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
