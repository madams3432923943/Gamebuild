// The in-page half of the online self-test: a @supabase/supabase-js shim that
// forwards every call to the fake backend (scripts/selftest/fake-server.mjs)
// over fetch.
//
// It has to go over the network rather than hold state in the page, because
// the whole point is that TWO browser contexts share one server and get
// matched with each other. Two in-page stubs would be two isolated worlds and
// could never produce a match.
//
// __BK_USER_ID and __BK_USERNAME are injected per context before this loads,
// which is what makes the two browsers different people.

const API = window.__BK_API;
const USER_ID = window.__BK_USER_ID;
const USERNAME = window.__BK_USERNAME;

async function call(payload) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, userId: USER_ID }),
  });
  return res.json();
}

const USER = { id: USER_ID, email: `${USERNAME}@ballknowledge.app` };
const SESSION = {
  access_token: "selftest-token",
  refresh_token: "selftest-refresh",
  expires_in: 3600,
  token_type: "bearer",
  user: USER,
};

/** Collects .eq() filters and defers the request until a terminal call, so the
 * server sees the whole query rather than a stream of partial ones. */
class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this._mutation = null;
  }
  select() { return this; }
  insert(v) { this._mutation = { op: "insert", v }; return this; }
  update(v) { this._mutation = { op: "update", v }; return this; }
  upsert(v) { this._mutation = { op: "upsert", v }; return this; }
  delete() { this._mutation = { op: "delete" }; return this; }
  eq(column, value) { this.filters.push({ column, value }); return this; }
  neq() { return this; }
  in() { return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }

  _run(single) {
    // Profile writes are not what this test is about; accepting them keeps the
    // app's own bookkeeping from erroring mid-match.
    if (this._mutation) return Promise.resolve({ data: null, error: null });
    return call({ kind: "select", table: this.table, filters: this.filters, single });
  }
  single() { return this._run(true).then((r) => ({ data: r.data, error: r.data ? null : { message: "no rows" } })); }
  maybeSingle() { return this._run(true); }
  then(resolve, reject) { return this._run(false).then(resolve, reject); }
}

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
    rpc: async (fn, args) => call({ kind: "rpc", fn, args }),
    functions: { invoke: async (name, opts) => call({ kind: "invoke", name, body: opts?.body }) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  };
}

export default { createClient };
