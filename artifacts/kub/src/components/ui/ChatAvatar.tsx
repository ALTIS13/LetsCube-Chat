"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ChatWithLastMessage, Profile } from "@/types/database";
import { KubIcon } from "@/components/kub";
import { useAvatarVariant, useChatAvatarVariant, type AvatarVariantUrls } from "@/hooks/useMediaVariants";
import { isSavedChatLikeName } from "@/lib/chatDisplay";
import { cn } from "@/lib/utils";
import { messageActorAvatarUrl, messageActorDisplayName, type MessageActor } from "@/lib/messageActor";
import { avatarInkFor } from "@/lib/avatarInk";
import { avatarVariantSubject, pickAvatarVariant } from "@/lib/avatarVariantStore";
import { FRAME_RING_WIDTH, frameStyle } from "@/lib/profileCosmetics";

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
  /**
   * For a private chat, whose picture this is. A chat has no variants of its
   * own — they are keyed by profile — so without this the row cannot tell
   * whether a small version is on its way and starts the original instead.
   */
  profileId?: string | null;
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
  profileId,
  chatId,
  size,
  fallback,
}: {
  name: string;
  originalUrl: string | null | undefined;
  avatarVariant?: AvatarVariantUrls;
  /**
   * Whose avatar this is. Given one, the picture finds its own small version
   * instead of depending on the caller to pass `avatarVariant` — which only six
   * of forty-two call sites did, leaving the rest to download a 734 kB original
   * to draw a 32-pixel circle.
   */
  profileId?: string | null;
  /**
   * When the picture belongs to no person — a group or channel avatar — the
   * chat it belongs to instead. Measured on this deployment before it was
   * wired up: group avatars averaged 862 kB, the largest 2.25 MB, for a circle
   * drawn at 48 pixels.
   */
  chatId?: string | null;
  size: keyof typeof pixelMap;
  fallback: ReactNode;
}) {
  // A caller that already batched its own lookup keeps it; the stores are only
  // asked when nobody has answered. At most one of the two ids is ever set, so
  // the other resolves to "nothing to wait for" immediately.
  const { variant: resolvedProfile, settled: profileSettled } = useAvatarVariant(profileId);
  const { variant: resolvedChat, settled: chatSettled } = useChatAvatarVariant(chatId);
  const settled = profileSettled && chatSettled;
  // A store answers "asked, and there is none" with an empty object rather than
  // `undefined`, so `??` alone would let a profile with no variant hide a chat
  // that has one. Whichever actually produced a picture wins.
  const effectiveVariant = avatarVariant ?? pickAvatarVariant(resolvedProfile, resolvedChat);
  const variantUrl = getAvatarVariantSrc(effectiveVariant, size);
  // Starting the original while the answer is still coming downloads both — a
  // 734 kB request that is abandoned the moment the 3 kB one arrives. The
  // monogram fills the same box in the meantime, so nothing moves.
  const waiting = !settled && !variantUrl;
  const primaryUrl = waiting ? undefined : variantUrl ?? originalUrl ?? undefined;
  const fallbackUrl = variantUrl && originalUrl && variantUrl !== originalUrl ? originalUrl : undefined;
  const [status, setStatus] = useState<"primary" | "fallback" | "failed">("primary");

  useEffect(() => {
    setStatus("primary");
  }, [primaryUrl, fallbackUrl]);

  if (!primaryUrl || status === "failed") return <>{fallback}</>;

  const src = status === "fallback" && fallbackUrl ? fallbackUrl : primaryUrl;
  const srcSet = status === "primary" ? getAvatarVariantSrcSet(effectiveVariant) : undefined;
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

export function ChatAvatar({ chat, size = "md", className, showOnline, isSaved: savedOverride, avatarVariant, profileId }: ChatAvatarProps) {
  const name = chat.name ?? "?";
  const bgColor = getAvatarColor(chat.id);
  const initials = getInitials(name);
  const px = pixelMap[size];
  const isSaved = savedOverride ?? isSavedChatLikeName(chat.name);
  const fallback = (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-medium",
        sizeMap[size]
      )}
      style={{ background: bgColor, color: avatarInkFor(bgColor) }}
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
          {...avatarVariantSubject(chat.id, profileId)}
          size={size}
          fallback={fallback}
        />
      ) : (
        fallback
      )}
      {showOnline && (
        <span
          className="absolute bottom-0 right-0 h-2 w-2 rounded-full"
          style={{
            background: "var(--tg-online)",
            boxShadow: "0 0 0 2px var(--tg-sidebar)",
          }}
        />
      )}
    </div>
  );
}

