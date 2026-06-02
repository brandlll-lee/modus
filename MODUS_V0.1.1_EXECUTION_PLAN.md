# Modus V0.1.1 执行方案

状态：执行前方案  
日期：2026-06-02  
定位：V0.2 能力的第一条可交付切片  
目标：把 Modus 从 `pi --mode rpc` 外部进程接入升级为基于 PI SDK 的 Agent Host，并补齐 Cursor Agent Window / Prompting 的首批核心体验。

## 0. 调研基线

本方案基于本仓库源码阅读、CodeGraph 结构化索引、PI 官方文档、Cursor 官方文档，以及当前项目依赖的官方资料。当前 first-party 核心源码规模较小，本次已覆盖桌面端 main/preload/renderer、shared contracts、packages、Rust PTY sidecar、README、V0.1.0 执行方案和安全文档。

### 0.1 已查阅的本地源码

- Electron main：`apps/desktop/src/main/index.ts`、`windows/main-window.ts`、`ipc/channels.ts`、`ipc/register-app-ipc.ts`
- Agent runtime：`apps/desktop/src/main/agent/pi-rpc-service.ts`、`agent-store.ts`、`jsonl.ts`
- Local services：`db/database.ts`、`workspace/*`、`git/git-service.ts`、`permissions/permission-store.ts`、`terminal/terminal-service.ts`
- Preload/API：`apps/desktop/src/preload/index.ts`、`preload/types.ts`
- Renderer：`App.tsx`、`Composer.tsx`、`Timeline.tsx`、`Inspector.tsx`、`DiffPanel.tsx`、`TerminalPanel.tsx`、`Sidebar.tsx`
- UI primitives/style：`Panel.tsx`、`Tooltip.tsx`、`TypingAnimation.tsx`、`app.css`
- Shared packages：`packages/agent-protocol`、`packages/core`、`packages/ui`
- Rust sidecar：`crates/pty-host/src/main.rs`

### 0.2 MCP / Web 文档来源

- CodeGraph MCP：用于当前架构、符号、调用链和改造触点定位。
- Context7 MCP：`/earendil-works/pi`、`/electron/electron`、`/facebook/react/v19_2_0`、`/mui/base-ui`、`/xtermjs/xterm.js`、`/microsoft/monaco-editor`、`/tailwindlabs/tailwindcss.com`。
- Exa MCP / Tavily MCP：交叉检索 Cursor Agent Window、Cursor Prompting、PI SDK/RPC 官方页面。
- WebFetch / WebSearch：读取 Cursor 官方中文/英文文档。

### 0.3 关键官方资料

- Cursor Agent Window：`https://cursor.com/cn/docs/agent/agents-window`
- Cursor Prompting：`https://cursor.com/cn/docs/agent/prompting`
- PI SDK：`https://pi.dev/docs/latest/sdk`
- PI RPC：`https://pi.dev/docs/latest/rpc`
- PI Extensions：`https://pi.dev/docs/latest/extensions`
- Electron IPC / contextBridge / security docs
- Base UI Select / Combobox docs
- xterm.js `SerializeAddon` / `FitAddon` docs
- Tailwind CSS v4 `@theme` docs

## 1. 当前状态判断

V0.1.0 已经具备一个能启动、能打开 workspace、能创建 agent session、能显示 PI RPC JSONL、能打开 PTY terminal、能查看 diff、能记录 permission decision、能管理 worktree 的工程 MVP。

但它当前仍然是 **外部 PI CLI RPC adapter**：

```ts
spawn("pi", ["--mode", "rpc", "--session-dir", sessionDir, "--name", input.title], {
  cwd: input.cwd,
  windowsHide: true,
});
```

当前 renderer 发送 prompt 的路径是：

```text
Composer.send()
  -> App.submitPrompt()
  -> window.modus.agent.prompt()
  -> ipcMain.handle("agent:prompt")
  -> promptPiSession()
  -> child.stdin.write({ type: "prompt", message })
```

