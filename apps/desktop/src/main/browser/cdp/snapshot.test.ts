import { describe, expect, it } from "vitest";
import { type AXNode, SnapshotStore, serializeAxTree } from "./snapshot";

function v(value: string): { type: string; value: string } {
  return { type: "string", value };
}

function prop(name: string, value: unknown): { name: string; value: { value: unknown } } {
  return { name, value: { value } };
}

function refCounter(): (node: AXNode) => string | undefined {
  let n = 0;
  return (node) => {
    if (node.backendDOMNodeId === undefined) {
      return undefined;
    }
    n += 1;
    return `e${n}`;
  };
}

function serialize(nodes: AXNode[], maxLines = 100, maxDepth = 32) {
  return serializeAxTree(nodes, { maxLines, maxDepth, assignRef: refCounter() });
}

describe("serializeAxTree", () => {
  it("serializes a cookie-banner style tree with refs on interactive nodes", () => {
    // Shape mirrors what getFullAXTree returns for a consent dialog living in
    // shadow DOM: the AX tree has already pierced the shadow boundary.
    const nodes: AXNode[] = [
      {
        nodeId: "1",
        role: v("RootWebArea"),
        name: v("BMW.de"),
        childIds: ["2"],
        backendDOMNodeId: 1,
      },
      { nodeId: "2", role: v("generic"), childIds: ["3"], backendDOMNodeId: 2 },
      {
        nodeId: "3",
        role: v("dialog"),
        name: v("Cookie Settings"),
        childIds: ["4", "5"],
        backendDOMNodeId: 3,
      },
      {
        nodeId: "4",
        role: v("button"),
        name: v("Accept all"),
        backendDOMNodeId: 4,
        properties: [prop("focusable", true)],
      },
      { nodeId: "5", role: v("button"), name: v("Reject"), backendDOMNodeId: 5 },
    ];

    const result = serialize(nodes);
    expect(result.truncated).toBe(false);
    expect(result.lines).toEqual([
      '- dialog "Cookie Settings"',
      '  - button "Accept all" [ref=e1]',
      '  - button "Reject" [ref=e2]',
    ]);
  });

  it("flattens layout wrappers but keeps named/focusable generics", () => {
    const nodes: AXNode[] = [
      { nodeId: "1", role: v("RootWebArea"), childIds: ["2", "5"], backendDOMNodeId: 1 },
      { nodeId: "2", role: v("generic"), childIds: ["3"], backendDOMNodeId: 2 },
      { nodeId: "3", role: v("none"), childIds: ["4"], backendDOMNodeId: 3 },
      { nodeId: "4", role: v("link"), name: v("Docs"), backendDOMNodeId: 4 },
      {
        nodeId: "5",
        role: v("generic"),
        name: v("Editable area"),
        backendDOMNodeId: 5,
        properties: [prop("editable", "richtext")],
      },
    ];

    const result = serialize(nodes);
    expect(result.lines).toEqual(['- link "Docs" [ref=e1]', '- generic "Editable area" [ref=e2]']);
  });

  it("hides ignored nodes themselves but keeps their subtree (regression)", () => {
    // Real-world shape that produced completely empty snapshots (refs: 0 on
    // cursor.com): the document's direct children are `ignored` wrappers and
    // ALL content hangs below them. Ignored = invisible to a11y, not empty.
    const nodes: AXNode[] = [
      { nodeId: "1", role: v("RootWebArea"), childIds: ["2"], backendDOMNodeId: 1 },
      {
        nodeId: "2",
        role: v("generic"),
        ignored: true,
        childIds: ["3", "4"],
        backendDOMNodeId: 2,
      },
      { nodeId: "3", role: v("button"), name: v("Menu"), backendDOMNodeId: 3 },
      { nodeId: "4", role: v("InlineTextBox"), name: v("noise"), backendDOMNodeId: 4 },
    ];

    const result = serialize(nodes);
    expect(result.lines).toEqual(['- button "Menu" [ref=e1]']);
  });

  it("emits bare static text and skips inline text boxes", () => {
    const nodes: AXNode[] = [
      { nodeId: "1", role: v("RootWebArea"), childIds: ["2", "3"], backendDOMNodeId: 1 },
      { nodeId: "2", role: v("StaticText"), name: v("Welcome to the page"), backendDOMNodeId: 2 },
      { nodeId: "3", role: v("InlineTextBox"), name: v("noise"), backendDOMNodeId: 3 },
    ];

    const result = serialize(nodes);
    expect(result.lines).toEqual(['- text "Welcome to the page"']);
  });

  it("renders states, heading level, and current input values", () => {
    const nodes: AXNode[] = [
      {
        nodeId: "1",
        role: v("RootWebArea"),
        childIds: ["2", "3", "4"],
        backendDOMNodeId: 1,
      },
      {
        nodeId: "2",
        role: v("heading"),
        name: v("Checkout"),
        backendDOMNodeId: 2,
        properties: [prop("level", 2)],
      },
      {
        nodeId: "3",
        role: v("checkbox"),
        name: v("Subscribe"),
        backendDOMNodeId: 3,
        properties: [prop("checked", "true"), prop("disabled", true)],
      },
      {
        nodeId: "4",
        role: v("textbox"),
        name: v("Search"),
        value: v("modus"),
        backendDOMNodeId: 4,
      },
    ];

    const result = serialize(nodes);
    expect(result.lines).toEqual([
      '- heading "Checkout" [level=2]',
      '- checkbox "Subscribe" [ref=e1] [disabled] [checked]',
      '- textbox "Search" [ref=e2]: "modus"',
    ]);
  });

  it("omits refs for nodes without a backing DOM node", () => {
    const nodes: AXNode[] = [
      { nodeId: "1", role: v("RootWebArea"), childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: v("button"), name: v("Ghost") },
    ];

    const result = serialize(nodes);
    expect(result.lines).toEqual(['- button "Ghost"']);
  });

  it("respects the line budget and reports truncation", () => {
    const children: AXNode[] = [];
    const childIds: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      const nodeId = `c${index}`;
      childIds.push(nodeId);
      children.push({
        nodeId,
        role: v("button"),
        name: v(`Button ${index}`),
        backendDOMNodeId: index + 10,
      });
    }
    const nodes: AXNode[] = [
      { nodeId: "1", role: v("RootWebArea"), childIds, backendDOMNodeId: 1 },
      ...children,
    ];

    const result = serialize(nodes, 5);
    expect(result.lines).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });

  it("collapses whitespace and truncates very long names", () => {
    const nodes: AXNode[] = [
      { nodeId: "1", role: v("RootWebArea"), childIds: ["2"], backendDOMNodeId: 1 },
      {
        nodeId: "2",
        role: v("button"),
        name: v(`  Long\n${"x".repeat(400)}   name  `),
        backendDOMNodeId: 2,
      },
    ];

    const result = serialize(nodes);
    const line = result.lines[0] ?? "";
    expect(line).toContain("[ref=e1]");
    expect(line).toContain("Long x");
    expect(line.length).toBeLessThan(200);
    expect(line).toContain("…");
  });
});

describe("SnapshotStore", () => {
  it("resolves refs registered in the current generation", () => {
    const store = new SnapshotStore();
    store.beginGeneration();
    store.addRef("e1", { backendNodeId: 42, role: "button", name: "OK" });
    expect(store.resolve("e1").backendNodeId).toBe(42);
  });

  it("throws an actionable stale error for unknown or invalidated refs", () => {
    const store = new SnapshotStore();
    store.beginGeneration();
    store.addRef("e1", { backendNodeId: 42, role: "button", name: "OK" });
    store.invalidate();
    expect(() => store.resolve("e1")).toThrow(/stale|browser_snapshot/);
    expect(() => store.resolve("e99")).toThrow(/browser_snapshot/);
  });

  it("clears previous refs when a new generation begins", () => {
    const store = new SnapshotStore();
    store.beginGeneration();
    store.addRef("e1", { backendNodeId: 1, role: "button", name: "A" });
    store.beginGeneration();
    expect(store.size).toBe(0);
    expect(() => store.resolve("e1")).toThrow();
  });
});
