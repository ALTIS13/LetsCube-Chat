import { SettingsOverlay } from "./SettingsOverlay";
import { useSettingsScreen } from "./SettingsScreen";
import { useIsMobile } from "@/hooks/use-mobile";

/** Resizing changes layout, never the lifetime of the modal or its form fields. */
export function SettingsSurface({ onClose }: { onClose: () => void }) {
  const screen = useSettingsScreen({ onClose });
  const isPhone = useIsMobile();
  return <SettingsOverlay screen={screen} isPhone={isPhone} />;
}
