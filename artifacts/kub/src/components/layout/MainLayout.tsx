"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app.store";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ChatListResizer } from "@/components/sidebar/ChatListResizer";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { WelcomeScreen } from "@/components/chat/WelcomeScreen";
import { BottomNav } from "./BottomNav";
import { DesktopUpdatePill } from "@/components/desktop/DesktopUpdatePill";
import { useDesktopUpdate } from "@/hooks/useDesktopUpdate";
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
  const desktopUpdate = useDesktopUpdate();
  const updateBlocking = desktopUpdate?.presentation?.blocking === true;

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
      if (updateBlocking) return;

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
  }, [selectedChatId, setSelectedChatId, updateBlocking]);

  return (
    // No background of its own. `body` paints --tg-bg with --kub-ambient over
    // it, and that ambient is the only thing the chrome's blur has to pick up:
    // an opaque shell here would hand every panel one flat colour to sample and
    // the glass would come back as paint. See the Glass note in index.css.
    //
    // `px-safe` is the notch held sideways. An iPhone in landscape keeps 59px
    // of each long edge, and at that width this is already the two-pane
    // layout, so the sidebar's avatars and the chat's last controls would sit
    // under it. The page ground shows in those two bands, which is what iOS
    // itself paints there for a page that does not ask for the whole screen.
    //
    // `h-app` is `--kub-app-height`: 100dvh, and 100vh in the installed iPhone
    // app, where iOS hands 100dvh over short from the first frame (D-111).
    <div className="flex flex-col h-app w-screen overflow-hidden px-safe">
      <DesktopUpdatePill />
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        data-testid="desktop-app-shell"
        aria-hidden={updateBlocking ? true : undefined}
        inert={updateBlocking ? true : undefined}
      >
        {/* No bar above the panes. Telegram Desktop's window begins with the
            rail and ours does too since 2026-09-12: a band carrying the
            LETSCUBE wordmark sat here, which both pushed the folder rail below
            the window's top edge and drew the mark a second time beside the
            one in the list's top row. The owner chose to remove it.

            What it also carried has moved rather than gone: the window's own
            buttons, its drag region and its double click to maximise are
            `DesktopWindowChrome`, which every other surface already used, and
            the 44px it held the panes clear of those buttons by is now
            `--kub-window-caption`, padded out of each pane's own top through
            `pt-window-top`. See `DesktopWindowChrome`. */}
        <div
          // Room for the floating capsule below `md`, so the last row of a
          // list can still be scrolled clear of it. The bar used to take this
          // space by standing in the flow; it floats now, and what it no
          // longer occupies it has to reserve. The gap is counted twice on
          // purpose: once under the capsule and once above it.
          className="flex flex-1 overflow-hidden pb-[calc(var(--kub-bottom-nav)+var(--kub-bottom-nav-gap)*2)] md:pb-0"
          data-kub-panes=""
        >
          <div
            // The whole left region: the 72pt folder rail and the chat list
            // beside it, both inside the one sheet of glass `Sidebar` paints.
            // The resizer measures from this box's left edge, so the rail's
            // width is already in the arithmetic.
            //
            // The 360/380/400 breakpoint triple that used to be here is gone.
            // A person sets the width by dragging and it is remembered;
            // `--kub-chat-list-width` carries it, written straight onto the
            // document by `ChatListResizer` so a drag costs no React render.
            data-kub-left-region=""
            className={cn(
              // No z-index here on purpose. An earlier revision gave this
              // column `z-10` so the sidebar's shadow would fall on the chat
              // pane; that made the column a stacking context, and every dialog
              // the sidebar opens — settings, new chat, folders — was clamped
              // inside it and rendered underneath the top bar. The shadow is
              // not worth that. `Sidebar` paints its material from a positioned
              // layer, which already draws over the non-positioned pane beside
              // it.
              "kub-left-region h-full flex-shrink-0 flex-col border-r border-[color:var(--kub-border-color)]",
              "md:flex",
              // No `w-full` here. A utility beats a class in `@layer
              // components` (rule 10), so `w-full` silently won over
              // `.kub-left-region`'s width and the column stayed 1367px wide
              // through every drag — measured. The width is the class's, at
              // both widths.
              isMobileChatOpen ? "hidden" : "flex",
            )}
          >
            <Sidebar />
          </div>

          {/* Not gated on `isMobileChatOpen`: on a computer both panes are on
              screen with a chat open and the handle has to stay. It hides
              itself below `md`, where there is one pane and nothing to drag. */}
          <ChatListResizer />

          <div
            className={cn(
              "flex-1 h-full overflow-hidden",
              isMobileChatOpen ? "flex" : "hidden md:flex",
            )}
          >
            {selectedChatId ? <ChatWindow chatId={selectedChatId} /> : <WelcomeScreen />}
          </div>
        </div>

        {/* Absolutely placed against this column, which is why the column is
            `relative`. Not against the viewport: a `fixed` capsule would
            ignore the column entirely, and this product has already been
            bitten by a stacking context clamping what a pane opens. */}
        {!isMobileChatOpen && <BottomNav />}
      </div>
    </div>
  );
}
