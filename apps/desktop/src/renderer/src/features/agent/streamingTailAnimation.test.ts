import { describe, expect, it } from "vitest";
import { createStreamingTailAnimation } from "./streamingTailAnimation";

type TestNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: TestNode[];
};

const paragraph = (text: string): TestNode => ({
  type: "root",
  children: [{ type: "element", tagName: "p", children: [{ type: "text", value: text }] }],
});

const text = (node: TestNode): string =>
  node.type === "text" ? (node.value ?? "") : (node.children?.map(text).join("") ?? "");

const animated = (node: TestNode): TestNode[] => [
  ...(node.properties?.["data-sd-animate"] ? [node] : []),
  ...(node.children?.flatMap(animated) ?? []),
];

describe("streaming tail animation", () => {
  it("animates only the newly appended text and unwraps cleanly on completion", () => {
    const controller = createStreamingTailAnimation();

    const first = paragraph("你好");
    controller.plugin("你好", true)()(first);
    expect(animated(first)).toHaveLength(1);
    const firstStyle = animated(first)[0]?.properties?.style;
    controller.commit("你好");

    const next = paragraph("你好，Modus");
    controller.plugin("你好，Modus", true)()(next);
    expect(animated(next)).toHaveLength(1);
    expect(text(animated(next)[0] as TestNode)).toBe("，Modus");
    expect(animated(next)[0]?.properties?.style).not.toBe(firstStyle);
    controller.commit("你好，Modus");

    const complete = paragraph("你好，Modus");
    controller.plugin("你好，Modus", false)()(complete);
    expect(animated(complete)).toHaveLength(0);
    expect(text(complete)).toBe("你好，Modus");
  });

  it("does not consume the tail when React replays a render before commit", () => {
    const controller = createStreamingTailAnimation();
    const transform = controller.plugin("你好", true)();
    const first = paragraph("你好");
    const replay = paragraph("你好");

    transform(first);
    transform(replay);

    expect(animated(first)).toHaveLength(1);
    expect(animated(replay)).toHaveLength(1);
  });
});
