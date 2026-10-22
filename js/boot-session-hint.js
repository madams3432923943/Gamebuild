// Runs in <head>, before the body is parsed: is there probably a session?
//
// The Quickplay landing is in the HTML unhidden, on purpose - it is the page a
// search engine and a visitor without JavaScript see, so it cannot wait for the
// app to decide to show it. But a returning player's boot takes a beat to
// confirm their session (supabase-js loads from a CDN), and without this they
// would watch the guest landing flash up before their home screen replaced it.
//
// So: if supabase-js has left a stored session here, mark the document and let
// CSS keep the landing out of the first paint. A HINT, not a decision. The
// stored token may be expired or revoked; js/main.js asks the real question and
// removes this mark if the answer is "guest". Wrong in the other direction
// costs nothing either - no hint just means the landing shows first, which is
// what happens today for a signed-out visitor anyway.
//
// A classic script, not a module, because a module is deferred and would run
// after the first paint it exists to affect. External rather than inline
// because the CSP allows no inline script without a hash.
//
// The key is supabase-js v2's default: sb-<project ref>-auth-token. The ref is
// the subdomain of SUPABASE_URL in js/supabaseClient.js.
(function () {
  try {
    if (localStorage.getItem("sb-aauvgiygwrwdbtruhxta-auth-token")) {
      document.documentElement.setAttribute("data-session-hint", "");
    }
  } catch (e) {
    // Storage refused: no hint, landing first. Nothing to report.
  }
})();
