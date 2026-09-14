"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  KubBadge,
  KubButton,
  KubEmptyState,
  KubFilterSummary,
  KubIcon,
  KubNotice,
  KubPanel,
  type ActiveFilter,
  type KubIconName,
} from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useAppStore } from "@/store/app.store";
import type { Profile } from "@/types/database";
import { mapPgError, prefixError } from "@/lib/errors";
import { plainAdminMessage } from "@/lib/adminPrompts";
import { listReadView, readReplacesScreen } from "@/lib/listReadState";
import { requestAppConfirm, showAppAlert } from "@/lib/appDialogs";
import {
  ADMIN_REPORTS_UNAVAILABLE,
  DEFAULT_REPORT_STATUS_FILTER,
  REPORTS_PRIVACY_NOTE,
  REPORT_RESOLUTION_LABEL,
  REPORT_RESOLVE_FAILED,
  REPORT_RESOLVE_FORBIDDEN,
  REPORT_STATUS_FILTERS,
  REPORT_STATUS_FILTER_LABEL,
  reportActions,
  reportKindLabel,
  reportMatchesFilter,
  reportReasonLabel,
  reportResolutionPatch,
  reportResolutionPrompt,
  reportStatusFilterValues,
  reportStatusLabel,
  reportStatusTone,
  reportedMessagePreview,
  reportedMessageNotice,
  reportedMessageView,
  reportsEmptyHint,
  reportsEmptyTitle,
  sortReportQueue,
  type ReportResolution,
  type ReportStatusFilter,
} from "@/lib/contentReportQueue";

/**
 * «Жалобы» — the staff queue over `public.content_reports`.
 *
 * One more tab in a screen that already has several, and it deliberately reads
 * as one: the same `KubPanel` rows as «Блокировки и мьюты», the same
 * `KubFilterSummary` chip as «Пользователи», the same four-state read from
 * `listReadState.ts`.
 *
 * THREE THINGS THIS SCREEN MUST NOT DO, each written down because each is a
 * thing somebody adding a feature here would otherwise do by default.
 *
 * 1. **It must not edit a report.** `grant update (status, handled_by,
 *    handled_at)` is column-level, so the server would refuse anyway — but the
 *    reason the grant is shaped that way is that `note` and `reason` are
 *    somebody's testimony about what happened to them. A queue that can rewrite
 *    the complaint it is deciding cannot be read back afterwards as evidence of
 *    anything. Every write here goes through `reportResolutionPatch`, and there
 *    is no field on this screen that takes text.
 *
 * 2. **It must not show the reporter to anybody but staff.** The SELECT policy
 *    is `is_manager_or_admin(auth.uid())`, and this route is behind the
 *    administration's own `isStaff` gate in `AdminLayout` as well — the reporter
 *    column exists nowhere else in the product, and the person reported is never
 *    told who named them.
 *
 * 3. **It must not offer «Меры приняты» as a way to ban.** Banning lives in
 *    «Блокировки», with its own reason, its own expiry and its own audit row.
 *    Two places issuing the same sanction is how two truths about one person
 *    appear, so this screen's «Меры приняты» is a note in the queue and says so
 *    in its own confirmation. Nothing here writes `bans` or `mutes`.
 */

type ReportProfile = Pick<Profile, "id" | "full_name" | "username" | "avatar_url">;

interface ReportRow {
  id: string;
  kind: string;
  reason: string;
  note: string | null;
  status: string;
  created_at: string;
  handled_at: string | null;
  message_id: string | null;
  reporter?: ReportProfile | null;
  target?: ReportProfile | null;
  handler?: Pick<Profile, "id" | "full_name" | "username"> | null;
  message?: { id: string; content: string | null; deleted_at: string | null } | null;
}

/**
 * The read, written out once.
 *
 * `messages` is embedded on purpose: a decision about a reported message should
 * not need a second screen. It comes back empty more often than not — the only
 * SELECT policy on that table is `is_chat_member(chat_id)` — and
 * `reportedMessageView` is what tells "deleted" apart from "not mine to read".
 */
