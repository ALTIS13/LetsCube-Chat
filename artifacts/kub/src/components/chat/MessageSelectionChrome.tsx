"use client";

import { useEffect, useMemo } from "react";

import { copyWithFeedback, showActionFeedback } from "@/lib/actionFeedback";
import { DELETE_FOR_EVERYONE_RPC } from "@/lib/deletedMessages";
import { rpcAvailability } from "@/lib/rpcAvailability";
import { formatFullTime } from "@/lib/format";
import { copiedMessagesText, deleteDialogOption } from "@/lib/messageActions";
import { canUseHumanMessageControls, messageActorDisplayName, resolveMessageActor } from "@/lib/messageActor";
import { useAppStore } from "@/store/app.store";
import type { MessageWithSender } from "@/types/database";

import { getVisibleMediaCaption } from "./MessageBubble";
import { MessageDeleteDialog } from "./MessageDeleteDialog";

/**
 * What a chat needs around its conversation for selection and deletion: which
 * messages are selected, what copying them produces, and the one «Удалить»
 * dialog. Shared by `ChatWindow` and the DEV capture page, so the page the
 * renders are taken from cannot drift from the product.
 */

const chronological = (a: MessageWithSender, b: MessageWithSender) =>
  new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id);

export function useChatMessageSelection(chatId: string, messages: readonly MessageWithSender[]) {
  const selection = useAppStore((state) => state.messageSelection);
  const setMessageSelection = useAppStore((state) => state.setMessageSelection);
  const active = selection?.chatId === chatId;

  const selected = useMemo(() => {
    if (!active || !selection) return [];
    const ids = new Set(selection.ids);
    return messages.filter((message) => ids.has(message.id)).sort(chronological);
  }, [active, messages, selection]);

  // A selection belongs to the chat it was made in: switching away drops it,
  // and so does every selected message leaving the conversation.
  useEffect(() => {
    if (!selection) return;
    if (selection.chatId !== chatId) {
      setMessageSelection(null);
      return;
    }
    if (messages.length > 0 && selected.length === 0) setMessageSelection(null);
  }, [chatId, messages.length, selected.length, selection, setMessageSelection]);

  return { active, selected, clear: () => setMessageSelection(null) };
}

export function selectionCopyText(messages: readonly MessageWithSender[], currentUserId: string | null): string {
  return copiedMessagesText(
    messages.map((message) => {
      const actor = resolveMessageActor(message);
      const name = actor.kind === "user" && actor.id === currentUserId ? "Вы" : messageActorDisplayName(actor);
      const text = message.type === "text" ? message.content ?? "" : getVisibleMediaCaption(message) ?? "";
      return { name, time: formatFullTime(message.created_at), text };
    }),
  );
}

export function copySelectedMessages(messages: readonly MessageWithSender[], currentUserId: string | null): void {
  const text = selectionCopyText(messages, currentUserId);
  if (!text) {
    showActionFeedback({ kind: "info", title: "В выделенных сообщениях нет текста", key: "message-copy" });
    return;
  }
  void copyWithFeedback(text, {
    success: messages.length > 1 ? "Сообщения скопированы" : "Сообщение скопировано",
    error: "Не удалось скопировать",
    key: "message-copy",
  });
}

export interface MessageDeleteResult {
  ok: boolean;
  error?: string | null;
}

/**
 * The delete dialog, opened from a menu or from the selection bar through the
 * store, for the messages of this chat it names.
 */
export function MessageDeleteDialogHost({
  chatId,
  messages,
  chatType,
  isSavedChat,
  otherName,
  currentUserId,
  onDelete,
}: {
  chatId: string;
  messages: readonly MessageWithSender[];
  chatType: string | null | undefined;
  isSavedChat: boolean;
  /** The other person of a private chat, for «Также удалить для …». */
  otherName: string | null | undefined;
  currentUserId: string | null;
  onDelete: (messages: MessageWithSender[], forEveryone: boolean) => Promise<MessageDeleteResult>;
}) {
  const request = useAppStore((state) => state.messageDeleteRequest);
  const setRequest = useAppStore((state) => state.setMessageDeleteRequest);
  const setMessageSelection = useAppStore((state) => state.setMessageSelection);

  const targets = useMemo(() => {
    if (!request || request.chatId !== chatId) return [];
    const ids = new Set(request.ids);
    return messages.filter((message) => ids.has(message.id)).sort(chronological);
  }, [chatId, messages, request]);

  if (!request || request.chatId !== chatId || targets.length === 0) return null;

  const allOwn = targets.every((message) => canUseHumanMessageControls(message, currentUserId));
  // Someone else's message goes for both in a private chat only where the
  // server can do it; once it has told this client it cannot, not offered.
  const option = deleteDialogOption({
    count: targets.length,
    allOwn,
    chatType,
    isSavedChat,
    otherName,
    othersForBoth: rpcAvailability.shouldTry(DELETE_FOR_EVERYONE_RPC),
  });

  return (
    <MessageDeleteDialog
      key={request.ids.join(",")}
      count={targets.length}
      option={option}
      onCancel={() => setRequest(null)}
      onConfirm={async (forEveryone) => {
        const result = await onDelete(targets, forEveryone);
        if (!result.ok) {
          showActionFeedback({
            kind: "error",
            title: targets.length > 1 ? "Не удалось удалить сообщения" : "Не удалось удалить сообщение",
            detail: result.error ?? undefined,
            key: "message-delete",
          });
          return;
        }
        setRequest(null);
        setMessageSelection(null);
      }}
    />
  );
}
