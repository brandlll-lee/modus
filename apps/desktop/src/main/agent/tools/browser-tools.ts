import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { BROWSER_TOOL_NAMES, BROWSER_TOOL_UI, type BrowserToolName } from "../../../shared/tools";
import {
  type BrowserActionOutcome,
  type BrowserOpTarget,
  browserConsoleMessages,
  browserNetworkRequestDetail,
  browserNetworkRequests,
  clickBrowserRef,
  clickBrowserXY,
  closeBrowserTab,
  createBrowserTab,
  dragBrowserRefs,
  engageAgentBrowser,
  evaluateBrowser,
  fillBrowserRef,
  handleBrowserDialog,
  hoverBrowserRef,
  listBrowserTabs,
  navigateBrowser,
  navigateBrowserBack,
  pressBrowserKey,
  resizeBrowser,
  scrollBrowser,
  selectBrowserOption,
  selectBrowserTab,
  snapshotBrowser,
  startBrowserProfile,
  stopBrowserProfile,
  takeBrowserScreenshot,
  typeBrowserText,
  waitForBrowser,
} from "../../browser/browser-service";
import { type ToolClassification, type ToolClassifier, toolRegistry } from "./registry";
import { resolveAgentToolContext } from "./tool-context";

/**
 * Agent-facing browser tools.
 *
 * Semantics follow the de-facto agent-browser standard (playwright-mcp /
 * chrome-devtools-mcp): `browser_snapshot` returns an accessibility-tree
 * outline with `[ref=eN]` handles; interaction tools take a ref plus a
 * human-readable element description; action results report whether the page
 * navigated and can embed a fresh snapshot (`includeSnapshot`) so the agent
 * never has to act on a stale view of the page. Screenshots come back as
 * image content blocks the model can actually see, in CSS pixels that match
 * `browser_click_xy` coordinates.
 */

const browserTargetParams = {
  viewId: Type.Optional(Type.String({ description: "Target browser tab id from browser_tabs." })),
};

const includeSnapshotParam = (defaultOn: boolean) =>
  Type.Optional(
    Type.Boolean({
      description: `Append a fresh page snapshot to the result (default ${defaultOn}). Turn on after actions that change the page; turn off to save tokens.`,
    }),
  );

const refActionParams = {
  ...browserTargetParams,
  element: Type.String({ description: "Human-readable element label from the snapshot." }),
  ref: Type.String({ description: "Element ref (e.g. e12) from the latest browser_snapshot." }),
};

type ToolTarget = {
  viewId?: string;
};

function toResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

function contextForCwd(cwd: string) {
  return resolveAgentToolContext(cwd);
}

/** Build the service-layer target: explicit tab id, else the workspace's active tab. */
function targetFor(cwd: string, viewId: string | undefined): BrowserOpTarget {
  const context = contextForCwd(cwd);
  return {
    ...(viewId !== undefined ? { tabId: viewId } : {}),
    ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
  };
}

/** Render an action outcome (navigation + auto-handled dialogs + snapshot). */
async function actionResultText(
  label: string,
  outcome: BrowserActionOutcome,
  includeSnapshot: boolean,
): Promise<string> {
  const lines: string[] = [label];
  if (outcome.pageChanged) {
    lines.push(`Page changed: ${outcome.tab.url} — "${outcome.tab.title}"`);
  }
  for (const dialog of outcome.dialogs) {
    lines.push(
      `A JavaScript ${dialog.type} dialog appeared ("${dialog.message}") and was handled: ${dialog.handledWith}.`,
    );
  }
  if (includeSnapshot) {
    const snapshot = await snapshotBrowser({ tabId: outcome.tab.id });
    lines.push("", "## Page snapshot", snapshot.text);
  } else if (outcome.pageChanged) {
    lines.push("Take browser_snapshot before the next element interaction — old refs are stale.");
  }
  return lines.join("\n");
}

function browserControl(dangerous: boolean): ToolClassification {
  return { action: "browser.control", dangerous };
}

