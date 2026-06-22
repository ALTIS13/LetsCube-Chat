"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ChatWithLastMessage, Profile } from "@/types/database";
import { KubIcon } from "@/components/kub";
import type { AvatarVariantUrls } from "@/hooks/useMediaVariants";
import { isSavedChatLikeName } from "@/lib/chatDisplay";
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
  isSaved?: boolean;
  avatarVariant?: AvatarVariantUrls;
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

function getAvatarVariantSrc(avatarVariant: AvatarVariantUrls | undefined, size: keyof typeof pixelMap): string | undefined {
  if (!avatarVariant) return undefined;
  if (size === "xl") return avatarVariant.avatar256Url ?? avatarVariant.avatar128Url;
  return avatarVariant.avatar128Url ?? avatarVariant.avatar256Url;
}

function getAvatarVariantSrcSet(avatarVariant: AvatarVariantUrls | undefined): string | undefined {
  if (!avatarVariant?.avatar128Url && !avatarVariant?.avatar256Url) return undefined;
  return [
    avatarVariant.avatar128Url ? `${avatarVariant.avatar128Url} 128w` : null,
    avatarVariant.avatar256Url ? `${avatarVariant.avatar256Url} 256w` : null,
  ].filter(Boolean).join(", ");
}

function AvatarImage({
  name,
  originalUrl,
  avatarVariant,
  size,
  fallback,
}: {
  name: string;
  originalUrl: string | null | undefined;
  avatarVariant?: AvatarVariantUrls;
  size: keyof typeof pixelMap;
  fallback: ReactNode;
}) {
  const variantUrl = getAvatarVariantSrc(avatarVariant, size);
  const primaryUrl = variantUrl ?? originalUrl ?? undefined;
  const fallbackUrl = variantUrl && originalUrl && variantUrl !== originalUrl ? originalUrl : undefined;
  const [status, setStatus] = useState<"primary" | "fallback" | "failed">("primary");

  useEffect(() => {
    setStatus("primary");
  }, [primaryUrl, fallbackUrl]);

  if (!primaryUrl || status === "failed") return <>{fallback}</>;

  const src = status === "fallback" && fallbackUrl ? fallbackUrl : primaryUrl;
  const srcSet = status === "primary" ? getAvatarVariantSrcSet(avatarVariant) : undefined;
  const px = pixelMap[size];

  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={`${px}px`}
      alt={name}
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      onError={() => {
        setStatus((current) => current === "primary" && fallbackUrl ? "fallback" : "failed");
      }}
      className={cn("rounded-full object-cover", sizeMap[size])}
    />
  );
}

export function ChatAvatar({ chat, size = "md", className, showOnline, isSaved: savedOverride, avatarVariant }: ChatAvatarProps) {
  const name = chat.name ?? "?";
  const bgColor = getAvatarColor(chat.id);
  const initials = getInitials(name);
  const px = pixelMap[size];
  const isSaved = savedOverride ?? isSavedChatLikeName(chat.name);
  const fallback = (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-medium text-white",
        sizeMap[size]
      )}
      style={{ background: bgColor }}
    >
      {initials}
    </div>
  );

  return (
    <div className={cn("relative flex-shrink-0", className)}>
      {isSaved ? (
        <div
          className={cn(
            "rounded-full flex items-center justify-center text-[color:var(--kub-bg)] bg-[var(--kub-cyan)]",
            sizeMap[size]
          )}
        >
          <KubIcon name="bookmark" size={Math.max(14, Math.round(px * 0.42))} />
        </div>
      ) : chat.avatar_url ? (
        <AvatarImage
          name={name}
          originalUrl={chat.avatar_url}
          avatarVariant={avatarVariant}
          size={size}
          fallback={fallback}
        />
      ) : (
        fallback
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
  avatarVariant,
}: {
  user: Pick<Profile, "id" | "full_name" | "username" | "avatar_url">;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  showOnline?: boolean;
  avatarVariant?: AvatarVariantUrls;
}) {
  const name = user.full_name ?? user.username ?? "?";
  const bgColor = getAvatarColor(user.id);
  const initials = getInitials(name);
  const fallback = (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-medium text-white",
        sizeMap[size]
      )}
      style={{ background: bgColor }}
    >
      {initials}
    </div>
  );

  return (
    <div className={cn("relative flex-shrink-0", className)}>
      {user.avatar_url ? (
        <AvatarImage
          name={name}
          originalUrl={user.avatar_url}
          avatarVariant={avatarVariant}
          size={size}
          fallback={fallback}
        />
      ) : (
        fallback
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
