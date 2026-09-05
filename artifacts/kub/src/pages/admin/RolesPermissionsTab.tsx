"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubBadge, KubButton, KubCreateSection, KubHelpNotes, KubIcon, KubInput, KubNotice, KubPanel } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useDynamicRoles, useDynamicRolesEnabledPreference } from "@/hooks/useDynamicRoles";
import { clearRoleAccessCache } from "@/hooks/useRole";
import { useAppStore } from "@/store/app.store";
import {
  PERMISSION_CATEGORY_DESCRIPTION,
  PERMISSION_CATEGORY_ORDER,
  ROLE_SCOPE_LABEL,
  ROLES_PERMISSIONS_REQUIRED_MESSAGE,
  getPermissionCategory,
  getPermissionCategoryLabel,
  getPermissionDescription,
  getPermissionLabel,
  getRoleScopeDescription,
  getRoleLabel,
  hasRolesPermissionsPreference,
  isCriticalRoleKey,
  mapRolesPermissionsError,
} from "@/lib/rolePermissions";
import {
  ROLE_PRIORITY_MAX,
  ROLE_PRIORITY_MIN,
  buildRoleHierarchy,
  normalizeRoleColour,
  parseRolePriorityInput,
  planPriorityMove,
  roleFormSignature,
  roleSwatchColour,
  sortRolesByHierarchy,
  type PriorityMoveDirection,
} from "@/lib/roleHierarchy";
import type { DynamicRole, Permission, Profile, RoleScope } from "@/types/database";
import { cn } from "@/lib/utils";
import { requestAppConfirm } from "@/lib/appDialogs";

const ROLE_SCOPES: RoleScope[] = ["global", "location", "chat"];
const ROLE_KEY_RE = /^[a-z][a-z0-9_]{1,48}$/;

/** Where the native picker starts for a role that has no colour of its own. */
const COLOUR_PICKER_FALLBACK = "#4d8bd0";

const PRIORITY_IS_NOT_POWER =
  "Порядок — только внешний вид списка. Он не даёт роли прав: доступ решают отмеченные ниже права, " +
  "а у владельца и тех. администратора он всегда полный.";

