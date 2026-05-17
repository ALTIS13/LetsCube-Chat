"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { KubButton, KubIcon, KubModal } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useCreateChat } from "@/hooks/useCreateChat";
import {
  type GlobalSearchDataType,
  type GlobalSearchResult,
  type GlobalSearchResultType,
  useGlobalSearch,
} from "@/hooks/useGlobalSearch";
import { useRoleAccess } from "@/hooks/useRole";
import { useTaskAccessGate } from "@/hooks/useTaskAccess";
import { showAppAlert } from "@/lib/appDialogs";
import { requestChatMessageJump } from "@/lib/chatJumpEvents";
import { KUB_GLOBAL_SEARCH_OPEN_EVENT, type GlobalSearchOpenDetail } from "@/lib/globalSearchEvents";
import { safeOpenChat } from "@/lib/safeOpenChat";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";
import type { Profile } from "@/types/database";

type SearchTypeFilter = GlobalSearchDataType | "command" | "all";

type PreviewProfile = Pick<Profile, "id" | "full_name" | "username" | "avatar_url" | "role" | "bio" | "online_at">;

const FILTERS: { id: SearchTypeFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "user", label: "Люди" },
  { id: "chat", label: "Чаты" },
  { id: "message", label: "Сообщения" },
  { id: "task", label: "Задачи" },
  { id: "location", label: "Локации" },
  { id: "command", label: "Команды" },
];

const SECTION_LABELS: Record<GlobalSearchResultType, string> = {
  user: "Люди",
  chat: "Чаты",
  message: "Сообщения",
  task: "Задачи",
  location: "Локации",
  command: "Команды",
};

