<div align="center">
  <h1>Modus</h1>
  <p><b>一个给编码 Agent 使用的本地桌面驾驶舱。</b></p>
</div>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-active%20desktop%20prototype-black">
  <img alt="Desktop" src="https://img.shields.io/badge/desktop-Electron-47848f">
  <img alt="Runtime" src="https://img.shields.io/badge/runtime-PI%20SDK-7c3aed">
  <img alt="Local first" src="https://img.shields.io/badge/local--first-yes-16a34a">
</p>

<p align="center">
  <a href="./README.md">English</a> | 简体中文
</p>

<p align="center">
  <a href="https://github.com/brandlll-lee/modus/releases/download/readme-demo-assets/Modu001.mp4">
    <img alt="Modus demo" src="./docs/media/modus-demo.gif" width="100%">
  </a>
</p>

想象一下，你身边坐着一个很会写代码的助手。

它能看你的项目，能打开终端，能读 Git 改动，能记住你们刚刚聊了什么，也能切换不同模型。
但它不是飘在远处的云端黑盒，而是坐在你电脑里的一个小工作台上：离代码很近，动作看得见，改动能检查，危险操作有人拦。

这就是 Modus。

Modus 是一个面向 AI 编码 Agent 的桌面应用。它不是完整 IDE，也不是 VS Code 分支。它更像一个专门给 Agent 准备的工作窗口：左边放项目和会话，中间聊天，右边放 Git、终端、Worktree 和安全状态。

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

## 接下来想去哪里

Modus 的目标很简单：让 AI 写代码这件事，不像把仓库交给一个看不见的人，而像在一张干净、明亮、本地的工作桌旁一起干活。

接下来会继续打磨 Agent 时间线、更强的权限提示、更丰富的上下文、更好用的 Diff 审查、更稳定的终端，以及基于 Worktree 的任务隔离。

如果你也想要一个看得见、查得到、能掌控的编码 Agent 窗口，Modus 就是这个工作台。
