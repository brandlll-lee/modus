import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerFastCodebaseTools } from "./fast-codebase-tools";
import { toolRegistry } from "./registry";
import { setAgentToolContext } from "./tool-context";

const runFastCodebase = vi.hoisted(() => vi.fn());

vi.mock("../../fast-codebase/fast-codebase-service", () => ({
  runFastCodebase,
}));

describe("fast_codebase tool", () => {
  beforeEach(() => {
    setAgentToolContext({ workspaceId: "workspace", sessionId: "session", cwd: "F:\\repo" });
    runFastCodebase.mockReset();
  });

  it("streams the final result to the tool card and returns it to the agent", async () => {
    registerFastCodebaseTools();
    const tool = toolRegistry
      .getCustomToolDefinitions("chat", { enable: ["fast_codebase"] })
      .find((definition) => definition.name === "fast_codebase");
    const details = {
      indexDir: "F:\\repo\\.codegraph",
      indexed: true,
      kernel: "CodeGraph local index",
      project: "demo",
      query: "overview",
      workspace: "F:\\repo",
    };
    runFastCodebase.mockResolvedValue({ details, text: "# Fast Codebase\nok" });

    const execute = tool?.execute as NonNullable<typeof tool>["execute"];
    const updates: unknown[] = [];
    const result = await execute(
      "call-1",
      { query: "overview", workspace_path: "F:\\repo\\child" },
      new AbortController().signal,
      (update: unknown) => updates.push(update),
      { cwd: "F:\\repo" } as Parameters<typeof execute>[4],
    );

    expect(result).toEqual({
      content: [{ type: "text", text: "# Fast Codebase\nok" }],
      details,
    });
    expect(updates.at(-1)).toEqual(result);
    expect(runFastCodebase).toHaveBeenCalledWith(
      expect.objectContaining({ workspacePath: "F:\\repo\\child" }),
    );
  });

  it("lets failed tool calls use the agent error path", async () => {
    registerFastCodebaseTools();
    const tool = toolRegistry
      .getCustomToolDefinitions("chat", { enable: ["fast_codebase"] })
      .find((definition) => definition.name === "fast_codebase");
    runFastCodebase.mockRejectedValue(new Error("index failed"));

    const execute = tool?.execute as NonNullable<typeof tool>["execute"];
    await expect(
      execute("call-1", { query: "overview" }, new AbortController().signal, undefined, {
        cwd: "F:\\repo",
      } as Parameters<typeof execute>[4]),
    ).rejects.toThrow(/index failed/);
  });
});
