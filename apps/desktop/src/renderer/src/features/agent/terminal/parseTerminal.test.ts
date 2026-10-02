import { describe, expect, it } from "vitest";
import { parseTerminalOutput } from "./parseTerminal";

describe("parseTerminalOutput", () => {
  it("treats bash output as a raw body", () => {
    const parsed = parseTerminalOutput("bash", { command: "echo hi" }, "hi\n");
    expect(parsed.command).toBe("echo hi");
    expect(parsed.body).toBe("hi");
  });
});