当前 agent event 协议只有：

```ts
type AgentEvent =
  | { type: "agent.stdout"; sessionId: string; line: unknown }
  | { type: "agent.stderr"; sessionId: string; data: string }
  | { type: "agent.exit"; sessionId: string; exitCode: number | null }
  | { type: "agent.error"; sessionId: string; message: string };
```

这意味着 UI 只能显示 stdout/stderr 日志，而不是 Cursor 级 Agent Window 需要的 message streaming、tool cards、permission cards、context usage、queue、compaction、diff review flow。

## 2. V0.1.1 产品目标

V0.1.1 是 V0.2 的第一条可交付切片，不追求一次性完成 Cursor 全量能力，而是先把基础架构换对。

必须完成：

1. PI 深度集成：引入 `@earendil-works/pi-coding-agent` SDK，建立 Modus 自有 Agent Host 层。
2. Agent Window 对标 Cursor 的本地核心能力：多工作区基础、session sidebar、structured timeline、diff/terminal/worktree inspector。
3. Prompting 首批能力：
   - 在 Composer 输入 `@` 触发建议。
   - 支持 `@file`、`@folder`。
   - 支持 `@Docs` 的本地文档索引雏形。
   - 支持 `@Terminals` 选择终端输出作为上下文。
   - 支持模型下拉切换和 Windows/Linux `Ctrl+/` 循环模型。
4. UI 必须复用当前组件、设计 token、dark grayscale 风格、Base UI popup/select 形态、`PanelHeader`/`Tooltip`/`cn` 等基础设施。

明确不做：

- 不做完整云端 agent。
- 不做 Slack/GitHub/Linear/mobile 协作。
- 不做完整浏览器上下文。
- 不做完整 `@Past Chats`。
- 不做完整 PR 管理。
- 不 fork PI 源码。

## 3. 官方文档结论

### 3.1 Cursor Agent Window

Cursor 官方文档将 Agent Window 定义为 agent-first interface，提供跨 repo / local / cloud / remote SSH 的统一 agent 工作区。独有能力包括：

- Multi-workspace
- New diffs view
- Parallel agents
- Local/cloud handoff
- Worktrees

Modus V0.1.1 应先对标本地可实现部分：

- 多 workspace 列表和 session 入口：已有，需扩展为多 session。
- Diff view：已有 Monaco diff MVP，需接入 agent event / checkpoint。
- Parallel agents：先做多 session 数据模型，不做真正并行调度 UI 的完整版本。
- Worktrees：已有 list/create/delete，需绑定 session。
- Local/cloud handoff：V0.1.1 不做云端。

### 3.2 Cursor Prompting

Cursor 官方 prompting 文档确认：

- 输入 `@` 后显示匹配建议。
- 文件/文件夹：`@auth.ts`、`@src/components/`，文件夹选中后输入 `/` 可继续向下浏览。
- Docs：`@Docs` 搜索已索引文档，可添加新 doc。
- Terminals：`@Terminals` 将终端输出加入上下文。
- 支持图片、语音、上下文用量环、模型切换。
- 模型下拉改变当前会话后续消息；快捷键为 macOS `Cmd+/`，Windows/Linux 对应 `Ctrl+/`。

V0.1.1 只实现用户明确点名的：

- `@` suggestions
- files/folders
- `@Docs`
- `@Terminals`
- model dropdown
- `Ctrl+/` model cycle

### 3.3 PI SDK

PI 官方 SDK 文档明确建议：Node.js / TypeScript 应用需要深度集成时，优先使用 `AgentSession` / `createAgentSessionRuntime()`，而不是 spawn subprocess。

SDK 关键能力：

