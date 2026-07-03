import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerBrowserTools } from "./browser-tools";
import { toolRegistry } from "./registry";

const mocks = vi.hoisted(() => ({
  closeBrowserTab: vi.fn(),
  createBrowserTab: vi.fn(),
  drainBrowserEvents: vi.fn(),
  engageAgentBrowser: vi.fn(),
  listBrowserTabs: vi.fn(),
  selectBrowserTab: vi.fn(),
  sendBrowserCdp: vi.fn(),
  takeBrowserScreenshot: vi.fn(),
}));

vi.mock("../../browser/browser-service", () => mocks);

vi.mock("./tool-context", () => ({
  resolveAgentToolContext: () => ({ workspaceId: "workspace-1", cwd: "C:/repo" }),
}));

function loadTool(name: string) {
  registerBrowserTools();
  const tool = toolRegistry.getCustomToolDefinitions("chat").find((definition) => {
    return definition.name === name;
  });
  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }
  return tool;
}

type BrowserTool = ReturnType<typeof loadTool>;
type BrowserToolExecute = NonNullable<BrowserTool["execute"]>;

function toolCtx(): Parameters<BrowserToolExecute>[4] {
  return { cwd: "C:/repo" } as Parameters<BrowserToolExecute>[4];
}

describe("browser agent tools", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
  });

  it("passes raw CDP method, params, target, and session id through", async () => {
    mocks.sendBrowserCdp.mockResolvedValueOnce({ result: { value: 2 } });
    const tool = loadTool("browser_cdp");

    const result = await tool.execute?.(
      "call-1",
      {
        viewId: "tab-1",
        method: "Runtime.evaluate",
        params: { expression: "1 + 1" },
        sessionId: "child",
      },
      undefined,
      undefined,
      toolCtx(),
    );

    expect(mocks.sendBrowserCdp).toHaveBeenCalledWith(
      { workspaceId: "workspace-1", tabId: "tab-1" },
      "Runtime.evaluate",
      { expression: "1 + 1" },
      "child",
      undefined,
    );
    expect(result?.content).toEqual([
      { type: "text", text: '{\n  "result": {\n    "value": 2\n  }\n}' },
    ]);
  });

  it("does not swallow CDP errors", async () => {
    mocks.sendBrowserCdp.mockRejectedValueOnce(new Error("CDP failed"));
    const tool = loadTool("browser_cdp");

    await expect(
      tool.execute?.(
        "call-1",
        { method: "Runtime.evaluate", params: { expression: "throw new Error()" } },
        new AbortController().signal,
        undefined,
        toolCtx(),
      ),
    ).rejects.toThrow("CDP failed");
  });

  it("drains browser events once", async () => {
    mocks.drainBrowserEvents
      .mockReturnValueOnce([{ method: "Page.loadEventFired", params: {}, at: "now" }])
      .mockReturnValueOnce([]);
    const tool = loadTool("browser_events");

    const first = await tool.execute?.(
      "call-1",
      { viewId: "tab-1" },
      undefined,
      undefined,
      toolCtx(),
    );
    const second = await tool.execute?.(
      "call-2",
      { viewId: "tab-1" },
      undefined,
      undefined,
      toolCtx(),
    );

    expect(first?.content[0]).toEqual(
      expect.objectContaining({ text: expect.stringContaining("Page.loadEventFired") }),
    );
    expect(second?.content).toEqual([{ type: "text", text: "No browser events." }]);
  });

  it("returns screenshot pixels as an image block", async () => {
    mocks.takeBrowserScreenshot.mockResolvedValueOnce({
      path: "C:/tmp/shot.png",
      width: 800,
      height: 600,
      base64: "abc",
    });
    const tool = loadTool("browser_screenshot");

    const result = await tool.execute?.(
      "call-1",
      { viewId: "tab-1" },
      undefined,
      undefined,
      toolCtx(),
    );

    expect(result?.content).toEqual([
      { type: "text", text: "Screenshot 800x600 (CSS px) saved to C:/tmp/shot.png." },
      { type: "image", data: "abc", mimeType: "image/png" },
    ]);
  });
});
