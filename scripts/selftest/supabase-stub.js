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
//
// AND rpc() BELOW ANSWERS "yes" TO EVERYTHING, WITHOUT READING ITS ARGUMENTS.
// That is fine for driving the harness and dangerous to forget: the online
// self-test drove the whole rotation -> matchups -> gamestyle sequence and
// reported it committed for ten days while the live submit_strategy rejected
// every one of those payloads. What the browser sends is held to the RPC's
// actual rules in scripts/verify-online-strategy-contract.mjs; a green run
// here says the SCREENS work, never that the server would have accepted it.

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
  // EXPLICIT, not left to the client's reading of a missing column. The
  // harness drives a match from the home screen; a first-run welcome modal
  // over it would block every selector that follows. js/profile.js treats an
  // absent column as "already onboarded" today, so this is belt and braces -
  // but the harness must not depend on that choice staying the way it is.
  has_seen_onboarding: true,
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
  /**
   * A no-op that RECORDS. Nothing here persists - a stub that stored rows would
   * be a database, and every read below is a fixture - but a write is the only
   * evidence a harness has that the app did something it was supposed to do.
   *
   * This exists for one check in particular: abandoning a game mid-quarter must
   * still record the result. The write is the whole of "recorded", and it was
   * silently lost when the playback's timers - which are also what eventually
   * reaches finish() - started being cancelled on a tab change.
   */
  update(patch) {
    if (typeof window !== "undefined") {
      window.__bkWrites = window.__bkWrites || [];
      window.__bkWrites.push({ table: this.table, keys: Object.keys(patch || {}) });
    }
    return this;
  }
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

// SIGNED OUT, ON REQUEST. Every harness but one wants to start signed in, so
// that stays the default. The guest self-test (run-guest-selftest.mjs) sets
// window.__bkStartSignedOut in an init script and gets the real first-visit
// boot - no session until the page signs in or signs up through the form.
let session = typeof window !== "undefined" && window.__bkStartSignedOut ? null : SESSION;

/** Every RPC the page makes, by name and argument keys, for the same reason
 * update() records writes: the guest self-test has to prove what a guest did
 * NOT call (track_event, touch_active_day) as much as what it did. */
function recordRpc(name, args) {
  if (typeof window === "undefined") return;
  window.__bkRpcs = window.__bkRpcs || [];
  window.__bkRpcs.push({ name, signedIn: !!session, args: args || {} });
}

export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user: session ? USER : null }, error: null }),
      signInWithPassword: async () => {
        session = SESSION;
        return { data: { session, user: USER }, error: null };
      },
      signUp: async () => {
        session = SESSION;
        return { data: { session, user: USER }, error: null };
      },
      signOut: async () => {
        session = null;
        return { error: null };
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      recordRpc(name, args);
      return { data: RPC_RESULTS[name] ?? null, error: null };
    },
    functions: { invoke: async () => ({ data: null, error: { message: "not available in self-test" } }) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  };
}

export default { createClient };
