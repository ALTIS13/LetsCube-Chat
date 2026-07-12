const failure = document.querySelector("#failed");
const status = document.querySelector("#status");
const retry = document.querySelector("#retry");

const failureTimer = window.setTimeout(() => {
  status.hidden = true;
  failure.hidden = false;
}, 15000);

retry.addEventListener("click", () => {
  window.clearTimeout(failureTimer);
  retry.disabled = true;
  failure.hidden = true;
  status.hidden = false;
  status.textContent = "Повторное подключение...";
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke === "function") {
    void invoke("retry_main").catch(() => window.location.reload());
  } else {
    window.location.reload();
  }
});
