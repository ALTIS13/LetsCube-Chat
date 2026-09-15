import { type APIRequestContext, type Page, type Route, expect } from "@playwright/test";

/**
 * A backend for the administration and support specs, played by route mocks on
 * the DEV fixture host — the pattern `messageActionsFixture.ts` set, for the
 * screens behind `/admin` instead of the conversation.
 *
 * Why a fixture rather than a QA sign-in, as `support-operator.spec.ts` and
 * `admin-create-sections.spec.ts` do it: the frames this produces are meant to
 * be looked at, and a signed-in run reaches production for the session even
 * when every row on the screen is mocked. Nothing here touches any backend —
 * the session is injected, `/auth/v1/user` is answered locally, and every
 * request to a host that is not this machine is aborted.
 *
 * It also buys something a QA account cannot give: the permissions are an
 * argument. Two of the defects in this batch are about somebody who holds a
 * *narrower* set than any QA account does — an administrator without
 * `system.manage`, an operator without `support.transfer` — and there is no
 * account on the deployment to sign in as.
 */

export const FIXTURE_HOST = "http://127.0.0.1:54321";
export const EPOCH = "2026-09-01T09:00:00.000Z";

export type Row = Record<string, unknown>;

export interface FixturePerson {
  id: string;
  full_name: string;
  username: string | null;
  avatar_url: null;
  bio: null;
  role: string;
  online_at: string;
  created_at: string;
  updated_at: string;
}

export function person(id: string, fullName: string, username: string | null = null): FixturePerson {
  return {
    id,
    full_name: fullName,
    username,
    avatar_url: null,
    bio: null,
    // The legacy column. `user` on purpose: every predicate under test must be
    // reached through the dynamic roles, which is how this deployment's own
    // owner and technical administrator are shaped (three of eighteen accounts
    // hold a global role and `profiles.role = 'user'`).
    role: "user",
    online_at: EPOCH,
    created_at: EPOCH,
    updated_at: EPOCH,
  };
}

/** How a mocked database function answers. */
export type RpcAnswer = { status?: number; body: unknown };

export interface AdminFixtureOptions {
  me: FixturePerson;
  /** `current_user_access_snapshot().global_role_keys`. */
  globalRoleKeys?: string[];
  /** `current_user_access_snapshot().global_permission_keys`. */
  globalPermissionKeys?: string[];
  /** Everybody else, for the reads that ask about a person by id. */
  people?: FixturePerson[];
  /** Rows by table name. A table not listed here answers with nothing. */
  tables?: Record<string, Row[]>;
  /**
   * Answers a database function. `undefined` leaves the default, which is
   * `null` with 200 — what PostgREST returns for a function with no rows.
   */
  rpc?: (name: string, body: Row) => RpcAnswer | undefined;
  /** Makes one table call fail, so a refusal path can be measured. */
  rest?: (call: { resource: string; method: string }) => RpcAnswer | undefined;
  theme?: "light" | "dark";
}

export interface AdminFixture {
  /** Every request that reached the mocked backend, newest last. */
  requests: { method: string; resource: string; search: string }[];
  /** How many times a table was read. */
  reads(resource: string): number;
}

export async function requireFixtureServer(request: APIRequestContext) {
  const client = await request
    .get("/src/lib/supabase/client.ts")
    .then((response) => response.text())
    .catch(() => "");
  if (!client.includes(FIXTURE_HOST)) {
    throw new Error(
      `This spec mocks the backend at ${FIXTURE_HOST}. Start the dev server with ` +
        `VITE_SUPABASE_URL=${FIXTURE_HOST} and VITE_SUPABASE_ANON_KEY=playwright-public-fixture; ` +
        "it will not run against any other configuration.",
    );
  }
}

async function json(route: Route, body: unknown, status = 200, headers?: Record<string, string>) {
  await route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
}

/**
 * The PostgREST filters these screens actually send, applied generically.
 *
 * `eq`, `is.null`, `in.(…)` and `not.in.(…)` — enough for the support queue's
 * six filters and for the reads behind «Инвайты» and «Локации». Anything else
 * is ignored rather than guessed at, and a spec that needs more should say so
 * with `tables` rather than growing this.
 */
function applyFilters(rows: Row[], search: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, raw] of search.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
    const value = decodeURIComponent(raw);
    if (value === "is.null") {
      out = out.filter((row) => row[key] === null || row[key] === undefined);
    } else if (value.startsWith("eq.")) {
      const wanted = value.slice(3);
      out = out.filter((row) => String(row[key] ?? "") === wanted);
    } else if (value.startsWith("in.")) {
      const wanted = listValues(value.slice(3));
      out = out.filter((row) => wanted.has(String(row[key] ?? "")));
    } else if (value.startsWith("not.in.")) {
      const wanted = listValues(value.slice(7));
      out = out.filter((row) => !wanted.has(String(row[key] ?? "")));
    }
  }
  return out;
}

function listValues(value: string): Set<string> {
  return new Set(
    value
      .replace(/^\(/, "")
      .replace(/\)$/, "")
      .split(",")
      .map((entry) => entry.replace(/^"|"$/g, "")),
  );
}

