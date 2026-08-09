import { app, BrowserWindow, type BrowserWindow as BrowserWindowType } from "electron";
import { startRemoteModelCatalog, stopRemoteModelCatalog } from "./agent/model-service";
import { IPC_CHANNELS } from "./ipc/channels";
import { registerAppIpc } from "./ipc/register-app-ipc";
import { disposeAllMcp } from "./mcp/mcp-service";
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
    .then(() => {
      startupTimeline.mark("main.electron-ready");
      startRemoteModelCatalog(() => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send(IPC_CHANNELS.modelCatalogChanged);
        }
      });
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

  // Close MCP transports on quit so stdio servers never outlive the app.
  app.on("before-quit", () => {
    stopRemoteModelCatalog();
    shutdownTerminals();
    void disposeAllMcp();
  });
}
