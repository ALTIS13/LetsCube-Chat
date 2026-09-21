import { useEffect } from "react";
import { ownNativeForegroundRing, startNativeVoiceCalls } from "@/lib/platform/nativeVoiceCalls";
import { resetNativeSessionCallsGate } from "./useSessionDevices";

export function useNativeVoiceCalls(): void {
  useEffect(() => startNativeVoiceCalls(resetNativeSessionCallsGate), []);
}

export function useNativeForegroundRing(ringKey: string | null, userId: string | null): void {
  useEffect(() => ownNativeForegroundRing(ringKey, userId), [ringKey, userId]);
}
