import {
  IconBolt,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconFolder,
  IconLayoutSidebar,
  IconMenu2,
  IconMessageCircle,
  IconSearch,
  IconSettings,
  IconSparkles,
} from "@tabler/icons-react";
import { m } from "motion/react";
import type { ReactNode } from "react";
import type { AgentSessionInfo, WorkspaceInfo } from "../../../shared/contracts";
import { cn } from "../lib/cn";
import { Tooltip } from "./ui/Tooltip";

type SidebarProps = {
  workspaces: WorkspaceInfo[];
  activeWorkspace: WorkspaceInfo | null;
  agentSession: AgentSessionInfo | null;
  onOpenWorkspace(): void;
  onSelectWorkspace(workspace: WorkspaceInfo): void;
  onNewSession(): void;
  canCreateSession: boolean;
};

export function Sidebar({
  workspaces,
  activeWorkspace,
  agentSession,
  onOpenWorkspace,
  onSelectWorkspace,
  onNewSession,
  canCreateSession,
}: SidebarProps) {
  const primary = workspaces.slice(0, 4);
  const secondary = workspaces.slice(4);

  return (
    // 侧栏宽度 230px —— Cursor 桌面侧栏实际约 220-235px，比之前 220 略宽一点能撑住 nav row
    // 右侧 border 用 -strong（10% 白）—— 与 menubar 底部 border 一致，把三大区域视觉切块
    <aside className="flex w-[230px] min-w-[230px] flex-col border-hairline-strong border-r bg-panel">
      {/* 顶部工具行 36px 高，左 sidebar/search、右 ← → */}
      <div className="app-drag flex h-9 items-center gap-0.5 px-2">
        <IconTool drag={false} label="Toggle sidebar">
          <IconLayoutSidebar size={16} stroke={1.55} />
        </IconTool>
        <IconTool drag={false} label="Search">
          <IconSearch size={15} stroke={1.55} />
        </IconTool>
        <div className="flex-1" />
        <IconTool drag={false} label="Back">
          <IconChevronLeft size={15} stroke={1.6} />
        </IconTool>
        <IconTool drag={false} label="Forward">
          <IconChevronRight size={15} stroke={1.6} />
        </IconTool>
      </div>

      {/* 主入口 + 列表（可滚） —— 与上方留 4px 间距，整体内边距 8px */}
      <div className="scroll-thin flex-1 overflow-y-auto px-2 pt-1 pb-2">
        <NavRow
          highlight
          icon={<IconBolt size={16} stroke={1.6} />}
          onClick={onNewSession}
          disabled={!canCreateSession}
          trailing={<Shortcut>⌃N</Shortcut>}
        >
          New session
        </NavRow>
        <NavRow icon={<IconClock size={16} stroke={1.55} />}>Automations</NavRow>
        <NavRow icon={<IconSparkles size={16} stroke={1.55} />}>Customize</NavRow>

        <SectionLabel>Workspaces</SectionLabel>

        {primary.length === 0 ? (
          <NavRow icon={<IconFolder size={16} stroke={1.55} />} muted onClick={onOpenWorkspace}>
            Open a repository…
          </NavRow>
        ) : (
          primary.map((workspace) => (
            <WorkspaceItem
              activeSession={agentSession}
              isActive={activeWorkspace?.id === workspace.id}
              key={workspace.id}
              onSelect={() => onSelectWorkspace(workspace)}
              workspace={workspace}
            />
          ))
        )}

        {primary.length >= 4 ? <SeeMore /> : null}

        {secondary.length > 0 ? (
          <div className="mt-3">
            {secondary.map((workspace) => (
              <WorkspaceItem
                activeSession={agentSession}
                isActive={activeWorkspace?.id === workspace.id}
                key={workspace.id}
                onSelect={() => onSelectWorkspace(workspace)}
                workspace={workspace}
              />
            ))}
          </div>
        ) : null}

        <div className="mt-3">
          <NavRow icon={<IconFolder size={16} stroke={1.55} />} muted onClick={onOpenWorkspace}>
            Open workspace
          </NavRow>
        </div>
      </div>

      {/* 账户行 —— 复刻 Cursor 底部：头像 + 双行信息 + 菜单/设置，无商业 Update 按钮 */}
      <div className="app-no-drag px-2 pt-1.5 pb-2">
        <div className="flex h-[32px] items-center gap-2">
          <Avatar />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium leading-[13px] text-fg-muted">
              {activeWorkspace?.displayName ?? "Local workspace"}
            </div>
            <div className="truncate text-[12px] font-normal leading-[13px] text-fg-faint">
              Local agent
            </div>
          </div>
          <IconTool label="More">
            <IconMenu2 size={15} stroke={1.5} />
          </IconTool>
          <IconTool label="Settings">
            <IconSettings size={15} stroke={1.5} />
          </IconTool>
        </div>
      </div>
    </aside>
  );
}

