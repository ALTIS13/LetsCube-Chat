(() => {
  if (window.location.origin !== __LETSCUBE_PRODUCTION_ORIGIN__) return;
  if (window.top !== window) return;

  const eventName = __LETSCUBE_STARTUP_EVENT__;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fadeDuration = reducedMotion ? 1 : 320;
  const minimumVisibleDuration = 2_200;
  const successHoldDuration = 900;
  const completionKey = "letscube:startup-overlay-complete";
  try {
    if (window.sessionStorage.getItem(completionKey) === "1") return;
  } catch { /* Storage is optional; it is not a readiness signal. */ }
  const historyKey = "__letscubeStartupOverlayHistory";
  const history = [];
  Object.defineProperty(window, historyKey, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: history,
  });
  let suppressed = false;
  let abortOverlay = () => { suppressed = true; };
  const onBootFailed = () => {
    if (document.documentElement.dataset.kubBootState === "failed") abortOverlay();
  };
  window.addEventListener("letscube:boot-failed", onBootFailed);
  window.addEventListener("letscube:native-navigation", () => abortOverlay());
  // A missing receipt or native callback must not indefinitely hide web retry.
  // This removes an obstruction only; it never invents successful progress.
  const readinessDeadline = window.setTimeout(() => abortOverlay(), 30_000);
  let latestSnapshot = null;
  let applySnapshot = (snapshot) => { latestSnapshot = snapshot; };
  window.addEventListener(eventName, (event) => applySnapshot(event.detail));

  /* Same rule and same shape as startup.js: a SHA-256 or nothing, shown as the
   * leading four bytes with an ellipsis that says it is a prefix. This scene
   * continues the startup window's, so the two must format an identical
   * certificate identically or the handoff would look like a change.
   *
   * There is no long form here. The overlay only exists on the path where the
   * connection was confirmed — a changed pin stops in the startup window, which
   * is where the two full values are laid out for comparison. */
  const digestLines = (value) => {
    if (typeof value !== "string") return null;
    const hex = value.replace(/[\s:-]/g, "").toUpperCase();
    if (!/^[0-9A-F]{64}$/.test(hex)) return null;
    return [`${hex.match(/../g).slice(0, 4).join(":")}…`];
  };

  const mount = () => {
    if (suppressed || document.documentElement.dataset.kubBootState === "failed") {
      window.clearTimeout(readinessDeadline);
      return;
    }
    if (!document.body || document.querySelector('[data-testid="production-startup-overlay"]')) return;
    const host = document.createElement("div");
    host.dataset.testid = "production-startup-overlay";
    host.dataset.stage = "production_navigation";
    host.dataset.connected = "false";
    host.dataset.verdict = "pending";
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
    const clientIdentity = shadow.querySelector('[data-testid="production-startup-client-fingerprint"]');
    const serverIdentity = shadow.querySelector('[data-testid="production-startup-server-fingerprint"]');
    const successText = "Рабочее пространство готово";
    const mountedAt = performance.now();
    let removalStarted = false;
    abortOverlay = () => {
      if (suppressed) return;
      suppressed = true;
      host.remove();
      window.clearTimeout(readinessDeadline);
      history.push(Object.freeze({ removed: true, connected: false }));
    };

    const renderIdentity = (node, label, lines, note) => {
      node.querySelector("[data-fingerprint-label]").textContent = label;
      const valueNode = node.querySelector("[data-fingerprint-value]");
      valueNode.replaceChildren();
      valueNode.dataset.kind = lines ? "digest" : "note";
      valueNode.dataset.digest = lines ? "short" : "none";
      // One <span> per digest line and none for a note, matching startup.js so
      // the handoff does not change the shape of the block.
      if (lines) {
        for (const line of lines) {
          const span = document.createElement("span");
          span.textContent = line;
          valueNode.append(span);
        }
      } else {
        valueNode.textContent = note;
      }
      node.setAttribute("aria-label", `${label}: ${lines ? lines.join(":") : note}`);
    };

    /* The left panel carries what this computer had recorded, the right one
     * what the shell observed on the wire. When the shell sends no
     * certificate — every build that has not been taught to — both panels say
     * so instead of showing digits that came from nowhere. */
    const renderPeer = (snapshot) => {
      const peer = snapshot?.peer && typeof snapshot.peer === "object" ? snapshot.peer : null;
      const observed = digestLines(peer?.observedSha256);
      const expected = digestLines(peer?.expectedSha256);
      if (!observed) {
        renderIdentity(clientIdentity, "Проверка оболочки", null, "цепочка проверена");
        renderIdentity(serverIdentity, "Отпечаток узла", null, "недоступен в этой сборке");
        return;
      }
      renderIdentity(serverIdentity, "Отпечаток узла", observed, "");
      renderIdentity(
        clientIdentity,
        "Ожидаемый отпечаток",
        expected,
        "первое подключение, сравнивать не с чем",
      );
    };

    renderPeer(null);
    history.push(Object.freeze({
      stage: "production_navigation",
      connected: false,
      sealConnected: false,
      statusText: status.textContent,
      fadeDuration,
      minimumVisibleDuration,
      successHoldDuration,
    }));

    applySnapshot = (snapshot) => {
      if (suppressed) return;
      if (!snapshot || typeof snapshot.stage !== "string" || typeof snapshot.connected !== "boolean") return;
      const receipt = window.__letscubeReadiness?.();
      const connected = snapshot.stage === "complete" && snapshot.connected === true
        && receipt?.state === "ready" && receipt.documentId === snapshot.documentId;
      host.dataset.stage = snapshot.stage;
      host.dataset.connected = String(connected);
      host.dataset.verdict = connected
        ? "verified"
        : snapshot.errorCode === "peer_changed"
          ? "changed"
          : "pending";
      handshake.classList.toggle("is-connected", connected);
      seal.setAttribute("aria-hidden", String(!connected));
      renderPeer(snapshot);
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
      window.clearTimeout(readinessDeadline);
      const elapsed = performance.now() - mountedAt;
      const holdDuration = Math.max(minimumVisibleDuration - elapsed, successHoldDuration, 0);
      const stillReady = () => {
        const current = window.__letscubeReadiness?.();
        return current?.state === "ready" && current.documentId === snapshot.documentId;
      };
      window.setTimeout(() => {
        if (suppressed) return;
        if (!stillReady()) { abortOverlay(); return; }
        requestAnimationFrame(() => host.classList.add("is-fading"));
        window.setTimeout(() => {
          if (suppressed) return;
          if (!stillReady()) { abortOverlay(); return; }
          host.remove();
          try { window.sessionStorage.setItem(completionKey, "1"); } catch { /* Optional. */ }
          history.push(Object.freeze({ removed: true }));
          window.dispatchEvent(new CustomEvent("letscube://startup-overlay-removed"));
        }, fadeDuration);
      }, holdDuration);
    };
    if (latestSnapshot) applySnapshot(latestSnapshot);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
