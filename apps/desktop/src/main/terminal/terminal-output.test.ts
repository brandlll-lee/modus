import { describe, expect, it } from "vitest";
import { deriveTitle, shellCommandArgs, sliceSince, stripAnsi, tailText } from "./terminal-output";

describe("stripAnsi", () => {
  it("removes SGR color escapes", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m")).toBe("red");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });
});

describe("tailText", () => {
  it("returns the whole string when within the cap", () => {
    expect(tailText("short", 100)).toEqual({ text: "short", truncated: false });
  });

  it("keeps the last bytes and flags truncation when over the cap", () => {
    expect(tailText("0123456789abcdefghij", 5)).toEqual({ text: "fghij", truncated: true });
  });

  it("drops a partial first line after truncating", () => {
    expect(tailText("aaa\nbbbbbb", 7)).toEqual({ text: "bbbbbb", truncated: true });
  });
});

describe("deriveTitle", () => {
  it("collapses whitespace", () => {
    expect(deriveTitle("  npm   run   dev  ")).toBe("npm run dev");
  });

  it("truncates very long commands with an ellipsis", () => {
    const title = deriveTitle("x".repeat(80));
    expect(title).toBe(`${"x".repeat(57)}…`);
    expect(title.length).toBe(58);
  });
});

describe("shellCommandArgs", () => {
  it("uses -Command for PowerShell 7 and Windows PowerShell", () => {
    expect(shellCommandArgs("C:/Program Files/PowerShell/7/pwsh.exe", "npm run dev")).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-Command",
      "npm run dev",
    ]);
    expect(shellCommandArgs("powershell.exe", "ls")).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-Command",
      "ls",
    ]);
  });

  it("uses /d /s /c for cmd", () => {
    expect(shellCommandArgs("C:/WINDOWS/system32/cmd.exe", "dir")).toEqual([
      "/d",
      "/s",
      "/c",
      "dir",
    ]);
  });

  it("uses a login shell for bash/zsh/sh", () => {
    expect(shellCommandArgs("/bin/bash", "echo hi")).toEqual(["-lc", "echo hi"]);
    expect(shellCommandArgs("/usr/bin/zsh", "echo hi")).toEqual(["-lc", "echo hi"]);
  });
});

describe("sliceSince", () => {
  it("returns the full buffer for a first read (no cursor)", () => {
    expect(sliceSince({ output: "hello world", produced: 11, maxBytes: 1000 })).toEqual({
      text: "hello world",
      truncated: false,
    });
  });

  it("returns only output after the cursor", () => {
    expect(
      sliceSince({ output: "hello world", produced: 11, sinceCursor: 6, maxBytes: 1000 }),
    ).toEqual({ text: "world", truncated: false });
  });

  it("returns empty when the cursor is caught up", () => {
    expect(
      sliceSince({ output: "hello world", produced: 11, sinceCursor: 11, maxBytes: 1000 }),
    ).toEqual({ text: "", truncated: false });
  });

  it("flags truncation when the requested cursor fell off the retained window", () => {
    // Only the last 5 bytes ("world") of 11 produced are retained.
    expect(sliceSince({ output: "world", produced: 11, sinceCursor: 0, maxBytes: 1000 })).toEqual({
      text: "world",
      truncated: true,
    });
  });

  it("does not flag truncation when the cursor sits exactly at the buffer start", () => {
    expect(sliceSince({ output: "world", produced: 11, sinceCursor: 6, maxBytes: 1000 })).toEqual({
      text: "world",
      truncated: false,
    });
  });
});
