"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { usePermissionAccess } from "@/hooks/useRole";
import { KubButton, KubIcon, KubModal } from "@/components/kub";
import { BotLikeAvatar } from "@/components/bots/BotAvatar";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { cn } from "@/lib/utils";
import { adminUserQuery, adminUserSearchFilters } from "@/lib/adminUserSearch";
import { chatInviteAdmission, readInvitePolicy, type ChatMemberRole } from "@/lib/chatInviteAccess";
import {
  INVITE_KNOWN_HEADING,
  INVITE_OTHERS_HEADING,
  inviteCandidateButtonLabel,
  inviteDenialText,
  invitePolicyUnreadNote,
  inviteSearchEmptyText,
} from "@/lib/groupInviteCopy";
import {
  canInviteCandidate,
  inviteCandidateName,
  inviteCandidateState,
  matchesInviteSearch,
  orderInviteCandidates,
  peopleAlreadyInYourChats,
} from "@/lib/inviteCandidates";
import { addChatBot, fetchAvailableChatBots } from "@/lib/chatBotMembership";
import {
  BOT_ADD_FAILED,
  BOT_ADD_LABEL,
  BOT_ADDED_LABEL,
  BOT_ADDING_LABEL,
  BOT_SECTION_HEADING,
  BOT_VISIBILITY_NOTE,
  botAddedMessage,
  botDisplayName,
  botMembershipFailureMessage,
  botSecondaryLine,
  type BotLike,
} from "@/lib/chatBots";
import { createGroupInvite, formatGroupInviteError, GROUP_INVITES_MIGRATION_REQUIRED, isGroupInviteUnavailableError } from "@/lib/groupInvites";
import type { GroupInviteStatus } from "@/lib/groupInvites";
import type { GroupInvite, Profile } from "@/types/database";

/**
 * D-170: reaching somebody you cannot spell. D-165: not hiding the action in
 * silence.
 *
 * This screen used to open as a blank box behind «Введите минимум 2 символа для
 * поиска пользователя.» and a list of nothing. That is the dead end the owner
 * reported on 2026-09-15 from the other surface — «я сейчас не могу создать
 * группу как тех админ» — and `NewGroupModal` was fixed for it while this one,
 * the screen you use once the group exists, was not. It opens with people now.
 *
 * The order is the mechanic, not the search box: people you already share a
 * chat with come first, taken from the chat list the store already holds. The
 * one route that would reach a stranger — `search_profiles_by_phone` — refuses
 * every caller without `users.view`, so nothing here offers or implies it.
 *
 * Who may invite comes from `lib/chatInviteAccess.ts`, a measured copy of
 * `group_invite_create`'s four-branch gate, so an administrator the server
 * would admit is no longer refused by the interface, and a policy the client
 * could not read no longer removes the action without a word.
 */

interface GroupInviteModalProps {
  chatId: string;
  chatName: string;
  currentUserId: string | null;
  memberIds: string[];
  onClose: () => void;
  /**
   * A bot joined, so whatever lists this group's bots should look again.
   *
   * Nothing about bots streams — no bot table is in the `supabase_realtime`
   * publication — so the panel behind this modal would otherwise show the bot
   * only when it was next opened.
   */
  onBotAdded?: () => void;
}

const INVITE_PERMISSION_KEYS = ["chats.invite", "chats.invite_any", "system.manage"] as const;

/** What the chat's own row says, once it has been read. */
interface ChatFacts {
  type: string | null;
  /** `null` when the column could not be read, which is not the same as a value. */
  invitePolicy: ReturnType<typeof readInvitePolicy>;
  myRole: ChatMemberRole | null;
  /** Whether the read itself failed, as opposed to answering nothing. */
  failed: boolean;
}

