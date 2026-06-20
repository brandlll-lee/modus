import { type PointerEvent as ReactPointerEvent, useCallback, useState } from "react";
import type {
  AgentSessionInfo,
  ContextUsageInfo,
  ModelInfo,
  PlanRef,
  WorkspaceInfo,
} from "../../../../shared/contracts";
import { ModusBot } from "../../components/ui/ModusBot";
import type { AgentEventHub } from "../agent/agentEventHub";
import { ChatPane } from "../agent/ChatPane";
import { subagentColor } from "../agent/subagentUi";

const MIN_RAIL_WIDTH = 48;
const MAX_RAIL_WIDTH = 280;
const COLLAPSED_RAIL_WIDTH = 80;

type SubagentsPanelProps = {
  parentSessionId?: string | undefined;
  sessions: AgentSessionInfo[];
  selectedId?: string | undefined;
  hub: AgentEventHub;
  models: ModelInfo[];
  defaultModel: string;
  contextUsageBySession: Record<string, ContextUsageInfo>;
  workspace: WorkspaceInfo | null;
  onSelect(id: string): void;
  onSessionsChanged(): void;
  onModelChange(model: string): void;
  onModelConfigChange(model: string, thinkingVariant: string): Promise<void> | void;
  onOpenReview(): void;
  onOpenSubagent(childSessionId: string): void;
  onPlanUpdated(plan: PlanRef): void;
};

export function SubagentsPanel({
  parentSessionId,
  sessions,
  selectedId,
  hub,
  models,
  defaultModel,
  contextUsageBySession,
  workspace,
  onSelect,
  onSessionsChanged,
  onModelChange,
  onModelConfigChange,
  onOpenReview,
  onOpenSubagent,
  onPlanUpdated,
}: SubagentsPanelProps) {
  const [railWidth, setRailWidth] = useState(192);
  const subagents = sessions.filter((session) => session.parentSessionId === parentSessionId);
  const selected =
    subagents.find((session) => session.id === selectedId) ?? subagents[0] ?? undefined;
  const collapsed = railWidth <= COLLAPSED_RAIL_WIDTH;

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = railWidth;
      const move = (moveEvent: PointerEvent) => {
        setRailWidth(clampRailWidth(startWidth + moveEvent.clientX - startX));
      };
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop, { once: true });
    },
    [railWidth],
  );

  if (!parentSessionId || subagents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-fg-faint text-sm">
        No subagents yet.
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0">
      <div className="relative shrink-0 border-hairline border-r p-2" style={{ width: railWidth }}>
        <div className="space-y-1">
          {subagents.map((session) => {
            const active = isSubagentLive(session.status);
            const selectedRow = session.id === selected?.id;
            return (
              <button
                className={`flex min-h-10 w-full min-w-0 items-center rounded-md text-left text-xs transition-colors ${
                  collapsed ? "justify-center px-0" : "gap-2 px-2 py-1.5"
                } ${
                  selectedRow ? "bg-active text-fg" : "text-fg-subtle hover:bg-hover hover:text-fg"
                }`}
                key={session.id}
                onClick={() => onSelect(session.id)}
                title={session.subagentTask ?? session.title}
                type="button"
              >
                <ModusBot
                  active={active}
                  busy={active}
                  className="size-5 shrink-0"
                  color={subagentColor(session.id)}
                />
                {collapsed ? null : (
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {session.subagentTask ?? session.title}
                    </div>
                    <div className="mt-0.5 truncate text-fg-faint">
                      {[session.status, session.model].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <div
          aria-hidden
          className="-right-1 absolute top-0 h-full w-2 cursor-col-resize select-none"
          onPointerDown={beginResize}
        />
      </div>
      <div className="min-w-0 flex-1">
        {selected ? (
          <ChatPane
            botColor={subagentColor(selected.id)}
            contextUsage={contextUsageBySession[selected.id]}
            defaultModel={defaultModel}
            hub={hub}
            key={selected.id}
            models={models}
            onModelChange={onModelChange}
            onModelConfigChange={onModelConfigChange}
            onOpenReview={onOpenReview}
            onOpenSubagent={onOpenSubagent}
            onPlanUpdated={onPlanUpdated}
            onSessionsChanged={onSessionsChanged}
            session={selected}
            workspace={workspace}
          />
        ) : null}
      </div>
    </div>
  );
}

function clampRailWidth(width: number): number {
  return Math.max(MIN_RAIL_WIDTH, Math.min(MAX_RAIL_WIDTH, width));
}

function isSubagentLive(status: AgentSessionInfo["status"]): boolean {
  return status === "starting" || status === "running";
}
