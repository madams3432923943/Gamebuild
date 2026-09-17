// Which build this browser is actually running.
//
// Read off the entry script's own cache-busting query (tools/stamp-build.mjs),
// which is the only place the page knows it. It lived in main.js as a private
// helper for the Settings sheet until feedback needed the same answer - "what
// version are you on?" is the first question any bug report has to carry, and
// a second copy of the reader is how the two would come to disagree.
//
// Falls back to "dev" for a checkout served without a stamp, which is the
// honest answer rather than a blank.
export function buildStamp() {
  if (typeof document === "undefined") return "dev";
  const src = document.querySelector('script[src*="js/main.js"]')?.getAttribute("src") || "";
  return new URLSearchParams(src.split("?")[1] || "").get("v") || "dev";
}
