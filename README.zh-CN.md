<div align="center">
  <img alt="Modus logo" src="./docs/media/modus-logo.png" width="104" height="104">
  <h1>Modus</h1>
  <p><b>Codex App 和 Cursor Agents Window 的早期开源桌面端替代产品。</b></p>
</div>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-early%20desktop%20prototype-black">
  <img alt="Target" src="https://img.shields.io/badge/target-Codex%20App%20%2B%20Cursor-2563eb">
  <img alt="Desktop" src="https://img.shields.io/badge/desktop-Electron-47848f">
  <img alt="Local first" src="https://img.shields.io/badge/local--first-yes-16a34a">
</p>

<p align="center">
  <a href="./README.md">English</a> | 简体中文
</p>

<p align="center">
  <img alt="Modus 桌面界面" src="./docs/media/modus-ui.png" width="100%">
</p>

如果你喜欢 Codex App 和 Cursor，你大概率喜欢这样的画面：

一个编码 Agent 坐在你的仓库旁边。它能读项目，能开终端，能看 Git 改动，能切换模型，能保留会话，还能一步步帮你把事情做完。

再加一个愿望：如果这个桌面 Agent 窗口是开放的、本地优先的、可以自己改的呢？

这就是 Modus 想做的事。

Modus 是一个面向 AI 编码 Agent 的早期桌面应用。它不会假装自己已经追上 Codex App 或 Cursor 3.x。没有。它们是成熟产品，Modus 现在还是工作台。但方向很清楚：做一个 Codex App 和 Cursor Agents Window 这个产品形态的开源桌面替代品，然后在公开代码里一点点追上去。

## 先把话说实在

今天的 Modus，是下面三个产品里最弱的那个。这很正常。

Codex App 已经有成熟桌面体验：worktree、自动化、Git review、集成终端、内置浏览器、computer use、skills、MCP 等等。Cursor 3.x 已经有 Agents Window、多 Agent 并行、Cloud Agents、worktree、PR review、Bugbot、浏览器工具、自动化、MCP、rules 和 Auto-review mode。

Modus 现在有的是地基：本地桌面壳、项目、会话、模型选择、上下文挂载、Git diff、终端、worktree 管理、本地存储和安全层。

我们的目标很简单，也很难：Codex App 和 Cursor 里那些真正有用的能力，Modus 以后也应该有，而且产品代码和路线图都尽量公开，让大家能看、能改、能一起建设。

> License 提醒：当前 checkout 里还没有 license 文件。正式分发安装包、或把仓库当作法律意义上的可复用开源项目前，需要先补上。

## 功能对比，2026 年 6 月

| 能力 | Modus 当前 | Codex App | Cursor 3.x+ |
| --- | --- | --- | --- |
| 产品定位 | 早期本地桌面 Agent 应用 | 成熟 Codex 桌面端 | 成熟 Agent-first IDE 和 Agents Window |
| 源码开放 | 目标是开源；license 仍待补齐 | 商业闭源产品 | 商业闭源产品 |
| 桌面 Agent 工作区 | 早期 Electron 壳：侧边栏、聊天、右侧面板 | 成熟桌面 thread 工作区 | 成熟 Agents Window + 传统编辑器 |
| 本地项目管理 | 打开文件夹、记住工作区、识别 Git 仓库 | 多项目桌面工作流 | 多工作区 Agents Window |
| Agent 会话 | 本地会话、流式事件、历史持久化 | 并行 Codex threads | Agent chats、队列消息、checkpoint |
| 模型选择 | PI 模型列表和会话级模型切换 | Codex 模型与 reasoning 控制 | 模型选择器、对话中切换模型 |
| 上下文挂载 | 文件、文件夹、终端输出、Git diff、Markdown docs | 项目、终端、浏览器、图片、IDE 上下文 | `@` 文件、文件夹、docs、终端、历史聊天、Git diff、浏览器 |
| Git review | 基础变更列表、diff、增删行、回滚文件 | review pane、行内评论、stage/revert hunk、commit/push/PR | diff、PR review、commits tab、文件树、changes picker |
| 集成终端 | Rust sidecar 驱动的真实 PTY 终端 | 每个 thread 的集成终端 | Agent 终端执行、sandbox、allowlist |
| Worktrees | 列出、新建、删除 Git worktree | Local/Worktree 模式、handoff、清理、快照 | Agents Window worktrees、`/worktree`、`/best-of-n`、清理 |
| Cloud agents | 还没有 | Cloud mode | Cloud Agents，可从桌面、网页、Slack、GitHub、Linear、API 启动 |
| 并行 Agent | 还没有 | 并行 threads 和后台任务 | Agents Window、tiled layout、`/multitask`、async subagents |
| 浏览器/设计工具 | 还没有 | in-app browser、浏览器评论、browser use | Browser tool、Design Mode、design sidebar、可视化编辑 |
| Computer use | 还没有 | 可操作 macOS/Windows 应用，需要审批 | Cloud agents 可控制远程桌面/浏览器 |
| 自动化 | 侧边栏占位，还未实现 | 项目自动化和 thread 自动化 | Cloud-agent automations，支持计划任务、事件、多 repo/无 repo |
| MCP/plugins/skills | 还没做成用户功能 | MCP、Agent Skills、plugins | MCP、MCP Apps、marketplace、skills、subagents、hooks |
| Rules/memories | 还没有 | Skills、rules、memories，取决于配置 | 项目/用户/团队 rules、AGENTS.md、automations memory |
| PR/代码审查自动化 | 还没有 | `/review` 和 review pane 工作流 | Bugbot、Bugbot Autofix、Cursor Review |
| 权限模型 | 早期 typed IPC 和 PI 工具调用拦截 | approvals 和 sandbox 设置 | sandbox、allowlist、`permissions.json`、Auto-review mode |
| 非代码产物 | 还没有 | PDF、表格、文档、演示文稿预览和生成 | 浏览器/设计/产物能力较强，随具体功能变化 |

