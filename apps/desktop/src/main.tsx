import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initI18n } from "@lockal/ui";
import { App } from "./App.js";
import { persistDaemonConfigForTauri } from "./tauri/daemon.js";
import "./styles.css";

initI18n("ru");
(globalThis as { lockalPersistDaemon?: (c: string) => Promise<void> }).lockalPersistDaemon =
  persistDaemonConfigForTauri;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
