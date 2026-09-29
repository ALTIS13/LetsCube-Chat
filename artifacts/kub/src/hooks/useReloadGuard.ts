import { useEffect } from "react";
import { guardAgainstReload, type ReloadLoss } from "@/lib/reloadGuard";

/**
 * Holds `loss` on `lib/reloadGuard.ts` while `active` is true, and lets go when
 * it turns false or the component unmounts — so a quiet restart waits for
 * whatever this component has in hand.
 */
export function useReloadGuard(active: boolean, loss: ReloadLoss): void {
  useEffect(() => (active ? guardAgainstReload(loss) : undefined), [active, loss]);
}
