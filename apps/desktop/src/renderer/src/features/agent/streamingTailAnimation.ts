type MarkdownTreeNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownTreeNode[];
};

const NON_TEXT_CONTENT = new Set(["annotation", "code", "math", "pre", "svg"]);

export function createStreamingTailAnimation() {
  let committedContent = "";
  let renderedLength = 0;
  let revision = 0;
  const pending = new Map<string, { length: number; revision: number }>();

  const plugin = (content: string, active: boolean) => () => (tree: unknown): void => {
    const root = tree as MarkdownTreeNode;
    const start = content.startsWith(committedContent) ? renderedLength : 0;
    const nextRevision = content === committedContent ? revision : revision + 1;
    const animation = `modus-stream-tail-fade-${nextRevision % 2 === 0 ? "a" : "b"}`;
    const cursor = { value: 0 };

    const animate = (node: MarkdownTreeNode, blocked = false): MarkdownTreeNode[] => {
      if (node.type === "text") {
        const value = node.value ?? "";
        const end = cursor.value + value.length;
        const split = Math.max(0, start - cursor.value);
        cursor.value = end;
        if (!active || blocked || end <= start || !value.slice(split)) {
          return [node];
        }
        return [
          ...(split > 0 ? [{ type: "text", value: value.slice(0, split) }] : []),
          {
            type: "element",
            tagName: "span",
            properties: {
              "data-sd-animate": true,
              style: `--sd-animation:${animation};--sd-duration:96ms;--sd-easing:cubic-bezier(0.22,1,0.36,1)`,
            },
            children: [{ type: "text", value: value.slice(split) }],
          },
        ];
      }

      const skip = blocked || (node.tagName ? NON_TEXT_CONTENT.has(node.tagName) : false);
      if (node.children) {
        node.children = node.children.flatMap((child) => animate(child, skip));
      }
      return [node];
    };

    animate(root);
    pending.set(content, { length: cursor.value, revision: nextRevision });
  };

  return {
    commit(content: string): void {
      const next = pending.get(content);
      if (!next) {
        return;
      }
      committedContent = content;
      renderedLength = next.length;
      revision = next.revision;
      pending.clear();
    },
    plugin,
  };
}
