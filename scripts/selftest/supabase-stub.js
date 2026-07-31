// A stand-in for @supabase/supabase-js, served in place of the CDN module so
// the browser harness can be exercised against a locally served copy of the
// site with no backend at all.
//
// This exists to verify THE HARNESS, not the app's server behaviour. It makes
// exactly one thing possible - getting past the sign-in gate into an offline
// bot match - so the Playwright automation (selectors, draft driving, phase
// handling, frame sampling, layout auditing) can be proven to work without
// needing credentials or network. Anything that would hit the real backend
// resolves to empty, successful data.
//
// The real online path is NOT covered by this and must never appear to be:
// `npm run verify --online` against the live site is the only thing that
// exercises matchmaking and the simulate-match Edge Function.

const USER = { id: "00000000-0000-4000-8000-00000000beef", email: "selftest@ballknowledge.app" };

const PROFILE = {
  id: USER.id,
  username: "SelfTest",
  online_wins: 0,
  online_losses: 0,
  offline_wins: 3,
  offline_losses: 2,
  draft_counts: {},
  personal_bests: {},
  career_totals: {},
  team_banners: {},
  era_records: {},
  equipped_banner: null,
  featured_badges: [],
  created_at: new Date("2026-01-01").toISOString(),
  history: [],
  highest_scoring_game: null,
  largest_margin_game: null,
  triple_double_counts: {},
  mvp_counts: {},
};

const SESSION = {
  access_token: "selftest-token",
  refresh_token: "selftest-refresh",
  expires_in: 3600,
  token_type: "bearer",
  user: USER,
};

/** Chainable, thenable query builder. Every filter is a no-op that returns
 * `this`, so any call shape the app uses resolves; the terminal shape
 * (single / maybeSingle / await) decides whether one row or a list comes
 * back. */
class Query {
  constructor(table) {
    this.table = table;
    this._rows = table === "profiles" ? [PROFILE] : [];
  }
  select() { return this; }
  insert() { return this; }
  update() { return this; }
  upsert() { return this; }
  delete() { return this; }
  eq() { return this; }
  neq() { return this; }
  in() { return this; }
  gt() { return this; }
  gte() { return this; }
  lt() { return this; }
  lte() { return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  single() { return Promise.resolve({ data: this._rows[0] ?? null, error: this._rows.length ? null : { message: "no rows" } }); }
  maybeSingle() { return Promise.resolve({ data: this._rows[0] ?? null, error: null }); }
  then(resolve, reject) {
    return Promise.resolve({ data: this._rows, error: null }).then(resolve, reject);
  }
}

const RPC_RESULTS = {
  heartbeat_presence: 1,
  join_queue: { status: "waiting" },
  get_visible_picks: [],
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
    rpc: async (name) => ({ data: RPC_RESULTS[name] ?? null, error: null }),
    functions: { invoke: async () => ({ data: null, error: { message: "not available in self-test" } }) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  };
}

export default { createClient };
