"use client";

import Image from "next/image";
import type { ChatWithLastMessage, Profile } from "@/types/database";
import { cn } from "@/lib/utils";

// Generate consistent color from string
function getAvatarColor(str: string): string {
  const colors = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
    "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9",
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

interface ChatAvatarProps {
  chat: Pick<ChatWithLastMessage, "id" | "name" | "avatar_url" | "type">;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  showOnline?: boolean;
}

const sizeMap = {
  sm: "w-8 h-8 text-xs",
  md: "w-12 h-12 text-sm",
  lg: "w-16 h-16 text-lg",
  xl: "w-20 h-20 text-2xl",
};

const pixelMap = {
  sm: 32,
  md: 48,
  lg: 64,
  xl: 80,
};

export function ChatAvatar({ chat, size = "md", className, showOnline }: ChatAvatarProps) {
  const name = chat.name ?? "?";
  const bgColor = getAvatarColor(chat.id);
  const initials = getInitials(name);
  const px = pixelMap[size];

  return (
    <div className={cn("relative flex-shrink-0", className)}>
      {chat.avatar_url ? (
        <Image
          src={chat.avatar_url}
          alt={name}
          width={px}
          height={px}
          className={cn("rounded-full object-cover", sizeMap[size])}
        />
      ) : (
        <div
          className={cn(
            "rounded-full flex items-center justify-center font-medium text-white",
            sizeMap[size]
          )}
          style={{ background: bgColor }}
        >
          {initials}
        </div>
      )}
      {showOnline && (
        <span
          className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2"
          style={{
            background: "var(--tg-online)",
            borderColor: "var(--tg-sidebar)",
          }}
        />
      )}
    </div>
  );
}

export function UserAvatar({
  user,
  size = "md",
  className,
  showOnline,
}: {
  user: Pick<Profile, "id" | "full_name" | "avatar_url">;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  showOnline?: boolean;
}) {
  const name = user.full_name ?? "?";
  const bgColor = getAvatarColor(user.id);
  const initials = getInitials(name);
  const px = pixelMap[size];

  return (
    <div className={cn("relative flex-shrink-0", className)}>
      {user.avatar_url ? (
        <Image
          src={user.avatar_url}
          alt={name}
          width={px}
          height={px}
          className={cn("rounded-full object-cover", sizeMap[size])}
        />
      ) : (
        <div
          className={cn(
            "rounded-full flex items-center justify-center font-medium text-white",
            sizeMap[size]
          )}
          style={{ background: bgColor }}
        >
          {initials}
        </div>
      )}
      {showOnline && (
        <span
          className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2"
          style={{
            background: "var(--tg-online)",
            borderColor: "var(--tg-header)",
          }}
        />
      )}
    </div>
  );
}