function WorkspaceItem({
  workspace,
  isActive,
  activeSession,
  onSelect,
}: {
  workspace: WorkspaceInfo;
  isActive: boolean;
  activeSession: AgentSessionInfo | null;
  onSelect(): void;
}) {
  return (
    <>
      <NavRow
        active={isActive}
        icon={<IconFolder size={16} stroke={1.55} />}
        layoutHighlight={isActive}
        onClick={onSelect}
        title={workspace.rootPath}
      >
        {workspace.displayName}
      </NavRow>
      {isActive && activeSession ? (
        <SessionRow title={activeSession.title} status={activeSession.status} />
      ) : null}
    </>
  );
}

function SessionRow({ title, status }: { title: string; status: string }) {
  // 缩进 28px（icon 宽 + gap），13px font，行高 30px 与父 nav row 一致
  return (
    <div className="group flex h-[30px] items-center gap-2 rounded-md pr-2 pl-[30px] text-sm font-normal text-fg-muted hover:bg-hover hover:text-fg">
      <IconMessageCircle className="shrink-0 text-fg-faint" size={12} stroke={1.55} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="shrink-0 text-2xs text-fg-faint">{status}</span>
    </div>
  );
}

function SeeMore() {
  return (
    <button
      className="ml-[30px] flex h-[30px] items-center text-sm font-normal text-fg-subtle transition-colors hover:text-fg"
      type="button"
    >
      See more
    </button>
  );
}

function NavRow({
  icon,
  children,
  onClick,
  active = false,
  muted = false,
  disabled = false,
  trailing,
  layoutHighlight = false,
  highlight = false,
  title,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  muted?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
  layoutHighlight?: boolean;
  highlight?: boolean;
  title?: string;
}) {
  // 行高 30px、字号 13px、font-weight 400、左 padding 8px、icon 与文字 gap 10px
  return (
    <button
      className={cn(
        "group relative flex h-[30px] w-full items-center gap-2.5 rounded-md px-2 text-left text-sm font-normal transition-colors",
        active ? "text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
        highlight && "bg-active text-fg hover:bg-active",
        muted && "text-fg-subtle hover:text-fg-muted",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-fg-subtle",
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {active && layoutHighlight ? (
        // 选中高亮：tween + ease-out 120ms —— 比 spring 更稳定，无低帧机抖动
        <m.span
          className="absolute inset-0 rounded-md bg-active"
          layoutId="sidebar-active"
          transition={{ duration: 0.12, ease: "easeOut" }}
        />
      ) : null}
      <span
        className={cn(
          "relative shrink-0",
          active || highlight ? "text-fg" : "text-fg-subtle group-hover:text-fg-muted",
        )}
      >
        {icon}
      </span>
      <span className="relative flex min-w-0 flex-1 items-center truncate">{children}</span>
      {trailing ? <span className="relative shrink-0">{trailing}</span> : null}
    </button>
  );
}

function Shortcut({ children }: { children: string }) {
  return <kbd className="font-sans text-xs font-normal text-fg-faint">{children}</kbd>;
}

function SectionLabel({ children }: { children: string }) {
  // 区段标签 13px、灰色、上 16px 间距，正常大小写
  return (
    <div className="px-2 pt-4 pb-1 text-sm font-normal text-fg-subtle">{children}</div>
  );
}

function Avatar() {
  return (
    <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/6 font-mono text-[9px] font-normal text-fg-subtle">
      ID
    </div>
  );
}

function IconTool({
  children,
  label,
  drag = true,
}: {
  children: ReactNode;
  label: string;
  drag?: boolean;
}) {
  return (
    <Tooltip content={label}>
      <button
        aria-label={label}
        className={cn(
          "flex size-7 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle",
          !drag && "app-no-drag",
        )}
        type="button"
      >
        {children}
      </button>
    </Tooltip>
  );
}
