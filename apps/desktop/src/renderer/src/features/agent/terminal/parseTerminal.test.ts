import { describe, expect, it } from "vitest";
import { parseTerminalOutput, tailLines, terminalCommand } from "./parseTerminal";

describe("terminalCommand", () => {
  it("pulls the command from bash/terminal_run args", () => {
    expect(terminalCommand("bash", { command: "ls -la" })).toBe("ls -la");
    expect(terminalCommand("terminal_run", { command: "npm run dev" })).toBe("npm run dev");
  });

  it("labels terminal_read/kill by terminal id", () => {
    expect(terminalCommand("terminal_read", { terminal_id: "abc" })).toBe("terminal abc");
  });

  it("returns undefined when no command is present", () => {
    expect(terminalCommand("bash", {})).toBeUndefined();
    expect(terminalCommand("terminal_list", {})).toBeUndefined();
  });
});

describe("parseTerminalOutput", () => {
  it("treats bash output as a raw body", () => {
    const parsed = parseTerminalOutput("bash", { command: "echo hi" }, "hi\n");
    expect(parsed.command).toBe("echo hi");
    expect(parsed.body).toBe("hi");
    expect(parsed.status).toBeUndefined();
  });

  it("strips the terminal_run framing into command/status/body", () => {
    const output = "$ npm run dev\n[terminal t1 — running; cursor=42]\n\nvite ready in 300ms";
    const parsed = parseTerminalOutput("terminal_run", { command: "npm run dev" }, output);
    expect(parsed.command).toBe("npm run dev");
    expect(parsed.status).toBe("running");
    expect(parsed.body).toBe("vite ready in 300ms");
  });

  it("parses the terminal_read framing", () => {
    const output = "[terminal t1 · exited 0 · pid 123 · cursor=10]\n\nbuild done";
    const parsed = parseTerminalOutput("terminal_read", { terminal_id: "t1" }, output);
    expect(parsed.status).toBe("exited 0");
    expect(parsed.body).toBe("build done");
  });

  it("normalizes the empty read sentinel to an empty body", () => {
    const output = "[terminal t1 · running · cursor=0]\n\n(no new output)";
    const parsed = parseTerminalOutput("terminal_read", { terminal_id: "t1" }, output);
    expect(parsed.body).toBe("");
  });

  it("flags truncation and removes the marker from the body", () => {
    const output = "$ big\n[terminal t1 — running; cursor=99]\n[earlier output truncated]\n\ntail";
    const parsed = parseTerminalOutput("terminal_run", {}, output);
    expect(parsed.truncated).toBe(true);
    expect(parsed.body).not.toContain("earlier output truncated");
    expect(parsed.body).toBe("tail");
  });
});

describe("tailLines", () => {
  it("returns the whole body when within the cap", () => {
    expect(tailLines("a\nb\nc", 5)).toEqual({ text: "a\nb\nc", hidden: 0 });
  });

  it("keeps only the last N lines and reports how many were hidden", () => {
    const body = Array.from({ length: 10 }, (_, i) => `L${i}`).join("\n");
    const result = tailLines(body, 3);
    expect(result.text).toBe("L7\nL8\nL9");
    expect(result.hidden).toBe(7);
  });

  it("handles an empty body", () => {
    expect(tailLines("", 5)).toEqual({ text: "", hidden: 0 });
  });
});
