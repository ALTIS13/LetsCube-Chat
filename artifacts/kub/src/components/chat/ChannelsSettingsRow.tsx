"use client";

import { KubIcon } from "@/components/kub";
import { FOCUS_RING } from "@/lib/controlSurface";
import { canManageChannels } from "@/lib/serverChannels";
import { CHANNELS_ROW_LABEL } from "@/lib/serverChannelVocabulary";
import { useAppStore } from "@/store/app.store";
import { cn } from "@/lib/utils";
import { ChannelManageDialogHost, requestChannelManage } from "./ChannelManageModal";

/**
 * The settings row that opens the channel management dialog, and the dialog's
 * own mount.
 *
 * It reads the chat and the role from the store rather than taking them as
 * props, and that is a deliberate choice with a reason on both sides.
 *
 * The reason it *can*: `MainLayout` renders `<ChatWindow chatId={selectedChatId} />`,
 * `ChatWindow` reads `chats.find(c => c.id === chatId)` and hands exactly that
 * row to `ChatInfoPanel`, which is the only thing that renders the settings
 * screen. So the chat whose settings are on screen is always the selected one —
 * checked in the source rather than assumed, because a settings screen acting
 * on another conversation's channels is the worst failure this surface has.
 *
 * The reason it *must*: `ChatInfoPanel` belongs to the rail's track in this
 * stage and is not mine to edit, so there is no call site to add two props to.
 * A component that finds its own two facts is the cheaper of the two ways to
 * leave that boundary intact, and when the panel does get the props it can pass
 * them and this can take them.
 *
 * The row carries no value on its right, unlike its neighbours. That is not an
 * oversight: a count of channels would cost three reads on every open of the
 * settings screen for a number nobody is deciding anything by, and the chevron
 * already says the same thing every other «navigate» row's chevron says.
 */
export function ChannelsSettingsRow() {
  const currentUserId = useAppStore((state) => state.currentUser?.id ?? null);
  // `find` over the list rather than a derived object: the store hands back the
  // same row object while that chat is unchanged, so this subscribes to one
  // conversation instead of to every message in the sidebar (D-088).
  const chat = useAppStore((state) => state.chats.find((row) => row.id === state.selectedChatId) ?? null);

  const role = chat?.members?.find((member) => member.user_id === currentUserId)?.role ?? null;
  const isGroup = chat?.type === "group" || chat?.type === "channel";

  if (!chat || !isGroup || !canManageChannels(role)) return null;

  return (
    <>
      <button
        type="button"
        data-testid="chat-settings-row-channels"
        onClick={() =>
          requestChannelManage({ chatId: chat.id, chatName: chat.name ?? null, role })
        }
        className={cn(
          "flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm",
          "kub-interactive text-[color:var(--kub-text)] kub-raise-hover",
          FOCUS_RING,
        )}
      >
        <KubIcon name="channel" size={17} tone="muted" className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{CHANNELS_ROW_LABEL}</span>
        <KubIcon name="chevronRight" size={14} tone="muted" className="shrink-0" />
      </button>
      <ChannelManageDialogHost />
    </>
  );
}
