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
  boot: "Подготавливаем защищённое соединение",
  network_check: "Проверяем доступ к сети",
  tls_origin_check: "Проверяем HTTPS и адрес сервера",
  update_check: "Проверяем версию клиента",
  production_navigation: "Открываем рабочее пространство",
  workspace_ready: "Рабочее пространство готово",
  complete: "Защищённое соединение установлено",
  recoverable_error: "Подключение остановлено",
};

const handshake = document.querySelector("#startup-handshake");
const seal = document.querySelector("#startup-center-seal");
const status = document.querySelector("#startup-status");
const failure = document.querySelector("#startup-failure");
const error = document.querySelector("#startup-error");
const retry = document.querySelector("#startup-retry");

function renderStartup(snapshot) {
  if (!snapshot || typeof snapshot.stage !== "string" || typeof snapshot.connected !== "boolean") return;
  document.body.dataset.stage = snapshot.stage;
  const connected = snapshot.stage === "complete" && snapshot.connected === true;
  handshake.classList.toggle("is-connected", connected);
  seal.setAttribute("aria-hidden", String(!connected));
  status.textContent = stageLabels[snapshot.stage] ?? stageLabels.boot;
  failure.hidden = snapshot.stage !== "recoverable_error";
  retry.disabled = false;

  if (snapshot.stage === "recoverable_error") {
    error.textContent = snapshot.errorCode === "tls_origin"
      ? "Не удалось подтвердить защищённый адрес LETSCUBE. Проверьте сеть и повторите попытку."
      : "Сервер LETSCUBE недоступен. Проверьте подключение и повторите попытку.";
  }

  const current = stageOrder.indexOf(snapshot.stage);
  document.querySelectorAll("[data-stage-name]").forEach((item) => {
    const index = stageOrder.indexOf(item.dataset.stageName);
    item.classList.toggle("is-active", index === current);
    item.classList.toggle("is-done", connected || (current > index && current >= 0));
  });
}

retry.addEventListener("click", () => {
  retry.disabled = true;
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke === "function") {
    void invoke("retry_main").catch(() => { retry.disabled = false; });
  } else {
    retry.disabled = false;
  }
});

window.renderStartup = renderStartup;
window.addEventListener(STARTUP_EVENT, (event) => renderStartup(event.detail));