- `createAgentSession()`
- `AgentSession.prompt()`
- `AgentSession.abort()`
- `AgentSession.subscribe()`
- `AgentSession.dispose()`
- `AgentSession.messages`
- `AgentSession.sessionFile`
- `AgentSession.sessionId`
- `AgentSession.setModel()`
- `createAgentSessionRuntime()`
- `createAgentSessionServices()`
- `createAgentSessionFromServices()`
- `SessionManager`
- `AuthStorage`
- `ModelRegistry`
- `ExtensionAPI`
- `defineTool()`
- `pi.on("tool_call")`
- `pi.registerTool()`

V0.1.1 应使用 SDK，而不是复制 PI 源码。PI 是 runtime kernel，Modus 是 Agent Host / product shell。

### 3.4 PI Extensions / Permission

PI extension 的 `tool_call` 事件在工具执行前触发，可以阻塞：

```ts
pi.on("tool_call", async (event) => {
  if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
    return { block: true, reason: "Blocked by Modus permission broker" };
  }
});
```

文档确认：

- `event.input` 可变，修改后影响实际工具执行。
- 返回 `{ block: true, reason }` 可阻止工具。
- `ctx.ui.confirm()` 可请求用户确认。

这正好用于把 PI built-in tools 接入 Modus permission broker。

### 3.5 Electron

Electron 官方文档确认当前安全方向正确：

- preload 通过 `contextBridge.exposeInMainWorld()` 暴露有限 API。
- renderer 不应拿到原始 `ipcRenderer`。
- request/response 用 `ipcMain.handle()` + `ipcRenderer.invoke()`。
- callback 不应暴露原始 `IpcRendererEvent`。

V0.1.1 继续保持：

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- sender validation

PI SDK Agent Host 不应长期压在 renderer。推荐阶段性做法：

1. 第一阶段先在 Electron main 内接 SDK，验证类型和事件流。
2. 第二阶段迁到 Agent Host process：Electron `utilityProcess` 或 `child_process.fork()`，但运行的是 Modus host，不是外部 `pi` CLI。

## 4. 目标架构

```text
Modus Desktop
├─ Electron Main
│  ├─ secure IPC
│  ├─ workspace/git/db/diff/permission services
│  ├─ agent runtime registry
│  └─ agent host supervisor
│
├─ Agent Host
│  ├─ imports @earendil-works/pi-coding-agent
│  ├─ PiSdkRuntime
│  ├─ Modus permission extension
│  ├─ Modus context resolver
│  └─ Pi event normalizer
│
├─ Preload
│  └─ typed window.modus API
│
└─ Renderer
   ├─ Sidebar: workspaces + sessions
   ├─ Timeline: messages + tool cards + permission cards
   ├─ Composer: @ context + model picker
   └─ Inspector: diff + terminal + worktrees + security/context
```

## 5. 代码改造计划

### M1: Agent Runtime 抽象

新增：

```text
apps/desktop/src/main/agent/runtime.ts
apps/desktop/src/main/agent/pi-sdk-runtime.ts
apps/desktop/src/main/agent/pi-event-normalizer.ts
apps/desktop/src/main/agent/pi-permission-extension.ts
apps/desktop/src/main/agent/context-resolver.ts
```

目标接口：

```ts
export type CreateAgentRuntimeInput = {
  workspaceId: string;
  cwd: string;
  title: string;
  model: string;
};

export type PromptAgentInput = {
  sessionId: string;
  message: string;
  context: ContextItem[];
};

export type AgentRuntime = {
  create(input: CreateAgentRuntimeInput): Promise<AgentSessionInfo>;
  prompt(input: PromptAgentInput): Promise<void>;
  abort(sessionId: string): Promise<void>;
  dispose(sessionId: string): Promise<void>;
  setModel(sessionId: string, model: string): Promise<void>;
};
```

保留 `pi-rpc-service.ts` 作为 fallback，但默认 runtime 切到 SDK。

### M2: 引入 PI SDK

依赖：

```bash
npm --workspace @modus/desktop install @earendil-works/pi-coding-agent
```

如果实现 custom tools 或 extension typing 需要，再补：

```bash
npm --workspace @modus/desktop install typebox @earendil-works/pi-ai
```

实现原则：

