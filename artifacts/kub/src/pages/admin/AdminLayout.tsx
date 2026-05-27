"use client";

import { Link, useLocation, Route, Switch, Redirect } from "wouter";
import { useRoleAccess } from "@/hooks/useRole";
import { useAppStore } from "@/store/app.store";
import { KubIcon, KubLogo, type KubIconName } from "@/components/kub";
import { cn } from "@/lib/utils";
import { DashboardTab } from "./DashboardTab";
import { UsersTab } from "./UsersTab";
import { BansMutesTab } from "./BansMutesTab";
import { AuditTab } from "./AuditTab";
import { LocationsTab } from "./LocationsTab";
import { RolesPermissionsTab } from "./RolesPermissionsTab";

type TabDef = { id: string; label: string; icon: KubIconName; path: string; adminOnly?: boolean };

const TABS: ReadonlyArray<TabDef> = [
  { id: "dashboard", label: "Сводка",       icon: "dashboard",  path: "/admin" },
  { id: "users",     label: "Пользователи", icon: "users",      path: "/admin/users" },
  { id: "locations", label: "Локации",      icon: "mapPin",     path: "/admin/locations", adminOnly: true },
  { id: "roles",     label: "Роли и права", icon: "shield",     path: "/admin/roles", adminOnly: true },
  { id: "bans",      label: "Блокировки",   icon: "shieldOff",  path: "/admin/bans" },
  // Audit log is admin-only at the RLS layer (managers see no rows);
  // hide the tab from managers entirely so they don't get sent to a
  // permission-denied empty state.
  { id: "audit",     label: "Журнал",       icon: "audit",      path: "/admin/audit", adminOnly: true },
];

export function AdminLayout() {
  const [location] = useLocation();
  const currentUser = useAppStore((s) => s.currentUser);
  const { isStaff, isAdmin, checking } = useRoleAccess();

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--kub-bg)] kub-grid-bg">
        <KubIcon name="spinner" size={24} tone="accent" label="Загрузка" />
      </div>
    );
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--kub-bg)] kub-grid-bg">
        <KubIcon name="spinner" size={24} tone="accent" label="РџСЂРѕРІРµСЂРєР° СЂРѕР»РµР№" />
      </div>
    );
  }

  if (!isStaff) return <Redirect to="/" />;

  return (
    <div className="flex h-screen min-h-0 flex-col bg-[var(--kub-bg)] text-[color:var(--kub-text)]">
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 h-14 flex-shrink-0 bg-[var(--kub-surface)] border-b border-[color:var(--kub-border-color)]">
        <Link
          href="/"
          aria-label="Назад в чат"
          className="p-1.5 rounded-lg hover:bg-[var(--kub-surface-2)] transition-colors text-[color:var(--kub-cyan)] flex-shrink-0"
        >
          <KubIcon name="back" size={20} />
        </Link>
        <KubLogo size={22} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold flex items-center gap-2 text-[color:var(--kub-text)] truncate">
            Админ-панель
            <span className="hidden sm:inline text-[10px] uppercase tracking-[0.18em] text-[color:var(--kub-pink)] truncate">
              LETSCUBE · Кибер-арена
            </span>
          </div>
          <div className="text-xs text-[color:var(--kub-muted)] truncate">
            {isAdmin ? "Администратор" : "Менеджер"} · {currentUser.full_name ?? "Без имени"}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-0.5 sm:gap-1 px-1 sm:px-2 overflow-x-auto no-scrollbar flex-shrink-0 bg-[var(--kub-surface)] border-b border-[color:var(--kub-border-color)]">
        {TABS.filter((t) => !t.adminOnly || isAdmin).map((t) => {
          const active = location === t.path;
          return (
            <Link
              key={t.id}
              href={t.path}
              className={cn(
                "flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 h-11 text-[11px] sm:text-xs font-semibold uppercase tracking-wide transition-colors whitespace-nowrap relative",
                active ? "text-[color:var(--kub-cyan)]" : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]"
              )}
            >
              <KubIcon name={t.icon} size={14} />
              {t.label}
              {active && (
                <span className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full bg-[var(--kub-cyan)] kub-glow-soft" />
              )}
            </Link>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto kub-grid-subtle">
        <div className="mx-auto max-w-5xl p-3 pb-24 sm:p-4 sm:pb-8 md:p-6">
          <Switch>
            <Route path="/admin" component={DashboardTab} />
            <Route path="/admin/users" component={UsersTab} />
            <Route path="/admin/locations">
              {isAdmin ? <LocationsTab /> : <Redirect to="/admin" />}
            </Route>
            <Route path="/admin/roles">
              {isAdmin ? <RolesPermissionsTab /> : <Redirect to="/admin" />}
            </Route>
            <Route path="/admin/bans" component={BansMutesTab} />
            {/* Defence-in-depth: even if a manager hits /admin/audit
                directly we redirect them; the AuditTab also has its
                own gate, and the audit_logs RLS only allows admins. */}
            <Route path="/admin/audit">
              {isAdmin ? <AuditTab /> : <Redirect to="/admin" />}
            </Route>
          </Switch>
        </div>
      </div>
    </div>
  );
}
