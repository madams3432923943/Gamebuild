// A modal that belongs to ONE pick window and dies with it.
//
// The season picker and the slot picker open through the shared openModal,
// which knows nothing about the draft. When the pick clock ran out with one of
// them open, the clock drafted for you and the next squad rolled - and the
// modal stayed up. Clicking a season in it then tried to draft last round's
// player (Tyreek Hill's year picker surviving into the next pick) against a
// squad he is not on.
//
// Two guards, because either alone leaves a gap:
//   - endPickTurn() closes the modal. Every way a pick window ends (a pick, a
//     timeout, a skip, a forfeit, the round reveal, the draft finishing) runs
//     through cleanupPickTimer in js/main.js, which calls it.
//   - A choice made inside the modal is honoured only if its turn is still the
//     current one, so a click that was already in flight, or a re-render that
//     somehow kept the node, cannot land on the wrong pick.

import { openModal, closeModal } from "../shell.js";

let currentTurn = 0;
let openBody = null;

/** Ends the current pick window: closes its modal, if it still has one open,
 * and retires every choice callback handed out under it. */
export function endPickTurn() {
  currentTurn += 1;
  // Only OUR modal. If the player dismissed it and opened something else (a
  // How to Play sheet), that one is not ours to close.
  if (openBody && openBody.isConnected) closeModal();
  openBody = null;
}

/**
 * A scope for one modal in the current pick window. Take it BEFORE building the
 * modal's buttons, so their callbacks are bound to this turn:
 *
 *   const scope = pickModalScope();
 *   btn.onclick = scope.choose(() => onChoose(slot));
 *   scope.open("Where does he play?", body, onCancel);
 *
 * `choose` closes the modal and runs the callback only while the turn is still
 * current. `open`'s dismissal callback is dropped once the turn has ended -
 * putting a pending player back on a board that has moved on would be wrong.
 */
export function pickModalScope() {
  const turn = currentTurn;
  const live = () => turn === currentTurn;
  return {
    choose: (fn) => (...args) => {
      if (!live()) return;
      openBody = null;
      closeModal();
      fn(...args);
    },
    open(title, body, onDismiss) {
      openBody = body;
      openModal(title, body, () => {
        openBody = null;
        if (live()) onDismiss?.();
      });
    },
  };
}
