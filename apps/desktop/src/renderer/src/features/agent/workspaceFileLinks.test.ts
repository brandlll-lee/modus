import { describe, expect, it } from "vitest";
import {
  isWorkspaceFileHref,
  parseModusFileHref,
  toModusFileHref,
  workspacePathFromHref,
} from "./workspaceFileLinks";

describe("workspaceFileLinks", () => {
  it("classifies Windows abs / file: / leading-slash drive hrefs", () => {
    expect(isWorkspaceFileHref("F:/CodeHub/nanochat/tokenizer.py:2")).toBe(true);
    expect(isWorkspaceFileHref("/F:/CodeHub/nanochat/tokenizer.py")).toBe(true);
    expect(isWorkspaceFileHref("file:///F:/CodeHub/x.py")).toBe(true);
    expect(isWorkspaceFileHref("https://example.com/x")).toBe(false);
    expect(isWorkspaceFileHref("tokenizer.py")).toBe(false);
  });

  it("normalizes to a filesystem path and drops :line citations", () => {
    expect(workspacePathFromHref("F:/CodeHub/nanochat/nanochat/tokenizer.py:2")).toBe(
      "F:/CodeHub/nanochat/nanochat/tokenizer.py",
    );
    expect(workspacePathFromHref("/F:/CodeHub/x.py")).toBe("F:/CodeHub/x.py");
    expect(workspacePathFromHref("file:///F:/CodeHub/x.py")).toBe("F:/CodeHub/x.py");
  });

  it("round-trips through the modus.workspace sentinel", () => {
    const path = "F:/CodeHub/nanochat/nanochat/tokenizer.py";
    const href = toModusFileHref(path);
    expect(href.startsWith("https://modus.workspace/file?path=")).toBe(true);
    expect(parseModusFileHref(href)).toBe(path);
    expect(parseModusFileHref("https://example.com")).toBeUndefined();
  });
});
