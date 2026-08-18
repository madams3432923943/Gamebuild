// HTML escaping, on its own with no imports.
//
// It lived in js/ui.js, which is fine for shared UI but not for a SPORT: a
// sport importing ui.js closes a cycle - js/sports/index.js loads the sport,
// the sport loads ui.js, and ui.js loads js/sports/index.js for activeSport().
// ES modules resolve that by leaving the registry's bindings uninitialised,
// so js/sports/index.js threw "Cannot access 'NFL' before initialization"
// before a single line of app code ran.
//
// A leaf module with no imports of its own cannot take part in a cycle, which
// is why this file is one and must stay one.

/** Escapes the four characters that can break out of markup or an attribute.
 *  Everything user-supplied - usernames, squad names, team labels - goes
 *  through here before it reaches innerHTML. */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
