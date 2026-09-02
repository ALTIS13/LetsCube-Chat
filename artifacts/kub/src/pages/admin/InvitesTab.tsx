"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { copyWithFeedback } from "@/lib/actionFeedback";
import { KubBadge, KubButton, KubCreateSection, KubIcon, KubInput, KubNotice, KubPanel, KubSkeletonRows, KubSwitch } from "@/components/kub";
import { useDynamicRoles, useDynamicRolesEnabledPreference } from "@/hooks/useDynamicRoles";
import { usePermissionAccess } from "@/hooks/useRole";
import { useTaskRouting, useTaskRoutingEnabledPreference } from "@/hooks/useTaskRouting";
import { LOCATION_ROUTING_REQUIRED_MESSAGE } from "@/lib/locationRouting";
import {
  REGISTRATION_INVITE_MODE_REQUIRED_MESSAGE,
  REGISTRATION_INVITES_REQUIRED_MESSAGE,
  buildRegistrationInviteLink,
} from "@/lib/registrationInvite";
import { getRoleLabel, mapRolesPermissionsError } from "@/lib/rolePermissions";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { DynamicRole, RegistrationInviteListRow, RegistrationInviteModeRow } from "@/types/database";

const selectClassName =
  "h-11 w-full rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 text-sm text-[color:var(--kub-text)] outline-none transition-colors focus:border-[color:var(--kub-cyan)]";