## Modus 现在已经能做什么

当前真实源码里，Modus 已经打通了这些能力：

- **桌面外壳**：Electron 应用，包含自定义菜单栏、左侧边栏、聊天区、右侧检查面板。
- **工作区**：打开本地文件夹，记住最近项目，并识别这个文件夹是不是 Git 仓库。
- **Agent 会话**：新建会话、发送提示词、接收流式事件、本地保存历史，并能从左侧重新打开旧会话。
- **模型选择**：从 PI 模型注册表读取模型，设置默认模型，为当前会话切换模型，也支持键盘循环切换。
- **`@` 上下文**：把文件、文件夹、终端输出、Git diff、Markdown 文档片段挂到提示词里。
- **Git 审查**：查看变更文件，预览 diff，统计新增/删除行，并能从界面回滚单个文件。
- **真实终端**：通过 Rust sidecar 创建真正的 PTY 终端，再用 xterm.js 显示出来。
- **Worktree 管理**：列出、新建、删除 Git worktree，用来隔离不同任务。
- **安全层**：渲染进程没有 Node 权限，所有能力走 typed preload API，IPC 会校验来源，危险 PI 工具调用会在执行前被拦截。
- **本地存储**：工作区、会话、Agent 事件、权限记录、终端输出、文档索引都存在本机 SQLite 里。

## 像逛一圈一样理解它

打开 Modus，左边像一个项目书架。你可以打开本地文件夹，也可以点进之前的项目。每个项目下面都有会话，像一本本小笔记，还会显示最后活跃时间。

中间是你和 Agent 对话的地方。你可以直接问，也可以输入 `@README.md`、`@git diff` 这类上下文，让 Agent 少猜一点。消息会流式出现，用户消息、思考、工具调用都会按时间线排好。

右边像一个工具抽屉。Git 改动、真实终端、Worktree、安全状态都在这里。Agent 如果碰了你的代码，你马上能看到证据，而不是等它说“我改好了”。

## 快速开始

### 需要准备

- Node.js `>=22.19.0`
- npm
- Rust 和 Cargo
- Git
- 可供 `@earendil-works/pi-coding-agent` 使用的 PI 模型配置或凭据

### 安装

```bash
npm install
```

### 启动桌面端

```bash
npm run dev
```

然后按这个顺序试：

1. 点击 **Open workspace**。
2. 选择一个本地项目文件夹。
3. 新建一个聊天。
4. 在输入框下方选择模型。
5. 输入问题，或用 `@` 添加文件、文件夹、Git diff、终端输出等上下文。
6. 打开右侧面板，看 Git、终端、Worktree 和安全状态。

### 构建

```bash
npm --workspace @modus/desktop run build
```

这个命令会同时构建 Electron 应用和 Rust `modus-pty-host` 终端 sidecar。

### Windows 打包

```bash
npm --workspace @modus/desktop run package:win -- --publish never
```

打包配置会把 Rust 终端 sidecar 作为 unpacked binary resource 带进应用。

## 仓库结构

```text
modus/
├─ apps/
│  ├─ desktop/              # Electron 桌面应用
│  └─ web/                  # 未来官网占位
├─ crates/
│  └─ pty-host/             # Rust PTY sidecar，负责真实终端
├─ docs/
│  └─ architecture/         # 架构说明
├─ packages/                # 共享包占位
├─ MODUS_V0.1.0_EXECUTION_PLAN.md
└─ MODUS_V0.1.1_EXECUTION_PLAN.md
```

## 用大白话讲架构

