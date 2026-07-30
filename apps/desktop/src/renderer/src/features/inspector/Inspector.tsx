import { Tabs } from "@base-ui/react/tabs";
import {
  IconFileText,
  IconGitBranch,
  IconGridDots,
  IconLayoutList,
  IconLayoutSidebarRight,
  IconShieldCheck,
  IconShieldX,
  IconTerminal2,
  IconWorld,
} from "@tabler/icons-react";
import { animate, m, useMotionValue } from "motion/react";
import {
  lazy,
  type PointerEvent,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import type { SecurityState } from "../../../../preload/types";
import type {
  AgentSessionInfo,
  ContextItem,
  ContextUsageInfo,
  ModelInfo,
  PlanRef,
  WorkspaceInfo,
} from "../../../../shared/contracts";
import { ChromeMoreMenu } from "../../components/ui/ChromeMoreMenu";
import { ModusLoadingFallback } from "../../components/ui/ModusLoadingMark";
import { PanelHeader } from "../../components/ui/Panel";
import { ToolbarButton, TOOLBAR_ICON } from "../../components/ui/ToolbarButton";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import type { AgentEventHub } from "../agent/agentEventHub";
import { DiffPanel } from "../diff/DiffPanel";
import { FilesPanel } from "../files/FilesPanel";
import { PlanPanel } from "../plan/PlanPanel";
import { INSPECTOR_MIN_WIDTH } from "./inspector-layout";
import { SubagentsPanel } from "./SubagentsPanel";

type InspectorProps = {
  activeWorkspace: WorkspaceInfo | null;
  cwd?: string | undefined;
  sessionId?: string | undefined;
  securityState: SecurityState | null;
  open: boolean;
  width: number;
  /** Upper bound from App so the panel can't crush the main column's min width. */
  maxWidth: number;
  /** Controlled active tab (App drives it so events can switch to Files). */
  tab?: string | undefined;
  onTabChange?(tab: string): void;
  /** The session's active plan, shown in the Plan tab (not the file tree). */
  plan?: PlanRef | undefined;
  sessions: AgentSessionInfo[];
  selectedSubagentId?: string | undefined;
  hub: AgentEventHub;
  models: ModelInfo[];
  defaultModel: string;
  contextUsageBySession: Record<string, ContextUsageInfo>;
  onSelectSubagent(id: string | undefined): void;
  onSessionsChanged(): void;
  onModelChange(model: string): void;
  onModelConfigChange(model: string, thinkingVariant: string): Promise<void> | void;
  onOpenReview(cwd?: string): void;
  onOpenSettings(): void;
  onOpenSubagent(childSessionId: string): void;
  onPlanUpdated(plan: PlanRef): void;
  onOpenChange(open: boolean): void;
  onWidthChange(width: number): void;
  onAddToChat?(item: ContextItem): void;
  revealPath?: string | undefined;
  onRevealConsumed?(): void;
  /** Select this terminal when the Terminal tab opens (composer rail click). */
  revealTerminalId?: string | undefined;
  onRevealTerminalConsumed?(): void;
};

const INSPECTOR_MAX_WIDTH = 1040;
const INSPECTOR_BROWSER_PREFERRED_WIDTH = 760;
const INSPECTOR_COLLAPSED_WIDTH = 0;
const INSPECTOR_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;
const loadBrowserPanel = () => import("../browser/BrowserPanel");
const loadTerminalPanel = () => import("../terminal/TerminalPanel");
const BrowserPanel = lazy(() =>
  loadBrowserPanel().then(({ BrowserPanel: Component }) => ({ default: Component })),
);
const TerminalPanel = lazy(() =>
  loadTerminalPanel().then(({ TerminalPanel: Component }) => ({
    default: Component,
  })),
);

const TABS = [
  {
    value: "changes",
    label: "Changes",
    icon: <IconGitBranch size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />,
  },
  {
    value: "plan",
    label: "Plan",
    icon: <IconLayoutList size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />,
  },
  {
    value: "files",
    label: "Files",
    icon: <IconFileText size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />,
  },
  {
    value: "subagents",
    label: "Subagents",
    icon: <IconGridDots size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />,
  },
  {
    value: "browser",
    label: "Browser",
    icon: <IconWorld size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />,
  },
  {
    value: "terminal",
    label: "Terminal",
    icon: <IconTerminal2 size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />,
  },
  {
    value: "security",
    label: "Security",
    icon: <IconShieldCheck size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />,
  },
];

export function Inspector({
  activeWorkspace,
  cwd,
  sessionId,
  securityState,
  open,
  width,
  maxWidth,
  tab: controlledTab,
  onTabChange,
  plan,
  sessions,
  selectedSubagentId,
  hub,
  models,
  defaultModel,
  contextUsageBySession,
  onSelectSubagent,
  onSessionsChanged,
  onModelChange,
  onModelConfigChange,
  onOpenReview,
  onOpenSettings,
  onOpenSubagent,
  onPlanUpdated,
  onOpenChange,
  onWidthChange,
  onAddToChat,
  revealPath,
  onRevealConsumed,
  revealTerminalId,
  onRevealTerminalConsumed,
}: InspectorProps) {
  const dragStartRef = useRef<{ x: number; width: number } | null>(null);
  const latestWidthRef = useRef(width);
  const [contentVisible, setContentVisible] = useState(open);
  const [internalTab, setInternalTab] = useState("changes");
  const tab = controlledTab ?? internalTab;
  const [browserVisited, setBrowserVisited] = useState(tab === "browser");
  const [terminalVisited, setTerminalVisited] = useState(tab === "terminal");
  const shouldRenderBrowser = browserVisited || tab === "browser";
  const shouldRenderTerminal = terminalVisited || tab === "terminal";
  const setTab = (value: string): void => {
    onTabChange?.(value);
    if (controlledTab === undefined) {
      setInternalTab(value);
    }
  };
  // Width is a motion value, not React state: dragging calls `.set()` which
  // writes straight to the DOM (batched to a frame) WITHOUT re-rendering App and
  // its heavy Timeline on every pointermove. open/close still animates smoothly;
  // the drag tracks the cursor 1:1 with no layout-property tween fighting it.
  const panelWidth = useMotionValue(open ? width : INSPECTOR_COLLAPSED_WIDTH);

  useEffect(() => {
    const idleCallback = window.requestIdleCallback(() => {
      void Promise.allSettled([loadBrowserPanel(), loadTerminalPanel()]);
    });
    return () => window.cancelIdleCallback(idleCallback);
  }, []);

  useEffect(() => {
    if (open && tab === "browser" && width < INSPECTOR_BROWSER_PREFERRED_WIDTH) {
      onWidthChange(Math.min(INSPECTOR_MAX_WIDTH, maxWidth, INSPECTOR_BROWSER_PREFERRED_WIDTH));
    }
  }, [open, onWidthChange, tab, width, maxWidth]);

  useEffect(() => {
    if (tab === "browser") {
      setBrowserVisited(true);
    }
    if (tab === "terminal") {
      setTerminalVisited(true);
    }
  }, [tab]);

  // Drive the open/close animation and keep the motion value in sync when `width`
  // changes from a committed drag or an external update. We never re-animate while
  // a drag is in flight (the pointer owns the value then).
  useEffect(() => {
    if (dragStartRef.current) {
      return;
    }
    latestWidthRef.current = width;
    if (!open) {
      setContentVisible(false);
    }
    const controls = animate(panelWidth, open ? width : INSPECTOR_COLLAPSED_WIDTH, {
      ...INSPECTOR_TRANSITION,
      onComplete: () => {
        if (open) {
          setContentVisible(true);
        }
      },
    });
    return () => controls.stop();
  }, [open, width, panelWidth]);

  function startResize(event: PointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    dragStartRef.current = { x: event.clientX, width };
    latestWidthRef.current = width;
    event.currentTarget.setPointerCapture(event.pointerId);
    // Keep the resize cursor + kill text selection for the whole gesture without
    // a React state flip.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function resize(event: PointerEvent<HTMLButtonElement>): void {
    if (!dragStartRef.current) {
      return;
    }
    const nextWidth = Math.min(
      INSPECTOR_MAX_WIDTH,
      maxWidth,
      Math.max(
        INSPECTOR_MIN_WIDTH,
        dragStartRef.current.width + dragStartRef.current.x - event.clientX,
      ),
    );
    latestWidthRef.current = nextWidth;
    panelWidth.set(nextWidth);
  }

  function stopResize(): void {
    if (!dragStartRef.current) {
      return;
    }
    dragStartRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const finalWidth = latestWidthRef.current;
    // Drag-to-collapse: snapping below the floor closes the panel and keeps the
    // last good width (so reopening doesn't land on a sliver). Otherwise commit
    // once — the single App re-render for the entire drag.
    if (finalWidth < INSPECTOR_MIN_WIDTH + 24) {
      // Don't commit the sliver width; the effect animates the live value → 0 and
      // the last good `width` is restored on reopen.
      onOpenChange(false);
    } else {
      onWidthChange(finalWidth);
    }
  }

  return (
    <m.aside
      className={cn(
        "relative flex min-w-0 shrink-0 flex-col overflow-hidden bg-canvas",
        open && "border-hairline-strong border-l",
      )}
      style={{ width: panelWidth }}
    >
      {open ? (
        <>
          <button
            aria-label="Resize right panel"
            className="app-no-drag absolute top-0 bottom-0 left-0 z-20 w-3 cursor-col-resize before:absolute before:top-0 before:bottom-0 before:left-0 before:w-px before:bg-transparent hover:before:bg-chip-strong"
            onPointerDown={startResize}
            onPointerMove={resize}
            onPointerCancel={stopResize}
            onPointerUp={stopResize}
            type="button"
          />
          {contentVisible ? (
            <m.div
              animate={{ opacity: 1 }}
              className="flex min-h-0 flex-1 flex-col"
              initial={{ opacity: 0 }}
              style={{ width: panelWidth }}
              transition={{ duration: 0.08, ease: "linear" }}
            >
              <Tabs.Root
                className="flex min-h-0 flex-1 flex-col"
                onValueChange={(value) => setTab(value as string)}
                value={tab}
              >
                <div className="toolbar-row flex shrink-0 items-center bg-canvas px-2">
                  <Tabs.List className="relative flex min-w-0 flex-1 items-center gap-0.5">
                    {TABS.map((tab) => (
                      <Tooltip content={tab.label} key={tab.value} side="bottom" sideOffset={6}>
                        <Tabs.Tab
                          aria-label={tab.label}
                          className={cn(
                            "toolbar-icon-button relative z-10 flex items-center justify-center rounded-md text-sm font-normal transition-colors outline-none hover:bg-hover data-selected:text-[var(--color-icon)]",
                          )}
                          value={tab.value}
                        >
                          {tab.icon}
                        </Tabs.Tab>
                      </Tooltip>
                    ))}
                    <Tabs.Indicator className="absolute top-1/2 left-0 z-0 h-6.5 w-(--active-tab-width) -translate-y-1/2 translate-x-(--active-tab-left) rounded-md bg-active transition-all duration-200 ease-out-quint" />
                  </Tabs.List>
                  <div className="ml-1 flex shrink-0 items-center gap-0.5">
                    <ChromeMoreMenu onOpenSettings={onOpenSettings} />
                    <ToolbarButton
                      label="Collapse right panel"
                      onClick={() => onOpenChange(false)}
                    >
                      <IconLayoutSidebarRight
                        size={TOOLBAR_ICON.size}
                        stroke={TOOLBAR_ICON.stroke}
                      />
                    </ToolbarButton>
                  </div>
                </div>

                <Tabs.Panel className="min-h-0 flex-1 outline-none" value="changes">
                  <DiffPanel cwd={cwd} sessionId={sessionId} workspaceId={activeWorkspace?.id} />
                </Tabs.Panel>
                <Tabs.Panel className="min-h-0 flex-1 outline-none" value="plan">
                  <PlanPanel plan={plan} />
                </Tabs.Panel>
                <Tabs.Panel className="min-h-0 flex-1 outline-none" value="files">
                  <FilesPanel
                    cwd={cwd}
                    onAddToChat={onAddToChat}
                    onRevealConsumed={onRevealConsumed}
                    revealPath={revealPath}
                  />
                </Tabs.Panel>
                <Tabs.Panel className="min-h-0 flex-1 outline-none" value="subagents">
                  <SubagentsPanel
                    contextUsageBySession={contextUsageBySession}
                    defaultModel={defaultModel}
                    hub={hub}
                    models={models}
                    onModelChange={onModelChange}
                    onModelConfigChange={onModelConfigChange}
                    onOpenReview={onOpenReview}
                    onOpenPlan={(nextPlan) => {
                      onPlanUpdated(nextPlan);
                      onTabChange?.("plan");
                    }}
                    onOpenSubagent={onOpenSubagent}
                    onPlanUpdated={onPlanUpdated}
                    onSelect={onSelectSubagent}
                    onSessionsChanged={onSessionsChanged}
                    parentSessionId={sessionId}
                    selectedId={selectedSubagentId}
                    sessions={sessions}
                    workspace={activeWorkspace}
                  />
                </Tabs.Panel>
                <Tabs.Panel className="min-h-0 flex-1 outline-none" keepMounted value="browser">
                  {shouldRenderBrowser ? (
                    <Suspense fallback={<ModusLoadingFallback />}>
                      <BrowserPanel active={tab === "browser"} workspaceId={activeWorkspace?.id} />
                    </Suspense>
                  ) : null}
                </Tabs.Panel>
                <Tabs.Panel className="min-h-0 flex-1 outline-none" keepMounted value="terminal">
                  {shouldRenderTerminal ? (
                    <Suspense fallback={<ModusLoadingFallback />}>
                      <TerminalPanel
                        active={tab === "terminal"}
                        key={activeWorkspace?.id ?? "none"}
                        {...(cwd ? { cwd } : {})}
                        {...(onRevealTerminalConsumed ? { onRevealTerminalConsumed } : {})}
                        {...(revealTerminalId ? { revealTerminalId } : {})}
                        {...(sessionId ? { sessionId } : {})}
                        {...(activeWorkspace?.id ? { workspaceId: activeWorkspace.id } : {})}
                      />
                    </Suspense>
                  ) : null}
                </Tabs.Panel>
                <Tabs.Panel
                  className="scroll-thin min-h-0 flex-1 overflow-y-auto outline-none"
                  value="security"
                >
                  <SecurityPanel securityState={securityState} />
                </Tabs.Panel>
              </Tabs.Root>
            </m.div>
          ) : null}
        </>
      ) : null}
    </m.aside>
  );
}

function SecurityPanel({ securityState }: { securityState: SecurityState | null }) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Security" />
      <div className="space-y-0.5 px-2 py-1">
        {securityState ? (
          Object.entries(securityState).map(([key, value]) => (
            <div
              className="flex items-center justify-between rounded-lg px-2.5 py-2 transition-colors hover:bg-hover"
              key={key}
            >
              <span className="font-mono text-xs text-fg-muted">{key}</span>
              <span
                className={cn(
                  "flex items-center gap-1.5 text-2xs",
                  value ? "text-fg-subtle" : "text-danger",
                )}
              >
                {value ? (
                  <IconShieldCheck size={15} stroke={1.6} />
                ) : (
                  <IconShieldX size={15} stroke={1.6} />
                )}
                {value ? "enforced" : "off"}
              </span>
            </div>
          ))
        ) : (
          <div className="px-2.5 py-2 text-sm text-fg-subtle">Loading preload IPC state…</div>
        )}
      </div>
    </div>
  );
}
