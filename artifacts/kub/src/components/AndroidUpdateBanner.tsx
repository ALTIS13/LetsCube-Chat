import { AndroidUpdateStatus } from "./AndroidUpdateStatus";
import { isNativeAndroid } from "@/lib/platform/capabilities";

/** Mount once in the application shell; Settings may observe the same native job. */
export function AndroidUpdateBanner() {
  if (!isNativeAndroid()) return null;
  return <AndroidUpdateStatus compact />;
}
