<div align="center">
  <img alt="Modus logo" src="./docs/media/modus-logo.png" width="104" height="104">
  <h1>Modus</h1>
  <p><b>本地优先的 AI 编码 Agent 桌面工作区。</b></p>
  <p>
    打开项目、和 Agent 对话、浏览网页、挂载上下文、审查 diff、运行终端、管理模型，
    并把整个编码循环留在你的机器上。
  </p>
</div>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-early%20desktop%20prototype-black">
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-52525b">
  <img alt="Desktop" src="https://img.shields.io/badge/desktop-Electron%2042-47848f">
  <img alt="UI" src="https://img.shields.io/badge/ui-React%2019-61dafb">
  <img alt="Local first" src="https://img.shields.io/badge/local--first-yes-16a34a">
</p>

<p align="center">
  <a href="./README.md">English</a> | 简体中文
</p>

<p align="center">
  <img alt="Modus 桌面界面：聊天、项目侧边栏、变更、终端和检查面板" src="./docs/media/modus-ui.png" width="100%">
</p>

## 为什么做 Modus

AI 编码工具越来越强，但很多流程仍然不够透明：Agent 在哪里执行命令，改了哪些文件，看到了什么上下文，真正工作的模型是哪一个？

Modus 是一个早期桌面应用，目标是让这条链路更清楚、更本地：

- **一个工作区，一个真实 checkout**：会话直接在所选项目目录和当前 Git 分支上工作。Modus 不会为每个 session 创建隐藏 Git worktree 或分支。
- **Agent 做了什么都能看见**：聊天、工具调用、Git 改动、终端输出、权限、checkpoint 都在同一个窗口里。
- **带上你自己的模型栈**：配置 PI 兼容 provider、模型、reasoning 参数、自定义 provider、MCP server 和本地 skills。
- **方便自己改**：Electron + React + TypeScript + Rust sidecar，渲染进程只通过 typed preload bridge 访问能力。

Modus 还不是成熟的 Cursor 或 Codex 替代品。它是一个已经能跑的本地优先原型，方向清楚，代码可以研究、修改、继续长大。

> License 提醒：当前 checkout 里还没有 license 文件。正式分发安装包、或把仓库当作法律意义上的可复用开源项目前，需要先补上。

## 当前状态

| 模块 | 状态 |
| --- | --- |
| 桌面外壳 | Electron 应用，自定义标题栏、项目侧边栏、聊天区和检查面板 |
| 工作区 | 打开本地文件夹、记住项目、识别 Git 仓库 |
| 会话 | 本地持久化聊天会话，支持流式 timeline 事件 |
| Runtime | PI SDK agent runtime，支持模型选择和会话级模型更新 |
| 上下文 | `@` 文件、文件夹、Git diff、终端输出、图片、索引后的 Markdown 文档 |
| Git | 变更列表、diff、文件版本、stage/unstage/discard、commit、push、status、stats |
| Review | 早期 AI review 流程，保存 review 结果，并带启发式 fallback 检查 |
| 终端 | Rust `modus-pty-host` 提供真实 PTY，xterm.js 渲染 |
| Browser | 右侧检查面板内置浏览器，支持 tabs、导航、DevTools、日志、截图和 Cursor 兼容工具 |
| Checkpoints | 运行前快照、恢复点、回滚到历史用户消息 |
| 权限 | Typed IPC、发送方校验、动态工具风险判断、权限记录 |
| 模型 | Provider 配置、自定义 provider、模型参数、上下文/输出限制 |
| MCP | Settings UI 和 preload/main 服务，支持 server、tool、env placeholder、启用/禁用 |
| Skills | 本地 skill 发现和配置入口，供 Agent 指令使用 |
| 布局打磨 | 单会话 chat viewport；宽表格/代码只在局部横向滚动 |

## 使用起来是什么感觉

- **左侧边栏** 是项目书架：工作区、会话、活跃状态和归档入口。
- **中间区域** 是 Agent timeline：用户消息、流式回答、工具卡片、diff、终端动作、todos、checkpoint、编辑重发和回滚入口。
- **输入框** 支持模型切换、thinking 级别配置、图片、slash skills 和 `@` 上下文。
- **右侧检查面板** 放 Changes、Browser、Terminal、Security，让你边聊边检查网页、日志、diff 和运行状态。
- **Settings** 管理 provider、自定义模型、模型参数、MCP servers、skills 和安全相关配置。

## 快速开始

### 需要准备

- Node.js `>=22.19.0`
- npm
- Rust 和 Cargo
- Git
- 可供 `@earendil-works/pi-coding-agent` 使用的 PI 兼容模型配置或凭据

