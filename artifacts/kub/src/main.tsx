import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { initMonitoring } from "@/lib/monitoring";
import "./index.css";

initMonitoring();

const rootElement = document.getElementById("root")!;
rootElement.dataset.kubBootId = createBootId();

createRoot(rootElement).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);

function createBootId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
