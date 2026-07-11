import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, screen, type BrowserWindow as BrowserWindowType, shell } from "electron";
import { IPC_CHANNELS } from "../ipc/channels";
import type { StartupTimeline } from "../startup/startup-timeline";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const EXTERNAL_PROTOCOLS = new Set(["https:", "http:"]);
const appIconPath = app.isPackaged
  ? join(process.resourcesPath, "icon.png")
  : join(currentDir, "../../resources/icon.png");

function isExternalUrlAllowed(rawUrl: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

export function createMainWindow({
  startupTimeline,
}: {
  startupTimeline: StartupTimeline;
}): BrowserWindowType {
  const preloadPath = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = Math.min(1180, workArea.width);
  const height = Math.min(760, workArea.height);

  const window = new BrowserWindow({
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
    minWidth: Math.min(1120, width),
    minHeight: Math.min(720, height),
    title: "Modus",
    icon: appIconPath,
    backgroundColor: "#131314",
    show: true,
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
  startupTimeline.mark("main.window-created");

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

  window.webContents.once("dom-ready", () => {
    startupTimeline.mark("main.dom-ready");
  });

  window.once("ready-to-show", () => {
    startupTimeline.mark("main.ready-to-show");
    sendState();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrlAllowed(url)) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    window.webContents.on("console-message", (event) => {
      console.log(`[renderer:${event.level}] ${event.message}`);
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
