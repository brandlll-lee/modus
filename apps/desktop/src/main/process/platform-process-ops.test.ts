import { describe, expect, it } from "vitest";
import { parseUnixProcess, parseWindowsProcess, pidAlive } from "./platform-process-ops";

describe("parseWindowsProcess", () => {
  it("reads process name and window title from two lines", () => {
    expect(parseWindowsProcess("solers\r\nSolers Engine — 项目管理器\r\n", 22600)).toEqual({
      pid: 22600,
      name: "solers",
      windowTitle: "Solers Engine — 项目管理器",
    });
  });

  it("omits the window title when the process has none", () => {
    expect(parseWindowsProcess("node\r\n\r\n", 100)).toEqual({ pid: 100, name: "node" });
  });

  it("falls back to the pid when output is empty", () => {
    expect(parseWindowsProcess("", 100)).toEqual({ pid: 100, name: "pid 100" });
  });
});

describe("parseUnixProcess", () => {
  it("reduces a full command path to its basename", () => {
    expect(parseUnixProcess("/Applications/Solers.app/Contents/MacOS/solers\n", 42)).toEqual({
      pid: 42,
      name: "solers",
    });
  });

  it("keeps a bare name", () => {
    expect(parseUnixProcess("node\n", 42)).toEqual({ pid: 42, name: "node" });
  });

  it("falls back to the pid when output is empty", () => {
    expect(parseUnixProcess("   \n", 42)).toEqual({ pid: 42, name: "pid 42" });
  });
});

describe("pidAlive", () => {
  it("reports the current process as alive", () => {
    expect(pidAlive(process.pid)).toBe(true);
  });

  it("reports an unused pid as not alive", () => {
    // A pid far above any plausible live process on a test machine.
    expect(pidAlive(2_000_000_000)).toBe(false);
  });
});