export function RolesPermissionsTab() {
  const supabase = createClient();
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);
  const [rolesProbeEnabled, setRolesProbeEnabled] = useDynamicRolesEnabledPreference();
  const rolesState = useDynamicRoles({ enabled: rolesProbeEnabled, includeAssignments: true });
  const [autoProbeAttempted, setAutoProbeAttempted] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [locationRoleUsage, setLocationRoleUsage] = useState<Map<string, number>>(new Map());
  const [locationRoleUsageKnown, setLocationRoleUsageKnown] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createKey, setCreateKey] = useState("");
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createScope, setCreateScope] = useState<RoleScope>("global");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editPriority, setEditPriority] = useState("0");
  const [editColour, setEditColour] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());
  const [openCategories, setOpenCategories] = useState<Set<string>>(() => new Set());
  const [assignUserId, setAssignUserId] = useState("");
  const [assignRoleId, setAssignRoleId] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The order the panel shows, which is also the order the fallback selection
  // and the assignment picker follow, so the same ladder is never drawn twice
  // in two different orders.
  const orderedRoles = useMemo(() => sortRolesByHierarchy(rolesState.roles), [rolesState.roles]);
  const roleHierarchy = useMemo(() => buildRoleHierarchy(rolesState.roles), [rolesState.roles]);

  const selectedRole = useMemo(
    () => rolesState.roles.find((role) => role.id === selectedRoleId) ?? orderedRoles[0] ?? null,
    [orderedRoles, rolesState.roles, selectedRoleId],
  );
  const selectedRoleIsCritical = selectedRole ? isCriticalRoleKey(selectedRole.key) : false;
  const selectedRoleUsageCount = useMemo(() => {
    if (!selectedRole) return 0;
    return rolesState.userGlobalRoles.filter((assignment) => assignment.role_id === selectedRole.id).length +
      (locationRoleUsage.get(selectedRole.id) ?? 0);
  }, [locationRoleUsage, rolesState.userGlobalRoles, selectedRole]);
  const selectedRoleUsageKnown = selectedRole?.scope === "location" ? locationRoleUsageKnown : true;
  const selectedRoleDeleteLabel =
    selectedRoleUsageKnown && selectedRoleUsageCount === 0 ? "Удалить роль" : "Отключить роль";

  const globalRoles = useMemo(
    () => orderedRoles.filter((role) => role.scope === "global" && role.is_active),
    [orderedRoles],
  );

  const permissionGroups = useMemo(() => {
    const groups = new Map<string, Permission[]>();
    for (const permission of rolesState.permissions) {
      const category = getPermissionCategory(permission);
      const current = groups.get(category) ?? [];
      current.push(permission);
      groups.set(category, current);
    }
    return Array.from(groups.entries())
      .map(([category, permissions]) => [
        category,
        permissions.sort((a, b) => getPermissionLabel(a).localeCompare(getPermissionLabel(b), "ru-RU")),
      ] as const)
      .sort(([a], [b]) => {
        const ai = PERMISSION_CATEGORY_ORDER.indexOf(a);
        const bi = PERMISSION_CATEGORY_ORDER.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
      });
  }, [rolesState.permissions]);

  const allCategoriesOpen =
    permissionGroups.length > 0 && permissionGroups.every(([category]) => openCategories.has(category));

  const roleAssignments = useMemo(() => {
    const roleMap = new Map(rolesState.roles.map((role) => [role.id, role]));
    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
    return rolesState.userGlobalRoles
      .map((assignment) => ({
        assignment,
        role: roleMap.get(assignment.role_id) ?? null,
        profile: profileMap.get(assignment.user_id) ?? null,
      }))
      .filter((row) => row.role && row.profile)
      .sort((a, b) =>
        getProfileName(a.profile).localeCompare(getProfileName(b.profile), "ru-RU")
        || getRoleLabel(a.role).localeCompare(getRoleLabel(b.role), "ru-RU"),
      );
  }, [profiles, rolesState.roles, rolesState.userGlobalRoles]);

  const currentAccess = useMemo(() => {
    const roleMap = new Map(rolesState.roles.map((role) => [role.id, role]));
    const permissionKeys = new Set<string>();
    let critical = false;
    if (!currentUserId) return { critical, permissionKeys };
    const assignedRoleIds = rolesState.userGlobalRoles
      .filter((assignment) => assignment.user_id === currentUserId)
      .map((assignment) => assignment.role_id);
    for (const roleId of assignedRoleIds) {
      const role = roleMap.get(roleId);
      if (!role || role.scope !== "global" || !role.is_active) continue;
      if (isCriticalRoleKey(role.key)) critical = true;
      for (const permission of rolesState.rolePermissions) {
        if (permission.role_id === role.id) permissionKeys.add(permission.permission_key);
      }
    }
    return { critical, permissionKeys };
  }, [currentUserId, rolesState.rolePermissions, rolesState.roles, rolesState.userGlobalRoles]);

  const canManageRoles =
    currentAccess.critical ||
    currentAccess.permissionKeys.has("roles.manage") ||
    currentAccess.permissionKeys.has("permissions.manage");
  const canAssignGlobalRoles = canManageRoles || currentAccess.permissionKeys.has("users.assign_roles");
  const assignableGlobalRoles = useMemo(
    () => globalRoles.filter((role) => currentAccess.critical || !isCriticalRoleKey(role.key)),
    [currentAccess.critical, globalRoles],
  );

  useEffect(() => {
    if (autoProbeAttempted) return;
    setAutoProbeAttempted(true);
    if (!rolesProbeEnabled && !hasRolesPermissionsPreference()) setRolesProbeEnabled(true);
  }, [autoProbeAttempted, rolesProbeEnabled, setRolesProbeEnabled]);

  // Refilling the form is not free: it discards whatever is in the boxes. The
  // effect below re-runs whenever any role or any role's permissions change
  // anywhere, which used to mean a realtime event about an unrelated role threw
  // away half-typed text. The signature narrows that to the selected role's own
  // data, so the form is refilled after a save and when somebody else edits
  // this very role, and left alone otherwise.
  const formSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedRole) return;
    const permissionKeys = rolesState.rolePermissions
      .filter((item) => item.role_id === selectedRole.id)
      .map((item) => item.permission_key);
    const signature = roleFormSignature(selectedRole, permissionKeys);
    if (formSignatureRef.current === signature) return;
    formSignatureRef.current = signature;
    setSelectedRoleId(selectedRole.id);
    setEditName(selectedRole.name);
    setEditDescription(selectedRole.description ?? "");
    setEditActive(selectedRole.is_active);
    setEditPriority(String(selectedRole.priority));
    setEditColour(selectedRole.colour ?? "");
    setSelectedPermissions(new Set(permissionKeys));
  }, [rolesState.rolePermissions, selectedRole]);

  useEffect(() => {
    if (!rolesState.available) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("*")
      .order("full_name", { ascending: true, nullsFirst: false })
      .limit(400)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          if (import.meta.env.DEV) console.warn("[roles] profiles failed", error);
          return;
        }
        setProfiles((data ?? []) as Profile[]);
      });
    return () => {
      cancelled = true;
    };
  }, [rolesState.available, supabase]);

  useEffect(() => {
    if (!rolesState.available) return;
    let cancelled = false;
    supabase
      .from("location_members")
      .select("role_id")
      .not("role_id", "is", null)
      .limit(5000)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          if (import.meta.env.DEV) console.warn("[roles] location role usage failed", error);
          setLocationRoleUsage(new Map());
          setLocationRoleUsageKnown(false);
          return;
        }
        const counts = new Map<string, number>();
        for (const row of (data ?? []) as { role_id: string | null }[]) {
          if (!row.role_id) continue;
          counts.set(row.role_id, (counts.get(row.role_id) ?? 0) + 1);
        }
        setLocationRoleUsage(counts);
        setLocationRoleUsageKnown(true);
      });
    return () => {
      cancelled = true;
    };
  }, [rolesState.available, supabase]);

  const runAction = useCallback(async (
    key: string,
    fn: () => PromiseLike<{ error: unknown; data?: unknown }>,
    success: string,
  ) => {
    setSaving(key);
    setNotice(null);
    setError(null);
    const result = await fn();
    setSaving(null);
    if (result.error) {
      setError(mapRolesPermissionsError(result.error));
      return false;
    }
    setNotice(success);
    await rolesState.refetch();
    return true;
  }, [rolesState]);

  const toggleCategory = (category: string) => {
    setOpenCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const createRole = async () => {
    if (!canManageRoles) {
      setError("Недостаточно прав для управления ролями.");
      return;
    }
    const key = createKey.trim();
    if (!ROLE_KEY_RE.test(key)) {
      setError("Ключ роли должен быть в формате snake_case и начинаться с буквы.");
      return;
    }
    if (!createName.trim()) {
      setError("Нужно указать название роли.");
      return;
    }
    const ok = await runAction(
      "create-role",
      () => supabase.rpc("role_create", {
        p_key: key,
        p_name: createName.trim(),
        p_description: createDescription.trim() || null,
        p_scope: createScope,
      }),
      "Роль создана. Она появилась внизу своей области — поднимите её на нужное место.",
    );
    if (ok) {
      setCreateKey("");
      setCreateName("");
      setCreateDescription("");
      setCreateScope("global");
    }
  };

  const saveRole = async () => {
    if (!selectedRole) return;
    if (!canManageRoles) {
      setError("Недостаточно прав для управления ролями.");
      return;
    }
    if (!editName.trim()) {
      setError("Нужно указать название роли.");
      return;
    }
    const priority = parseRolePriorityInput(editPriority);
    if (priority === null) {
      setError(`Ранг должен быть целым числом от ${ROLE_PRIORITY_MIN} до ${ROLE_PRIORITY_MAX}.`);
      return;
    }
    // An empty box means "leave the colour as it is", because that is what the
    // RPC does with a null: `colour = coalesce(p_colour, colour)`. There is no
    // value that clears a colour, which the hint under the field says out loud.
    const colourText = editColour.trim();
    const colour = colourText ? normalizeRoleColour(colourText) : null;
    if (colourText && colour === null) {
      setError("Цвет должен быть в формате #rrggbb, например #4d8bd0.");
      return;
    }
    await runAction(
      "save-role",
      () => supabase.rpc("role_update", {
        p_role_id: selectedRole.id,
        p_name: editName.trim(),
        p_description: editDescription.trim() || null,
        p_is_active: editActive,
        p_priority: priority,
        p_colour: colour,
      }),
      "Роль обновлена.",
    );
  };

  const moveRole = async (role: DynamicRole, direction: PriorityMoveDirection) => {
    if (!canManageRoles) {
      setError("Недостаточно прав для управления ролями.");
      return;
    }
    const target = planPriorityMove(rolesState.roles, role.id, direction);
    if (target === null) return;
    await runAction(
      `move-role-${role.id}`,
      // `role_update` rewrites the name, the description and the active flag
      // from its arguments, and reads a null `p_is_active` as `true`. The row's
      // own values are sent back so that reordering cannot rename a role, wipe
      // its description, or revive one that was deliberately deactivated — and
      // so that unsaved text in the form is not committed by an arrow press.
      () => supabase.rpc("role_update", {
        p_role_id: role.id,
        p_name: role.name,
        p_description: role.description,
        p_is_active: role.is_active,
        p_priority: target,
      }),
      "Порядок ролей обновлён. На права это не влияет.",
    );
  };

  const savePermissions = async () => {
    if (!selectedRole) return;
    if (!canManageRoles) {
      setError("Недостаточно прав для изменения прав роли.");
      return;
    }
    await runAction(
      "save-permissions",
      () => supabase.rpc("role_set_permissions", {
        p_role_id: selectedRole.id,
        p_permission_keys: Array.from(selectedPermissions),
      }),
      "Права роли обновлены.",
    );
  };

  const archiveRole = async () => {
    if (!selectedRole || selectedRole.is_system) return;
    if (!canManageRoles) {
      setError("Недостаточно прав для управления ролями.");
      return;
    }
    const willDelete = selectedRoleUsageKnown && selectedRoleUsageCount === 0;
    const confirmed = await requestAppConfirm({
      title: willDelete ? "Удалить кастомную роль?" : "Отключить кастомную роль?",
      description: willDelete
        ? `Роль «${getRoleLabel(selectedRole)}» не назначена пользователям или локациям. После удаления её нельзя будет назначить заново без создания роли.`
        : `Роль «${getRoleLabel(selectedRole)}» используется. Она будет отключена и перестанет быть доступной для новых назначений.`,
      confirmLabel: willDelete ? "Удалить" : "Отключить",
      tone: "danger",
      icon: willDelete ? "delete" : "lock",
    });
    if (!confirmed) return;
    await runAction(
      "archive-role",
      () => supabase.rpc("role_delete_or_archive", { p_role_id: selectedRole.id }),
      willDelete ? "Роль удалена." : "Роль отключена.",
    );
  };

  const assignGlobalRole = async () => {
    if (!canAssignGlobalRoles) {
      setError("Недостаточно прав для назначения ролей.");
      return;
    }
    if (!assignUserId || !assignRoleId) {
      setError("Выберите пользователя и роль.");
      return;
    }
    const ok = await runAction(
      "assign-global-role",
      () => supabase.rpc("user_assign_global_role", {
        p_user_id: assignUserId,
        p_role_id: assignRoleId,
      }),
      "Роль назначена пользователю.",
    );
    if (ok) {
      clearRoleAccessCache(assignUserId);
      setAssignUserId("");
      setAssignRoleId("");
    }
  };

  const removeGlobalRole = async (userId: string, roleId: string) => {
    if (!canAssignGlobalRoles) {
      setError("Недостаточно прав для назначения ролей.");
      return;
    }
    await runAction(
      `remove-role-${userId}-${roleId}`,
      () => supabase.rpc("user_remove_global_role", { p_user_id: userId, p_role_id: roleId }),
      "Роль снята с пользователя.",
    );
    clearRoleAccessCache(userId);
  };

  if (rolesProbeEnabled && rolesState.loading && !rolesState.checked) {
    return (
      <div className="flex items-center justify-center py-16">
        <KubIcon name="spinner" size={24} tone="accent" label="Загрузка" />
      </div>
    );
  }

  if (!rolesProbeEnabled || !rolesState.available) {
    const missingSchema = !rolesProbeEnabled || rolesState.error === ROLES_PERMISSIONS_REQUIRED_MESSAGE;
    const panelMessage = missingSchema
      ? ROLES_PERMISSIONS_REQUIRED_MESSAGE
      : rolesState.error ?? "Не удалось загрузить роли. Попробуйте ещё раз.";
    return (
      <KubPanel className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="kub-raise flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--kub-border-color)] text-[color:var(--kub-cyan)]">
            <KubIcon name="shield" size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[color:var(--kub-text)]">Роли и права</h2>
            <p className="mt-1 text-sm leading-relaxed text-[color:var(--kub-muted)]">
              {panelMessage}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
              {missingSchema
                ? "До применения migration приложение продолжает использовать legacy роли admin / manager / user, а локации и задачи работают по текущей модели."
                : "Динамические роли уже найдены или проверяются, но текущий пользователь не может загрузить полный набор данных. Существующие локации и задачи продолжают работать."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <KubButton
                variant="secondary"
                size="sm"
                leftIcon={<KubIcon name="rotate" size={13} />}
                onClick={() => {
                  setRolesProbeEnabled(true);
                  void rolesState.refetch();
                }}
                loading={rolesProbeEnabled && rolesState.loading}
              >
                Проверить обновление базы
              </KubButton>
              {rolesProbeEnabled && (
                <KubButton variant="ghost" size="sm" onClick={() => setRolesProbeEnabled(false)}>
                  Скрыть проверку
                </KubButton>
              )}
            </div>
          </div>
        </div>
      </KubPanel>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-[color:var(--kub-text)]">Роли и права</h2>
          <p className="text-sm text-[color:var(--kub-muted)]">
            Роли описывают должности и зоны ответственности. Права определяют, какие действия доступны роли.
          </p>
        </div>
        <KubButton
          variant="secondary"
          size="sm"
          leftIcon={<KubIcon name="rotate" size={13} />}
          onClick={() => void rolesState.refetch()}
          loading={rolesState.loading}
        >
          Обновить
        </KubButton>
      </div>

      {(notice || error) && (
        <div className={cn(
          "rounded-xl border px-3 py-2 text-xs",
          error
            ? "border-[color:var(--kub-danger)]/30 bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-text)]"
            : "border-[color:var(--kub-online)]/30 bg-[color-mix(in_srgb,var(--kub-online)_12%,transparent)] text-[color:var(--kub-text)]",
        )}>
          {error ?? notice}
        </div>
      )}

      {!canManageRoles && (
        <KubNotice tone="warn" className="text-xs">
          Режим просмотра: текущая роль позволяет видеть роли и права, но не менять их. Создание ролей, изменение прав и назначение ролей доступны владельцу, тех. администратору или роли с правом управления ролями.
        </KubNotice>
      )}

      <KubHelpNotes id="roles" label="Что такое роли и права">
      <div className="grid gap-3 md:grid-cols-3">
        <KubPanel className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--kub-text)]">
            <KubIcon name="shield" size={15} tone="accent" />
            Что такое роль
          </div>
          <p className="text-xs leading-relaxed text-[color:var(--kub-muted)]">
            Это понятное название доступа: например, администратор локации, сотрудник локации или тех. администратор.
          </p>
        </KubPanel>
        <KubPanel className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--kub-text)]">
            <KubIcon name="check" size={15} tone="accent" />
            Что такое право
          </div>
          <p className="text-xs leading-relaxed text-[color:var(--kub-muted)]">
            Это конкретное действие: создать задачу, пригласить в чат, назначить роль или смотреть аудит.
          </p>
        </KubPanel>
        <KubPanel className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--kub-text)]">
            <KubIcon name="lock" size={15} tone="accent" />
            Порядок и цвет
          </div>
          <p className="text-xs leading-relaxed text-[color:var(--kub-muted)]">
            Стрелки меняют место роли в списке, цвет — её метку. Ни то, ни другое не выдаёт и не отнимает права.
          </p>
        </KubPanel>
      </div>
      </KubHelpNotes>

      <div className="grid gap-4 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.4fr)]">
        <div className="space-y-3">
          <KubCreateSection
            label="Новая роль"
            open={createOpen}
            onOpenChange={setCreateOpen}
            description="1. Назовите роль, 2. выберите где она действует, 3. после создания отметьте нужные права справа."
            disabled={!canManageRoles}
          >
            <KubInput label="Название роли" value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="Старший смены" disabled={!canManageRoles} />
            <KubInput
              label="Технический ключ"
              value={createKey}
              onChange={(event) => setCreateKey(event.target.value.toLowerCase().replace(/\s+/g, "_"))}
              placeholder="custom_shift_lead"
              disabled={!canManageRoles}
            />
            <p className="-mt-2 text-[11px] leading-relaxed text-[color:var(--kub-muted)]">
              Ключ нужен системе для безопасного хранения. Пользователи видят название роли, а не ключ.
            </p>
            <textarea
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
              disabled={!canManageRoles}
              rows={3}
              placeholder="Коротко опишите, кому подходит эта роль"
              className="w-full resize-none rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 py-2 text-sm text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
            />
            <select
              value={createScope}
              onChange={(event) => setCreateScope(event.target.value as RoleScope)}
              disabled={!canManageRoles}
              className="h-10 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 text-sm text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
            >
              {ROLE_SCOPES.map((scope) => (
                <option key={scope} value={scope}>{ROLE_SCOPE_LABEL[scope]}</option>
              ))}
            </select>
            <p className="-mt-2 text-[11px] leading-relaxed text-[color:var(--kub-muted)]">
              {getRoleScopeDescription(createScope)}
            </p>
            <KubButton
              variant="primary"
              size="sm"
              onClick={() => void createRole()}
              loading={saving === "create-role"}
              disabled={!canManageRoles}
              leftIcon={<KubIcon name="create" size={13} />}
            >
              Создать роль
            </KubButton>
          </KubCreateSection>

          {/*
            No `max-h` and no `overflow-y-auto` here on purpose. The column used
            to be capped at 520px with its own scrollbar inside a page that
            already scrolls, so thirteen roles were read four at a time through
            a letterbox and the wheel did different things depending on where
            the pointer happened to be. The page is the scroller.
          */}
          <KubPanel padded={false} className="overflow-hidden">
            <div className="border-b border-[color:var(--kub-border-color)] px-3 py-2.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
                Роли по старшинству
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--kub-muted)]">
                {PRIORITY_IS_NOT_POWER}
              </p>
            </div>
            {roleHierarchy.map((group) => (
              <div key={group.scope}>
                <div className="kub-raise flex items-center justify-between gap-2 border-b border-[color:var(--kub-border-color)] px-3 py-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
                    {ROLE_SCOPE_LABEL[group.scope] ?? group.scope}
                  </span>
                  <span className="text-[11px] text-[color:var(--kub-muted)]">
                    {group.entries.length}
                  </span>
                </div>
                {group.entries.map(({ role, rank, sharesRank }) => {
                  const swatch = roleSwatchColour(role);
                  const label = getRoleLabel(role);
                  const upTarget = planPriorityMove(rolesState.roles, role.id, "up");
                  const downTarget = planPriorityMove(rolesState.roles, role.id, "down");
                  const busy = saving === `move-role-${role.id}`;
                  return (
                    <div
                      key={role.id}
                      className={cn(
                        "flex w-full min-w-0 items-stretch border-b border-[color:var(--kub-border-color)] last:border-b-0",
                        selectedRole?.id === role.id && "bg-[color-mix(in_srgb,var(--kub-cyan)_10%,transparent)]",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedRoleId(role.id)}
                        aria-current={selectedRole?.id === role.id ? "true" : undefined}
                        className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-3 text-left kub-raise-hover"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "h-3 w-3 shrink-0 rounded-full border border-[color:var(--kub-border-color)]",
                            !swatch && "bg-[color-mix(in_srgb,var(--kub-muted)_35%,transparent)]",
                          )}
                          // Only ever a value `normalizeRoleColour` accepted:
                          // six hex digits, so nothing else can reach the style.
                          style={swatch ? { backgroundColor: swatch } : undefined}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-[color:var(--kub-text)]">
                            {label}
                          </span>
                          <span className="block truncate text-xs text-[color:var(--kub-muted)]">
                            Ранг {rank} · {role.key}
                          </span>
                          {/*
                            Its own line rather than a suffix, so truncation in a
                            narrow column cannot swallow the one thing this list
                            exists to show: that two roles are deliberately level.
                          */}
                          {sharesRank && (
                            <span className="block truncate text-[11px] text-[color:var(--kub-muted)]">
                              Равный ранг с другой ролью
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          {role.is_system && <KubBadge tone="pink" pill>Системная</KubBadge>}
                          {!role.is_active && <KubBadge tone="muted" pill>Отключена</KubBadge>}
                        </span>
                      </button>
                      {canManageRoles && (
                        <span className="flex shrink-0 flex-col items-center justify-center gap-0.5 pr-1.5">
                          <button
                            type="button"
                            onClick={() => void moveRole(role, "up")}
                            disabled={upTarget === null || saving !== null}
                            aria-label={`Поднять роль «${label}» в списке`}
                            title={`Поднять «${label}» выше. На права не влияет.`}
                            className="kub-icon-action kub-interactive rounded-md text-[color:var(--kub-muted)] kub-raise-hover hover:text-[color:var(--kub-text)] disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
                          >
                            <KubIcon name={busy ? "spinner" : "chevronUp"} size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void moveRole(role, "down")}
                            disabled={downTarget === null || saving !== null}
                            aria-label={`Опустить роль «${label}» в списке`}
                            title={`Опустить «${label}» ниже. На права не влияет.`}
                            className="kub-icon-action kub-interactive rounded-md text-[color:var(--kub-muted)] kub-raise-hover hover:text-[color:var(--kub-text)] disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
                          >
                            <KubIcon name="chevronDown" size={13} />
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </KubPanel>
        </div>

        <div className="space-y-3">
          {selectedRole ? (
            <>
              <KubPanel className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[color:var(--kub-text)]">Настройки роли</h3>
                    <p className="text-xs text-[color:var(--kub-muted)]">
                      Ключ используется только системой. В интерфейсе пользователям показывается понятное название роли.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <KubBadge tone={selectedRole.is_system ? "pink" : "cyan"} pill>
                      {selectedRole.is_system ? "Системная" : "Кастомная"}
                    </KubBadge>
                    <KubBadge tone="muted" pill>{ROLE_SCOPE_LABEL[selectedRole.scope]}</KubBadge>
                  </div>
                </div>
                <div className="kub-raise rounded-xl border border-[color:var(--kub-border-color)] px-3 py-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
                  {getRoleScopeDescription(selectedRole.scope)}
                </div>
                {selectedRole.is_system && (
                  <KubNotice tone="warn" className="text-xs">
                    Системную роль нельзя удалить или отключить. Можно уточнить название и описание, если это не ломает смысл роли.
                  </KubNotice>
                )}
                {selectedRoleIsCritical && (
                  <KubNotice tone="danger" className="text-xs">
                    Это критичная роль. Последний владелец или тех. администратор не может быть снят backend-проверкой.
                  </KubNotice>
                )}
                {!selectedRole.is_system && (
                  <div className="kub-raise rounded-xl border border-[color:var(--kub-border-color)] px-3 py-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
                    {selectedRoleUsageKnown
                      ? selectedRoleUsageCount === 0
                        ? "Кастомная роль нигде не назначена. После применения migration её можно удалить полностью."
                        : `Роль используется в назначениях: ${selectedRoleUsageCount}. Её можно отключить, чтобы больше не выдавать новые права.`
                      : "Не удалось проверить все назначения роли. Безопасное действие: отключить роль."}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <KubInput label="Технический ключ" value={selectedRole.key} readOnly />
                  <KubInput label="Название" value={editName} onChange={(event) => setEditName(event.target.value)} disabled={!canManageRoles} />
                </div>
                <textarea
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  disabled={!canManageRoles}
                  rows={3}
                  placeholder="Описание"
                  className="w-full resize-none rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 py-2 text-sm text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <KubInput
                    label="Ранг в списке"
                    type="number"
                    inputMode="numeric"
                    min={ROLE_PRIORITY_MIN}
                    max={ROLE_PRIORITY_MAX}
                    step={1}
                    value={editPriority}
                    onChange={(event) => setEditPriority(event.target.value)}
                    disabled={!canManageRoles}
                    hint="Больше — выше в своей области. Только порядок, не доступ. Одинаковые числа означают равный ранг."
                  />
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-[color:var(--kub-muted)]">
                      Цвет роли
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label="Выбрать цвет роли"
                        value={normalizeRoleColour(editColour) ?? COLOUR_PICKER_FALLBACK}
                        onChange={(event) => setEditColour(event.target.value)}
                        disabled={!canManageRoles}
                        className="h-11 w-12 shrink-0 cursor-pointer rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] p-1 disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
                      />
                      <KubInput
                        containerClassName="min-w-0 flex-1"
                        aria-label="Цвет роли в формате #rrggbb"
                        value={editColour}
                        onChange={(event) => setEditColour(event.target.value)}
                        placeholder="#4d8bd0"
                        spellCheck={false}
                        disabled={!canManageRoles}
                        error={editColour.trim() && !normalizeRoleColour(editColour) ? "Нужен формат #rrggbb." : null}
                      />
                    </div>
                    <p className="text-xs leading-relaxed text-[color:var(--kub-muted)]">
                      Цвет можно поменять, но не убрать: пустое поле сервер понимает как «оставить как есть».
                    </p>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-[color:var(--kub-text)]">
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={(event) => setEditActive(event.target.checked)}
                    disabled={selectedRole.is_system || !canManageRoles}
                    className="h-4 w-4 accent-[var(--kub-cyan)] disabled:opacity-50"
                  />
                  Роль активна
                </label>
                <div className="flex flex-wrap gap-2">
                  <KubButton
                    variant="primary"
                    size="sm"
                    onClick={() => void saveRole()}
                    loading={saving === "save-role"}
                    disabled={!canManageRoles}
                    leftIcon={<KubIcon name="check" size={13} />}
                  >
                    Сохранить
                  </KubButton>
                  <KubButton
                    variant={selectedRoleUsageKnown && selectedRoleUsageCount === 0 ? "danger" : "secondary"}
                    size="sm"
                    onClick={() => void archiveRole()}
                    loading={saving === "archive-role"}
                    disabled={selectedRole.is_system || !canManageRoles}
                    leftIcon={<KubIcon name={selectedRoleUsageKnown && selectedRoleUsageCount === 0 ? "delete" : "lock"} size={13} />}
                  >
                    {selectedRoleDeleteLabel}
                  </KubButton>
                </div>
              </KubPanel>

              <KubPanel className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-[color:var(--kub-text)]">Права</h3>
                    <p className="text-xs text-[color:var(--kub-muted)]">
                      Разделы свёрнуты: рядом с названием видно, сколько прав в нём включено. Откройте нужный и отметьте только те действия, которые роли нужны в работе. Технический ключ показан мелко для диагностики.
                    </p>
                  </div>
                  {permissionGroups.length > 0 && (
                    <KubButton
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenCategories(
                        allCategoriesOpen ? new Set() : new Set(permissionGroups.map(([category]) => category)),
                      )}
                      leftIcon={<KubIcon name={allCategoriesOpen ? "chevronUp" : "chevronDown"} size={13} />}
                    >
                      {allCategoriesOpen ? "Свернуть все" : "Развернуть все"}
                    </KubButton>
                  )}
                </div>
                {selectedRoleIsCritical && (
                  <KubNotice tone="danger" className="text-xs">
                    Владелец и тех. администратор всегда получают полный доступ. Набор прав здесь информационный и не ограничивает эти роли.
                  </KubNotice>
                )}
                <div className="grid items-start gap-3 lg:grid-cols-2">
                  {permissionGroups.map(([category, permissions]) => {
                    const enabled = permissions.filter((permission) => selectedPermissions.has(permission.key)).length;
                    const open = openCategories.has(category);
                    const panelId = `role-permission-category-${category}`;
                    return (
                      <div key={category} className="kub-raise overflow-hidden rounded-xl border border-[color:var(--kub-border-color)]">
                        <button
                          type="button"
                          onClick={() => toggleCategory(category)}
                          aria-expanded={open}
                          aria-controls={panelId}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left kub-raise-hover"
                        >
                          <KubIcon name={open ? "chevronUp" : "chevronDown"} size={14} />
                          <span className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--kub-accent-text)]">
                            {getPermissionCategoryLabel(category)}
                          </span>
                          <span
                            aria-hidden
                            className={cn(
                              "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold text-[color:var(--kub-text)]",
                              enabled > 0
                                ? "border-[color:color-mix(in_srgb,var(--kub-cyan)_55%,transparent)]"
                                : "border-[color:var(--kub-border-color)]",
                            )}
                          >
                            {enabled} / {permissions.length}
                          </span>
                          <span className="sr-only">
                            Включено {enabled} из {permissions.length}
                          </span>
                        </button>
                        {open && (
                          <div id={panelId} className="space-y-1.5 border-t border-[color:var(--kub-border-color)] px-3 py-3">
                            {PERMISSION_CATEGORY_DESCRIPTION[category] && (
                              <div className="pb-1 text-[11px] leading-relaxed text-[color:var(--kub-muted)]">
                                {PERMISSION_CATEGORY_DESCRIPTION[category]}
                              </div>
                            )}
                            {permissions.map((permission) => (
                              <label key={permission.key} className="flex items-start gap-2 text-sm text-[color:var(--kub-text)]">
                                <input
                                  type="checkbox"
                                  checked={selectedPermissions.has(permission.key)}
                                  disabled={selectedRoleIsCritical || !canManageRoles}
                                  onChange={(event) => {
                                    setSelectedPermissions((current) => {
                                      const next = new Set(current);
                                      if (event.target.checked) next.add(permission.key);
                                      else next.delete(permission.key);
                                      return next;
                                    });
                                  }}
                                  className="mt-0.5 h-4 w-4 accent-[var(--kub-cyan)] disabled:opacity-60"
                                />
                                <span className="min-w-0">
                                  <span className="block font-medium">{getPermissionLabel(permission)}</span>
                                  <span className="block text-xs leading-relaxed text-[color:var(--kub-muted)]">
                                    {getPermissionDescription(permission)}
                                  </span>
                                  <span className="block truncate text-[10px] font-medium text-[color:var(--kub-muted)] opacity-80">
                                    {permission.key}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <KubButton
                  variant="primary"
                  size="sm"
                  onClick={() => void savePermissions()}
                  loading={saving === "save-permissions"}
                  disabled={selectedRoleIsCritical || !canManageRoles}
                  leftIcon={<KubIcon name="shield" size={13} />}
                >
                  Сохранить права
                </KubButton>
              </KubPanel>
            </>
          ) : (
            <KubPanel>
              <div className="text-sm text-[color:var(--kub-muted)]">Выберите или создайте роль.</div>
            </KubPanel>
          )}

          <KubPanel className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-[color:var(--kub-text)]">Глобальные роли пользователей</h3>
              <p className="text-xs text-[color:var(--kub-muted)]">
                Старая роль профиля остаётся fallback; новые назначения хранятся отдельно.
              </p>
              {!canAssignGlobalRoles && (
                <p className="mt-1 text-xs leading-relaxed text-[color:var(--kub-warn)]">
                  Назначение и снятие ролей недоступно для текущей роли.
                </p>
              )}
              {canAssignGlobalRoles && !currentAccess.critical && (
                <p className="mt-1 text-xs leading-relaxed text-[color:var(--kub-muted)]">
                  Критичные роли владельца и тех. администратора скрыты: их назначает только владелец или тех. администратор.
                </p>
              )}
            </div>
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <select
                value={assignUserId}
                onChange={(event) => setAssignUserId(event.target.value)}
                disabled={!canAssignGlobalRoles}
                className="h-10 min-w-0 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 text-sm text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
              >
                <option value="">Пользователь</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{getProfileName(profile)}</option>
                ))}
              </select>
              <select
                value={assignRoleId}
                onChange={(event) => setAssignRoleId(event.target.value)}
                disabled={!canAssignGlobalRoles}
                className="h-10 min-w-0 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 text-sm text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
              >
                <option value="">Глобальная роль</option>
                {assignableGlobalRoles.map((role) => (
                  <option key={role.id} value={role.id}>{getRoleLabel(role)}</option>
                ))}
              </select>
              <KubButton
                variant="primary"
                size="sm"
                onClick={() => void assignGlobalRole()}
                loading={saving === "assign-global-role"}
                disabled={!canAssignGlobalRoles}
                leftIcon={<KubIcon name="userPlus" size={13} />}
              >
                Назначить
              </KubButton>
            </div>

            <div className="overflow-hidden rounded-xl border border-[color:var(--kub-border-color)]">
              {roleAssignments.map(({ assignment, profile, role }) => {
                if (!profile || !role) return null;
                const busyKey = `remove-role-${assignment.user_id}-${assignment.role_id}`;
                const swatch = roleSwatchColour(role);
                return (
                  <div
                    key={`${assignment.user_id}:${assignment.role_id}`}
                    className="grid gap-2 border-b border-[color:var(--kub-border-color)] px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-center"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <UserAvatar user={profile} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[color:var(--kub-text)]">
                          {getProfileName(profile)}
                        </span>
                        {profile.username && (
                          <span className="block truncate text-xs text-[color:var(--kub-muted)]">@{profile.username}</span>
                        )}
                      </span>
                    </div>
                    <KubBadge
                      tone={isCriticalRoleKey(role.key) ? "pink" : "cyan"}
                      pill
                      dot={!swatch}
                    >
                      {swatch && (
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: swatch }}
                        />
                      )}
                      {getRoleLabel(role)}
                    </KubBadge>
                    <KubButton
                      variant="ghost"
                      size="sm"
                      onClick={() => void removeGlobalRole(assignment.user_id, assignment.role_id)}
                      loading={saving === busyKey}
                      disabled={!canAssignGlobalRoles}
                      leftIcon={<KubIcon name="userRemove" size={13} />}
                    >
                      Снять
                    </KubButton>
                  </div>
                );
              })}
              {roleAssignments.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-[color:var(--kub-muted)]">
                  Глобальные роли ещё не назначены.
                </div>
              )}
            </div>
          </KubPanel>
        </div>
      </div>
    </div>
  );
}

function getProfileName(profile: Profile | null | undefined): string {
  return profile?.full_name?.trim() || profile?.username?.trim() || "Пользователь";
}
