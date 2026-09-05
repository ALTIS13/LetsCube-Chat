/* LETSCUBE Windows startup screen.
 *
 * Rule for this file: nothing is displayed that was not computed somewhere
 * real. Every fingerprint digit on the screen comes out of `snapshot.peer`,
 * which the shell fills from the certificate its own HTTPS request observed. A
 * snapshot without `peer` — which is every build that has not yet been taught
 * to send it — renders no fingerprint at all rather than a placeholder shaped
 * like one.
 */

const STARTUP_EVENT = "letscube://startup-state";
const stageOrder = [
  "network_check",
  "tls_origin_check",
  "update_check",
  "production_navigation",
  "workspace_ready",
  "complete",
];
const stageLabels = {
  boot: "Готовим подключение",
  network_check: "Проверяем доступ к сети",
  tls_origin_check: "Проверяем сертификат узла",
  update_check: "Смотрим, есть ли обновление",
  production_navigation: "Открываем рабочее пространство",
  workspace_ready: "Рабочее пространство готово",
  complete: "Соединение с узлом подтверждено",
  recoverable_error: "Подключение остановлено",
  // Declared in StartupStage (src-tauri/src/startup.rs) but not currently
  // reachable: nothing calls require_critical_update. It is listed so that an
  // unmapped stage cannot fall back to a message describing a different one.
  critical_update_required: "Требуется обновление",
};

// What the left panel can honestly say before the shell sends a certificate.
// These describe the shell's own request, which is the only thing that has
// been checked at each point.
const shellCheckNotes = {
  boot: "проверка не начиналась",
  network_check: "проверяем доступ к сети",
  tls_origin_check: "проверяем цепочку сертификатов",
  update_check: "цепочка проверена",
  production_navigation: "цепочка проверена",
  workspace_ready: "цепочка проверена",
  complete: "цепочка проверена",
  recoverable_error: "проверка не завершена",
  critical_update_required: "цепочка проверена",
};

const handshake = document.querySelector("#startup-handshake");
const seal = document.querySelector("#startup-center-seal");
const status = document.querySelector("#startup-status");
const failure = document.querySelector("#startup-failure");
const error = document.querySelector("#startup-error");
const retry = document.querySelector("#startup-retry");
const mismatch = document.querySelector("#startup-mismatch");
const mismatchDetail = document.querySelector("#startup-mismatch-detail");
const mismatchRecheck = document.querySelector("#startup-mismatch-recheck");
const mismatchContinue = document.querySelector("#startup-mismatch-continue");
const clientIdentity = document.querySelector('[data-testid="startup-client-fingerprint"]');
const serverIdentity = document.querySelector('[data-testid="startup-server-fingerprint"]');
const dragRegion = document.querySelector("#startup-drag-region");
const minimize = document.querySelector("#startup-window-minimize");
const maximize = document.querySelector("#startup-window-maximize");
const close = document.querySelector("#startup-window-close");

function invokeWindowCommand(command) {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  return typeof invoke === "function" ? invoke(command).catch(() => undefined) : Promise.resolve();
}

/* A SHA-256 is 32 bytes. Anything that is not exactly 32 bytes of hex is not a
 * fingerprint this screen knows how to show, so it is refused rather than
 * printed in a shape that would look authoritative. */
