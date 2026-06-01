import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, shell } from "electron";
import { IPC_CHANNELS } from "../ipc/channels";

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
    backgroundColor: "#131314",
    show: false,
    // 彻底放弃 Windows native window controls overlay —— 它的 caption buttons 绘制 + hover 命中区
    // 由系统决定，不严格遵循 titleBarOverlay.height，会"伸出" menubar。
    // 改用 frame: false 完全自绘 titlebar：renderer 内 MenuBar + WindowControls，通过 IPC 调
    // win.minimize / win.maximize / win.unmaximize / win.close。
    // thickFrame: true（默认）保留 Windows 的 resize handle 与窗口阴影。
    frame: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // 把 maximize/unmaximize 状态推送给 renderer，用于切换 max/restore 按钮图标
  const sendState = (): void => {
    if (window.isDestroyed()) {
      return;
    }
    window.webContents.send(IPC_CHANNELS.windowStateEvent, {
      maximized: window.isMaximized(),
    });
  };
  window.on("maximize", sendState);
  window.on("unmaximize", sendState);

  window.once("ready-to-show", () => {
    window.show();
    sendState();
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