### 安装

```bash
npm install
```

### 运行

```bash
npm run dev
```

然后：

1. 打开一个 workspace 文件夹。
2. 如果还没有模型，在 Settings 里配置 provider。
3. 新建聊天。
4. 用 `@`、`/` skills、文件、文件夹、图片、Git diff 或终端输出挂载上下文。
5. 在右侧检查面板审查改动，再决定 commit 或 push。

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

## 功能细节

### Agent 工作流

- 创建和重新打开本地会话。
- 把 Agent 事件流式渲染成可读 timeline。
- 编辑并重发历史用户消息。
- 回滚会话状态和工作区文件到 checkpoint。
- 在输入框上方显示当前变更摘要。
- 所有会话都运行在所选 workspace checkout，不生成隐藏 worktree。

### 上下文和知识

- 挂载文件和文件夹。
- 挂载 Git diff。
- 挂载终端输出。
- 挂载图片。
- 索引 README/docs 风格的 Markdown 文档。
- 在上下文选择器里搜索已索引文档。

### Git 和 Review

- 查看变更文件和完整 diff。
- 读取文件版本。
- Stage、unstage、discard、revert 文件。
- 在应用里 commit，或 commit 后 push。
- 对当前 diff 运行早期 AI review。
- 本地保存 review summary 和 issues。

### 终端

- 在检查面板创建用户终端。
- Agent 可以用 `terminal_run` 创建受管终端。
- 通过工具读取、写入、列出、终止终端。
- 长时间运行的命令会留在可见终端里，而不是藏在不可见子进程里。

### Browser

- 在右侧检查面板 Browser tab 中打开真实网页。
- 支持 tab strip、后退/前进、刷新、URL/搜索输入、外部打开和嵌入式 DevTools。
- 通过 Electron partition 按 workspace 隔离 cookies、localStorage、sessionStorage 和 IndexedDB。
- Agent 可使用 Cursor 兼容工具，例如 `browser_tabs`、`browser_navigate`、
  `browser_snapshot`、`browser_click`、`browser_fill`、截图、console logs、network logs。
- 浏览器动作复用 shell/Git/MCP 同一套权限审批管线。
- 第一期不做 Design Mode、iframe 深层控制和无审批 auto-run。

### 模型、MCP 和 Skills

- 配置内置 provider 和自定义 provider。
- 本地保存 provider/model 配置。
- 设置模型展示名、上下文窗口、输出限制、temperature、top-p 和 reasoning。
- 通过 UI 添加 MCP server，支持 stdio 和 HTTP/SSE。
- 启用或禁用 MCP tools。
- 在输入框中展示本地 skills 和 slash commands。

### 安全形状

- Renderer 没有 Node 权限。
- 所有能力都通过 typed `window.modus` preload API。
- IPC 校验 payload 和来源窗口。
- 危险 shell/Git 操作会先分类再执行。
- 权限记录保存在本地。

更多细节见 [desktop security notes](./docs/architecture/desktop-security.md)。

## 现在刻意不做什么

- 每个 session 自动创建 Git worktree。
- 一个 workspace 内多 Agent tiled panes。
- Cloud agents。
- Browser Design Mode 和无审批 computer-use 自动化。
- 完整 PR 自动化。
- 自动更新、签名和生产发布通道。

当前产品方向是：**多项目、多会话、当前 checkout 工作**。

## 技术栈

| 层级 | 当前实现 |
| --- | --- |
| 桌面 | Electron 42, electron-vite |
| UI | React 19, Base UI, Tailwind CSS v4, Motion, Tabler Icons |
| Markdown | Streamdown, CJK, code, math, Mermaid |
| 终端 | xterm.js + Rust `modus-pty-host` |
| Agent Runtime | `@earendil-works/pi-coding-agent` PI SDK |
| 本地数据 | Node `node:sqlite` |
| Diff 和 Git | Git CLI services |
| 校验 | Zod, Typebox |
| 质量工具 | TypeScript, Biome, Vitest |
| 打包 | electron-builder |

## 仓库结构

```text
modus/
├─ apps/
│  ├─ desktop/              # Electron 桌面应用
│  └─ web/                  # 预留给未来 Web 入口的 workspace
├─ crates/
│  └─ pty-host/             # Rust PTY sidecar，负责终端面板
├─ docs/
│  ├─ architecture/         # 架构和安全说明
│  └─ media/                # README logo 和截图
├─ packages/                # 预留给共享包的 workspace
├─ MODUS_V0.1.0_EXECUTION_PLAN.md
└─ MODUS_V0.1.1_EXECUTION_PLAN.md
```

