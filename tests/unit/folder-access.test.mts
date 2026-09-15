// D-202 / F-5: three spellings of «staff» met on the folders screen.
//
// `useFolders` asked the legacy `profiles.role` column alone; `FolderEditModal`
// asked the *wide* client `isStaff`, which a permission carried by a location
// role satisfies with no global role at all; and `public.folders` asks
// `is_manager_or_admin` for `shared` and `is_admin` for `system`. So three
// accounts on this deployment were offered the shared scope, allowed to create
// the folder by the database, and then shown no edit and no delete control on
// what they had just made.
//
// The policies quoted in `lib/folderAccess.ts` were read off production on
// 2026-09-15 with `pg_get_expr` over `pg_policy`.
//
// The second half of this file is about the *cost* of the fix rather than the
// rule: `useFolders` had to learn the caller's global roles, and the comment at
// the top of that hook records an anti-storm rule — it subscribes to primitives
// only, because `useHeartbeat` echoes rewrite the store constantly and a new
// non-primitive dependency on the fetcher would re-fetch on every echo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canCreateFolderWithScope,
  canManageFolder,
  folderCreatorId,
  type FolderAccessRow,
} from "../../artifacts/kub/src/lib/folderAccess.ts";

const ME = "11111111-1111-4111-8111-111111111111";
const SOMEBODY_ELSE = "22222222-2222-4222-8222-222222222222";

function folder(overrides: Partial<FolderAccessRow> = {}): FolderAccessRow {
  return {
    scope: "personal",
    user_id: ME,
    created_by: ME,
    ...overrides,
  } as FolderAccessRow;
}

/** The caller as the three predicates see them. */
type Caller = { isManagerOrAdmin: boolean; isAdmin: boolean };
const NOBODY: Caller = { isManagerOrAdmin: false, isAdmin: false };
/** A `manager`: `is_manager_or_admin` yes, `is_admin` no. */
const MANAGER: Caller = { isManagerOrAdmin: true, isAdmin: false };
/** An `owner` / `tech_admin` / `admin`: both. */
const ADMIN: Caller = { isManagerOrAdmin: true, isAdmin: true };

const may = (row: FolderAccessRow, caller: Caller, userId: string | null = ME) =>
  canManageFolder({ folder: row, userId, ...caller });

test("a personal folder is its owner's and nobody else's, whatever their role", () => {
  assert.equal(may(folder(), NOBODY), true);
  assert.equal(may(folder({ user_id: SOMEBODY_ELSE, created_by: SOMEBODY_ELSE }), ADMIN), false);
  // All 8 folders on this deployment are personal, so this line is the only one
  // here that describes what anybody sees today.
});

test("a shared folder answers to is_manager_or_admin — the defect, in one line", () => {
  const shared = folder({ scope: "shared", user_id: SOMEBODY_ELSE, created_by: SOMEBODY_ELSE });
  // What the three gap accounts used to get, because the legacy column said
  // `user` while `is_manager_or_admin` said yes.
  assert.equal(may(shared, ADMIN), true);
  assert.equal(may(shared, MANAGER), true);
  assert.equal(may(shared, NOBODY), false);
});

test("a shared folder also answers to its creator", () => {
  assert.equal(may(folder({ scope: "shared" }), NOBODY), true);
  // `coalesce(created_by, user_id)`, exactly as the policy spells it.
  assert.equal(may(folder({ scope: "shared", created_by: null }), NOBODY), true);
  assert.equal(
    may(folder({ scope: "shared", user_id: SOMEBODY_ELSE, created_by: null }), NOBODY),
    false,
  );
  assert.equal(folderCreatorId(folder({ created_by: null })), ME);
  assert.equal(folderCreatorId(folder({ created_by: SOMEBODY_ELSE })), SOMEBODY_ELSE);
});

test("a system folder answers to is_admin, which a manager is not", () => {
  const system = folder({ scope: "system", user_id: SOMEBODY_ELSE, created_by: SOMEBODY_ELSE });
  assert.equal(may(system, ADMIN), true);
  assert.equal(may(system, MANAGER), false);
  assert.equal(may(system, NOBODY), false);
  // And being its creator is not enough: the system branch of the policy has no
  // creator clause at all.
  assert.equal(may(folder({ scope: "system" }), MANAGER), false);
});

test("a signed-out reader manages nothing", () => {
  assert.equal(may(folder(), ADMIN, null), false);
  assert.equal(may(folder({ scope: "shared" }), ADMIN, null), false);
});

test("an unknown scope is refused rather than guessed", () => {
  assert.equal(may(folder({ scope: "archived" } as never), ADMIN), false);
});

test("the insert policy: personal is open, anything else needs is_manager_or_admin", () => {
  assert.equal(canCreateFolderWithScope("personal", false), true);
  assert.equal(canCreateFolderWithScope("shared", false), false);
  assert.equal(canCreateFolderWithScope("shared", true), true);
  // `folders insert scope-aware` asks `is_manager_or_admin` for `system` too,
  // even though `is_admin` guards it afterwards. Copied, not improved on.
  assert.equal(canCreateFolderWithScope("system", true), true);
  assert.equal(canCreateFolderWithScope("system", false), false);
});

