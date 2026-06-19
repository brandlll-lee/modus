<p align="center">
  <a href="./README.md">English</a> | 简体中文
</p>

<p align="center">
  <img alt="Modus logo" src="./docs/media/modus-logo.png" width="104" height="104">
</p>

<h1 align="center">Modus</h1>

<p align="center">
  开源、本地优先的 AI 编码 Agent 桌面工作区。
</p>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-active%20prototype-black">
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-52525b">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-42-47848f?logo=electron&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue">
</p>

![Modus 桌面界面](./docs/media/modus-ui.png)

---

Modus 是一个桌面应用，让 AI 编码 Agent 在真实的本地项目里工作。

打开项目，选择模型，先规划，再构建。命令、diff、浏览器、终端、checkpoint 和权限审批都在一个窗口里。代码留在你的机器上。

Modus 还很早期。现在推荐从源码运行，正式安装包还在发布流程里。

### 快速开始

```bash
# 需要 Node >= 22.19.0、npm、Rust + Cargo、Git
git clone https://github.com/brandlll-lee/modus.git
cd modus
npm install
npm run dev
```

然后：

1. 打开一个 workspace 文件夹。
2. 在 Settings 里连接模型 provider。
3. 直接聊天，或先切到 Plan Mode。
4. 在右侧面板审查改动，再 commit 或 push。

### 能做什么

- **先规划再构建**：Plan Mode 会调研、提结构化问题，并写出可审查的 `plan.md`，再进入代码修改。
- **Agent 工作可见**：timeline 展示消息、工具调用、终端、diff、todos、checkpoint、retry 和权限请求。
- **自带模型栈**：配置内置或自定义 PI 兼容 provider，设置模型限制、reasoning 和 thinking variant。
- **真实 Git 工作流**：查看工作区改动、暂存区、提交历史、分支、文件 diff、commit 和 push。
- **真实终端**：通过 Rust PTY sidecar 运行用户终端和 Agent 终端，xterm.js 渲染。
- **内置浏览器**：打开网页、管理 tab、用 DevTools、截图，也能让 Agent 调用浏览器工具。
- **本地上下文**：挂载文件、文件夹、docs、Git diff、终端输出、浏览器状态、图片、最近改动、rules 和选中的页面元素。
- **MCP 和 Skills**：从 Modus 自己的配置加载 MCP server，用 `/` 调用本地 skills。
- **权限执行**：Shell、Git、Browser、MCP、外部打开都走同一套审批流。
- **可回滚**：每次运行前创建 checkpoint，可以从 timeline 恢复工作区状态。

### 用起来是什么感觉

左边是项目书架：workspace、session、置顶项目和活动状态。

中间是聊天区：输入、规划、构建、编辑重发、停止、steer、挂上下文、切模型。

右边是检查面板：Changes、Plan、Files、Browser、Terminal、Security。

Settings 管理 provider、模型、MCP servers、skills、rules 和审批策略。

### MCP 配置

Modus 只会自动读取自己的 MCP 配置：

```text
~/.modus/mcp.json
<workspace>/.modus/mcp.json
```

它不会偷偷读取 Cursor、Claude、Warp 或其它 Agent 工具的配置。想让某个 MCP server 进入 Modus，就把它加到 Modus 配置里。

### 架构

```text
Renderer (React)
  侧边栏、timeline、输入框、检查面板、设置页

Preload bridge
  typed window.modus API，renderer 没有直接 Node 权限

Electron main
  workspace、Git、browser、terminal、docs、models、MCP、skills、permissions、agent runtime

Rust PTY sidecar
  通过 portable-pty 提供真实终端会话

SQLite
  保存 workspaces、sessions、events、permissions、docs、reviews、checkpoints、terminal output
```

安全细节见 [desktop security notes](./docs/architecture/desktop-security.md)。

### 技术栈

- Electron 42, electron-vite
- React 19, Base UI, Tailwind CSS v4, Motion, Tabler Icons
- Monaco, xterm.js, Streamdown
- `@earendil-works/pi-coding-agent`
- `@modelcontextprotocol/sdk`
- Rust `portable-pty`
- Node `node:sqlite`
- TypeScript, Biome, Vitest

### 开发命令

```bash
npm run dev          # 启动桌面应用
npm run check        # Biome + typecheck
npm run test         # Vitest
npm run format       # Biome --write

npm --workspace @modus/desktop run typecheck
npm --workspace @modus/desktop run build
npm --workspace @modus/desktop run package:win -- --publish never
cargo check -p modus-pty-host
```

### 仓库结构

```text
modus/
├─ apps/
│  ├─ desktop/        # Electron 桌面应用
│  └─ web/            # 预留给未来官网
├─ crates/
│  └─ pty-host/       # Rust PTY sidecar
├─ docs/
│  ├─ architecture/   # 安全和架构说明
│  └─ media/          # README 素材
└─ packages/          # 预留共享包
```

### 贡献

项目还很年轻，欢迎贡献。

- PR 尽量小，方便 review。
- 使用 Conventional Commits。
- 提交前运行 `npm run check` 和 `npm run test`。
- 优先做根因修复。用真实信号，不靠名字清单和猜测。

### License

Apache-2.0。见 [LICENSE](./LICENSE)。
