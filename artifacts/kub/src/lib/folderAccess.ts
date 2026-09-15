/**
 * Who may rename, re-scope, delete or re-fill a folder — written to match the
 * `public.folders` policies rather than a neighbouring idea of «staff».
 *
 * The three scope-aware policies, read off production on 2026-09-15:
 *
 *     folders insert scope-aware   WITH CHECK
 *       user_id = auth.uid()
 *       and coalesce(created_by, user_id) = auth.uid()
 *       and (scope = 'personal' or is_manager_or_admin(auth.uid()))
 *
 *     folders update scope-aware / folders delete scope-aware   USING
 *       (scope = 'personal' and user_id = auth.uid())
 *       or (scope = 'shared'
 *           and (is_manager_or_admin(auth.uid())
 *                or coalesce(created_by, user_id) = auth.uid()))
 *       or (scope = 'system' and is_admin(auth.uid()))
 *
 * Note the two different database functions: `shared` is governed by
 * `is_manager_or_admin`, `system` by `is_admin`, and they differ by the
 * `manager` role key. Creating a `system` folder, oddly, only needs
 * `is_manager_or_admin` — that is what the insert policy says, and
 * `canCreateFolderWithScope` copies it rather than improving on it.
 *
 * **Three spellings of one rule used to meet on this screen** (D-202 / F-5):
 * `useFolders` asked the legacy `profiles.role` column alone, the folder modal
 * asked the *wide* client `isStaff` — which a permission on a location role can
 * satisfy with no global role at all — and the database asked
 * `is_manager_or_admin`. The narrow spelling hid edit and delete from three
 * accounts the database would have allowed; the wide one offers the shared
 * scope to people the database refuses. Both callers now pass the booleans from
 * `lib/serverRoleAccess.ts`, which is a copy of the database functions and of
 * nothing else.
 *
 * `personal` never consults a role: it is the owner's row and nobody else's.
 * All 8 folders on this deployment are `personal`, so every branch below except
 * that one is latent today — which is the reason to get it right cheaply now
 * rather than under pressure later.
 *
 * Deliberately **not** copied here: the older permissive policy
 * `Users can manage own folders` (`ALL USING auth.uid() = user_id`), which ORs
 * with the scope-aware ones and so also admits the `user_id` owner of a
 * non-personal folder. It can only widen the answer where
 * `created_by <> user_id`, a shape the insert policy cannot produce; production
 * has no such row (8 folders, `created_by` never null and never differing).
 * Copying it would make the client offer controls on a row whose existence the
 * server-side rules do not admit.
 */

import type { Folder } from "@/types/database";

/** What the rule needs from a folder row. */
export type FolderAccessRow = Pick<Folder, "scope" | "user_id" | "created_by">;

export interface FolderAccessInput {
  folder: FolderAccessRow;
  /** The signed-in account, or null while it is unknown. */
  userId: string | null | undefined;
  /** `public.is_manager_or_admin(auth.uid())`, from `matchesIsManagerOrAdmin`. */
  isManagerOrAdmin: boolean;
  /** `public.is_admin(auth.uid())`, from `matchesIsAdmin`. */
  isAdmin: boolean;
}

/** The creator of a folder as `coalesce(created_by, user_id)` spells it. */
export function folderCreatorId(folder: FolderAccessRow): string | null {
  return folder.created_by ?? folder.user_id ?? null;
}

/**
 * True when `folders update scope-aware` and `folders delete scope-aware` would
 * both admit this caller for this row.
 */
export function canManageFolder(input: FolderAccessInput): boolean {
  const { folder, userId, isManagerOrAdmin, isAdmin } = input;
  if (!userId) return false;
  if (folder.scope === "personal") return folder.user_id === userId;
  if (folder.scope === "shared") {
    return isManagerOrAdmin || folderCreatorId(folder) === userId;
  }
  if (folder.scope === "system") return isAdmin;
  return false;
}

/**
 * True when `folders insert scope-aware` would admit a new folder of this
 * scope. The row's `user_id` and `created_by` are the caller by construction.
 */
export function canCreateFolderWithScope(
  scope: FolderAccessRow["scope"],
  isManagerOrAdmin: boolean,
): boolean {
  if (scope === "personal") return true;
  return isManagerOrAdmin;
}
