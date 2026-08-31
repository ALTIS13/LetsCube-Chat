import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useEffect, useState } from "react";

import { KubBadge, KubButton, KubEmptyState, KubIcon, KubInput } from "@/components/kub";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBotMutations } from "@/hooks/useBots";
import { BotManagementError, botManagement, type BotCommand, type BotDetail } from "@/lib/botManagement";

type Props = {
  detail: BotDetail;
  onToken(token: string): void;
};

type ConfirmAction = "pause" | "rotate" | "revoke" | "delete" | null;

const STATE_COPY = {
  active: "Активен",
  paused: "На паузе",
  suspended: "Приостановлен платформой",
  pending_delete: "Удаление запланировано",
  deleted: "Удалён",
} as const;

export function BotSettingsPanel({ detail, onToken }: Props) {
  const { bot } = detail;
  const owner = bot.role === "owner";
  const editable = bot.state === "active" || bot.state === "paused";
  const mutations = useBotMutations(bot.id);
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState({ display_name: bot.display_name, description: bot.description });
  const [commands, setCommands] = useState<BotCommand[]>(detail.commands);
  const [developerUsername, setDeveloperUsername] = useState("");
  const [webhook, setWebhook] = useState({ url: detail.webhook.url ?? "", secret: "", drop: false });

  useEffect(() => {
    setProfile({ display_name: bot.display_name, description: bot.description });
    setCommands(detail.commands);
    setWebhook((current) => ({ ...current, url: detail.webhook.url ?? "", secret: "" }));
    setError(null);
  }, [bot.id, bot.display_name, bot.description, detail.commands, detail.webhook.url]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      setConfirm(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить действие.");
    }
  };

  const rotate = async () => {
    setError(null);
    try {
      const result = await botManagement.rotateOnce(bot.id, bot.token?.prefix ?? null);
      onToken(result.token);
      setConfirm(null);
      await mutations.refresh();
    } catch (cause) {
      setConfirm(null);
      if (cause instanceof BotManagementError && cause.code === "uncertain_result") {
        try {
          await mutations.refresh();
        } catch {
          // Recovery remains explicit even when the refresh itself is unavailable.
        }
        setError(
          "Запрос мог выполниться. Мы обновили данные бота. Проверьте префикс токена; если новый токен недоступен, повторно выпустите новый токен явным действием.",
        );
      } else {
        setError(cause instanceof Error ? cause.message : "Не удалось выпустить токен.");
      }
    }
  };

  const saveWebhook = () => run(async () => {
    await botManagement.setWebhook(bot.id, {
      url: webhook.url,
      secret: webhook.secret,
      drop_pending_updates: webhook.drop,
    });
    setWebhook((current) => ({ ...current, secret: "" }));
    await mutations.refresh();
  });

  return (
    <div className="min-w-0">
      <div className="border-b border-[color:var(--kub-border-color)] px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <BotMark name={bot.display_name} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="break-words text-lg font-semibold text-[color:var(--kub-text)]">{bot.display_name}</h2>
              <LifecycleBadge state={bot.state} />
            </div>
            <div className="mt-0.5 break-all text-sm text-[color:var(--kub-muted)]">@{bot.username}</div>
            {bot.state === "pending_delete" && bot.delete_after && (
              <div className="mt-2 text-xs text-[color:var(--kub-danger)]">
                Удаление после <time dateTime={bot.delete_after}>{formatDate(bot.delete_after)}</time>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <div role="alert" className="mx-4 mt-4 rounded-md border border-[color:var(--kub-danger)]/40 bg-[color-mix(in_srgb,var(--kub-danger)_8%,transparent)] px-3 py-2 text-sm text-[color:var(--kub-text)] sm:mx-6">{error}</div>}
      {bot.state === "suspended" && <Notice>Бот приостановлен платформой. Владелец не может изменить состояние или настройки.</Notice>}
      {bot.state === "pending_delete" && <Notice>Настройки доступны только для чтения. Отмена вернёт бота на паузу без токена.</Notice>}
      {!owner && <Notice>Доступ разработчика: команды, webhook, настройки приватности и диагностика.</Notice>}

      <Tabs defaultValue="main" className="min-w-0">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-none border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-2 sm:grid-cols-4">
          {[["main", "Основное"], ["api", "API"], ["team", "Команда"], ["diagnostics", "Диагностика"]].map(([value, label]) => (
            <TabsTrigger key={value} value={value} className="min-h-11 rounded-md text-xs text-[color:var(--kub-muted)] data-[state=active]:bg-[var(--kub-surface-2)] data-[state=active]:text-[color:var(--kub-text)] data-[state=active]:shadow-none">{label}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="main" className="m-0 space-y-5 p-4 sm:p-6">
          <Section title="Профиль" description={owner ? "Имя пользователя закреплено за ботом и не изменяется." : "Профиль доступен только владельцу."}>
            <div className="grid gap-3">
              <KubInput label="Название" value={profile.display_name} onChange={(event) => setProfile({ ...profile, display_name: event.target.value })} disabled={!owner || !editable} maxLength={64} />
              <div>
                <label htmlFor={`bot-description-${bot.id}`} className="text-xs font-medium uppercase text-[color:var(--kub-muted)]">Описание</label>
                <textarea id={`bot-description-${bot.id}`} value={profile.description} onChange={(event) => setProfile({ ...profile, description: event.target.value })} disabled={!owner || !editable} maxLength={512} rows={4} className="mt-1.5 w-full resize-none rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] p-3 text-sm text-[color:var(--kub-text)] outline-none disabled:opacity-60" />
              </div>
              {owner && <KubButton className="min-h-11 justify-self-start" disabled={!editable || mutations.profile.isPending} onClick={() => run(() => mutations.profile.mutateAsync(profile))}>Сохранить профиль</KubButton>}
            </div>
          </Section>

          {owner && (
            <Section title="Состояние" description="Пауза останавливает API-операции и доставку обновлений.">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {bot.state === "active" && <KubButton variant="secondary" className="min-h-11" onClick={() => setConfirm("pause")} leftIcon={<KubIcon name="pause" size={17} />}>Поставить на паузу</KubButton>}
                {bot.state === "paused" && <KubButton variant="primary" className="min-h-11" disabled={!bot.token || mutations.resume.isPending} onClick={() => run(() => mutations.resume.mutateAsync())} leftIcon={<KubIcon name="play" size={17} />}>Возобновить</KubButton>}
                {bot.state === "pending_delete" && <KubButton variant="secondary" className="min-h-11" disabled={mutations.cancelDeletion.isPending} onClick={() => run(() => mutations.cancelDeletion.mutateAsync())}>Отменить удаление</KubButton>}
              </div>
              {bot.state === "paused" && !bot.token && <p className="mt-2 text-xs text-[color:var(--kub-muted)]">Сначала выпустите новый токен во вкладке API.</p>}
            </Section>
          )}

          {owner && (bot.state === "active" || bot.state === "paused") && (
            <Section title="Удаление" description="Запрос сразу отзывает токен. Удаление можно отменить в течение семи дней.">
              <KubButton variant="danger" className="min-h-11" onClick={() => setConfirm("delete")} leftIcon={<KubIcon name="delete" size={17} />}>Запросить удаление</KubButton>
            </Section>
          )}
        </TabsContent>

        <TabsContent value="api" className="m-0 space-y-5 p-4 sm:p-6">
          <Section title="Команды" description="До 100 команд, доступных пользователям бота.">
            <div className="space-y-2">
              {commands.map((command, index) => (
                <div key={`${command.command}-${index}`} className="grid gap-2 border-b border-[color:var(--kub-border-color)] pb-3 sm:grid-cols-[10rem_1fr_2.75rem]">
                  <KubInput aria-label={`Команда ${index + 1}`} value={command.command} disabled={!editable} onChange={(event) => setCommands(commands.map((item, itemIndex) => itemIndex === index ? { ...item, command: event.target.value.toLowerCase() } : item))} />
                  <KubInput aria-label={`Описание команды ${index + 1}`} value={command.description} disabled={!editable} onChange={(event) => setCommands(commands.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} />
                  <button type="button" aria-label={`Удалить команду ${index + 1}`} disabled={!editable} className="h-11 w-11 rounded-md text-[color:var(--kub-danger)] hover:bg-[var(--kub-surface-2)] disabled:opacity-40" onClick={() => setCommands(commands.filter((_, itemIndex) => itemIndex !== index))}><KubIcon name="delete" size={18} className="mx-auto" /></button>
                </div>
              ))}
              {commands.length === 0 && <KubEmptyState title="Команд пока нет" description="Добавьте первую команду для Bot API." className="py-5" />}
              <div className="flex flex-col gap-2 sm:flex-row">
                <KubButton variant="secondary" className="min-h-11" disabled={!editable || commands.length >= 100} onClick={() => setCommands([...commands, { command: "", description: "" }])}>Добавить команду</KubButton>
                <KubButton className="min-h-11" disabled={!editable || mutations.commands.isPending} onClick={() => run(() => mutations.commands.mutateAsync(commands))}>Сохранить команды</KubButton>
              </div>
            </div>
          </Section>

          <Section title="Webhook" description="Webhook и getUpdates взаимоисключающие. Секрет после сохранения не отображается.">
            <div className="grid gap-3">
              <KubInput label="URL webhook" type="url" value={webhook.url} disabled={!editable} onChange={(event) => setWebhook({ ...webhook, url: event.target.value })} placeholder="https://example.com/bot/webhook" />
              <KubInput label="Секрет подписи" type="password" value={webhook.secret} disabled={!editable} onChange={(event) => setWebhook({ ...webhook, secret: event.target.value })} autoComplete="new-password" />
              <label className="flex min-h-11 items-center gap-3 text-sm text-[color:var(--kub-text)]"><input type="checkbox" checked={webhook.drop} disabled={!editable} onChange={(event) => setWebhook({ ...webhook, drop: event.target.checked })} />Удалить ожидающие обновления</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <KubButton className="min-h-11" disabled={!editable || !webhook.url || !webhook.secret} onClick={saveWebhook}>Сохранить webhook</KubButton>
                {detail.webhook.configured && <KubButton variant="danger" className="min-h-11" disabled={!editable} onClick={() => run(async () => { await botManagement.deleteWebhook(bot.id, webhook.drop); await mutations.refresh(); })}>Удалить webhook</KubButton>}
              </div>
            </div>
          </Section>

          <Section title="Приватность в группах" description="Полный доступ запрашивается отдельно для каждого чата и подтверждается администратором группы.">
            <div className="space-y-2">
              {detail.privacy.map((item) => {
                const requested = Boolean(item.full_visibility_requested_at) && !item.full_visibility_approved;
                const label = item.privacy_mode === "full" && item.full_visibility_approved ? "Полный доступ одобрен" : requested ? "Запрошен полный доступ" : "Ограниченный";
                return <div key={item.chat_id} className="flex flex-col gap-2 border-b border-[color:var(--kub-border-color)] py-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="break-words text-sm font-medium text-[color:var(--kub-text)]">{item.chat_name}</div><div className="mt-1 text-xs text-[color:var(--kub-muted)]">{label}</div></div>{item.privacy_mode !== "full" && <KubButton variant="secondary" size="sm" className="min-h-11" disabled={!editable} onClick={() => run(async () => { await botManagement.setPrivacyRequest(bot.id, item.chat_id, !requested); await mutations.refresh(); })}>{requested ? "Отменить запрос" : "Запросить полный доступ"}</KubButton>}</div>;
              })}
              {detail.privacy.length === 0 && <KubEmptyState title="Бот не добавлен в группы" description="Настройки появятся после добавления в чат." className="py-5" />}
            </div>
          </Section>

          {owner && (
            <Section title="Токен" description="Префикс помогает отличить текущий токен, но не подходит для авторизации.">
              <div className="break-all font-mono text-sm text-[color:var(--kub-text)]">{bot.token?.prefix ?? "Активного токена нет"}</div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <KubButton className="min-h-11" disabled={!editable} onClick={() => setConfirm("rotate")} leftIcon={<KubIcon name="key" size={17} />}>Выпустить новый токен</KubButton>
                {bot.token && <KubButton variant="danger" className="min-h-11" disabled={!editable} onClick={() => setConfirm("revoke")}>Отозвать токен</KubButton>}
              </div>
            </Section>
          )}
        </TabsContent>

        <TabsContent value="team" className="m-0 space-y-5 p-4 sm:p-6">
          <Section title="Разработчики" description="Разработчики могут менять API-конфигурацию, но не профиль, токен или состояние бота.">
            {owner && editable && <div className="mb-4 flex flex-col gap-2 sm:flex-row"><KubInput aria-label="Имя пользователя разработчика" value={developerUsername} onChange={(event) => setDeveloperUsername(event.target.value)} placeholder="username" containerClassName="flex-1" /><KubButton className="min-h-11" disabled={!developerUsername || mutations.addDeveloper.isPending} onClick={() => run(async () => { await mutations.addDeveloper.mutateAsync(developerUsername); setDeveloperUsername(""); })}>Добавить разработчика</KubButton></div>}
            <div className="space-y-2">
              {detail.developers.map((developer) => <div key={developer.user_id} className="flex min-h-14 items-center gap-3 border-b border-[color:var(--kub-border-color)] py-2"><div className="min-w-0 flex-1"><div className="break-words text-sm font-medium text-[color:var(--kub-text)]">{developer.display_name}</div><div className="break-all text-xs text-[color:var(--kub-muted)]">{developer.username ? `@${developer.username}` : "Без имени пользователя"}</div></div>{owner && editable && <button aria-label={`Удалить разработчика ${developer.display_name}`} className="h-11 w-11 rounded-md text-[color:var(--kub-danger)] hover:bg-[var(--kub-surface-2)]" onClick={() => run(() => mutations.removeDeveloper.mutateAsync(developer.user_id))}><KubIcon name="userRemove" size={18} className="mx-auto" /></button>}</div>)}
              {detail.developers.length === 0 && <KubEmptyState title="Разработчиков пока нет" description="Владелец может добавить участника по имени пользователя." className="py-5" />}
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="diagnostics" className="m-0 p-4 sm:p-6">
          <Section title="Агрегированная диагностика" description={`Обновлено ${formatDate(detail.diagnostics.refreshed_at)}`}>
            <dl className="grid gap-px overflow-hidden rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-border-color)] sm:grid-cols-2">
              <Metric label="Режим доставки" value={detail.diagnostics.delivery_mode === null ? "Не настроен" : detail.diagnostics.delivery_mode === "webhook" ? "Webhook" : "getUpdates"} />
              <Metric label="Ожидают доставки" value={String(detail.diagnostics.pending_update_count)} />
              <Metric label="Ошибки webhook" value={String(detail.diagnostics.failure_count)} />
              <Metric label="Последняя ошибка" value={detail.diagnostics.last_error_code ?? "Нет"} />
            </dl>
          </Section>
        </TabsContent>
      </Tabs>

      <ConfirmDialog action={confirm} onClose={() => setConfirm(null)} onConfirm={() => {
        if (confirm === "pause") return run(() => mutations.pause.mutateAsync());
        if (confirm === "rotate") return rotate();
        if (confirm === "revoke") return run(() => mutations.revoke.mutateAsync());
        if (confirm === "delete") return run(() => mutations.requestDeletion.mutateAsync());
        return Promise.resolve();
      }} />
    </div>
  );
}

function BotMark({ name }: { name: string }) {
  return <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] text-[color:var(--kub-cyan)]"><KubIcon name="bot" size={23} label={`${name}, бот`} /></div>;
}

function LifecycleBadge({ state }: { state: BotDetail["bot"]["state"] }) {
  const tone = state === "active" ? "online" : state === "paused" ? "warn" : state === "suspended" || state === "pending_delete" ? "danger" : "muted";
  return <KubBadge tone={tone} dot className="text-[color:var(--kub-text)]">{STATE_COPY[state]}</KubBadge>;
}

function Notice({ children }: { children: string }) {
  return <div className="mx-4 mt-4 rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-sm text-[color:var(--kub-text)] sm:mx-6">{children}</div>;
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <section aria-labelledby={`bot-section-${title}`} className="rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-4"><h3 id={`bot-section-${title}`} className="text-sm font-semibold text-[color:var(--kub-text)]">{title}</h3>{description && <p className="mt-1 text-xs leading-5 text-[color:var(--kub-muted)]">{description}</p>}<div className="mt-4">{children}</div></section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 bg-[var(--kub-surface-2)] p-3"><dt className="text-xs text-[color:var(--kub-muted)]">{label}</dt><dd className="mt-1 break-all text-sm font-medium text-[color:var(--kub-text)]">{value}</dd></div>;
}

function ConfirmDialog({ action, onClose, onConfirm }: { action: ConfirmAction; onClose(): void; onConfirm(): Promise<unknown> }) {
  const copy = {
    pause: ["Поставить бота на паузу?", "API-операции и доставка обновлений остановятся.", "Подтвердить паузу"],
    rotate: ["Выпустить новый токен?", "Предыдущий токен перестанет работать. Новый будет показан один раз.", "Подтвердить выпуск"],
    revoke: ["Отозвать токен?", "Доступ к Bot API остановится до выпуска нового токена.", "Отозвать токен"],
    delete: ["Запросить удаление?", "Токен будет отозван сразу. Отменить удаление можно в течение семи дней.", "Запланировать удаление"],
  } as const;
  if (!action) return null;
  const [title, description, confirmLabel] = copy[action];
  return <AlertDialog.Root open onOpenChange={(open) => !open && onClose()}><AlertDialog.Portal><AlertDialog.Overlay className="fixed inset-0 z-[75] bg-black/70" /><AlertDialog.Content className="bots-management-surface fixed left-1/2 top-1/2 z-[76] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-5 shadow-2xl"><AlertDialog.Title className="text-lg font-semibold text-[color:var(--kub-text)]">{title}</AlertDialog.Title><AlertDialog.Description className="mt-2 text-sm leading-6 text-[color:var(--kub-muted)]">{description}</AlertDialog.Description><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><AlertDialog.Cancel asChild><KubButton variant="secondary" className="min-h-11">Отмена</KubButton></AlertDialog.Cancel><AlertDialog.Action asChild><KubButton variant={action === "pause" || action === "rotate" ? "primary" : "danger"} className="min-h-11" onClick={() => void onConfirm()}>{confirmLabel}</KubButton></AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