export function GroupInviteModal({
  chatId,
  chatName,
  currentUserId,
  memberIds,
  onClose,
  onBotAdded,
}: GroupInviteModalProps) {
  const supabase = useMemo(() => createClient(), []);
  const chats = useAppStore((s) => s.chats);
  const memberIdSet = useMemo(() => new Set(memberIds), [memberIds]);
  const [query, setQuery] = useState("");
  const [fetched, setFetched] = useState<Profile[]>([]);
  const [inviteStatuses, setInviteStatuses] = useState<Record<string, GroupInviteStatus>>({});
  const [sentInviteeIds, setSentInviteeIds] = useState<Set<string>>(new Set());
  const [loadingResults, setLoadingResults] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [chatFacts, setChatFacts] = useState<ChatFacts | null>(null);
  const [bots, setBots] = useState<readonly BotLike[]>([]);
  const [addingBotId, setAddingBotId] = useState<string | null>(null);
  const [addedBotIds, setAddedBotIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const permissions = usePermissionAccess(INVITE_PERMISSION_KEYS);

  /**
   * The chat's type, its invite policy and my role in it, in one request.
   *
   * `select("*")` on the embedded chat rather than naming `invite_policy`: a
   * client whose schema cache predates the column must get the row without it
   * instead of a PGRST204 on the whole read, and `readInvitePolicy` then
   * answers `null` — «not read» — which is exactly the state this screen now
   * has words for.
   */
  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    supabase
      .from("chat_members")
      .select("role, chat:chats(*)")
      .eq("chat_id", chatId)
      .eq("user_id", currentUserId)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          // A refused read is not an answer. Offering the action and letting
          // `group_invite_create` judge it is honest; refusing on the strength
          // of a read that never happened is the D-140 mistake again.
          setChatFacts({ type: null, invitePolicy: null, myRole: null, failed: true });
          return;
        }
        const row = data as { role?: string | null; chat?: Record<string, unknown> | null } | null;
        setChatFacts({
          type: typeof row?.chat?.type === "string" ? row.chat.type : null,
          invitePolicy: readInvitePolicy(row?.chat?.invite_policy),
          myRole: readChatRole(row?.role),
          failed: false,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, currentUserId, supabase]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("group_invites")
      .select("invitee_id,status")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          if (isGroupInviteUnavailableError(err)) {
            setMigrationRequired(true);
            setMessage(GROUP_INVITES_MIGRATION_REQUIRED);
            return;
          }
          setError(formatGroupInviteError(err, "Не удалось загрузить приглашения."));
          return;
        }
        const next: Record<string, GroupInviteStatus> = {};
        for (const row of (data ?? []) as Pick<GroupInvite, "invitee_id" | "status">[]) {
          if (!next[row.invitee_id]) next[row.invitee_id] = row.status;
        }
        setInviteStatuses(next);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, supabase]);

  /**
   * A page of people, filtered by what was typed or unfiltered when nothing is.
   *
   * No minimum length. The two-character gate is what made this screen open
   * empty, and `Profiles are viewable by everyone` is the live read policy, so
   * there is nothing to protect by waiting. The filter itself comes from
   * `lib/adminUserSearch.ts`: it strips a leading «@» — usernames are stored
   * without one, so «@olga» matched nobody — and removes only the characters
   * PostgREST would read as grammar. This screen used to strip «_» as well,
   * and Postgres confirms what that costs: 'ivan_petrov' ILIKE '%ivan petrov%'
   * is false, so 4 of the 11 usernames on this deployment could not be found
   * by typing them out in full.
   */
  useEffect(() => {
    let cancelled = false;
    const parsed = adminUserQuery(query);
    const filters = adminUserSearchFilters(parsed);
    setLoadingResults(true);
    const timer = window.setTimeout(async () => {
      let request = supabase.from("profiles").select("*");
      if (currentUserId) request = request.neq("id", currentUserId);
      if (filters.length > 0) request = request.or(filters.join(","));
      const { data, error: searchError } = await request.limit(20);
      if (cancelled) return;
      setLoadingResults(false);
      if (searchError) {
        setError("Не удалось найти пользователей.");
        setFetched([]);
        return;
      }
      setError(null);
      setFetched((data as Profile[] | null) ?? []);
    }, parsed.term || parsed.id ? 260 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, currentUserId, supabase]);

  /**
   * The bots this group could take (D-235).
   *
   * `chat_bots_available` decides who may see this, not the interface:
   * it answers **nothing at all** — not an error — for anybody who is not an
   * administrator of a group, so an ordinary member is offered no bots and
   * never learns that any exist. A role test here would be a second copy of a
   * rule the server already enforces, and the second copy is the one that
   * drifts.
   *
   * A deployment that has not taken the migration has no function to call; that
   * answers `unavailable` and this screen simply has no bot section, rather
   * than an error about a feature nobody asked for.
   */
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await fetchAvailableChatBots(chatId, query);
      if (cancelled) return;
      if (result.unavailable || result.error) {
        setBots([]);
        return;
      }
      setBots(result.bots);
    }, query.trim() ? 260 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [chatId, query]);

  /** Everybody the chat list already knows about, with their profiles. */
  const knownPeople = useMemo(() => {
    const ids = peopleAlreadyInYourChats(chats, currentUserId);
    const byId = new Map<string, Profile>();
    for (const chat of chats) {
      for (const member of chat.members ?? []) {
        const profile = member.profile;
        if (profile?.id && ids.has(profile.id)) byId.set(profile.id, profile);
      }
      const other = chat.other_user;
      if (other?.id && ids.has(other.id)) byId.set(other.id, other);
    }
    return { ids, people: Array.from(byId.values()) };
  }, [chats, currentUserId]);

  const parsedQuery = useMemo(() => adminUserQuery(query), [query]);
  const searching = Boolean(parsedQuery.term || parsedQuery.id);

  const ordered = useMemo(() => {
    const known = knownPeople.people.filter((person) => matchesInviteSearch(person, query));
    return orderInviteCandidates({
      people: [...known, ...fetched],
      knownIds: knownPeople.ids,
      memberIds: memberIdSet,
      myId: currentUserId,
      searching,
    });
  }, [knownPeople, fetched, memberIdSet, currentUserId, searching, query]);

  const admission = useMemo(() => {
    // Until the chat's row and the permission snapshot are in, nothing is
    // claimed: the list stays usable and the server remains the judge.
    if (!chatFacts || chatFacts.failed || permissions.checking) return null;
    return chatInviteAdmission({
      chatType: chatFacts.type,
      chatRole: chatFacts.myRole,
      invitePolicy: chatFacts.invitePolicy,
      hasInvite: permissions.hasPermission("chats.invite"),
      hasInviteAny: permissions.hasPermission("chats.invite_any"),
      hasSystemManage: permissions.hasPermission("system.manage"),
    });
  }, [chatFacts, permissions]);

  const denied = admission?.denial ?? null;
  // Only when the unread policy is the thing that would have decided it. An
  // owner may invite whatever the policy says, so telling them it could not be
  // read is a sentence about our plumbing rather than about them.
  const policyUnreadNote = admission?.canInvite && admission.grantedBy === null
    ? invitePolicyUnreadNote(chatFacts?.type)
    : null;

  const handleInvite = async (user: Profile) => {
    if (migrationRequired || denied || !currentUserId || sendingId) return;
    setError(null);
    setMessage(null);
    setSendingId(user.id);
    const result = await createGroupInvite(supabase, chatId, user.id);
    setSendingId(null);

    if (!result.ok) {
      if (result.migrationRequired) setMigrationRequired(true);
      setError(result.message);
      return;
    }

    setSentInviteeIds((current) => new Set(current).add(user.id));
    setInviteStatuses((current) => ({ ...current, [user.id]: "pending" }));
    setMessage(`Приглашение отправлено: ${inviteCandidateName(user)}.`);
  };

  /**
   * Adding a bot is not inviting a person, and the screen must not blur them.
   *
   * An invitation is a request the other side answers; this takes effect at
   * once, because a bot has nobody to ask. So it is a separate section, with
   * its own verb and its own sentence about what the bot will see — and that
   * sentence is on the screen before the button is pressed, not in a tooltip.
   */
  const handleAddBot = async (bot: BotLike) => {
    if (addingBotId || denied) return;
    setError(null);
    setMessage(null);
    setAddingBotId(bot.id);
    const result = await addChatBot(chatId, bot.id);
    setAddingBotId(null);
    if (!result.ok) {
      setError(botMembershipFailureMessage(result.error, BOT_ADD_FAILED));
      return;
    }
    setAddedBotIds((current) => new Set(current).add(bot.id));
    setMessage(botAddedMessage(botDisplayName(bot)));
    onBotAdded?.();
  };

  const renderBotRow = (bot: BotLike) => {
    const added = addedBotIds.has(bot.id);
    return (
      <div
        key={bot.id}
        data-invite-bot={bot.id}
        data-invite-bot-state={added ? "added" : "addable"}
        className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors kub-raise-hover"
      >
        <BotLikeAvatar bot={bot} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[color:var(--kub-text)]">{botDisplayName(bot)}</div>
          <div className="truncate text-xs text-[color:var(--kub-muted)]">{botSecondaryLine(bot)}</div>
        </div>
        <button
          type="button"
          onClick={() => void handleAddBot(bot)}
          disabled={added || addingBotId !== null}
          className={cn(
            "inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-3 text-xs font-semibold transition-colors",
            // No perimeter on the settled state: a nested box inside a sheet is
            // separated by a step of material, not by a line (rule 11). The
            // disabled fill below is that step.
            added
              ? "text-[color:var(--kub-muted)]"
              : "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] hover:bg-[var(--kub-cyan-hover)]",
            "disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed",
          )}
        >
          {addingBotId === bot.id ? BOT_ADDING_LABEL : added ? BOT_ADDED_LABEL : BOT_ADD_LABEL}
        </button>
      </div>
    );
  };

  const known = ordered.filter((person) => knownPeople.ids.has(person.id));
  const others = ordered.filter((person) => !knownPeople.ids.has(person.id));
  const grouped = !searching && known.length > 0 && others.length > 0;

  const renderRow = (user: Profile) => {
    const state = inviteCandidateState({
      personId: user.id,
      myId: currentUserId,
      memberIds: memberIdSet,
      inviteStatuses,
      sentIds: sentInviteeIds,
    });
    const actionable = canInviteCandidate(state) && !migrationRequired && !denied;
    return (
      <div
        key={user.id}
        data-invite-candidate={user.id}
        data-invite-state={state}
        className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors kub-raise-hover"
      >
        <UserAvatar user={user} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[color:var(--kub-text)]">{inviteCandidateName(user)}</div>
          <div className="truncate text-xs text-[color:var(--kub-muted)]">
            {user.username ? `@${user.username}` : roleLabel(user.role)}
          </div>
        </div>
        {/*
          * No control at all when the whole screen is refused. A row of inert
          * «Пригласить» buttons under a sentence saying you may not invite is
          * the screen disagreeing with itself — and the people are still worth
          * showing, which is the same rule the settings screen follows: a
          * member reads every value, and only the pencil is withheld.
          */}
        {denied ? null : (
          <button
            type="button"
            onClick={() => void handleInvite(user)}
            disabled={!actionable || sendingId !== null}
            className={cn(
              "inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-3 text-xs font-semibold transition-colors",
              actionable
                ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] hover:bg-[var(--kub-cyan-hover)]"
                : "border border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)]",
              "disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed",
            )}
          >
            {sendingId === user.id ? "Отправка..." : inviteCandidateButtonLabel(state)}
          </button>
        )}
      </div>
    );
  };

  return (
    <KubModal
      open={true}
      onClose={onClose}
      title="Пригласить пользователя"
      description={chatName}
      icon={<KubIcon name="userPlus" size={16} />}
      size="md"
      contentClassName="space-y-3"
      footer={(
        <KubButton variant="secondary" onClick={onClose}>
          Закрыть
        </KubButton>
      )}
    >
      <div className="flex items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 h-10 transition-all focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--kub-cyan)]">
        <KubIcon name="search" size={14} className="shrink-0 text-[color:var(--kub-muted)]" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по имени или @никнейму…"
          className="min-w-0 flex-1 bg-transparent text-sm text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]"
        />
      </div>

      {denied && (
        <div
          data-testid="invite-denied"
          className="flex items-start gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs text-[color:var(--kub-muted)]"
        >
          <KubIcon name="lock" size={14} className="mt-0.5 shrink-0" />
          <span>{inviteDenialText(denied, chatFacts?.type)}</span>
        </div>
      )}

      {policyUnreadNote && (
        <div
          data-testid="invite-policy-unread"
          className="flex items-start gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs text-[color:var(--kub-muted)]"
        >
          <KubIcon name="info" size={14} className="mt-0.5 shrink-0" />
          <span>{policyUnreadNote}</span>
        </div>
      )}

      {message && (
        <div className="flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--kub-cyan)_35%,transparent)] bg-[color-mix(in_srgb,var(--kub-cyan)_10%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-accent-text)]">
          <KubIcon name="info" size={14} className="mt-0.5 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-[color:var(--kub-danger)]/40 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-danger-text)]">
          <KubIcon name="alert" size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="max-h-[min(56vh,360px)] overflow-y-auto -mx-1 px-1" data-testid="invite-candidates">
        {ordered.length === 0 ? (
          loadingResults ? (
            <EmptyInviteState text="Ищем пользователей…" />
          ) : (
            <EmptyInviteState text={inviteSearchEmptyText(query)} />
          )
        ) : grouped ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <ListHeading text={INVITE_KNOWN_HEADING} />
              {known.map(renderRow)}
            </div>
            <div className="space-y-1">
              <ListHeading text={INVITE_OTHERS_HEADING} />
              {others.map(renderRow)}
            </div>
          </div>
        ) : (
          <div className="space-y-1">{ordered.map(renderRow)}</div>
        )}

        {bots.length > 0 && !denied && (
          <div className="mt-3 space-y-1" data-testid="invite-bots">
            <ListHeading text={BOT_SECTION_HEADING} />
            {/* The sentence, where the decision is taken. A bot always enters
                `restricted` — `chat_bot_members_visibility_approval_check`
                forbids a `full` row without an approver — so there is no
                one-step way to add one that reads everything, and no control
                for it is drawn. Raising it is a two-party flow that does not
                exist yet. */}
            <p
              data-testid="invite-bot-visibility"
              className="px-2 pb-1 text-[11px] leading-4 text-[color:var(--kub-muted)]"
            >
              {BOT_VISIBILITY_NOTE}
            </p>
            {bots.map(renderBotRow)}
          </div>
        )}
      </div>
    </KubModal>
  );
}

function ListHeading({ text }: { text: string }) {
  return (
    <div className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
      {text}
    </div>
  );
}

function EmptyInviteState({ text }: { text: string }) {
  return (
    <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-[color:var(--kub-border-color)] px-4 text-center text-xs text-[color:var(--kub-muted)]">
      {text}
    </div>
  );
}

function readChatRole(value: unknown): ChatMemberRole | null {
  return value === "owner" || value === "admin" || value === "member" ? value : null;
}

function roleLabel(role: Profile["role"]): string {
  if (role === "admin") return "Администратор";
  if (role === "manager") return "Менеджер";
  return "Пользователь";
}