function sortRows(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const clauses = order.split(",").map((clause) => {
    const [field, ...rest] = clause.split(".");
    return { field, descending: rest.includes("desc") };
  });
  return [...rows].sort((a, b) => {
    for (const { field, descending } of clauses) {
      const left = a[field];
      const right = b[field];
      if (left === right) continue;
      const compared =
        typeof left === "boolean" || typeof right === "boolean"
          ? Number(Boolean(right)) - Number(Boolean(left))
          : String(left ?? "").localeCompare(String(right ?? ""));
      return descending ? -compared : compared;
    }
    return 0;
  });
}

export async function openAdminFixture(page: Page, options: AdminFixtureOptions): Promise<AdminFixture> {
  const { me } = options;
  const requests: AdminFixture["requests"] = [];
  const fixture: AdminFixture = {
    requests,
    reads: (resource) => requests.filter((entry) => entry.resource === resource && entry.method === "GET").length,
  };

  await page.route(
    (url) =>
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname !== "127.0.0.1" &&
      url.hostname !== "localhost",
    (route) => route.abort("blockedbyclient"),
  );

  await page.addInitScript(
    ({ user, now, theme }) => {
      localStorage.setItem("kub-theme", theme);
      localStorage.setItem(
        "kub-auth",
        JSON.stringify({
          access_token: "playwright.user.jwt",
          refresh_token: "playwright-refresh",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: "bearer",
          user: {
            id: user.id,
            aud: "authenticated",
            role: "authenticated",
            email: "admin-fixture@example.invalid",
            user_metadata: { full_name: user.full_name },
            app_metadata: {},
            created_at: now,
          },
        }),
      );
    },
    { user: me, now: EPOCH, theme: options.theme ?? "dark" },
  );

  await page.route(`${FIXTURE_HOST}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const single = (request.headers().accept ?? "").includes("application/vnd.pgrst.object");
    const isRest = url.pathname.startsWith("/rest/v1/");
    const resource = isRest ? url.pathname.slice("/rest/v1/".length) : url.pathname;
    requests.push({ method, resource, search: url.search });

    if (method === "OPTIONS") return route.fulfill({ status: 204 });
    if (url.pathname === "/auth/v1/user") {
      return json(route, {
        id: me.id,
        aud: "authenticated",
        role: "authenticated",
        email: "admin-fixture@example.invalid",
        user_metadata: { full_name: me.full_name },
        app_metadata: {},
        created_at: EPOCH,
      });
    }
    if (!isRest) return json(route, single ? null : {});

    const refusal = options.rest?.({ resource, method });
    if (refusal) return json(route, refusal.body, refusal.status ?? 400);

    if (resource.startsWith("rpc/")) {
      const name = resource.slice(4);
      let body: Row = {};
      try {
        body = (request.postDataJSON() ?? {}) as Row;
      } catch {
        body = {};
      }
      // The three the access layer asks, all three of them: the snapshot is
      // behind `VITE_ACCESS_SNAPSHOT_RPC_ENABLED`, and with it off the hooks
      // fall back to one `has_permission` per key and one `has_global_role` per
      // role. Answering only the snapshot left every permission false and the
      // administration redirected the fixture straight back to the chat list.
      if (name === "current_user_access_snapshot") {
        return json(route, {
          global_role_keys: options.globalRoleKeys ?? [],
          global_permission_keys: options.globalPermissionKeys ?? [],
          location_permissions: {},
        });
      }
      if (name === "has_permission") {
        return json(route, (options.globalPermissionKeys ?? []).includes(String(body.p_permission_key)));
      }
      if (name === "has_global_role") {
        return json(route, (options.globalRoleKeys ?? []).includes(String(body.p_role_key)));
      }
      if (name === "has_location_permission") return json(route, false);
      const answer = options.rpc?.(name, body);
      if (!answer) return json(route, null);
      return json(route, answer.body, answer.status ?? 200);
    }

    if (resource === "profiles") {
      const everyone = [me, ...(options.people ?? [])];
      const rows = applyFilters(everyone as unknown as Row[], url.searchParams);
      return json(route, single ? (rows[0] ?? null) : rows);
    }

    if (method !== "GET") return json(route, single ? null : []);
    const held = options.tables?.[resource] ?? [];
    const filtered = sortRows(applyFilters(held, url.searchParams), url.searchParams.get("order"));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const start = Number.isFinite(offset) && offset > 0 ? offset : 0;
    const limit = Number(url.searchParams.get("limit") ?? filtered.length);
    const page = filtered.slice(start, start + (Number.isFinite(limit) ? limit : filtered.length));
    return json(route, single ? (page[0] ?? null) : page);
  });

  return fixture;
}

/** The theme is stamped rather than toggled, so a frame cannot be captured mid-swap. */
export async function stampTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value as string);
    root.style.colorScheme = value as string;
  }, theme);
  await page.evaluate(() => document.fonts.ready);
}

/** Positive proof the administration shell mounted rather than redirected. */
export async function openAdmin(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-shell")).toBeVisible();
}
