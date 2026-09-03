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
// different clocks. `cache: "force-cache"` says so explicitly rather than
// leaving it to a heuristic.
//
// DELIBERATELY NOT VERSION-STAMPED. js/main.js carries ?v=<commit> because a
// stale module is a bug that survives a refresh; a stale DATASET cannot be,
// because a rebuilt dataset is a new file with a different length and
// js/lib/dataset-version.js already stamps every finished match with what it
// played on. Adding the commit here would throw away a 2MB cache entry on
// every deploy to protect against a case that is already detected.

/** Rows of one dataset, or a throw that says which one failed and why.
 *
 * NOT a silent empty array on failure. An empty pool renders as a sport with
 * no players rather than as a broken load, which is the exact "plausible wrong
 * answer" CLAUDE.md's rule about silent failures is about - and the caller
 * (each sport's preload) already turns a rejection into a retryable state.
 */
export async function fetchDataset(name) {
  // Relative to this module, so the app works from a sub-path - GitHub Pages
  // serves a project site from /<repo>/, and an absolute "/data/..." would
  // reach for the domain root and 404 there.
  const url = new URL(`../../data/${name}.json`, import.meta.url);

  // NODE READS THE FILE, and it has to, because these sport modules are not
  // browser-only. Every check that drives a real draft imports
  // js/sports/<id>/index.js and calls preload() - and Node's fetch does not
  // implement file:, so the first thing the conversion to JSON broke was the
  // verify suite, with "not implemented... yet..." from undici and nothing
  // saying which file it wanted.
  //
  // The import is inside the branch and specifier-guarded so a bundler or a
  // browser never has to resolve node:fs at all.
  if (url.protocol === "file:") {
    const { readFile } = await import(/* @vite-ignore */ "node:fs/promises");
    return JSON.parse(await readFile(url, "utf8"));
  }

  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Could not load ${name} (${response.status} ${response.statusText})`);
  }
  return response.json();
}