const REPORT_SELECT =
  "id,kind,reason,note,status,created_at,handled_at,message_id," +
  "reporter:profiles!content_reports_reporter_id_fkey(id,full_name,username,avatar_url)," +
  "target:profiles!content_reports_target_user_id_fkey(id,full_name,username,avatar_url)," +
  "handler:profiles!content_reports_handled_by_fkey(id,full_name,username)," +
  "message:messages!content_reports_message_id_fkey(id,content,deleted_at)";

const PAGE_LIMIT = 500;

const RESOLUTION_ICON: Record<ReportResolution, KubIconName> = {
  reviewing: "eye",
  actioned: "checkCircle",
  dismissed: "reject",
};

const fmt = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export function ReportsTab() {
  const supabase = createClient();
  const currentUser = useAppStore((s) => s.currentUser);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [filter, setFilter] = useState<ReportStatusFilter>(DEFAULT_REPORT_STATUS_FILTER);
  const [loading, setLoading] = useState(true);
  // D-140, the same two facts the sanctions tab needed: whether the last read
  // failed, and whether anything has ever been read. Without the first a
  // refused query renders «Открытых жалоб нет», which tells somebody on duty
  // that nobody has complained; without the second every realtime change blanks
  // the tab back to a spinner while it re-reads.
  const [error, setError] = useState<string | null>(null);
  const loadedOnceRef = useRef(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const filterId = useId();

  // The filter is part of the query, so a slow answer to the previous filter
  // must not land on top of the current one.
  const requestRef = useRef(0);

  const load = useCallback(
    async (options: { background?: boolean } = {}) => {
      const replaces = readReplacesScreen({
        background: options.background === true,
        loadedOnce: loadedOnceRef.current,
      });
      if (replaces) setLoading(true);
      const ticket = (requestRef.current += 1);

      // The condition goes on before the order does. `.order()` answers with a
      // transform builder, and `.in()` belongs to the filter builder one level
      // below it; the table name is cast, so nothing here would have been
      // typechecked either way, and a builder call that only works because the
      // library happens to return `this` is not a thing to rely on.
      const statuses = reportStatusFilterValues(filter);
      const selected = supabase.from("content_reports" as any).select(REPORT_SELECT);
      const filtered = statuses
        ? selected.in("status", statuses as unknown as string[])
        : selected;

      // `content_reports_status_created_idx` is `(status, created_at desc)`;
      // this is the half of the order it serves. `sortReportQueue` does the
      // other half, which is ranking the statuses against each other.
      const { data, error: readError } = await filtered
        .order("created_at", { ascending: false })
        .limit(PAGE_LIMIT);
      if (ticket !== requestRef.current) return;

      // A failed read is not an empty one. Rows already on screen are older
      // than the database but they are true; blanking them would put something
      // false in their place.
      if (readError) {
        console.error("content reports read failed:", readError);
        setError(plainAdminMessage(mapPgError(readError), ADMIN_REPORTS_UNAVAILABLE));
        setLoading(false);
        return;
      }
      setRows(sortReportQueue((data ?? []) as unknown as ReportRow[]));
      setError(null);
      loadedOnceRef.current = true;
      setLoading(false);
    },
    [supabase, filter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // One subscription for the life of the tab. `load` changes with the filter,
  // so subscribing to it directly would tear the channel down and build it
  // again every time somebody looked at a different status.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedLoad = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void loadRef.current({ background: true });
      }, 500);
    };
    const channel = supabase
      .channel("admin-content-reports")
      .on("postgres_changes", { event: "*", schema: "public", table: "content_reports" }, debouncedLoad)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  /**
   * One of the three decisions, asked for first and then written.
   *
   * The patch is `reportResolutionPatch`'s three columns and nothing else, and
   * `.select("id")` is what makes a refusal legible: PostgREST answers an UPDATE
   * that matched no row with success and an empty body, so without it a
   * moderator whose account is not `is_manager_or_admin` at the database's
   * definition would watch the row change on screen and change back on the next
   * read.
   */
  const resolveReport = async (row: ReportRow, resolution: ReportResolution) => {
    if (!currentUser || busyId) return;
    const confirmed = await requestAppConfirm({
      ...reportResolutionPrompt(resolution, profileName(row.target)),
      icon: RESOLUTION_ICON[resolution],
    });
    if (!confirmed) return;
    const patch = reportResolutionPatch(resolution, currentUser.id, new Date());
    setBusyId(row.id);
    const { data, error: writeError } = await supabase
      .from("content_reports" as any)
      .update(patch)
      .eq("id", row.id)
      .select("id")
      .maybeSingle();
    setBusyId(null);
    if (writeError) {
      console.error("content report resolve failed:", writeError);
      showAppAlert(prefixError(REPORT_RESOLVE_FAILED, writeError), "Ошибка");
      return;
    }
    if (!data) {
      showAppAlert(REPORT_RESOLVE_FORBIDDEN, "Ошибка");
      return;
    }
    const handler = {
      id: currentUser.id,
      full_name: currentUser.full_name ?? null,
      username: currentUser.username ?? null,
    };
    setRows((current) =>
      // A row that no longer matches the filter leaves the list it stopped
      // belonging to, rather than waiting for the next read to remove it for
      // no reason the reader can see.
      current.flatMap((item) => {
        if (item.id !== row.id) return [item];
        if (!reportMatchesFilter(patch.status, filter)) return [];
        return [{ ...item, status: patch.status, handled_at: patch.handled_at, handler }];
      }),
    );
  };

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    if (filter === "all") return [];
    return [
      {
        id: "status",
        label: `Статус: ${REPORT_STATUS_FILTER_LABEL[filter]}`,
        onRemove: () => setFilter("all"),
      },
    ];
  }, [filter]);

  const view = listReadView({ loading, error, loadedOnce: loadedOnceRef.current });

  if (view === "loading") {
    return (
      <div className="flex items-center justify-center py-16">
        <KubIcon name="spinner" size={24} tone="accent" label="Загрузка" />
      </div>
    );
  }

  // Nothing has ever loaded and the read failed: there is nothing truthful to
  // show but the failure itself, and a way to ask again.
  if (view === "unavailable") {
    return (
      <div className="py-10" data-testid="reports-error">
        <KubNotice tone="danger" className="text-sm">
          {error}
        </KubNotice>
        <div className="mt-3 flex justify-center">
          <KubButton size="sm" variant="secondary" onClick={() => void load()}>
            Повторить
          </KubButton>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-3 pb-24 sm:pb-4" data-testid="reports-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-[color:var(--kub-text)]">
          Жалобы{" "}
          <span className="text-sm font-normal text-[color:var(--kub-muted)]">· {rows.length}</span>
        </h2>
        <div className="flex min-w-0 items-center gap-2">
          <label
            htmlFor={filterId}
            className="text-[12px] font-semibold tracking-wider text-[color:var(--kub-accent-text)]"
          >
            Статус
          </label>
          <select
            id={filterId}
            value={filter}
            onChange={(event) => setFilter(event.target.value as ReportStatusFilter)}
            className="h-9 min-w-0 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-2 text-xs text-[color:var(--kub-text)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
          >
            {REPORT_STATUS_FILTERS.map((option) => (
              <option key={option} value={option}>
                {REPORT_STATUS_FILTER_LABEL[option]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* The queue opens filtered, so the chip is owed from the first frame:
          without it «Открытых жалоб нет» reads as «жалоб нет». */}
      <KubFilterSummary
        matched={rows.length}
        total={rows.length}
        filters={activeFilters}
        onReset={() => setFilter("all")}
        noun="жалоб"
      />

      {view === "stale" && (
        <div className="flex flex-wrap items-center gap-2" data-testid="reports-stale">
          <KubNotice tone="danger" className="min-w-0 flex-1 text-xs">
            Список мог устареть: {error}
          </KubNotice>
          <KubButton size="sm" variant="secondary" onClick={() => void load()}>
            Повторить
          </KubButton>
        </div>
      )}

      <KubPanel className="overflow-hidden p-0">
        <div className="flex items-start gap-2 px-4 py-3 border-b border-[color:var(--kub-rule)]">
          <KubIcon name="lock" size={13} tone="muted" />
          <p className="text-[12px] leading-relaxed text-[color:var(--kub-muted)]">
            {REPORTS_PRIVACY_NOTE}
          </p>
        </div>

        {rows.length === 0 ? (
          <KubEmptyState
            icon={<KubIcon name="checkCircle" size={22} />}
            title={reportsEmptyTitle(filter)}
            description={reportsEmptyHint(filter) ?? undefined}
          />
        ) : (
          rows.map((row) => (
            <ReportCard
              key={row.id}
              row={row}
              busy={busyId === row.id}
              canResolve={Boolean(currentUser)}
              onResolve={(resolution) => void resolveReport(row, resolution)}
            />
          ))
        )}
      </KubPanel>
    </div>
  );
}

function ReportCard({
  row,
  busy,
  canResolve,
  onResolve,
}: {
  row: ReportRow;
  busy: boolean;
  canResolve: boolean;
  onResolve: (resolution: ReportResolution) => void;
}) {
  const reported = reportedMessageView(row);
  const actions = reportActions(row.status);
  return (
    <div className="border-t border-[color:var(--kub-rule)] px-4 py-3">
      <div className="flex items-start gap-3">
        {row.target ? (
          <UserAvatar user={row.target} size="sm" />
        ) : (
          <div className="kub-raise h-9 w-9 flex-shrink-0 rounded-full" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[color:var(--kub-text)]">
              {row.target?.full_name ?? "Пользователь"}
            </span>
            {row.target?.username && (
              <span className="text-xs text-[color:var(--kub-muted)]">@{row.target.username}</span>
            )}
            <KubBadge tone={reportStatusTone(row.status)} pill>
              {reportStatusLabel(row.status)}
            </KubBadge>
          </div>

          <div className="mt-0.5 break-words text-xs text-[color:var(--kub-text)]">
            {reportReasonLabel(row.reason)}{" "}
            <span className="text-[color:var(--kub-muted)]">· жалоба {reportKindLabel(row.kind)}</span>
          </div>

          {/* What was reported. A quote when it can be read, and an honest
              sentence when it cannot — «не моё, чтобы читать» and «удалено»
              are different facts and the row says which one it has.

              The bar is `--kub-rule`, not `--kub-border-color`: it is a line
              inside a sheet rather than the sheet's own edge, and the quoted
              text one folder over in `support/SupportTicketDetails.tsx` draws
              itself the same way. */}
          {reported.kind !== "none" && (
            <div className="mt-2 rounded-lg border-l-2 border-[color:var(--kub-rule)] bg-[var(--kub-inset)] px-3 py-2">
              {reported.kind === "text" ? (
                <p className="whitespace-pre-wrap break-words text-xs text-[color:var(--kub-text)]">
                  {reportedMessagePreview(reported.text)}
                </p>
              ) : (
                <p className="text-xs italic text-[color:var(--kub-muted)]">
                  {reportedMessageNotice(reported)}
                </p>
              )}
            </div>
          )}

          {row.note && (
            <div className="mt-2 break-words text-xs text-[color:var(--kub-text)]">
              <span className="text-[color:var(--kub-muted)]">Комментарий: </span>
              {row.note}
            </div>
          )}

          <div className="mt-1 break-words text-[12px] text-[color:var(--kub-muted)]">
            Пожаловался: {profileLabel(row.reporter)} · {fmt(row.created_at)}
            {row.handled_at && (
              <>
                {" "}
                · Разобрал: {profileLabel(row.handler)} · {fmt(row.handled_at)}
              </>
            )}
          </div>
        </div>
      </div>

      {canResolve && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-12">
          {actions.map((resolution) => (
            <KubButton
              key={resolution}
              type="button"
              size="sm"
              // «Меры приняты» is the one that makes a claim about a person in
              // the record, so it is the one that looks like it.
              variant={resolution === "actioned" ? "danger" : "secondary"}
              disabled={busy}
              onClick={() => onResolve(resolution)}
              leftIcon={<KubIcon name={RESOLUTION_ICON[resolution]} size={13} />}
            >
              {REPORT_RESOLUTION_LABEL[resolution]}
            </KubButton>
          ))}
        </div>
      )}
    </div>
  );
}

/** The name a question about this person should use, or nothing. */
function profileName(user: Pick<Profile, "full_name" | "username"> | null | undefined): string {
  const full = user?.full_name?.trim();
  if (full) return full;
  const username = user?.username?.trim();
  return username ? `@${username}` : "";
}

/** The name a line about this person should show. */
function profileLabel(user: Pick<Profile, "full_name" | "username"> | null | undefined): string {
  return profileName(user) || "не указан";
}
