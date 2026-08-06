// Focused browser-like regression checks for ranked typed-name search.
// Uses the real production data and calls renderPool exactly as ranked
// practice does, so a card-render exception cannot hide behind pure search
// helper tests.

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><div id='pool'></div>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;

const { setActiveSport } = await import("../js/sports/index.js");
const { NBA } = await import("../js/sports/nba/index.js");
const { buildSquads, resolveTypedInput } = await import("../js/draft.js");
const { groupBySeason, renderPool } = await import("../js/ui.js");

setActiveSport("nba");

const squads = buildSquads(NBA.players());
const denver2020s = squads.find((s) => s.team === "Denver Nuggets" && s.decade === "2020s");
if (!denver2020s) throw new Error("Denver Nuggets 2020s squad is missing");

const result = resolveTypedInput("jok", denver2020s, NBA.players());
if (result.tier !== "in-squad") throw new Error(`Expected jok in-squad, got ${result.tier}`);

const cards = groupBySeason(result.candidates);
const jokic = cards.find(({ lead }) =>
  lead.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("Jokic")
);
if (!jokic) throw new Error("jok did not produce Nikola Jokic");

const pool = document.getElementById("pool");
renderPool(
  pool,
  denver2020s,
  "jok",
  {},
  null,
  () => {},
  NBA.players(),
  "strict",
  NBA.slots.ranked,
  () => {}
);

const renderedCard = [...pool.querySelectorAll(".player-card")].find((el) =>
  el.textContent.normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("Nikola Jokic")
);
if (!renderedCard) throw new Error(`Ranked pool rendered no Jokic card; HTML: ${pool.innerHTML}`);

const dallas2020s = squads.find((s) => s.team === "Dallas Mavericks" && s.decade === "2020s");
if (!dallas2020s) throw new Error("Dallas Mavericks 2020s squad is missing");
const doncic = resolveTypedInput("doncic", dallas2020s, NBA.players());
if (doncic.tier !== "in-squad") throw new Error(`Expected doncic in-squad, got ${doncic.tier}`);

console.log(`Ranked DOM search verified: Jokic card rendered with ${jokic.seasons.length} selectable seasons.`);
