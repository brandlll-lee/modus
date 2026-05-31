import { app, BrowserWindow } from "electron";
import { registerAppIpc } from "./ipc/register-app-ipc";
import { createMainWindow } from "./windows/main-window";

let mainWindow: BrowserWindow | null = null;

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
}