- 初版使用 `createAgentSession()` 打通 prompt/subscribe/abort。
- 方案中预留 `createAgentSessionRuntime()`，用于后续 resume/fork/clone/import/compaction。
- `SessionManager` 存储目录放在 `app.getPath("userData")/pi-sessions`。
- Modus SQLite 存自己的 metadata 和 PI session file/session id。

### M3: AgentEvent 协议升级

修改：

```text
apps/desktop/src/shared/contracts.ts
packages/agent-protocol/src/index.ts
apps/desktop/src/preload/types.ts
apps/desktop/src/preload/index.ts
```

建议事件：

```ts
export type AgentEvent =
  | { type: "agent.started"; sessionId: string }
  | { type: "agent.ended"; sessionId: string }
  | { type: "message.started"; sessionId: string; messageId: string; role: "assistant" | "user" }
  | { type: "message.delta"; sessionId: string; messageId: string; delta: string }
  | { type: "message.completed"; sessionId: string; messageId: string }
  | { type: "thinking.delta"; sessionId: string; messageId: string; delta: string }
  | { type: "tool.started"; sessionId: string; toolCallId: string; toolName: string; args?: unknown }
  | { type: "tool.output"; sessionId: string; toolCallId: string; output: string }
  | { type: "tool.ended"; sessionId: string; toolCallId: string; isError: boolean }
  | { type: "permission.requested"; sessionId: string; request: PermissionRequest }
  | { type: "queue.updated"; sessionId: string; steering: string[]; followUp: string[] }
  | { type: "compaction.started"; sessionId: string; reason: string }
  | { type: "compaction.ended"; sessionId: string; summary?: string; aborted: boolean }
  | { type: "runtime.error"; sessionId: string; message: string };
```

PI event mapping：

| PI event | Modus event |
| --- | --- |
| `agent_start` | `agent.started` |
| `agent_end` | `agent.ended` |
| `message_start` | `message.started` |
| `message_update` text delta | `message.delta` |
| `message_update` thinking delta | `thinking.delta` |
| `message_end` | `message.completed` |
| `tool_execution_start` | `tool.started` |
| `tool_execution_update` | `tool.output` |
| `tool_execution_end` | `tool.ended` |
| `queue_update` | `queue.updated` |
| `compaction_start` | `compaction.started` |
| `compaction_end` | `compaction.ended` |
| `extension_error` | `runtime.error` |

### M4: Permission Extension

新增 Modus 内置 PI extension：

```ts
export function createModusPermissionExtension(broker: PermissionBroker): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event) => {
      // bash/write/edit/delete/mcp preflight
    });
  };
}
```

策略：

- `bash`：默认 ask。
- `write` / `edit`：敏感路径 ask，普通路径允许但记录 diff baseline。
- delete-like 操作：必须 ask。
- `git commit` / `git push` / package install：必须 ask。
- cwd 越界：deny。
- worktree session：只能写对应 worktree root。

V0.1.1 可以先实现事件和持久化，权限弹窗 UI 允许先以 Timeline card 形式出现；后续再做 modal。

### M5: Context 数据模型

修改 shared contracts：

```ts
export type ContextItem =
  | { type: "file"; path: string }
  | { type: "folder"; path: string }
  | { type: "doc"; docId: string; title: string; query?: string }
  | { type: "terminal"; terminalId: string; range?: { fromLine?: number; toLine?: number } }
  | { type: "git-diff"; mode: "working-state" | "branch"; base?: string };
```

新增 IPC：

```ts
context.search(input: { workspaceId: string; cwd: string; query: string; kind?: ContextKind }): Promise<ContextSuggestion[]>;
context.resolve(input: { cwd: string; items: ContextItem[] }): Promise<ResolvedContext[]>;
docs.list(): Promise<DocSource[]>;
docs.add(input: AddDocInput): Promise<DocSource>;
docs.search(input: { query: string }): Promise<DocHit[]>;
model.list(): Promise<ModelInfo[]>;
model.setDefault(model: string): Promise<void>;
```

