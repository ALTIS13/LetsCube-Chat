"use client";

import { useEffect, useRef } from "react";
import { Link, useLocation, Route, Switch, Redirect } from "wouter";
import { useCanReadModerationQueue, usePermissionAccess, useRoleAccess } from "@/hooks/useRole";
import { useAppStore } from "@/store/app.store";
import { KubIcon, KubLogo, type KubIconName } from "@/components/kub";
import { cn } from "@/lib/utils";
import { DashboardTab } from "./DashboardTab";
import { UsersTab } from "./UsersTab";
import { BansMutesTab } from "./BansMutesTab";
import { ReportsTab } from "./ReportsTab";
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
  /**
   * Shown only to whoever the **database** calls staff.
   *
   * `isStaff` is wider than `public.is_manager_or_admin`, which is what reads
   * these rows, so a permission-only operator would be handed a screen that is
   * empty for them and looks like a queue with nothing in it. See
   * `lib/moderationAccess.ts`.
   */
  moderationQueue?: boolean;
};

const TABS: ReadonlyArray<TabDef> = [
  { id: "dashboard", label: "Сводка",       icon: "dashboard",  path: "/admin" },
  { id: "users",     label: "Пользователи", icon: "users",      path: "/admin/users" },
  { id: "locations", label: "Локации",      icon: "mapPin",     path: "/admin/locations", adminOnly: true },
  { id: "invites",   label: "Инвайты",      icon: "userPlus",   path: "/admin/invites", adminOnly: true },
  { id: "roles",     label: "Роли и права", icon: "shield",     path: "/admin/roles", adminOnly: true },
  { id: "bans",      label: "Блокировки",   icon: "shieldOff",  path: "/admin/bans", moderationQueue: true },
  // Beside «Блокировки» because it is the same job, and read by the same
  // people: `content_reports` is staff-only at the RLS layer through
  // `is_manager_or_admin`, exactly as `bans` and `mutes` are.
  { id: "reports",   label: "Жалобы",       icon: "warning",    path: "/admin/reports", moderationQueue: true },
  { id: "ops",       label: "Операции",      icon: "activity",   path: "/admin/ops", adminOnly: true },
  { id: "support",   label: "Поддержка",      icon: "help",       path: "/admin/support", supportOnly: true },
  // Audit log is admin-only at the RLS layer (managers see no rows);
  // hide the tab from managers entirely so they don't get sent to a
  // permission-denied empty state.
  { id: "audit",     label: "Журнал",       icon: "audit",      path: "/admin/audit", adminOnly: true },
];

