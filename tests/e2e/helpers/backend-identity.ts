/**
 * Which backend the application under test is wired to, and whether a QA
 * account can possibly exist in it.
 *
 * The QA accounts live in production and nowhere else — the fixture host
 * `http://127.0.0.1:54321` is a route mock with no auth service behind it — so
 * a signed-in spec pointed at a fixture server cannot sign in, however healthy
 * both it and the product are. Before D-206 that came out as
 * «sign-in did not reach the authenticated shell», which reads like a broken
 * login and was carried in the register as a failure for two days.
 *
 * A spec that cannot run must say so. But it must say so for a reason it has
 * actually established: skipping whenever sign-in is hard is how a suite goes
 * green having tested nothing, which this repository has already paid for once
 * (see `gotoOrSkip`). So the decision is made from the configuration the server
 * serves, not from the failure:
 *
 *  - a loopback Supabase URL, or none at all, means no QA account can exist
 *    there and the spec skips;
 *  - any other URL means the run is pointed at a real backend, and a sign-in
 *    that fails there is a failure;
 *  - a body this cannot read — a production bundle, an SPA fallback, a 404 —
 *    is **unknown**, which also means run. An unreadable probe must never be
 *    read as a licence to skip.
 *
 * That last case is the one worth measuring rather than assuming, because it
 * decides what happens on the deployment itself. Asked on 2026-09-15,
 * `https://app.letscube.ru/src/lib/supabase/client.ts` answers **200 with
 * `index.html`** — 4698 bytes, the SPA fallback — and that body carries no
 * `import.meta.env = {` at all. So a run pointed at production reads *unknown*
 * and goes on to sign in, which is what it is for.
 *
 * Imports nothing, so `node --test` reads it directly:
 * `tests/unit/backend-identity.test.mts`. The e2e half is
 * `skipUnlessBackendHoldsQaAccounts` in `./auth.ts`.
 */

export type BackendIdentity =
  /** A dev server on a loopback backend: the route-mock fixture. */
  | { kind: "loopback"; url: string }
  /** A dev server with no Supabase URL at all: the configuration screen. */
  | { kind: "unconfigured" }
  /** A dev server on a backend that is somewhere else, which may hold accounts. */
  | { kind: "remote"; url: string }
  /** Not a dev server module, so this says nothing either way. */
  | { kind: "unknown" };

/**
 * Vite writes the public environment into the head of every module it serves,
 * as `import.meta.env = {…};` with JSON string values. That line is the only
 * place the configured URL appears literally — `client.ts` itself only reads
 * `import.meta.env` — so it is what is parsed here.
 */
const ENV_PREAMBLE = "import.meta.env = {";
const SUPABASE_URL = /"VITE_SUPABASE_URL"\s*:\s*"([^"]*)"/;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]", "::1", "0.0.0.0"]);

export function readBackendIdentity(clientModuleSource: string): BackendIdentity {
  if (!clientModuleSource.includes(ENV_PREAMBLE)) return { kind: "unknown" };
  const url = SUPABASE_URL.exec(clientModuleSource)?.[1]?.trim() ?? "";
  if (url === "") return { kind: "unconfigured" };
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    // A value that is not a URL configures nothing usable either.
    return { kind: "unconfigured" };
  }
  return LOOPBACK_HOSTS.has(host.toLowerCase()) ? { kind: "loopback", url } : { kind: "remote", url };
}

/**
 * Why a QA account cannot be signed in here, or null when it might be.
 *
 * The sentence is the skip reason a reader sees in the runner's output, so it
 * names what was found and what to do about it rather than «not configured».
 */
export function whyQaSignInIsImpossible(identity: BackendIdentity): string | null {
  const cure =
    "point KUB_BASE_URL at a dev server carrying the production public configuration (CLAUDE.md section 5)";
  if (identity.kind === "loopback")
    return `the server under test is wired to ${identity.url}, a loopback backend the QA accounts do not exist in, so this signed-in spec cannot run here: ${cure}`;
  if (identity.kind === "unconfigured")
    return `the server under test carries no Supabase URL, so it renders the configuration screen and no account can be signed in: ${cure}`;
  return null;
}
