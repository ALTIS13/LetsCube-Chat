"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app.store";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { WelcomeScreen } from "@/components/chat/WelcomeScreen";
import { BottomNav } from "./BottomNav";

export function MainLayout() {
  const { selectedChatId, setSelectedChatId, setShowSidebar } = useAppStore();

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) setShowSidebar(true);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setShowSidebar]);

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ background: "var(--tg-bg)" }}>
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — full width on mobile when no chat, fixed width on desktop */}
        <div
          className={`
            h-full flex-shrink-0 flex flex-col
            md:w-[360px] lg:w-[380px] xl:w-[400px]
            ${selectedChatId ? "hidden md:flex" : "flex w-full"}
          `}
          style={{ borderRight: "1px solid var(--tg-border)" }}
        >
          <Sidebar />
        </div>

        {/* Chat area */}
        <div
          className={`
            flex-1 h-full overflow-hidden
            ${selectedChatId ? "flex" : "hidden md:flex"}
          `}
        >
          {selectedChatId ? (
            <ChatWindow chatId={selectedChatId} />
          ) : (
            <WelcomeScreen />
          )}
        </div>
      </div>

      {/* Mobile bottom navigation (shown on sidebar view) */}
      {!selectedChatId && <BottomNav />}
    </div>
  );
}
