// Supabase stand-in for the Squads screen.
//
// A FILE RATHER THAN A TEMPLATE LITERAL, because two things need it now:
// scripts/verify-squads.mjs, which asserts the screen renders in every state,
// and scripts/shoot-growth-screens.mjs, which photographs the roster. It was
// inline in the first of those, and copying sixty lines of fixture into the
// second would have been two squads that could disagree about what a roster is.
//
// Scenario-driven: `window.__SQUAD_SCENARIO` decides whether this player is in
// a squad, because "squad-less" and "in a squad" are two completely different
// screens and the interesting bugs live in the second one.
//
// This proves THE SCREENS work - that the render functions receive what the
// data layer hands them. It says nothing about whether the real RPCs would
// accept these calls; that is RLS and migration territory.
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "squadtest@ballknowledge.app" };
const SESSION = { access_token: "t", refresh_token: "r", expires_in: 3600, token_type: "bearer", user: USER };
const scenario = () => (window.__SQUAD_SCENARIO || "none");

const PROFILE = {
  id: USER.id, username: "SquadTester", online_wins: 12, online_losses: 4,
  offline_wins: 3, offline_losses: 2, draft_counts: {}, personal_bests: {},
  career_totals: {}, team_banners: {}, era_records: {}, equipped_banner: "rookie",
  equipped_kit: null, equipped_icon: null, featured_badges: [], granted_banners: [],
  granted_badges: [], granted_icons: [],
  // A REAL RATING, because the roster sorts on it (ROSTER_SORTS in
  // js/squads.js). An empty object reads as unranked for every member, which
  // would make a sorted roster indistinguishable from an unsorted one.
  sport_ratings: { nba: { rating: 566, wins: 12, losses: 4, games: 16, peak: 580 } },
  created_at: new Date("2026-01-01").toISOString(), history: [],
  highest_scoring_game: null, largest_margin_game: null,
  triple_double_counts: {}, mvp_counts: {}, mvp_teams: {},
};

// FOUR SQUADMATES RATHER THAN TWO, AND DELIBERATELY AWKWARD ONES. The roster
// can be ordered six ways and a fixture where every order comes out the same
// proves nothing:
//
//   RunAndGun  40-12  the best record and the best rating
//   PostUp      7-9   a losing record with enough games to be ranked
//   Rookie      1-0   a PERFECT record over one game - must not top the
//                     win-rate sort, which is the bug that sort exists to avoid
//   NeverPlayed 0-0   no games, no rating: bottom of every leaderboard
const MATES = [
  { id: "22222222-2222-4222-8222-222222222222", username: "RunAndGun", online_wins: 40, online_losses: 12,
    sport_ratings: { nba: { rating: 704, wins: 40, losses: 12, games: 52, peak: 712 } } },
  { id: "33333333-3333-4333-8333-333333333333", username: "PostUp", online_wins: 7, online_losses: 9,
    sport_ratings: { nba: { rating: 468, wins: 7, losses: 9, games: 16, peak: 502 } } },
  { id: "44444444-4444-4444-8444-444444444444", username: "Rookie", online_wins: 1, online_losses: 0,
    sport_ratings: { nba: { rating: 524, wins: 1, losses: 0, games: 1, peak: 524 } } },
  { id: "55555555-5555-4555-8555-555555555555", username: "NeverPlayed", online_wins: 0, online_losses: 0,
    sport_ratings: {} },
];

const SQUAD = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Hardwood Kings", tag: "HWK", emoji: "👑",
  motto: "Defence travels", visibility: "public", member_cap: 20, rep: 260,
  created_by: USER.id, created_at: new Date("2026-02-02").toISOString(),
};

const PUBLIC_SQUADS = [
  SQUAD,
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Bench Mob", tag: "BMB", emoji: "🔥",
    motto: "", visibility: "public", member_cap: 20, rep: 0, created_by: MATES[0].id,
    created_at: new Date("2026-02-03").toISOString() },
];