/**
 * An earned frame, drawn as a ring *outside* the avatar.
 *
 * Deliberately not a border on the avatar itself: a border eats into the
 * picture and changes the element's size, which would shift every row the
 * avatar sits in the moment someone earned one. The ring is painted by a
 * wrapper that grows outward, so an undecorated avatar and a decorated one
 * occupy the same box.
 */
function AvatarFrame({
  frame,
  size,
  children,
}: {
  frame: string | null | undefined;
  size: "sm" | "md" | "lg" | "xl";
  children: ReactNode;
}) {
  const style = frameStyle(frame);
  if (!style) return <>{children}</>;
  const width = FRAME_RING_WIDTH[size];
  return (
    <span
      data-profile-frame={frame}
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      style={{
        margin: -width,
        padding: width,
        borderRadius: "9999px",
        background: style.ring,
        boxShadow: style.glow,
      }}
    >
      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-[var(--kub-bg)]">
        {children}
      </span>
    </span>
  );
}

export function UserAvatar({
  user,
  size = "md",
  className,
  showOnline,
  avatarVariant,
}: {
  user: Pick<Profile, "id" | "full_name" | "username" | "avatar_url"> & {
    profile_frame?: string | null;
  };
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
        "rounded-full flex items-center justify-center font-medium",
        sizeMap[size]
      )}
      style={{ background: bgColor, color: avatarInkFor(bgColor) }}
    >
      {initials}
    </div>
  );

  const picture = user.avatar_url ? (
    <AvatarImage
      name={name}
      originalUrl={user.avatar_url}
      avatarVariant={avatarVariant}
      profileId={user.id}
      size={size}
      fallback={fallback}
    />
  ) : (
    fallback
  );

  return (
    <div className={cn("relative flex-shrink-0", sizeMap[size], className)}>
      {frameStyle(user.profile_frame) ? (
        <AvatarFrame frame={user.profile_frame} size={size}>
          {picture}
        </AvatarFrame>
      ) : (
        picture
      )}
      {showOnline && (
        <span
          className="absolute bottom-0 right-0 h-2 w-2 rounded-full"
          style={{
            background: "var(--tg-online)",
            boxShadow: "0 0 0 2px var(--tg-header)",
          }}
        />
      )}
    </div>
  );
}

export function MessageActorAvatar({
  actor,
  size = "sm",
  className,
  avatarVariant,
}: {
  actor: MessageActor;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  avatarVariant?: AvatarVariantUrls;
}) {
  const name = messageActorDisplayName(actor);
  const avatarUrl = messageActorAvatarUrl(actor);
  const actorId = "id" in actor ? actor.id : actor.kind;
  const iconName = actor.kind === "bot" || actor.kind === "deleted_bot" ? "bot" : "user";
  const bgColor = getAvatarColor(actorId);
  const fallback = (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-medium",
        sizeMap[size],
      )}
      // D-044. This is the same palette the chat list and the header draw, and
      // it was the only one of the three still forcing white ink: all ten
      // colours are pastel, so the monogram beside a message measured 1.19:1 to
      // 2.78:1 while its siblings measured 6.75:1 to 15.67:1 on the same person.
      // The icon takes the ink too — a bot's glyph is a shape on the same fill.
      style={{ background: bgColor, color: avatarInkFor(bgColor) }}
      aria-label={name}
    >
      {actor.kind === "user" ? getInitials(name) : <KubIcon name={iconName} size={Math.max(12, Math.round(pixelMap[size] * 0.48))} />}
    </div>
  );

  return (
    <div className={cn("relative flex-shrink-0", className)} data-message-actor-kind={actor.kind}>
      {avatarUrl ? (
        <AvatarImage
          name={name}
          originalUrl={avatarUrl}
          avatarVariant={actor.kind === "user" ? avatarVariant : undefined}
          // Only a person has an avatar variant; a bot's picture is its own.
          profileId={actor.kind === "user" ? actorId : null}
          size={size}
          fallback={fallback}
        />
      ) : fallback}
    </div>
  );
}
