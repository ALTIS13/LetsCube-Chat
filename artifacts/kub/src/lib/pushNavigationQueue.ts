export type DeferredPushTargetHandler = {
  handle: (target: string) => void;
  flush: () => boolean;
  hasPending: () => boolean;
};

export function createDeferredPushTargetHandler(
  openTarget: (target: string) => void,
  isReady: () => boolean,
): DeferredPushTargetHandler {
  let pendingTarget: string | null = null;

  return {
    handle(target) {
      if (isReady()) {
        openTarget(target);
        return;
      }
      pendingTarget = target;
    },
    flush() {
      if (!pendingTarget || !isReady()) return false;
      const target = pendingTarget;
      pendingTarget = null;
      openTarget(target);
      return true;
    },
    hasPending() {
      return Boolean(pendingTarget);
    },
  };
}
