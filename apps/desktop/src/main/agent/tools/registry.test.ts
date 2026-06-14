import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ToolCatalogEntry } from "../../../shared/tools";
import { registerBrowserTools } from "./browser-tools";
import { detectDetachedLaunch, ToolRegistry, toolRegistry } from "./registry";

function toolEvent(toolName: string, input: Record<string, unknown>): ToolCallEvent {
  return { type: "tool_call", toolCallId: "t1", toolName, input } as ToolCallEvent;
}

describe("ToolRegistry profiles", () => {
  it("chat profile activates all seven builtin tools", () => {
    const registry = new ToolRegistry();
    expect(new Set(registry.resolveActiveTools("chat"))).toEqual(
      new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]),
    );
  });

  it("review profile activates only read-only tools", () => {
    const registry = new ToolRegistry();
    expect(new Set(registry.resolveActiveTools("review"))).toEqual(
      new Set(["read", "grep", "find", "ls"]),
    );
  });

  it("overrides enable and disable adjust the active set", () => {
    const registry = new ToolRegistry();
    expect(registry.resolveActiveTools("review", { disable: ["grep"] })).not.toContain("grep");
    expect(registry.resolveActiveTools("review", { enable: ["bash"] })).toContain("bash");
  });
});

describe("ToolRegistry custom tools", () => {
  it("flows a registered custom tool into activation and customTools", () => {
    const registry = new ToolRegistry();
    const entry: Omit<ToolCatalogEntry, "kind"> = {
      name: "demo",
      profiles: ["chat"],
      permission: { danger: "safe" },
      ui: { iconName: "tool", verb: "Demo", mono: true },
    };
    const definition = { name: "demo" } as never;
    registry.registerTool({ entry, definition });

    expect(registry.resolveActiveTools("chat")).toContain("demo");
    expect(registry.getCustomToolDefinitions("chat")).toContain(definition);
    expect(registry.resolveActiveTools("review")).not.toContain("demo");
    expect(registry.getCustomToolDefinitions("review")).not.toContain(definition);
  });

  it("rejects a registered tool's execute promptly when its abort signal fires", async () => {
    const registry = new ToolRegistry();
    // A tool whose work never settles on its own — only an abort can end it.
    const hang = new Promise<{ output: string }>(() => {});
    registry.registerTool({
      entry: {
        name: "slow",
        profiles: ["chat"],
        permission: { danger: "safe" },
        ui: { iconName: "tool", verb: "Slow", mono: false },
      },
      definition: { name: "slow", execute: () => hang } as never,
    });

    const [wrapped] = registry.getCustomToolDefinitions("chat") as Array<{
      execute: (
        id: string,
        params: unknown,
        signal: AbortSignal,
        onUpdate: undefined,
        ctx: unknown,
      ) => Promise<unknown>;
    }>;
    const controller = new AbortController();
    const pending = wrapped!.execute("call-1", {}, controller.signal, undefined, {});
    controller.abort();

    await expect(pending).rejects.toThrow(/aborted/i);
  });

  it("applies a custom dynamic classifier for a registered tool", () => {
    const registry = new ToolRegistry();
    registry.registerTool({
      entry: {
        name: "deploy",
        profiles: ["chat"],
        permission: { danger: "dynamic" },
        ui: { iconName: "tool", verb: "Deployed", mono: true },
      },
      definition: { name: "deploy" } as never,
      classify: () => ({ action: "external.open", dangerous: true }),
    });
    expect(registry.classify(toolEvent("deploy", {}))).toEqual({
      action: "external.open",
      dangerous: true,
    });
  });
});

