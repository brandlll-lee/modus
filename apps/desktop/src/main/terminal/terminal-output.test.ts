import { describe, expect, it } from "vitest";
import {
  deriveTitle,
  formatDuration,
  matchesReadyLog,
  shellCommandArgs,
  sliceSince,
  stripAnsi,
  tailText,
} from "./terminal-output";

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

describe("formatDuration", () => {
  it("renders sub-second durations in milliseconds", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1)).toBe("1ms");
  });

  it("renders seconds with one decimal under a minute", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(59_900)).toBe("59.9s");
  });

  it("renders minutes and seconds past a minute", () => {
    expect(formatDuration(60_000)).toBe("1m0s");
    expect(formatDuration(90_000)).toBe("1m30s");
  });

  it("guards against invalid input", () => {
    expect(formatDuration(-1)).toBe("?");
    expect(formatDuration(Number.NaN)).toBe("?");
  });
});

describe("matchesReadyLog", () => {
  it("matches a readiness regex case-insensitively", () => {
    expect(matchesReadyLog("VITE ready in 312 ms", "ready in \\d+ ms")).toBe(true);
    expect(matchesReadyLog("Local:   http://localhost:5173/", "local:")).toBe(true);
  });

  it("returns false when the pattern is absent from the output", () => {
    expect(matchesReadyLog("compiling...", "ready in \\d+ ms")).toBe(false);
  });

  it("never throws on an invalid regex (returns false)", () => {
    expect(matchesReadyLog("anything", "(unclosed")).toBe(false);
  });

  it("returns false for an empty pattern", () => {
    expect(matchesReadyLog("output", "")).toBe(false);
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

  it("forces UTF-8 for an agent pwsh command when requested", () => {
    const args = shellCommandArgs("pwsh.exe", "npm install", { utf8: true });
    expect(args.slice(0, 3)).toEqual(["-NoLogo", "-NoProfile", "-Command"]);
    expect(args.at(-1)).toContain("UTF8");
    expect(args.at(-1)).toContain("npm install");
  });

  it("forces chcp 65001 for an agent cmd command when requested", () => {
    expect(shellCommandArgs("cmd.exe", "dir", { utf8: true }).at(-1)).toBe("chcp 65001>nul & dir");
  });

  it("leaves the command untouched when utf8 is not requested", () => {
    expect(shellCommandArgs("pwsh.exe", "ls")).toEqual(["-NoLogo", "-NoProfile", "-Command", "ls"]);
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
