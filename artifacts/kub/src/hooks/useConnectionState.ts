"use client";

import { useEffect, useState } from "react";
import { createConnectionStateMachine, type ConnectionState } from "@/lib/connectionState";
import { createClient } from "@/lib/supabase/client";

/**
 * One machine for the whole run: whether the socket has ever opened is a fact
 * about this run, not about whichever component asks.
 */
const machine = createConnectionStateMachine();

/** How often the socket is looked at. It has no event this client can rely on. */
const LOOK_EVERY_MS = 1_000;

/** «Соединение...» or «Ожидание сети...» while either is true (tracker item 53). */
export function useConnectionState(): ConnectionState {
  const [state, setState] = useState<ConnectionState>("online");

  useEffect(() => {
    // The socket every channel of this client runs on, as `useConnectionRevival` reads it.
    const socket = createClient().realtime;
    const look = () => {
      const deviceOnline = typeof navigator === "undefined" || navigator.onLine !== false;
      setState(machine.next({ deviceOnline, socketOpen: socket.isConnected() }));
    };
    look();
    const timer = window.setInterval(look, LOOK_EVERY_MS);
    window.addEventListener("online", look);
    window.addEventListener("offline", look);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", look);
      window.removeEventListener("offline", look);
    };
  }, []);

  return state;
}
