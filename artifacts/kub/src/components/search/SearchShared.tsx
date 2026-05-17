"use client";

import { useCallback, useState } from "react";
import { useLocation } from "wouter";
import { KubButton, KubIcon } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useCreateChat } from "@/hooks/useCreateChat";
import type { GlobalSearchDataType, GlobalSearchResult, GlobalSearchResultType } from "@/hooks/useGlobalSearch";
import { useRoleAccess } from "@/hooks/useRole";
import { showAppAlert } from "@/lib/appDialogs";
import { requestChatMessageJump } from "@/lib/chatJumpEvents";
import { safeOpenChat } from "@/lib/safeOpenChat";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";
import type { Profile } from "@/types/database";

export type SearchTypeFilter = GlobalSearchDataType | "command" | "all";
export type PreviewProfile = Pick<Profile, "id" | "full_name" | "username" | "avatar_url" | "role" | "bio" | "online_at">;

export const SEARCH_FILTERS: { id: SearchTypeFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "user", label: "Люди" },
  { id: "chat", label: "Чаты" },
  { id: "message", label: "Сообщения" },
  { id: "task", label: "Задачи" },
  { id: "location", label: "Локации" },
  { id: "command", label: "Команды" },
];

export const SEARCH_SECTION_LABELS: Record<GlobalSearchResultType, string> = {
  user: "Люди",
  chat: "Чаты",
  message: "Сообщения",
  task: "Задачи",
  location: "Локации",
  command: "Команды",
};

export function SearchResultsList({
  sections,
  activeIndex = -1,
  onHover,
  onOpen,
  compact = false,
  testIdPrefix = "global-search-result",
}: {
  sections: { type: GlobalSearchResultType; results: GlobalSearchResult[]; startIndex: number }[];
  activeIndex?: number;
  onHover?: (index: number) => void;
  onOpen: (result: GlobalSearchResult) => void | Promise<void>;
  compact?: boolean;
  testIdPrefix?: string;
}) {
  if (sections.length === 0) return null;
  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {sections.map((section) => (
        <SearchSection
          key={section.type}
          title={SEARCH_SECTION_LABELS[section.type]}
          results={section.results}
          activeIndex={activeIndex}
          startIndex={section.startIndex}
          onHover={onHover}
          onOpen={onOpen}
          compact={compact}
          testIdPrefix={testIdPrefix}
        />
      ))}
    </div>
  );
}

export function SearchSection({
  title,
  results,
  activeIndex,
  startIndex,
  onHover,
  onOpen,
  compact = false,
  testIdPrefix = "global-search-result",
}: {
  title: string;
  results: GlobalSearchResult[];
  activeIndex: number;
  startIndex: number;
  onHover?: (index: number) => void;
  onOpen: (result: GlobalSearchResult) => void | Promise<void>;
  compact?: boolean;
  testIdPrefix?: string;
}) {
  if (results.length === 0) return null;
  return (
    <section>
      <div className={cn(
        "px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--kub-muted)]",
        compact && "px-1.5 text-[10px]",
      )}>
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
              data-testid={`${testIdPrefix}-${result.resultType}`}
              data-search-result-type={result.resultType}
              onMouseEnter={() => onHover?.(index)}
              onClick={() => void onOpen(result)}
              className={cn(
                "flex w-full min-w-0 items-center gap-3 rounded-2xl text-left transition-colors",
                compact ? "px-2.5 py-2" : "px-3 py-2.5",
                active
                  ? "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,var(--kub-surface-2))]"
                  : "hover:bg-[var(--kub-surface-2)]",
              )}
            >
              <SearchResultIcon result={result} compact={compact} />
              <div className="min-w-0 flex-1">
                <div className={cn("truncate font-semibold text-[color:var(--kub-text)]", compact ? "text-[13px]" : "text-sm")}>
                  {result.title}
                </div>
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
              <KubIcon name="chevronRight" size={compact ? 13 : 15} className="shrink-0 text-[color:var(--kub-muted)]" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function SearchEmptyState({
  title = "Ничего не найдено",
  description = "Попробуйте имя, @username, название чата, фразу из сообщения или фильтр по типу.",
  compact = false,
}: {
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 text-center", compact ? "min-h-[180px]" : "min-h-[220px]")}>
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)]">
        <KubIcon name="search" size={22} />
      </span>
      <div className="text-sm font-semibold text-[color:var(--kub-text)]">{title}</div>
      <div className="mt-1 max-w-sm text-xs leading-relaxed text-[color:var(--kub-muted)]">{description}</div>
    </div>
  );
}