export function AdminLayout() {
  const [location] = useLocation();
  const tabStrip = useRef<HTMLDivElement | null>(null);
  const currentUser = useAppStore((s) => s.currentUser);
  const { isStaff, isAdmin, checking } = useRoleAccess();
  const moderationQueue = useCanReadModerationQueue();
  const canReadReports = moderationQueue.allowed;
  const supportAccess = usePermissionAccess(["support.view"]);
  const canViewSupport = supportAccess.hasPermission("support.view");
  const accessChecking = checking || supportAccess.checking || moderationQueue.checking;

  /**
   * Bring the section being read into the strip's own view, and nothing else's.
   *
   * Scoped to the strip: `element.scrollIntoView()` walks every scrollable
   * ancestor, so on a screen where the content is also scrolled it would move
   * the page under the reader's hands to answer a question about a tab bar.
   * The arithmetic is the whole fix — `nearest` in both directions, expressed
   * as the two edges rather than as a call, so a tab just over the right edge
   * and one 679px past it take the same path.
   */
  useEffect(() => {
    const strip = tabStrip.current;
    if (!strip) return;
    const marked = strip.querySelector<HTMLElement>("[aria-current='page']");
    if (!marked) return;
    const stripBox = strip.getBoundingClientRect();
    const markedBox = marked.getBoundingClientRect();
    // 8px of the neighbour left showing, so the strip says it continues.
    const margin = 8;
    if (markedBox.right > stripBox.right) {
      strip.scrollLeft += markedBox.right - stripBox.right + margin;
    } else if (markedBox.left < stripBox.left) {
      strip.scrollLeft -= stripBox.left - markedBox.left + margin;
    }
  }, [location, accessChecking, isStaff, isAdmin, canReadReports, canViewSupport]);

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
    if (tab.moderationQueue) return canReadReports;
    return !tab.adminOnly || isAdmin;
  });
  const supportOnlyOperator = canViewSupport && !isStaff;

  return (
    // No fill on the root. --kub-ambient is painted once, on `body`; a shell
    // that paints --kub-bg over it hands the chrome one flat colour to blur,
    // and the material collapses back to the paint it replaced.
    <div data-testid="admin-shell" className="flex h-screen min-h-0 flex-col px-safe text-[color:var(--kub-text)]">
      {/* Title row and tab strip are ONE sheet, not two. Given the material
          separately, each would carry its own lit top edge and drop its own
          shadow onto the other, so the chrome would read as two stacked
          panels rather than as the frame of one tool. The rows keep the
          border that divides them; the material sits on the box holding
          them. Nothing `fixed` lives in here, so it wears the material
          directly rather than needing a layer behind it.

          The sheet is the top of the screen, so it pads the status bar's
          inset out of its own top, and the shell pads the notch off both
          sides when the phone is held sideways. */}
      <div data-testid="admin-chrome" className="flex-shrink-0 kub-glass border-b border-[color:var(--kub-border-color)] pt-safe">
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 h-14 border-b border-[color:var(--kub-border-color)]">
          <Link
            href="/"
            aria-label="Назад в чат"
            className="kub-icon-action p-1.5 rounded-lg kub-raise-hover transition-colors text-[color:var(--kub-cyan)] flex-shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
          >
            <KubIcon name="back" size={20} />
          </Link>
          <KubLogo size={22} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold flex items-center gap-2 text-[color:var(--kub-text)] truncate">
              Админ-панель
              <span className="hidden sm:inline text-[12px] uppercase tracking-[0.18em] text-[color:var(--kub-pink)] truncate">
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

        {/* The strip scrolls, and until item 39 nothing ever scrolled it.
            Measured at 390 on the fixture: on `/admin/support` the marked tab
            sat **679px past the right edge** of a 390px strip with
            `scrollLeft` at 0, and on `/admin/roles` 206px past it — so on a
            phone the administration's only navigation showed four sections
            the reader was not in and never the one they were. A support
            operator, whose one tab is the last of ten, could not see it at
            all. `useEffect` rather than `scrollIntoView` on the element: that
            call walks every scrollable ancestor and would take the page with
            it, which is how a fix for this becomes a jump. */}
        <div ref={tabStrip} data-testid="admin-tabs" className="flex items-center gap-0.5 sm:gap-1 px-1 sm:px-2 overflow-x-auto no-scrollbar">
          {visibleTabs.map((t) => {
            const active = location === t.path || location.startsWith(`${t.path}?`);
            return (
              <Link
                key={t.id}
                href={t.path}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 h-11 text-[12px] sm:text-xs font-semibold uppercase tracking-wide transition-colors whitespace-nowrap relative",
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
            {/* Behind the same rule as «Жалобы», and for a sharper reason.
                `bans` and `mutes` each carry two read policies —
                `managers read all bans` (`is_manager_or_admin`) and
                `user reads own bans`. Somebody who is `isStaff` in the client
                but not staff to the database therefore opened this screen and
                was shown *their own* sanctions as if they were the whole
                list: a list complete in appearance and wrong in fact, with no
                error anywhere to notice. Measured on production on
                2026-09-14: 18 accounts, 5 staff to the database, 7 holding a
                staff permission, **2 in the gap** — so this was happening to
                real people rather than being latent. D-188. */}
            <Route path="/admin/bans">
              {canReadReports ? <BansMutesTab /> : <Redirect to="/admin" />}
            </Route>
            {/* Gated rather than mounted bare, unlike the tabs above it. A
                support-only operator reaches this shell for their own tab, and
                the reporter's name exists nowhere else in the product — an
                empty queue would be the wrong answer to give them, and the
                right one is not to route them here at all. */}
            <Route path="/admin/reports">
              {canReadReports ? <ReportsTab /> : <Redirect to="/admin" />}
            </Route>
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
