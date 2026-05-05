"use client";

import { useAppStore } from "@/store/app.store";
import type { AppRole } from "@/types/database";

export function useRole(): AppRole | null {
  return useAppStore((s) => s.currentUser?.role ?? null);
}

export function useIsAdmin(): boolean {
  return useRole() === "admin";
}

export function useIsManagerOrAdmin(): boolean {
  const r = useRole();
  return r === "admin" || r === "manager";
}