export function GlobalSearchPalette() {
  const [, setLocation] = useLocation();
  const currentUser = useAppStore((s) => s.currentUser);
  const setMobileSection = useAppStore((s) => s.setMobileSection);
  const { openPrivateChat, loading: openingChat } = useCreateChat();
  const [open, setOpen] = useState(false);
  const { canAccessTasks } = useTaskAccessGate({ enabled: open });
  const { isStaff } = useRoleAccess();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<SearchTypeFilter>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewProfile, setPreviewProfile] = useState<PreviewProfile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseTypeSyntax(query, typeFilter), [query, typeFilter]);
  const dataType = parsed.type === "command" ? "all" : parsed.type;
  const search = useGlobalSearch({
    query: parsed.query,
    type: dataType,
    enabled: open && parsed.type !== "command",
    limit: 24,
  });

  const commandResults = useMemo(
    () => buildCommandResults({
      query: parsed.query,
      type: parsed.type,
      canAccessTasks,
      isStaff,
    }),
    [canAccessTasks, isStaff, parsed.query, parsed.type],
  );

  const results = useMemo(() => {
    const items =
      parsed.type === "command"
        ? commandResults
        : parsed.type === "all"
          ? [...commandResults, ...search.results]
          : search.results;
    return items.slice(0, 32);
  }, [commandResults, parsed.type, search.results]);

  const grouped = useMemo(() => groupResults(results), [results]);

  const closePalette = useCallback(() => {
    setOpen(false);
    setPreviewProfile(null);
    setActiveIndex(0);
  }, []);

  const openPalette = useCallback((initialQuery = "") => {
    setOpen(true);
    setPreviewProfile(null);
    if (initialQuery) setQuery(initialQuery);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<GlobalSearchOpenDetail>).detail;
      openPalette(detail?.query ?? "");
    };
    window.addEventListener(KUB_GLOBAL_SEARCH_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(KUB_GLOBAL_SEARCH_OPEN_EVENT, handleOpen);
  }, [openPalette]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openPalette]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [parsed.query, parsed.type, results.length]);

  const activateResult = useCallback(
    async (result: GlobalSearchResult) => {
      if (result.resultType === "command") {
        runCommand(result.id, { setLocation, setMobileSection, closePalette });
        return;
      }

      if (result.resultType === "user") {
        setPreviewProfile(
          result.profile ?? {
            id: result.id,
            full_name: result.title,
            username: normalizeUsernameSubtitle(result.subtitle),
            avatar_url: result.avatarUrl ?? null,
            role: "user",
            bio: result.snippet ?? null,
            online_at: null,
          },
        );
        return;
      }

      if (result.resultType === "chat" && result.chatId) {
        const opened = await safeOpenChat(result.chatId, {
          unavailableMessage: "Чат недоступен или был удалён.",
          unavailableTitle: "Чат недоступен",
        });
        if (opened) {
          setLocation("/");
          closePalette();
        }
        return;
      }

      if (result.resultType === "message" && result.chatId && result.messageId) {
        const opened = await safeOpenChat(result.chatId, {
          unavailableMessage: "Сообщение недоступно или чат был удалён.",
          unavailableTitle: "Сообщение недоступно",
        });
        if (opened) {
          setLocation("/");
          closePalette();
          window.setTimeout(() => requestChatMessageJump(result.chatId!, result.messageId!), 250);
          window.setTimeout(() => requestChatMessageJump(result.chatId!, result.messageId!), 700);
        }
        return;
      }

      if (result.resultType === "task" && result.taskId) {
        setLocation(`/tasks?task=${encodeURIComponent(result.taskId)}`);
        closePalette();
        return;
      }

      if (result.resultType === "location") {
        if (isStaff) {
          setLocation("/admin/locations");
          closePalette();
        } else {
          showAppAlert("Локация недоступна для вашего профиля.", "Нет доступа");
        }
      }
    },
    [closePalette, isStaff, setLocation, setMobileSection],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (results.length === 0 ? 0 : (index + 1) % results.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (results.length === 0 ? 0 : (index - 1 + results.length) % results.length));
      return;
    }
    if (event.key === "Enter") {
      const result = results[activeIndex];
      if (result) {
        event.preventDefault();
        void activateResult(result);
      }
    }
  };

  const showHint = parsed.query.length === 0;
  const showEmpty = !showHint && !search.loading && results.length === 0;

  if (!currentUser) return null;

  return (
    <KubModal
      open={open}
      onClose={closePalette}
      title="Глобальный поиск"
      description="Ctrl+K / Cmd+K"
      icon={<KubIcon name="search" size={18} />}
      size="lg"
      className="sm:max-w-3xl"
      contentClassName="p-0 overflow-hidden"
      mobileSheet
    >
      <div className="relative flex h-full min-h-0 flex-col" data-testid="global-search-palette">
        <div className="border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-4 py-3">
          <div className="flex h-11 items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 focus-within:border-[color:var(--kub-cyan)]">
            <KubIcon name="search" size={17} className="shrink-0 text-[color:var(--kub-muted)]" />
            <input
              ref={inputRef}
              data-testid="global-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Поиск по людям, чатам, сообщениям, задачам…"
              className="min-w-0 flex-1 bg-transparent text-sm text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]"
              aria-label="Глобальный поиск"
            />
            {search.loading && <KubIcon name="spinner" size={15} tone="accent" />}
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="rounded-lg p-1 text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface)] hover:text-[color:var(--kub-text)]"
                aria-label="Очистить поиск"
              >
                <KubIcon name="close" size={14} />
              </button>
            )}
          </div>

          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
            {FILTERS.map((filter) => {
              const active = parsed.type === filter.id || (!query.match(/\btype:/i) && typeFilter === filter.id);
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setTypeFilter(filter.id)}
                  className={cn(
                    "h-8 shrink-0 rounded-lg px-3 text-xs font-semibold transition-colors",
                    active
                      ? "bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)] text-[color:var(--kub-cyan)]"
                      : "bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]",
                  )}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          {search.migrationMissing && parsed.type !== "command" && (
            <div className="mt-3 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
              Поиск по всей истории требует обновления базы данных. Сейчас доступны видимые чаты, загруженные сообщения, пользователи, задачи и локации по RLS.
            </div>
          )}
          {search.error && (
            <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--kub-warn)_35%,transparent)] bg-[color-mix(in_srgb,var(--kub-warn)_10%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-warn)]">
              {search.error}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-3">
          {showHint && (
            <div className="space-y-3 px-2 py-3">
              <div className="rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] p-4">
                <div className="text-sm font-semibold text-[color:var(--kub-text)]">Быстрый поиск</div>
                <div className="mt-1 text-xs leading-relaxed text-[color:var(--kub-muted)]">
                  Начните вводить имя, @username, чат, сообщение, задачу или локацию. Для фильтра можно набрать `type:user`, `type:message` или выбрать чип сверху.
                </div>
              </div>
              <ResultSection
                title="Команды"
                results={commandResults}
                activeIndex={activeIndex}
                startIndex={0}
                onHover={setActiveIndex}
                onOpen={activateResult}
              />
            </div>
          )}

          {showEmpty && (
            <div className="flex min-h-[220px] flex-col items-center justify-center px-6 text-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)]">
                <KubIcon name="search" size={22} />
              </span>
              <div className="text-sm font-semibold text-[color:var(--kub-text)]">Ничего не найдено</div>
              <div className="mt-1 max-w-sm text-xs leading-relaxed text-[color:var(--kub-muted)]">
                Попробуйте имя, @username, название чата, фразу из сообщения или фильтр по типу.
              </div>
            </div>
          )}

          {!showHint && !showEmpty && (
            <div className="space-y-3">
              {grouped.map((section) => (
                <ResultSection
                  key={section.type}
                  title={SECTION_LABELS[section.type]}
                  results={section.results}
                  activeIndex={activeIndex}
                  startIndex={section.startIndex}
                  onHover={setActiveIndex}
                  onOpen={activateResult}
                />
              ))}
            </div>
          )}
        </div>

        {previewProfile && (
          <ProfilePreview
            profile={previewProfile}
            currentUserId={currentUser.id}
            opening={openingChat}
            onBack={() => setPreviewProfile(null)}
            onOpenChat={async () => {
              if (previewProfile.id === currentUser.id) return;
              const chatId = await openPrivateChat(previewProfile.id);
              if (!chatId) {
                showAppAlert("Не удалось открыть личный чат.", "Чат недоступен");
                return;
              }
              setLocation("/");
              closePalette();
            }}
          />
        )}
      </div>
    </KubModal>
  );
}

