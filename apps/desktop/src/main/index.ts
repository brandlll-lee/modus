import { app, BrowserWindow, type BrowserWindow as BrowserWindowType } from "electron";
import { configurePiHost } from "./agent/agent-paths";
import { migrateAgentConfiguration } from "./agent/configuration-migration";
import { getModelRuntime } from "./agent/model-service";
import { shutdownAgentRuntime } from "./agent/runtime-registry";
import { getDatabase } from "./db/database";
import { registerAppIpc } from "./ipc/register-app-ipc";
import { createStartupTimeline } from "./startup/startup-timeline";
import { shutdownTerminals } from "./terminal/terminal-service";
import { createMainWindow } from "./windows/main-window";

let mainWindow: BrowserWindowType | null = null;
const startupTimeline = createStartupTimeline();

startupTimeline.mark("main.entry");

function boot(): void {
  registerAppIpc({ startupTimeline });

  mainWindow = createMainWindow({ startupTimeline });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  app
    .whenReady()
    .then(async () => {
      startupTimeline.mark("main.electron-ready");
      configurePiHost();
      migrateAgentConfiguration(getDatabase());
      await getModelRuntime().catch((error: unknown) =>
        console.error("Model configuration could not be loaded.", error),
      );
      boot();
    })
    .catch((error: unknown) => {
      console.error("Failed to boot Modus desktop.", error);
      app.exit(1);
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      boot();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    shutdownTerminals();
    void shutdownAgentRuntime()
      .catch((error) => console.error("Failed to close agent sessions.", error))
      .finally(() => app.quit());
  });
}
