import { createEditToolDefinition, generateDiffString } from "@earendil-works/pi-coding-agent";

const edit = createEditToolDefinition(".");

export function previewEdits(input: unknown): string[] {
  const args = edit.prepareArguments?.(input);
  if (!Array.isArray(args?.edits)) return [];
  return args.edits.flatMap((replacement) =>
    typeof replacement?.oldText === "string" && typeof replacement?.newText === "string"
      ? [generateDiffString(replacement.oldText, replacement.newText).diff]
      : [],
  );
}
