<p align="center">
  <h1 align="center">Modus</h1>
  <p align="center">
    面向开源编码 Agent 的本地优先 Agent Window。
  </p>
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <img alt="Status" src="https://img.shields.io/badge/status-v0.1.0%20MVP-black">
  <img alt="Desktop" src="https://img.shields.io/badge/desktop-Electron-47848f">
  <img alt="Runtime" src="https://img.shields.io/badge/runtime-pi-7c3aed">
  <img alt="Local first" src="https://img.shields.io/badge/local--first-yes-16a34a">
</p>

<p align="center">
  <a href="./README.md">English</a> | 简体中文
</p>

---

Modus 是一个开源、本地优先的现代 Cursor Agent Window 替代方案。

它不是 VS Code 分支，而是一个专注于编码 Agent 工作流的桌面应用：让 Agent 在你的本地仓库中运行，同时提供真实终端控制、Git Diff、Worktree、权限门禁和本地元数据存储。

通过 `pi` 接入你自己的模型，让代码留在自己的机器上，并在每个改动落地前完成审查。

> Modus V0.1.0 是工程化 MVP。桌面端基础能力已经打通，产品仍在快速迭代。

## 为什么是 Modus

大多数编码 Agent 要么被锁在闭源 IDE 里，要么只存在于终端界面，要么依赖云端工作流。Modus 选择了另一条路线：

- Agent UI 应该是开源的。
- 默认执行路径应该是本地优先的。
- 终端、Diff、权限和 Worktree 应该是一等产品界面。
- Agent Runtime 应该可以替换，而不是绑定单一厂商。
- 桌面应用应该像 Agent 驾驶舱，而不是通用编辑器分支。

## 当前功能

| 模块 | 状态 | V0.1.0 已实现 |
| --- | --- | --- |
| 桌面应用 | MVP | Electron 桌面壳、安全 preload bridge、React Agent Window UI |
| 本地工作区 | MVP | 打开文件夹、记录最近工作区、检测 Git 仓库 |
| Agent Runtime | MVP | `pi --mode rpc` 适配器、JSONL 解析、prompt/abort/event 映射 |
| 终端 | MVP | 基于 Rust `modus-pty-host` sidecar 和 `xterm.js` 的真实 PTY 会话 |
| Diff Review | MVP | Git 改动文件扫描和 Monaco Diff 查看器 |
| 权限 | MVP | 权限决策模型、本地持久化、IPC 接口 |
| Worktree | MVP | Git worktree list/create/delete IPC |
| 打包 | MVP | Windows NSIS 安装包 smoke test 通过 |

## 截图

第一批公开截图会在下一轮 UI polish 后加入。

目前 V0.1.0 已经包含第一版 Agent Window 壳：

- workspace/session 侧边栏
- agent timeline 和 composer
- security state 面板
- Git Diff Review 面板
- 真实终端面板

## 架构

```text
Modus Desktop
├─ Electron Main
│  ├─ secure window lifecycle
│  ├─ typed IPC handlers
│  ├─ workspace, Git, permission, diff, and worktree services
│  ├─ pi RPC adapter
│  └─ Rust PTY sidecar bridge
│
├─ Preload
│  └─ window.modus typed API
│
├─ Renderer
│  ├─ React Agent Window
│  ├─ xterm.js terminal UI
│  └─ Monaco diff viewer
│
└─ Rust Sidecar
   └─ modus-pty-host
      └─ portable-pty over PTY / ConPTY / openpty
```

关键设计选择是：Modus 在产品层保持 TypeScript-first，同时把低层终端控制移动到一个小型 Rust sidecar 中。这样可以避开 Electron 原生 Node addon 的 rebuild 问题，也为终端持久化、Agent handoff 和崩溃隔离留下更干净的演进路径。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面运行时 | Electron 42 |
| 构建 | electron-vite + Vite |
| UI | React 19 + Tailwind CSS v4 |
| 编辑器和 Diff | Monaco Editor |
| 终端 UI | xterm.js |
| PTY Host | Rust + portable-pty |
| 本地数据 | SQLite via Node `node:sqlite` |
| Agent Runtime | `pi` |
| 包管理 | npm workspaces |
| 质量工具 | TypeScript strict + Biome + Vitest |
| 打包 | electron-builder |

