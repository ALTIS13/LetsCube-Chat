import React, { useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  KubButton,
  KubEmptyState,
  KubIcon,
} from "../../artifacts/kub/src/components/kub";
import { MessageList } from "../../artifacts/kub/src/components/chat/MessageList";
import { TooltipProvider } from "../../artifacts/kub/src/components/ui/tooltip";
import { useAppStore } from "../../artifacts/kub/src/store/app.store";
import { applyResolvedTheme } from "../../artifacts/kub/src/lib/themeRuntime";
import "../../artifacts/kub/src/index.css";

// Guest-only component pixels: no App/Auth root, account, backend session or media.
if (useAppStore.getState().currentUser) throw Error("GUEST_PREVIEW_REQUIRED");
const params = new URL(location.href).searchParams;
document.documentElement.dataset.theme =
  params.get("theme") === "light" ? "light" : "dark";
applyResolvedTheme(document.documentElement.dataset.theme as "light" | "dark");
function Preview() {
  const bottom = useRef<HTMLDivElement>(null);
  const kind = params.get("kind") ?? "empty";
  const loading = kind === "loading",
    error =
      kind === "error" ? "Не удалось загрузить более ранние сообщения." : null;
  return (
    <TooltipProvider>
      <main className="chat-bg flex h-dvh w-full min-w-0 flex-col bg-[var(--kub-bg)] text-[var(--kub-text)]">
        {kind === "empty" ? (
          <div
            data-preview-target
            className="flex min-h-0 flex-1 items-center justify-center px-4"
          >
            <KubEmptyState
              icon={<KubIcon name="chatRect" size={24} />}
              title="Ранние сообщения"
              description="В загруженной части истории нет сообщений."
              action={
                <KubButton
                  type="button"
                  variant="secondary"
                  className="min-h-11"
                  leftIcon={<KubIcon name="chevronUp" size={16} />}
                >
                  Загрузить ранние сообщения
                </KubButton>
              }
            />
          </div>
        ) : (
          <MessageList
            messages={[]}
            onReply={() => {}}
            onReaction={() => {}}
            bottomRef={bottom}
            hasMoreOlder
            loadingOlder={loading}
            olderError={error}
            onLoadOlder={async () => ({ loaded: 0 })}
          />
        )}
      </main>
    </TooltipProvider>
  );
}
const element = document.getElementById("preview");
if (!element) throw Error("PREVIEW_ROOT_REQUIRED");
createRoot(element).render(<Preview />);