describe("ToolRegistry classify", () => {
  it("treats bash git-write commands as dangerous git.write", () => {
    const registry = new ToolRegistry();
    expect(registry.classify(toolEvent("bash", { command: "git commit -m wip" }))).toEqual({
      action: "git.write",
      dangerous: true,
    });
  });

  it("treats bash mutating commands as dangerous shell.execute", () => {
    const registry = new ToolRegistry();
    expect(registry.classify(toolEvent("bash", { command: "rm -rf build" }))).toEqual({
      action: "shell.execute",
      dangerous: true,
    });
  });

  it("treats plain bash commands as safe shell.execute", () => {
    const registry = new ToolRegistry();
    expect(registry.classify(toolEvent("bash", { command: "ls -la" }))).toEqual({
      action: "shell.execute",
      dangerous: false,
    });
  });

  it("treats write and edit as dangerous file.write", () => {
    const registry = new ToolRegistry();
    expect(registry.classify(toolEvent("write", { path: "a.txt" }))).toEqual({
      action: "file.write",
      dangerous: true,
    });
    expect(registry.classify(toolEvent("edit", { path: "a.txt" }))).toEqual({
      action: "file.write",
      dangerous: true,
    });
  });

  it("treats read-only builtins as safe", () => {
    const registry = new ToolRegistry();
    for (const name of ["read", "grep", "find", "ls"]) {
      expect(registry.classify(toolEvent(name, { path: "." })).dangerous).toBe(false);
    }
  });

  it("keeps the legacy delete/remove heuristic for unregistered tools", () => {
    const registry = new ToolRegistry();
    expect(registry.classify(toolEvent("delete_file", { path: "a.txt" }))).toEqual({
      action: "file.delete",
      dangerous: true,
    });
    expect(registry.classify(toolEvent("unknown_tool", {})).dangerous).toBe(false);
  });
});

describe("detectDetachedLaunch", () => {
  it("flags PowerShell detach launchers", () => {
    expect(detectDetachedLaunch("Start-Process -FilePath 'C:/app.exe'")).toBe("Start-Process");
    expect(detectDetachedLaunch("Start-Job { npm run dev }")).toBe("Start-Job");
    expect(detectDetachedLaunch("Start-ThreadJob { node server.js }")).toBe("Start-ThreadJob");
  });

  it("flags POSIX detach helpers", () => {
    expect(detectDetachedLaunch("nohup npm run dev &")).toBe("nohup");
    expect(detectDetachedLaunch("node server.js & disown")).toBe("disown");
    expect(detectDetachedLaunch("setsid ./server")).toBe("setsid");
  });

  it("flags cmd start and a trailing background ampersand", () => {
    expect(detectDetachedLaunch("start notepad.exe")).toBe("start");
    expect(detectDetachedLaunch("cmd /c start app.exe")).toBe("cmd /c start");
    expect(detectDetachedLaunch("node server.js &")).toBe("trailing &");
  });

  it("does not flag normal commands or sequential && chains", () => {
    expect(detectDetachedLaunch("npm run dev")).toBeUndefined();
    expect(detectDetachedLaunch("git add . && git commit -m wip")).toBeUndefined();
    expect(detectDetachedLaunch("npm run build && npm start")).toBeUndefined();
    expect(detectDetachedLaunch("echo done")).toBeUndefined();
    expect(detectDetachedLaunch("")).toBeUndefined();
  });

  it("does not misfire on 'start' as a substring of another word", () => {
    expect(detectDetachedLaunch("npm run start")).toBeUndefined();
    expect(detectDetachedLaunch("./restart.sh")).toBeUndefined();
  });
});

describe("Browser tool permissions", () => {
  it("registers Cursor-compatible browser tools with read-only and control gating", () => {
    registerBrowserTools();

    expect(toolRegistry.getEntry("browser_tabs")).toBeDefined();
    expect(toolRegistry.getEntry("browser_click")).toBeDefined();
    expect(toolRegistry.classify(toolEvent("browser_snapshot", {}))).toEqual({
      action: "browser.control",
      dangerous: false,
    });
    expect(toolRegistry.classify(toolEvent("browser_console_messages", {}))).toEqual({
      action: "browser.control",
      dangerous: false,
    });
    expect(toolRegistry.classify(toolEvent("browser_tabs", { action: "list" }))).toEqual({
      action: "browser.control",
      dangerous: false,
    });
    expect(toolRegistry.classify(toolEvent("browser_click", { ref: "ref-1" }))).toEqual({
      action: "browser.control",
      dangerous: true,
    });
    expect(toolRegistry.classify(toolEvent("browser_tabs", { action: "new" }))).toEqual({
      action: "browser.control",
      dangerous: true,
    });
  });
});