V0.1.1 的 context resolver 可以先用同步本地能力：

- 文件：读文件内容，限制大小。
- 文件夹：列一级子项；选中 folder 后输入 `/` 继续 browse。
- Docs：先索引本仓库 Markdown，例如 `README.md`、`docs/**/*.md`、`MODUS_*.md`。
- Terminal：从 `TerminalPanel` 维护的 buffer 或主进程 terminal output ring buffer 提取最近输出。

### M6: Composer @ Context Picker

复用当前 `Composer.tsx`：

- 保留外层 composer container 样式。
- 保留 `TypingAnimation` placeholder。
- 保留模型下拉视觉形态。
- 新增 `ContextMentionMenu`，优先使用 Base UI `Combobox` / popup primitives。

行为：

- textarea 输入 `@` 时打开建议弹层。
- `@` 后继续输入过滤。
- 上下键移动，Enter 选择，Escape 关闭。
- 选择文件后插入 token chip，不把原始 `@file` 留在纯文本里。
- 选择 folder 后，如果继续输入 `/`，进入该 folder 下一级建议。
- `@Docs` 进入 docs search。
- `@Terminals` 显示 running/idle terminals 和最近输出摘要。

建议拆分文件：

```text
apps/desktop/src/renderer/src/features/composer/ContextMentionMenu.tsx
apps/desktop/src/renderer/src/features/composer/ContextToken.tsx
apps/desktop/src/renderer/src/features/composer/useComposerMentions.ts
apps/desktop/src/renderer/src/features/composer/models.ts
```

### M7: 模型切换

当前 `MODELS` 是前端常量：

```ts
const MODELS = [
  { value: "pi-default", name: "pi", tag: "default" },
  { value: "pi-fast", name: "pi", tag: "fast" },
  { value: "pi-reasoning", name: "pi", tag: "reasoning" },
];
```

V0.1.1 改为：

- main/Agent Host 从 PI `ModelRegistry` 获取可用模型。
- renderer `Composer` 接收 `models` 和 `activeModel`。
- `onModelChange` 调 `window.modus.agent.setModel({ sessionId, model })`。
- 没有 session 时只更新 pending/default model，新 session 用该 model 创建。
- 注册 `Ctrl+/` 快捷键循环模型。

Windows/Linux 使用 `Ctrl+/`；macOS 后续映射 `Meta+/`。

### M8: Timeline 结构化渲染

改造 `Timeline.tsx`：

- 不再 JSON stringify stdout。
- `message.delta` 聚合到 assistant bubble。
- `thinking.delta` 作为 collapsible thinking block。
- `tool.started/output/ended` 渲染 tool card。
- `permission.requested` 渲染 permission card。
- `runtime.error` 渲染 error card。

UI 复用原则：

- 继续使用 `max-w-3xl` 中央内容宽度。
- 继续使用 `scroll-thin`。
- 继续使用灰阶背景、`bg-white/2.5`、`border-hairline`。
- 新增小组件时先在 `features/agent/` 内部封装，不引入新 UI 库。

### M9: Terminal 输出作为 Context

当前 terminal renderer 已经接收 `terminal.data` 并写入 xterm，但主进程没有持久 ring buffer。

V0.1.1 需要：

- main `terminal-service.ts` 为每个 terminal 保存最近 N KB plaintext output。
- `TerminalPanel` 可继续只负责显示。
- 新增 `terminal:list` 或复用 context API 返回 terminals。
- `@Terminals` 选择 terminal 后，context resolver 注入最近输出。

xterm.js 官方 `SerializeAddon` 可用于 renderer 序列化屏幕内容，但更稳定的是 main process 记录 PTY data ring buffer，因为 context 注入发生在 Agent Host。

### M10: Docs 本地索引雏形

V0.1.1 的 `@Docs` 不做完整向量索引。

实现：

