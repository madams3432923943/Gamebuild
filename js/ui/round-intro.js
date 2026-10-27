// "How a round works", once, at the top of a first draft's board.
//
// Testers who tapped NBA on the homepage landed on a draft board with a clock
// already running and nothing to say what a round was: a team and an era they
// had not chosen, a box to type into, and a bot they did not know was picking
// at the same time. Three short steps answer exactly that and nothing else -
// the longer how-to is on the homepage for anyone who wants it.
//
// A CARD ON THE BOARD, NOT A DIALOG. It sits above the search box, so a player
// can read it or ignore it and start typing; nothing waits on dismissing it.
// It goes on "Got it" or with the first pick (hideRoundIntro). A guest's first
// draft also has the long clock (FIRST_DRAFT_PICK_TIMER_SECONDS), which is what
// pays for the reading time.
//
// ONCE PER DEVICE, in localStorage. A guest has no profile to keep the flag on
// (signed-in onboarding uses profiles.has_seen_onboarding for its own panel),
// and a device that has seen this has seen it whoever is signed in. Storage
// that refuses (private mode, blocked site data) shows it again next time,
// which is the safe direction to fail in.

const SEEN_KEY = "dn_round_intro_seen";

function seen() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Refused: it shows again next draft. Nothing worse happens.
  }
}

/**
 * @param container the card's slot on the board (#round-intro)
 * @param opts.era the era in play, so the card can say what its chip means
 * @param opts.picks how many picks fill a roster in this sport
 * @param opts.rival who else picks, as the start of a sentence ("The bot")
 */
export function maybeShowRoundIntro(container, { era, picks, rival }) {
  if (seen()) return;
  markSeen();

  container.replaceChildren();
  const title = document.createElement("h3");
  title.className = "round-intro-title";
  title.textContent = "How a round works";

  const where = !era || era.id === "all" ? "any era" : `the ${era.label} era`;
  const steps = [
    ["You get a team.", `A random team from ${where}. You don't choose it.`],
    ["Name someone who played for it.", `Tap the name, then the season and position. ${rival} picks from the same team at the same time.`],
    ["Fill every slot.", `${picks} picks make your roster. Then set your strategy and watch the game.`],
  ];
  const list = document.createElement("ol");
  list.className = "round-intro-steps";
  for (const [lead, body] of steps) {
    const item = document.createElement("li");
    const strong = document.createElement("strong");
    strong.textContent = lead;
    item.append(strong, ` ${body}`);
    list.appendChild(item);
  }

  const done = document.createElement("button");
  done.type = "button";
  done.className = "link-btn round-intro-done";
  done.textContent = "Got it";
  done.addEventListener("click", () => hideRoundIntro(container));

  container.append(title, list, done);
  container.hidden = false;
}

export function hideRoundIntro(container) {
  container.hidden = true;
  container.replaceChildren();
}
