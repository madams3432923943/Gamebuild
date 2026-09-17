// The first thing a brand-new account sees: twenty seconds on what Draft Nova
// is, where to tell us when it goes wrong, and a button into a game.
//
// WHY IT IS SHORT. The alternative - a multi-screen tutorial with a progress
// dots row - is the thing people close. Everything here is visible in one
// scroll: what the game is, the five steps of a match, what the modes are, and
// one call to action. A player who reads none of it and taps Start Playing has
// lost nothing; a player who reads it knows what a "draft pool" is before the
// clock starts.
//
// TWO PANELS NOW, AND THE SECOND ONE IS THE WHOLE REASON THIS FILE GREW. A
// feedback button nobody can find is a feedback button nobody presses, and the
// gear it lives behind is a 44px glyph in the corner of the busiest screen in
// the app. So the moment after a new player has been told what the game is -
// and before they are dropped into it - the gear is pointed at, named, and
// explained in one sentence.
//
// It is a SECOND PANEL IN THIS SEQUENCE and not a tutorial system of its own.
// A separate coach-mark framework would be a second modal, a second set of
// Escape rules and a second flag to keep in step with has_seen_onboarding -
// four things to drift apart in order to show one sentence. Here it is a
// different body node in the dialog that is already open.
//
// IT DOES NOT BLOCK ANYTHING. The panel is dismissible by every route the
// shared modal already offers (the x, Escape, the backdrop), the spotlight is
// cleaned up on all of them, and skipping it costs the player nothing - the
// gear is still there afterwards and still does the same thing.
//
// WHY IT USES THE SHARED MODAL. js/shell.js already owns the one dialog in
// this app: its backdrop, its Escape handling, its close button and (since
// this sprint) its focus trap and focus restore. A welcome modal with its own
// overlay would be a second set of those rules to drift apart, and CLAUDE.md
// is explicit that shared UI is not duplicated.
//
// ONCE MEANS ONCE PER ACCOUNT, NOT PER BROWSER. The flag lives on the profile
// (profiles.has_seen_onboarding), so it follows the account to a phone and
// survives a cleared cache. See db/migrations/20260911_01_onboarding_state.sql
// for the backfill that keeps existing players out of it.

import { openModal, closeModal } from "./shell.js";
import { markOnboardingSeen } from "./profile.js";
import { track, EVENTS } from "./analytics.js";

/**
 * The five steps of a match, in the order they happen. Data rather than markup
 * so the list reads as a list and the numbering cannot drift out of step with
 * the copy - which is exactly the sort of thing that gets edited in one place.
 */
const STEPS = [
  ["Choose your sport", "Play NBA or NFL."],
  ["Draft from memory", "You'll be given an era, a team or a draft pool, and you choose your players."],
  ["Build your team", "Fill every required position and use your sports knowledge to build the best roster."],
  ["Set your strategy", "Choose how you want your team to play."],
  ["Watch it play out", "Your completed roster is simulated against your opponent."],
];

/** The two modes, said the way the Play screen says them. Practice carries its
 * three difficulties because "which difficulty" is the first question a new
 * player has, and the Play screen asks it before they know the answer. */
const MODES = [
  {
    name: "Practice",
    blurb: "Play the bot.",
    tiers: [
      ["Easy", "Stats shown, no timer."],
      ["Medium", "Competitive bot."],
      ["Hard", "Strong bot."],
    ],
  },
  {
    name: "Online Ranked",
    blurb: "Play real people and compete for rating and rank.",
    tiers: [],
  },
];

/** Session-local backstop: if the profile write fails, this still stops the
 * modal reappearing for the rest of this visit. */
let shownThisSession = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The dialog body. Built as nodes rather than an HTML string: none of this is
 * user text, but the app's rule is that nothing is parsed as markup unless it
 * has to be, and the CSP has no 'unsafe-inline' to fall back on. */
function buildBody(onStart) {
  const body = el("div", "onboarding");

  body.appendChild(el("p", "onboarding-hook", "Think you know ball?"));
  body.appendChild(
    el(
      "p",
      "onboarding-lede",
      "Draft players from different eras, build your team, and watch your roster compete in a simulated game."
    )
  );

  const steps = el("ol", "onboarding-steps");
  for (const [title, detail] of STEPS) {
    const li = el("li", "onboarding-step");
    li.appendChild(el("span", "onboarding-step-title", title));
    li.appendChild(el("span", "onboarding-step-detail", detail));
    steps.appendChild(li);
  }
  body.appendChild(steps);

  body.appendChild(el("h4", "onboarding-heading", "How you can play"));
  const modes = el("div", "onboarding-modes");
  for (const mode of MODES) {
    const card = el("div", "onboarding-mode");
    card.appendChild(el("span", "onboarding-mode-name", mode.name));
    card.appendChild(el("span", "onboarding-mode-blurb", mode.blurb));
    if (mode.tiers.length) {
      const list = el("ul", "onboarding-tiers");
      for (const [name, detail] of mode.tiers) {
        const li = el("li");
        li.appendChild(el("strong", null, name));
        li.appendChild(document.createTextNode(` — ${detail}`));
        list.appendChild(li);
      }
      card.appendChild(list);
    }
    modes.appendChild(card);
  }
  body.appendChild(modes);

  const start = el("button", "btn btn-primary btn-block onboarding-cta", "Start Playing");
  start.type = "button";
  start.addEventListener("click", onStart);
  body.appendChild(start);

  return body;
}