function normalizeDigest(value) {
  if (typeof value !== "string") return null;
  const hex = value.replace(/[\s:-]/g, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  return hex.match(/../g);
}

/* Two lengths, for two different jobs.
 *
 * While things are going well nobody is comparing anything, and 32 bytes of
 * hex across a splash screen is noise: the leading four bytes are enough to
 * recognise, and the ellipsis says outright that this is a prefix rather than
 * the value. The full 32 bytes appear only where someone actually has to
 * compare two of them — the mismatch state — laid out as four lines of eight,
 * which is the four-line block the identity row has always reserved. */
function digestLines(value, full) {
  const bytes = normalizeDigest(value);
  if (!bytes) return null;
  if (!full) return [`${bytes.slice(0, 4).join(":")}…`];
  return [0, 8, 16, 24].map((offset) => bytes.slice(offset, offset + 8).join(":"));
}

function renderIdentity(node, label, lines, note) {
  const labelNode = node.querySelector("[data-fingerprint-label]");
  const valueNode = node.querySelector("[data-fingerprint-value]");
  labelNode.textContent = label;
  valueNode.replaceChildren();
  valueNode.dataset.digest = lines ? (lines.length === 1 ? "short" : "full") : "none";
  if (lines) {
    // One <span> per line of the digest, and none for anything else, so
    // counting the spans in this block counts fingerprint lines. The e2e
    // geometry check relies on that: four lines or none, never a partial value.
    valueNode.dataset.kind = "digest";
    for (const line of lines) {
      const span = document.createElement("span");
      span.textContent = line;
      valueNode.append(span);
    }
    node.setAttribute("aria-label", `${label}: ${lines.join(":")}`);
    return;
  }
  valueNode.dataset.kind = "note";
  valueNode.textContent = note;
  node.setAttribute("aria-label", `${label}: ${note}`);
}

/* The two panels only ever carry independently obtained values: the left one
 * is what this computer recorded on an earlier connection, the right one is
 * what arrived on the wire just now. Printing one value into both would be the
 * same theatre with extra steps, so the left panel shows nothing at all when
 * there is no record to compare against. */
function renderPeer(snapshot, full) {
  const peer = snapshot.peer && typeof snapshot.peer === "object" ? snapshot.peer : null;
  const observed = digestLines(peer?.observedSha256, full);
  const expected = digestLines(peer?.expectedSha256, full);

  if (!observed) {
    renderIdentity(clientIdentity, "Проверка оболочки", null, shellCheckNotes[snapshot.stage] ?? "состояние неизвестно");
    renderIdentity(serverIdentity, "Отпечаток узла", null, "недоступен в этой сборке");
    return;
  }

  renderIdentity(serverIdentity, "Отпечаток узла", observed, "");
  if (expected) {
    renderIdentity(clientIdentity, "Ожидаемый отпечаток", expected, "");
  } else {
    renderIdentity(clientIdentity, "Ожидаемый отпечаток", null, "первое подключение, сравнивать не с чем");
  }
}

/* The issuer and the validity date come off the certificate, which means they
 * are supplied by whatever answered the connection. `textContent` keeps them
 * from being markup, and these bounds keep a deliberately long string from
 * pushing the notice — and with it the scene — past the bottom of a 640px
 * window. Anything longer is not a name, it is a lever. */
function boundedField(value, limit) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1)}…` : cleaned;
}

function describeMismatch(peer) {
  const issuer = boundedField(peer?.issuer, 48);
  const notAfter = boundedField(peer?.notAfter, 24);
  const source = [issuer, notAfter ? `действителен до ${notAfter}` : null]
    .filter(Boolean)
    .join(" · ");
  return [
    "Цепочка доверия проверена средствами Windows и признана доверенной — но сертификат не тот,",
    "что был записан при прошлом подключении. Так выглядит и плановая замена сертификата,",
    "и подмена, поэтому сверьте отпечатки выше.",
    source ? `— ${source}.` : "",
  ].join(" ").trim();
}

function focusWhenRevealed(node, control, shouldShow) {
  const wasHidden = node.hidden;
  node.hidden = !shouldShow;
  // Focus goes to the safe action, and only on the transition into view, so a
  // repeated snapshot does not keep pulling focus back.
  if (shouldShow && wasHidden) control.focus();
}

function renderStartup(snapshot) {
  if (!snapshot || typeof snapshot.stage !== "string" || typeof snapshot.connected !== "boolean") return;
  document.body.dataset.stage = snapshot.stage;
  const connected = snapshot.stage === "complete" && snapshot.connected === true;
  const peerChanged = snapshot.stage === "recoverable_error" && snapshot.errorCode === "peer_changed";
  const hardFailure = snapshot.stage === "recoverable_error" && !peerChanged;

  handshake.classList.toggle("is-connected", connected);
  seal.setAttribute("aria-hidden", String(!connected));
  status.textContent = stageLabels[snapshot.stage] ?? stageLabels.boot;
  // The full digest is shown only where someone has to compare two of them.
  renderPeer(snapshot, peerChanged);

  document.body.dataset.verdict = connected
    ? "verified"
    : peerChanged
      ? "changed"
      : hardFailure
        ? "failed"
        : "pending";

  if (hardFailure) {
    // A certificate the trust store rejects lands here, with a retry and no
    // way past. The override below is only ever offered for a pin that no
    // longer matches, never for a chain that failed to validate.
    error.textContent = snapshot.errorCode === "tls_origin"
      ? "Не удалось подтвердить сертификат LETSCUBE. Соединение не установлено."
      : "Сервер LETSCUBE недоступен. Проверьте подключение и повторите попытку.";
  }
  if (peerChanged) {
    mismatchDetail.textContent = describeMismatch(snapshot.peer);
  }

  retry.disabled = false;
  mismatchRecheck.disabled = false;
  mismatchContinue.disabled = false;
  focusWhenRevealed(failure, retry, hardFailure);
  focusWhenRevealed(mismatch, mismatchRecheck, peerChanged);

  const current = stageOrder.indexOf(snapshot.stage);
  // A changed pin is only discoverable after the handshake completed, so the
  // network and certificate stages did finish. Leaving them blank would
  // contradict the notice directly below them, which says the chain validated
  // and the address matched. Every other stop leaves the track where it was.
  const reached = peerChanged ? stageOrder.indexOf("update_check") : current;
  document.querySelectorAll("[data-stage-name]").forEach((item) => {
    const index = stageOrder.indexOf(item.dataset.stageName);
    item.classList.toggle("is-active", index === current);
    item.classList.toggle("is-done", connected || (reached > index && reached >= 0));
  });
}

function invokeGuarded(control, command) {
  control.disabled = true;
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke === "function") {
    void invoke(command).catch(() => { control.disabled = false; });
  } else {
    control.disabled = false;
  }
}

retry.addEventListener("click", () => invokeGuarded(retry, "retry_main"));
mismatchRecheck.addEventListener("click", () => invokeGuarded(mismatchRecheck, "retry_main"));
/* Per-occurrence only. The command records the fingerprint that was accepted so
 * the next connection compares against it; it does not set an "always allow"
 * flag, and it does not relax any TLS validation — the chain has already been
 * validated by the time this control can exist. */
mismatchContinue.addEventListener("click", () => invokeGuarded(mismatchContinue, "startup_accept_peer_change"));

dragRegion.addEventListener("mousedown", (event) => {
  if (event.button === 0) void invokeWindowCommand("startup_start_dragging");
});
dragRegion.addEventListener("dblclick", () => void invokeWindowCommand("startup_toggle_maximize"));
minimize.addEventListener("click", () => void invokeWindowCommand("startup_minimize"));
maximize.addEventListener("click", () => void invokeWindowCommand("startup_toggle_maximize"));
close.addEventListener("click", () => void invokeWindowCommand("startup_close_to_tray"));

window.renderStartup = renderStartup;
window.addEventListener(STARTUP_EVENT, (event) => renderStartup(event.detail));
// The identity blocks are empty in the markup, so the boot state is painted
// once here. StartupState::new() starts at Boot, so this is the shell's real
// starting stage and not an assumption.
renderStartup({ stage: "boot", connected: false, errorCode: null });