export function SearchProfilePreview({
  profile,
  currentUserId,
  opening,
  onBack,
  onOpenChat,
  compact = false,
}: {
  profile: PreviewProfile;
  currentUserId: string;
  opening: boolean;
  onBack: () => void;
  onOpenChat: () => void | Promise<void>;
  compact?: boolean;
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
      <div className={cn("flex flex-1 flex-col items-center justify-center px-5 py-6 text-center", compact && "justify-start pt-8")}>
        <UserAvatar user={profile} size={compact ? "lg" : "xl"} />
        <div className={cn("mt-4 max-w-full truncate font-bold text-[color:var(--kub-text)]", compact ? "text-lg" : "text-xl")}>
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

function SearchResultIcon({ result, compact = false }: { result: GlobalSearchResult; compact?: boolean }) {
  if (result.resultType === "user" && result.profile) {
    return <UserAvatar user={result.profile} size="sm" />;
  }
  if (result.avatarUrl) {
    return (
      <img
        src={result.avatarUrl}
        alt=""
        className={cn("shrink-0 rounded-full object-cover", compact ? "h-8 w-8" : "h-8 w-8")}
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

export function useSearchResultActions({ onAfterOpen }: { onAfterOpen?: () => void }) {
  const [, setLocation] = useLocation();
  const currentUser = useAppStore((s) => s.currentUser);
  const setMobileSection = useAppStore((s) => s.setMobileSection);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const { isStaff } = useRoleAccess();
  const { openPrivateChat, loading: openingChat } = useCreateChat();
  const [previewProfile, setPreviewProfile] = useState<PreviewProfile | null>(null);

  const closeAfterOpen = useCallback(() => {
    onAfterOpen?.();
  }, [onAfterOpen]);

  const activateResult = useCallback(
    async (result: GlobalSearchResult) => {
      if (result.resultType === "command") {
        runSearchCommand(result.id, { setLocation, setMobileSection, setSearchQuery, closeAfterOpen });
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
          closeAfterOpen();
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
          closeAfterOpen();
          window.setTimeout(() => requestChatMessageJump(result.chatId!, result.messageId!), 250);
          window.setTimeout(() => requestChatMessageJump(result.chatId!, result.messageId!), 700);
        }
        return;
      }

      if (result.resultType === "task" && result.taskId) {
        setLocation(`/tasks?task=${encodeURIComponent(result.taskId)}`);
        closeAfterOpen();
        return;
      }

      if (result.resultType === "location") {
        if (isStaff) {
          setLocation("/admin/locations");
          closeAfterOpen();
        } else {
          showAppAlert("Локация недоступна для вашего профиля.", "Нет доступа");
        }
      }
    },
    [closeAfterOpen, isStaff, setLocation, setMobileSection, setSearchQuery],
  );

  const openPreviewChat = useCallback(async () => {
    if (!previewProfile || !currentUser || previewProfile.id === currentUser.id) return;
    const chatId = await openPrivateChat(previewProfile.id);
    if (!chatId) {
      showAppAlert("Не удалось открыть личный чат.", "Чат недоступен");
      return;
    }
    setLocation("/");
    closeAfterOpen();
  }, [closeAfterOpen, currentUser, openPrivateChat, previewProfile, setLocation]);

  return {
    activateResult,
    currentUser,
    openingChat,
    previewProfile,
    setPreviewProfile,
    openPreviewChat,
  };
}

export function buildCommandResults({
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
      subtitle: "Поиск по чатам, людям, сообщениям и задачам",
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

export function parseSearchTypeSyntax(query: string, selected: SearchTypeFilter): { query: string; type: SearchTypeFilter } {
  const match = query.match(/(?:^|\s)type:(user|chat|message|task|location|command)\b/i);
  if (!match) return { query, type: selected };
  return {
    query: query.replace(match[0], " ").trim(),
    type: match[1].toLowerCase() as SearchTypeFilter,
  };
}

export function groupSearchResults(results: GlobalSearchResult[]): { type: GlobalSearchResultType; results: GlobalSearchResult[]; startIndex: number }[] {
  const groups: { type: GlobalSearchResultType; results: GlobalSearchResult[]; startIndex: number }[] = [];
  let cursor = 0;
  const order: GlobalSearchResultType[] = ["chat", "user", "message", "task", "location", "command"];
  for (const type of order) {
    const items = results.filter((result) => result.resultType === type);
    if (items.length === 0) continue;
    groups.push({ type, results: items, startIndex: cursor });
    cursor += items.length;
  }
  return groups;
}

export function mergeSearchResults(primary: GlobalSearchResult[], secondary: GlobalSearchResult[], limit: number): GlobalSearchResult[] {
  const seen = new Set<string>();
  const merged: GlobalSearchResult[] = [];
  for (const result of [...primary, ...secondary]) {
    const key = `${result.resultType}:${result.resultType === "chat" ? result.chatId ?? result.id : result.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(result);
    if (merged.length >= limit) break;
  }
  return merged;
}

function runSearchCommand(
  commandId: string,
  helpers: {
    setLocation: (to: string) => void;
    setMobileSection: (section: "chats" | "search" | "folders" | "profile") => void;
    setSearchQuery: (query: string) => void;
    closeAfterOpen: () => void;
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
      helpers.setSearchQuery("");
      helpers.setMobileSection("search");
      break;
    case "open-chats":
    default:
      helpers.setLocation("/");
      helpers.setMobileSection("chats");
      break;
  }
  helpers.closeAfterOpen();
}

function cleanSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeUsernameSubtitle(value: string | null | undefined): string | null {
  const clean = value?.trim();
  if (!clean) return null;
  return clean.replace(/^@+/, "") || null;
}
