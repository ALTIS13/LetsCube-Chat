import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "wouter";

import { BotCreateModal } from "@/components/bots/BotCreateModal";
import { BotSettingsPanel } from "@/components/bots/BotSettingsPanel";
import { BotTokenDialog, type BotTokenDialogHandle } from "@/components/bots/BotTokenDialog";
import { KubBadge, KubButton, KubEmptyState, KubHeader, KubIcon } from "@/components/kub";
import { useBotDetail, useBots } from "@/hooks/useBots";
import type { BotSummary } from "@/lib/botManagement";
import { describeCreationBlock } from "@/lib/botCreationBlock";
import { cn } from "@/lib/utils";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATE_COPY = {
  active: "Активен",
  paused: "На паузе",
  suspended: "Приостановлен платформой",
  pending_delete: "Удаление запланировано",
  deleted: "Удалён",
} as const;

export function BotsPage() {
  const [, setLocation] = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const list = useBots();
  const [createOpen, setCreateOpen] = useState(false);
  const tokenDialog = useRef<BotTokenDialogHandle>(null);
  const selectedId = selectedBotId(searchParams);
  const detail = useBotDetail(selectedId);

  useEffect(() => () => tokenDialog.current?.clear(), []);

  const select = (botId: string | null) => {
    setSearchParams(botId ? { bot: botId } : {});
  };
  const created = (token: string, botId: string) => {
    tokenDialog.current?.show(token);
    void queryClient.invalidateQueries({ queryKey: ["bot-management", "list"] });
    select(botId);
  };
  const refreshAfterUncertainCreate = () =>
    queryClient.refetchQueries({ queryKey: ["bot-management", "list"] });
  const eligibility = list.data?.eligibility;

  // <main> carries no background of its own. Both panes below paint theirs and
  // fill the row at every breakpoint, so the only place that fill was ever
  // visible was the strip behind the header — where it cancelled the header's
  // translucency by putting a flat colour directly behind it.
  return (
    <main data-testid="bots-page" className="bots-management-surface flex h-[100dvh] min-w-0 flex-col overflow-hidden text-[color:var(--kub-text)]">
      <KubHeader
        title={<h1 className="truncate text-sm font-semibold">Мои боты</h1>}
        subtitle={eligibility ? `${eligibility.active_bot_count} из ${eligibility.max_bots}` : "Управление Bot API"}
        leading={<button type="button" onClick={() => setLocation("/")} className="flex h-11 w-11 items-center justify-center rounded-md text-[color:var(--kub-muted)] kub-raise-hover" aria-label="Назад к чатам"><KubIcon name="back" size={18} /></button>}
        trailing={
          <div className="flex items-center gap-2">
            {/* The Bot API documentation has existed at /bots/docs all along and
                nothing linked to it, so it could only be found by knowing the
                address. */}
            <a
              href="/bots/docs"
              target="_blank"
              rel="noreferrer"
              className="kub-button kub-interactive inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)]"
            >
              <KubIcon name="help" size={15} />
              Документация
            </a>
            <KubButton variant="primary" size="sm" className="min-h-11" disabled={!eligibility?.can_create} onClick={() => setCreateOpen(true)} leftIcon={<KubIcon name="bot" size={17} />}>Создать бота</KubButton>
          </div>
        }
      />

      <div className="grid min-h-0 flex-1 md:grid-cols-[22rem_minmax(0,1fr)]">
        <section data-testid="bots-list-pane" aria-label="Список ботов" className={cn("min-h-0 min-w-0 border-r border-[color:var(--kub-border-color)] bg-[var(--kub-surface)]", selectedId ? "hidden md:flex" : "flex", "flex-col")}>
          {!eligibility?.can_create && eligibility && <EligibilityNotice eligibility={eligibility} />}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
            {list.isLoading && <BotListSkeleton />}
            {list.isError && <div role="alert" className="rounded-md border border-[color:var(--kub-danger)]/40 p-4 text-sm"><div>Не удалось загрузить список ботов.</div><KubButton variant="secondary" size="sm" className="mt-3 min-h-11" onClick={() => void list.refetch()}>Повторить</KubButton></div>}
            {list.data?.bots.length === 0 && <KubEmptyState icon={<KubIcon name="bot" size={28} />} title="У вас пока нет ботов" description="Создайте бота, чтобы подключить его к чатам через Bot API." action={eligibility?.can_create ? <KubButton className="min-h-11" onClick={() => setCreateOpen(true)}>Создать бота</KubButton> : undefined} />}
            <div className="space-y-1">
              {list.data?.bots.map((bot) => <BotRow key={bot.id} bot={bot} selected={bot.id === selectedId} onSelect={() => select(bot.id)} />)}
            </div>
            {list.isFetching && !list.isLoading && <div role="status" className="px-2 py-2 text-xs text-[color:var(--kub-muted)]">Обновляем…</div>}
          </div>
        </section>

        <section data-testid="bots-detail-pane" aria-label="Настройки бота" className={cn("min-h-0 min-w-0 bg-[var(--kub-bg)]", selectedId ? "flex" : "hidden md:flex", "flex-col")}>
          {selectedId ? (
            <>
              <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[color:var(--kub-border-color)] px-3 md:hidden">
                <button type="button" onClick={() => select(null)} className="flex h-11 min-w-11 items-center gap-2 rounded-md px-2 text-sm text-[color:var(--kub-muted)] kub-raise-hover" aria-label="Назад к списку"><KubIcon name="back" size={18} />К списку</button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {detail.isLoading && <DetailSkeleton />}
                {detail.isError && <div role="alert" className="m-4 rounded-md border border-[color:var(--kub-danger)]/40 p-4 text-sm sm:m-6"><div>Не удалось загрузить настройки бота.</div><KubButton variant="secondary" className="mt-3 min-h-11" onClick={() => void detail.refetch()}>Повторить</KubButton></div>}
                {detail.data && <BotSettingsPanel detail={detail.data} onToken={(token) => tokenDialog.current?.show(token)} />}
              </div>
            </>
          ) : (
            <KubEmptyState icon={<KubIcon name="bot" size={28} />} title="Выберите бота" description="Настройки и диагностика откроются здесь." className="m-auto" />
          )}
        </section>
      </div>

      <BotCreateModal open={createOpen} onOpenChange={setCreateOpen} onCreated={created} onUncertain={refreshAfterUncertainCreate} />
      <BotTokenDialog ref={tokenDialog} />
    </main>
  );
}

