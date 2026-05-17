"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app.store";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { WelcomeScreen } from "@/components/chat/WelcomeScreen";
import { BottomNav } from "./BottomNav";
import { cn } from "@/lib/utils";

/**
 * Top-level shell. On <md, the layout is a one-pane drawer:
 *  - if a chat is selected → ChatWindow takes the whole pane (with a back button
 *    in the chat header that clears `selectedChatId`),
 *  - otherwise → Sidebar (chat list / folders / search) takes the whole pane,
 *    plus a BottomNav docked to the bottom whose tabs drive `mobileSection`
 *    in the store.
 *
 * On md+ the sidebar and the chat pane sit side-by-side and BottomNav is hidden.
 */
export function MainLayout() {
  const selectedChatId = useAppStore((s) => s.selectedChatId);
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const setShowSidebar = useAppStore((s) => s.setShowSidebar);
  const isMobileChatOpen = !!selectedChatId;

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) setShowSidebar(true);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setShowSidebar]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isEditable =
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        target?.isContentEditable;
      const hasBlockingOverlay = Boolean(
        document.querySelector(
          '[role="dialog"], [role="menu"], [data-kub-popover="true"], [data-kub-menu="true"]',
        ),
      );

      if (event.key === "Escape" && !isEditable && !hasBlockingOverlay && selectedChatId) {
        event.preventDefault();
        setSelectedChatId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedChatId, setSelectedChatId]);

  return (
    <div className="flex flex-col h-[100dvh] w-screen overflow-hidden bg-[var(--kub-bg)]">
      <div className="flex flex-1 overflow-hidden">
        <div
          className={cn(
            "h-full flex-shrink-0 flex-col border-r border-[color:var(--kub-border-color)]",
            "md:flex md:w-[360px] lg:w-[380px] xl:w-[400px]",
            isMobileChatOpen ? "hidden" : "flex w-full",
          )}
        >
          <Sidebar />
        </div>

        <div
          className={cn(
            "flex-1 h-full overflow-hidden",
            isMobileChatOpen ? "flex" : "hidden md:flex",
          )}
        >
          {selectedChatId ? <ChatWindow chatId={selectedChatId} /> : <WelcomeScreen />}
        </div>
      </div>

      {!isMobileChatOpen && <BottomNav />}
    </div>
  );
}
