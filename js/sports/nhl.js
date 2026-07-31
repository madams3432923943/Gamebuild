import { pendingSport } from "./pending.js";

export const NHL = pendingSport({
  id: "nhl",
  name: "NHL",
  icon: "🏒",
  labels: { group: "era", unit: "ice time", period: "period", periodPlural: "periods" },
});

export default NHL;
