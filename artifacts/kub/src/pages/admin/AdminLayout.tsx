"use client";

import { Link, useLocation, Route, Switch, Redirect } from "wouter";
import { usePermissionAccess, useRoleAccess } from "@/hooks/useRole";
import { useAppStore } from "@/store/app.store";
import { KubIcon, KubLogo, type KubIconName } from "@/components/kub";
import { cn } from "@/lib/utils";
import { DashboardTab } from "./DashboardTab";
import { UsersTab } from "./UsersTab";
import { BansMutesTab } from "./BansMutesTab";
import { AuditTab } from "./AuditTab";
import { LocationsTab } from "./LocationsTab";
import { RolesPermissionsTab } from "./RolesPermissionsTab";
import { InvitesTab } from "./InvitesTab";
import { OpsReportTab } from "./OpsReportTab";
import { SupportTab } from "./SupportTab";

type TabDef = {
  id: string;
  label: string;
  icon: KubIconName;
  path: string;
  adminOnly?: boolean;
  supportOnly?: boolean;
};

const TABS: ReadonlyArray<TabDef> = [
  { id: "dashboard", label: "Сводка",       icon: "dashboard",  path: "/admin" },
  { id: "users",     label: "Пользователи", icon: "users",      path: "/admin/users" },
  { id: "locations", label: "Локации",      icon: "mapPin",     path: "/admin/locations", adminOnly: true },
  { id: "invites",   label: "Инвайты",      icon: "userPlus",   path: "/admin/invites", adminOnly: true },
  { id: "roles",     label: "Роли и права", icon: "shield",     path: "/admin/roles", adminOnly: true },
  { id: "bans",      label: "Блокировки",   icon: "shieldOff",  path: "/admin/bans" },
  { id: "ops",       label: "Операции",      icon: "activity",   path: "/admin/ops", adminOnly: true },
  { id: "support",   label: "Поддержка",      icon: "help",       path: "/admin/support", supportOnly: true },
  // Audit log is admin-only at the RLS layer (managers see no rows);
  // hide the tab from managers entirely so they don't get sent to a
  // permission-denied empty state.
  { id: "audit",     label: "Журнал",       icon: "audit",      path: "/admin/audit", adminOnly: true },
];

export function AdminLayout() {
  const [location] = useLocation();
  const currentUser = useAppStore((s) => s.currentUser);
  const { isStaff, isAdmin, checking } = useRoleAccess();
  const supportAccess = usePermissionAccess(["support.view"]);
  const canViewSupport = supportAccess.hasPermission("support.view");
  const accessChecking = checking || supportAccess.checking;

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-screen">
        <KubIcon name="spinner" size={24} tone="accent" label="Загрузка" />
      </div>
    );
  }

  // Both waiting states stand on the same ground as the panel they become.
  // They used to paint their own --kub-bg through `kub-grid-bg`, so the
  // ambient snapped into place the moment the role check finished.
  if (accessChecking) {
    return (
      <div className="flex items-center justify-center h-screen">
        <KubIcon name="spinner" size={24} tone="accent" label="Проверка ролей" />
      </div>
    );
  }

  if (!isStaff && !canViewSupport) return <Redirect to="/" />;

  const visibleTabs = TABS.filter((tab) => {
    if (tab.supportOnly) return canViewSupport;
    if (!isStaff) return false;
    return !tab.adminOnly || isAdmin;
  });
  const supportOnlyOperator = canViewSupport && !isStaff;

  return (
    // No fill on the root. --kub-ambient is painted once, on `body`; a shell
    // that paints --kub-bg over it hands the chrome one flat colour to blur,
    // and the material collapses back to the paint it replaced.
    <div data-testid="admin-shell" className="flex h-screen min-h-0 flex-col text-[color:var(--kub-text)]">
      {/* Title row and tab strip are ONE sheet, not two. Given the material
          separately, each would carry its own lit top edge and drop its own
          shadow onto the other, so the chrome would read as two stacked
          panels rather than as the frame of one tool. The rows keep the
          border that divides them; the material sits on the box holding
          them. Nothing `fixed` lives in here, so it wears `kub-glass`
          directly rather than needing a layer behind it. */}
      <div data-testid="admin-chrome" className="flex-shrink-0 kub-glass border-b border-[color:var(--kub-border-color)]">
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 h-14 border-b border-[color:var(--kub-border-color)]">
          <Link
            href="/"
            aria-label="Назад в чат"
            className="kub-icon-action p-1.5 rounded-lg kub-raise-hover transition-colors text-[color:var(--kub-cyan)] flex-shrink-0"
          >
            <KubIcon name="back" size={20} />
          </Link>
          <KubLogo size={22} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold flex items-center gap-2 text-[color:var(--kub-text)] truncate">
              Админ-панель
              <span className="hidden sm:inline text-[10px] uppercase tracking-[0.18em] text-[color:var(--kub-pink)] truncate">
                LETSCUBE
              </span>
            </div>
            <div className="text-xs text-[color:var(--kub-muted)] truncate">
              {isAdmin
                ? "Администратор"
                : supportOnlyOperator
                  ? "Оператор поддержки"
                  : "Менеджер"}{" "}
              · {currentUser.full_name ?? "Без имени"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1 px-1 sm:px-2 overflow-x-auto no-scrollbar">
          {visibleTabs.map((t) => {
            const active = location === t.path || location.startsWith(`${t.path}?`);
            return (
              <Link
                key={t.id}
                href={t.path}
                className={cn(
                  "flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 h-11 text-[11px] sm:text-xs font-semibold uppercase tracking-wide transition-colors whitespace-nowrap relative",
                  active ? "text-[color:var(--kub-accent-text)]" : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]"
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
      </div>

      {/* `kub-grid-subtle` also set `background-color: var(--kub-bg)`, and the
          lattice and the fill cannot be separated from out here. Across the
          whole work area that fill was the flat colour every panel below
          blurred, so the panels had no depth to find. The grid goes; the
          panels stand on the ambient, the way the message feed and the task
          list do. */}
      <div data-testid="admin-content" className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            "mx-auto p-3 pb-24 sm:p-4 sm:pb-8 md:p-6",
            location.startsWith("/admin/support") ? "max-w-[1600px]" : "max-w-5xl",
          )}
        >
          <Switch>
            <Route path="/admin/support">
              {canViewSupport ? <SupportTab /> : <Redirect to={isStaff ? "/admin" : "/"} />}
            </Route>
            <Route path="/admin" component={DashboardTab} />
            <Route path="/admin/users" component={UsersTab} />
            <Route path="/admin/locations">
              {isAdmin ? <LocationsTab /> : <Redirect to="/admin" />}
            </Route>
            <Route path="/admin/invites">
              {isAdmin ? <InvitesTab /> : <Redirect to="/admin" />}
            </Route>
            <Route path="/admin/roles">
              {isAdmin ? <RolesPermissionsTab /> : <Redirect to="/admin" />}
            </Route>
            <Route path="/admin/bans" component={BansMutesTab} />
            <Route path="/admin/ops">
              {isAdmin ? <OpsReportTab /> : <Redirect to="/admin" />}
            </Route>
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
