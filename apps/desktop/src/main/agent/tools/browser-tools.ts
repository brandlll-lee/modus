import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { BROWSER_TOOL_NAMES, BROWSER_TOOL_UI, type BrowserToolName } from "../../../shared/tools";
import {
  closeBrowserTab,
  createBrowserTab,
  drainBrowserEvents,
  engageAgentBrowser,
  listBrowserTabs,
  selectBrowserTab,
  sendBrowserCdp,
  takeBrowserScreenshot,
  type BrowserOpTarget,
} from "../../browser/browser-service";
import { type ToolClassification, type ToolClassifier, toolRegistry } from "./registry";
import { resolveAgentToolContext } from "./tool-context";

const browserTargetParams = {
  viewId: Type.Optional(Type.String({ description: "Target browser tab id from browser_tabs." })),
};

function toResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

function targetFor(cwd: string, viewId: string | undefined): BrowserOpTarget {
  const context = resolveAgentToolContext(cwd);
  return {
    ...(viewId !== undefined ? { tabId: viewId } : {}),
    ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
  };
}

function browserControl(dangerous: boolean): ToolClassification {
  return { action: "browser.control", dangerous };
}

const classifyBrowserTool: ToolClassifier = (event) => {
  if (event.toolName === "browser_tabs") {
    return browserControl(event.input.action !== "list");
  }
  return browserControl(event.toolName === "browser_cdp");
};

const tabsParams = Type.Object({
  action: Type.Union([
    Type.Literal("list"),
    Type.Literal("new"),
    Type.Literal("close"),
    Type.Literal("select"),
  ]),
  viewId: Type.Optional(Type.String({ description: "Tab id for close/select." })),
  url: Type.Optional(Type.String({ description: "URL for new tab." })),
});

const tabsTool = defineTool({
  name: "browser_tabs",
  label: "Browser tabs",
  description:
    "List, create, close, or select Modus in-app browser tabs. Start browser work with browser_tabs({action:'list'}); create a tab if none exists.",
  promptSnippet: "browser_tabs(action, viewId?, url?) — list/new/close/select browser tabs.",
  promptGuidelines: [
    "Call browser_tabs({ action: 'list' }) before browser_cdp so you know the active viewId.",
    "Use browser_tabs({ action: 'new', url }) for a new page, or browser_cdp('Page.navigate', { url }) on an existing tab.",
  ],
  parameters: tabsParams,
  execute: async (_toolCallId, params: Static<typeof tabsParams>, _signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    if (params.action === "list") {
      const tabs = listBrowserTabs(context.workspaceId);
      return toResult(formatTabs(tabs), { tabs });
    }

    if (params.action === "new") {
      const tab = createBrowserTab(context.window, {
        workspaceId: context.workspaceId,
        ...(params.url !== undefined ? { url: params.url } : {}),
        select: true,
      });
      return toResult(`Created browser tab ${tab.id} (${tab.url}).`, { tab });
    }

    if (!params.viewId) {
      throw new Error("viewId is required for browser_tabs close/select.");
    }

    if (params.action === "close") {
      closeBrowserTab(params.viewId);
      return toResult(`Closed browser tab ${params.viewId}.`, { viewId: params.viewId });
    }

    const tab = selectBrowserTab(context.window, params.viewId);
    return toResult(`Selected browser tab ${tab.id} (${tab.url}).`, { tab });
  },
});

const cdpParams = Type.Object({
  ...browserTargetParams,
  method: Type.String({ description: 'Chrome DevTools Protocol method, e.g. "Page.navigate".' }),
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  sessionId: Type.Optional(
    Type.String({ description: "Optional CDP child session id, e.g. for an OOPIF target." }),
  ),
});

