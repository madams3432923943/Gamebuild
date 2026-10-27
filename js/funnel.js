// The practice funnel: where players get to, and where they stop.
//
// One call site per moment (draft started, a pick, results seen, Share, Play
// Again, sign-up opened...) and this decides where it goes:
//   - a signed-in player's goes to analytics_events through track(), like
//     every other product event;
//   - a guest's goes to guest_funnel_events through sendGuestEvent(), because
//     a guest is in no user metric (CLAUDE.md, js/guest.js).
// Both are tagged phone or desktop. See docs/ux-pass-2026-10.md, section G.
//
// Never awaited and never throws: a metric is not worth a click.

import { track } from "./analytics.js";
import { isGuest, sendGuestEvent } from "./guest.js";

/** "phone" or "desktop", from the layout the player is actually getting: the
 * same 700px breakpoint, or a short touch screen, that the phone layout uses.
 * A tablet in landscape counts as desktop, which is what it is shown. */
export function deviceClass() {
  try {
    return matchMedia("(max-width: 700px), ((max-height: 520px) and (pointer: coarse))").matches ? "phone" : "desktop";
  } catch {
    return "desktop";
  }
}

/** Events only a signed-out player can produce. Opening the sign-up form is
 * the clearest: anyone who can do it has no account, so it belongs to the
 * guest funnel alone and is not declared in analytics_event_types. */
export const GUEST_EVENTS = {
  SIGNUP_STARTED: "signup_started",
};
const GUEST_ONLY = new Set(Object.values(GUEST_EVENTS));

/**
 * @param props.sport, props.step (pick number), props.source (what triggered
 *   it: manual / auto / forfeit for a pick, where a sign-up was opened from),
 *   plus anything else track() already allows for signed-in events.
 */
export function funnel(event, props = {}) {
  const device = deviceClass();
  if (isGuest()) {
    void sendGuestEvent({ event, sport: props.sport, device, step: props.step, source: props.source });
    return;
  }
  if (GUEST_ONLY.has(event)) return;
  track(event, { ...props, device });
}
