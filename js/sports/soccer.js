import { pendingSport } from "./pending.js";

export const SOCCER = pendingSport({
  id: "soccer",
  name: "Soccer",
  icon: "⚽",
  // Two 45-minute halves, so the quarter-shaped vocabulary the rest of the
  // app inherited from basketball would be wrong on every screen.
  labels: { group: "era", unit: "minutes", period: "half", periodPlural: "halves" },
});

export default SOCCER;
