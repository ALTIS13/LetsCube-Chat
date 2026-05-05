"use client";

import { MessageCircle, Phone, Bookmark, Settings } from "lucide-react";
import { useState } from "react";

const TABS = [
  { id: "chats", label: "Чаты", icon: MessageCircle, badge: 4 },
  { id: "calls", label: "Звонки", icon: Phone, badge: 0 },
  { id: "saved", label: "Избранное", icon: Bookmark, badge: 0 },
  { id: "settings", label: "Настройки", icon: Settings, badge: 0 },
];

export function BottomNav() {
  const [active, setActive] = useState("chats");

  return (
    <div
      className="md:hidden flex items-center justify-around flex-shrink-0 px-2 pb-safe"
      style={{
        background: "var(--tg-sidebar)",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        height: "56px",
      }}
    >
      {TABS.map(({ id, label, icon: Icon, badge }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => setActive(id)}
            className="relative flex flex-col items-center gap-0.5 px-4 py-1 rounded-xl transition-colors"
            style={{ color: isActive ? "var(--tg-accent)" : "var(--tg-text-secondary)" }}
          >
            <div className="relative">
              <Icon size={22} />
              {badge > 0 && (
                <span
                  className="absolute -top-1.5 -right-2 min-w-[16px] h-4 rounded-full text-[10px] font-semibold flex items-center justify-center px-1"
                  style={{ background: "var(--tg-unread)", color: "#fff" }}
                >
                  {badge}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">{label}</span>
            {isActive && (
              <span
                className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                style={{ background: "var(--tg-accent)" }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
