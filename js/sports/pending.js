// A sport that is announced but not built.
//
// NHL and Soccer are on the picker to show where the game is going, and
// neither has a dataset, an engine or a ruleset yet. Rather than three
// near-identical stub files drifting apart, they share this one - so a change
// to what "not built yet" means (a new required field on the sport shape, say)
// lands on all of them at once.
//
// NFL is deliberately NOT built from this: it is the next sport up, its
// roster shape and table name are already decided, and writing those down is
// most of the value of having the file at all.

const notReady = (sport, what) => () => {
  throw new Error(`${sport} has no ${what} yet - this sport is not playable.`);
};

export function pendingSport({ id, name, icon, status = "Coming soon", labels = {}, todo = [] }) {
  return {
    id,
    name,
    icon,
    live: false,
    status,

    labels: {
      squad: "roster",
      squadPlural: "rosters",
      group: "era",
      unit: "minutes",
      period: "period",
      periodPlural: "periods",
      scoreVerb: "scored",
      ...labels,
    },

    slots: { quickPlay: [], ranked: [], starters: [], bench: [] },
    eras: [{ id: "all", label: "All Years", emoji: icon, decades: null, blurb: "Every era." }],
    defaultEra: "all",
    eraById(eraId) {
      return this.eras.find((e) => e.id === eraId) || this.eras[0];
    },

    table: `${id}_players`,
    statKeys: [],
    lineKeys: [],

    // No rank ladder, no rules text and no palette: a pending sport can't be
    // selected (isSelectable() in ./index.js), so it never gets to theme the
    // app or open either of those modals. Declared empty rather than left off
    // so the shape still matches a real sport's.
    theme: null,
    tiers: [],
    howToPlay: [],

    players: notReady(name, "player data"),
    playersInEra: notReady(name, "era brackets"),
    computeDatasetStats: notReady(name, "dataset statistics"),
    simulate: notReady(name, "simulation engine"),
    defaultMinutes: notReady(name, "playing-time model"),
    botMinutes: notReady(name, "playing-time model"),
    defaultMatchups: () => ({}),

    tactics: [],
    defaultTactic: null,
    tacticById: () => null,
    randomTacticChoices: () => [],

    todo: todo.length ? todo : ["Everything - this sport has not been started."],
  };
}
