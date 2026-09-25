import { useRef } from "react";
import { useLocation } from "wouter";
import type { BottomNavDestination } from "@/lib/bottomNavDestinations";
import { SettingsOverlay } from "./SettingsOverlay";
import { useSettingsScreen } from "./SettingsScreen";
import { useIsMobile } from "@/hooks/use-mobile";

/** The screen owns the draft while its phone and desktop containers change. */
export function SettingsSurface({ onClose, profileTab = false }: { onClose: () => void; profileTab?: boolean }) {
  const [, setLocation] = useLocation();
  const pendingTab = useRef<BottomNavDestination | null>(null);
  const screen = useSettingsScreen({
    onClose: () => {
      const destination = pendingTab.current;
      onClose();
      if (destination?.route) setLocation("/tasks");
    },
  });
  const isPhone = useIsMobile();
  const onProfileTabSelect = (destination: BottomNavDestination) => {
    if (destination.id === "profile" || pendingTab.current) return;
    pendingTab.current = destination;
    void screen.requestClose().finally(() => { pendingTab.current = null; });
  };
  return (
    <SettingsOverlay
      screen={screen}
      isPhone={isPhone}
      profileTab={profileTab}
      onProfileTabSelect={onProfileTabSelect}
    />
  );
}