export function InvitesTab() {
  const supabase = useMemo(() => createClient(), []);
  const [rolesEnabled] = useDynamicRolesEnabledPreference();
  const [routingEnabled, setRoutingEnabled] = useTaskRoutingEnabledPreference();
  const roles = useDynamicRoles({ enabled: rolesEnabled, includeAssignments: false });
  const routing = useTaskRouting({ enabled: routingEnabled, includeMembers: true });
  const systemAccess = usePermissionAccess(["system.manage"]);
  const [invites, setInvites] = useState<RegistrationInviteListRow[]>([]);
  const [inviteOnlyEnabled, setInviteOnlyEnabled] = useState(false);
  const [modeLoading, setModeLoading] = useState(true);
  const [modeSaving, setModeSaving] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState("14");
  const [globalRoleId, setGlobalRoleId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [locationRoleId, setLocationRoleId] = useState("");
  const [primaryAdminId, setPrimaryAdminId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc("registration_invites_list");
    setLoading(false);
    if (error) {
      setError(mapInviteError(error));
      setInvites([]);
      return;
    }
    setInvites((data ?? []) as RegistrationInviteListRow[]);
  }, [supabase]);

  const loadInviteMode = useCallback(
    async (options: { background?: boolean } = {}) => {
      if (!options.background) setModeLoading(true);
      setModeError(null);
      const { data, error } = await supabase.rpc("registration_invite_mode");
      setModeLoading(false);
      if (error) {
        setModeError(mapInviteModeError(error));
        setInviteOnlyEnabled(false);
        return;
      }
      const row = readInviteModeRow(data);
      setInviteOnlyEnabled(Boolean(row?.invite_only_enabled));
    },
    [supabase],
  );

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  useEffect(() => {
    void loadInviteMode();
  }, [loadInviteMode]);

  const globalRoles = useMemo(
    () => roles.roles.filter((role) => role.scope === "global" && role.is_active),
    [roles.roles],
  );
  const locationRoles = useMemo(
    () => roles.roles.filter((role) => role.scope === "location" && role.is_active),
    [roles.roles],
  );
  const selectedLocation = useMemo(
    () => routing.locations.find((location) => location.id === locationId) ?? null,
    [locationId, routing.locations],
  );
  const selectedLocationRole = useMemo(
    () => locationRoles.find((role) => role.id === locationRoleId) ?? null,
    [locationRoleId, locationRoles],
  );
  const selectedLocationAdmins = useMemo(() => {
    if (!selectedLocation) return [];
    return routing.members
      .filter((member) => member.location_id === selectedLocation.id)
      .filter((member) => ["owner", "admin", "manager"].includes(member.role))
      .sort((a, b) => getProfileName(a.profile).localeCompare(getProfileName(b.profile), "ru-RU"));
  }, [routing.members, selectedLocation]);

  useEffect(() => {
    if (!locationId) {
      setLocationRoleId("");
      setPrimaryAdminId("");
      return;
    }
    if (locationRoleId) return;
    const staffRole = locationRoles.find((role) => role.key === "location_staff") ?? locationRoles[0] ?? null;
    setLocationRoleId(staffRole?.id ?? "");
  }, [locationId, locationRoleId, locationRoles]);

  useEffect(() => {
    if (selectedLocationRole?.key === "location_staff") return;
    setPrimaryAdminId("");
  }, [selectedLocationRole?.key]);

  const createInvite = async () => {
    if (!label.trim()) {
      setError("Укажите понятное название приглашения.");
      return;
    }
    setSaving("create");
    setNotice(null);
    setError(null);
    const expiresAt = toExpiresAt(expiresInDays);
    const { data, error } = await supabase.rpc("registration_invite_create", {
      p_label: label.trim(),
      p_max_uses: Math.max(1, Math.min(1000, Math.floor(maxUses || 1))),
      p_expires_at: expiresAt,
      p_global_role_id: globalRoleId || null,
      p_location_id: locationId || null,
      p_location_role_id: locationId ? locationRoleId || null : null,
      p_primary_admin_id: selectedLocationRole?.key === "location_staff" ? primaryAdminId || null : null,
    });
    setSaving(null);
    if (error) {
      setError(mapInviteError(error));
      return;
    }
    const code = data?.[0]?.code;
    setNotice(code ? `Инвайт создан: ${code}` : "Инвайт создан.");
    setLabel("");
    setMaxUses(1);
    await loadInvites();
  };

  const revokeInvite = async (invite: RegistrationInviteListRow) => {
    setSaving(invite.id);
    setNotice(null);
    setError(null);
    const { error } = await supabase.rpc("registration_invite_revoke", { p_invite_id: invite.id });
    setSaving(null);
    if (error) {
      setError(mapInviteError(error));
      return;
    }
    setNotice("Инвайт отозван.");
    await loadInvites();
  };

  const toggleInviteOnlyMode = async (next: boolean) => {
    setModeSaving(true);
    setModeError(null);
    setNotice(null);
    const { data, error } = await supabase.rpc("registration_invite_set_mode", {
      p_invite_only_enabled: next,
    });
    setModeSaving(false);
    if (error) {
      setModeError(mapInviteModeError(error));
      return;
    }
    const row = readInviteModeRow(data);
    setInviteOnlyEnabled(Boolean(row?.invite_only_enabled ?? next));
    setNotice(next ? "Режим регистрации только по приглашению включён." : "Открытая регистрация включена.");
  };

  const copyInviteLink = async (invite: RegistrationInviteListRow) => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const link = buildRegistrationInviteLink(origin, invite.code);
    await copyWithFeedback(link, {
      success: "Ссылка приглашения скопирована",
      error: "Не удалось скопировать ссылку",
      key: "invite-link",
    });
  };

  return (
    <div className="space-y-4">
      <KubPanel className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--kub-cyan)]">
              <KubIcon name="lock" size={14} />
              Режим регистрации
            </div>
            <h2 className="mt-2 text-lg font-bold text-[color:var(--kub-text)]">
              {inviteOnlyEnabled ? "Только по приглашению" : "Открытая регистрация"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[color:var(--kub-muted)]">
              По умолчанию регистрация доступна постоянно. Если включить режим приглашений, новые аккаунты
              смогут создаваться только по коду или ссылке-приглашению из этой вкладки.
            </p>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/70 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[color:var(--kub-text)]">
                Только по приглашениям
              </div>
              <div className="text-xs text-[color:var(--kub-muted)]">
                {modeLoading ? "Проверяем режим..." : inviteOnlyEnabled ? "Регистрация ограничена" : "Регистрация открыта"}
              </div>
            </div>
            <KubSwitch
              aria-label="Включить режим только по приглашению"
              checked={inviteOnlyEnabled}
              disabled={modeLoading || modeSaving || systemAccess.checking || !systemAccess.hasPermission("system.manage")}
              onCheckedChange={(checked) => void toggleInviteOnlyMode(checked)}
            />
          </div>
        </div>
        {modeError && (
          <KubNotice tone="warn" className="text-sm">
            {modeError}
          </KubNotice>
        )}
        {!systemAccess.checking && !systemAccess.hasPermission("system.manage") && (
          <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/70 px-3 py-2 text-xs text-[color:var(--kub-muted)]">
            Переключать режим регистрации может только пользователь с правом «Управление системой».
          </div>
        )}
      </KubPanel>

      <KubPanel className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--kub-pink)]">
              <KubIcon name="userPlus" size={14} />
              Инвайты
            </div>
            <h2 className="mt-2 text-xl font-bold text-[color:var(--kub-text)]">
              Приглашения сотрудников
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[color:var(--kub-muted)]">
              Коды и ссылки-приглашения, чтобы не назначать работников вручную после регистрации.
            </p>
          </div>
          <KubButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void loadInvites()}
            loading={loading}
            leftIcon={<KubIcon name="rotate" size={13} />}
          >
            Обновить
          </KubButton>
        </div>

        {notice && (
          <KubNotice tone="success" className="text-sm">
            {notice}
          </KubNotice>
        )}
        {error && (
          <KubNotice tone="danger" className="text-sm">
            {error}
          </KubNotice>
        )}

        <KubCreateSection
          label="Создать инвайт"
          open={createOpen}
          onOpenChange={setCreateOpen}
          description="Код или ссылка с лимитом использований и заранее заданной ролью и локацией."
        >
        <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
          <KubInput
            label="Название"
            placeholder="Например: Смена ресепшн июнь"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={120}
            leftIcon={<KubIcon name="hash" size={16} />}
          />
          <div className="grid grid-cols-2 gap-3">
            <KubInput
              label="Использований"
              type="number"
              min={1}
              max={1000}
              value={maxUses}
              onChange={(event) => setMaxUses(Number(event.target.value))}
            />
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-[color:var(--kub-muted)]">
                Срок
              </span>
              <select
                className={selectClassName}
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
              >
                <option value="1">1 день</option>
                <option value="7">7 дней</option>
                <option value="14">14 дней</option>
                <option value="30">30 дней</option>
                <option value="0">Без срока</option>
              </select>
            </label>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-[color:var(--kub-muted)]">
              Глобальная роль
            </span>
            <select className={selectClassName} value={globalRoleId} onChange={(event) => setGlobalRoleId(event.target.value)}>
              <option value="">Без глобальной роли</option>
              {globalRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {getRoleLabel(role)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-[color:var(--kub-muted)]">
              Локация
            </span>
            <select className={selectClassName} value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">Без локации</option>
              {routing.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-[color:var(--kub-muted)]">
              Роль в локации
            </span>
            <select
              className={selectClassName}
              value={locationRoleId}
              onChange={(event) => setLocationRoleId(event.target.value)}
              disabled={!locationId}
            >
              <option value="">Автоматически</option>
              {locationRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {getRoleLabel(role)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-[color:var(--kub-muted)]">
              Основной администратор
            </span>
            <select
              className={selectClassName}
              value={primaryAdminId}
              onChange={(event) => setPrimaryAdminId(event.target.value)}
              disabled={!locationId || selectedLocationRole?.key !== "location_staff"}
            >
              <option value="">Не назначать</option>
              {selectedLocationAdmins.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {getProfileName(member.profile)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {(!routingEnabled || routing.error) && (
          <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/70 px-3 py-2 text-xs text-[color:var(--kub-muted)]">
            {routingEnabled ? routing.error ?? LOCATION_ROUTING_REQUIRED_MESSAGE : LOCATION_ROUTING_REQUIRED_MESSAGE}
            <KubButton
              type="button"
              variant="ghost"
              size="sm"
              className="ml-2"
              onClick={() => setRoutingEnabled(true)}
            >
              Проверить
            </KubButton>
          </div>
        )}

        <div className="flex justify-end">
          <KubButton
            type="button"
            onClick={() => void createInvite()}
            loading={saving === "create"}
            leftIcon={<KubIcon name="create" size={15} />}
          >
            Создать инвайт
          </KubButton>
        </div>
        </KubCreateSection>
      </KubPanel>

      <KubPanel padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/50 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-[color:var(--kub-text)]">Активные и прошлые инвайты</h3>
            <p className="text-xs text-[color:var(--kub-muted)]">Ссылка копируется в формате /register?invite=CODE.</p>
          </div>
          <KubBadge tone="muted" pill>
            {invites.length}
          </KubBadge>
        </div>

        {loading ? (
          <KubSkeletonRows
            count={5}
            label="Загрузка инвайтов"
            rowClassName="border-b border-[color:var(--kub-border-color)] last:border-b-0"
          />
        ) : invites.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[color:var(--kub-muted)]">
            Инвайтов пока нет.
          </div>
        ) : (
          <div className="divide-y divide-[color:var(--kub-border-color)]">
            {invites.map((invite) => (
              <InviteRow
                key={invite.id}
                invite={invite}
                saving={saving === invite.id}
                onCopy={() => void copyInviteLink(invite)}
                onRevoke={() => void revokeInvite(invite)}
              />
            ))}
          </div>
        )}
      </KubPanel>
    </div>
  );
}

function InviteRow({
  invite,
  saving,
  onCopy,
  onRevoke,
}: {
  invite: RegistrationInviteListRow;
  saving: boolean;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  const status = getInviteStatus(invite);
  return (
    <div className="grid gap-3 px-4 py-4 lg:grid-cols-[1fr_auto] lg:items-center">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-[color:var(--kub-text)]">{invite.code}</span>
          <KubBadge tone={status.tone} pill dot>
            {status.label}
          </KubBadge>
          <span className="text-xs text-[color:var(--kub-muted)]">
            {invite.uses_count}/{invite.max_uses} использ.
          </span>
        </div>
        <div>
          <div className="text-sm font-semibold text-[color:var(--kub-text)]">{invite.label}</div>
          {/* Only what this invite actually sets. Printing "Глобальная: нет ·
              Локация: нет · Роль в локации: нет" on an invite that assigns
              nothing filled three columns to say the same thing the one line
              below now says once. */}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--kub-muted)]">
            {invite.global_role_name || invite.location_name || invite.location_role_name ? (
              <>
                {invite.global_role_name && <span>Глобальная: {invite.global_role_name}</span>}
                {invite.location_name && <span>Локация: {invite.location_name}</span>}
                {invite.location_role_name && <span>Роль в локации: {invite.location_role_name}</span>}
                {invite.primary_admin_name && <span>Админ: {invite.primary_admin_name}</span>}
              </>
            ) : (
              <span>Без роли и локации</span>
            )}
          </div>
        </div>
        <div className="text-xs text-[color:var(--kub-muted)]">
          Создан {formatDate(invite.created_at)}
          {invite.expires_at ? ` · истекает ${formatDate(invite.expires_at)}` : " · без срока"}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 lg:justify-end">
        <KubButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={onCopy}
          leftIcon={<KubIcon name="copy" size={13} />}
        >
          Скопировать
        </KubButton>
        <KubButton
          type="button"
          variant="danger"
          size="sm"
          onClick={onRevoke}
          loading={saving}
          disabled={Boolean(invite.revoked_at)}
          className={cn(invite.revoked_at && "opacity-50")}
        >
          Отозвать
        </KubButton>
      </div>
    </div>
  );
}

function getInviteStatus(invite: RegistrationInviteListRow): { label: string; tone: "online" | "warn" | "danger" | "muted" } {
  if (invite.revoked_at) return { label: "Отозван", tone: "danger" };
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) return { label: "Истёк", tone: "warn" };
  if (invite.uses_count >= invite.max_uses) return { label: "Использован", tone: "muted" };
  return { label: "Активен", tone: "online" };
}

function toExpiresAt(days: string): string | null {
  const value = Number(days);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(Date.now() + value * 24 * 60 * 60 * 1000).toISOString();
}

function getProfileName(profile: { full_name?: string | null; username?: string | null } | null | undefined): string {
  return profile?.full_name?.trim() || profile?.username?.trim() || "Без имени";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function mapInviteError(error: unknown): string {
  if (isRegistrationInviteMissingError(error)) return REGISTRATION_INVITES_REQUIRED_MESSAGE;
  const text = readErrorText(error);
  if (text.includes("invite_label_invalid")) return "Название инвайта должно быть от 2 до 120 символов.";
  if (text.includes("invite_max_uses_invalid")) return "Лимит использований должен быть от 1 до 1000.";
  if (text.includes("invite_global_role_invalid")) return "Выбранная глобальная роль недоступна.";
  if (text.includes("invite_location_invalid")) return "Выбранная локация недоступна.";
  if (text.includes("invite_location_role_invalid")) return "Выбранная роль в локации недоступна.";
  if (text.includes("invite_critical_role_forbidden")) return "Критические роли может выдавать только тех. администратор.";
  if (text.includes("permission") || text.includes("42501")) return "Недостаточно прав для управления инвайтами.";
  return mapRolesPermissionsError(error, "Не удалось выполнить действие с инвайтом.");
}

function readInviteModeRow(value: unknown): RegistrationInviteModeRow | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  return row as RegistrationInviteModeRow;
}

function mapInviteModeError(error: unknown): string {
  if (isRegistrationInviteMissingError(error)) return REGISTRATION_INVITE_MODE_REQUIRED_MESSAGE;
  const text = readErrorText(error);
  if (text.includes("permission") || text.includes("42501")) {
    return "Недостаточно прав для переключения режима регистрации.";
  }
  return mapRolesPermissionsError(error, "Не удалось загрузить режим регистрации.");
}

function isRegistrationInviteMissingError(error: unknown): boolean {
  const code = readErrorCode(error);
  const text = readErrorText(error);
  return (
    ["42p01", "42703", "42883", "pgrst202", "pgrst204", "pgrst205"].includes(code) &&
    (text.includes("registration_invite") || text.includes("registration_invites"))
  );
}

function readErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code.toLowerCase() : "";
}

function readErrorText(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const record = error as Record<string, unknown>;
  return [record.code, record.message, record.details, record.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}
