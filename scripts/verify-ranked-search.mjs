// Focused regression checks for ranked typed-name search.
// These are intentionally based on real production data and the same helpers
// the browser uses, so accented names cannot silently disappear again.

import { setActiveSport } from "../js/sports/index.js";
import { NBA } from "../js/sports/nba/index.js";
import { buildSquads, resolveTypedInput } from "../js/draft.js";
import { groupBySeason } from "../js/ui.js";

setActiveSport("nba");

const squads = buildSquads(NBA.players());
const denver2020s = squads.find((s) => s.team === "Denver Nuggets" && s.decade === "2020s");
if (!denver2020s) throw new Error("Denver Nuggets 2020s squad is missing");

const result = resolveTypedInput("jok", denver2020s, NBA.players());
if (result.tier !== "in-squad") {
  throw new Error(`Expected jok to resolve in-squad, got ${result.tier}`);
}

const cards = groupBySeason(result.candidates);
const jokic = cards.find(({ lead }) => lead.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("Jokic"));
if (!jokic) throw new Error("jok did not produce a Nikola Jokic card");
if (!jokic.seasons.length) throw new Error("Nikola Jokic card has no selectable seasons");

const dallas2020s = squads.find((s) => s.team === "Dallas Mavericks" && s.decade === "2020s");
if (!dallas2020s) throw new Error("Dallas Mavericks 2020s squad is missing");
const doncic = resolveTypedInput("doncic", dallas2020s, NBA.players());
if (doncic.tier !== "in-squad") {
  throw new Error(`Expected doncic to resolve in-squad, got ${doncic.tier}`);
}

console.log(`Ranked search verified: Jokic (${jokic.seasons.length} seasons) and Doncic resolve from unaccented input.`);
