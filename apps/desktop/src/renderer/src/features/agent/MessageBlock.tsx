import { IconMessageCircle, IconSparkles } from "@tabler/icons-react";

type MessageBlockProps = {
  role: "assistant" | "user";
  content: string;
  thinking: string;
};

export function MessageBlock({ role, content, thinking }: MessageBlockProps) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-white/6 text-fg-subtle">
        {role === "assistant" ? (
          <IconSparkles size={13} stroke={1.7} />
        ) : (
          <IconMessageCircle size={13} stroke={1.7} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-2xs text-fg-subtle">{role}</div>
        {thinking ? (
          <pre className="scroll-thin mb-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-white/2.5 px-3 py-2 font-mono text-2xs text-fg-faint leading-relaxed">
            {thinking}
          </pre>
        ) : null}
        <div className="whitespace-pre-wrap text-sm text-fg-muted leading-relaxed">
          {content || "Thinking..."}
        </div>
      </div>
    </div>
  );
}
