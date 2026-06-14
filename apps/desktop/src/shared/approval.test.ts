import { describe, expect, it } from "vitest";
import { actionRisk, isApprovalMode, shouldPrompt } from "./approval";
import type { PermissionAction } from "./contracts";

const ALL_ACTIONS: PermissionAction[] = [
  "shell.execute",
  "file.write",
  "file.delete",
  "git.write",
  "mcp.call",
  "external.open",
  "browser.control",
];

describe("actionRisk", () => {
  it("rates deletes and git writes as high risk", () => {
    expect(actionRisk("file.delete")).toBe("high");
    expect(actionRisk("git.write")).toBe("high");
  });

  it("rates ordinary writes, commands, and calls as medium risk", () => {
    expect(actionRisk("file.write")).toBe("medium");
    expect(actionRisk("shell.execute")).toBe("medium");
    expect(actionRisk("mcp.call")).toBe("medium");
    expect(actionRisk("external.open")).toBe("medium");
    expect(actionRisk("browser.control")).toBe("medium");
  });
});

describe("shouldPrompt", () => {
  it("never prompts for non-dangerous actions in any mode", () => {
    for (const action of ALL_ACTIONS) {
      expect(shouldPrompt("request-approval", action, false)).toBe(false);
      expect(shouldPrompt("auto", action, false)).toBe(false);
      expect(shouldPrompt("full-access", action, false)).toBe(false);
    }
  });

  it("request-approval prompts for every dangerous action", () => {
    for (const action of ALL_ACTIONS) {
      expect(shouldPrompt("request-approval", action, true)).toBe(true);
    }
  });

  it("auto prompts only for high-risk dangerous actions", () => {
    expect(shouldPrompt("auto", "file.delete", true)).toBe(true);
    expect(shouldPrompt("auto", "git.write", true)).toBe(true);
    expect(shouldPrompt("auto", "file.write", true)).toBe(false);
    expect(shouldPrompt("auto", "shell.execute", true)).toBe(false);
    expect(shouldPrompt("auto", "mcp.call", true)).toBe(false);
  });

  it("full-access never prompts even for high-risk dangerous actions", () => {
    for (const action of ALL_ACTIONS) {
      expect(shouldPrompt("full-access", action, true)).toBe(false);
    }
  });
});

describe("isApprovalMode", () => {
  it("accepts the three known modes and rejects anything else", () => {
    expect(isApprovalMode("request-approval")).toBe(true);
    expect(isApprovalMode("auto")).toBe(true);
    expect(isApprovalMode("full-access")).toBe(true);
    expect(isApprovalMode("yolo")).toBe(false);
    expect(isApprovalMode(undefined)).toBe(false);
  });
});
