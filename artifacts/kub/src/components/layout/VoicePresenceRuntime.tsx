"use client";

import { useLayoutEffect } from "react";
import { observeVoiceCallAuth, useVoiceCall } from "@/hooks/useVoiceCall";
import { useVoicePresenceReader } from "@/hooks/useVoicePresence";
import { useAppStore } from "@/store/app.store";
import { useAuthRuntime } from "@/lib/authRuntime";

/** Keep call signalling alive across routes, without opening a guest client. */
export function VoicePresenceRuntime() {
  const auth = useAuthRuntime();
  useLayoutEffect(() => {
    observeVoiceCallAuth(auth);
  }, [auth.userId, auth.loading]);
  const userId = useAppStore((state) => state.currentUser?.id ?? null);
  const { phase } = useVoiceCall();
  const active = phase === "joining" || phase === "connected" || phase === "reconnecting";
  return userId && active ? <ActiveVoicePresence userId={userId} /> : null;
}

function ActiveVoicePresence({ userId }: { userId: string }) {
  useVoicePresenceReader(userId);
  return null;
}
