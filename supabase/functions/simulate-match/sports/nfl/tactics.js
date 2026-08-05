// NFL gamestyles. EMPTY - not built.
//
// The rule this must be designed around is the one at the top of
// js/sports/nba/tactics.js, and it is not negotiable: a style must be a real
// CHOICE, not a power gain. If one option is simply strongest, ranked stops
// measuring football knowledge and starts measuring whether you picked style 3.
//
// Which means every style pays for what it boosts, and its net strength is
// SOLVED by simulation (tools/calibrate-gamestyles.mjs) rather than authored.
// Basketball's fifteen currently sit in a 5.4-point spread across the full
// field; football's should be held to the same standard.
//
// Expected surface: TACTICS, DEFAULT_TACTIC, tacticById, randomTacticChoices.

// Eight styles, each paying for what it boosts. The `pts` multipliers below
// are PLACEHOLDERS at 1.0 and have never been solved - the identity mods are
// authored (they say what the style IS) but the net-strength term must come
// from tools/calibrate-gamestyles.mjs before ranked means anything. Shipping
// them at 1.0 makes every style exactly as strong as every other, which is
// wrong but is the honest wrong: no style is secretly best, they are just
// flavour until calibration runs.
export const TACTICS = [
  { id: "balanced", name: "Balanced", blurb: "No tilt either way.",
    mods: { pts: 1, pass: 1, run: 1, pressure: 1, coverage: 1 } },
  { id: "air-raid", name: "Air Raid", blurb: "Throw it deep, live with the picks.",
    mods: { pts: 1, pass: 1.3, run: 0.75, pressure: 1, coverage: 0.95 } },
  { id: "ground-and-pound", name: "Ground and Pound", blurb: "Run it, shorten the game.",
    mods: { pts: 1, pass: 0.78, run: 1.35, pressure: 1, coverage: 1.05 } },
  { id: "west-coast", name: "West Coast", blurb: "Short, accurate, keep the chains moving.",
    mods: { pts: 1, pass: 1.15, run: 1.05, pressure: 0.92, coverage: 1 } },
  { id: "blitz-heavy", name: "Blitz Heavy", blurb: "Send pressure, leave corners on an island.",
    mods: { pts: 1, pass: 1, run: 0.95, pressure: 1.4, coverage: 0.72 } },
  { id: "tampa-2", name: "Tampa 2", blurb: "Drop everyone, make them earn it underneath.",
    mods: { pts: 1, pass: 1, run: 0.9, pressure: 0.7, coverage: 1.38 } },
  { id: "bend-dont-break", name: "Bend Don't Break", blurb: "Give up yards, not points.",
    mods: { pts: 1, pass: 0.95, run: 1, pressure: 0.9, coverage: 1.2 } },
  { id: "four-minute", name: "Four Minute", blurb: "Clock and field position over everything.",
    mods: { pts: 1, pass: 0.85, run: 1.25, pressure: 1.05, coverage: 1.1 } },
];

export const DEFAULT_TACTIC = TACTICS[0];
export const tacticById = (id) => TACTICS.find((t) => t.id === id) || DEFAULT_TACTIC;

/** Three to choose from, always including one the drafter did not expect -
 * same shape as basketball's picker so the shared screen needs no branch. */
export function randomTacticChoices(count = 3) {
  const pool = [...TACTICS];
  const out = [];
  while (out.length < Math.min(count, pool.length)) {
    out.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
  }
  return out;
}
