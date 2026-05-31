import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, shell } from "electron";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const EXTERNAL_PROTOCOLS = new Set(["https:", "http:"]);

function isExternalUrlAllowed(rawUrl: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

export function createMainWindow(): BrowserWindow {
  const preloadPath = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    title: "Modus",
    backgroundColor: "#09090b",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrlAllowed(url)) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    window.webContents.on("console-message", (_event, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
      console.error("[renderer:did-fail-load]", errorCode, errorDescription, validatedUrl);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      console.error("[renderer:gone]", details);
    });
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(currentDir, "../renderer/index.html"));
  }

  return window;
}