## 快速开始

### 环境要求

- Node.js `>=22.19.0`
- npm
- 带 Cargo 的 Rust toolchain
- Git
- 如需实验 Agent Runtime，请确保 `pi` 已在 PATH 中可用

### 安装依赖

```bash
npm install
```

### 运行桌面应用

```bash
npm run dev
```

### 构建

```bash
npm --workspace @modus/desktop run build
```

这会同时构建 Electron 应用和 Rust `modus-pty-host` sidecar。

### Windows 打包

```bash
npm --workspace @modus/desktop run package:win -- --publish never
```

Windows unpacked app 会包含：

```text
resources/bin/modus-pty-host.exe
```

## 仓库结构

```text
modus/
├─ apps/
│  ├─ desktop/              # Electron 桌面应用
│  └─ web/                  # 预留给未来官网
├─ crates/
│  └─ pty-host/             # Rust PTY sidecar
├─ packages/
│  ├─ agent-protocol/       # 共享 Agent event protocol
│  ├─ config/               # 共享配置占位
│  ├─ core/                 # 共享领域类型
│  └─ ui/                   # 共享 UI/design exports
├─ docs/
│  └─ architecture/         # 架构说明
└─ MODUS_V0.1.0_EXECUTION_PLAN.md
```

## V0.1.0 是什么

V0.1.0 是 Modus 的基础工程底座：

- 可运行的桌面应用壳
- 本地工作区模型
- 真实终端架构
- Git Diff 界面
- 权限模型
- Worktree 模型
- `pi` runtime 适配器
- Windows 打包 smoke 路径

## V0.1.0 还不是什么

Modus 还不是完整的 Cursor 替代品。

仍在推进中的能力：

- 更成熟的生产级 UI
- 完整 `@` context picker
- 覆盖所有危险操作的权限弹窗
- 更成熟的 `pi` 端到端工作流
- 终端持久化和回放
- 多 Agent 编排 UI
- macOS/Linux 打包 smoke
- 签名、图标、自动更新、release channels

## 路线图

### V0.2

- 面向文件、文件夹、Diff、终端输出和 session 的真实 context picker
- 更强的权限弹窗和审计记录
- 终端 buffering 和 backpressure
- 更好的 Diff Review 操作
- 第一版可用的 `pi` prompt-to-patch 任务循环

### V0.3

- 并行本地 Agent
- 基于 Worktree 的任务隔离
- Session replay 和 branching
- 更丰富的 tool call cards
- Agent Review 工作流

### Later

- 可选的云端 handoff
- MCP server 管理
- semantic/codegraph context
- 官方网站和文档
- 跨平台签名 release

## 开发命令

```bash
npm run dev
npm run check
npm run format
npm --workspace @modus/desktop run build
npm --workspace @modus/desktop run package:win -- --publish never
cargo check -p modus-pty-host
```

## 设计原则

- 默认本地优先。
- 默认开源。
- Renderer 不拥有特权能力。
- 危险操作必须经过权限门禁。
- Agent 的工作应该能通过 Diff 被审查。
- 终端控制应该是真实 PTY 控制，而不是假的文本框。
- 低层系统边界应该放在小而隔离的 host 中。

## 贡献

Modus 还处于早期阶段。现阶段最有价值的贡献包括：

- 带日志和复现步骤的 bug report
- Windows/macOS/Linux 打包反馈
- Agent Window 的 UI/UX critique
- `pi` runtime 集成修复
- 终端 sidecar 改进
- 文档和示例

在提交大型 PR 前，请先开 issue 或设计说明，帮助我们保持架构一致性。

## License

Modus 基于 AGPL-3.0 协议开源。