// ── The anti-storm rule the fix had to respect ──────────────────────────────
//
// These read the hook's source. That is a weak form of proof on its own — it
// cannot see behaviour — so it is doing one narrow job: turning the comment at
// the top of `useFolders` into something that fails when somebody ignores it.
// The strong half is that the two new values enter the hook as booleans, and a
// boolean has no identity to rotate.

const HOOK = readFileSync(
  new URL("../../artifacts/kub/src/hooks/useFolders.ts", import.meta.url),
  "utf8",
);

type DepArray = { anchor: string; deps: string[] };

function dependencyArrays(source: string): DepArray[] {
  const found: DepArray[] = [];
  const closing = /[)}]\s*,\s*\[([^\]]*)\]\s*\)/g;
  const anchors = /(?:const\s+(\w+)\s*=\s*use(?:Callback|Memo)\()|(?:\buseEffect\()/g;
  const anchorPositions: { index: number; name: string }[] = [];
  let anchorMatch: RegExpExecArray | null;
  while ((anchorMatch = anchors.exec(source)) !== null) {
    anchorPositions.push({ index: anchorMatch.index, name: anchorMatch[1] ?? "useEffect" });
  }
  let match: RegExpExecArray | null;
  while ((match = closing.exec(source)) !== null) {
    const before = anchorPositions.filter((a) => a.index < match!.index);
    const anchor = before.length ? before[before.length - 1].name : "(none)";
    const deps = match[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    found.push({ anchor, deps });
  }
  return found;
}

const DEPS = dependencyArrays(HOOK);
const depsOf = (anchor: string) => DEPS.filter((entry) => entry.anchor === anchor).map((e) => e.deps);

test("the scanner found the hook's dependency arrays at all", () => {
  // Without this, every assertion below could pass by finding nothing.
  assert.ok(DEPS.length >= 8, `found ${DEPS.length} dependency arrays`);
  assert.deepEqual(depsOf("fetchFolders").length, 1);
  assert.deepEqual(depsOf("canManageFolder").length, 1);
});

test("the fetcher still depends on the caller's id and the client, and on nothing else", () => {
  // This is the whole anti-storm rule in one assertion. Neither role predicate
  // belongs here: who you are does not change which rows RLS hands back to a
  // `select *` on `folders`, only which controls are drawn on them.
  assert.deepEqual(depsOf("fetchFolders")[0], ["userId", "supabase"]);
});

test("the refetch and realtime effects keep their primitive dependencies", () => {
  const effectDeps = depsOf("useEffect");
  assert.ok(
    effectDeps.some((deps) => deps.length === 1 && deps[0] === "fetchFolders"),
    "the effect that calls the fetcher must depend on the fetcher alone",
  );
  assert.ok(
    effectDeps.some((deps) => deps.join(",") === "userId,rt"),
    "the realtime subscription must depend on the user id and the realtime client",
  );
});

test("the two role predicates reach the hook as booleans, not as objects", () => {
  // Destructured at the call site: `allowed` is a boolean, so it cannot carry an
  // identity that rotates a `useCallback` on a heartbeat echo. Holding the
  // returned object instead would reintroduce exactly the dependency the
  // anti-storm comment forbids.
  assert.match(HOOK, /const \{ allowed: isManagerOrAdmin \} = useMatchesIsManagerOrAdmin\(\);/);
  assert.match(HOOK, /const \{ allowed: isServerAdmin \} = useMatchesIsAdmin\(\);/);
  assert.deepEqual(depsOf("canManageFolder")[0], ["userId", "isManagerOrAdmin", "isServerAdmin"]);
});

test("the store is still read through primitive selectors only", () => {
  const selectors = [...HOOK.matchAll(/useAppStore\(([^;]*?)\)(?:\s+as\b|;)/g)].map((m) =>
    m[1].replace(/\s+/g, " ").trim(),
  );
  assert.deepEqual(selectors, [
    "(s) => s.currentUser?.id ?? null",
    "(s) => s.currentUser?.role ?? null",
  ]);
});

test("the hook no longer spells the rule itself", () => {
  // The defect was a copy, so the guard is that there is no copy left to drift.
  assert.equal(HOOK.includes('role === "admin" || role === "manager"'), false);
  assert.match(HOOK, /from "@\/lib\/folderAccess"/);
});

test("the modal that offers the shared scope asks the same predicate", () => {
  // The third spelling. `useIsManagerOrAdmin` is the *wide* client `isStaff`,
  // which a permission on a location role satisfies with no global role at all,
  // so the modal used to offer a scope the insert policy then refuses — the
  // same defect as the sidebar's, pointing the other way. If these two ever ask
  // different questions again, one person is told two different things on one
  // screen.
  const MODAL = readFileSync(
    new URL("../../artifacts/kub/src/components/sidebar/FolderEditModal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(MODAL, /const \{ allowed: canUseSharedScope \} = useMatchesIsManagerOrAdmin\(\);/);
  assert.match(MODAL, /const showScopeSelector = canUseSharedScope && !folder;/);
  assert.equal(
    MODAL.includes("useIsManagerOrAdmin"),
    false,
    "the modal went back to the wide client predicate",
  );
});