function selectedBotId(searchParams: URLSearchParams) {
  const value = searchParams.get("bot");
  return value && UUID_RE.test(value) ? value : null;
}

function BotRow({ bot, selected, onSelect }: { bot: BotSummary; selected: boolean; onSelect(): void }) {
  const tone = bot.state === "active" ? "online" : bot.state === "paused" ? "warn" : bot.state === "deleted" ? "muted" : "danger";
  return <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined} className={cn("flex w-full min-w-0 items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors", selected ? "border-[color:var(--kub-cyan)] bg-[color-mix(in_srgb,var(--kub-cyan)_8%,var(--kub-surface))]" : "border-transparent hover:border-[color:var(--kub-border-color)] kub-raise-hover")}><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--kub-surface-2)] text-[color:var(--kub-cyan)]"><KubIcon name="bot" size={21} /></div><div className="min-w-0 flex-1"><div className="break-words text-sm font-semibold text-[color:var(--kub-text)]">{bot.display_name}</div><div className="break-all text-xs text-[color:var(--kub-muted)]">@{bot.username}</div><div className="mt-2 flex flex-wrap items-center gap-1.5"><KubBadge tone={tone} dot className="text-[color:var(--kub-text)]">{STATE_COPY[bot.state]}</KubBadge><KubBadge tone="muted">{bot.role === "owner" ? "Владелец" : "Разработчик"}</KubBadge></div><div className="mt-2 text-[11px] text-[color:var(--kub-muted)]">Обновлён {formatDate(bot.updated_at)}</div></div><KubIcon name="chevronRight" size={16} className="mt-2 shrink-0 text-[color:var(--kub-muted)]" /></button>;
}

function EligibilityNotice({ eligibility }: { eligibility: NonNullable<ReturnType<typeof useBots>["data"]>["eligibility"] }) {
  const message = describeCreationBlock(eligibility);
  if (!message) return null;
  return (
    <div className="border-b border-[color:var(--kub-border-color)] px-4 py-3 text-xs leading-5 text-[color:var(--kub-muted)]">
      {message}
    </div>
  );
}

function BotListSkeleton() {
  return <div aria-label="Загрузка списка ботов" role="status" className="space-y-2"><span className="sr-only">Загрузка</span>{[0, 1, 2].map((item) => <div key={item} className="h-[6.5rem] animate-pulse rounded-md bg-[var(--kub-surface-2)] motion-reduce:animate-none" />)}</div>;
}

function DetailSkeleton() {
  return <div aria-label="Загрузка настроек бота" role="status" className="space-y-3 p-4 sm:p-6"><div className="h-20 animate-pulse rounded-md bg-[var(--kub-surface-2)] motion-reduce:animate-none" /><div className="h-11 animate-pulse rounded-md bg-[var(--kub-surface-2)] motion-reduce:animate-none" /><div className="h-64 animate-pulse rounded-md bg-[var(--kub-surface-2)] motion-reduce:animate-none" /></div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
