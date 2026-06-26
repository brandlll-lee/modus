import { describe, expect, it, vi } from "vitest";
import { registerFastCodebaseTools } from "./fast-codebase-tools";
import { toolRegistry } from "./registry";

const runFastCodebase = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  app: { getPath: () => "C:\\Modus" },
}));

vi.mock("../../fast-codebase/fast-codebase-service", () => ({
  runFastCodebase,
}));

describe("fast_codebase tool", () => {
  it("streams the final result to the tool card and returns it to the agent", async () => {
    registerFastCodebaseTools();
    const tool = toolRegistry
      .getCustomToolDefinitions("chat", { enable: ["fast_codebase"] })
      .find((definition) => definition.name === "fast_codebase");
    const details = {
      cacheDir: "C:\\Modus\\fast-codebase",
      indexed: true,
      project: "demo",
      query: "overview",
      workspace: "F:\\repo",
    };
    runFastCodebase.mockResolvedValue({ details, text: "# Fast Codebase\nok" });

    const execute = tool?.execute as NonNullable<typeof tool>["execute"];
    const updates: unknown[] = [];
    const result = await execute(
      "call-1",
      { query: "overview" },
      new AbortController().signal,
      (update: unknown) => updates.push(update),
      { cwd: "F:\\repo" } as Parameters<typeof execute>[4],
    );

    expect(result).toEqual({
      content: [{ type: "text", text: "# Fast Codebase\nok" }],
      details,
    });
    expect(updates.at(-1)).toEqual(result);
  });
});
