import type { Root } from "hast";
import { describe, expect, it } from "vitest";
import {
  isWorkspaceFileHref,
  parseModusFileHref,
  rehypeWorkspaceFiles,
  toModusFileHref,
  workspaceImagePath,
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

it("preserves local image targets through sanitization and resolves encoded paths", () => {
  const tree: Root = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "img",
        properties: { src: "/F:/art/frame%20one.gif" },
        children: [],
      },
      {
        type: "element",
        tagName: "img",
        properties: { src: "../frames/result.gif" },
        children: [],
      },
      {
        type: "element",
        tagName: "img",
        properties: { src: "https://example.com/result.gif" },
        children: [],
      },
    ],
  };
  rehypeWorkspaceFiles()(tree);
  const sources = tree.children.map((node) =>
    node.type === "element" ? String(node.properties.src) : "",
  );
  expect(parseModusFileHref(sources[0])).toBe("F:/art/frame one.gif");
  expect(parseModusFileHref(sources[1])).toBe("../frames/result.gif");
  expect(sources[2]).toBe("https://example.com/result.gif");
  expect(workspaceImagePath("F:/art/frame.gif")).toBe("F:/art/frame.gif");
  expect(workspaceImagePath("file:///tmp/result.gif")).toBe("/tmp/result.gif");
  expect(workspaceImagePath("data:image/png;base64,pixels")).toBeUndefined();
});