// ---- Panel two: where to tell us ------------------------------------------

/** The copy, as data. Exported so scripts/verify-onboarding.mjs can assert the
 * screen says what the product decided it says, instead of holding a second
 * copy of the words and checking them against themselves. */
export const FEEDBACK_STEP = {
  title: "Help us improve Draft Nova",
  body:
    "Have an idea, found a bug, or something doesn't feel right? " +
    "Open Settings anytime and send feedback directly to our developers.",
  cta: "Got it",
};

/** The settings gear, or null on a screen that has none. Looked up at the
 * moment it is needed rather than held at module load: this module is imported
 * during boot and the button is only interesting once the home screen is up. */
function gearButton() {
  return document.getElementById("btn-settings");
}

/** Lifts the gear out of the backdrop's shade and rings it.
 *
 * A CLASS, not an inline style. The CSP forbids a style attribute (see the
 * note in index.html) and the ring is three rules and an animation that belong
 * in the stylesheet with everything else that paints. */
function spotlightGear(on) {
  const gear = gearButton();
  if (gear) gear.classList.toggle("is-spotlit", on);
}

function buildFeedbackStep(onDone) {
  const body = el("div", "onboarding onboarding-spotlight-step");

  body.appendChild(el("p", "onboarding-hook", FEEDBACK_STEP.title));
  body.appendChild(el("p", "onboarding-lede", FEEDBACK_STEP.body));

  // THE GEAR ITSELF, not an arrow pointing at it. An arrow is only meaningful
  // while this panel is on screen and the highlight is lit; the glyph is the
  // thing they will be scanning the header for tomorrow, so showing it here is
  // showing them what to look for rather than where it is right now.
  // aria-hidden on the glyph: a screen reader gets the sentence, which already
  // names the control in words.
  const pointer = el("p", "onboarding-pointer");
  const glyph = el("span", "onboarding-pointer-glyph", "\u2699\uFE0F");
  glyph.setAttribute("aria-hidden", "true");
  pointer.appendChild(glyph);
  pointer.appendChild(document.createTextNode("Look for the gear at the top of the home screen."));
  body.appendChild(pointer);

  const done = el("button", "btn btn-primary btn-block onboarding-cta onboarding-cta-feedback", FEEDBACK_STEP.cta);
  done.type = "button";
  done.addEventListener("click", onDone);
  body.appendChild(done);

  return body;
}

/**
 * Shows the welcome if this account has never seen it.
 *
 * @param profile a normalized profile (js/profile.js). Passed in rather than
 *   loaded here because the caller has just loaded one - asking again would be
 *   a second round trip for a field already in hand.
 * @returns true if the modal was opened.
 */
export function maybeShowOnboarding(profile) {
  if (shownThisSession) return false;
  // hasSeenOnboarding is true for everything except an explicit false from the
  // database - see normalize() in js/profile.js for why the missing case is
  // deliberately NOT treated as "new player".
  if (!profile || profile.hasSeenOnboarding) return false;

  shownThisSession = true;
  track(EVENTS.ONBOARDING_VIEWED);
  // Recorded the moment it opens, not when it closes. A player who reads it
  // and navigates away has still seen it, and asking them again would make
  // "once" a lie. The two events exist to tell those cases apart: viewed is
  // everyone, completed is only the ones who pressed the button.
  persist();

  // THE SPOTLIGHT IS CLEANED UP ON EVERY EXIT, not only on "Got it". A player
  // who presses Escape on the second panel must not be left with a gear
  // pulsing at them forever, and there are four ways out of this dialog (the
  // button, the x, Escape and the backdrop) of which three land here.
  const dismissed = () => spotlightGear(false);

  const finishFeedbackStep = () => {
    spotlightGear(false);
    track(EVENTS.ONBOARDING_COMPLETED);
    closeModal();
  };

  // PANEL TWO. The dialog is already open, so this is a body swap rather than
  // a close and a reopen: reopening would restore focus to the home screen and
  // take it away again in the same frame, and would replay the open animation
  // for what is meant to read as the next thing in one flow.
  const showFeedbackStep = () => {
    spotlightGear(true);
    // THE TITLE BAR DOES NOT CHANGE. It says "Welcome to Draft Nova" for both
    // panels because both panels are the welcome, and because the panel's own
    // heading is already FEEDBACK_STEP.title - putting it in the title bar as
    // well printed the same sentence twice, one above the other.
    openModal("Welcome to Draft Nova", buildFeedbackStep(finishFeedbackStep), dismissed, {
      variant: "modal-onboarding",
    });
  };

  // ONBOARDING_COMPLETED MOVED TO THE SECOND PANEL and is deliberately not
  // fired here. "Completed" has always meant "reached the end of the welcome",
  // and the end of the welcome is now one panel further on; firing it on
  // "Start Playing" as well would double-count every player who finishes.
  //
  // No dismiss handler on THIS panel: closing by backdrop, Escape or the x is
  // a legitimate way out of a welcome screen and needs no cleanup - the flag
  // was written on open, and nothing is spotlit yet.
  openModal("Welcome to Draft Nova", buildBody(showFeedbackStep), null, {
    variant: "modal-onboarding",
  });
  return true;
}

/** Best-effort write. A failure here costs at most one extra viewing on a
 * later visit, which is much better than the alternative: making the welcome
 * modal a blocking network call on the first screen a new player ever sees. */
function persist() {
  markOnboardingSeen().catch((e) => {
    console.error("Couldn't record that onboarding was seen:", e);
  });
}

