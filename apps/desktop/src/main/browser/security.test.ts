import { describe, expect, it } from "vitest";
import { isNavigableUrl, normalizeBrowserUrl, workspacePartition } from "./security";

describe("normalizeBrowserUrl", () => {
  it("passes through http(s) and about urls", () => {
    expect(normalizeBrowserUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normalizeBrowserUrl("http://example.com")).toBe("http://example.com");
    expect(normalizeBrowserUrl("about:blank")).toBe("about:blank");
  });

  it("returns about:blank for empty input", () => {
    expect(normalizeBrowserUrl("")).toBe("about:blank");
    expect(normalizeBrowserUrl("   ")).toBe("about:blank");
  });

  it("refuses file: urls — they become a search instead of touching disk", () => {
    const result = normalizeBrowserUrl("file:///C:/Windows/system32/config");
    expect(result.startsWith("https://www.google.com/search?q=")).toBe(true);
    expect(result).not.toContain("file:///C");
  });

  it("refuses other custom protocols", () => {
    expect(normalizeBrowserUrl("chrome://settings").startsWith("https://www.google.com/")).toBe(
      true,
    );
    expect(normalizeBrowserUrl("javascript:alert(1)").startsWith("https://www.google.com/")).toBe(
      true,
    );
  });

  it("upgrades localhost and bare domains", () => {
    expect(normalizeBrowserUrl("localhost:3000/app")).toBe("http://localhost:3000/app");
    expect(normalizeBrowserUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(normalizeBrowserUrl("example.com/path")).toBe("https://example.com/path");
  });

  it("falls back to a web search for plain text", () => {
    expect(normalizeBrowserUrl("how to cook rice")).toBe(
      "https://www.google.com/search?q=how%20to%20cook%20rice",
    );
  });
});

describe("isNavigableUrl", () => {
  it("allows only http(s) and about", () => {
    expect(isNavigableUrl("https://a.com")).toBe(true);
    expect(isNavigableUrl("http://a.com")).toBe(true);
    expect(isNavigableUrl("about:blank")).toBe(true);
    expect(isNavigableUrl("file:///etc/passwd")).toBe(false);
    expect(isNavigableUrl("chrome://gpu")).toBe(false);
    expect(isNavigableUrl("data:text/html,<b>x</b>")).toBe(false);
  });
});

describe("workspacePartition", () => {
  it("namespaces per workspace and sanitizes unsafe characters", () => {
    expect(workspacePartition("ws-1")).toBe("persist:modus-browser-ws-1");
    expect(workspacePartition("a/b:c d")).toBe("persist:modus-browser-a-b-c-d");
  });
});
