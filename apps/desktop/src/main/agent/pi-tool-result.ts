import type { ImageContent } from "../../shared/contracts";

export function toolResultContent(value: unknown): { output: string; images: ImageContent[] } {
  if (typeof value === "string") return { output: value, images: [] };
  if (!value || typeof value !== "object" || !("content" in value) || !Array.isArray(value.content))
    return { output: JSON.stringify(value, null, 2) ?? "", images: [] };

  const text: string[] = [];
  const images: ImageContent[] = [];
  for (const block of value.content) {
    if (block.type === "text") text.push(block.text);
    if (block.type === "image")
      images.push({ type: "image", data: block.data, mimeType: block.mimeType });
  }
  if ("structuredContent" in value && value.structuredContent !== undefined)
    text.push(JSON.stringify(value.structuredContent, null, 2));
  const output = text.filter(Boolean).join("\n");
  return {
    output: output && !output.endsWith("\n") ? `${output}\n` : output,
    images,
  };
}