- 扫描 `README.md`、`README.zh-CN.md`、`docs/**/*.md`、`MODUS_*.md`。
- 按 heading 切 chunk。
- SQLite 表：

```sql
docs_sources(id, workspace_id, title, path, url, created_at, updated_at)
docs_chunks(id, source_id, heading, content, ordinal)
```

- 搜索：先用 case-insensitive substring + simple score。
- UI：`@Docs` 显示 docs sources，输入 query 显示 chunks。

后续 V0.2/V0.3 再接 semantic/codegraph docs index。

## 6. 数据库迁移

当前 schema 只有：

- `workspaces`
- `agent_sessions`
- `permissions`

V0.1.1 建议追加：

```sql
alter table agent_sessions add column runtime text not null default 'pi-sdk';
alter table agent_sessions add column model text;
alter table agent_sessions add column pi_session_id text;
alter table agent_sessions add column pi_session_file text;
alter table agent_sessions add column worktree_path text;

create table if not exists agent_events (
  id text primary key,
  session_id text not null references agent_sessions(id) on delete cascade,
  type text not null,
  payload_json text not null,
  created_at text not null
);

create table if not exists terminal_outputs (
  terminal_id text primary key,
  workspace_id text not null,
  cwd text not null,
  output text not null,
  updated_at text not null
);

create table if not exists docs_sources (
  id text primary key,
  workspace_id text not null,
  title text not null,
  path text,
  url text,
  created_at text not null,
  updated_at text not null
);

create table if not exists docs_chunks (
  id text primary key,
  source_id text not null references docs_sources(id) on delete cascade,
  heading text,
  content text not null,
  ordinal integer not null
);
```

注意：`node:sqlite` 是同步 API，V0.1.1 不应在 hot path 大量写 event；先做最小落库，后续再引入 DB host 或批量 flush。

## 7. 文件级执行顺序

### Phase 1: 基础协议和依赖

1. `apps/desktop/package.json`
   - 加 `@earendil-works/pi-coding-agent`。
2. `packages/agent-protocol/src/index.ts`
   - 扩展 AgentRuntimeEvent。
3. `apps/desktop/src/shared/contracts.ts`
   - 扩展 AgentEvent、ContextItem、ModelInfo、ContextSuggestion。
4. `apps/desktop/src/preload/types.ts`
   - 增加 `context`、`docs`、`model` 或 agent model methods。
5. `apps/desktop/src/main/ipc/channels.ts`
   - 增加 context/docs/model channels。

### Phase 2: PI SDK runtime

1. 新增 `runtime.ts`。
2. 新增 `pi-sdk-runtime.ts`。
3. 新增 `pi-event-normalizer.ts`。
4. 修改 `register-app-ipc.ts` 从 `pi-rpc-service` 切到 runtime registry。
5. 保留 `pi-rpc-service.ts` fallback。

### Phase 3: Context services

1. 新增 `context/context-service.ts`。
2. 新增 `docs/docs-store.ts`、`docs/docs-service.ts`。
3. 扩展 `terminal-service.ts`，记录 output ring buffer。
4. 扩展 `git-service.ts` 提供 working diff context。

### Phase 4: Composer UI

1. 修改 `Composer.tsx` props：`contextItems`、`onContextAdd`、`models`。
2. 新增 `ContextMentionMenu.tsx`。
3. 新增 `ContextToken.tsx`。
4. 新增 `useComposerMentions.ts`。
5. 保持当前 composer 外观和模型按钮风格。

### Phase 5: Timeline UI

1. 修改 `Timeline.tsx` 结构化聚合事件。
2. 新增 `MessageBlock.tsx`。
3. 新增 `ToolCard.tsx`。
4. 新增 `PermissionCard.tsx`。

### Phase 6: Verification