const READ_ONLY_BROWSER_TOOLS = new Set<string>([
  "browser_snapshot",
  "browser_take_screenshot",
  "browser_console_messages",
  "browser_network_requests",
  "browser_network_request",
  "browser_wait_for",
  "browser_profile_start",
  "browser_profile_stop",
]);

const classifyBrowserTool: ToolClassifier = (event) => {
  if (event.toolName === "browser_tabs") {
    return browserControl(event.input.action !== "list");
  }
  if (event.toolName === "browser_evaluate") {
    return browserControl(true);
  }
  return browserControl(!READ_ONLY_BROWSER_TOOLS.has(event.toolName));
};

/* ── Tabs / navigation ────────────────────────────────────────────────── */

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
    "List, create, close, or select tabs in the Modus in-app browser. Start browser tasks with browser_tabs({action:'list'}).",
  promptSnippet: "browser_tabs(action, viewId?, url?) — list/new/close/select browser tabs.",
  promptGuidelines: [
    "Always call browser_tabs({ action: 'list' }) before starting a browser task.",
    "Use the returned viewId for later browser tool calls.",
  ],
  parameters: tabsParams,
  execute: async (_toolCallId, params: Static<typeof tabsParams>, _signal, _onUpdate, ctx) => {
    const context = contextForCwd(ctx.cwd);
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

const navigateParams = Type.Object({
  ...browserTargetParams,
  url: Type.String({ description: "URL or search text to open." }),
  newTab: Type.Optional(Type.Boolean({ description: "Open in a new tab." })),
  includeSnapshot: includeSnapshotParam(true),
});

const navigateTool = defineTool({
  name: "browser_navigate",
  label: "Navigate browser",
  description:
    "Navigate the in-app browser to a URL and wait for the page to load. Returns a page snapshot by default.",
  promptSnippet: "browser_navigate(url, viewId?, newTab?, includeSnapshot?)",
  parameters: navigateParams,
  execute: async (_toolCallId, params: Static<typeof navigateParams>, _signal, _onUpdate, ctx) => {
    const context = contextForCwd(ctx.cwd);
    const tab = await navigateBrowser({
      ...(context.window ? { window: context.window } : {}),
      workspaceId: context.workspaceId,
      ...(params.viewId !== undefined ? { tabId: params.viewId } : {}),
      url: params.url,
      newTab: params.newTab ?? false,
      agentInitiated: true,
    });
    const lines = [`Navigated to ${tab.url} — "${tab.title}".`];
    if (params.includeSnapshot !== false) {
      const snapshot = await snapshotBrowser({ tabId: tab.id });
      lines.push("", "## Page snapshot", snapshot.text);
    }
    return toResult(lines.join("\n"), { tab });
  },
});

const navigateBackTool = defineTool({
  name: "browser_navigate_back",
  label: "Browser back",
  description: "Navigate the target browser tab back in history.",
  promptSnippet: "browser_navigate_back(viewId?)",
  parameters: Type.Object(browserTargetParams),
  execute: async (_toolCallId, params: ToolTarget, _signal, _onUpdate, ctx) => {
    const tab = navigateBrowserBack(targetFor(ctx.cwd, params.viewId));
    return toResult(`Went back to ${tab.url}.`, { tab });
  },
});

/* ── Observation ──────────────────────────────────────────────────────── */

const snapshotParams = Type.Object({
  ...browserTargetParams,
  maxLines: Type.Optional(
    Type.Number({ description: "Token budget: maximum snapshot lines (default 1200)." }),
  ),
});

const snapshotTool = defineTool({
  name: "browser_snapshot",
  label: "Browser snapshot",
  description:
    "Accessibility-tree snapshot of the page (pierces shadow DOM and iframes) with [ref=eN] handles for interaction tools. Refs go stale after navigation.",
  promptSnippet: "browser_snapshot(viewId?) — get page structure + refs before interacting.",
  promptGuidelines: [
    "Call browser_snapshot before browser_click / browser_fill / browser_type / browser_select_option / browser_hover / browser_drag.",
    "If a tool reports a stale ref, take a fresh browser_snapshot and retry with the new ref.",
  ],
  parameters: snapshotParams,
  execute: async (_toolCallId, params: Static<typeof snapshotParams>, _signal, _onUpdate, ctx) => {
    const result = await snapshotBrowser(targetFor(ctx.cwd, params.viewId), {
      ...(params.maxLines !== undefined ? { maxLines: params.maxLines } : {}),
    });
    return toResult(result.text, {
      tab: result.tab,
      refCount: result.refCount,
      truncated: result.truncated,
    });
  },
});

const screenshotParams = Type.Object({
  ...browserTargetParams,
  fullPage: Type.Optional(
    Type.Boolean({ description: "Capture the entire scrollable page, not just the viewport." }),
  ),
});

const screenshotTool = defineTool({
  name: "browser_take_screenshot",
  label: "Browser screenshot",
  description:
    "Screenshot the page and return it as an image the model can see (CSS pixels — coordinates match browser_click_xy). Also saves a PNG and returns its path.",
  promptSnippet: "browser_take_screenshot(viewId?, fullPage?)",
  parameters: screenshotParams,
  execute: async (
    _toolCallId,
    params: Static<typeof screenshotParams>,
    _signal,
    _onUpdate,
    ctx,
  ) => {
    const shot = await takeBrowserScreenshot({
      target: targetFor(ctx.cwd, params.viewId),
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

/* ── Element interaction ──────────────────────────────────────────────── */

const clickParams = Type.Object({
  ...refActionParams,
  doubleClick: Type.Optional(Type.Boolean()),
  button: Type.Optional(
    Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")]),
  ),
  modifiers: Type.Optional(
    Type.Array(Type.String({ description: "Control | Shift | Alt | Meta" })),
  ),
  includeSnapshot: includeSnapshotParam(true),
});

const clickTool = defineTool({
  name: "browser_click",
  label: "Browser click",
  description:
    "Click an element by ref using trusted input. Verifies the element is visible, stable, and not covered (reports the covering element otherwise).",
  promptSnippet: "browser_click(element, ref, viewId?, doubleClick?, button?, modifiers?)",
  parameters: clickParams,
  execute: async (_toolCallId, params: Static<typeof clickParams>, _signal, _onUpdate, ctx) => {
    const outcome = await clickBrowserRef(targetFor(ctx.cwd, params.viewId), params.ref, {
      ...(params.button !== undefined ? { button: params.button } : {}),
      ...(params.doubleClick !== undefined ? { doubleClick: params.doubleClick } : {}),
      ...(params.modifiers !== undefined ? { modifiers: params.modifiers } : {}),
    });
    const text = await actionResultText(
      `Clicked ${params.element}.`,
      outcome,
      params.includeSnapshot !== false,
    );
    return toResult(text, { ref: params.ref, tab: outcome.tab, pageChanged: outcome.pageChanged });
  },
});

const clickXyParams = Type.Object({
  ...browserTargetParams,
  x: Type.Number({ description: "Viewport X in CSS pixels (matches screenshot pixels)." }),
  y: Type.Number({ description: "Viewport Y in CSS pixels (matches screenshot pixels)." }),
  includeSnapshot: includeSnapshotParam(false),
});

const clickXyTool = defineTool({
  name: "browser_click_xy",
  label: "Browser coordinate click",
  description:
    "Click a viewport coordinate (CSS pixels, same scale as browser_take_screenshot). Prefer browser_click with a ref when possible.",
  promptSnippet: "browser_click_xy(x, y, viewId?)",
  parameters: clickXyParams,
  execute: async (_toolCallId, params: Static<typeof clickXyParams>, _signal, _onUpdate, ctx) => {
    const outcome = await clickBrowserXY(targetFor(ctx.cwd, params.viewId), params.x, params.y);
    const text = await actionResultText(
      `Clicked at (${params.x}, ${params.y}).`,
      outcome,
      params.includeSnapshot === true,
    );
    return toResult(text, { x: params.x, y: params.y, pageChanged: outcome.pageChanged });
  },
});

const hoverTool = defineTool({
  name: "browser_hover",
  label: "Browser hover",
  description: "Hover an element by ref (trusted mouse move; triggers CSS hover and menus).",
  promptSnippet: "browser_hover(element, ref, viewId?)",
  parameters: Type.Object({
    ...refActionParams,
    includeSnapshot: includeSnapshotParam(false),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
    const outcome = await hoverBrowserRef(targetFor(ctx.cwd, params.viewId), params.ref);
    const text = await actionResultText(
      `Hovered ${params.element}.`,
      outcome,
      params.includeSnapshot === true,
    );
    return toResult(text, { ref: params.ref });
  },
});

const dragParams = Type.Object({
  ...browserTargetParams,
  startElement: Type.String({ description: "Source element label." }),
  startRef: Type.String({ description: "Source element ref." }),
  endElement: Type.String({ description: "Target element label." }),
  endRef: Type.String({ description: "Target element ref." }),
  includeSnapshot: includeSnapshotParam(true),
});

const dragTool = defineTool({
  name: "browser_drag",
  label: "Browser drag",
  description: "Drag from one element to another using trusted mouse events with movement steps.",
  promptSnippet: "browser_drag(startElement, startRef, endElement, endRef, viewId?)",
  parameters: dragParams,
  execute: async (_toolCallId, params: Static<typeof dragParams>, _signal, _onUpdate, ctx) => {
    const outcome = await dragBrowserRefs(
      targetFor(ctx.cwd, params.viewId),
      params.startRef,
      params.endRef,
    );
    const text = await actionResultText(
      `Dragged ${params.startElement} to ${params.endElement}.`,
      outcome,
      params.includeSnapshot !== false,
    );
    return toResult(text, { startRef: params.startRef, endRef: params.endRef });
  },
});

const fillParams = Type.Object({
  ...refActionParams,
  value: Type.String(),
  includeSnapshot: includeSnapshotParam(false),
});

const fillTool = defineTool({
  name: "browser_fill",
  label: "Browser fill",
  description:
    "Replace the contents of an input/textarea/contenteditable by ref (trusted insert; fires real input events).",
  promptSnippet: "browser_fill(element, ref, value, viewId?)",
  parameters: fillParams,
  execute: async (_toolCallId, params: Static<typeof fillParams>, _signal, _onUpdate, ctx) => {
    const outcome = await fillBrowserRef(
      targetFor(ctx.cwd, params.viewId),
      params.ref,
      params.value,
    );
    const text = await actionResultText(
      `Filled ${params.element}.`,
      outcome,
      params.includeSnapshot === true,
    );
    return toResult(text, { ref: params.ref });
  },
});

const typeParams = Type.Object({
  ...browserTargetParams,
  element: Type.Optional(Type.String({ description: "Element label (when ref is provided)." })),
  ref: Type.Optional(
    Type.String({ description: "Element to focus first; omit to type into the focused element." }),
  ),
  text: Type.String(),
  submit: Type.Optional(Type.Boolean({ description: "Press Enter after typing." })),
  includeSnapshot: includeSnapshotParam(false),
});

const typeTool = defineTool({
  name: "browser_type",
  label: "Browser type",
  description:
    "Type text key-by-key with trusted keyboard events (appends at the caret). Use browser_fill to replace a field's value.",
  promptSnippet: "browser_type(text, ref?, submit?, viewId?)",
  parameters: typeParams,
  execute: async (_toolCallId, params: Static<typeof typeParams>, _signal, _onUpdate, ctx) => {
    const outcome = await typeBrowserText(
      targetFor(ctx.cwd, params.viewId),
      params.ref,
      params.text,
      {
        ...(params.submit !== undefined ? { submit: params.submit } : {}),
      },
    );
    const text = await actionResultText(
      `Typed into ${params.element ?? "the focused element"}.`,
      outcome,
      params.includeSnapshot === true,
    );
    return toResult(text, { ref: params.ref ?? null });
  },
});

const fillFormParams = Type.Object({
  ...browserTargetParams,
  fields: Type.Array(
    Type.Object({
      element: Type.String(),
      ref: Type.String(),
      value: Type.String(),
    }),
    { description: "Fields to fill, in order." },
  ),
  includeSnapshot: includeSnapshotParam(true),
});

const fillFormTool = defineTool({
  name: "browser_fill_form",
  label: "Browser fill form",
  description: "Fill multiple form fields in one call (refs from the latest browser_snapshot).",
  promptSnippet: "browser_fill_form(fields, viewId?)",
  parameters: fillFormParams,
  execute: async (_toolCallId, params: Static<typeof fillFormParams>, _signal, _onUpdate, ctx) => {
    const target = targetFor(ctx.cwd, params.viewId);
    let lastOutcome: BrowserActionOutcome | undefined;
    for (const field of params.fields) {
      lastOutcome = await fillBrowserRef(target, field.ref, field.value);
    }
    const label = `Filled ${params.fields.length} field(s).`;
    const text = lastOutcome
      ? await actionResultText(label, lastOutcome, params.includeSnapshot !== false)
      : label;
    return toResult(text, { count: params.fields.length });
  },
});

const selectOptionParams = Type.Object({
  ...refActionParams,
  values: Type.Array(Type.String(), {
    description: "Option values/labels/visible text to select (multiple for multi-select).",
  }),
  includeSnapshot: includeSnapshotParam(false),
});

const selectOptionTool = defineTool({
  name: "browser_select_option",
  label: "Browser select option",
  description: "Select option(s) in a <select> element by value, label, or visible text.",
  promptSnippet: "browser_select_option(element, ref, values, viewId?)",
  parameters: selectOptionParams,
  execute: async (
    _toolCallId,
    params: Static<typeof selectOptionParams>,
    _signal,
    _onUpdate,
    ctx,
  ) => {
    const result = await selectBrowserOption(
      targetFor(ctx.cwd, params.viewId),
      params.ref,
      params.values,
    );
    if (result.selected.length === 0) {
      throw new Error(
        `No <option> matched ${JSON.stringify(params.values)} in ${params.element}. Check the snapshot for available options.`,
      );
    }
    const text = await actionResultText(
      `Selected ${result.selected.join(", ")} in ${params.element}.`,
      result,
      params.includeSnapshot === true,
    );
    return toResult(text, { ref: params.ref, selected: result.selected });
  },
});

const pressKeyParams = Type.Object({
  ...browserTargetParams,
  key: Type.String({
    description: 'Key or combination, e.g. "Enter", "Escape", "ArrowDown", "Control+A".',
  }),
  includeSnapshot: includeSnapshotParam(false),
});

const pressKeyTool = defineTool({
  name: "browser_press_key",
  label: "Browser press key",
  description: "Press a key or key combination with trusted keyboard events.",
  promptSnippet: "browser_press_key(key, viewId?)",
  parameters: pressKeyParams,
  execute: async (_toolCallId, params: Static<typeof pressKeyParams>, _signal, _onUpdate, ctx) => {
    const outcome = await pressBrowserKey(targetFor(ctx.cwd, params.viewId), params.key);
    const text = await actionResultText(
      `Pressed ${params.key}.`,
      outcome,
      params.includeSnapshot === true,
    );
    return toResult(text, { key: params.key });
  },
});

const scrollParams = Type.Object({
  ...browserTargetParams,
  ref: Type.Optional(
    Type.String({ description: "Scroll the container under this element; omit for the page." }),
  ),
  deltaX: Type.Optional(Type.Number({ description: "Horizontal scroll in CSS px." })),
  deltaY: Type.Optional(
    Type.Number({ description: "Vertical scroll in CSS px (positive = down, default 600)." }),
  ),
  includeSnapshot: includeSnapshotParam(false),
});

const scrollTool = defineTool({
  name: "browser_scroll",
  label: "Browser scroll",
  description:
    "Scroll the page (or the scrollable container under an element) with a trusted wheel event.",
  promptSnippet: "browser_scroll(viewId?, ref?, deltaX?, deltaY?)",
  parameters: scrollParams,
  execute: async (_toolCallId, params: Static<typeof scrollParams>, _signal, _onUpdate, ctx) => {
    const outcome = await scrollBrowser({
      target: targetFor(ctx.cwd, params.viewId),
      ...(params.ref !== undefined ? { ref: params.ref } : {}),
      ...(params.deltaX !== undefined ? { deltaX: params.deltaX } : {}),
      ...(params.deltaY !== undefined ? { deltaY: params.deltaY } : {}),
    });
    const text = await actionResultText("Scrolled.", outcome, params.includeSnapshot === true);
    return toResult(text, { deltaX: params.deltaX ?? 0, deltaY: params.deltaY ?? 600 });
  },
});

/* ── Waiting / dialogs ────────────────────────────────────────────────── */

const waitForParams = Type.Object({
  ...browserTargetParams,
  text: Type.Optional(Type.String({ description: "Wait until this text appears." })),
  textGone: Type.Optional(Type.String({ description: "Wait until this text disappears." })),
  time_ms: Type.Optional(Type.Number({ description: "Plain wait / timeout in milliseconds." })),
});

const waitForTool = defineTool({
  name: "browser_wait_for",
  label: "Browser wait",
  description: "Wait for text to appear/disappear, or for a fixed time.",
  promptSnippet: "browser_wait_for(text? | textGone? | time_ms?, viewId?)",
  parameters: waitForParams,
  execute: async (_toolCallId, params: Static<typeof waitForParams>, _signal, _onUpdate, ctx) => {
    const message = await waitForBrowser({
      target: targetFor(ctx.cwd, params.viewId),
      ...(params.text !== undefined ? { text: params.text } : {}),
      ...(params.textGone !== undefined ? { textGone: params.textGone } : {}),
      ...(params.time_ms !== undefined ? { timeMs: params.time_ms } : {}),
    });
    return toResult(message, { message });
  },
});

const handleDialogParams = Type.Object({
  ...browserTargetParams,
  accept: Type.Boolean({ description: "Accept (OK) or dismiss (Cancel) the next dialog." }),
  promptText: Type.Optional(Type.String({ description: "Text to enter for prompt() dialogs." })),
});

const handleDialogTool = defineTool({
  name: "browser_handle_dialog",
  label: "Browser dialog",
  description:
    "Arm the policy for the NEXT JavaScript dialog (alert/confirm/prompt/beforeunload). Call this BEFORE the action that triggers the dialog; unarmed dialogs are auto-dismissed so the page never hangs.",
  promptSnippet: "browser_handle_dialog(accept, promptText?, viewId?)",
  parameters: handleDialogParams,
  execute: async (
    _toolCallId,
    params: Static<typeof handleDialogParams>,
    _signal,
    _onUpdate,
    ctx,
  ) => {
    const result = handleBrowserDialog(targetFor(ctx.cwd, params.viewId), {
      accept: params.accept,
      ...(params.promptText !== undefined ? { promptText: params.promptText } : {}),
    });
    const lines = [
      `Armed dialog policy: ${params.accept ? "accept" : "dismiss"}${params.promptText !== undefined ? ` with prompt text "${params.promptText}"` : ""}. It applies to the next dialog.`,
    ];
    if (result.lastDialog) {
      lines.push(
        `Last dialog seen: ${result.lastDialog.type} "${result.lastDialog.message}" (${result.lastDialog.handledWith} at ${result.lastDialog.at}).`,
      );
    }
    return toResult(lines.join("\n"), result);
  },
});

/* ── Diagnostics ──────────────────────────────────────────────────────── */

const consoleParams = Type.Object({
  ...browserTargetParams,
  level: Type.Optional(
    Type.Union(
      [Type.Literal("debug"), Type.Literal("info"), Type.Literal("warning"), Type.Literal("error")],
      { description: "Only return messages at this level." },
    ),
  ),
});

const consoleTool = defineTool({
  name: "browser_console_messages",
  label: "Browser console messages",
  description: "Read recent console messages from the target browser tab (optionally by level).",
  promptSnippet: "browser_console_messages(viewId?, level?)",
  parameters: consoleParams,
  execute: async (_toolCallId, params: Static<typeof consoleParams>, _signal, _onUpdate, ctx) => {
    const messages = browserConsoleMessages(targetFor(ctx.cwd, params.viewId), {
      ...(params.level !== undefined ? { level: params.level } : {}),
    });
    return toResult(
      messages.length
        ? messages.map((message) => `${message.level}: ${message.text}`).join("\n")
        : "No console messages.",
      { messages },
    );
  },
});

const networkListParams = Type.Object({
  ...browserTargetParams,
  urlContains: Type.Optional(Type.String({ description: "Substring filter on the URL." })),
  failedOnly: Type.Optional(Type.Boolean({ description: "Only failed / 4xx-5xx requests." })),
  limit: Type.Optional(Type.Number({ description: "Max entries (default 80)." })),
});

const networkTool = defineTool({
  name: "browser_network_requests",
  label: "Browser network requests",
  description:
    "List recent network requests. Each line starts with the request id usable with browser_network_request.",
  promptSnippet: "browser_network_requests(viewId?, urlContains?, failedOnly?, limit?)",
  parameters: networkListParams,
  execute: async (
    _toolCallId,
    params: Static<typeof networkListParams>,
    _signal,
    _onUpdate,
    ctx,
  ) => {
    const requests = browserNetworkRequests(targetFor(ctx.cwd, params.viewId), {
      ...(params.urlContains !== undefined ? { urlContains: params.urlContains } : {}),
      ...(params.failedOnly !== undefined ? { failedOnly: params.failedOnly } : {}),
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
    });
    return toResult(
      requests.length
        ? requests
            .map(
              (request) =>
                `${request.id} ${request.failed ? "FAILED" : (request.status ?? "…")} ${request.method} ${request.url}${request.errorText ? ` (${request.errorText})` : ""}`,
            )
            .join("\n")
        : "No network requests captured.",
      { requests },
    );
  },
});

const networkDetailParams = Type.Object({
  ...browserTargetParams,
  requestId: Type.String({ description: "Request id from browser_network_requests." }),
});

const networkDetailTool = defineTool({
  name: "browser_network_request",
  label: "Browser network request",
  description: "Inspect a single captured network request by id.",
  promptSnippet: "browser_network_request(requestId, viewId?)",
  parameters: networkDetailParams,
  execute: async (
    _toolCallId,
    params: Static<typeof networkDetailParams>,
    _signal,
    _onUpdate,
    ctx,
  ) => {
    const request = browserNetworkRequestDetail(
      targetFor(ctx.cwd, params.viewId),
      params.requestId,
    );
    return toResult(JSON.stringify(request, null, 2), { request });
  },
});

/* ── Viewport / evaluate / profiling ──────────────────────────────────── */

const resizeParams = Type.Object({
  ...browserTargetParams,
  width: Type.Number(),
  height: Type.Number(),
});

const resizeTool = defineTool({
  name: "browser_resize",
  label: "Browser resize",
  description:
    "Emulate a viewport size (device-metrics override) for responsive testing. Does not move the native view.",
  promptSnippet: "browser_resize(width, height, viewId?)",
  parameters: resizeParams,
  execute: async (_toolCallId, params: Static<typeof resizeParams>, _signal, _onUpdate, ctx) => {
    const tab = await resizeBrowser(targetFor(ctx.cwd, params.viewId), params.width, params.height);
    return toResult(`Viewport emulating ${params.width}x${params.height}.`, { tab });
  },
});

const evaluateParams = Type.Object({
  ...browserTargetParams,
  expression: Type.String({
    description: "JavaScript expression to evaluate in the page (await-able).",
  }),
});

const evaluateTool = defineTool({
  name: "browser_evaluate",
  label: "Browser evaluate",
  description:
    "Evaluate a JavaScript expression in the page and return its JSON value. Use sparingly — prefer snapshot/click tools for interaction.",
  promptSnippet: "browser_evaluate(expression, viewId?)",
  parameters: evaluateParams,
  execute: async (_toolCallId, params: Static<typeof evaluateParams>, _signal, _onUpdate, ctx) => {
    const value = await evaluateBrowser(targetFor(ctx.cwd, params.viewId), params.expression);
    return toResult(value, { value });
  },
});

const profileStartTool = defineTool({
  name: "browser_profile_start",
  label: "Browser profile start",
  description: "Start CPU profiling for the target browser tab.",
  promptSnippet: "browser_profile_start(viewId?)",
  parameters: Type.Object(browserTargetParams),
  execute: async (_toolCallId, params: ToolTarget, _signal, _onUpdate, ctx) => {
    await startBrowserProfile(targetFor(ctx.cwd, params.viewId));
    return toResult("Browser CPU profile started.", {});
  },
});

const profileStopTool = defineTool({
  name: "browser_profile_stop",
  label: "Browser profile stop",
  description: "Stop CPU profiling and return the saved raw profile and summary paths.",
  promptSnippet: "browser_profile_stop(viewId?)",
  parameters: Type.Object(browserTargetParams),
  execute: async (_toolCallId, params: ToolTarget, _signal, _onUpdate, ctx) => {
    const profile = await stopBrowserProfile(targetFor(ctx.cwd, params.viewId));
    return toResult(`Profile saved to ${profile.rawPath}.`, profile);
  },
});

/* ── Registration ─────────────────────────────────────────────────────── */

const TOOL_DEFINITIONS: Record<BrowserToolName, ToolDefinition> = {
  browser_tabs: tabsTool,
  browser_navigate: navigateTool,
  browser_navigate_back: navigateBackTool,
  browser_snapshot: snapshotTool,
  browser_take_screenshot: screenshotTool,
  browser_click: clickTool,
  browser_click_xy: clickXyTool,
  browser_hover: hoverTool,
  browser_drag: dragTool,
  browser_fill: fillTool,
  browser_type: typeTool,
  browser_fill_form: fillFormTool,
  browser_select_option: selectOptionTool,
  browser_scroll: scrollTool,
  browser_wait_for: waitForTool,
  browser_console_messages: consoleTool,
  browser_network_requests: networkTool,
  browser_network_request: networkDetailTool,
  browser_resize: resizeTool,
  browser_press_key: pressKeyTool,
  browser_handle_dialog: handleDialogTool,
  browser_evaluate: evaluateTool,
  browser_profile_start: profileStartTool,
  browser_profile_stop: profileStopTool,
};

let registered = false;

/**
 * Wrap a browser tool so invoking ANY of them (even read-only snapshot/console)
 * lights the AI cursor + glow immediately; the run lifecycle releases it. Done
 * once at registration so all 24 tools share it instead of per-tool engage calls.
 */
function withAgentPresence(definition: ToolDefinition): ToolDefinition {
  const execute = definition.execute;
  if (typeof execute !== "function") {
    return definition;
  }
  return {
    ...definition,
    execute: (...args: Parameters<typeof execute>) => {
      const params = args[1] as { viewId?: string } | undefined;
      const ctx = args[4] as { cwd?: string } | undefined;
      if (ctx?.cwd) {
        engageAgentBrowser(targetFor(ctx.cwd, params?.viewId));
      }
      return execute(...args);
    },
  };
}

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
        ui: BROWSER_TOOL_UI[name],
      },
      definition: withAgentPresence(TOOL_DEFINITIONS[name]),
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