const MEMBER_ROWS = [
  { squad_id: SQUAD.id, user_id: USER.id, role: "leader", joined_at: "2026-02-02T00:00:00Z" },
  { squad_id: SQUAD.id, user_id: MATES[0].id, role: "co-leader", joined_at: "2026-02-04T00:00:00Z" },
  { squad_id: SQUAD.id, user_id: MATES[1].id, role: "member", joined_at: "2026-02-05T00:00:00Z" },
  { squad_id: SQUAD.id, user_id: MATES[2].id, role: "member", joined_at: "2026-02-08T00:00:00Z" },
  { squad_id: SQUAD.id, user_id: MATES[3].id, role: "member", joined_at: "2026-02-09T00:00:00Z" },
];

// Deliberately hostile text: the chat and header render through innerHTML, so
// if escaping ever regresses this turns into a real script tag in the DOM and
// the check below sees it.
const MESSAGES = [
  { id: 1, user_id: MATES[0].id, username: "RunAndGun", body: "first to the gym", created_at: "2026-02-06T10:00:00Z" },
  { id: 2, user_id: USER.id, username: "SquadTester", body: "<img src=x onerror=alert(1)>", created_at: "2026-02-06T10:01:00Z" },
];

class Query {
  constructor(table) { this.table = table; this.filters = {}; this._mutation = false; }
  select() { return this; }
  insert() { this._mutation = true; return this; }
  update() { this._mutation = true; return this; }
  upsert() { this._mutation = true; return this; }
  delete() { this._mutation = true; return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  neq() { return this; } in(col, vals) { this.filters["in:" + col] = vals; return this; }
  or(expr) { (window.__OR_FILTERS = window.__OR_FILTERS || []).push(expr); return this; } gt() { return this; } gte() { return this; }
  lt() { return this; } lte() { return this; } order() { return this; }
  limit() { return this; } range() { return this; }

  _rows() {
    if (this._mutation) return [];
    const t = this.table, f = this.filters;
    if (t === "profiles") {
      const all = [PROFILE, ...MATES];
      if (f.id) return all.filter((p) => p.id === f.id);
      if (f["in:id"]) return all.filter((p) => f["in:id"].includes(p.id));
      return all;
    }
    if (t === "squad_members") {
      // A squad-less player still reads OTHER squads' member rows - the RLS
      // policy exposes them for any PUBLIC squad, which is what makes the
      // browse list's "3 / 20 members" real. Only this player's own membership
      // disappears in the "none" scenario. Returning nothing at all here would
      // have made the browse count untestable and hidden a real regression.
      const rows = scenario() === "none" ? MEMBER_ROWS.filter((m) => m.user_id !== USER.id) : MEMBER_ROWS;
      if (f.user_id) return rows.filter((m) => m.user_id === f.user_id);
      if (f.squad_id) return rows.filter((m) => m.squad_id === f.squad_id);
      if (f["in:squad_id"]) return rows.filter((m) => f["in:squad_id"].includes(m.squad_id));
      return rows;
    }
    if (t === "squads") {
      if (f.id) return PUBLIC_SQUADS.filter((s) => s.id === f.id);
      return PUBLIC_SQUADS;
    }
    if (t === "squad_messages") return scenario() === "none" ? [] : MESSAGES.slice().reverse();
    if (t === "friendships") return [];
    if (t === "matches") return [];
    return [];
  }
  single() { const r = this._rows(); return Promise.resolve({ data: r[0] ?? null, error: r.length ? null : { message: "no rows" } }); }
  maybeSingle() { const r = this._rows(); return Promise.resolve({ data: r[0] ?? null, error: null }); }
  then(res, rej) { return Promise.resolve({ data: this._rows(), error: null }).then(res, rej); }
}

// Every RPC the squads screen can call, and what it hands back. Recorded so the
// test can assert the ARGUMENT NAMES the client sends.
window.__RPC_CALLS = [];
const RPC = {
  get_squad_invite_code: "4Q7ZB3",
  regenerate_squad_invite_code: "9M2XD1",
  heartbeat_presence: 1,
};

export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: SESSION }, error: null }),
      getUser: async () => ({ data: { user: USER }, error: null }),
      signInWithPassword: async () => ({ data: { session: SESSION, user: USER }, error: null }),
      signUp: async () => ({ data: { session: SESSION, user: USER }, error: null }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      window.__RPC_CALLS.push({ name, args: args ? Object.keys(args).sort() : [] });
      return { data: RPC[name] ?? null, error: null };
    },
    functions: { invoke: async () => ({ data: null, error: { message: "stubbed" } }) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  };
}
export default { createClient };
