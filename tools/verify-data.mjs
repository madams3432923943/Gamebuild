// Checks js/data.js is fit for the game, whatever produced it.
// Run: node tools/verify-data.mjs
import { PLAYERS } from "../js/data.js";

const SLOTS = ["PG", "SG", "SF", "PF", "C"];
const squads = new Map();
for (const p of PLAYERS) {
  const k = `${p.team}|${p.decade}`;
  if (!squads.has(k)) squads.set(k, []);
  squads.get(k).push(p);
}

let fail = 0;
const report = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) fail++;
};

report(PLAYERS.length > 0, "dataset is non-empty", `${PLAYERS.length} players`);
report(squads.size > 0, "squads present", `${squads.size} squads`);

// Squads are sized for their era: the player pool that far back is thin, so a
// pre-1990 squad only has to be 10 deep rather than 16. Ten still fills a full
// ranked roster, and a squad only ever supplies two picks in a round anyway.
// This is a floor, not a cap - an older squad with 16 well-documented players
// is better data, not a problem.
const minFor = (decade) => (parseInt(decade, 10) < 1990 ? 10 : 16);
const undersized = [...squads.entries()].filter(([k, a]) => a.length < minFor(k.split("|")[1]));
report(
  undersized.length === 0,
  "every squad meets its era's size floor",
  undersized.slice(0, 5).map(([k, a]) => `${k} (${a.length})`).join(", ")
);

const dupes = [...squads.entries()].filter(([, a]) => new Set(a.map((p) => p.name)).size !== a.length);
report(dupes.length === 0, "no duplicate name within a squad", dupes.map(([k]) => k).join(", "));

// Enough bodies at each position that a draft can always fill the slot. A
// 16-man squad carries three; a 10-man squad only has ten players to spread
// across five positions, and two is already more than the two picks a squad
// ever supplies in one round.
const thin = [];
for (const [k, a] of squads) {
  const need = a.length >= 16 ? 3 : 2;
  for (const s of SLOTS) if (a.filter((p) => p.pos.includes(s)).length < need) thin.push(`${k}:${s}`);
}
report(thin.length === 0, "enough eligible players at every position", thin.slice(0, 8).join(", "));

const badNum = PLAYERS.filter((p) =>
  ["ppg", "rpg", "apg", "spg", "bpg", "tov"].some((k) => !Number.isFinite(p[k]) || p[k] < 0)
);
report(badNum.length === 0, "core stats finite and non-negative", badNum.slice(0, 3).map((p) => p.name).join(", "));

// Shooting fields are optional (the game degrades without them), but if a
// player has any, the whole set must be coherent. Pre-1980 squads are
// exempt: they predate real per-game data being imported, and stay on
// model-recalled placeholders that never carried these fields.
const withShooting = PLAYERS.filter((p) => typeof p.fga === "number");
if (withShooting.length > 0) {
  const modern = PLAYERS.filter((p) => parseInt(p.decade, 10) >= 1980);
  const modernWithShooting = modern.filter((p) => typeof p.fga === "number");
  report(
    modernWithShooting.length === modern.length,
    "shooting data present for every 1980s+ player",
    `${modernWithShooting.length}/${modern.length}`
  );
  const badPct = withShooting.filter((p) =>
    [p.fgp, p.tpp, p.ftp].some((v) => !Number.isFinite(v) || v < 0 || v > 1)
  );
  report(badPct.length === 0, "percentages within 0-1", badPct.slice(0, 3).map((p) => p.name).join(", "));

  // The guarantee the shot-split model depends on.
  const ghostThrees = withShooting.filter((p) => p.tpa === 0 && p.tpp !== 0);
  report(ghostThrees.length === 0, "no percentage on zero three-point attempts",
    ghostThrees.slice(0, 3).map((p) => p.name).join(", "));

  const preLine = withShooting.filter((p) => p.decade === "1970s" && p.tpa > 0);
  report(preLine.length === 0, "no three-point attempts before the line existed",
    preLine.slice(0, 3).map((p) => `${p.name} (${p.tpa})`).join(", "));

  const shaq = withShooting.filter((p) => /O'?Neal/.test(p.name) && /Shaq/.test(p.name));
  if (shaq.length > 0) {
    report(shaq.every((p) => p.tpa === 0), "Shaquille O'Neal attempts no threes",
      shaq.map((p) => `${p.team} ${p.decade}: ${p.tpa}`).join(", "));
  }
} else {
  console.log("SKIP  shooting checks (no shooting fields in dataset)");
}

console.log(fail === 0 ? "\nAll checks passed." : `\n${fail} check(s) failed.`);
process.exit(fail === 0 ? 0 : 1);
