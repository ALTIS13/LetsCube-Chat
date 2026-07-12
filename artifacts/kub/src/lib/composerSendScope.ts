export interface ComposerSendToken {
  readonly chatId: string;
  readonly generation: number;
}

export interface ComposerSendScope {
  activate(chatId: string): void;
  capture(): ComposerSendToken;
  invalidate(): void;
  isActive(token: ComposerSendToken): boolean;
}

export interface ComposerRestoreActions {
  restoreText(text: string): void;
  writeDraft(chatId: string, text: string): void;
  focus?: () => void;
}

export type ComposerCompletionResult<T> =
  | { status: "completed"; value: T }
  | { status: "stale" };

export function createComposerSendScope(initialChatId: string): ComposerSendScope {
  let active = true;
  let chatId = initialChatId;
  let generation = 0;

  return {
    activate(nextChatId) {
      if (active && chatId === nextChatId) return;
      active = true;
      chatId = nextChatId;
      generation += 1;
    },
    capture() {
      return { chatId, generation };
    },
    invalidate() {
      if (!active) return;
      active = false;
      generation += 1;
    },
    isActive(token) {
      return active && token.chatId === chatId && token.generation === generation;
    },
  };
}

export function restoreComposerTextIfCurrent(
  scope: ComposerSendScope,
  token: ComposerSendToken,
  text: string,
  actions: ComposerRestoreActions,
): boolean {
  if (!scope.isActive(token)) return false;
  actions.restoreText(text);
  actions.writeDraft(token.chatId, text);
  actions.focus?.();
  return true;
}

export async function runComposerCompletionIfCurrent<T>(
  scope: ComposerSendScope,
  token: ComposerSendToken,
  complete: () => T | Promise<T>,
): Promise<ComposerCompletionResult<T>> {
  if (!scope.isActive(token)) return { status: "stale" };
  const value = await complete();
  return scope.isActive(token) ? { status: "completed", value } : { status: "stale" };
}