1. `npm run check`
2. `npm --workspace @modus/desktop run test`
3. `npm --workspace @modus/desktop run build`
4. 手动 smoke：
   - 打开 workspace。
   - 创建 PI SDK session。
   - 输入 prompt 并看到 streaming text。
   - 输入 `@` 看到 file/folder/docs/terminal suggestions。
   - 选择模型并发送下一条 prompt。
   - `Ctrl+/` 循环模型。
   - 终端输出可作为 context。

## 8. UI 复用规范

必须复用：

- `Tooltip`
- `PanelHeader`
- `EmptyState`
- `cn`
- `app.css` 中的 Tailwind v4 `@theme` token
- `Composer` 当前容器样式
- `ModelSelect` 当前 Base UI Select 形态
- `Inspector` 的 tab 结构
- `Sidebar` 的 nav row 视觉语言

新增弹层统一使用：

- `bg-elevated`
- `border border-hairline`
- `shadow-popup`
- `rounded-lg`
- `text-sm`
- hover 用 `bg-hover`
- selected 用 `bg-active`

不引入：

- 新 UI 框架
- 新设计系统
- 大面积重写 layout
- 彩色高饱和状态

## 9. 风险和缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| PI SDK ESM / electron-vite 打包不兼容 | build/package 失败 | 先 main 内验证 import，再必要时 externalize 或 Agent Host process |
| PI SDK long-running task 卡住 main process | UI 卡顿 | 第二阶段迁到 Agent Host process |
| tool_call 权限拦截不完整 | 危险操作绕过 Modus | V0.1.1 先拦截 bash/write/edit/delete，默认危险操作 ask |
| context 注入过大 | token 爆炸、请求慢 | file/folder/docs/terminal 均设 size cap 和预览 |
| `@folder` 递归太深 | UI 卡顿 | picker 只浏览一级，选择后由 resolver 截断 |
| terminal 输出包含 ANSI/control chars | prompt 污染 | main ring buffer 存 plaintext sanitizer |
| 模型 ID 与 PI registry 不匹配 | setModel 失败 | 从 PI ModelRegistry 读取，不手写 provider/model |
| 当前 Biome check 已有格式错误 | 合并前质量门不通过 | 先修现有格式/import，再开始实现 |

## 10. 验收标准

V0.1.1 完成时必须满足：

- `@earendil-works/pi-coding-agent` SDK 已作为 desktop 依赖接入。
- Modus 默认不依赖用户全局安装 `pi` CLI 创建新 session。
- Prompt 走 `AgentSession.prompt()` 或 runtime API。
- Agent events 被 normalizer 映射为结构化 Modus events。
- Timeline 能显示 assistant streaming text。
- Composer 输入 `@` 能弹出建议。
- `@file` 和 `@folder` 可选择并随 prompt 发送给 Agent Host。
- `@Docs` 可搜索本地 Markdown 文档 chunk。
- `@Terminals` 可选择最近 terminal output。
- 模型下拉影响当前 session 后续 prompt。
- `Ctrl+/` 能循环模型。
- 权限 extension 能在 PI tool_call 前阻塞明显危险 bash 命令。
- `npm run check` 通过。

## 11. 建议实施切片

为了降低风险，建议第一 PR 只做：

1. 修现有 `npm run check` 的 Biome/lint 问题。
2. 扩展 shared contracts。
3. 引入 `AgentRuntime` interface。
4. 加 `PiSdkRuntime` behind feature flag。
5. 让一个 prompt 通过 PI SDK 返回 `message.delta`。
6. Timeline 渲染 streaming text。

第二 PR 做：

1. `@` mention menu。
2. file/folder context resolver。
3. model list/set/cycle。

第三 PR 做：

1. docs local index。
2. terminal output context。
3. permission extension。

## 12. 最终判断

V0.1.1 的核心不是“加几个 UI 按钮”，而是把 runtime 方向改对：PI SDK 是 agent loop kernel，Modus 是安全、上下文、diff、terminal、worktree 和桌面体验的 host。只要先完成 SDK runtime + structured events，后续 Cursor Agent Window 的多 session、worktree、diff review、context usage、permission broker 都可以自然叠上去。
