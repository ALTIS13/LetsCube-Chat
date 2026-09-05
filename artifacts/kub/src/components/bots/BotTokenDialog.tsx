import * as Dialog from "@radix-ui/react-dialog";
import { showActionFeedback } from "@/lib/actionFeedback";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import { KubButton, KubIcon } from "@/components/kub";

export type BotTokenDialogHandle = {
  show(token: string): void;
  clear(): void;
};

export const BotTokenDialog = forwardRef<BotTokenDialogHandle>(function BotTokenDialog(_, ref) {
  const [token, setToken] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useImperativeHandle(ref, () => ({
    show(nextToken) {
      setCopyState("idle");
      setToken(nextToken);
    },
    clear() {
      setToken(null);
      setCopyState("idle");
    },
  }), []);
  useEffect(() => () => setToken(null), []);

  const close = () => {
    setToken(null);
    setCopyState("idle");
  };
  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopyState("copied");
      showActionFeedback({ kind: "success", title: "Токен скопирован", key: "bot-token" });
    } catch {
      setCopyState("failed");
      showActionFeedback({
        kind: "error",
        title: "Не удалось скопировать токен",
        detail: "Скопируйте его вручную — он больше не будет показан.",
        key: "bot-token",
      });
    }
  };

  return (
    <Dialog.Root open={token !== null} onOpenChange={() => undefined}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/45" />
        <Dialog.Content
          aria-describedby="bot-token-description"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          className="bots-management-surface kub-glass-strong fixed left-1/2 top-1/2 z-[81] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[color:var(--kub-border-color)] p-5 focus:outline-none sm:p-6"
        >
          <Dialog.Title className="text-lg font-semibold text-[color:var(--kub-text)]">
            Токен бота
          </Dialog.Title>
          <Dialog.Description id="bot-token-description" className="mt-2 text-sm leading-6 text-[color:var(--kub-muted)]">
            Токен показан один раз. Сохраните его сейчас: после закрытия восстановить значение нельзя.
          </Dialog.Description>
          <div className="mt-5 rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] p-3">
            <div className="text-[11px] font-semibold uppercase text-[color:var(--kub-muted)]">Токен</div>
            {token && (
              <div data-testid="raw-bot-token" spellCheck={false} className="mt-2 break-all font-mono text-sm leading-6 text-[color:var(--kub-text)] select-all">
                {token}
              </div>
            )}
          </div>
          <div aria-live="polite" className="mt-2 min-h-5 text-xs text-[color:var(--kub-muted)]">
            {copyState === "copied" && "Токен скопирован"}
            {copyState === "failed" && "Не удалось скопировать. Выделите токен вручную."}
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <KubButton variant="secondary" className="min-h-11 sm:w-40" onClick={copy} leftIcon={<KubIcon name={copyState === "copied" ? "check" : "copy"} size={17} />}>
              {copyState === "copied" ? "Скопировано" : "Скопировать"}
            </KubButton>
            <KubButton variant="primary" className="min-h-11" onClick={close}>
              Готово, закрыть
            </KubButton>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
});
