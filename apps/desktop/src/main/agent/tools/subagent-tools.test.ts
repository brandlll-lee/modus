import { describe, expect, it } from "vitest";
import { resolveTaskModelId } from "./subagent-tools";

describe("resolveTaskModelId", () => {
  const available = [{ id: "openai/gpt-5.5" }, { id: "minimax/m3" }];

  it("resolves catalog ids and rejects unknown ones", () => {
    expect(resolveTaskModelId(undefined, available)).toBeUndefined();
    expect(resolveTaskModelId("inherit", available)).toBeUndefined();
    expect(resolveTaskModelId("openai/gpt-5.5", available)).toBe("openai/gpt-5.5");
    expect(() => resolveTaskModelId("missing/model", available)).toThrow(/not available/);
  });
});
