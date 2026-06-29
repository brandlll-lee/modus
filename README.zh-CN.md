<p align="center">
  <a href="./README.md">English</a> | 简体中文
</p>

<p align="center">
  <img alt="Modus logo" src="./docs/media/modus-logo.png" width="96" height="96">
</p>

<h1 align="center">Modus</h1>

<p align="center">
  本地优先的 AI 编码 Agent 桌面工作区。
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#核心功能">核心功能</a> ·
  <a href="./docs/architecture/desktop-security.md">安全说明</a>
</p>

![Modus 桌面界面](./docs/media/modus-ui.png)

## 关于

Modus 是一个开源桌面应用，用来让 AI 编码 Agent 在真实的本地项目里工作。

打开 workspace，连接你自己的模型 provider，规划或构建，审查改动，审批高风险动作，把完整工作流放在一个窗口里。

Modus 还很早期，目前推荐从源码运行。

## 核心功能

- **Workspace 和 Session** - 打开本地项目，切换最近 workspace，置顶项目，并按仓库保留独立 Agent 会话。
- **自带模型接入** - 配置内置或自定义 PI 兼容 provider、默认模型、reasoning、thinking variant 和模型限制。
- **Git 工作流** - 查看工作区改动、文件 diff、分支、提交历史、commit、push 和会话改动统计。
- **Terminal、Browser 和 Files** - 使用真实 PTY 终端、带 tab 和 DevTools 的内置浏览器，以及 workspace 文件浏览器。
- **Fast Codebase** - Agent 先构建紧凑的本地代码地图，再读取文件，减少大范围 grep/read 探索。
- **Subagents** - 创建专用子 Agent，跟踪活动，并应用或清理它们的 worktree。
- **Plan 和 Build 模式** - 先生成可审查计划、回答结构化问题，再进入实现。
- **Context 和图片** - 挂载文件、文件夹、docs、Git diff、终端输出、浏览器状态、选中的页面元素、rules 和图片。
- **MCP、Skills 和 Rules** - 加载 Modus MCP server，用 `/` 调用本地 skills，并读取 AGENTS/Claude/Cursor 风格规则文件。
- **权限执行** - Shell、Git、Browser、MCP、文件和外部动作都走同一套审批流。
- **Checkpoint 和回滚** - Agent 运行前自动快照，需要时从 timeline 恢复工作区状态。

## 快速开始

Windows 和 macOS 都需要：

- Node.js `>= 22.19.0`
- npm
- Rust + Cargo
- Git

```bash
git clone https://github.com/brandlll-lee/modus.git
cd modus
npm install
npm run dev
```

然后打开一个 workspace 文件夹，并在 Settings 里配置模型 provider。

## 开发

```bash
npm run dev
npm run check
npm run test
npm --workspace @modus/desktop run typecheck
npm --workspace @modus/desktop run build
```

本地打包：

```bash
npm --workspace @modus/desktop run package:win -- --publish never
npm --workspace @modus/desktop run package:mac -- --publish never
```

Windows 运行 Windows 命令，macOS 运行 macOS 命令。

## MCP 配置

Modus 只会自动读取自己的 MCP 配置：

```text
~/.modus/mcp.json
<workspace>/.modus/mcp.json
```

它不会静默导入 Cursor、Claude、Warp 或其它 Agent 工具的配置。

## 技术栈

Electron、React、TypeScript、Tailwind CSS、Base UI、Motion、Monaco、xterm.js、Streamdown、Node SQLite、Rust `portable-pty`、`@earendil-works/pi-coding-agent` 和 MCP SDK。

## 贡献

欢迎贡献。请保持 PR 小而清晰，使用 Conventional Commits，并在提交前运行 `npm run check` 和 `npm run test`。

## License

Apache-2.0。见 [LICENSE](./LICENSE)。
