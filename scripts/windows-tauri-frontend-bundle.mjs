import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Whether `artifacts/kub/dist/public` can do what the Windows QA gate asks of it.
 *
 * The gate signs a QA account in against that bundle. Five times in one week it
 * had been rebuilt without the public Supabase configuration — the validation
 * build in CLAUDE.md §5 sets no VITE_* variable at all — and each time the gate
 * ran for minutes, then failed on a login form that was never drawn, while the
 * page said "Подключение к серверу не настроено". Every one of those read as a
 * product regression. A gate has to check its own input before it reports on
 * anything else, and say what is wrong with it.
 *
 * Three things are checked, and nothing is printed that the bundle carries:
 *
 * - the bundle exists;
 * - it is configured by the application's own rule, with an address that is a
 *   real backend — not the loopback fixture the routing matrix builds with;
 * - it is not older than the sources it was built from, because a bundle that
 *   predates the working tree tests somebody else's code.
 *
 * Vite inlines `import.meta.env` wherever the whole object is read, which is how
 * `lib/supabase/client.ts` reads it, so the values sit in the bundle as
 * `VITE_SUPABASE_URL:"…"` pairs. If a future build stopped emitting them this
 * refuses loudly rather than passing, which is the safe way to be wrong.
 */

const KUB = ["artifacts", "kub"];
const PUBLIC_ROOT = [...KUB, "dist", "public"];
/** What a rebuild of the bundle is made from. */
export const FRONTEND_SOURCES = Object.freeze([
  [...KUB, "src"],
  [...KUB, "public"],
  [...KUB, "index.html"],
  [...KUB, "vite.config.ts"],
  [...KUB, "package.json"],
]);

const REBUILD =
  "Rebuild it before running this gate, with the public configuration the deployed bundle carries " +
  "(never print those values): PORT=5173 BASE_PATH=/ VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… " +
  "pnpm.cmd --filter @workspace/kub run build — and from Git Bash add MSYS2_ENV_CONV_EXCL=BASE_PATH.";

/**
 * The application's rule, from `artifacts/kub/src/lib/supabase/config.ts`,
 * restated because this runs where TypeScript cannot be imported. A unit test
 * holds the two to the same answers.
 */
export function bundleSupabaseConfig(env) {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
  return { url, key, configured: Boolean(url && key) };
}

/** The public configuration a built bundle carries, as `VITE_*` name → value. */
export function readBundleEnvironment(publicRoot) {
  const env = {};
  const assets = path.join(publicRoot, "assets");
  if (!existsSync(assets)) return env;
  for (const name of readdirSync(assets)) {
    if (!name.endsWith(".js")) continue;
    const text = readFileSync(path.join(assets, name), "utf8");
    for (const match of text.matchAll(/\b(VITE_SUPABASE_(?:URL|ANON_KEY|PUBLISHABLE_KEY)):"([^"]*)"/g)) {
      if (env[match[1]] === undefined || env[match[1]] === "") env[match[1]] = match[2];
    }
  }
  return env;
}

/**
 * @param {string} root repository root
 * @returns {{ ok: true } | { ok: false, reason: "missing" | "unconfigured" | "not-a-backend" | "stale", message: string }}
 */
export function inspectLocalFrontendBundle(root) {
  const publicRoot = path.join(root, ...PUBLIC_ROOT);
  const index = path.join(publicRoot, "index.html");
  const shown = PUBLIC_ROOT.join("/");
  if (!existsSync(index)) {
    return refuse("missing", `${shown} has not been built, and this gate signs in against it. ${REBUILD}`);
  }

  const config = bundleSupabaseConfig(readBundleEnvironment(publicRoot));
  if (!config.configured) {
    const missing = [
      config.url ? null : "VITE_SUPABASE_URL",
      config.key ? null : "a key (VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY)",
    ].filter(Boolean);
    return refuse(
      "unconfigured",
      `${shown} was built without ${missing.join(" and ")}, so every page it serves says ` +
        `"Подключение к серверу не настроено" and no QA account can sign in. ${REBUILD}`,
    );
  }

  let address = null;
  try {
    address = new URL(config.url);
  } catch {
    address = null;
  }
  const loopback =
    address !== null &&
    (/^(localhost|\[::1\])$/i.test(address.hostname) || /^127\./.test(address.hostname));
  if (address === null || address.protocol !== "https:" || loopback) {
    return refuse(
      "not-a-backend",
      `${shown} was built against ${address === null ? "an address that is not a URL" : loopback ? "a loopback address" : "a plain-HTTP address"}, ` +
        "not the real backend — the routing matrix's fixture (http://127.0.0.1:54321) is one such build — " +
        `so no QA account can sign in. ${REBUILD}`,
    );
  }

  const builtAt = statSync(index).mtimeMs;
  const newer = newestSource(root);
  if (newer && newer.mtimeMs > builtAt) {
    return refuse(
      "stale",
      `${shown} is older than ${newer.relative}, so it is not the code in this checkout. ${REBUILD}`,
    );
  }
  return { ok: true };
}

function refuse(reason, message) {
  return { ok: false, reason, message };
}

function newestSource(root) {
  let newest = null;
  const visit = (absolute) => {
    if (!existsSync(absolute)) return;
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute)) visit(path.join(absolute, entry));
      return;
    }
    if (!newest || stat.mtimeMs > newest.mtimeMs) {
      newest = { mtimeMs: stat.mtimeMs, relative: path.relative(root, absolute).replace(/\\/g, "/") };
    }
  };
  for (const parts of FRONTEND_SOURCES) visit(path.join(root, ...parts));
  return newest;
}
