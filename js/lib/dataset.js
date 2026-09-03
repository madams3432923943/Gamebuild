// Reading a dataset, in whichever runtime is asking.
//
// WHY FETCH AND NOT import()
//
// The datasets were ES modules exporting an array, reached with a dynamic
// `import()`. That works, and it makes the browser parse the file as
// JAVASCRIPT: 5.2MB of it for football, before a single name can be drafted.
// Measured on basketball's 2.3MB alone, the module import took 135ms against
// 29ms to JSON.parse the identical payload - 4.7x - and a phone's CPU widens
// that gap rather than closing it.
//
// A fetch is also cacheable on its own terms. A module reached through
// `import()` shares the app's cache lifetime; the datasets change when a
// season is added and the app changes several times a week, and those are
// different clocks.
//
// ORDINARY HTTP CACHING, NOT `cache: "force-cache"`. The first version of this
// file asked for force-cache, on the reasoning that a 2MB file should not be
// re-fetched. force-cache does more than that: it serves a stored response
// REGARDLESS of whether it has gone stale, so a player who had loaded the
// dataset once would never see a new season - their pool would be frozen, and
// every match they played would be stamped with a dataset_version the server
// no longer agrees with, which reads as drift. The note that talked me past it
// said a stale dataset "cannot be a silent bug" because dataset-version.js
// stamps every finished match; that is an argument about DETECTING the problem
// and says nothing about the player still having it.
//
// The default is right and costs almost nothing. Pages serves these with an
// ETag, so a revalidation is one conditional request and a 304; the 2MB body
// only crosses the wire when the file has actually changed, which is the
// behaviour force-cache was reaching for without the part that breaks.
//
// DELIBERATELY NOT VERSION-STAMPED. js/main.js carries ?v=<commit> because a
// stale module is a bug that survives a refresh, and the app changes several
// times a week. A dataset changes when a season is added, so stamping it with
// the COMMIT would throw away a 2MB cache entry on every unrelated deploy.
// Revalidation covers the case the stamp would: the ETag changes when the file
// does, and not before.

/** Rows of one dataset, or a throw that says which one failed and why.
 *
 * NOT a silent empty array on failure. An empty pool renders as a sport with
 * no players rather than as a broken load, which is the exact "plausible wrong
 * answer" CLAUDE.md's rule about silent failures is about - and the caller
 * (each sport's preload) already turns a rejection into a retryable state.
 */
export async function fetchDataset(name) {
  // NODE READS THE FILE, and it has to, because these sport modules are not
  // browser-only: every check that drives a real draft imports
  // js/sports/<id>/index.js and calls preload(). The first thing the
  // conversion to JSON broke was the verify suite, with "not implemented...
  // yet..." from undici, because Node's fetch does not do file: URLs.
  //
  // It DELEGATES rather than reading the file itself. data/load.mjs already
  // knows where the datasets live and caches them per process, and having two
  // answers to "how does Node read a dataset" is how the two drift.
  //
  // THE SPECIFIER IS BUILT AT RUNTIME ON PURPOSE. `npm run bundle` compiles
  // this app with esbuild as a browser iife, and a literal import of a Node
  // path is a hard resolve error there - "Could not resolve node:fs/promises",
  // which is exactly how CI caught the first version of this file. A computed
  // specifier is left alone by the bundler and resolved at runtime, which is
  // the honest description of what it is: a branch only Node ever takes.
  if (typeof document === "undefined") {
    const { loadDataset } = await import(["..", "..", "data", "load.mjs"].join("/"));
    return loadDataset(name);
  }

  // WHICH BASE, and both answers are needed because the app is loaded two ways.
  //
  // As MODULES - the real site, and the test harnesses - the right base is this
  // file, because a harness page lives in scripts/selftest/ and a
  // document-relative "data/..." would look for it beside the harness. That is
  // not hypothetical: it is how the ranked-search harness 404'd when this
  // resolved against document.baseURI only.
  //
  // BUNDLED, as `npm run bundle` builds it, `import.meta` is empty - esbuild
  // says so out loud for an iife - so there is no module URL to be relative to
  // and the document is the only base there is. The bundle is loaded from the
  // site root, where "data/..." is correct.
  //
  // Neither absolute: GitHub Pages serves a project site from /<repo>/, so a
  // leading slash reaches for the domain root and 404s there.
  const moduleUrl = import.meta?.url;
  const url = moduleUrl
    ? new URL(`../../data/${name}.json`, moduleUrl)
    : new URL(`data/${name}.json`, document.baseURI);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${name} (${response.status} ${response.statusText})`);
  }
  return response.json();
}