```text
Renderer UI
  你看得见的界面：侧边栏、聊天、输入框、右侧面板、终端、diff。

Preload bridge
  一扇很窄的安全门，名字叫 window.modus。

Electron main process
  真正有权限的一侧：负责工作区、Git、终端、文档、模型、权限和 Agent。

Rust PTY sidecar
  一个小助手，专门负责开真实终端，避免把底层终端代码塞进 React。

SQLite
  本地小本本，记录工作区、会话、事件、权限、文档和终端输出。
```

重点是：界面不能随便碰你的电脑。它必须通过 `window.modus` 这扇窄门问主进程。危险的 Agent 工具调用，也会先经过权限扩展检查。

## 技术栈

| 层级 | 当前实现 |
| --- | --- |
| 桌面 | Electron 42, electron-vite |
| UI | React 19, Base UI, Tailwind CSS v4, Motion, Tabler Icons |
| 终端 | xterm.js + Rust `modus-pty-host` |
| Agent Runtime | `@earendil-works/pi-coding-agent` PI SDK |
| 本地数据 | Node `node:sqlite` |
| Diff 和 Git | Git CLI services |
| 质量工具 | TypeScript, Biome, Vitest |
| 打包 | electron-builder |

## 现在还比较早的地方

Modus 已经能作为本地原型跑起来，但还不是完整成熟产品：

- UI 还在继续向 Cursor 级质感打磨。
- 权限拦截已经有了，但用户确认流程还比较早期。
- 终端输出可以保存，但完整终端回放还没成熟。
- Markdown 文档可以索引和搜索，但还不是完整知识库。
- Worktree 能管理，但完整任务编排还在后面。
- MCP、Cloud Agents、浏览器工具、自动化、rules、memories、PR review 自动化、computer use 都还没实现。
- 跨平台打包、签名、自动更新、发布通道还没完成。
- 当前 checkout 里还没有 license 文件；正式分发前需要补上。

## 开发命令

```bash
npm run dev
npm run check
npm run format
npm run test
npm --workspace @modus/desktop run build
npm --workspace @modus/desktop run package:win -- --publish never
cargo check -p modus-pty-host
```

## 对比资料来源

- [Codex app features](https://developers.openai.com/codex/app/features)
- [Codex app review pane](https://developers.openai.com/codex/app/review)
- [Codex app worktrees](https://developers.openai.com/codex/app/worktrees)
- [Codex app in-app browser](https://developers.openai.com/codex/app/browser)
- [Codex app automations](https://developers.openai.com/codex/app/automations)
- [Codex Agent Skills](https://developers.openai.com/codex/skills)
- [Cursor 3.0 changelog](https://cursor.com/changelog/3-0)
- [Cursor 3.1 changelog](https://cursor.com/changelog/3-1)
- [Cursor 3.2 changelog](https://cursor.com/changelog/04-24-26)
- [Cursor 3.3 changelog](https://cursor.com/changelog/05-07-26)
- [Cursor 3.4 changelog](https://cursor.com/changelog/3-4)
- [Cursor 3.5 changelog](https://cursor.com/changelog/05-20-26)
- [Cursor 3.6 Auto-review changelog](https://cursor.com/changelog/auto-review)
- [Cursor Agents Window docs](https://cursor.com/docs/agent/agents-window)
- [Cursor Agent overview](https://cursor.com/docs/agent/overview)
- [Cursor prompting and context docs](https://cursor.com/docs/agent/prompting)
- [Cursor worktrees docs](https://cursor.com/docs/configuration/worktrees)
- [Cursor terminal docs](https://cursor.com/docs/agent/tools/terminal)
- [Cursor browser docs](https://cursor.com/docs/agent/tools/browser)
- [Cursor MCP docs](https://cursor.com/docs/mcp)
- [Cursor Cloud Agents docs](https://cursor.com/docs/cloud-agent)
- [Cursor Automations docs](https://cursor.com/docs/cloud-agent/automations)
- [Cursor Bugbot docs](https://cursor.com/docs/bugbot)
- [Cursor permissions docs](https://cursor.com/docs/reference/permissions)

## 接下来想去哪里

Modus 的目标很简单：让 AI 写代码这件事，不像把仓库交给一个看不见的人，而像在一张干净、明亮、本地的工作桌旁一起干活。

近期会继续打磨 Agent 时间线、更强的权限提示、更丰富的上下文、更好用的 Diff 审查、更稳定的终端，以及基于 Worktree 的任务隔离。

更远一点，Modus 会追赶完整桌面 Agent 闭环：并行 Agent、浏览器审查、MCP、rules、memories、自动化、云端或远程执行、PR review 和生产级发布。我们不说这些已经完成。我们说的是：这段追赶会尽量公开。
