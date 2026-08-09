import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { PLAN_TOOL_UI, type ToolCatalogEntry } from "../../../shared/tools";
import { registerBrowserTools } from "./browser-tools";
import { ToolRegistry, toolRegistry } from "./registry";

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

  it("plan profile activates the read-only research tools (no edit/write/bash)", () => {
    const registry = new ToolRegistry();
    expect(new Set(registry.resolveActiveTools("plan"))).toEqual(
      new Set(["read", "grep", "find", "ls"]),
    );
  });

  it("flows a plan-profile custom tool (plan_write) into the active set and customTools", () => {
    // Mirrors how plan_write is registered: a custom tool scoped to the plan
    // profile must appear in plan's active names AND its custom definitions, so
    // the session's customTools include it and setActiveToolsByName can enable it.
    const registry = new ToolRegistry();
    const definition = { name: "plan_write" } as never;
    registry.registerTool({
      entry: {
        name: "plan_write",
        profiles: ["plan"],
        permission: { danger: "safe" },
        ui: PLAN_TOOL_UI,
      },
      definition,
    });
    expect(registry.resolveActiveTools("plan")).toContain("plan_write");
    expect(registry.getCustomToolDefinitions("plan")).toContain(definition);
    // And it must NOT leak into chat (so build mode stays full-tools, plan-only stays plan-only).
    expect(registry.resolveActiveTools("chat")).not.toContain("plan_write");
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
      ui: { verb: "Demo" },
    };
    const definition = { name: "demo" } as never;
    registry.registerTool({ entry, definition });

    expect(registry.resolveActiveTools("chat")).toContain("demo");
    expect(registry.getCustomToolDefinitions("chat")).toContain(definition);
    expect(registry.resolveActiveTools("review")).not.toContain("demo");
    expect(registry.getCustomToolDefinitions("review")).not.toContain(definition);
  });

  it("applies a custom dynamic classifier for a registered tool", () => {
    const registry = new ToolRegistry();
    registry.registerTool({
      entry: {
        name: "deploy",
        profiles: ["chat"],
        permission: { danger: "dynamic" },
        ui: { verb: "Deployed" },
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

describe("Browser tool permissions", () => {
  it("registers low-level browser primitives with read-only and control gating", () => {
    registerBrowserTools();

    expect(toolRegistry.getEntry("browser_tabs")).toBeDefined();
    expect(toolRegistry.getEntry("browser_cdp")).toBeDefined();
    expect(toolRegistry.getEntry("browser_click")).toBeUndefined();
    expect(toolRegistry.classify(toolEvent("browser_events", {}))).toEqual({
      action: "browser.control",
      dangerous: false,
    });
    expect(toolRegistry.classify(toolEvent("browser_snapshot", {}))).toEqual({
      action: "browser.control",
      dangerous: false,
    });
    expect(toolRegistry.classify(toolEvent("browser_screenshot", {}))).toEqual({
      action: "browser.control",
      dangerous: false,
    });
    expect(toolRegistry.classify(toolEvent("browser_tabs", { action: "list" }))).toEqual({
      action: "browser.control",
      dangerous: false,
    });
    expect(toolRegistry.classify(toolEvent("browser_cdp", { method: "Page.navigate" }))).toEqual({
      action: "browser.control",
      dangerous: true,
    });
    expect(toolRegistry.classify(toolEvent("browser_tabs", { action: "new" }))).toEqual({
      action: "browser.control",
      dangerous: true,
    });
  });
});
