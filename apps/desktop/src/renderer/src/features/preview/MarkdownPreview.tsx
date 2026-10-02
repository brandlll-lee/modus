import { MarkdownMessage } from "../agent/MarkdownMessage";
export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="scroll-thin h-full overflow-auto px-4 py-3">
      <MarkdownMessage content={content} />
    </div>
  );
}
