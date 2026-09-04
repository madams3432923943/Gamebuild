// The "nothing here" line.
//
// Five lines, and shared by four screens that otherwise have nothing to do
// with each other - the draft pool's empty and error states, the badge grid,
// the banner grid and the friends list. It lives in its own module for exactly
// that reason: it was the one thing the squad screens still reached back into
// the draft board's half of js/ui.js for, and a shared primitive being defined
// beside one of its callers is what makes a file impossible to split later.

/** @param tierClass  optional extra class, e.g. "pool-error-note". */
export function renderNote(container, text, tierClass) {
  const note = document.createElement("div");
  note.className = "empty-note" + (tierClass ? ` ${tierClass}` : "");
  note.textContent = text;
  container.appendChild(note);
}
