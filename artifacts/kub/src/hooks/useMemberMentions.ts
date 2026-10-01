import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type RefObject } from "react";
import { useAppStore } from "@/store/app.store";
import { enterSendsHere } from "@/lib/composerEnter";
import {
  insertMemberMention, matchMentionCandidates, mentionCompletionContext, replaceMentionText,
  type MemberMentionCandidate, type MentionText, type MentionEntity,
} from "@/lib/memberMentions";

export function useMemberMentionPicker(
  chatId: string,
  topicId: string | null,
  snapshot: MentionText,
  setSnapshot: (snapshot: MentionText) => void,
  field: RefObject<HTMLTextAreaElement | null>,
  disabled = false,
) {
  const userId = useAppStore((state) => state.currentUser?.id ?? null);
  const chat = useAppStore((state) => state.chats.find((item) => item.id === chatId));
  const scope = `${userId}:${chatId}:${topicId}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const pendingPaste = useRef<{
    scope: string; element: HTMLTextAreaElement; event: ClipboardEvent<HTMLTextAreaElement>;
    source: MentionText; start: number; end: number; result: MentionText;
  } | null>(null);
  const listId = useId();
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [composing, setComposing] = useState(false);
  const candidates = useMemo<MemberMentionCandidate[]>(() => {
    // Use the same membership read as the conversation. Never query the
    // global directory, or retain another account's roster as a suggestion.
    if (!userId || !chat?.members?.some((member) => member.user_id === userId)) return [];
    return [
      ...chat.members.flatMap((member) => !member.profile || member.user_id === userId ? [] : [{
        kind: "user" as const, id: member.user_id,
        label: `@${member.profile.full_name || member.profile.username || "Пользователь"}`,
        username: member.profile.username, avatar_url: member.profile.avatar_url,
      }]),
      ...(chat.bots ?? []).filter((bot) => bot.state === "active").map((bot) => ({
        kind: "bot" as const, id: bot.id, label: `@${bot.username}`,
        username: bot.username, avatar_url: bot.avatar_url,
      })),
    ];
  }, [chat, userId]);
  const context = disabled || composing || snapshot.mentionEntities.items.length >= 32 ? null
    : mentionCompletionContext(snapshot.content, selection.start, selection.end, snapshot.mentionEntities.items);
  const key = context ? `${scope}:${context.start}:${context.end}:${context.query}` : null;
  const open = key !== null && key !== dismissed && candidates.length > 0;
  const matches = useMemo(() => context ? matchMentionCandidates(candidates, context.query) : [],
    [candidates, context?.query]);
  const selectedIndex = Math.min(activeIndex, Math.max(0, matches.length - 1));
  useEffect(() => { setActiveIndex(0); }, [key]);
  useEffect(() => {
    pendingPaste.current = null;
    setDismissed(null); setSelection({ start: 0, end: 0 }); setComposing(false);
  }, [scope]);
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    let replacement: { event: InputEvent; start: number; end: number } | null = null;
    const ownsField = () => scopeRef.current === scope && Boolean(userId)
      && useAppStore.getState().currentUser?.id === userId && field.current === element
      && !element.disabled && !element.readOnly;
    // React's beforeInput is synthesized from textInput/keypress on some
    // engines. Native events retain the actual selection and input type.
    const beforeInput = (event: Event) => {
      replacement = null;
      const input = event as InputEvent;
      if (!ownsField() || composing || input.isComposing || input.defaultPrevented
        || input.inputType !== "insertText" || typeof input.data !== "string"
        || element.value !== snapshot.content) return;
      const start = element.selectionStart;
      const end = element.selectionEnd;
      if (start === end || !snapshot.mentionEntities.items.some((item) => start < item.offset + item.length && end > item.offset)) return;
      replacement = { event: input, start, end };
    };
    const input = (event: Event) => {
      const edit = replacement;
      replacement = null;
      const native = event as InputEvent;
      if (!edit || !ownsField() || composing || native.isComposing || edit.event.defaultPrevented
        || native.inputType !== "insertText") return;
      const content = element.value;
      const prefix = snapshot.content.slice(0, edit.start);
      const suffix = snapshot.content.slice(edit.end);
      if (content.length < prefix.length + suffix.length || !content.startsWith(prefix) || !content.endsWith(suffix)) return;
      setSnapshot(replaceMentionText(snapshot, {
        start: edit.start, end: edit.end, text: content.slice(edit.start, content.length - suffix.length),
      }));
    };
    element.addEventListener("beforeinput", beforeInput);
    element.addEventListener("input", input);
    return () => {
      element.removeEventListener("beforeinput", beforeInput);
      element.removeEventListener("input", input);
    };
  }, [composing, field, scope, snapshot, setSnapshot, userId]);
  const observeSelection = () => {
    const element = field.current;
    if (element) setSelection({ start: element.selectionStart, end: element.selectionEnd });
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    pendingPaste.current = null;
    if (event.defaultPrevented || composing || scopeRef.current !== scope
      || !userId || useAppStore.getState().currentUser?.id !== userId) return false;
    const element = event.currentTarget;
    const data = event.clipboardData;
    if (element !== field.current || element.disabled || element.readOnly || element.value !== snapshot.content
      || !data || !Array.from(data.types).includes("text/plain")) return false;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (start === end || !snapshot.mentionEntities.items.some((item) => start < item.offset + item.length && end > item.offset)) return false;
    const text = data.getData("text/plain").replace(/\r\n?/g, "\n");
    const result = replaceMentionText(snapshot, { start, end, text });
    pendingPaste.current = { scope, element, event, source: snapshot, start, end, result };
    // Native paste owns text/caret/undo. An identical replacement may emit no
    // change event, so retire its identity now; otherwise wait for native input.
    if (result.content === snapshot.content) setSnapshot(result);
    return true;
  };
  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const paste = pendingPaste.current;
    pendingPaste.current = null;
    if (!paste || paste.event.defaultPrevented || paste.scope !== scope || scopeRef.current !== scope
      || !userId || useAppStore.getState().currentUser?.id !== userId) return false;
    const element = event.currentTarget;
    if (element !== field.current || element !== paste.element || element.disabled || element.readOnly) return false;
    const isCurrent = (value: MentionText) => snapshot.content === value.content
      && snapshot.mentionEntities.revision === value.mentionEntities.revision;
    if (!isCurrent(paste.source) && !isCurrent(paste.result)) return false;
    const content = element.value;
    if (paste.result.content === paste.source.content && content !== paste.result.content) return false;
    if (paste.result.content !== paste.source.content && content === paste.source.content) return false;
    const prefix = paste.source.content.slice(0, paste.start);
    const suffix = paste.source.content.slice(paste.end);
    if (content.length < prefix.length + suffix.length || !content.startsWith(prefix) || !content.endsWith(suffix)) return false;
    const result = content === paste.result.content ? paste.result : replaceMentionText(paste.source, {
      start: paste.start, end: paste.end, text: content.slice(paste.start, content.length - suffix.length),
    });
    setSnapshot(result);
    return true;
  };
  const choose = (candidate: MemberMentionCandidate) => {
    if (!open || !context || scopeRef.current !== scope
      || !matches.some((item) => item.kind === candidate.kind && item.id === candidate.id)) return;
    const result = insertMemberMention(snapshot, context, candidate);
    setSnapshot(result.snapshot);
    setDismissed(key);
    requestAnimationFrame(() => {
      const element = field.current;
      if (scopeRef.current !== scope || !element || element.value !== result.snapshot.content
        || snapshotRef.current.mentionEntities.revision !== result.snapshot.mentionEntities.revision) return;
      element.focus();
      element.setSelectionRange(result.caret, result.caret);
      setSelection({ start: result.caret, end: result.caret });
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || composing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return false;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); setDismissed(key); return true;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((selectedIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % Math.max(1, matches.length));
      return true;
    }
    if ((event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && enterSendsHere())) && matches.length) {
      event.preventDefault(); choose(matches[selectedIndex]); return true;
    }
    return false;
  };
  return { open, listId, matches, selectedIndex, choose, onKeyDown, onPaste, onChange, observeSelection,
    onCompositionStart: () => { pendingPaste.current = null; setComposing(true); },
    onCompositionEnd: () => { setComposing(false); observeSelection(); },
    fieldAttributes: { role: "combobox" as const, "aria-autocomplete": "list" as const,
      "aria-expanded": open, "aria-controls": open ? listId : undefined,
      "aria-activedescendant": open && matches.length ? `${listId}-${selectedIndex}` : undefined } };
}

export function useMemberMentionActions(chatId: string, disabled = false) {
  const openUser = useAppStore((state) => state.openUserProfile);
  const openBot = useAppStore((state) => state.openBotProfile);
  return useCallback((entity: MentionEntity, trigger: HTMLElement) => {
    if (disabled) return;
    const box = trigger.getBoundingClientRect();
    const anchor = { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
    const bubble = trigger.closest("[data-message-row]")?.querySelector('[data-message-bubble="true"]')?.getBoundingClientRect();
    const row = bubble ? { top: Math.min(box.top, bubble.top), bottom: Math.max(box.bottom, bubble.bottom),
      left: Math.min(box.left, bubble.left), right: Math.max(box.right, bubble.right) } : anchor;
    if (entity.kind === "user") openUser(entity.user_id, "glance", chatId, anchor, row);
    else openBot(entity.bot_id, null, "glance", chatId, anchor, row);
  }, [chatId, disabled, openUser, openBot]);
}
