import { KubIcon, KubPanel } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { LEGACY_APP_ROLE_LABEL } from "@/lib/rolePermissions";
import { formatAdminAuditEvent, formatAdminDateTime } from "@/pages/admin/dashboardModel";
import type { AuditLogWithActor, Profile } from "@/types/database";

export function RecentActivity({ users, events, usersError, eventsError }: {
  users: Profile[];
  events: AuditLogWithActor[];
  usersError: string | null;
  eventsError: string | null;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <KubPanel padded={false} data-testid="admin-recent-users" className="overflow-hidden">
        <SectionHeader icon="users" title="Новые пользователи" detail="Последние регистрации" />
        <div className="divide-y divide-[color:var(--kub-border-color)]">
          {users.map((user) => (
            <div key={user.id} className="flex min-w-0 items-center gap-3 px-4 py-3">
              <UserAvatar user={user} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-[color:var(--kub-text)]">
                  {user.full_name ?? (user.username ? `@${user.username}` : "Пользователь")}
                </div>
                <div className="truncate text-xs text-[color:var(--kub-muted)]">
                  {LEGACY_APP_ROLE_LABEL[user.role]} · {formatAdminDateTime(user.created_at)}
                </div>
              </div>
              <span className={`h-2 w-2 shrink-0 rounded-full ${isOnline(user.online_at) ? "bg-[var(--kub-online)]" : "bg-[var(--kub-border-color)]"}`} aria-label={isOnline(user.online_at) ? "Онлайн" : "Не в сети"} />
            </div>
          ))}
          {!usersError && users.length === 0 && <EmptyRow text="Новых пользователей пока нет" />}
          {usersError && <ErrorRow text={usersError} />}
        </div>
      </KubPanel>

      <KubPanel padded={false} data-testid="admin-recent-events" className="overflow-hidden">
        <SectionHeader icon="audit" title="Последние события" detail="Действия администрации" />
        <div className="divide-y divide-[color:var(--kub-border-color)]">
          {events.map((event) => (
            <div key={event.id} className="flex min-w-0 gap-3 px-4 py-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--kub-pink)_12%,transparent)] text-[color:var(--kub-pink)]">
                <KubIcon name="activity" size={14} tone="currentColor" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm leading-snug text-[color:var(--kub-text)]">{formatAdminAuditEvent(event)}</div>
                <div className="mt-1 text-[11px] text-[color:var(--kub-muted)]">{formatAdminDateTime(event.created_at)}</div>
              </div>
            </div>
          ))}
          {!eventsError && events.length === 0 && <EmptyRow text="Событий пока нет" />}
          {eventsError && <ErrorRow text={eventsError} />}
        </div>
      </KubPanel>
    </div>
  );
}

function SectionHeader({ icon, title, detail }: { icon: "users" | "audit"; title: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-[color:var(--kub-border-color)] px-4 py-3">
      <KubIcon name={icon} size={16} tone="accent" />
      <div>
        <h3 className="text-sm font-semibold text-[color:var(--kub-text)]">{title}</h3>
        <p className="text-xs text-[color:var(--kub-muted)]">{detail}</p>
      </div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-xs text-[color:var(--kub-muted)]">{text}</div>;
}

function ErrorRow({ text }: { text: string }) {
  return <div className="px-4 py-4 text-xs text-[color:var(--kub-warn)]">{text}</div>;
}

function isOnline(value: string | null): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && Date.now() - time <= 60_000;
}