function ResultSection({
  title,
  results,
  activeIndex,
  startIndex,
  onHover,
  onOpen,
}: {
  title: string;
  results: GlobalSearchResult[];
  activeIndex: number;
  startIndex: number;
  onHover: (index: number) => void;
  onOpen: (result: GlobalSearchResult) => void | Promise<void>;
}) {
  if (results.length === 0) return null;
  return (
    <section>
      <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--kub-muted)]">
        {title}
      </div>
      <div className="space-y-1">
        {results.map((result, offset) => {
          const index = startIndex + offset;
          const active = activeIndex === index;
          return (
            <button
              key={`${result.resultType}:${result.id}`}
              type="button"
              data-testid={`global-search-result-${result.resultType}`}
              data-search-result-type={result.resultType}
              onMouseEnter={() => onHover(index)}
              onClick={() => void onOpen(result)}
              className={cn(
                "flex w-full min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors",
                active
                  ? "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,var(--kub-surface-2))]"
                  : "hover:bg-[var(--kub-surface-2)]",
              )}
            >
              <ResultIcon result={result} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-[color:var(--kub-text)]">{result.title}</div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-[color:var(--kub-muted)]">
                  {result.subtitle && <span className="truncate">{result.subtitle}</span>}
                  {result.snippet && (
                    <>
                      {result.subtitle && <span className="shrink-0">·</span>}
                      <span className="truncate">{cleanSnippet(result.snippet)}</span>
                    </>
                  )}
                </div>
              </div>
              <KubIcon name="chevronRight" size={15} className="shrink-0 text-[color:var(--kub-muted)]" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ResultIcon({ result }: { result: GlobalSearchResult }) {
  if (result.resultType === "user" && result.profile) {
    return <UserAvatar user={result.profile} size="sm" />;
  }
  if (result.avatarUrl) {
    return (
      <img
        src={result.avatarUrl}
        alt=""
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }
  const iconName =
    result.resultType === "chat"
      ? "chatBubble"
      : result.resultType === "message"
        ? "chatRect"
        : result.resultType === "task"
          ? "tasks"
          : result.resultType === "location"
            ? "mapPin"
            : result.resultType === "command"
              ? "zap"
              : "user";
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--kub-surface-2)] text-[color:var(--kub-cyan)]">
      <KubIcon name={iconName} size={16} />
    </span>
  );
}

function ProfilePreview({
  profile,
  currentUserId,
  opening,
  onBack,
  onOpenChat,
}: {
  profile: PreviewProfile;
  currentUserId: string;
  opening: boolean;
  onBack: () => void;
  onOpenChat: () => void | Promise<void>;
}) {
  const username = profile.username ? `@${profile.username}` : "Без username";
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-[var(--kub-surface)]">
      <div className="flex items-center gap-2 border-b border-[color:var(--kub-border-color)] px-4 py-3">
        <button
          type="button"
          data-testid="global-search-profile-back"
          onClick={onBack}
          className="rounded-lg p-2 text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-2)] hover:text-[color:var(--kub-text)]"
          aria-label="Назад к результатам"
        >
          <KubIcon name="back" size={17} />
        </button>
        <div className="min-w-0 text-sm font-semibold text-[color:var(--kub-text)]">Мини-профиль</div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-5 py-6 text-center">
        <UserAvatar user={profile} size="xl" />
        <div className="mt-4 max-w-full truncate text-xl font-bold text-[color:var(--kub-text)]">
          {profile.full_name?.trim() || username}
        </div>
        <div className="mt-1 text-sm text-[color:var(--kub-muted)]">{username}</div>
        {profile.bio && (
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-[color:var(--kub-muted)]">{profile.bio}</p>
        )}
        <div className="mt-6 flex w-full max-w-xs flex-col gap-2 sm:flex-row sm:justify-center">
          <KubButton
            variant="primary"
            fullWidth
            disabled={profile.id === currentUserId}
            loading={opening}
            leftIcon={<KubIcon name="chatBubble" size={14} />}
            onClick={() => void onOpenChat()}
          >
            Открыть чат
          </KubButton>
          {profile.username && (
            <KubButton
              variant="secondary"
              fullWidth
              leftIcon={<KubIcon name="copy" size={14} />}
              onClick={() => void navigator.clipboard?.writeText(`@${profile.username}`)}
            >
              Скопировать
            </KubButton>
          )}
        </div>
      </div>
    </div>
  );
}

function parseTypeSyntax(query: string, selected: SearchTypeFilter): { query: string; type: SearchTypeFilter } {
  const match = query.match(/(?:^|\s)type:(user|chat|message|task|location|command)\b/i);
  if (!match) return { query, type: selected };
  return {
    query: query.replace(match[0], " ").trim(),
    type: match[1].toLowerCase() as SearchTypeFilter,
  };
}

function buildCommandResults({
  query,
  type,
  canAccessTasks,
  isStaff,
}: {
  query: string;
  type: SearchTypeFilter;
  canAccessTasks: boolean;
  isStaff: boolean;
}): GlobalSearchResult[] {
  if (type !== "all" && type !== "command") return [];
  const needle = query.trim().toLocaleLowerCase("ru-RU");
  const commands: GlobalSearchResult[] = [
    {
      resultType: "command",
      id: "open-chats",
      title: "Открыть чаты",
      subtitle: "Перейти к мессенджеру",
      source: "command",
      rank: 100,
    },
    {
      resultType: "command",
      id: "focus-chat-search",
      title: "Поиск в списке чатов",
      subtitle: "Локальный поиск по чатам",
      source: "command",
      rank: 90,
    },
  ];

  if (canAccessTasks) {
    commands.push({
      resultType: "command",
      id: "open-tasks",
      title: "Открыть задачи",
      subtitle: "Задачи клуба",
      source: "command",
      rank: 90,
    });
  }

  if (isStaff) {
    commands.push({
      resultType: "command",
      id: "open-admin",
      title: "Открыть админ-панель",
      subtitle: "Пользователи, роли, локации",
      source: "command",
      rank: 80,
    });
  }

  if (!needle) return commands;
  return commands.filter((command) => `${command.title} ${command.subtitle ?? ""}`.toLocaleLowerCase("ru-RU").includes(needle));
}

function runCommand(
  commandId: string,
  helpers: {
    setLocation: (to: string) => void;
    setMobileSection: (section: "chats" | "search" | "folders" | "profile") => void;
    closePalette: () => void;
  },
) {
  switch (commandId) {
    case "open-tasks":
      helpers.setLocation("/tasks");
      break;
    case "open-admin":
      helpers.setLocation("/admin");
      break;
    case "focus-chat-search":
      helpers.setLocation("/");
      helpers.setMobileSection("search");
      break;
    case "open-chats":
    default:
      helpers.setLocation("/");
      helpers.setMobileSection("chats");
      break;
  }
  helpers.closePalette();
}

function groupResults(results: GlobalSearchResult[]): { type: GlobalSearchResultType; results: GlobalSearchResult[]; startIndex: number }[] {
  const groups: { type: GlobalSearchResultType; results: GlobalSearchResult[]; startIndex: number }[] = [];
  let cursor = 0;
  const order: GlobalSearchResultType[] = ["command", "user", "chat", "message", "task", "location"];
  for (const type of order) {
    const items = results.filter((result) => result.resultType === type);
    if (items.length === 0) continue;
    groups.push({ type, results: items, startIndex: cursor });
    cursor += items.length;
  }
  return groups;
}

function cleanSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeUsernameSubtitle(value: string | null | undefined): string | null {
  const clean = value?.trim();
  if (!clean) return null;
  return clean.replace(/^@+/, "") || null;
}
