import { describe, expect, it } from "vitest";
import { interactiveShellArgs } from "./terminal-output";

describe("interactiveShellArgs", () => {
  it("sets UTF-8 console encoding and keeps a PowerShell session open", () => {
    const args = interactiveShellArgs("pwsh.exe");
    expect(args?.slice(0, 3)).toEqual(["-NoLogo", "-NoExit", "-Command"]);
    expect(args?.at(-1)).toContain("UTF8");
  });

  it("starts cmd with code page 65001", () => {
    expect(interactiveShellArgs("cmd.exe")).toEqual(["/d", "/k", "chcp 65001>nul"]);
  });

  it("leaves POSIX shells without Windows code-page args", () => {
    expect(interactiveShellArgs("/bin/bash")).toBeUndefined();
  });
});
