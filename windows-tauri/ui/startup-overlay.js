(() => {
  if (window.location.origin !== __LETSCUBE_PRODUCTION_ORIGIN__) return;

  const eventName = __LETSCUBE_STARTUP_EVENT__;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fadeDuration = reducedMotion ? 1 : 320;
  const minimumVisibleDuration = 2_200;
  const successHoldDuration = 900;
  const completionKey = "letscube:startup-overlay-complete";
  if (window.sessionStorage.getItem(completionKey) === "1") return;
  const historyKey = "__letscubeStartupOverlayHistory";
  const history = [];
  Object.defineProperty(window, historyKey, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: history,
  });

  const mount = () => {
    if (!document.body || document.querySelector('[data-testid="production-startup-overlay"]')) return;
    const host = document.createElement("div");
    host.dataset.testid = "production-startup-overlay";
    host.dataset.stage = "production_navigation";
    host.dataset.connected = "false";
    const shadow = host.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(__LETSCUBE_OVERLAY_CSS__);
    shadow.adoptedStyleSheets = [sheet];
    shadow.innerHTML = __LETSCUBE_OVERLAY_HTML__;
    document.body.append(host);

    const handshake = shadow.querySelector("#production-startup-handshake");
    const seal = shadow.querySelector("#production-startup-center-seal");
    const status = shadow.querySelector("#production-startup-status");
    const workspaceStage = shadow.querySelector(".startup-overlay-stages li:last-child");
    const successText = "Рабочее пространство готово";
    const mountedAt = performance.now();
    let removalStarted = false;
    history.push(Object.freeze({
      stage: "production_navigation",
      connected: false,
      sealConnected: false,
      statusText: status.textContent,
      fadeDuration,
      minimumVisibleDuration,
      successHoldDuration,
    }));

    window.addEventListener(eventName, (event) => {
      const snapshot = event.detail;
      if (!snapshot || typeof snapshot.stage !== "string" || typeof snapshot.connected !== "boolean") return;
      const connected = snapshot.stage === "complete" && snapshot.connected === true;
      host.dataset.stage = snapshot.stage;
      host.dataset.connected = String(connected);
      handshake.classList.toggle("is-connected", connected);
      seal.setAttribute("aria-hidden", String(!connected));
      if (connected) {
        status.textContent = successText;
        workspaceStage.classList.remove("is-active");
        workspaceStage.classList.add("is-done");
      }
      history.push(Object.freeze({
        stage: snapshot.stage,
        connected,
        sealConnected: handshake.classList.contains("is-connected"),
        statusText: status.textContent,
        fadeDuration,
        minimumVisibleDuration,
        successHoldDuration,
      }));

      if (!connected || removalStarted) return;
      removalStarted = true;
      window.sessionStorage.setItem(completionKey, "1");
      const elapsed = performance.now() - mountedAt;
      const holdDuration = Math.max(minimumVisibleDuration - elapsed, successHoldDuration, 0);
      window.setTimeout(() => {
        requestAnimationFrame(() => host.classList.add("is-fading"));
        window.setTimeout(() => {
          host.remove();
          history.push(Object.freeze({ removed: true }));
          window.dispatchEvent(new CustomEvent("letscube://startup-overlay-removed"));
        }, fadeDuration);
      }, holdDuration);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