## 用大白话讲架构

```text
Renderer UI
  侧边栏、聊天 timeline、输入框、设置页、检查面板、终端、diff。

Preload bridge
  一扇很窄的 typed 门，名字叫 window.modus。

Electron main process
  可信服务层：workspace、Git、browser、terminal、docs、model、MCP、skills、permissions、agents。

Rust PTY sidecar
  提供真实终端会话，不把底层终端代码塞进 React。

SQLite
  本地保存 workspaces、sessions、events、permissions、docs、reviews、checkpoints、terminal output。
```

## 开发命令

```bash
npm run dev
npm run check
npm run format
npm run test
npm --workspace @modus/desktop run typecheck
npm --workspace @modus/desktop run build
npm --workspace @modus/desktop run package:win -- --publish never
cargo check -p modus-pty-host
```

## 对比背景，2026 年 6 月

| 能力 | Modus 当前 | Codex App | Cursor 3.x+ |
| --- | --- | --- | --- |
| 产品成熟度 | 早期本地原型 | 成熟 Codex 桌面端 | 成熟 Agent-first IDE 和 Agents Window |
| 源码开放 | 目标是开源；license 待补 | 商业闭源 | 商业闭源 |
| 本地项目工作流 | 已可用 | 已可用 | 已可用 |
| 持久化聊天会话 | 已可用 | 已可用 | 已可用 |
| 当前 checkout 模式 | 默认模式 | Local mode | Editor / workspace mode |
| Worktree 模式 | 已刻意移除 | 可选 Worktree mode | 偏 worktree 的 agent flow |
| Git diff/review | 基础已可用 + 早期 AI review | 成熟 review pane | 成熟 review 和 Bugbot |
| 终端 | PTY + agent terminal tools 已可用 | 集成终端 | 集成终端 |
| MCP | 早期 UI/services | 支持 | 支持 |
| Skills/rules | 早期 skills 入口 | Skills/rules/memories 视配置而定 | Rules、memories、hooks、subagents |
| Cloud agents | 未实现 | Cloud mode | Cloud Agents |
| 浏览器/computer use | 内置浏览器第一期；不含 Design Mode | 浏览器/computer use 能力 | 浏览器/设计/远程流程 |
| 自动化 | 未实现 | Automations | Cloud-agent automations |

对比资料来源：

- [Codex app features](https://developers.openai.com/codex/app/features)
- [Codex app review pane](https://developers.openai.com/codex/app/review)
- [Codex app in-app browser](https://developers.openai.com/codex/app/browser)
- [Codex app automations](https://developers.openai.com/codex/app/automations)
- [Codex Agent Skills](https://developers.openai.com/codex/skills)
- [Cursor Agents Window docs](https://cursor.com/docs/agent/agents-window)
- [Cursor Agent overview](https://cursor.com/docs/agent/overview)
- [Cursor terminal docs](https://cursor.com/docs/agent/tools/terminal)
- [Cursor browser docs](https://cursor.com/docs/agent/tools/browser)
- [Cursor MCP docs](https://cursor.com/docs/mcp)
- [Cursor Cloud Agents docs](https://cursor.com/docs/cloud-agent)
- [Cursor Automations docs](https://cursor.com/docs/cloud-agent/automations)
- [Cursor Bugbot docs](https://cursor.com/docs/bugbot)
- [Cursor permissions docs](https://cursor.com/docs/reference/permissions)

## Roadmap

近期：

- 更清晰的 timeline 渲染，减少重复事件边界问题。
- 更强的权限提示和更安全的审批体验。
- 更好用的 diff review、hunk 级操作和 PR 工作流。
- 更可靠的终端回放和长时间命令管理。
- Browser 强化：更丰富的 snapshot、更可靠的 dialog 处理和视觉 QA 流程。
- 更完整的 MCP 和 skills 体验。
- 打包、签名、发布通道硬化。

更后面：

- Rules 和 memories。
- Automations。
- 云端或远程执行。
- 生产级发布流水线。

## 贡献

现在还没有正式贡献指南。当前建议：

- 开 issue 时给清楚复现或提案。
- 变更尽量小，方便 review。
- 发 PR 前运行 `npm run check` 和 `npm run test`。
- 不要加入隐藏 per-session worktree / parallel-agent 行为；当前 checkout 会话是产品方向。

## License

当前还没有 license 文件。在补上 license 前，请先把这个仓库视为用于评估的 source-available 项目。
