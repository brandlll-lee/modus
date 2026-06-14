import { app, BrowserWindow, type BrowserWindow as BrowserWindowType } from "electron";
import { registerAppIpc } from "./ipc/register-app-ipc";
import { disposeAllMcp } from "./mcp/mcp-service";
import { createMainWindow } from "./windows/main-window";

let mainWindow: BrowserWindowType | null = null;

function boot(): void {
  registerAppIpc();

  mainWindow = createMainWindow();

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
    .then(boot)
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
    void disposeAllMcp();
  });
}
