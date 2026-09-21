(() => {
  if (window.top !== window || window.location.origin !== __LETSCUBE_PRODUCTION_ORIGIN__) return;

  // Per-document receipt, never persisted and never sent by an IPC command.
  const documentId = crypto.randomUUID();
  let committedRoot = null;
  let active = true;
  let failed = false;
  window.addEventListener("letscube:app-rendered", () => {
    const root = document.getElementById("root");
    // The web boot listener can set bootState later in this same dispatch.
    // Capture the committed root here and check bootState when native reads.
    if (active && root?.dataset.kubAppReady === "true") {
      failed = false;
      committedRoot = root;
    }
  });
  window.addEventListener("letscube:boot-failed", () => {
    if (document.documentElement.dataset.kubBootState === "failed") {
      failed = true;
      committedRoot = null;
    }
  });
  window.addEventListener("pagehide", () => { active = false; });
  window.addEventListener("letscube:native-navigation", () => { active = false; });
  Object.defineProperty(window, "__letscubeReadiness", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: () => ({
      documentId,
      loaded: document.readyState === "complete",
      state: !active ? "inactive"
        : failed || document.documentElement.dataset.kubBootState === "failed" ? "failed"
          : committedRoot && committedRoot === document.getElementById("root")
            && committedRoot.isConnected && committedRoot.dataset.kubAppReady === "true"
            && document.documentElement.dataset.kubBootState === "ready" ? "ready" : "pending",
    }),
  });
})();