const cdpTool = defineTool({
  name: "browser_cdp",
  label: "Browser CDP",
  description:
    "Send a raw Chrome DevTools Protocol command to the Modus browser. Prefer official CDP methods directly: Page.navigate, Runtime.evaluate, DOM.querySelector, Input.dispatchMouseEvent, Network.*, Profiler.*, etc.",
  promptSnippet: "browser_cdp(method, params?, viewId?, sessionId?) — send raw CDP.",
  promptGuidelines: [
    "Use raw CDP strings and params; do not look for Modus-specific click/fill/scroll wrappers.",
    "For visible actions, browser_screenshot verifies pixels; browser_events drains recent CDP events.",
    "Use Page.navigate for navigation and Input.dispatchMouseEvent/Input.dispatchKeyEvent/Input.insertText for interaction.",
  ],
  parameters: cdpParams,
  execute: async (_toolCallId, params: Static<typeof cdpParams>, signal, _onUpdate, ctx) => {
    const target = targetFor(ctx.cwd, params.viewId);
    engageAgentBrowser(target);
    const result = await sendBrowserCdp(
      target,
      params.method,
      params.params ?? {},
      params.sessionId,
      signal,
    );
    return toResult(JSON.stringify(result ?? {}, null, 2), { result });
  },
});

const eventsTool = defineTool({
  name: "browser_events",
  label: "Browser events",
  description:
    "Drain recent raw CDP events for the target tab. Use after browser_cdp commands to inspect navigation, network, target, page, and runtime events.",
  promptSnippet: "browser_events(viewId?) — drain recent CDP events.",
  parameters: Type.Object(browserTargetParams),
  execute: async (_toolCallId, params: { viewId?: string }, _signal, _onUpdate, ctx) => {
    const target = targetFor(ctx.cwd, params.viewId);
    engageAgentBrowser(target);
    const events = drainBrowserEvents(target);
    return toResult(events.length ? JSON.stringify(events, null, 2) : "No browser events.", {
      events,
    });
  },
});

const screenshotTool = defineTool({
  name: "browser_screenshot",
  label: "Browser screenshot",
  description:
    "Capture the target tab as an image the model can inspect. Pixels are CSS pixels, suitable for coordinate clicks through browser_cdp Input.dispatchMouseEvent.",
  promptSnippet: "browser_screenshot(viewId?, fullPage?)",
  parameters: Type.Object({
    ...browserTargetParams,
    fullPage: Type.Optional(Type.Boolean({ description: "Capture the whole scrollable page." })),
  }),
  execute: async (
    _toolCallId,
    params: { viewId?: string; fullPage?: boolean },
    _signal,
    _onUpdate,
    ctx,
  ) => {
    const target = targetFor(ctx.cwd, params.viewId);
    engageAgentBrowser(target);
    const shot = await takeBrowserScreenshot({
      target,
      ...(params.fullPage !== undefined ? { fullPage: params.fullPage } : {}),
    });
    return {
      content: [
        {
          type: "text",
          text: `Screenshot ${shot.width}x${shot.height} (CSS px) saved to ${shot.path}.`,
        },
        { type: "image", data: shot.base64, mimeType: "image/png" },
      ],
      details: { path: shot.path, width: shot.width, height: shot.height },
    };
  },
});

const TOOL_DEFINITIONS: Record<BrowserToolName, ToolDefinition> = {
  browser_tabs: tabsTool,
  browser_cdp: cdpTool,
  browser_events: eventsTool,
  browser_screenshot: screenshotTool,
};

let registered = false;

export function registerBrowserTools(): void {
  if (registered) {
    return;
  }
  registered = true;

  for (const name of BROWSER_TOOL_NAMES) {
    toolRegistry.registerTool({
      entry: {
        name,
        profiles: ["chat"],
        permission: { danger: "dynamic" },
        capabilities: name === "browser_cdp" ? ["write", "network"] : ["read", "network"],
        ui: BROWSER_TOOL_UI[name],
      },
      definition: TOOL_DEFINITIONS[name],
      classify: classifyBrowserTool,
    });
  }
}

function formatTabs(tabs: Array<{ id: string; title: string; url: string }>): string {
  if (tabs.length === 0) {
    return "No browser tabs are open.";
  }

  return tabs.map((tab) => `- ${tab.id} ${tab.title}\n  ${tab.url}`).join("\n");
}
