import { IconSparkles, IconTerminal2 } from "@tabler/icons-react";
import { m } from "motion/react";
import type { AgentEvent } from "../../../../shared/contracts";
import { cn } from "../../lib/cn";

type TimelineProps = {
  agentEvents: Array<{ id: string; event: AgentEvent }>;
};

function describeEvent(event: AgentEvent): { isError: boolean; title: string; body: string } {
  switch (event.type) {
    case "agent.stdout":
      return {
        isError: false,
        title: "stdout",
        body: typeof event.line === "string" ? event.line : JSON.stringify(event.line, null, 2),
      };
    case "agent.stderr":
      return { isError: true, title: "stderr", body: event.data };
    case "agent.exit":
      return {
        isError: false,
        title: "process exit",
        body: `exit code: ${event.exitCode ?? "null"}`,
      };
    case "agent.error":
      return { isError: true, title: "error", body: event.message };
    default:
      return { isError: false, title: "event", body: JSON.stringify(event) };
  }
}

export function Timeline({ agentEvents }: TimelineProps) {
  if (agentEvents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center">
        <span className="flex size-8 items-center justify-center rounded-lg bg-white/4 text-fg-subtle">
          <IconSparkles size={15} stroke={1.5} />
        </span>
        <p className="text-sm text-fg-subtle">
          Session ready. The agent's responses will stream here.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      {agentEvents.map(({ event, id }) => {
        const detail = describeEvent(event);
        return (
          // 用 opacity-only 入场动画，避免每个 event row 都触发 transform 计算
          <m.div
            animate={{ opacity: 1 }}
            className="flex gap-3"
            initial={{ opacity: 0 }}
            key={id}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-white/6 text-fg-subtle">
              <IconTerminal2 size={13} stroke={1.7} />
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "mb-1 font-mono text-2xs",
                  detail.isError ? "text-danger" : "text-fg-subtle",
                )}
              >
                {detail.title}
              </div>
              <pre className="scroll-thin overflow-x-auto whitespace-pre-wrap rounded-md bg-white/2.5 px-3 py-2 font-mono text-xs text-fg-muted leading-relaxed">
                {detail.body}
              </pre>
            </div>
          </m.div>
        );
      })}
    </div>
  );
}
