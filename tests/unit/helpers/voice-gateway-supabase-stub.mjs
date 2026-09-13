// A stand-in for supabase-js, so the gateway's request path can be driven from
// node and every question it asks the database can be asserted.
//
// It records rather than simulates: a test declares what `auth.getUser`, a
// table read and an rpc should answer, and afterwards reads back the exact
// calls in the exact order the function made them. The order matters — «is the
// caller banned» has to run before anything else is read, and a refusal has to
// stop the SFU being called at all.

let plan = null;
let calls = [];

export function programSupabase(next) {
  plan = next;
  calls = [];
}

export function supabaseCalls() {
  return calls;
}

export function supabaseCallNames() {
  return calls.map((call) => call.kind + ":" + call.name);
}

export function createClient(url, key, options) {
  calls.push({ kind: "client", name: key === plan?.serviceRoleKey ? "service" : "public", url, options });
  return {
    auth: {
      getUser: async (token) => {
        calls.push({ kind: "auth", name: "getUser", token });
        return plan.getUser ? plan.getUser(token) : { data: { user: null }, error: new Error("unplanned") };
      },
    },
    from: (table) => makeQuery(table),
    rpc: async (name, args) => {
      calls.push({ kind: "rpc", name, args });
      const answer = plan.rpc ? plan.rpc(name, args) : undefined;
      return answer ?? { data: null, error: new Error("unplanned rpc " + name) };
    },
  };
}

function makeQuery(table) {
  const state = { table, columns: null, filters: {} };
  const query = {
    select(columns) {
      state.columns = columns;
      return query;
    },
    eq(column, value) {
      state.filters[column] = value;
      return query;
    },
    limit() {
      return query;
    },
    async maybeSingle() {
      calls.push({ kind: "table", name: table, columns: state.columns, filters: { ...state.filters } });
      const answer = plan.table ? plan.table(state) : undefined;
      return answer ?? { data: null, error: new Error("unplanned table " + table) };
    },
  };
  return query;
}
